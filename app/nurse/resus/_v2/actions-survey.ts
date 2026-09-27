"use server";

import type { ActionResult, EpisodeHeader } from "./common";
import type { EmrTx } from "@/lib/emr/db";
import type { EpisodePhase, PatientContextFlags } from "@/lib/resus/model";
import type { ResusScope } from "@/lib/resus/scope";
import type { AbcdeLetter, TimelineEvent } from "@/lib/resus/types";
import type { ResusTx, V2EventInput } from "@/lib/resus/v2-record";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { resusRoleAssignments, resusTimelineEvents } from "@/db/schema/resus";
import { emrV1Live } from "@/lib/emr/feature";
import { ampleToRecord } from "@/lib/emr/write/ample";
import { logger } from "@/lib/logger";
import { EMPTY_CONTEXT, PREGNANCY_STATES } from "@/lib/resus/model";
import { acknowledgeResusAlert } from "@/lib/resus/record";
import { STEP_PRESENTATION } from "@/lib/resus/reference/presentation";
import {
  abcAbnormalFrom,
  arrestActive,
  latestContext,
  legacyStepContext,
} from "@/lib/resus/survey/context";
import { computeStepStates } from "@/lib/resus/survey/floor";
import { RESUS_ROLES } from "@/lib/resus/types";
import {
  ACTION_STATES,
  allergyNoteIfChanged,
  buildActionStatePayload,
  buildAssessmentPayload,
  GcsSchema,
} from "@/lib/resus/v2-payloads";
import { commitResusEvents, fetchResusEventsSince } from "@/lib/resus/v2-record";
import { mirroredKinds, observationRows } from "@/lib/resus/v2-rules";
import { VITAL_INPUT_BOUNDS, vitalPlausible } from "@/lib/resus/vitals";
import { fail, isClinicalStaffAt, patientAgeYears, prelude, WriteBase } from "./common";

/**
 * Resus Desk v2 — survey-mode server actions (GATE A §3–§5, §9). Each one
 * records what the team did in ONE transaction (event + header + audit) and is
 * idempotent on `clientEventId`. Decision support: nothing here orders or acts.
 */

const LETTER = z.enum(["A", "B", "C", "D", "E"]);
const done = (r: Awaited<ReturnType<typeof commitResusEvents>>): ActionResult =>
  r.ok ? { ok: true, serverTime: r.serverTime, eventIds: r.events.map((e) => e.eventId) } : r;

/** Server clock for the client's offset (round-trip midpoint). */
export async function getServerTime(): Promise<{ serverTime: string }> {
  return { serverTime: new Date().toISOString() };
}

/** Rows written after `sinceIso` (system time) + the header — realtime/polling delta. */
export async function fetchResusDeltaV2(input: { episodeId: string; sinceIso: string }): Promise<
  | {
      ok: true;
      events: TimelineEvent[];
      header: { state: string; phase: EpisodePhase; currentArrestSeq: number };
      serverTime: string;
    }
  | { ok: false; error: string; signedOut?: boolean }
> {
  const parsed = z
    .object({ episodeId: z.string().uuid(), sinceIso: z.string().datetime({ offset: true }) })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid delta request.");
  const p = await prelude(parsed.data.episodeId);
  if (!p.ok) return p;
  const events = await fetchResusEventsSince(parsed.data.episodeId, parsed.data.sinceIso);
  return {
    ok: true,
    events,
    header: {
      state: p.header.state,
      phase: p.header.phase as EpisodePhase,
      currentArrestSeq: p.header.currentArrestSeq,
    },
    serverTime: new Date().toISOString(),
  };
}

/* ─── Patient context (entered once; D19) ───────────────────────────── */

const FlagsSchema = z.object({
  trauma: z.boolean(),
  chestTrauma: z.boolean(),
  spinalInjury: z.boolean(),
  headInjury: z.boolean(),
  activeBleeding: z.boolean(),
  allergenTrigger: z.boolean(),
  pregnancy: z.enum(PREGNANCY_STATES),
  gestationWeeks: z.number().int().min(1).max(45).nullable(),
  knownAsthma: z.boolean(),
  copdRisk: z.boolean(),
  peSuspected: z.boolean(),
  opioidsSuspected: z.boolean(),
  alcoholMalnourished: z.boolean(),
  feverMeningism: z.boolean(),
  serotonergicOrNeuroleptic: z.boolean(),
  environmentalExposure: z.boolean(),
  febrileChild: z.boolean(),
  bmiOver40: z.boolean(),
  renalDialysis: z.boolean(),
  localAnaestheticToxicity: z.boolean(),
}) satisfies z.ZodType<PatientContextFlags>;

