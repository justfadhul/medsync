import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { cadres } from "@/db/schema/reference-data";
import { encounters } from "@/db/schema/scheduling";
import { triageRecords } from "@/db/schema/triage";
import { users } from "@/db/schema/users";
import { DOCTOR_CADRE_CODES } from "@/lib/doctor/scope";
import { findOpenEncounterToday, linkEncounterToVisit } from "@/lib/encounter/handoff";
import { logger } from "@/lib/logger";

/**
 * Triage → doctor assignment. After triage, a clinician (nurse or doctor) assigns
 * the patient to a doctor; the assignment IS a `planned` encounter (clinician =
 * the assigned doctor, linked to the triage). Starting it flips planned →
 * in_progress and drops into the clerkship (see lib/encounter/handoff.ts).
 *
 * No new table — reuses the encounter's `planned` lifecycle state. Server-only.
 */

export interface AssignableDoctor {
  userId: string;
  fullName: string;
  cadreCode: string;
  /** True when the doctor holds an affiliation in the triage department. */
  inDepartment: boolean;
}

/**
 * Doctors assignable at a hospital — UMDPC doctor cadres, active/approved.
 * Department matches are flagged + sorted first (the picker defaults to them,
 * widening to the whole hospital).
 */
export async function listAssignableDoctors(args: {
  hospitalId: string;
  departmentId: string | null;
}): Promise<AssignableDoctor[]> {
  const rows = await db
    .select({
      userId: staffAffiliations.userId,
      fullName: users.fullName,
      cadreCode: cadres.code,
      departmentId: staffAffiliations.departmentId,
    })
    .from(staffAffiliations)
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .where(
      and(
        eq(staffAffiliations.hospitalId, args.hospitalId),
        inArray(staffAffiliations.state, ["active", "approved"]),
        inArray(cadres.code, DOCTOR_CADRE_CODES as unknown as string[]),
      ),
    );

  // A doctor may hold several affiliations — dedupe by user, flag dept match.
  const byUser = new Map<string, AssignableDoctor>();
  for (const r of rows) {
    const inDept = args.departmentId != null && r.departmentId === args.departmentId;
    const prev = byUser.get(r.userId);
    if (!prev) {
      byUser.set(r.userId, {
        userId: r.userId,
        fullName: r.fullName,
        cadreCode: r.cadreCode,
        inDepartment: inDept,
      });
    } else if (inDept) {
      prev.inDepartment = true;
    }
  }

  return Array.from(byUser.values()).sort(
    (a, b) =>
      Number(b.inDepartment) - Number(a.inDepartment) || a.fullName.localeCompare(b.fullName),
  );
}

export type AssignResult =
  | { ok: true; encounterId: string; action: "assigned" | "reassigned" }
  | { ok: false; error: string };

/**
 * Assign (or reassign) the patient of a triaged intake to a doctor by creating /
 * updating the `planned` encounter. Reassignment is only allowed while the
 * encounter is still `planned` — once it's started (in_progress), care has begun.
 *
 * If the patient's visit is already running today (called from the queue rail
 * before or without triage), no second encounter is made (ADR 0101 R3): the
 * triage is linked to the running one when it is the same doctor's, and the
 * assignment is refused when it is someone else's — a planned encounter beside
 * an open one is two records of one visit.
 */
