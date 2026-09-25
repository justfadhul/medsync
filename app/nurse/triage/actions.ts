"use server";

import type { AssignableDoctor } from "@/lib/encounter/assignment";
import type { AcuityLevel, PregnancyStatus, TriageInput } from "@/lib/triage/types";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DOCTOR_CADRE_CODES } from "@/lib/doctor/scope";
import { assignDoctorFromIntake, listAssignableDoctors } from "@/lib/encounter/assignment";
import { encounterEngineLive } from "@/lib/encounter/feature";
import { logger } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";
import { runTriage } from "@/lib/triage/engine";
import { notifyTriageOutcome } from "@/lib/triage/notify";
import { requireTriageScope } from "@/lib/triage/scope";

/**
 * Triage server actions. The engine (lib/triage) is the ONE canonical
 * deterministic scorer — we run it here rather than duplicating ~700
 * lines of clinical logic into a Deno edge function (drift = a
 * clinical-safety hazard). Authority + audit are enforced here; the
 * triage_records RLS + row-change trigger are the DB backstop.
 *
 * Flow: authorise (requireTriageScope) → compute (runTriage) → apply
 * the clinician's confirm/override under authority (R1) → persist
 * (triage_records + denormalized intake/queue keys) → audit.
 */

const VitalsSchema = z.object({
  respiratoryRate: z.number().nullable(),
  spo2: z.number().nullable(),
  oxygen: z.enum(["air", "oxygen"]).nullable(),
  systolicBp: z.number().nullable(),
  diastolicBp: z.number().nullable(),
  pulse: z.number().nullable(),
  consciousness: z.enum(["A", "C", "V", "P", "U"]).nullable(),
  temperature: z.number().nullable(),
  bloodGlucose: z.number().nullable(),
});

const SubmitSchema = z.object({
  intake_id: z.string().uuid(),
  patient_user_id: z.string().uuid().nullable(),
  age_years: z.number().nullable(),
  pregnancy: z.enum(["pregnant", "postpartum_6wk", "not_pregnant", "unknown"]),
  reproductive_age_female: z.boolean(),
  spo2_scale2_enabled: z.boolean(),
  vitals: VitalsSchema,
  life_threat_flags: z.record(z.string(), z.boolean()).optional(),
  present_discriminators: z.array(z.string()).optional(),
  prior_level: z.number().int().min(1).max(5).nullable().optional(),
  baseline_temper_to: z.number().int().min(1).max(5).nullable().optional(),
  baseline_reason: z.string().max(500).optional(),
  /** The clinician's final assigned level (confirm or override). */
  assigned_level: z.number().int().min(1).max(5),
  override_reason: z.string().max(500).optional(),
  /**
   * Clinician decisions on the suggested next actions (GATE C). Recorded
   * with the triage record for QI + medico-legal trail. Suggestions
   * never auto-execute; this only captures accept/modify/dismiss.
   */
  recommendation_decisions: z
    .array(
      z.object({
        code: z.string().max(64),
        category: z.string().max(32),
        decision: z.enum(["pending", "accepted", "modified", "dismissed"]),
        note: z.string().max(500).optional(),
      }),
    )
    .max(40)
    .optional(),
});

export type TriageSubmitState = {
  ok?: boolean;
  error?: string;
  triageRecordId?: string;
  computedLevel?: number;
  assignedLevel?: number;
  /** The engine's first stated reason — the doctor workspace's result sheet says why. */
  why?: string | null;
  /** A Step-0 life threat: the sheet offers Open resus first. */
  lifeThreat?: boolean;
};