export async function setPatientContextV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  flags: PatientContextFlags;
  /** SV-CTX-01: only what this tap changed, merged over the record's latest context. */
  patch?: Partial<PatientContextFlags>;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    flags: FlagsSchema,
    patch: FlagsSchema.partial().optional(),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid patient context.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  // Two devices flipping different flags both land: the patch merges over the latest.
  const patch = parsed.data.patch;
  const flags = patch ? { ...latestContext(p.events), ...patch } : parsed.data.flags;
  const on = Object.entries(flags)
    .filter(([k, v]) => v === true && k in EMPTY_CONTEXT)
    .map(([k]) => k);
  if (flags.pregnancy !== "none") on.push(`pregnancy ${flags.pregnancy}`);
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "context",
          step: "pre",
          payload: {
            flags,
            ...(patch ? { patch } : {}),
            label: on.length ? `Context: ${on.join(", ")}` : "Context cleared",
          },
        },
      ],
      audit: { action: "record_resus_event", reason: "Resus patient context set" },
    }),
  );
}

/* ─── Step findings + action states ─────────────────────────────────── */

const LocalSchema = z.object({
  gagPresent: z.boolean().default(false),
  lowRespRate: z.boolean().default(false),
  notRecovered: z.boolean().default(false),
});

const FindingsSchema = z.object({
  state: z.string().max(40).nullable().optional(),
  patency: z.string().max(40).nullable().optional(),
  present: z.array(z.string().max(64)).max(80),
  difficulty: z.array(z.string().max(64)).max(10).optional(),
  gcs: GcsSchema.nullable().optional(),
  avpu: z.enum(["A", "V", "P", "U"]).nullable().optional(),
  glucoseMmol: z
    .number()
    .min(VITAL_INPUT_BOUNDS.glucose.min)
    .max(VITAL_INPUT_BOUNDS.glucose.max)
    .nullable()
    .optional(),
  focalOnset: z.string().max(80).nullable().optional(),
  seizureDurationMin: z.number().min(0).max(600).nullable().optional(),
  coreTempC: z
    .number()
    .min(VITAL_INPUT_BOUNDS.temperature.min)
    .max(VITAL_INPUT_BOUNDS.temperature.max)
    .nullable()
    .optional(),
  ample: z
    .object({
      allergies: z.array(z.string().max(80)).max(30).default([]),
      medications: z.string().max(500).optional(),
      pastHistory: z.string().max(500).optional(),
      lastMeal: z.string().max(200).optional(),
      events: z.string().max(500).optional(),
      nkda: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

/** Record a step's findings; the legacy context is built server-side (D19/D20). */
export async function recordStepFindingsV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  step: AbcdeLetter;
  findings: z.infer<typeof FindingsSchema>;
  local?: Partial<z.infer<typeof LocalSchema>>;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    step: LETTER,
    findings: FindingsSchema,
    local: LocalSchema.optional(),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid findings.");
  const { step, findings } = parsed.data;
  const known = new Set(STEP_PRESENTATION[step].findings.map((f) => f.code));
  if (findings.present.some((c) => !known.has(c))) return fail("Unknown finding code.");
  const overall = new Set(STEP_PRESENTATION[step].overall);
  const headline = step === "A" ? findings.patency : findings.state;
  if (headline && !overall.has(headline)) return fail("Unknown overall picture.");

  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const nowMs = Date.now();
  const ageYears = await patientAgeYears(p.header.patientUserId);
  const inArrest = arrestActive(p.events);
  const states = computeStepStates(p.events, { ageYears, nowMs, inArrest });
  const context = legacyStepContext(step, {
    flags: latestContext(p.events),
    inArrest,
    local: { gagPresent: false, lowRespRate: false, notRecovered: false, ...parsed.data.local },
    abcAbnormal: abcAbnormalFrom(states),
  });
  const { ample, ...rest } = findings;
  const findingSet: Record<string, unknown> = { ...rest, context };
  if (step === "A") {
    findingSet.patency = findings.patency ?? null;
    findingSet.difficulty = findings.difficulty ?? [];
    delete findingSet.state;
  }
  if (step === "E") findingSet.ample = ample ?? null;

  const events: V2EventInput[] = [
    {
      clientEventId: parsed.data.clientEventId,
      recordedAt: parsed.data.recordedAt,
      kind: "assessment",
      step,
      payload: buildAssessmentPayload(step, findingSet),
    },
  ];
  // AMPLE is carried forward: re-recording E writes the allergy note only when it changed.
  const allergyNote =
    step === "E" && ample
      ? allergyNoteIfChanged(p.events, ample.allergies, ample.nkda === true)
      : null;
  const noteClientEventId = crypto.randomUUID();
  if (allergyNote)
    events.push({
      clientEventId: noteClientEventId,
      recordedAt: parsed.data.recordedAt,
      kind: "note",
      step: null,
      payload: allergyNote,
    });
  const capture = allergyNote?.allergyCapture as
    | { substances: string[]; nkda: boolean }
    | undefined;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events,
      audit: { action: "record_resus_event", reason: `Resus ${step} findings` },
      ...(capture
        ? {
            also: (tx: ResusTx) =>
              ampleToRecordV2(tx, p.scope, p.header, noteClientEventId, capture),
          }
        : {}),
    }),
  );
}

