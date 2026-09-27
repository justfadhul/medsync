"use server";

import type { EmrDb } from "@/lib/emr/db";
import type { ResusScope } from "@/lib/resus/scope";
import type { AbcdeStep, ResusEventKind, ResusRole } from "@/lib/resus/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { patientAllergies } from "@/db/schema/prescribing";
import { resusEpisodes } from "@/db/schema/resus";
import { triageRecords } from "@/db/schema/triage";
import { resolveCapabilities } from "@/lib/doctor/capabilities";
import { emrV1Live } from "@/lib/emr/feature";
import { loadAllergyInput } from "@/lib/emr/read/allergies";
import { ampleNoteToRecord } from "@/lib/emr/write/ample";
import { encounterEngineLive } from "@/lib/encounter/feature";
import { logger } from "@/lib/logger";
import { recordedAllergiesFromTimeline } from "@/lib/prescribing/administration";
import { allergyRecheck, mergeAllergyLists } from "@/lib/prescribing/allergy-merge";
import { getEmergencyDrug } from "@/lib/prescribing/reference/emergency-drug-catalog";
import { AIRWAY_ACTION_STATES, classifyAirway } from "@/lib/resus/airway";
import { detectArrest } from "@/lib/resus/arrest";
import { BREATHING_ACTION_STATES, classifyBreathing } from "@/lib/resus/breathing";
import {
  CIRCULATION_ACTION_STATES,
  classifyCirculation,
  identifyShockType,
} from "@/lib/resus/circulation";
import {
  classifyDisability,
  DISABILITY_ACTION_STATES,
  gcsTotal,
  identifyNeuroSyndrome,
  mandatoryGlucoseMissing,
} from "@/lib/resus/disability";
import {
  classifyExposure,
  EXPOSURE_ACTION_STATES,
  identifyExposureDiagnosis,
  tempStage,
} from "@/lib/resus/exposure";
import { resusDeskV2 } from "@/lib/resus/feature";
import { mobiliseResusTeam, sendArrestCall } from "@/lib/resus/mobilise";
import {
  acknowledgeResusAlert,
  appendResusEvent,
  assignResusRole,
  concludeResusEpisode,
  fetchResusEpisode,
  fetchResusTimeline,
  markResusArrest,
  openResusEpisode,
} from "@/lib/resus/record";
import { AIRWAY_PATENCY, airwayAction } from "@/lib/resus/reference/airway-catalog";
import { BREATHING_STATES, breathingAction } from "@/lib/resus/reference/breathing-catalog";
import { circulationAction, CIRCULATORY_STATES } from "@/lib/resus/reference/circulation-catalog";
import {
  DISABILITY_FINDING_CODE_SET,
  DISABILITY_STATES,
  disabilityAction,
} from "@/lib/resus/reference/disability-catalog";
import {
  EXPOSURE_FINDING_CODE_SET,
  EXPOSURE_STATES,
  exposureAction,
} from "@/lib/resus/reference/exposure-catalog";
import { requireResusScope } from "@/lib/resus/scope";
import { RESUS_ROLES } from "@/lib/resus/types";
import { commitResusEvents } from "@/lib/resus/v2-record";
import { arrestCallTarget } from "@/lib/resus/v2-rules";
import { vitalsFromTriageSnapshot } from "@/lib/resus/vitals";
import { createServiceClient } from "@/lib/supabase/service";
import { loadHeader } from "./_v2/common";

/**
 * Resus server actions (GATE C). Decision-support: these RECORD what the
 * team does — they never order or auto-administer. Every write is
 * authorised by requireResusScope and audited in the record layer.
 */

const STEP_VALUES = ["pre", "A", "B", "C", "D", "E", "arrest"] as const;
const KIND_VALUES = [
  "assessment",
  "action",
  "drug",
  "fluid",
  "procedure",
  "vital",
  "decision",
  "role_change",
  "mobilisation",
  "reassessment",
  "arrest_detected",
  "cpr_started",
  "handover",
  "note",
] as const;

/** The triage-record fields needed to open + seed a resus. */
const TRIAGE_OPEN_SELECT = {
  id: triageRecords.id,
  intakeId: triageRecords.intakeId,
  patientUserId: triageRecords.patientUserId,
  departmentId: triageRecords.departmentId,
  assignedLevel: triageRecords.assignedLevel,
  fastTracked: triageRecords.lifeThreatFastTracked,
  breakdown: triageRecords.computedBreakdown,
  vitalsSnapshot: triageRecords.vitalsSnapshot,
  triagedAt: triageRecords.triagedAt,
};
type TriageOpenSource = {
  id: string;
  intakeId: string | null;
  patientUserId: string | null;
  departmentId: string | null;
  fastTracked: boolean;
  breakdown: unknown;
  vitalsSnapshot: unknown;
  triagedAt: Date;
};

/**
 * Open (or resume) a resus episode for a Red/L1 triage record, carry the
 * triage vitals in as the FIRST resus reading, fire team mobilisation,
 * and redirect to the desk. Shared by both triage entry points. Returns
 * only on error (success redirects).
 */
