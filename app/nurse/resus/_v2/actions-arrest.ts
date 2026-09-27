"use server";

import type { ActionResult } from "./common";
import type { TimelineEvent } from "@/lib/resus/types";
import type { HeaderPatch, V2EventInput } from "@/lib/resus/v2-record";
import type { FastPathDrug } from "@/lib/resus/v2-rules";
import { z } from "zod";

import { clockOf, shockLabel } from "@/app/nurse/resus/[episodeId]/_components/v2/record-format";
import { arrestSlice, arrestStatus, currentArrestSeq } from "@/lib/resus/als/timing";
import { detectArrest } from "@/lib/resus/arrest";
import { sendArrestCall } from "@/lib/resus/mobilise";
import {
  ARREST_PROCEDURES,
  CAUSE_KEYS,
  CAUSE_STATES,
  RHYTHMS,
  ROSC_SIGNS,
} from "@/lib/resus/model";
import { reconstructTimeline } from "@/lib/resus/timeline";
import { commitResusEvents } from "@/lib/resus/v2-record";
import {
  arrestAt,
  arrestCallTarget,
  declarationSeqAt,
  FAST_PATH_DRUGS,
  fastPathDoseMg,
  fastPathHoldReason,
  isChild,
  roscProblem,
  stopProblem,
} from "@/lib/resus/v2-rules";
import { cprNotAttemptedProblem, priorDeathConfirmation } from "@/lib/resus/v2-rules-closeout";
import { createServiceClient } from "@/lib/supabase/service";
import { fail, prelude, WriteBase } from "./common";

/**
 * Resus Desk v2 — arrest-console server actions (docs/clinical/resus-als-clinical-catalog.md).
 * Each records what the team did (one tap = one event), in one transaction,
 * idempotent on clientEventId. Nothing here decides: the engine suggests, the
 * leader leads.
 */

const done = (r: Awaited<ReturnType<typeof commitResusEvents>>): ActionResult =>
  r.ok ? { ok: true, serverTime: r.serverTime, eventIds: r.events.map((e) => e.eventId) } : r;
const Seq = z.number().int().min(1).max(50);
const Tri = z.boolean().nullable();

/**
 * Declare cardiac arrest (ALS-REC-01/04). The multi-sign confirm (D20) must
 * meet the v1 criterion; the header one-tap sends unresponsive + not breathing
 * normally + no pulse (the clinician asserts it). A declaration while an arrest
 * is already running is a no-op (never resets counters). A NEW arrest sends one
 * arrest call.
 */