export async function assignDoctorFromIntake(args: {
  intakeId: string;
  doctorUserId: string;
  assignerHospitalId: string;
}): Promise<AssignResult> {
  const [intake] = await db
    .select({
      patientUserId: patientIntakes.patientUserId,
      hospitalId: patientIntakes.hospitalId,
      receivingDepartmentId: patientIntakes.receivingDepartmentId,
      appointmentId: patientIntakes.appointmentId,
    })
    .from(patientIntakes)
    .where(eq(patientIntakes.id, args.intakeId))
    .limit(1);

  if (!intake) return { ok: false, error: "Intake not found." };
  if (intake.hospitalId !== args.assignerHospitalId) {
    return { ok: false, error: "That patient is outside your hospital." };
  }
  if (!intake.patientUserId) {
    return { ok: false, error: "Register the patient before assigning a doctor." };
  }

  // The latest triage record for this intake anchors the encounter.
  const [tr] = await db
    .select({ id: triageRecords.id, departmentId: triageRecords.departmentId })
    .from(triageRecords)
    .where(eq(triageRecords.intakeId, args.intakeId))
    .orderBy(desc(triageRecords.triagedAt))
    .limit(1);
  if (!tr) return { ok: false, error: "Triage this patient before assigning a doctor." };

  const deptId = tr.departmentId ?? intake.receivingDepartmentId ?? null;

  // The target must be a real assignable doctor at this hospital.
  const doctors = await listAssignableDoctors({
    hospitalId: intake.hospitalId,
    departmentId: deptId,
  });
  if (!doctors.some((d) => d.userId === args.doctorUserId)) {
    return { ok: false, error: "That clinician isn't an assignable doctor at this hospital." };
  }

  try {
    const [existing] = await db
      .select({ id: encounters.id, state: encounters.state })
      .from(encounters)
      .where(eq(encounters.triageRecordId, tr.id))
      .limit(1);

    if (existing) {
      if (existing.state !== "planned") {
        return {
          ok: false,
          error: "The encounter has already started — reassignment isn't supported here.",
        };
      }
      await db
        .update(encounters)
        .set({ clinicianUserId: args.doctorUserId })
        .where(eq(encounters.id, existing.id));
      return { ok: true, encounterId: existing.id, action: "reassigned" };
    }

    // One assignment per visit (doctor workspace D5). A re-triage writes a new
    // triage record, so the lookup above misses the visit's assignment, and the
    // insert below used to put a second planned encounter beside it — the same
    // patient three times on Assigned. The visit's open encounter, through ANY
    // of its triage records, is the one to re-point or respect.
    const [visitOpen] = await db
      .select({
        id: encounters.id,
        state: encounters.state,
        clinicianUserId: encounters.clinicianUserId,
      })
      .from(encounters)
      .innerJoin(triageRecords, eq(triageRecords.id, encounters.triageRecordId))
      .where(
        and(
          eq(triageRecords.intakeId, args.intakeId),
          inArray(encounters.state, ["planned", "in_progress"]),
        ),
      )
      .orderBy(desc(encounters.createdAt))
      .limit(1);
    if (visitOpen?.state === "planned") {
      await db
        .update(encounters)
        .set({ clinicianUserId: args.doctorUserId, triageRecordId: tr.id })
        .where(eq(encounters.id, visitOpen.id));
      return {
        ok: true,
        encounterId: visitOpen.id,
        action: visitOpen.clinicianUserId === args.doctorUserId ? "assigned" : "reassigned",
      };
    }
    if (visitOpen) {
      if (visitOpen.clinicianUserId !== args.doctorUserId) {
        return {
          ok: false,
          error: "This patient is already being seen by another doctor — the visit is open.",
        };
      }
      return { ok: true, encounterId: visitOpen.id, action: "assigned" };
    }

    const open = await findOpenEncounterToday(intake.patientUserId, intake.hospitalId);
    if (open) {
      if (open.clinicianUserId !== args.doctorUserId) {
        return {
          ok: false,
          error: "This patient is already being seen by another doctor — the visit is open.",
        };
      }
      await linkEncounterToVisit(open.id, tr.id, intake.appointmentId);
      return { ok: true, encounterId: open.id, action: "assigned" };
    }

    const [enc] = await db
      .insert(encounters)
      .values({
        hospitalId: intake.hospitalId,
        patientUserId: intake.patientUserId,
        clinicianUserId: args.doctorUserId,
        departmentId: deptId,
        encounterType: "emergency",
        triageRecordId: tr.id,
        // The booking this visit answers (ADR 0101 R4) — so ending the
        // encounter completes the appointment.
        appointmentId: intake.appointmentId,
        state: "planned",
      })
      .returning({ id: encounters.id });
    return { ok: true, encounterId: enc!.id, action: "assigned" };
  } catch (e) {
    logger.error("assignDoctorFromIntake failed", { error: String(e) });
    return { ok: false, error: "Failed to assign the doctor." };
  }
}

/**
 * Reassign a still-`planned` encounter to another doctor (the doctor-side
 * "hand to a colleague" path). Only while planned — once started, care has begun.
 */