async function openResusForTriageRecord(
  scope: ResusScope,
  tr: TriageOpenSource,
  resusBase = "/nurse/resus",
): Promise<{ error: string }> {
  // Reuse an existing active episode for this triage record (idempotent open).
  const [existing] = await db
    .select({ id: resusEpisodes.id })
    .from(resusEpisodes)
    .where(and(eq(resusEpisodes.triageRecordId, tr.id), eq(resusEpisodes.state, "active")))
    .limit(1);
  if (existing) redirect(`${resusBase}/${existing.id}`);

  const reason = (tr.breakdown as { lifeThreatReason?: string })?.lifeThreatReason ?? null;
  const result = await openResusEpisode({
    scopeUserId: scope.userId,
    hospitalId: scope.hospitalId,
    departmentId: tr.departmentId ?? scope.departmentId,
    triageRecordId: tr.id,
    intakeId: tr.intakeId,
    patientUserId: tr.patientUserId,
    triggerKind: tr.fastTracked ? "step0_life_threat" : "triage_red",
    triggerReason: reason,
  });
  if ("error" in result) return { error: result.error };

  // Carry the triage vitals in as the first resus reading (best-effort;
  // recorded at the triage time so the trend starts where measurement did).
  const seed = vitalsFromTriageSnapshot(tr.vitalsSnapshot);
  if (seed) {
    const ev = await appendResusEvent({
      scopeUserId: scope.userId,
      episodeId: result.episodeId,
      kind: "vital",
      step: "C",
      payload: { label: "Vitals carried from triage", snapshot: seed, carriedFromTriage: true },
      recordedAt: tr.triagedAt.toISOString(),
    });
    if ("error" in ev) logger.warn("resus.open.seed_vitals_failed", { episode: result.episodeId });
  }

  // Resus Desk v2, scenario S0 (GATE A §1): rapid Red "no palpable pulse" opens
  // straight into the arrest — arrest #1 + CPR started, the arrest call, then
  // the desk. The reason string is rapid-red-button.tsx LIFE_THREATS[2] (a
  // client module, so it cannot be imported here). Best-effort: a failure
  // leaves a normal resus the team can declare the arrest in (one tap).
  if (resusDeskV2() && reason === "No palpable pulse / cardiac arrest") {
    const at = new Date();
    const arrest = await commitResusEvents({
      scopeUserId: scope.userId,
      hospitalId: scope.hospitalId,
      episodeId: result.episodeId,
      events: [
        {
          clientEventId: crypto.randomUUID(),
          recordedAt: at.toISOString(),
          kind: "arrest_detected",
          step: "arrest",
          arrestSeq: 1,
          payload: {
            arrestSeq: 1,
            reason,
            source: "triage_rapid_red",
            witnessed: null,
            monitored: null,
            label: `Cardiac arrest — ${reason} (rapid Red at triage)`,
          },
        },
        {
          clientEventId: crypto.randomUUID(),
          recordedAt: at.toISOString(),
          kind: "cpr_started",
          step: "arrest",
          arrestSeq: 1,
          payload: { arrestSeq: 1, label: "CPR started" },
        },
      ],
      header: { phase: "arrest", currentArrestSeq: 1, arrestDetectedAt: at },
      audit: {
        action: "detect_resus_arrest",
        reason: `Arrest #1: ${reason} (rapid Red at triage)`,
      },
    });
    if (arrest.ok) {
      // The call names the episode's department (where the patient is), as declareArrestV2 does.
      const header = await loadHeader(scope, result.episodeId);
      await sendArrestCall({
        service: createServiceClient(),
        episodeId: result.episodeId,
        hospitalId: scope.hospitalId,
        ...arrestCallTarget(
          header ?? { departmentId: tr.departmentId ?? scope.departmentId, departmentName: null },
        ),
        arrestSeq: 1,
      });
    } else {
      logger.warn("resus.open.s0_arrest_failed", { episode: result.episodeId });
    }
  }

  // Fire team mobilisation (recognition → call → response).
  await mobiliseResusTeam({
    service: createServiceClient(),
    episodeId: result.episodeId,
    hospitalId: scope.hospitalId,
    departmentId: tr.departmentId ?? scope.departmentId,
    patientLabel: tr.patientUserId ? "a Red/L1 patient" : "an unidentified patient",
    triggerReason: reason,
  }).catch((e) => logger.warn("resus.open.mobilise_failed", { reason: String(e) }));

  revalidatePath(resusBase);
  redirect(`${resusBase}/${result.episodeId}`);
}

/** Open a resus from a specific triage record (the resus board path). */
export async function openResusFromTriage(
  triageRecordId: string,
  resusBase = "/nurse/resus",
): Promise<{ error: string }> {
  const parsed = z.string().uuid().safeParse(triageRecordId);
  if (!parsed.success) return { error: "Invalid triage record." };
  const scope = await requireResusScope();

  const [tr] = await db
    .select(TRIAGE_OPEN_SELECT)
    .from(triageRecords)
    .where(and(eq(triageRecords.id, parsed.data), eq(triageRecords.hospitalId, scope.hospitalId)))
    .limit(1);
  if (!tr) return { error: "Triage record not found in your hospital." };

  return openResusForTriageRecord(scope, tr, resusBase);
}

/**
 * Open a resus straight from the triage board for an intake — resolves
 * the latest Red/L1 triage record for that patient. Returns an error if
 * the patient has no resus-level triage.
 */
export async function openResusFromIntake(
  intakeId: string,
  resusBase = "/nurse/resus",
): Promise<{ error: string }> {
  const parsed = z.string().uuid().safeParse(intakeId);
  if (!parsed.success) return { error: "Invalid intake." };
  const scope = await requireResusScope();

  const [tr] = await db
    .select(TRIAGE_OPEN_SELECT)
    .from(triageRecords)
    .where(
      and(
        eq(triageRecords.intakeId, parsed.data),
        eq(triageRecords.hospitalId, scope.hospitalId),
        eq(triageRecords.assignedLevel, 1),
      ),
    )
    .orderBy(desc(triageRecords.triagedAt))
    .limit(1);
  if (!tr) return { error: "This patient has no Red/L1 triage to open a resus from." };

  return openResusForTriageRecord(scope, tr, resusBase);
}

/** Open an ad-hoc resus for an in-resus deterioration (no triage record). */
export async function openBlankResus(resusBase = "/nurse/resus"): Promise<{ error: string }> {
  const scope = await requireResusScope();
  const result = await openResusEpisode({
    scopeUserId: scope.userId,
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    triggerKind: "in_resus_deterioration",
    triggerReason: "Opened directly (in-resus deterioration / unlinked)",
  });
  if ("error" in result) return { error: result.error };
  await mobiliseResusTeam({
    service: createServiceClient(),
    episodeId: result.episodeId,
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    patientLabel: "a patient",
    triggerReason: "in-resus deterioration",
  }).catch((e) => logger.warn("resus.open.mobilise_failed", { reason: String(e) }));
  revalidatePath(resusBase);
  redirect(`${resusBase}/${result.episodeId}`);
}

const LogSchema = z.object({
  episodeId: z.string().uuid(),
  kind: z.enum(KIND_VALUES),
  step: z.enum(STEP_VALUES).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  narrative: z.string().max(2000).nullable().optional(),
});

export async function logResusEvent(
  input: z.infer<typeof LogSchema>,
): Promise<{ ok?: true; eventId?: string; error?: string }> {
  const parsed = LogSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid resus event." };
  const scope = await requireResusScope();

  const result = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: parsed.data.kind as ResusEventKind,
    step: (parsed.data.step ?? null) as AbcdeStep | null,
    payload: parsed.data.payload ?? {},
    narrative: parsed.data.narrative ?? null,
  });
  if ("error" in result) return { error: result.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true, eventId: result.eventId };
}