export async function declareArrestV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  signs: {
    responsive: boolean | null;
    breathingNormally: boolean | null;
    centralPulse: boolean | null;
  };
  source: "desk" | "step" | "triage_rapid_red";
}): Promise<ActionResult<{ arrestSeq: number; alreadyInArrest?: boolean }>> {
  const parsed = WriteBase.extend({
    signs: z.object({ responsive: Tri, breathingNormally: Tri, centralPulse: Tri }),
    source: z.enum(["desk", "step", "triage_rapid_red"]),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid arrest declaration.");
  const verdict = detectArrest(parsed.data.signs);
  if (!verdict.isArrest)
    return fail(
      "Arrest criteria not met — unresponsive AND not breathing normally and/or no central pulse. Apnoea with a pulse: ventilate (bag-mask), not CPR.",
    );
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) {
    // Undo supersedes both rows of the declaration: a replay names the CPR-started row too.
    const decl = p.events.find((e) => e.id === p.replay!.eventIds[0]);
    const cpr =
      decl &&
      p.events.find(
        (e) =>
          e.kind === "cpr_started" &&
          e.arrestSeq === decl.arrestSeq &&
          Date.parse(e.recordedAt) === Date.parse(decl.recordedAt),
      );
    return {
      ...p.replay,
      eventIds: cpr ? [...p.replay.eventIds, cpr.id] : p.replay.eventIds,
      arrestSeq: p.replay.arrestSeq ?? 1,
    };
  }
  const tl = reconstructTimeline(p.events);
  const running = currentArrestSeq(tl);
  if (running > 0 && arrestStatus(arrestSlice(tl, running)!) === "in_arrest")
    return {
      ok: true,
      serverTime: new Date().toISOString(),
      eventIds: [],
      arrestSeq: running,
      alreadyInArrest: true,
    };

  // ALS-ROSC-04/05: same arrest or a new one is judged at the BEDSIDE time, not on delivery.
  const at = parsed.data.recordedAt;
  const arrestSeq = declarationSeqAt(p.events, at ? Date.parse(at) : Date.now());
  const newArrest = arrestSeq > running;
  const r = await commitResusEvents({
    scopeUserId: p.scope.userId,
    hospitalId: p.scope.hospitalId,
    episodeId: parsed.data.episodeId,
    events: [
      {
        clientEventId: parsed.data.clientEventId,
        recordedAt: at,
        kind: "arrest_detected",
        step: "arrest",
        arrestSeq,
        payload: {
          arrestSeq,
          reason: verdict.reason,
          signs: parsed.data.signs,
          source: parsed.data.source,
          witnessed: null,
          monitored: null,
          label: `${arrestSeq > 1 && newArrest ? `Cardiac arrest #${arrestSeq}` : newArrest ? "Cardiac arrest" : "Re-arrest"} — ${verdict.reason}`,
        },
      },
      {
        clientEventId: crypto.randomUUID(),
        recordedAt: at,
        kind: "cpr_started",
        step: "arrest",
        arrestSeq,
        payload: { arrestSeq, label: "CPR started" },
      },
    ],
    // Phase, arrest sequence and arrest time are derived from the timeline under the lock.
    expectRows: p.rows,
    audit: { action: "detect_resus_arrest", reason: `Arrest #${arrestSeq}: ${verdict.reason}` },
  });
  if (r.ok && newArrest && !r.events[0]?.duplicate) {
    await sendArrestCall({
      service: createServiceClient(),
      episodeId: parsed.data.episodeId,
      hospitalId: p.scope.hospitalId,
      ...arrestCallTarget(p.header),
      arrestSeq,
    });
  }
  return r.ok
    ? { ...(done(r) as { ok: true; serverTime: string; eventIds: string[] }), arrestSeq }
    : r;
}

/**
 * Utstein fields captured after the event, never before CPR (ALS-REC-09): a
 * superseding arrest_detected row at the ORIGINAL bedside time, merged with the
 * details. The original stays in the immutable store.
 */
export async function updateArrestDetailsV2(input: {
  episodeId: string;
  clientEventId: string;
  arrestSeq: number;
  witnessed: boolean | null;
  monitored: boolean | null;
  collapseAtIso: string | null;
  cprBeforeDeclarationAtIso: string | null;
}): Promise<ActionResult> {
  const Iso = z.string().datetime({ offset: true }).nullable();
  const parsed = WriteBase.extend({
    arrestSeq: Seq,
    witnessed: Tri,
    monitored: Tri,
    collapseAtIso: Iso,
    cprBeforeDeclarationAtIso: Iso,
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid arrest details.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const original = [...p.events]
    .reverse()
    .find(
      (e) =>
        e.kind === "arrest_detected" &&
        ((e.payload.arrestSeq as number | undefined) ?? e.arrestSeq ?? 1) === parsed.data.arrestSeq,
    );
  if (!original) return fail("That arrest is not in this resus.");
  const { episodeId, clientEventId, arrestSeq, ...details } = parsed.data;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId,
      events: [
        {
          clientEventId,
          recordedAt: original.recordedAt,
          kind: "arrest_detected",
          step: "arrest",
          arrestSeq,
          supersedesEventId: original.id,
          payload: { ...original.payload, ...details, arrestSeq },
        },
      ],
      audit: { action: "correct_resus_event", reason: `Arrest #${arrestSeq} details (Utstein)` },
    }),
  );
}

/**
 * One event with a fixed kind — the console's one-tap writes. An arrest-scoped
 * row (one carrying `arrestSeq`) takes its arrest from the record at the
 * bedside time, never from the client (R1: a shock queued behind a re-arrest
 * lands in the new arrest). A `check` is judged at the bedside time, on that
 * arrest, and must still hold at commit.
 */