/**
 * R1: the AMPLE capture also lands on the allergy record (lib/emr/write/ample.ts), in the same
 * transaction as the timeline note, under a savepoint: it never fails the resus entry, and the 0071
 * backfill (keyed on the same capture) can copy a skipped one later. The desk looks the same.
 */
async function ampleToRecordV2(
  tx: ResusTx,
  scope: ResusScope,
  header: EpisodeHeader,
  noteClientEventId: string,
  capture: { substances: string[]; nkda: boolean },
): Promise<void> {
  const patientUserId = header.patientUserId;
  if (!patientUserId || !emrV1Live()) return;
  try {
    await tx.transaction(async (sp) => {
      const etx = sp as unknown as EmrTx;
      const [note] = await etx
        .select({ id: resusTimelineEvents.id })
        .from(resusTimelineEvents)
        .where(
          and(
            eq(resusTimelineEvents.episodeId, header.id),
            eq(resusTimelineEvents.clientEventId, noteClientEventId),
          ),
        );
      if (!note) return;
      await ampleToRecord(etx, scope, {
        patientUserId,
        episodeId: header.id,
        noteId: note.id,
        capture,
      });
    });
  } catch (e) {
    logger.warn("resus.ample.record_write_failed", { episodeId: header.id, reason: String(e) });
  }
}

export async function setStepActionStateV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  step: AbcdeLetter;
  actionId: string;
  actionCode: string;
  state: (typeof ACTION_STATES)[number];
  reason?: string;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    step: LETTER,
    actionId: z.string().min(1).max(64),
    actionCode: z.string().min(1).max(64),
    state: z.enum(ACTION_STATES),
    reason: z.string().max(500).optional(),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid action.");
  const built = buildActionStatePayload(parsed.data);
  if (!built) return fail("Unknown action for this step.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: built.kind,
          step: parsed.data.step,
          payload: built.payload,
        },
      ],
      audit: {
        action: "record_resus_event",
        reason: `Resus ${parsed.data.step} action ${parsed.data.actionCode} → ${parsed.data.state}`,
      },
    }),
  );
}
/* ─── Vitals (+ supplemental O₂), artefact annotation ───────────────── */

const Num = z.number().finite().nonnegative().nullable().optional();
const SnapshotSchema = z
  .object({
    hr: Num,
    rr: Num,
    spo2: Num,
    systolicBp: Num,
    diastolicBp: Num,
    temperature: Num,
    glucose: Num,
    gcs: Num,
    etco2: Num,
    urineOutput: Num,
    consciousness: z.enum(["A", "C", "V", "P", "U"]).nullable().optional(),
    oxygen: z.enum(["air", "oxygen"]).nullable().optional(),
    o2Device: z.string().max(40).nullable().optional(),
    o2FlowLpm: Num,
  })
  .superRefine((s, ctx) => {
    // R2: the same plausibility the capture form applies (SpO₂ 970, 375 °C are typos).
    for (const [k, v] of Object.entries(s))
      if (typeof v === "number" && !vitalPlausible(k, v))
        ctx.addIssue({ code: "custom", path: [k], message: "Not a possible reading" });
  });

/**
 * Retract a resus vital's longitudinal copy (artefact mark or undo): the mirrored
 * clinical_observations rows leave active use in the same transaction. Rows are
 * matched on patient, recorder, bedside time and kind; triage-carried vitals were
 * never mirrored here and are left alone.
 */
