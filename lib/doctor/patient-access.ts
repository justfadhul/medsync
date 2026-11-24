import "server-only";

import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { clinicalPhiAccessLog } from "@/db/schema/doctor-workspace";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { appointments, encounters } from "@/db/schema/scheduling";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

/**
 * Patient-access enforcement + audited PHI decrypt for the doctor
 * workspace.
 *
 * Three legitimate access bases (per the GATE A proposal §4):
 *   1. care_team        — doctor is on the patient's care team
 *                         (table arrives with the care-team module;
 *                         today this branch is always false — seam only)
 *   2. active_encounter — non-completed encounters row with this
 *                         doctor + patient
 *   3. department_recent — patient has an appointment or encounter in
 *                          the doctor's department within the window
 *                          (default 30d, configurable)
 *
 * If none match, the read is refused (and that refusal is itself
 * worth logging in a future audit pass).
 *
 * Every successful decrypt writes a row to clinical_phi_access_log
 * capturing the basis + surface + request id.
 */

const DEPARTMENT_WINDOW_DAYS = 30;

export type AccessBasis = "care_team" | "active_encounter" | "department_recent" | "break_glass";

export interface AccessDecision {
  allowed: boolean;
  basis: AccessBasis | null;
}

export async function resolvePatientAccess(args: {
  doctorUserId: string;
  doctorDepartmentId: string;
  patientUserId: string;
}): Promise<AccessDecision> {
  // 2. active_encounter — fast path, no join.
  const [activeEnc] = await db
    .select({ id: encounters.id })
    .from(encounters)
    .where(
      and(
        eq(encounters.clinicianUserId, args.doctorUserId),
        eq(encounters.patientUserId, args.patientUserId),
        inArray(encounters.state, ["in_progress"]),
      ),
    )
    .limit(1);
  if (activeEnc) return { allowed: true, basis: "active_encounter" };

  // 3. department_recent — appointment or encounter in the doctor's
  // department in the window. (Patient was seen here recently → the
  // ward / cross-cover case.)
  const since = new Date();
  since.setDate(since.getDate() - DEPARTMENT_WINDOW_DAYS);

  const [recentAppt] = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.patientUserId, args.patientUserId),
        eq(appointments.departmentId, args.doctorDepartmentId),
        gte(appointments.startsAt, since),
      ),
    )
    .limit(1);
  if (recentAppt) return { allowed: true, basis: "department_recent" };

  const [recentEnc] = await db
    .select({ id: encounters.id })
    .from(encounters)
    .where(
      and(
        eq(encounters.patientUserId, args.patientUserId),
        eq(encounters.departmentId, args.doctorDepartmentId),
        gte(encounters.startedAt, since),
      ),
    )
    .limit(1);
  if (recentEnc) return { allowed: true, basis: "department_recent" };

  // 1. care_team — table doesn't exist yet; the seam is always false
  // today. When the care-team module ships, add a fast path here BEFORE
  // the department check.
  // Stays a seam: request recipients open the chart via loadChart → resolveEmrAccess (0306, needs EMR v1).

  return { allowed: false, basis: null };
}

/**
 * Patients the doctor may legitimately see, derived from the three
 * access bases. Returns enough data for the patient panel without
 * decrypting PHI — names are decrypted only when the doctor opens a
 * specific patient (`fetchPatientSummary`).
 *
 * Today: union of (department_recent appointments) ∪ (department_recent
 * encounters) ∪ (active encounters with this doctor).
 */

export interface PatientPanelRow {
  patientUserId: string;
  patientCode: string;
  lastSeenIso: string | null;
  lastBasis: AccessBasis;
  /** Convenience: the most-recent appointment/encounter status, if any. */
  recentStatus: string | null;
}

