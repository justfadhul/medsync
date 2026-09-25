"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { saAuditLog } from "@/db/schema/sa-audit-log";
import { encounters } from "@/db/schema/scheduling";
import { triageRecords } from "@/db/schema/triage";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { assignDoctorFromIntake } from "@/lib/encounter/assignment";
import { encounterEngineLive } from "@/lib/encounter/feature";
import { openEncounterFromTriage } from "@/lib/encounter/handoff";
import { toEncounterScope } from "@/lib/encounter/workspace-scope";
import { logger } from "@/lib/logger";
import { callEdge } from "@/lib/supabase/edge";
import { hospitalClock } from "@/lib/workspace/clock";
import { deathsFor, triageAuthorityFor } from "@/lib/workspace/queries";

/**
 * The doctor workspace's own actions (prompt §8). Everything else it does
 * calls the actions that already exist: assign, reassign, End visit, open
 * resus, the triage submit, the resus close-out. Each of these is Zod-checked,
 * scoped (AAL2 through requireDoctorScope), and written to the audit log.
 *
 * A recorded death never blocks a clinician (Law 2): starting care for a
 * patient recorded as dead needs a reason, and the reason is audited BEFORE the
 * encounter opens — if it cannot be recorded, nothing happens.
 */

export type WorkspaceActionResult =
  | { ok: true }
  | { ok: false; error: string; deceased?: { atIso: string; source: string } };

const Reason = z.string().trim().min(8, "Give a reason of at least 8 characters.").max(500);

function refused(error: string): WorkspaceActionResult {
  return { ok: false, error };
}

const clock = hospitalClock();

/** A death on record for this patient, as the confirm dialog words it — or null. */
async function recordedDeath(hospitalId: string, patientId: string | null) {
  if (!patientId) return null;
  const deaths = await deathsFor(hospitalId, [patientId]);
  const latest = deaths.sort((a, b) => b.atMs - a.atMs)[0];
  return latest ? { atIso: new Date(latest.atMs).toISOString(), source: latest.source } : null;
}

/** The override comes first: no reason on record, no encounter (Law 2). */
async function auditOverride(args: {
  actorId: string;
  target: { kind: "patient_intake" | "triage_record"; id: string };
  reason: string;
  deceased: { atIso: string; source: string };
}) {
  await db.insert(saAuditLog).values({
    actorId: args.actorId,
    action: "start_encounter",
    targetKind: args.target.kind,
    targetId: args.target.id,
    reason: args.reason,
    beforeData: { deceasedAt: args.deceased.atIso, deathSource: args.deceased.source },
    afterData: { override: "started_despite_recorded_death" },
  });
}

async function auditStart(actorId: string, encounterId: string, reason: string, after: object) {
  try {
    await db.insert(saAuditLog).values({
      actorId,
      action: "start_encounter",
      targetKind: "encounter",
      targetId: encounterId,
      reason,
      beforeData: null,
      afterData: after,
    });
  } catch (e) {
    // The encounter is open either way; a missing trail is loud, not fatal.
    logger.error("workspace.start.audit_failed", { encounterId, reason: String(e) });
  }
}

/* ─── Take: assign me + start ─────────────────────────────────────────── */

const TakeSchema = z.object({ intakeId: z.string().uuid(), overrideReason: Reason.optional() });

/**
 * "Take & start" — assign the patient to me and open the encounter. Both steps
 * already exist and are idempotent (the assignment reuses the visit's planned
 * encounter; opening returns the started one), so a retry lands on the same
 * encounter. If opening fails after the assignment, the patient is left
 * assigned to me — a clear, valid state under Waiting for you.
 */
export async function takePatientAction(input: {
  intakeId: string;
  overrideReason?: string;
}): Promise<WorkspaceActionResult> {
  const parsed = TakeSchema.safeParse(input);
  if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? "Invalid request.");
  if (!encounterEngineLive()) return refused("The clinical module is not active yet.");
  const scope = await requireDoctorScope();
  const authority = await triageAuthorityFor(scope.hospitalId, scope.cadreCode);
  if (!authority.mayTriage) return refused("Your cadre may not assign patients at this hospital.");

  const [intake] = await db
    .select({ patientUserId: patientIntakes.patientUserId, hospitalId: patientIntakes.hospitalId })
    .from(patientIntakes)
    .where(eq(patientIntakes.id, parsed.data.intakeId))
    .limit(1);
  if (!intake || intake.hospitalId !== scope.hospitalId) return refused("Patient not found.");

  const deceased = await recordedDeath(scope.hospitalId, intake.patientUserId);
  if (deceased && !parsed.data.overrideReason) {
    return {
      ok: false,
      error: `Recorded as died ${clock.stamp(Date.parse(deceased.atIso))}. Give a reason to continue.`,
      deceased,
    };
  }

  if (deceased) {
    try {
      await auditOverride({
        actorId: scope.userId,
        target: { kind: "patient_intake", id: parsed.data.intakeId },
        reason: parsed.data.overrideReason!,
        deceased,
      });
    } catch (e) {
      logger.error("workspace.take.override_audit_failed", { reason: String(e) });
      return refused("The reason could not be recorded, so nothing was started.");
    }
  }

  const assigned = await assignDoctorFromIntake({
    intakeId: parsed.data.intakeId,
    doctorUserId: scope.userId,
    assignerHospitalId: scope.hospitalId,
  });
  if (!assigned.ok) return refused(assigned.error);

  const [enc] = await db
    .select({ triageRecordId: encounters.triageRecordId })
    .from(encounters)
    .where(eq(encounters.id, assigned.encounterId))
    .limit(1);
  if (!enc?.triageRecordId) {
    revalidatePath("/doctor");
    return refused("Assigned to you, but the visit has no triage to start from.");
  }
  const opened = await openEncounterFromTriage(enc.triageRecordId, toEncounterScope(scope));
  revalidatePath("/doctor");
  if (!opened.ok) {
    return refused(`${opened.error} The patient is assigned to you under Waiting for you.`);
  }
  await auditStart(scope.userId, opened.encounterId, "Taken from the doctor workspace.", {
    via: "take",
    intakeId: parsed.data.intakeId,
  });
  redirect(`/doctor/encounters/${opened.encounterId}`);
}