function retractMirror(vital: TimelineEvent, kinds: string[], patientUserId: string | null) {
  const by = vital.recordedByUserId;
  if (!patientUserId || !by || kinds.length === 0 || vital.payload.carriedFromTriage) return;
  return async (tx: ResusTx) => {
    await tx
      .update(clinicalObservations)
      .set({ state: "corrected" })
      .where(
        and(
          eq(clinicalObservations.patientUserId, patientUserId),
          eq(clinicalObservations.recordedByUserId, by),
          eq(clinicalObservations.recordedAt, new Date(vital.recordedAt)),
          inArray(clinicalObservations.observationKind, kinds),
          isNull(clinicalObservations.triageRecordId),
          eq(clinicalObservations.state, "active"),
        ),
      );
  };
}

export async function logVitalsV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  snapshot: z.infer<typeof SnapshotSchema>;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({ snapshot: SnapshotSchema }).safeParse(input);
  if (!parsed.success) return fail("Invalid vitals.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const snap = Object.fromEntries(
    Object.entries(parsed.data.snapshot).filter(([, v]) => v !== null && v !== undefined),
  );
  if (Object.keys(snap).length === 0) return fail("Enter at least one value.");
  // One bedside time for the resus row and its longitudinal copy (never the delivery time).
  const recordedAt = parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : new Date();
  const mirror = p.header.patientUserId
    ? observationRows(
        snap,
        {
          hospitalId: p.scope.hospitalId,
          patientUserId: p.header.patientUserId,
          recordedByUserId: p.scope.userId,
        },
        recordedAt,
      )
    : [];
  // Vitals are not a step (v1 logged them under C — the P4 root cause).
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: recordedAt.toISOString(),
          kind: "vital",
          step: null,
          payload: { label: "Vitals", snapshot: snap },
        },
      ],
      // The mirror is written exactly once, with the event, in the same transaction.
      also:
        mirror.length > 0
          ? async (tx) => {
              await tx.insert(clinicalObservations).values(mirror);
            }
          : undefined,
      audit: { action: "record_observation", reason: "Resus vitals" },
    }),
  );
}

/** Mark vital values as artefact: they stay in the record and leave derivation (SV-VIT-16). */
export async function annotateVitalV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  vitalEventId: string;
  fields: string[];
  reason: string;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    vitalEventId: z.string().uuid(),
    fields: z.array(z.string().max(32)).min(1).max(14),
    reason: z.string().trim().min(2).max(300),
  }).safeParse(input);
  if (!parsed.success) return fail("Say which values and why.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const vital = p.events.find((e) => e.id === parsed.data.vitalEventId && e.kind === "vital");
  if (!vital) return fail("That vitals entry is not in this resus.");
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "note",
          step: null,
          payload: {
            noteKind: "vital_annotation",
            vitalEventId: parsed.data.vitalEventId,
            fields: parsed.data.fields,
            artefact: true,
            reason: parsed.data.reason,
            label: `Artefact: ${parsed.data.fields.join(", ")} — ${parsed.data.reason}`,
          },
        },
      ],
      // SV-VIT-16: the longitudinal copy carries the same mark.
      also: retractMirror(vital, mirroredKinds(parsed.data.fields), p.header.patientUserId),
      audit: { action: "correct_observation", reason: `Vital artefact: ${parsed.data.reason}` },
    }),
  );
}

/* ─── Notes, corrections, the return-to-A loop ──────────────────────── */

export async function recordNoteV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  text: string;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({ text: z.string().trim().min(1).max(2000) }).safeParse(input);
  if (!parsed.success) return fail("Write the note first.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "note",
          step: null,
          // The text is PHI: encrypted at rest; the label is generic.
          payload: { noteKind: "free", label: "Note" },
          narrative: parsed.data.text,
        },
      ],
      audit: { action: "record_resus_event", reason: "Resus note" },
    }),
  );
}

/**
 * Correct or undo an entry: a NEW row supersedes it (the original stays in the
 * immutable store and leaves the active view). Undo = reason "undone".
 */