const CorrectSchema = LogSchema.extend({ supersedesEventId: z.string().uuid() });

export async function correctResusEvent(
  input: z.infer<typeof CorrectSchema>,
): Promise<{ ok?: true; eventId?: string; error?: string }> {
  const parsed = CorrectSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid correction." };
  const scope = await requireResusScope();

  const result = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: parsed.data.kind as ResusEventKind,
    step: (parsed.data.step ?? null) as AbcdeStep | null,
    payload: parsed.data.payload ?? {},
    narrative: parsed.data.narrative ?? null,
    supersedesEventId: parsed.data.supersedesEventId,
  });
  if ("error" in result) return { error: result.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true, eventId: result.eventId };
}

const VitalsSchema = z.object({
  episodeId: z.string().uuid(),
  snapshot: z.object({
    hr: z.number().nullable().optional(),
    rr: z.number().nullable().optional(),
    spo2: z.number().nullable().optional(),
    systolicBp: z.number().nullable().optional(),
    diastolicBp: z.number().nullable().optional(),
    temperature: z.number().nullable().optional(),
    glucose: z.number().nullable().optional(),
    gcs: z.number().nullable().optional(),
    etco2: z.number().nullable().optional(),
    urineOutput: z.number().nullable().optional(),
    consciousness: z.enum(["A", "C", "V", "P", "U"]).nullable().optional(),
    oxygen: z.enum(["air", "oxygen"]).nullable().optional(),
  }),
});

/** Map a snapshot to clinical_observations rows (longitudinal mirror). */
function observationRows(
  snap: z.infer<typeof VitalsSchema>["snapshot"],
  base: { hospital_id: string; patient_user_id: string; recorded_by_user_id: string },
) {
  const rows: Record<string, unknown>[] = [];
  const push = (kind: string, v1: number | null | undefined, unit: string) => {
    if (v1 == null) return;
    rows.push({
      ...base,
      observation_kind: kind,
      numeric_value_1: v1,
      numeric_value_2: null,
      unit,
    });
  };
  push("hr", snap.hr, "/min");
  push("rr", snap.rr, "/min");
  push("spo2", snap.spo2, "%");
  if (snap.systolicBp != null || snap.diastolicBp != null)
    rows.push({
      ...base,
      observation_kind: "bp",
      numeric_value_1: snap.systolicBp ?? null,
      numeric_value_2: snap.diastolicBp ?? null,
      unit: "mmHg",
    });
  push("temperature", snap.temperature, "°C");
  push("glucose", snap.glucose, "mmol/L");
  push("gcs", snap.gcs, "/15");
  push("etco2", snap.etco2, "kPa");
  push("urine_output", snap.urineOutput, "mL");
  return rows;
}

export async function logResusVitals(
  input: z.infer<typeof VitalsSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = VitalsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid vitals." };
  const scope = await requireResusScope();

  const [ep] = await db
    .select({ patientUserId: resusEpisodes.patientUserId, hospitalId: resusEpisodes.hospitalId })
    .from(resusEpisodes)
    .where(
      and(
        eq(resusEpisodes.id, parsed.data.episodeId),
        eq(resusEpisodes.hospitalId, scope.hospitalId),
      ),
    )
    .limit(1);
  if (!ep) return { error: "Resus episode not found." };

  const snap = parsed.data.snapshot;
  const recorded = Object.entries(snap)
    .filter(([, v]) => v != null)
    .map(([k]) => k);
  if (recorded.length === 0) return { error: "Enter at least one vital." };

  // Primary, immutable record: a resus timeline 'vital' event.
  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: "vital",
    step: "C",
    payload: { label: `Vitals: ${recorded.join(", ")}`, snapshot: snap },
  });
  if ("error" in ev) return { error: ev.error };

  // Best-effort mirror into the longitudinal vitals store (only when the
  // patient is identified — clinical_observations is patient-keyed).
  if (ep.patientUserId) {
    try {
      const rows = observationRows(snap, {
        hospital_id: ep.hospitalId,
        patient_user_id: ep.patientUserId,
        recorded_by_user_id: scope.userId,
      });
      if (rows.length > 0) {
        const { createServiceClient } = await import("@/lib/supabase/service");
        const service = createServiceClient();
        await service.from("clinical_observations").insert(rows);
        await service.from("sa_audit_log").insert({
          actor_id: scope.userId,
          action: "record_observation",
          target_kind: "resus_episode",
          target_id: parsed.data.episodeId,
          reason: `Resus vitals mirrored to record: ${recorded.join(", ")}`,
          before_data: null,
          after_data: { kinds: recorded },
        });
      }
    } catch (e) {
      logger.warn("resus.vitals.observation_mirror_failed", { reason: String(e) });
    }
  }

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

/* ─── Airway step (A) — findings (GATE B) ───────────────────────────── */

const AirwayFindingsSchema = z.object({
  episodeId: z.string().uuid(),
  findingSet: z.object({
    patency: z.enum(AIRWAY_PATENCY).nullable(),
    present: z.array(z.string().max(64)).max(40),
    difficulty: z.array(z.string().max(64)).max(20),
    context: z
      .object({
        trauma: z.boolean().optional(),
        allergenTrigger: z.boolean().optional(),
        noSignsOfLife: z.boolean().optional(),
        gagPresent: z.boolean().optional(),
      })
      .optional(),
  }),
});

/**
 * Record an airway finding-set (assessment) onto the immutable timeline.
 * Reassessment appends a new event; the latest is current. The classified
 * airway-state is stored alongside for the medico-legal record.
 */
export async function recordAirwayFindings(
  input: z.infer<typeof AirwayFindingsSchema>,
): Promise<{ ok?: true; airwayState?: string | null; error?: string }> {
  const parsed = AirwayFindingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid airway findings." };
  const scope = await requireResusScope();

  const findingSet = { ...parsed.data.findingSet, context: parsed.data.findingSet.context ?? {} };
  const state = classifyAirway(findingSet);

  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: "assessment",
    step: "A",
    payload: {
      airway: findingSet,
      airwayState: state,
      label: `Airway findings${state ? ` → ${state.replace(/_/g, " ")}` : ""}`,
      danger:
        state === "completely_obstructed" ||
        state === "apnoeic_arrest" ||
        state === "threatened" ||
        state === "partially_obstructed",
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true, airwayState: state };
}

