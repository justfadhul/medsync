import "server-only";

import type { PatientIdentity } from "@/components/medsync/patient-identity";
import type { BookingSymptom } from "@/supabase/functions/_shared/symptoms";

import { db } from "@/db";
import { clinicalPhiAccessLog } from "@/db/schema/doctor-workspace";
import { computeAgeYears } from "@/lib/age";
import { signedAvatarUrl } from "@/lib/avatars";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { complaintLine, normaliseSymptoms } from "@/supabase/functions/_shared/symptoms";

/**
 * The audited identity reveal for the staff scheduling surfaces (ADR 0095).
 *
 * A clinician sees the name and photo of a patient booked with them, or on
 * their department's pending / queue list — the booking IS the care
 * relationship, so the basis is `department_recent` (lib/doctor/patient-access
 * basis 3), with the true operational context carried in `surface` exactly as
 * lib/reception/queries.ts does for the desk. One `clinical_phi_access_log`
 * row per patient per fetch.
 *
 * FAIL CLOSED on name AND photo: a photograph identifies a person as surely
 * as a name, so if the audit row cannot be written neither is shown and the
 * card titles itself with the code. Age and sex are plaintext columns
 * reception already reads (ADR 0032 §2) and stay.
 *
 * Never imported by lib/hospital-admin: that surface is non-clinical and
 * stays code-only (ADR 0032; tests/scheduling/patient-identity.test.ts).
 */

/** Same mapping as reception's — `phi_access_basis_check` permits only the
 * four clinical values, so the honest basis rides in `surface`. */
const OPERATIONAL_BASIS_SUFFIX = "#operational";

export interface RevealablePatient {
  /** Null on a provisional (desk-registered, no account) booking — nothing to reveal. */
  patientUserId: string | null;
  patientCode: string | null;
  firstNameEncrypted: string | null;
  surnameEncrypted: string | null;
  sex: string | null;
  dateOfBirth: string | null;
  avatarPath: string | null;
}

export interface RevealedPatient {
  displayName: string | null;
  photoUrl: string | null;
  ageYears: number | null;
  sex: string | null;
}

/** Decrypt "First Surname"; null when the payload/key is unusable — never throws into a page. */
function decryptName(first: string | null, surname: string | null): string | null {
  if (!first || !surname) return null;
  try {
    return `${decrypt(first)} ${decrypt(surname)}`.trim();
  } catch (e) {
    logger.warn("scheduling.identity_reveal.decrypt_failed", { reason: String(e) });
    return null;
  }
}

export async function revealPatientIdentities(args: {
  viewer: { userId: string; hospitalId: string; departmentId?: string | null };
  surface: string;
  patients: ReadonlyArray<RevealablePatient>;
  /** A clinical list (the doctor workspace): the basis is the care itself, so no `#operational`. */
  clinical?: boolean;
}): Promise<Map<string, RevealedPatient>> {
  const byId = new Map<string, RevealablePatient>();
  for (const p of args.patients) {
    if (p.patientUserId && !byId.has(p.patientUserId)) byId.set(p.patientUserId, p);
  }

  // The plaintext facts, before any reveal is attempted.
  const out = new Map<string, RevealedPatient>();
  for (const [id, p] of byId) {
    out.set(id, {
      displayName: null,
      photoUrl: null,
      ageYears: computeAgeYears(p.dateOfBirth),
      sex: p.sex,
    });
  }

  const names = new Map<string, string | null>();
  for (const [id, p] of byId) names.set(id, decryptName(p.firstNameEncrypted, p.surnameEncrypted));
  const revealing = [...byId].filter(([id, p]) => names.get(id) || p.avatarPath);
  if (revealing.length === 0) return out;

  try {
    await db.insert(clinicalPhiAccessLog).values(
      revealing.map(([patientUserId]) => ({
        hospitalId: args.viewer.hospitalId,
        clinicianUserId: args.viewer.userId,
        patientUserId,
        accessBasis: "department_recent" as const,
        surface: args.clinical ? args.surface : `${args.surface}${OPERATIONAL_BASIS_SUFFIX}`,
      })),
    );
  } catch (e) {
    // Fail closed: unaudited PHI is not shown. Codes, age and sex still render.
    logger.error("scheduling.identity_reveal.audit_failed", {
      reason: String(e),
      surface: args.surface,
      count: revealing.length,
    });
    return out;
  }

  const photos = new Map<string, string | null>();
  await Promise.all(
    [...new Set(revealing.map(([, p]) => p.avatarPath).filter((x): x is string => !!x))].map(
      async (path) => photos.set(path, await signedAvatarUrl(path)),
    ),
  );
  for (const [id, p] of revealing) {
    const row = out.get(id)!;
    row.displayName = names.get(id) ?? null;
    row.photoUrl = p.avatarPath ? (photos.get(p.avatarPath) ?? null) : null;
  }
  return out;
}

/** Pure: the card's shape from a row's code, its reveal and what the patient said is bothering them. */
export function toPatientIdentity(
  row: {
    patientUserId: string | null;
    patientCode: string | null;
    symptoms?: ReadonlyArray<BookingSymptom> | null;
    reasonNote?: string | null;
  },
  revealed: ReadonlyMap<string, RevealedPatient>,
): PatientIdentity {
  const who = row.patientUserId ? revealed.get(row.patientUserId) : undefined;
  return {
    patientCode: row.patientCode,
    displayName: who?.displayName ?? null,
    photoUrl: who?.photoUrl ?? null,
    ageYears: who?.ageYears ?? null,
    sex: who?.sex ?? null,
    complaint: complaintLine(normaliseSymptoms(row.symptoms), row.reasonNote),
  };
}