export async function correctEventV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  supersedesEventId: string;
  reason: string;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    supersedesEventId: z.string().uuid(),
    reason: z.string().trim().min(2).max(300),
  }).safeParse(input);
  if (!parsed.success) return fail("Give a reason for the correction.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const target = p.events.find((e) => e.id === parsed.data.supersedesEventId);
  if (!target) return fail("That entry is not in the active record.");
  const label = String(target.payload.label ?? target.kind);
  const undone = parsed.data.reason === "undone";
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "note",
          step: target.step,
          supersedesEventId: target.id,
          payload: {
            noteKind: "correction",
            correction: { reason: parsed.data.reason, of: target.id, kind: target.kind },
            label: undone ? `Undone: ${label}` : `Corrected: ${label} — ${parsed.data.reason}`,
          },
        },
      ],
      // The header is re-derived from the timeline in the commit (undoing a ROSC re-opens the
      // arrest); a corrected vital's longitudinal copy leaves active use with it.
      also:
        target.kind === "vital"
          ? retractMirror(
              target,
              mirroredKinds(Object.keys((target.payload.snapshot as object | undefined) ?? {})),
              p.header.patientUserId,
            )
          : undefined,
      // The target was read before the lock: a write in between re-reads it.
      expectRows: p.rows,
      audit: {
        action: "correct_resus_event",
        reason: `${undone ? "Undo" : "Correction"} of ${target.kind}: ${parsed.data.reason}`,
      },
    }),
  );
}

export async function recordReturnToAV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  reason?: string;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({ reason: z.string().max(200).optional() }).safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "reassessment",
          step: "A",
          payload: {
            returnToA: true,
            label: parsed.data.reason
              ? `Returned to A — ${parsed.data.reason}`
              : "Returned to A (reassess from the top)",
          },
        },
      ],
      audit: { action: "record_resus_event", reason: "Resus return to A" },
    }),
  );
}

/* ─── Team: claim / assign / respond ────────────────────────────────── */

const RoleSchema = z.object({
  episodeId: z.string().uuid(),
  /** Idempotency key for a retried tap (a fresh one is used when the client sends none). */
  clientEventId: z.string().uuid().optional(),
  role: z.enum(RESUS_ROLES),
  userId: z.string().uuid().optional(),
});

/**
 * Claim a role for yourself (or assign it to someone else — active clinical staff
 * at this hospital only). Hand-over, the new holder, the role_change row and the
 * audit are ONE transaction, so a failure never leaves the role vacant. Claiming
 * marks you as responding: an alert you hold is acknowledged; without one,
 * holding a role is what lists you as responding (no fake alert row).
 */
export async function setRoleV2(input: {
  episodeId: string;
  clientEventId?: string;
  role: (typeof RESUS_ROLES)[number];
  userId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = RoleSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid role.");
  const { episodeId, role } = parsed.data;
  const p = await prelude(episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return { ok: true };
  const me = p.scope.userId;
  const holder = parsed.data.userId ?? me;
  if (holder !== me && !(await isClinicalStaffAt(holder, p.scope.hospitalId)))
    return fail("Only active clinical staff at this hospital can hold a resus role.");
  const r = await commitResusEvents({
    scopeUserId: me,
    hospitalId: p.scope.hospitalId,
    episodeId,
    events: [
      {
        clientEventId: parsed.data.clientEventId ?? crypto.randomUUID(),
        kind: "role_change",
        step: "pre",
        payload: { label: `Role assigned: ${role}`, role, userId: holder },
      },
    ],
    also: async (tx) => {
      await tx
        .update(resusRoleAssignments)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(resusRoleAssignments.episodeId, episodeId),
            eq(resusRoleAssignments.role, role),
            isNull(resusRoleAssignments.endedAt),
          ),
        );
      await tx
        .insert(resusRoleAssignments)
        .values({ episodeId, userId: holder, role, assignedByUserId: me });
    },
    audit: {
      action: "assign_resus_role",
      reason: `Role ${role} assigned`,
      after: { role, user_id: holder },
    },
  });
  if (!r.ok) return fail(r.error);
  if (holder === me) await acknowledgeResusAlert({ scopeUserId: me, episodeId });
  return { ok: true };
}

/** "I'm responding" — a closed or cancelled resus is read-only. */
export async function respondV2(input: {
  episodeId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.object({ episodeId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid episode.");
  const p = await prelude(parsed.data.episodeId);
  if (!p.ok) return p;
  if (p.header.state !== "active") return fail("This resus is closed — the record is read-only.");
  const r = await acknowledgeResusAlert({
    scopeUserId: p.scope.userId,
    episodeId: parsed.data.episodeId,
  });
  return "error" in r ? fail(r.error) : { ok: true };
}