export async function submitTriageAction(
  _prev: TriageSubmitState,
  formData: FormData,
): Promise<TriageSubmitState> {
  // The form serializes the structured payload as one JSON field — the
  // vital set is nested, so a flat FormData parse would be lossy.
  const raw = formData.get("payload");
  if (typeof raw !== "string") return { error: "Missing triage payload." };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { error: "Malformed triage payload." };
  }
  const parsed = SubmitSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat().find(Boolean);
    return { error: first ?? "Please check the triage inputs." };
  }
  const input = parsed.data;

  // 1. Authorise — clinical cadre, this hospital, may triage.
  const scope = await requireTriageScope();

  // 2. Compute the deterministic engine result.
  const engineInput: TriageInput = {
    context: {
      ageYears: input.age_years,
      pregnancy: input.pregnancy as PregnancyStatus,
      reproductiveAgeFemale: input.reproductive_age_female,
      spo2Scale2Enabled: input.spo2_scale2_enabled,
    },
    vitals: input.vitals,
    lifeThreatFlags: input.life_threat_flags ?? {},
    presentDiscriminators: input.present_discriminators ?? [],
    adjustments: {
      priorLevel: (input.prior_level ?? null) as AcuityLevel | null,
      baselineAdjustment:
        input.baseline_temper_to != null
          ? {
              temperToLevel: input.baseline_temper_to as AcuityLevel,
              reason: input.baseline_reason ?? "Clinician baseline adjustment.",
            }
          : null,
    },
  };
  const result = runTriage(engineInput);
  const computedLevel = result.level;
  const assignedLevel = input.assigned_level as AcuityLevel;

  // 3. Authority check on the clinician's assigned level (R1). A
  //    down-assignment (less acute than computed) requires
  //    triage_downgrade authority AND a reason.
  const verdict = scope.authority.canAssignLevel(computedLevel, assignedLevel);
  if (!verdict.allowed) {
    return { error: verdict.reason ?? "You are not authorised to assign this level." };
  }
  if (verdict.direction === "down" && !input.override_reason?.trim()) {
    return { error: "A reason is required to assign a lower acuity than computed." };
  }

  // 4. Persist. Service client (RLS bypass) — caller already authorised.
  const service = createServiceClient();
  const { data: record, error: insErr } = await service
    .from("triage_records")
    .insert({
      intake_id: input.intake_id,
      patient_user_id: input.patient_user_id,
      hospital_id: scope.hospitalId,
      department_id: scope.departmentId,
      ruleset: result.ruleset,
      vitals_snapshot: input.vitals,
      computed_level: computedLevel,
      computed_score: result.news2?.total ?? null,
      computed_breakdown: {
        reasoning: result.reasoning,
        firedDiscriminators: result.firedDiscriminators,
        derived: result.derived,
        scoreAcuity: result.scoreAcuity,
        discriminatorAcuity: result.discriminatorAcuity,
        flags: result.flags,
        // Suggested next actions + the clinician's accept/modify/dismiss
        // (GATE C). Recorded here on the existing jsonb — no migration.
        // Suggestions never auto-execute; this is the decision trail only.
        recommendationDecisions: input.recommendation_decisions ?? [],
      },
      assigned_level: assignedLevel,
      override_direction: verdict.direction,
      override_reason: verdict.direction === "none" ? null : (input.override_reason ?? null),
      baseline_adjusted: result.baselineApplied,
      baseline_reason: result.baselineApplied ? (input.baseline_reason ?? null) : null,
      life_threat_fast_tracked: result.lifeThreat,
      provisional: result.provisional,
      triaged_by_user_id: scope.userId,
    })
    .select("id")
    .single();
  if (insErr || !record) {
    logger.error("triage.record.insert_failed", { reason: insErr?.message });
    return { error: "Could not save the triage record. Please try again." };
  }

  // 5. Denormalize onto the intake (board sort key) + advance status.
  const { error: intakeErr } = await service
    .from("patient_intakes")
    .update({
      triage_level: assignedLevel,
      triaged_at: new Date().toISOString(),
      status: "triaged",
    })
    .eq("id", input.intake_id);
  if (intakeErr) {
    logger.warn("triage.intake.update_failed", { reason: intakeErr.message });
  }

  // 6. Re-rank the patient's open queue entry by acuity (priority_order
  //    = the acuity level; lower = seen sooner). FIFO sequence_number
  //    is preserved as the tiebreak.
  if (input.patient_user_id) {
    await service
      .from("queue_entries")
      .update({ priority_order: assignedLevel })
      .eq("patient_user_id", input.patient_user_id)
      .eq("hospital_id", scope.hospitalId)
      .eq("state", "waiting");
  }

  // 7. Audit (sa_audit_log). The triage_records row-change trigger also
  //    captures a generic audit_log entry; this is the god-mode-grade
  //    record with the clinician's reason.
  const action =
    verdict.direction === "down"
      ? "override_triage"
      : result.baselineApplied
        ? "adjust_triage_baseline"
        : "assign_triage";
  const reason =
    input.override_reason?.trim() ||
    input.baseline_reason?.trim() ||
    `Triage assigned L${assignedLevel} (computed L${computedLevel}).`;
  const { error: auditErr } = await service.from("sa_audit_log").insert({
    actor_id: scope.userId,
    action,
    target_kind: "triage_record",
    target_id: record.id,
    reason: reason.length >= 8 ? reason : `${reason} (triage)`,
    before_data: null,
    after_data: { computed_level: computedLevel, assigned_level: assignedLevel },
  });
  if (auditErr) {
    logger.warn("triage.audit.failed", { reason: auditErr.message });
  }

  // 8. Red/Orange → in-app alert to the receiving department's clinical
  //    staff (R2). Best-effort; never blocks the saved triage.
  if (assignedLevel <= 2) {
    await notifyTriageOutcome({
      service,
      hospitalId: scope.hospitalId,
      departmentId: scope.departmentId,
      assignedLevel,
      patientLabel: input.patient_user_id ? "a patient" : "an unidentified patient",
      triageRecordId: record.id,
    }).catch((e) => logger.warn("triage.notify.failed", { reason: String(e) }));
  }

  // 9. If a DOCTOR did the triage, auto-assign the patient to them (a `planned`
  //    encounter) — they can then reassign or start it. Best-effort; the saved
  //    triage never fails because of this.
  if (
    encounterEngineLive() &&
    input.patient_user_id &&
    (DOCTOR_CADRE_CODES as readonly string[]).includes(scope.cadreCode)
  ) {
    const assigned = await assignDoctorFromIntake({
      intakeId: input.intake_id,
      doctorUserId: scope.userId,
      assignerHospitalId: scope.hospitalId,
    }).catch((e) => {
      logger.warn("triage.auto_assign.failed", { reason: String(e) });
      return null;
    });
    if (assigned && !assigned.ok) {
      logger.warn("triage.auto_assign.rejected", { reason: assigned.error });
    }
  }

  revalidatePath("/nurse/triage");
  revalidatePath("/nurse");
  return {
    ok: true,
    triageRecordId: record.id,
    computedLevel,
    assignedLevel,
    why: result.reasoning[0] ?? null,
    lifeThreat: result.lifeThreat,
  };
}