async function arrestEvent(
  base: { episodeId: string; clientEventId: string; recordedAt?: string },
  e: Omit<V2EventInput, "clientEventId" | "recordedAt">,
  reason: string,
  opts: {
    header?: HeaderPatch;
    check?: (events: TimelineEvent[], atMs: number, seq: number) => string | null;
  } = {},
): Promise<ActionResult> {
  const p = await prelude(base.episodeId, base.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const atMs = base.recordedAt ? Date.parse(base.recordedAt) : Date.now();
  let row = e;
  let seq = 0;
  if (e.arrestSeq != null) {
    const a = arrestAt(p.events, atMs);
    if (!a) return fail("No arrest is recorded — declare the arrest first.");
    seq = a.seq;
    row = { ...e, arrestSeq: a.seq, payload: { ...e.payload, arrestSeq: a.seq } };
  }
  const problem = opts.check?.(p.events, atMs, seq);
  if (problem) return fail(problem);
  const { header } = opts;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: base.episodeId,
      events: [{ ...row, clientEventId: base.clientEventId, recordedAt: base.recordedAt }],
      header,
      expectRows: opts.check ? p.rows : undefined,
      audit: { action: "record_resus_event", reason },
    }),
  );
}

const RHYTHM_LABEL = {
  vf_pvt: "VF / pVT",
  pea: "PEA",
  asystole: "Asystole",
  organised: "Organised rhythm",
} as const;

export async function recordRhythmCheckV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  arrestSeq: number;
  rhythm: (typeof RHYTHMS)[number];
  pulse?: boolean | null;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    arrestSeq: Seq,
    rhythm: z.enum(RHYTHMS),
    pulse: z.boolean().nullable().optional(),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid rhythm check.");
  const { arrestSeq, rhythm, pulse } = parsed.data;
  const label = `Rhythm check: ${RHYTHM_LABEL[rhythm]}${rhythm === "organised" ? (pulse ? " — pulse present" : pulse === false ? " — no pulse (PEA)" : "") : ""}`;
  return arrestEvent(
    parsed.data,
    {
      kind: "rhythm_check",
      step: "arrest",
      arrestSeq,
      payload: { arrestSeq, rhythm, pulse: pulse ?? null, label },
    },
    label,
  );
}

export async function recordShockV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  arrestSeq: number;
  energyJ: number | null;
  energySource: "profile" | "highest" | "manual";
  stacked?: boolean;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    arrestSeq: Seq,
    energyJ: z.number().int().min(1).max(400).nullable(),
    energySource: z.enum(["profile", "highest", "manual"]),
    stacked: z.boolean().optional(),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid shock.");
  const { arrestSeq, energyJ, energySource, stacked } = parsed.data;
  // The record's wording: a child's shock logged without an energy is "energy not recorded".
  const label = shockLabel(energyJ, energySource, stacked);
  return arrestEvent(
    parsed.data,
    {
      kind: "shock",
      step: "arrest",
      arrestSeq,
      payload: { arrestSeq, energyJ, energySource, stacked: stacked ?? false, label },
    },
    label,
  );
}

const PROC_LABEL: Record<(typeof ARREST_PROCEDURES)[number], string> = {
  airway_bvm: "Bag-valve-mask ventilation",
  airway_sga: "Supraglottic airway inserted",
  airway_ett: "Tracheal tube inserted",
  iv_attempt_failed: "IV attempt failed",
  iv_access: "IV access obtained",
  io_access: "IO access obtained",
  compressor_swap: "Compressor swapped",
  pads_antero_posterior: "Pads moved antero-posterior",
  left_uterine_displacement: "Manual left uterine displacement",
  decompression: "Chest decompression",
  pericardiocentesis: "Pericardiocentesis",
  hysterotomy: "Resuscitative hysterotomy",
};