export async function reassignPlannedEncounter(args: {
  encounterId: string;
  newDoctorUserId: string;
  hospitalId: string;
}): Promise<AssignResult> {
  const [enc] = await db
    .select({
      id: encounters.id,
      state: encounters.state,
      hospitalId: encounters.hospitalId,
      departmentId: encounters.departmentId,
    })
    .from(encounters)
    .where(eq(encounters.id, args.encounterId))
    .limit(1);
  if (!enc) return { ok: false, error: "Encounter not found." };
  if (enc.hospitalId !== args.hospitalId) {
    return { ok: false, error: "That encounter is outside your hospital." };
  }
  if (enc.state !== "planned") {
    return {
      ok: false,
      error: "The encounter has already started — reassignment isn't supported here.",
    };
  }
  const doctors = await listAssignableDoctors({
    hospitalId: enc.hospitalId,
    departmentId: enc.departmentId,
  });
  if (!doctors.some((d) => d.userId === args.newDoctorUserId)) {
    return { ok: false, error: "That clinician isn't an assignable doctor at this hospital." };
  }
  try {
    await db
      .update(encounters)
      .set({ clinicianUserId: args.newDoctorUserId })
      .where(eq(encounters.id, enc.id));
    return { ok: true, encounterId: enc.id, action: "reassigned" };
  } catch (e) {
    logger.error("reassignPlannedEncounter failed", { error: String(e) });
    return { ok: false, error: "Failed to reassign the encounter." };
  }
}

export interface AssignedEncounterRow {
  encounterId: string;
  triageRecordId: string | null;
  patientCode: string | null;
  acuity: number | null;
  presentingComplaint: string | null;
  assignedAtIso: string;
}

/**
 * A doctor's inbound queue: the `planned` encounters assigned to them (not yet
 * started). Shows patient CODE + acuity + reason (no name decrypt — identity is
 * revealed when they start the encounter and the audited record opens).
 */
export async function listAssignedEncountersForDoctor(args: {
  doctorUserId: string;
  hospitalId: string;
}): Promise<AssignedEncounterRow[]> {
  const rows = await db
    .select({
      encounterId: encounters.id,
      triageRecordId: encounters.triageRecordId,
      patientCode: patientProfiles.patientCode,
      acuity: triageRecords.assignedLevel,
      presentingComplaint: patientIntakes.presentingComplaint,
      createdAt: encounters.createdAt,
    })
    .from(encounters)
    .leftJoin(patientProfiles, eq(patientProfiles.id, encounters.patientUserId))
    .leftJoin(triageRecords, eq(triageRecords.id, encounters.triageRecordId))
    .leftJoin(patientIntakes, eq(patientIntakes.id, triageRecords.intakeId))
    .where(
      and(
        eq(encounters.clinicianUserId, args.doctorUserId),
        eq(encounters.hospitalId, args.hospitalId),
        eq(encounters.state, "planned"),
      ),
    )
    .orderBy(desc(encounters.createdAt));

  return rows.map((r) => ({
    encounterId: r.encounterId,
    triageRecordId: r.triageRecordId,
    patientCode: r.patientCode,
    acuity: r.acuity,
    presentingComplaint: r.presentingComplaint,
    assignedAtIso: r.createdAt.toISOString(),
  }));
}

export interface DoctorEncounterRow {
  encounterId: string;
  patientCode: string | null;
  state: string;
  encounterType: string;
  startedAtIso: string;
}

/**
 * The doctor's OPEN + RECENT encounters (already started — in_progress or
 * completed), most-recent first. Distinct from the `planned` assigned queue
 * (those live on /doctor/assigned). Patient CODE only — no name decrypt until
 * the audited record is opened. Server-only.
 */
export async function listDoctorEncounters(args: {
  doctorUserId: string;
  hospitalId: string;
}): Promise<DoctorEncounterRow[]> {
  const rows = await db
    .select({
      encounterId: encounters.id,
      patientCode: patientProfiles.patientCode,
      state: encounters.state,
      encounterType: encounters.encounterType,
      startedAt: encounters.startedAt,
    })
    .from(encounters)
    .leftJoin(patientProfiles, eq(patientProfiles.id, encounters.patientUserId))
    .where(
      and(
        eq(encounters.clinicianUserId, args.doctorUserId),
        eq(encounters.hospitalId, args.hospitalId),
        inArray(encounters.state, ["in_progress", "completed"]),
      ),
    )
    .orderBy(desc(encounters.startedAt))
    .limit(50);
  return rows.map((r) => ({
    encounterId: r.encounterId,
    patientCode: r.patientCode,
    state: r.state,
    encounterType: r.encounterType,
    startedAtIso: r.startedAt.toISOString(),
  }));
}
