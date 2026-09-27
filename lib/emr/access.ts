import "server-only";

import type { EmrTx } from "./db";
import { sql } from "drizzle-orm";

import { clinicalPhiAccessLog } from "@/db/schema";

/**
 * The one patient-access rule (HARMONISATION §2), asked of the database rather than re-derived in
 * TypeScript: `private.patient_access_basis(user, patient, hospital)`, strongest basis first.
 * EXECUTE is the owner's only, so call this inside `asClinicalWriter` (or any owner transaction).
 */
export type EmrAccessBasis =
  | "active_encounter"
  | "assigned"
  | "open_intake"
  | "department_recent"
  | "care_team"
  | "break_glass";

export type EmrAccess = { allowed: true; basis: EmrAccessBasis } | { allowed: false; basis: null };

export async function resolveEmrAccess(
  tx: EmrTx,
  input: { userId: string; patientUserId: string; hospitalId: string },
): Promise<EmrAccess> {
  const rows = (await tx.execute(
    sql`SELECT private.patient_access_basis(${input.userId}::uuid, ${input.patientUserId}::uuid, ${input.hospitalId}::uuid) AS basis`,
  )) as unknown as { rows?: { basis: string | null }[] } | { basis: string | null }[];
  // postgres-js returns the rows array; PGlite returns { rows }.
  const basis = (Array.isArray(rows) ? rows : (rows.rows ?? []))[0]?.basis ?? null;
  return basis
    ? { allowed: true, basis: basis as EmrAccessBasis }
    : { allowed: false, basis: null };
}

/** AUDIT-ON-READ: one row per chart read, written after the authorised fetch succeeds (the shape
 *  of lib/encounter/record.ts), carrying the true basis 0071 lets the log hold. */
export async function logChartAccess(
  tx: EmrTx,
  input: {
    hospitalId: string;
    userId: string;
    patientUserId: string;
    basis: EmrAccessBasis;
    surface: string;
    requestId?: string;
  },
): Promise<void> {
  await tx.insert(clinicalPhiAccessLog).values({
    hospitalId: input.hospitalId,
    clinicianUserId: input.userId,
    patientUserId: input.patientUserId,
    accessBasis: input.basis,
    surface: input.surface,
    requestId: input.requestId,
  });
}