export async function recordArrestProcedureV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  arrestSeq: number;
  arrestProcedure: (typeof ARREST_PROCEDURES)[number];
  ettTrace?: "yes" | "no" | "unavailable";
  toUserId?: string | null;
  toName?: string | null;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    arrestSeq: Seq,
    arrestProcedure: z.enum(ARREST_PROCEDURES),
    ettTrace: z.enum(["yes", "no", "unavailable"]).optional(),
    toUserId: z.string().uuid().nullable().optional(),
    toName: z.string().max(80).nullable().optional(),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid procedure.");
  const d = parsed.data;
  const trace =
    d.arrestProcedure === "airway_ett" && d.ettTrace
      ? ` — ETCO₂ trace ${d.ettTrace === "yes" ? "confirmed" : d.ettTrace === "no" ? "NOT confirmed" : "capnography not available"}`
      : "";
  const who = d.arrestProcedure === "compressor_swap" && d.toName ? ` → ${d.toName}` : "";
  const label = `${PROC_LABEL[d.arrestProcedure]}${trace}${who}`;
  return arrestEvent(
    d,
    {
      kind: "procedure",
      step: "arrest",
      arrestSeq: d.arrestSeq,
      payload: {
        arrestSeq: d.arrestSeq,
        arrestProcedure: d.arrestProcedure,
        ettTrace: d.ettTrace ?? null,
        toUserId: d.toUserId ?? null,
        toName: d.toName ?? null,
        label,
      },
    },
    label,
  );
}

export async function setReversibleCauseV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  arrestSeq: number;
  cause: (typeof CAUSE_KEYS)[number];
  state: (typeof CAUSE_STATES)[number];
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    arrestSeq: Seq,
    cause: z.enum(CAUSE_KEYS),
    state: z.enum(CAUSE_STATES),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid cause state.");
  const { arrestSeq, cause, state } = parsed.data;
  const label = `Reversible cause ${cause.replace(/_/g, " ")}: ${state.replace(/_/g, " ")}`;
  return arrestEvent(
    parsed.data,
    {
      kind: "decision",
      step: "arrest",
      arrestSeq,
      payload: { decision: "reversible_cause", arrestSeq, cause, state, label },
    },
    label,
  );
}

/**
 * ROSC (ALS-ROSC-01): record which signs were present; the desk moves to post-ROSC.
 * LC-06: only for the current arrest, while it runs or after a stop (signs of life,
 * ALS-DTH-05) — a second ROSC without a re-arrest is refused.
 */
export async function recordRoscV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  arrestSeq: number;
  signs: (typeof ROSC_SIGNS)[number][];
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    arrestSeq: Seq,
    signs: z.array(z.enum(ROSC_SIGNS)).min(1).max(4),
  }).safeParse(input);
  if (!parsed.success) return fail("Say which signs of ROSC were present.");
  const { arrestSeq, signs } = parsed.data;
  const label = `ROSC — ${signs.map((s) => s.replace(/_/g, " ")).join(", ")}`;
  return arrestEvent(
    parsed.data,
    { kind: "rosc", step: "arrest", arrestSeq, payload: { arrestSeq, signs, label } },
    label,
    { check: (events, atMs, seq) => roscProblem(events, seq, atMs) },
  );
}
/* ─── Fast-path arrest drugs (D4, ALS-DRG-05) ───────────────────────── */

export type FastPathResult =
  | { ok: true; serverTime: string; eventIds: string[]; warnings: string[] }
  | { ok: false; error: string; readOnly?: boolean; signedOut?: boolean }
  | {
      ok: false;
      /** The safety check blocked (or the case needs weighing): open the prescribe dialog pre-filled. */
      openDialog: true;
      drugId: string;
      doseMg: number | null;
      reasons: string[];
    };

/**
 * One tap logs a protocol arrest drug when the prescribing safety check is
 * clear: the drug event (same accountability payload as the prescribe dialog)
 * with the signed default. Any block (allergy, age < 16, dose), what the console
 * holds back (core < 30 °C: ALS-MOD-01/03, ALS-AA-04), a LAST context
 * (weight-based adrenaline) or a dose beyond the protocol returns `openDialog`
 * — the existing dialog then applies the signed override-with-reason rule.
 * Arrest drugs are not controlled; controlled drugs never use this path.
 */