/* ─── Start, with the death check ─────────────────────────────────────── */

const StartSchema = z.object({
  triageRecordId: z.string().uuid(),
  overrideReason: Reason.optional(),
});

/**
 * Start from the workspace: the existing start (openEncounterFromTriage) with
 * one guard the old pages never had — a recorded death asks for a reason
 * (Law 2: a confirm, never a block).
 */
export async function startForWorkspaceAction(input: {
  triageRecordId: string;
  overrideReason?: string;
}): Promise<WorkspaceActionResult> {
  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? "Invalid request.");
  if (!encounterEngineLive()) return refused("The clinical module is not active yet.");
  const scope = await requireDoctorScope();

  const [tr] = await db
    .select({ patientUserId: triageRecords.patientUserId, hospitalId: triageRecords.hospitalId })
    .from(triageRecords)
    .where(eq(triageRecords.id, parsed.data.triageRecordId))
    .limit(1);
  if (!tr || tr.hospitalId !== scope.hospitalId) return refused("Triage record not found.");

  const deceased = await recordedDeath(scope.hospitalId, tr.patientUserId);
  if (deceased && !parsed.data.overrideReason) {
    return {
      ok: false,
      error: `Recorded as died ${clock.stamp(Date.parse(deceased.atIso))}. Give a reason to continue.`,
      deceased,
    };
  }
  if (deceased) {
    try {
      await auditOverride({
        actorId: scope.userId,
        target: { kind: "triage_record", id: parsed.data.triageRecordId },
        reason: parsed.data.overrideReason!,
        deceased,
      });
    } catch (e) {
      logger.error("workspace.start.override_audit_failed", { reason: String(e) });
      return refused("The reason could not be recorded, so nothing was started.");
    }
  }
  const opened = await openEncounterFromTriage(parsed.data.triageRecordId, toEncounterScope(scope));
  revalidatePath("/doctor");
  if (!opened.ok) return refused(opened.error);
  await auditStart(scope.userId, opened.encounterId, "Started from the doctor workspace.", {
    via: "start",
    triageRecordId: parsed.data.triageRecordId,
  });
  redirect(`/doctor/encounters/${opened.encounterId}`);
}

/* ─── Retire a superseded assignment (D5) ─────────────────────────────── */

const RetireSchema = z.object({ encounterId: z.string().uuid(), reason: Reason });

/**
 * Retire an assignment a person has judged superseded: the planned encounter
 * becomes `cancelled` with its reason, and the audit row is written in the same
 * transaction — without migration 0069 the audit CHECK refuses it and nothing
 * changes. Only the doctor it is assigned to, only while not started.
 */
export async function retireAssignmentAction(input: {
  encounterId: string;
  reason: string;
}): Promise<WorkspaceActionResult> {
  const parsed = RetireSchema.safeParse(input);
  if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? "Invalid request.");
  const scope = await requireDoctorScope();
  try {
    const result = await db.transaction(async (tx): Promise<WorkspaceActionResult> => {
      const [enc] = await tx
        .select({
          state: encounters.state,
          clinicianUserId: encounters.clinicianUserId,
          hospitalId: encounters.hospitalId,
        })
        .from(encounters)
        .where(eq(encounters.id, parsed.data.encounterId))
        .for("update")
        .limit(1);
      if (!enc || enc.hospitalId !== scope.hospitalId) return refused("Assignment not found.");
      if (enc.state !== "planned")
        return refused("Only an assignment not yet started can be retired.");
      if (enc.clinicianUserId !== scope.userId) {
        return refused("Only the doctor it is assigned to can retire it.");
      }
      await tx
        .update(encounters)
        .set({ state: "cancelled", completionReason: "assignment_retired", endedAt: new Date() })
        .where(and(eq(encounters.id, parsed.data.encounterId), eq(encounters.state, "planned")));
      await tx.insert(saAuditLog).values({
        actorId: scope.userId,
        action: "retire_assignment",
        targetKind: "encounter",
        targetId: parsed.data.encounterId,
        reason: parsed.data.reason,
        beforeData: { state: "planned" },
        afterData: { state: "cancelled", completionReason: "assignment_retired" },
      });
      return { ok: true };
    });
    revalidatePath("/doctor");
    return result;
  } catch (e) {
    logger.error("workspace.retire.failed", { reason: String(e) });
    return refused("The assignment could not be retired — nothing was changed.");
  }
}

/* ─── Close an intake (the existing Edge Function) ────────────────────── */

const CloseIntakeSchema = z.object({ intakeId: z.string().uuid(), reason: Reason });

/** Close a visit that will not become an encounter: `ha-cancel-intake`, reason audited there. */
export async function closeIntakeAction(input: {
  intakeId: string;
  reason: string;
}): Promise<WorkspaceActionResult> {
  const parsed = CloseIntakeSchema.safeParse(input);
  if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? "Invalid request.");
  await requireDoctorScope();
  const result = await callEdge(
    "ha-cancel-intake",
    { intake_id: parsed.data.intakeId, reason: parsed.data.reason },
    "doctor.workspace",
  );
  if (!result.ok) return refused(result.error);
  revalidatePath("/doctor");
  return { ok: true };
}
