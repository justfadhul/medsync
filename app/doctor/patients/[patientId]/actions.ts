"use server";

import type { CosignActionKind } from "@/lib/doctor/capabilities";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { clinicalCosignRequests } from "@/db/schema/doctor-workspace";
import { COSIGN_ACTION_KINDS, resolveCapabilities } from "@/lib/doctor/capabilities";
import { resolvePatientAccess } from "@/lib/doctor/patient-access";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { logger } from "@/lib/logger";

/**
 * The prescribing safety scaffold. Per the GATE A proposal §6:
 *
 *   The actual "prescribe a drug" form is a placeholder that creates a
 *   clinical_cosign_requests row when cadre policy requires co-sign,
 *   and a no-op success when policy allows. This proves the cadre-
 *   enforced flow end-to-end without faking clinical content.
 *
 * When the real prescribing engine ships:
 *   - Replace the no-op "execute" branch with the prescriptions INSERT.
 *   - Approval of a pending request triggers the same INSERT.
 */

const ProposeSchema = z.object({
  patient_user_id: z.string().uuid(),
  action_kind: z.enum(COSIGN_ACTION_KINDS),
  // Action payload — kept loose because each action_kind has its own
  // shape. The Edge Function / future engine validates more strictly.
  drug_name: z.string().max(120).optional(),
  dose: z.string().max(60).optional(),
  route: z.string().max(40).optional(),
  duration: z.string().max(60).optional(),
  reason: z.string().min(8, "Give a brief clinical reason (≥ 8 characters).").max(500),
});

export type ProposeActionState = {
  ok?: boolean;
  outcome?: "executed" | "queued_for_review" | "blocked";
  error?: string;
  cosignRequestId?: string;
};