export async function recordArrestDrugV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  arrestSeq: number;
  drug: FastPathDrug;
  route: "iv" | "io";
}): Promise<FastPathResult> {
  const parsed = WriteBase.extend({
    arrestSeq: Seq,
    drug: z.enum(["adrenaline", "amiodarone", "lidocaine"]),
    route: z.enum(["iv", "io"]),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid drug.");
  const { getEmergencyDrug } = await import("@/lib/prescribing/reference/emergency-drug-catalog");
  const { runSafetyChecks } = await import("@/lib/prescribing/engine");
  const { priorAdministrationsFromTimeline, recordedAllergiesFromTimeline } =
    await import("@/lib/prescribing/administration");
  const { mergeAllergyLists } = await import("@/lib/prescribing/allergy-merge");
  const { loadPersistentAllergiesForEpisode } = await import("../actions");
  const { latestContext } = await import("@/lib/resus/survey/context");
  const { resolveCapabilities } = await import("@/lib/doctor/capabilities");
  const { patientAgeYears } = await import("./common");

  const spec = FAST_PATH_DRUGS[parsed.data.drug];
  const drug = getEmergencyDrug(spec.drugId);
  if (!drug || !drug.adult) return fail("Unknown drug.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return { ...p.replay, warnings: [] };

  const tl = reconstructTimeline(p.events);
  // R1: the arrest at the bedside time, never the client's number.
  const at = parsed.data.recordedAt ? Date.parse(parsed.data.recordedAt) : Date.now();
  const a = arrestAt(p.events, at);
  if (!a) return fail("No arrest is recorded — declare the arrest first.");
  const slice = arrestSlice(tl, a.seq);
  const givenThisArrest = (slice?.events ?? []).filter((e) => {
    const pr = e.payload.prescribing as { drugId?: string } | undefined;
    return e.kind === "drug" && pr?.drugId === spec.drugId;
  }).length;
  // Law 3: the dose is the signed catalog constant (the console shows the same one).
  const doseMg = fastPathDoseMg(parsed.data.drug, givenThisArrest);

  const ageYears = await patientAgeYears(p.header.patientUserId);
  const flags = latestContext(p.events);
  const reasons: string[] = [];
  if (doseMg === null) reasons.push("Both protocol doses are already recorded in this arrest.");
  const hold = fastPathHoldReason(parsed.data.drug, p.events, givenThisArrest);
  if (isChild(ageYears)) reasons.push("Child — weight-based dose (PLS not built).");
  else if (hold) reasons.push(hold);
  if (parsed.data.drug === "adrenaline" && flags.localAnaestheticToxicity)
    reasons.push("Local anaesthetic toxicity: adrenaline ≤ 1 µg/kg — enter the weight-based dose.");
  // The record's allergies (lib/emr/read/allergies.ts under EMR v1). A failed read never logs a
  // one-tap drug: the dialog opens and says so.
  let recordAllergies: string[] = [];
  try {
    recordAllergies = (await loadPersistentAllergiesForEpisode(parsed.data.episodeId)).allergies;
  } catch {
    reasons.push("Allergies could not be loaded — check before giving.");
  }
  const allergies = mergeAllergyLists(recordedAllergiesFromTimeline(p.events), recordAllergies);
  const checks = runSafetyChecks({
    drug,
    patient: {
      ageYears,
      weightKg: null,
      allergies,
      conditions: [flags.knownAsthma ? "asthma" : null, flags.copdRisk ? "copd" : null].filter(
        (c): c is string => c !== null,
      ),
    },
    priorAdministrations: priorAdministrationsFromTimeline(p.events),
    edit: doseMg !== null ? { doseMg } : undefined,
  });
  for (const f of checks) if (f.severity === "block") reasons.push(f.message);
  if (reasons.length > 0)
    return { ok: false, openDialog: true, drugId: spec.drugId, doseMg, reasons };

  const caps = await resolveCapabilities({
    hospitalId: p.scope.hospitalId,
    departmentId: p.scope.departmentId,
    cadreCode: p.scope.cadreCode,
  });
  const authority = caps.prescription_routine;
  const dose = `${doseMg} mg`;
  const concentration = drug.adult.concentration;
  const r = await commitResusEvents({
    scopeUserId: p.scope.userId,
    hospitalId: p.scope.hospitalId,
    episodeId: parsed.data.episodeId,
    events: [
      {
        clientEventId: parsed.data.clientEventId,
        recordedAt: parsed.data.recordedAt,
        kind: "drug",
        step: "arrest",
        arrestSeq: a.seq,
        payload: {
          arrestSeq: a.seq,
          arrestDrug: parsed.data.drug,
          fastPath: true,
          prescribing: {
            drugId: drug.id,
            drugKey: drug.drugKey,
            drugName: drug.name,
            dose,
            concentration,
            route: parsed.data.route,
            interval: drug.adult.interval,
            indication: drug.indications[0] ?? null,
            amountMg: doseMg,
            giverUserId: p.scope.userId,
            giverCadre: p.scope.cadreCode,
            prescribeAuthority: authority,
            underResusProtocol: authority !== "allowed",
            controlled: drug.controlled,
            overrideReason: null,
            overriddenFlags: [],
            edited: false,
            edits: [],
            default: {
              dose,
              concentration,
              route: parsed.data.route,
              interval: drug.adult.interval,
            },
            source: drug.source,
          },
          state: "performed",
          dose: `${dose} (${concentration})`,
          label: `${drug.name} ${dose} ${parsed.data.route.toUpperCase()} — administered`,
        },
      },
    ],
    // The dose index was read before the lock: a write in between re-reads it.
    expectRows: p.rows,
    audit: { action: "administer_medication", reason: `Arrest ${drug.name} ${dose} (fast path)` },
  });
  if (!r.ok) return r;
  return {
    ok: true,
    serverTime: r.serverTime,
    eventIds: r.events.map((e) => e.eventId),
    warnings: checks.filter((f) => f.severity !== "block").map((f) => f.message),
  };
}

/* ─── Stopping, CPR not attempted, confirmation of death ────────────── */

export async function stopResuscitationV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  arrestSeq: number;
  reasons: (
    | "no_response_to_als"
    | "persistent_asystole"
    | "known_wishes_or_plan"
    | "irreversible_condition"
    | "other"
  )[];
  otherReason: string | null;
  teamAsked: boolean;
  objection: string | null;
  seniorConsulted: { name: string; cadre: string; mode: "in_person" | "phone" } | null;
  family: "present" | "informed" | "not_reachable" | null;
  shown: string[];
}): Promise<ActionResult> {
  const { STOP_REASONS } = await import("@/lib/resus/model");
  const { stopAuthority } = await import("@/lib/resus/als/termination");
  const parsed = WriteBase.extend({
    arrestSeq: Seq,
    reasons: z.array(z.enum(STOP_REASONS)).min(1),
    otherReason: z.string().max(300).nullable(),
    teamAsked: z.boolean(),
    objection: z.string().max(500).nullable(),
    seniorConsulted: z
      .object({
        name: z.string().max(80),
        cadre: z.string().max(60),
        mode: z.enum(["in_person", "phone"]),
      })
      .nullable(),
    family: z.enum(["present", "informed", "not_reachable"]).nullable(),
    shown: z.array(z.string().max(200)).max(40),
  }).safeParse(input);
  if (!parsed.success) return fail("Give at least one reason (ALS-TOR-06).");
  if (parsed.data.reasons.includes("other") && !parsed.data.otherReason?.trim())
    return fail("Describe the other reason.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const d = parsed.data;
  // LC-06: only while this arrest is running — a stale stop after ROSC is refused.
  const problem = stopProblem(
    p.events,
    d.arrestSeq,
    d.recordedAt ? Date.parse(d.recordedAt) : Date.now(),
  );
  if (problem) return fail(problem);
  const authority = stopAuthority(p.scope.cadreCode);
  const label = `Resuscitation stopped — ${d.reasons.map((x) => x.replace(/_/g, " ")).join(", ")}${authority.seniorCosignPending ? " (senior co-sign pending)" : ""}`;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: d.episodeId,
      events: [
        {
          clientEventId: d.clientEventId,
          recordedAt: d.recordedAt,
          kind: "resuscitation_stopped",
          step: "arrest",
          arrestSeq: d.arrestSeq,
          payload: {
            arrestSeq: d.arrestSeq,
            reasons: d.reasons,
            otherReason: d.otherReason,
            teamAsked: d.teamAsked,
            objection: d.objection,
            seniorConsulted: d.seniorConsulted,
            family: d.family,
            shown: d.shown,
            seniorCosignPending: authority.seniorCosignPending,
            label,
          },
        },
      ],
      expectRows: p.rows,
      audit: { action: "stop_resuscitation", reason: label, after: { reasons: d.reasons } },
    }),
  );
}