/* ─── Rapid mode — 1-tap Level 1 / resus (GATE D, kickoff §4) ──────── */

const RapidRedSchema = z.object({
  intake_id: z.string().uuid(),
  patient_user_id: z.string().uuid().nullable(),
  /** Which Step-0 life-threat the clinician is declaring. */
  reason: z.string().min(3).max(200),
});

export type RapidRedState = { ok?: boolean; error?: string; triageRecordId?: string };

/**
 * The obvious-sick fast path (kickoff §4): one confirm → a Level-1
 * triage record, resus disposition, no full form. You don't fill a form
 * for a patient in arrest. Same authorised + audited path as
 * submitTriageAction; the record is life_threat_fast_tracked with
 * computed == assigned == 1 and override "none", so it can only ever
 * over-triage (never under-triage) and reads honestly in the trail.
 */
export async function rapidRedAction(
  _prev: RapidRedState,
  formData: FormData,
): Promise<RapidRedState> {
  const parsed = RapidRedSchema.safeParse({
    intake_id: formData.get("intake_id"),
    patient_user_id: formData.get("patient_user_id") || null,
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: "Please confirm the life-threat reason." };
  }
  const input = parsed.data;

  // Authorise — clinical cadre, this hospital, may triage (redirects if not).
  const scope = await requireTriageScope();

  const service = createServiceClient();
  const { data: record, error: insErr } = await service
    .from("triage_records")
    .insert({
      intake_id: input.intake_id,
      patient_user_id: input.patient_user_id,
      hospital_id: scope.hospitalId,
      department_id: scope.departmentId,
      ruleset: "adult_news2",
      vitals_snapshot: { rapid: true },
      computed_level: 1,
      computed_score: null,
      computed_breakdown: {
        reasoning: [`Rapid Step-0 life threat: ${input.reason} → Level 1, resus now.`],
        rapid: true,
        lifeThreatReason: input.reason,
      },
      assigned_level: 1,
      override_direction: "none",
      override_reason: null,
      baseline_adjusted: false,
      baseline_reason: null,
      life_threat_fast_tracked: true,
      provisional: false,
      triaged_by_user_id: scope.userId,
    })
    .select("id")
    .single();
  if (insErr || !record) {
    logger.error("triage.rapid_red.insert_failed", { reason: insErr?.message });
    return { error: "Could not record the resus triage. Please try again." };
  }

  await service
    .from("patient_intakes")
    .update({ triage_level: 1, triaged_at: new Date().toISOString(), status: "triaged" })
    .eq("id", input.intake_id);

  if (input.patient_user_id) {
    await service
      .from("queue_entries")
      .update({ priority_order: 1 })
      .eq("patient_user_id", input.patient_user_id)
      .eq("hospital_id", scope.hospitalId)
      .eq("state", "waiting");
  }

  await service.from("sa_audit_log").insert({
    actor_id: scope.userId,
    action: "assign_triage",
    target_kind: "triage_record",
    target_id: record.id,
    reason: `Rapid Level 1 (resus): ${input.reason}`,
    before_data: null,
    after_data: { rapid: true, computed_level: 1, assigned_level: 1 },
  });

  await notifyTriageOutcome({
    service,
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    assignedLevel: 1 as AcuityLevel,
    patientLabel: input.patient_user_id ? "a patient" : "an unidentified patient",
    triageRecordId: record.id,
  }).catch((e) => logger.warn("triage.rapid_red.notify_failed", { reason: String(e) }));

  revalidatePath("/nurse/triage");
  revalidatePath("/nurse");
  return { ok: true, triageRecordId: record.id };
}