const AirwayActionStateSchema = z.object({
  episodeId: z.string().uuid(),
  /** Stable id for this action instance (client-generated; same id across state changes). */
  actionId: z.string().min(1).max(64),
  actionCode: z.string().max(64),
  state: z.enum(AIRWAY_ACTION_STATES),
  reason: z.string().max(500).optional(),
});

/**
 * Record an airway action's state (indicated → in_progress → performed /
 * failed / deferred / not_indicated) onto the timeline. Decision-support:
 * the clinician performs/confirms; the app records. A `failed` state is
 * what the UI uses to surface the next-tier escalation (the DAS ladder).
 */
export async function setAirwayActionState(
  input: z.infer<typeof AirwayActionStateSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = AirwayActionStateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid airway action." };
  const action = airwayAction(parsed.data.actionCode);
  if (!action) return { error: "Unknown airway action." };
  const scope = await requireResusScope();

  const kind: ResusEventKind = action.doseId ? "drug" : action.tier === 3 ? "procedure" : "action";
  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind,
    step: "A",
    payload: {
      actionId: parsed.data.actionId,
      actionCode: action.code,
      tier: action.tier,
      state: parsed.data.state,
      doseId: action.doseId ?? null,
      reason: parsed.data.reason ?? null,
      label: `${action.label} — ${parsed.data.state.replace(/_/g, " ")}`,
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

/* ─── Breathing step (B) — findings (GATE B) ────────────────────────── */

const BreathingFindingsSchema = z.object({
  episodeId: z.string().uuid(),
  findingSet: z.object({
    state: z.enum(BREATHING_STATES).nullable(),
    present: z.array(z.string().max(64)).max(48),
    context: z
      .object({
        trauma: z.boolean().optional(),
        allergenTrigger: z.boolean().optional(),
        knownAsthma: z.boolean().optional(),
        copdRisk: z.boolean().optional(),
        peSuspected: z.boolean().optional(),
        noSignsOfLife: z.boolean().optional(),
      })
      .optional(),
  }),
});

/**
 * Record a breathing finding-set (assessment) onto the immutable timeline.
 * Reassessment appends a new event; the latest is current. The classified
 * breathing-state is stored alongside for the medico-legal record.
 */
export async function recordBreathingFindings(
  input: z.infer<typeof BreathingFindingsSchema>,
): Promise<{ ok?: true; breathingState?: string | null; error?: string }> {
  const parsed = BreathingFindingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid breathing findings." };
  const scope = await requireResusScope();

  const findingSet = { ...parsed.data.findingSet, context: parsed.data.findingSet.context ?? {} };
  const state = classifyBreathing(findingSet);

  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: "assessment",
    step: "B",
    payload: {
      breathing: findingSet,
      breathingState: state,
      label: `Breathing findings${state ? ` → ${state.replace(/_/g, " ")}` : ""}`,
      danger: state === "apnoeic" || state === "peri_arrest" || state === "failure_decompensating",
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true, breathingState: state };
}

const BreathingActionStateSchema = z.object({
  episodeId: z.string().uuid(),
  /** Stable id for this action instance (client-generated; same id across state changes). */
  actionId: z.string().min(1).max(64),
  actionCode: z.string().max(64),
  state: z.enum(BREATHING_ACTION_STATES),
  reason: z.string().max(500).optional(),
});

/**
 * Record a breathing action's state (indicated → in_progress → performed /
 * failed / deferred / not_indicated) onto the timeline. Decision-support:
 * the clinician performs/confirms; the app records. A `failed` state is what
 * the UI uses to surface the next-step escalation.
 */
export async function setBreathingActionState(
  input: z.infer<typeof BreathingActionStateSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = BreathingActionStateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid breathing action." };
  const action = breathingAction(parsed.data.actionCode);
  if (!action) return { error: "Unknown breathing action." };
  const scope = await requireResusScope();

  const kind: ResusEventKind = action.doseId ? "drug" : action.tier === 3 ? "procedure" : "action";
  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind,
    step: "B",
    payload: {
      actionId: parsed.data.actionId,
      actionCode: action.code,
      tier: action.tier,
      state: parsed.data.state,
      doseId: action.doseId ?? null,
      reason: parsed.data.reason ?? null,
      label: `${action.label} — ${parsed.data.state.replace(/_/g, " ")}`,
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

/* ─── Circulation step (C) — findings (GATE B) ──────────────────────── */

const CirculationFindingsSchema = z.object({
  episodeId: z.string().uuid(),
  findingSet: z.object({
    state: z.enum(CIRCULATORY_STATES).nullable(),
    present: z.array(z.string().max(64)).max(60),
    context: z
      .object({
        trauma: z.boolean().optional(),
        activeBleeding: z.boolean().optional(),
        febrileChild: z.boolean().optional(),
        pregnancyPossible: z.boolean().optional(),
        spinalInjury: z.boolean().optional(),
        allergenTrigger: z.boolean().optional(),
        headInjury: z.boolean().optional(),
        noPulse: z.boolean().optional(),
      })
      .optional(),
  }),
});

/**
 * Record a circulation finding-set (assessment) onto the immutable timeline.
 * Reassessment appends a new event; the latest is current. The classified
 * circulatory-state AND the identified shock type are stored alongside for the
 * medico-legal record (and to drive the type-specific actions in GATE C).
 */
export async function recordCirculationFindings(
  input: z.infer<typeof CirculationFindingsSchema>,
): Promise<{
  ok?: true;
  circulatoryState?: string | null;
  shockType?: string | null;
  error?: string;
}> {
  const parsed = CirculationFindingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid circulation findings." };
  const scope = await requireResusScope();

  const findingSet = { ...parsed.data.findingSet, context: parsed.data.findingSet.context ?? {} };
  const state = classifyCirculation(findingSet);
  const shockType = identifyShockType(findingSet);

  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: "assessment",
    step: "C",
    payload: {
      circulation: findingSet,
      circulatoryState: state,
      shockType,
      label: `Circulation findings${state ? ` → ${state.replace(/_/g, " ")}` : ""}${shockType ? ` (${shockType.replace(/_/g, " ")})` : ""}`,
      danger: state === "arrest" || state === "peri_arrest" || state === "decompensated_shock",
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true, circulatoryState: state, shockType };
}

const CirculationActionStateSchema = z.object({
  episodeId: z.string().uuid(),
  actionId: z.string().min(1).max(64),
  actionCode: z.string().max(64),
  state: z.enum(CIRCULATION_ACTION_STATES),
  reason: z.string().max(500).optional(),
});

/**
 * Record a circulation action's state (indicated → in_progress → performed /
 * failed / deferred / not_indicated) onto the timeline. Decision-support: the
 * clinician performs/confirms; the app records. Circulation DRUGS are recorded
 * via the prescribing tool (recordEmergencyAdministration); this records the
 * action/procedure state (access, haemorrhage control, decompression, etc.).
 */
export async function setCirculationActionState(
  input: z.infer<typeof CirculationActionStateSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = CirculationActionStateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid circulation action." };
  const action = circulationAction(parsed.data.actionCode);
  if (!action) return { error: "Unknown circulation action." };
  const scope = await requireResusScope();

  const kind: ResusEventKind = action.tier === 3 ? "procedure" : "action";
  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind,
    step: "C",
    payload: {
      actionId: parsed.data.actionId,
      actionCode: action.code,
      tier: action.tier,
      state: parsed.data.state,
      reason: parsed.data.reason ?? null,
      label: `${action.label} — ${parsed.data.state.replace(/_/g, " ")}`,
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

/* ─── Disability (D) — findings + action-state (mirrors A/B/C) ──────── */

const DisabilityFindingsSchema = z.object({
  episodeId: z.string().uuid(),
  findingSet: z.object({
    state: z.enum(DISABILITY_STATES).nullable(),
    gcs: z
      .object({
        eye: z.number().int().min(1).max(4),
        verbal: z.number().int().min(1).max(5),
        motor: z.number().int().min(1).max(6),
        intubated: z.boolean().optional(),
      })
      .nullable(),
    avpu: z.enum(["A", "V", "P", "U"]).nullable(),
    glucoseMmol: z.number().min(0.5).max(100).nullable(),
    present: z
      .array(z.string().max(64))
      .max(60)
      .refine((codes) => codes.every((c) => DISABILITY_FINDING_CODE_SET.has(c)), {
        message: "Unknown disability finding code.",
      }),
    focalOnset: z.string().max(120).nullable().optional(),
    seizureDurationMin: z.number().min(0).max(600).nullable().optional(),
    context: z
      .object({
        opioidsSuspected: z.boolean().optional(),
        lowRespRate: z.boolean().optional(),
        pregnancyPostpartum: z.boolean().optional(),
        headInjury: z.boolean().optional(),
        alcoholMalnourished: z.boolean().optional(),
        feverMeningism: z.boolean().optional(),
        abcAbnormal: z.boolean().optional(),
        noPulse: z.boolean().optional(),
      })
      .optional(),
  }),
});

/**
 * Record a disability finding-set (assessment) onto the immutable timeline.
 * Reassessment appends a new event (the serial-GCS trend is the record). The
 * classified neuro-state, the suspected neuro-syndrome, the GCS total, and the
 * mandatory-glucose flag are stored alongside for the medico-legal record (and
 * to drive the syndrome-specific actions).
 */
export async function recordDisabilityFindings(
  input: z.infer<typeof DisabilityFindingsSchema>,
): Promise<{
  ok?: true;
  neuroState?: string | null;
  suspectedCause?: string | null;
  gcsTotal?: number | null;
  error?: string;
}> {
  const parsed = DisabilityFindingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid disability findings." };
  const scope = await requireResusScope();

  const findingSet = { ...parsed.data.findingSet, context: parsed.data.findingSet.context ?? {} };
  const state = classifyDisability(findingSet);
  const suspectedCause = identifyNeuroSyndrome(findingSet);
  const total = gcsTotal(findingSet.gcs);
  const glucoseMissing = mandatoryGlucoseMissing(findingSet);

  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: "assessment",
    step: "D",
    payload: {
      disability: findingSet,
      neuroState: state,
      suspectedCause,
      gcsTotal: total,
      mandatoryGlucoseMissing: glucoseMissing,
      label: `Disability findings${state ? ` → ${state.replace(/_/g, " ")}` : ""}${total != null ? ` (GCS ${total})` : ""}${glucoseMissing ? " — ⚠ glucose not checked" : ""}`,
      danger:
        state === "raised_icp_herniation" ||
        state === "active_seizure_status" ||
        state === "severe_impairment_coma",
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true, neuroState: state, suspectedCause, gcsTotal: total };
}

const DisabilityActionStateSchema = z.object({
  episodeId: z.string().uuid(),
  actionId: z.string().min(1).max(64),
  actionCode: z.string().max(64),
  state: z.enum(DISABILITY_ACTION_STATES),
  reason: z.string().max(500).optional(),
});

/**
 * Record a disability action's state onto the timeline. Decision-support: the
 * clinician performs/confirms; the app records. Disability DRUGS are recorded
 * via the prescribing tool (recordEmergencyAdministration); this records the
 * action/procedure state (check-glucose, back-to-A, neurosurgery referral, etc.).
 */
export async function setDisabilityActionState(
  input: z.infer<typeof DisabilityActionStateSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = DisabilityActionStateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid disability action." };
  const action = disabilityAction(parsed.data.actionCode);
  if (!action) return { error: "Unknown disability action." };
  const scope = await requireResusScope();

  const kind: ResusEventKind = action.tier === 3 ? "procedure" : "action";
  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind,
    step: "D",
    payload: {
      actionId: parsed.data.actionId,
      actionCode: action.code,
      tier: action.tier,
      state: parsed.data.state,
      reason: parsed.data.reason ?? null,
      label: `${action.label} — ${parsed.data.state.replace(/_/g, " ")}`,
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

/* ─── Exposure (E) — findings + action-state + the return-to-A loop ──── */

const ExposureFindingsSchema = z.object({
  episodeId: z.string().uuid(),
  findingSet: z.object({
    state: z.enum(EXPOSURE_STATES).nullable(),
    present: z
      .array(z.string().max(64))
      .max(60)
      .refine((codes) => codes.every((c) => EXPOSURE_FINDING_CODE_SET.has(c)), {
        message: "Unknown exposure finding code.",
      }),
    coreTempC: z.number().min(8).max(45).nullable(),
    ample: z
      .object({
        allergies: z.array(z.string().max(80)).max(30),
        medications: z.string().max(500).optional(),
        past: z.string().max(500).optional(),
        lastMeal: z.string().max(200).optional(),
        events: z.string().max(500).optional(),
      })
      .nullable()
      .optional(),
    context: z
      .object({
        trauma: z.boolean().optional(),
        exposureEnvironment: z.boolean().optional(),
        serotonergicOrNeuroleptic: z.boolean().optional(),
        notRecovered: z.boolean().optional(),
        noPulse: z.boolean().optional(),
      })
      .optional(),
  }),
});

/**
 * Record an exposure finding-set (assessment) onto the immutable timeline.
 * Reassessment appends a new event; the latest is current. The classified
 * exposure-state, the suspected diagnosis, and the temperature stage are stored
 * alongside for the medico-legal record (and to drive the actions).
 */
export async function recordExposureFindings(
  input: z.infer<typeof ExposureFindingsSchema>,
): Promise<{
  ok?: true;
  exposureState?: string | null;
  suspectedDiagnosis?: string | null;
  tempStage?: string | null;
  error?: string;
}> {
  const parsed = ExposureFindingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid exposure findings." };
  const scope = await requireResusScope();

  const findingSet = { ...parsed.data.findingSet, context: parsed.data.findingSet.context ?? {} };
  const state = classifyExposure(findingSet);
  const diagnosis = identifyExposureDiagnosis(findingSet);
  const stage = tempStage(findingSet.coreTempC);

  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: "assessment",
    step: "E",
    payload: {
      exposure: findingSet,
      exposureState: state,
      suspectedDiagnosis: diagnosis,
      tempStage: stage,
      label: `Exposure findings${state ? ` → ${state.replace(/_/g, " ")}` : ""}${findingSet.coreTempC != null ? ` (${findingSet.coreTempC} °C)` : ""}`,
      danger: state === "critical_finding" || state === "temperature_extreme",
    },
  });
  if ("error" in ev) return { error: ev.error };

  // AMPLE allergies feed the prescribe-time allergy check + the record.
  const allergies = parsed.data.findingSet.ample?.allergies ?? [];
  if (allergies.length > 0) {
    const capture = { substances: allergies, nkda: false };
    const note = await appendResusEvent({
      scopeUserId: scope.userId,
      episodeId: parsed.data.episodeId,
      kind: "note",
      step: null,
      payload: {
        allergyCapture: capture,
        label: `Allergies (AMPLE): ${allergies.join(", ")}`,
      },
    });
    if ("eventId" in note)
      await captureToRecord(scope, parsed.data.episodeId, note.eventId, capture);
  }

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true, exposureState: state, suspectedDiagnosis: diagnosis, tempStage: stage };
}

const ExposureActionStateSchema = z.object({
  episodeId: z.string().uuid(),
  actionId: z.string().min(1).max(64),
  actionCode: z.string().max(64),
  state: z.enum(EXPOSURE_ACTION_STATES),
  reason: z.string().max(500).optional(),
});

/**
 * Record an exposure action's state onto the timeline. Decision-support: the
 * clinician performs/confirms; the app records. Exposure DRUGS are recorded via
 * the prescribing tool (recordEmergencyAdministration); this records the
 * action/procedure state (expose, measure-temp, re-cover, log-roll, rewarming,
 * the return-to-A loop, etc.).
 */
export async function setExposureActionState(
  input: z.infer<typeof ExposureActionStateSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = ExposureActionStateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid exposure action." };
  const action = exposureAction(parsed.data.actionCode);
  if (!action) return { error: "Unknown exposure action." };
  const scope = await requireResusScope();

  const kind: ResusEventKind = action.tier === 3 ? "procedure" : "action";
  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind,
    step: "E",
    payload: {
      actionId: parsed.data.actionId,
      actionCode: action.code,
      tier: action.tier,
      state: parsed.data.state,
      reason: parsed.data.reason ?? null,
      label: `${action.label} — ${parsed.data.state.replace(/_/g, " ")}`,
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

/**
 * Close the primary-survey loop — record the "return to A and reassess" event.
 * E is not a dead-end; the ABCDE cycles. Decision-support: the clinician chooses
 * to cycle; the desk navigates back to A.
 */
export async function recordResusReturnToA(input: {
  episodeId: string;
}): Promise<{ ok?: true; error?: string }> {
  const parsed = z.object({ episodeId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Invalid episode." };
  const scope = await requireResusScope();

  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: "reassessment",
    step: "A",
    payload: {
      returnToA: true,
      label: "Primary survey complete → returning to A (reassess — the ABCDE cycles)",
    },
  });
  if ("error" in ev) return { error: ev.error };

  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

/* ─── Smart prescribing — emergency administration (grab-and-give) ───── */

const ResusAllergiesSchema = z.object({
  episodeId: z.string().uuid(),
  substances: z.array(z.string().max(80)).max(30),
  nkda: z.boolean().optional(),
});

/**
 * Capture the patient's drug allergies onto the immutable timeline (in-episode
 * source for the prescribe-time allergy check, until the persistent cross-
 * encounter allergies table lands). Decision-support: surfaced before confirm.
 */
export async function recordResusAllergies(
  input: z.infer<typeof ResusAllergiesSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = ResusAllergiesSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid allergies." };
  const scope = await requireResusScope();
  const nkda = parsed.data.nkda ?? parsed.data.substances.length === 0;
  const capture = { substances: nkda ? [] : parsed.data.substances, nkda };

  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: "note",
    step: null,
    payload: {
      allergyCapture: capture,
      label: nkda
        ? "Allergies: none known (NKDA)"
        : `Allergies: ${parsed.data.substances.join(", ")}`,
    },
  });
  if ("error" in ev) return { error: ev.error };
  await captureToRecord(scope, parsed.data.episodeId, ev.eventId, capture);
  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

const PrescriptionEditSchema = z.object({
  field: z.string().max(24),
  from: z.string().max(160),
  to: z.string().max(160),
});

const EmergencyAdminSchema = z.object({
  episodeId: z.string().uuid(),
  drugId: z.string().max(64),
  route: z.string().max(24).optional(),
  amountMg: z.number().nonnegative().optional(),
  cart: z.string().max(48).optional(),
  witnessUserId: z.string().uuid().optional(),
  /** Free-text witnessing-clinician name (controlled drugs) — captured at the
   *  bedside; either this or a resolved witnessUserId satisfies the witness. */
  witnessName: z.string().max(120).optional(),
  /** Required when a `block` safety flag was overridden (recorded + audited). */
  overrideReason: z.string().max(500).optional(),
  overriddenFlags: z.array(z.string().max(40)).max(10).optional(),
  // ── Editable parameters (addendum) — the prescriber's adjusted values + the
  //    field-level edit log. The EDITED values are recorded (not the default). ──
  dose: z.string().max(120).optional(),
  concentration: z.string().max(160).optional(),
  interval: z.string().max(120).optional(),
  duration: z.string().max(120).optional(),
  volume: z.string().max(60).optional(),
  rate: z.string().max(60).optional(),
  prn: z.boolean().optional(),
  startTime: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
  edits: z.array(PrescriptionEditSchema).max(20).optional(),
});

/**
 * Record an emergency drug administration (the prescription IS the
 * administration — grab-and-give) onto the immutable, audited resus timeline,
 * with the full accountability + pharmacy-reconciliation payload (drug, dose,
 * concentration, route, giver, time, patient, encounter, cart, amount,
 * controlled-flag, override). Decision-support: the clinician has confirmed;
 * the app records. Never auto-administers.
 */
export async function recordEmergencyAdministration(
  input: z.infer<typeof EmergencyAdminSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = EmergencyAdminSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid administration." };
  const drug = getEmergencyDrug(parsed.data.drugId);
  if (!drug) return { error: "Unknown drug." };
  const scope = await requireResusScope();

  // Controlled drugs require a witness even in an emergency (stricter capture) —
  // a resolved user id OR a bedside-captured witness name satisfies it.
  if (drug.controlled && !parsed.data.witnessUserId && !parsed.data.witnessName?.trim())
    return { error: "Controlled drug — a witness is required." };

  // Server re-check of the allergy block (Phase 0 safety finding): the record's allergies plus
  // this episode's captures, whatever the client sent. A failed record read never blocks a
  // grab-and-give (the dialog already showed "could not be loaded"); it is recorded instead.
  const ep = await fetchResusEpisode({
    episodeId: parsed.data.episodeId,
    hospitalId: scope.hospitalId,
  });
  if (!ep) return { error: "Episode not found." };
  let recordAllergies: string[] = [];
  let allergyRecord: "checked" | "unavailable" | "not_read" = "not_read";
  if (ep.patientUserId && encounterEngineLive()) {
    try {
      recordAllergies = (await recordAllergiesFor(ep.patientUserId)).allergies;
      allergyRecord = "checked";
    } catch (e) {
      logger.error("resus.administration.allergy_record_unavailable", {
        episode: parsed.data.episodeId,
        reason: (e as Error).message,
      });
      allergyRecord = "unavailable";
    }
  }
  const recheck = allergyRecheck(
    drug,
    mergeAllergyLists(
      recordedAllergiesFromTimeline(await fetchResusTimeline(parsed.data.episodeId)),
      recordAllergies,
    ),
    parsed.data.overrideReason,
  );
  if (recheck.refusal) return { error: recheck.refusal };
  const overriddenFlags = parsed.data.overriddenFlags ?? [];
  if (recheck.matched && !overriddenFlags.includes("allergy")) overriddenFlags.push("allergy");

  const step: AbcdeStep | null =
    drug.abcdeStep === "cross_cutting" ? "B" : (drug.abcdeStep as AbcdeStep);

  // The guideline DEFAULTS (catalog) + the EDITED values (prescriber). Both are
  // recorded so any deviation is visible, not hidden (addendum A2/A4).
  const defaultDose = drug.adult?.dose ?? (drug.recordOnly ? "operator-dosed (record-only)" : "—");
  const defaultConcentration = drug.adult?.concentration ?? null;
  const defaultRoute = drug.adult?.route[0] ?? null;
  const defaultInterval = drug.adult?.interval ?? null;
  const route = parsed.data.route ?? defaultRoute;
  const dose = parsed.data.dose ?? defaultDose;
  const concentration = parsed.data.concentration ?? defaultConcentration;
  const edits = parsed.data.edits ?? [];
  const edited = edits.length > 0;

  // Attribute the giver's prescribing authority (cosign policy), re-resolved
  // server-side — NOT trusted from the client. In an emergency this never
  // blocks (grab-and-give); it records whether the giver is an authorised
  // prescriber for this drug kind, or administered under the resus protocol.
  const caps = await resolveCapabilities({
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    cadreCode: scope.cadreCode,
  });
  const prescribeAuthority = drug.controlled
    ? caps.prescription_controlled
    : caps.prescription_routine;

  const ev = await appendResusEvent({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    kind: "drug",
    step,
    payload: {
      prescribing: {
        drugId: drug.id,
        drugKey: drug.drugKey,
        drugName: drug.name,
        dose,
        concentration,
        route,
        interval: parsed.data.interval ?? defaultInterval,
        duration: parsed.data.duration ?? null,
        volume: parsed.data.volume ?? null,
        rate: parsed.data.rate ?? null,
        prn: parsed.data.prn ?? false,
        startTime: parsed.data.startTime ?? null,
        notes: parsed.data.notes ?? null,
        indication: drug.indications[0] ?? null,
        amountMg: parsed.data.amountMg ?? drug.unitDoseMg ?? null,
        cart: parsed.data.cart ?? null,
        giverUserId: scope.userId,
        giverCadre: scope.cadreCode,
        prescribeAuthority,
        underResusProtocol: prescribeAuthority !== "allowed",
        witnessUserId: parsed.data.witnessUserId ?? null,
        witnessName: parsed.data.witnessName ?? null,
        controlled: drug.controlled,
        overrideReason: parsed.data.overrideReason ?? null,
        overriddenFlags,
        allergyRecord,
        // Edit provenance — the guideline default, the edited values, + the log.
        edited,
        edits,
        default: {
          dose: defaultDose,
          concentration: defaultConcentration,
          route: defaultRoute,
          interval: defaultInterval,
        },
        source: drug.source,
      },
      state: "performed",
      dose: concentration ? `${dose} (${concentration})` : dose,
      label: `${drug.name} ${dose}${route ? ` ${route.toUpperCase()}` : ""} — administered${edited ? " (edited)" : ""}`,
    },
  });
  if ("error" in ev) return { error: ev.error };
  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

/* ─── Team roles, responders, arrest (GATE E) ───────────────────────── */

const AssignRoleSchema = z.object({
  episodeId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(RESUS_ROLES),
});

export async function assignResusRoleAction(
  input: z.infer<typeof AssignRoleSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = AssignRoleSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid role assignment." };
  const scope = await requireResusScope();
  const result = await assignResusRole({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    userId: parsed.data.userId,
    role: parsed.data.role as ResusRole,
  });
  if ("error" in result) return { error: result.error };
  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  return { ok: true };
}

/** Claim a role for yourself (open assignment) — the common bedside case. */
export async function claimResusRoleAction(input: {
  episodeId: string;
  role: ResusRole;
}): Promise<{ ok?: true; error?: string }> {
  const scope = await requireResusScope();
  return assignResusRoleAction({
    episodeId: input.episodeId,
    userId: scope.userId,
    role: input.role,
  });
}

export async function acknowledgeResusAlertAction(
  episodeId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!z.string().uuid().safeParse(episodeId).success) return { error: "Invalid episode." };
  const scope = await requireResusScope();
  const result = await acknowledgeResusAlert({ scopeUserId: scope.userId, episodeId });
  if ("error" in result) return { error: result.error };
  revalidatePath(`/nurse/resus/${episodeId}`);
  return { ok: true };
}

const ArrestSchema = z.object({
  episodeId: z.string().uuid(),
  responsive: z.boolean().nullable().optional(),
  breathingNormally: z.boolean().nullable().optional(),
  centralPulse: z.boolean().nullable().optional(),
});

/**
 * Detect arrest → flag the episode + log arrest/CPR events + route to the
 * ALS module (stub). Builds NO arrest algorithm. Returns isArrest so the UI
 * can surface the CPR prompt; if the signs do not meet the criterion it
 * records nothing and tells the caller why.
 */
export async function detectResusArrestAction(
  input: z.infer<typeof ArrestSchema>,
): Promise<{ ok?: true; isArrest?: boolean; reason?: string | null; error?: string }> {
  const parsed = ArrestSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid arrest check." };
  const scope = await requireResusScope();

  const verdict = detectArrest({
    responsive: parsed.data.responsive ?? null,
    breathingNormally: parsed.data.breathingNormally ?? null,
    centralPulse: parsed.data.centralPulse ?? null,
  });
  if (!verdict.isArrest) return { ok: true, isArrest: false, reason: verdict.reason };

  const result = await markResusArrest({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    reason: verdict.reason ?? "arrest criteria met",
  });
  if ("error" in result) return { error: result.error };
  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  revalidatePath("/nurse/resus");
  return { ok: true, isArrest: true, reason: verdict.reason };
}

const ConcludeSchema = z.object({
  episodeId: z.string().uuid(),
  state: z.enum(["concluded", "cancelled"]),
  disposition: z
    .enum(["theatre", "icu", "cath_lab", "ward", "mortuary", "transferred", "deceased"])
    .nullable()
    .optional(),
  outcome: z.string().max(1000).nullable().optional(),
});

export async function concludeResus(
  input: z.infer<typeof ConcludeSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = ConcludeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid conclusion." };
  const scope = await requireResusScope();

  const result = await concludeResusEpisode({
    scopeUserId: scope.userId,
    episodeId: parsed.data.episodeId,
    state: parsed.data.state,
    disposition: parsed.data.disposition ?? null,
    outcome: parsed.data.outcome ?? null,
  });
  if ("error" in result) {
    logger.warn("resus.conclude.failed", { episode: parsed.data.episodeId });
    return { error: result.error };
  }
  revalidatePath(`/nurse/resus/${parsed.data.episodeId}`);
  revalidatePath("/nurse/resus");
  return { ok: true };
}

/** R1: a v1 allergy capture (exposure AMPLE, the prescribe dialog) also lands on the allergy record. */
async function captureToRecord(
  scope: ResusScope,
  episodeId: string,
  noteId: string,
  capture: { substances: string[]; nkda: boolean },
): Promise<void> {
  const ep = await fetchResusEpisode({ episodeId, hospitalId: scope.hospitalId });
  await ampleNoteToRecord(scope, {
    patientUserId: ep?.patientUserId ?? null,
    episodeId,
    noteId,
    capture,
  });
}

/** The record's allergies for a patient, and whether the record says anything (listed or NKDA).
 *  Under EMR v1 that is `lib/emr/read/allergies.ts` (every hospital, backfilled resus captures from
 *  earlier episodes included); otherwise the legacy `patient_allergies` read, unchanged. Read as the
 *  owner: the resus scope has already authorised the episode. */
async function recordAllergiesFor(
  patientUserId: string,
): Promise<{ allergies: string[]; recorded: boolean }> {
  // Gated on 0071 being applied anywhere, not on this hospital: the allergy record crosses
  // hospitals (STOP 1), and the legacy table has no live writer.
  if (emrV1Live()) {
    const input = await loadAllergyInput(db as unknown as EmrDb, patientUserId);
    return {
      allergies: input.allergies,
      recorded: input.status.kind === "listed" || input.status.kind === "no_known_drug_allergies",
    };
  }
  const rows = await db
    .select({ substance: patientAllergies.substance })
    .from(patientAllergies)
    .where(eq(patientAllergies.patientUserId, patientUserId));
  const allergies = rows.map((r) => r.substance);
  return { allergies, recorded: allergies.length > 0 };
}

/**
 * Persistent (clerked) allergies for the episode's patient, unioned into the resus prescribing
 * safety check so a recorded allergy gates emergency prescribing (the kickoff's launch-blocker).
 *
 * Guarded by encounterEngineLive(): returns nothing WITHOUT querying until migration 0040 is
 * applied (the table doesn't exist before then). Authorised by the resus scope. A failed read
 * throws, so the dialog can say so instead of checking against an empty list.
 */
export async function loadPersistentAllergiesForEpisode(
  episodeId: string,
): Promise<{ allergies: string[]; recorded: boolean }> {
  if (!encounterEngineLive()) return { allergies: [], recorded: false };
  const scope = await requireResusScope();
  const ep = await fetchResusEpisode({ episodeId, hospitalId: scope.hospitalId });
  if (!ep?.patientUserId) return { allergies: [], recorded: false };
  return recordAllergiesFor(ep.patientUserId);
}