export async function recordCprNotAttemptedV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  reason: "treatment_limitation" | "irreversible_death";
  detail: string;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    reason: z.enum(["treatment_limitation", "irreversible_death"]),
    detail: z.string().trim().min(3).max(500),
  }).safeParse(input);
  if (!parsed.success) return fail("A reason is required (ALS-REC-07).");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const problem = cprNotAttemptedProblem(p.events);
  if (problem) return fail(problem);
  const label = `CPR not attempted — ${parsed.data.reason === "treatment_limitation" ? "valid treatment-limitation decision" : "obvious irreversible death"}: ${parsed.data.detail}`;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "decision",
          step: "arrest",
          payload: {
            decision: "cpr_not_attempted",
            reason: parsed.data.reason,
            detail: parsed.data.detail,
            label,
          },
        },
      ],
      audit: { action: "stop_resuscitation", reason: label },
    }),
  );
}

/**
 * Confirmation of death (AoMRC 2025, ALS-DTH-*). The 5-minute observation must be
 * complete and unbroken; the confirming clinician is the caller; time of death is
 * when they are satisfied all the criteria are met (ALS-DTH-07) — the bedside
 * time of the confirmation, never the time an offline queue delivered it.
 */
export async function confirmDeathV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  criteria: {
    unconscious: boolean;
    apnoea: boolean;
    noCirculation: boolean;
    pupilsUnreactive: boolean;
    noMotorResponse: boolean;
    cornealReflexesAbsent: boolean | null;
  };
  supportedBy: ("ecg_asystole" | "no_arterial_trace" | "echo_no_activity")[];
  ventilatorDisconnected: boolean | null;
  familyToldTimeMayDiffer: boolean;
}): Promise<ActionResult> {
  const { deathObservation, deathChecklistComplete } =
    await import("@/lib/resus/death/confirmation");
  const parsed = WriteBase.extend({
    criteria: z.object({
      unconscious: z.boolean(),
      apnoea: z.boolean(),
      noCirculation: z.boolean(),
      pupilsUnreactive: z.boolean(),
      noMotorResponse: z.boolean(),
      cornealReflexesAbsent: z.boolean().nullable(),
    }),
    supportedBy: z.array(z.enum(["ecg_asystole", "no_arterial_trace", "echo_no_activity"])).max(3),
    ventilatorDisconnected: z.boolean().nullable(),
    familyToldTimeMayDiffer: z.boolean(),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid confirmation.");
  if (!deathChecklistComplete(parsed.data.criteria))
    return fail("Every criterion must be confirmed (ALS-DTH-01, -06).");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const atMs = parsed.data.recordedAt ? Date.parse(parsed.data.recordedAt) : Date.now();
  const obs = deathObservation(p.events, atMs);
  if (obs.startedAtMs === null)
    return fail("Stop resuscitation first — the observation starts then.");
  if (obs.invalidated)
    return fail("Signs of life were recorded after the stop — resume, then observe again.");
  if (!obs.complete)
    return fail(`Observe ${Math.ceil(obs.remainingMs / 1000)} s more (5 minutes, ALS-DTH-01).`);
  // ALS-DTH-07: one time of death — a second device's confirmation is refused, never stacked.
  const prior = priorDeathConfirmation(p.events);
  if (prior)
    return fail(
      `Death is already confirmed at ${clockOf(prior.recordedAt, false)} by ${(prior.payload.confirmingName as string | null | undefined) ?? "a clinician"}.`,
    );
  const confirmedAtIso = new Date(atMs).toISOString();
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: confirmedAtIso,
          kind: "death_confirmed",
          step: "arrest",
          payload: {
            observationStartedAtIso: new Date(obs.startedAtMs).toISOString(),
            confirmedAtIso,
            confirmingUserId: p.scope.userId,
            confirmingName: p.scope.fullName,
            criteria: parsed.data.criteria,
            supportedBy: parsed.data.supportedBy,
            ventilatorDisconnected: parsed.data.ventilatorDisconnected,
            familyToldTimeMayDiffer: parsed.data.familyToldTimeMayDiffer,
            label: `Death confirmed by ${p.scope.fullName ?? "clinician"} (${p.scope.cadreName})`,
          },
        },
      ],
      header: { deathConfirmedAt: new Date(atMs) },
      expectRows: p.rows,
      audit: { action: "confirm_death", reason: "Death confirmed after cardiorespiratory arrest" },
    }),
  );
}