/* ── Doctor assignment (post-triage) ──────────────────────────────────────
 * After triage, a clinician assigns the patient to a doctor. The assignment is
 * a `planned` encounter (see lib/encounter/assignment.ts); the doctor starts it
 * to drop into the clerkship. Authorised by the triage scope (nurses + doctors).
 */

export async function listAssignableDoctorsAction(
  departmentId?: string | null,
): Promise<AssignableDoctor[]> {
  const scope = await requireTriageScope();
  return listAssignableDoctors({
    hospitalId: scope.hospitalId,
    departmentId: departmentId ?? scope.departmentId ?? null,
  });
}

export type AssignDoctorResult =
  | { ok: true; action: "assigned" | "reassigned" }
  | { ok: false; error: string };

export async function assignDoctorAction(
  intakeId: string,
  doctorUserId: string,
): Promise<AssignDoctorResult> {
  if (!encounterEngineLive()) {
    return { ok: false, error: "The clinical module is not active yet." };
  }
  const parsed = z
    .object({ intakeId: z.string().uuid(), doctorUserId: z.string().uuid() })
    .safeParse({ intakeId, doctorUserId });
  if (!parsed.success) return { ok: false, error: "Invalid assignment." };

  const scope = await requireTriageScope();
  const res = await assignDoctorFromIntake({
    intakeId: parsed.data.intakeId,
    doctorUserId: parsed.data.doctorUserId,
    assignerHospitalId: scope.hospitalId,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/nurse/triage");
  revalidatePath("/doctor/assigned");
  return { ok: true, action: res.action };
}