export async function proposeClinicalAction(
  _prev: ProposeActionState,
  formData: FormData,
): Promise<ProposeActionState> {
  const parsed = ProposeSchema.safeParse({
    patient_user_id: formData.get("patient_user_id"),
    action_kind: formData.get("action_kind"),
    drug_name: stringOrUndef(formData.get("drug_name")),
    dose: stringOrUndef(formData.get("dose")),
    route: stringOrUndef(formData.get("route")),
    duration: stringOrUndef(formData.get("duration")),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat().find(Boolean);
    return { error: first ?? "Check the form values." };
  }

  const scope = await requireDoctorScope();

  // Patient access — same legitimacy gate as the summary read.
  const access = await resolvePatientAccess({
    doctorUserId: scope.userId,
    doctorDepartmentId: scope.departmentId,
    patientUserId: parsed.data.patient_user_id,
  });
  if (!access.allowed) {
    logger.warn("doctor.propose_action.no_access", {
      doctor_user_id: scope.userId,
      patient_user_id: parsed.data.patient_user_id,
      action_kind: parsed.data.action_kind,
    });
    return {
      error:
        "Above your current access — you don't have a clinical relationship with this patient.",
    };
  }

  // Capability resolver — cadre + department + hospital policy.
  const caps = await resolveCapabilities({
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    cadreCode: scope.cadreCode,
  });
  const requirement = caps[parsed.data.action_kind as CosignActionKind];

  // The action payload snapshot. The shape will tighten when the real
  // prescribing engine lands; for now we capture what's on the form
  // verbatim so a reviewer can see exactly what was proposed.
  const payload = {
    placeholder: true,
    action_kind: parsed.data.action_kind,
    drug_name: parsed.data.drug_name ?? null,
    dose: parsed.data.dose ?? null,
    route: parsed.data.route ?? null,
    duration: parsed.data.duration ?? null,
    reason: parsed.data.reason,
    proposed_at: new Date().toISOString(),
    proposed_by_cadre: scope.cadreCode,
    proposed_by_role: scope.roleCode,
    proposed_by_department: scope.departmentName,
  };

  if (requirement === "blocked") {
    logger.warn("doctor.propose_action.blocked", {
      doctor_user_id: scope.userId,
      cadre_code: scope.cadreCode,
      action_kind: parsed.data.action_kind,
    });
    return {
      outcome: "blocked",
      error:
        "This action is above your current scope. Please ask your supervisor to author it instead.",
    };
  }

  if (requirement === "cosign_required") {
    try {
      const [row] = await db
        .insert(clinicalCosignRequests)
        .values({
          hospitalId: scope.hospitalId,
          patientUserId: parsed.data.patient_user_id,
          requestedByUserId: scope.userId,
          requestedByAffiliationId: scope.affiliationId,
          requestedByCadreCode: scope.cadreCode,
          actionKind: parsed.data.action_kind,
          actionPayload: payload,
          state: "pending_review",
          // Default 24h expiry — Q-C1 default per the proposal.
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning({ id: clinicalCosignRequests.id });

      revalidatePath(`/doctor/patients/${parsed.data.patient_user_id}`);
      revalidatePath("/doctor/cosign-queue");
      return {
        ok: true,
        outcome: "queued_for_review",
        cosignRequestId: row?.id,
      };
    } catch (err) {
      logger.error("doctor.propose_action.cosign_insert_failed", { reason: String(err) });
      return { error: "Couldn't queue that for review — try again in a moment." };
    }
  }

  // requirement === 'allowed' — the real engine would INSERT into
  // prescriptions / orders / admissions here. For GATE D the payload
  // is recorded as an immediately-approved request so the audit trail
  // and the patient-record surface have something to point at.
  try {
    await db.insert(clinicalCosignRequests).values({
      hospitalId: scope.hospitalId,
      patientUserId: parsed.data.patient_user_id,
      requestedByUserId: scope.userId,
      requestedByAffiliationId: scope.affiliationId,
      requestedByCadreCode: scope.cadreCode,
      actionKind: parsed.data.action_kind,
      actionPayload: payload,
      state: "approved",
      reviewedByUserId: scope.userId,
      reviewedAt: new Date(),
      reviewNote: "Auto-executed (cadre policy: allowed).",
    });
  } catch (err) {
    logger.error("doctor.propose_action.execute_insert_failed", { reason: String(err) });
    return { error: "Couldn't record that action — try again in a moment." };
  }

  revalidatePath(`/doctor/patients/${parsed.data.patient_user_id}`);
  return { ok: true, outcome: "executed" };
}

/* ─── Co-sign queue actions: approve / return ──────────────────── */

const ReviewSchema = z.object({
  cosign_request_id: z.string().uuid(),
  decision: z.enum(["approved", "returned"]),
  note: z.string().min(8, "Note ≥ 8 characters.").max(500).optional(),
});

export async function reviewCosignRequestAction(
  _prev: { ok?: boolean; error?: string },
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const parsed = ReviewSchema.safeParse({
    cosign_request_id: formData.get("cosign_request_id"),
    decision: formData.get("decision"),
    note: stringOrUndef(formData.get("note")),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors).flat().find(Boolean);
    return { error: first ?? "Check the form values." };
  }

  const scope = await requireDoctorScope();
  if (!scope.isSenior) {
    return { error: "Only senior doctors (MO+) can review co-sign requests." };
  }

  // Returning requires an explanatory note — that's how the junior
  // gets feedback they can act on.
  if (parsed.data.decision === "returned" && !parsed.data.note) {
    return { error: "A short note is required so the requester knows why it was returned." };
  }

  try {
    // Only this hospital's queue, and only a request still waiting: a second review of the same
    // request, or one from another hospital, changes nothing.
    const [req] = await db
      .select({
        id: clinicalCosignRequests.id,
        patientUserId: clinicalCosignRequests.patientUserId,
        actionKind: clinicalCosignRequests.actionKind,
        payload: clinicalCosignRequests.actionPayload,
        state: clinicalCosignRequests.state,
      })
      .from(clinicalCosignRequests)
      .where(
        and(
          eq(clinicalCosignRequests.id, parsed.data.cosign_request_id),
          eq(clinicalCosignRequests.hospitalId, scope.hospitalId),
        ),
      )
      .limit(1);
    if (!req) return { error: "That request is not in this hospital's co-sign queue." };
    if (req.state !== "pending_review") return { error: "That request has already been reviewed." };

    const decision = {
      state: parsed.data.decision,
      reviewedByUserId: scope.userId,
      reviewedAt: new Date(),
      reviewNote: parsed.data.note ?? null,
    };
    const stillPending = and(
      eq(clinicalCosignRequests.id, req.id),
      eq(clinicalCosignRequests.state, "pending_review"),
    );

    // An EMR prescription the senior returns is not valid: cancel it and stop its medication
    // statement in the same transaction as the decision, or the chart keeps listing the drug.
    const prescriptionId = (req.payload as { prescriptionId?: unknown } | null)?.prescriptionId;
    if (
      parsed.data.decision === "returned" &&
      typeof prescriptionId === "string" &&
      req.actionKind.startsWith("prescription_")
    ) {
      const { requireEmrActor } = await import("@/lib/emr/actor");
      const { withPatientWrite } = await import("@/lib/emr/write/context");
      const { withdrawReturnedPrescription } = await import("@/lib/emr/write/prescriptions");
      const actor = await requireEmrActor("doctor");
      await withPatientWrite(actor, req.patientUserId, async (ctx) => {
        await ctx.tx.update(clinicalCosignRequests).set(decision).where(stillPending);
        await withdrawReturnedPrescription(ctx, {
          patientUserId: req.patientUserId,
          prescriptionId,
          cosignRequestId: req.id,
        });
      });
    } else {
      await db.update(clinicalCosignRequests).set(decision).where(stillPending);
    }
  } catch (err) {
    const { EmrWriteError } = await import("@/lib/emr/write/context");
    if (err instanceof EmrWriteError) return { error: err.message };
    logger.error("doctor.cosign_review.failed", { reason: String(err) });
    return { error: "Couldn't save that decision — try again." };
  }

  revalidatePath("/doctor/cosign-queue");
  return { ok: true };
}

function stringOrUndef(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}
