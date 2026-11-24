import "server-only";

import { and, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { saBreakGlassGrants } from "@/db/schema/sa-break-glass-grants";
import { appointments, encounters } from "@/db/schema/scheduling";

/**
 * Legitimate-access resolver for the encounter / EMR engine.
 *
 * This is the kickoff §2 access basis ("never any clinician sees any patient")
 * implemented as the engine's enforcement so every consumer inherits it. It is
 * deliberately the SAME basis vocabulary + ordering the doctor workspace already
 * uses (`lib/doctor/patient-access.ts`) and the nurse workspace maps onto
 * (`lib/nurse/patient-access.ts`), and it logs PHI reads to the SAME canonical
 * table (`clinical_phi_access_log`). The doctor/nurse resolvers should converge
 * to delegate here in a later pass; for now this mirrors them exactly so there
 * is one model, not two.
 *
 * ⚠️ The engine's reads/writes run through the service-role Drizzle client, which
 * BYPASSES RLS — so the basis MUST be resolved in application code on every
 * clinical read/write. RLS is necessary-but-not-sufficient for these paths.
 *
 * Bases, strongest first:
 *   - active_encounter  — the clinician has an in-progress encounter with this
 *                         patient (the clerking / live-care case).
 *   - department_recent — the patient has an appointment or encounter in the
 *                         clinician's department within the window (ward /
 *                         cross-cover case).
 *   - break_glass       — an unrevoked, unexpired emergency grant (audited).
 *   - care_team         — SEAM: the care-team table arrives with that module;
 *                         this branch is always false today.
 */

export type AccessBasis = "care_team" | "active_encounter" | "department_recent" | "break_glass";

export interface EncounterAccessDecision {
  allowed: boolean;
  basis: AccessBasis | null;
}

const DEPARTMENT_WINDOW_DAYS = 30;

export async function resolveEncounterAccess(args: {
  userId: string;
  /** The clinician's department (drives `department_recent`); null skips it. */
  departmentId: string | null;
  patientUserId: string;
}): Promise<EncounterAccessDecision> {
  // active_encounter — the clinician is mid-encounter with this patient.
  const [activeEnc] = await db
    .select({ id: encounters.id })
    .from(encounters)
    .where(
      and(
        eq(encounters.clinicianUserId, args.userId),
        eq(encounters.patientUserId, args.patientUserId),
        inArray(encounters.state, ["in_progress"]),
      ),
    )
    .limit(1);
  if (activeEnc) return { allowed: true, basis: "active_encounter" };

  // department_recent — patient seen in the clinician's department in-window.
  if (args.departmentId) {
    const since = new Date();
    since.setDate(since.getDate() - DEPARTMENT_WINDOW_DAYS);

    const [recentAppt] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.patientUserId, args.patientUserId),
          eq(appointments.departmentId, args.departmentId),
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
          eq(encounters.departmentId, args.departmentId),
          gte(encounters.startedAt, since),
        ),
      )
      .limit(1);
    if (recentEnc) return { allowed: true, basis: "department_recent" };
  }

  // break_glass — audited emergency out-of-relationship access.
  const [grant] = await db
    .select({ id: saBreakGlassGrants.id })
    .from(saBreakGlassGrants)
    .where(
      and(
        eq(saBreakGlassGrants.actorId, args.userId),
        eq(saBreakGlassGrants.patientId, args.patientUserId),
        isNull(saBreakGlassGrants.revokedAt),
        gt(saBreakGlassGrants.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  if (grant) return { allowed: true, basis: "break_glass" };

  // care_team — SEAM (table arrives with the care-team module).
  // Stays a seam: request recipients open the chart via loadChart → resolveEmrAccess (0306, needs EMR v1).
  return { allowed: false, basis: null };
}