export async function listDoctorPatientPanel(args: {
  doctorUserId: string;
  doctorDepartmentId: string;
  limit?: number;
}): Promise<PatientPanelRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - DEPARTMENT_WINDOW_DAYS);
  const limit = args.limit ?? 100;

  // Union of three sources, then dedupe by patient_user_id keeping
  // the most-recent timestamp. Hand-rolled UNION via two queries +
  // an in-memory merge keeps it readable and avoids fighting drizzle
  // for a single UNION ALL.
  const fromAppts = await db
    .select({
      // The inner join on patient_profiles makes this non-null; a provisional
      // booking (migration 0060, patient_user_id NULL) is not in this list.
      patientUserId: patientProfiles.id,
      patientCode: patientProfiles.patientCode,
      seenAt: appointments.startsAt,
      status: appointments.status,
    })
    .from(appointments)
    .innerJoin(patientProfiles, eq(patientProfiles.id, appointments.patientUserId))
    .where(
      and(
        eq(appointments.departmentId, args.doctorDepartmentId),
        gte(appointments.startsAt, since),
      ),
    )
    .orderBy(desc(appointments.startsAt))
    .limit(limit * 2);

  const fromEncs = await db
    .select({
      patientUserId: encounters.patientUserId,
      patientCode: patientProfiles.patientCode,
      seenAt: encounters.startedAt,
      status: encounters.state,
      isOwnEncounter: sql<boolean>`${encounters.clinicianUserId} = ${args.doctorUserId}`,
    })
    .from(encounters)
    .innerJoin(patientProfiles, eq(patientProfiles.id, encounters.patientUserId))
    .where(
      or(
        and(eq(encounters.departmentId, args.doctorDepartmentId), gte(encounters.startedAt, since)),
        eq(encounters.clinicianUserId, args.doctorUserId),
      )!,
    )
    .orderBy(desc(encounters.startedAt))
    .limit(limit * 2);

  const byPatient = new Map<string, PatientPanelRow>();
  for (const r of fromAppts) {
    byPatient.set(r.patientUserId, {
      patientUserId: r.patientUserId,
      patientCode: r.patientCode,
      lastSeenIso: r.seenAt.toISOString(),
      lastBasis: "department_recent",
      recentStatus: r.status,
    });
  }
  for (const r of fromEncs) {
    const prev = byPatient.get(r.patientUserId);
    const seenIso = r.seenAt.toISOString();
    const basis: AccessBasis = r.isOwnEncounter ? "active_encounter" : "department_recent";
    if (!prev || (prev.lastSeenIso && prev.lastSeenIso < seenIso)) {
      byPatient.set(r.patientUserId, {
        patientUserId: r.patientUserId,
        patientCode: r.patientCode,
        lastSeenIso: seenIso,
        lastBasis: basis,
        recentStatus: r.status,
      });
    } else if (basis === "active_encounter") {
      // Prefer the stronger basis even if the timestamp is older.
      prev.lastBasis = basis;
    }
  }

  return Array.from(byPatient.values())
    .sort((a, b) => (b.lastSeenIso ?? "").localeCompare(a.lastSeenIso ?? ""))
    .slice(0, limit);
}

/**
 * The audited PHI read. Resolves access basis, decrypts, and writes
 * the access-log row in a single helper so callers can't accidentally
 * decrypt without logging.
 *
 * Returns `null` (and logs nothing) when the doctor has no legitimate
 * access — the caller must render an "above your access" message.
 */

export interface PatientSummary {
  patientUserId: string;
  patientCode: string;
  firstName: string;
  surname: string;
  sex: string;
  dateOfBirth: string;
  phone: string;
  villageAddress: string | null;
  preferredLanguage: string | null;
  knownConditions: string[];
  accessBasis: AccessBasis;
}

export async function fetchPatientSummaryAudited(args: {
  doctor: {
    userId: string;
    hospitalId: string;
    departmentId: string;
  };
  patientUserId: string;
  surface: string;
  requestId?: string;
}): Promise<PatientSummary | null> {
  const decision = await resolvePatientAccess({
    doctorUserId: args.doctor.userId,
    doctorDepartmentId: args.doctor.departmentId,
    patientUserId: args.patientUserId,
  });
  if (!decision.allowed || !decision.basis) {
    logger.warn("doctor.patient_access.denied", {
      doctor_user_id: args.doctor.userId,
      patient_user_id: args.patientUserId,
      surface: args.surface,
    });
    return null;
  }

  const [row] = await db
    .select({
      patientCode: patientProfiles.patientCode,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      sex: patientProfiles.sex,
      dateOfBirth: patientProfiles.dateOfBirth,
      phoneEncrypted: patientProfiles.phoneEncrypted,
      villageAddressEncrypted: patientProfiles.villageAddressEncrypted,
      preferredLanguage: patientProfiles.preferredLanguage,
      knownConditions: patientProfiles.knownConditions,
    })
    .from(patientProfiles)
    .where(eq(patientProfiles.id, args.patientUserId))
    .limit(1);

  if (!row) return null;

  try {
    const summary: PatientSummary = {
      patientUserId: args.patientUserId,
      patientCode: row.patientCode,
      firstName: decrypt(row.firstNameEncrypted),
      surname: decrypt(row.surnameEncrypted),
      sex: row.sex,
      dateOfBirth: row.dateOfBirth,
      phone: decrypt(row.phoneEncrypted),
      villageAddress: row.villageAddressEncrypted ? decrypt(row.villageAddressEncrypted) : null,
      preferredLanguage: row.preferredLanguage,
      knownConditions: row.knownConditions ?? [],
      accessBasis: decision.basis,
    };

    // Audit the read AFTER decrypt succeeded — a decrypt failure
    // shouldn't generate a "successful access" row.
    await db.insert(clinicalPhiAccessLog).values({
      hospitalId: args.doctor.hospitalId,
      clinicianUserId: args.doctor.userId,
      patientUserId: args.patientUserId,
      accessBasis: decision.basis,
      requestId: args.requestId ?? null,
      surface: args.surface,
    });

    return summary;
  } catch (err) {
    logger.error("doctor.patient_access.decrypt_failed", {
      doctor_user_id: args.doctor.userId,
      patient_user_id: args.patientUserId,
      reason: String(err),
    });
    return null;
  }
}