/** A treatment-limitation decision (D11): doctor / clinical officer only; rationale + family recorded. */
export async function recordTreatmentLimitationV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  summary: string;
  rationale: string;
  familyInvolvement: string;
}): Promise<ActionResult> {
  const { stopAuthority } = await import("@/lib/resus/als/termination");
  const parsed = WriteBase.extend({
    summary: z.string().trim().min(3).max(300),
    rationale: z.string().trim().min(3).max(1000),
    familyInvolvement: z.string().trim().min(2).max(500),
  }).safeParse(input);
  if (!parsed.success) return fail("Summary, rationale and family involvement are required.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  if (!stopAuthority(p.scope.cadreCode).recommended)
    return fail("A doctor or clinical officer records treatment-limitation decisions (D11).");
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "decision",
          step: "pre",
          payload: {
            decision: "treatment_limitation",
            summary: parsed.data.summary,
            rationale: parsed.data.rationale,
            familyInvolvement: parsed.data.familyInvolvement,
            label: `Treatment limitation: ${parsed.data.summary}`,
          },
        },
      ],
      audit: { action: "record_resus_event", reason: "Treatment-limitation decision recorded" },
    }),
  );
}

/* ─── Post-ROSC bundle ──────────────────────────────────────────────── */

export async function setPostRoscItemV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  itemId: string;
  state: "done" | "not_indicated" | "not_available";
}): Promise<ActionResult> {
  const { POST_ROSC_REF } = await import("@/lib/resus/reference/post-rosc-catalog");
  const parsed = WriteBase.extend({
    itemId: z.string().regex(/^PR-[A-Z]+-\d{2}$/),
    state: z.enum(["done", "not_indicated", "not_available"]),
  }).safeParse(input);
  if (!parsed.success || !POST_ROSC_REF[parsed.data.itemId]) return fail("Unknown bundle item.");
  const d = parsed.data;
  const label = `${POST_ROSC_REF[d.itemId]!.text.slice(0, 80)} — ${d.state.replace(/_/g, " ")}`;
  const p = await prelude(d.episodeId, d.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: d.episodeId,
      events: [
        {
          clientEventId: d.clientEventId,
          recordedAt: d.recordedAt,
          kind: "decision",
          step: "post",
          payload: { decision: "post_rosc_item", itemId: d.itemId, state: d.state, label },
        },
      ],
      audit: { action: "record_resus_event", reason: `Post-ROSC ${d.itemId} ${d.state}` },
    }),
  );
}

export async function setObeysCommandsV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  value: boolean;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({ value: z.boolean() }).safeParse(input);
  if (!parsed.success) return fail("Invalid.");
  const label = parsed.data.value
    ? "Obeys commands (motor 6)"
    : "Does not obey commands — comatose";
  return arrestEvent(
    parsed.data,
    {
      kind: "decision",
      step: "post",
      payload: { decision: "obeys_commands", value: parsed.data.value, label },
    },
    label,
  );
}

/** Choose the bay's registered defibrillator for this resus (ALS-NRG-01). */
export async function setBayProfileV2(input: {
  episodeId: string;
  clientEventId: string;
  bayProfileId: string | null;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({ bayProfileId: z.string().uuid().nullable() }).safeParse(input);
  if (!parsed.success) return fail("Invalid bay.");
  return arrestEvent(
    parsed.data,
    {
      kind: "note",
      step: "pre",
      payload: {
        noteKind: "bay_profile",
        bayProfileId: parsed.data.bayProfileId,
        label: "Defibrillator profile set",
      },
    },
    "Resus bay profile set",
    { header: { bayProfileId: parsed.data.bayProfileId } },
  );
}
