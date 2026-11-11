import "server-only";

import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { staffReachable } from "@/lib/auth/reachable";
import { logger } from "@/lib/logger";

/**
 * Clinician workspace scope — single source of truth for "which
 * clinician is signed in and which hospital is their working context."
 *
 * A clinician can hold staff_affiliations at multiple hospitals.
 * For now, we pin to the most-recently-created **active** affiliation
 * (matches the hospital-admin shell's "pick most recent" approach).
 * A workspace switcher lands when multi-affiliation clinicians become
 * a real use case.
 *
 * Reachability: only an `active` (or `approved`) affiliation at a
 * `provisioning` or `active` hospital qualifies. Anything else bounces
 * to / (suspended, deactivated, or a hospital that's offboarded).
 */

export interface ClinicianScope {
  /** The signed-in clinician's user id. */
  userId: string;
  /** Their email — convenience for chrome. */
  userEmail: string;
  /** Their full name from public.users. */
  fullName: string | null;
  /** The currently-pinned affiliation row id. */
  affiliationId: string;
  /** The hospital that owns the active affiliation. */
  hospitalId: string;
  hospitalName: string;
  hospitalSlug: string;
  hospitalLevel: string;
  /** The department for this affiliation. */
  departmentId: string;
  departmentName: string;
  /** Affiliation state (`active` / `approved`). */
  affiliationState: string;
}

export async function requireClinicianScope(): Promise<ClinicianScope> {
  const state = await getAuthState();

  if (!state.user) redirect("/sign-in?redirect=/clinician");
  if (state.mfaRequired && state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/clinician");

  const rows = await db
    .select({
      affiliationId: staffAffiliations.id,
      affiliationState: staffAffiliations.state,
      hospitalId: hospitals.id,
      hospitalName: hospitals.name,
      hospitalSlug: hospitals.slug,
      hospitalLevel: hospitals.level,
      hospitalState: hospitals.state,
      userState: users.state,
      departmentId: hospitalDepartments.id,
      departmentName: hospitalDepartments.name,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .where(eq(staffAffiliations.userId, state.user.id))
    .orderBy(desc(staffAffiliations.createdAt));

  if (rows.length === 0) {
    logger.warn("clinician.scope.no_affiliation", { user_id: state.user.id });
    redirect("/");
  }

  const reachable = rows.find(staffReachable);
  if (!reachable) {
    logger.warn("clinician.scope.no_reachable_affiliation", {
      user_id: state.user.id,
      affiliation_states: rows.map((r) => r.affiliationState),
    });
    redirect("/onboarding/clinical-pending");
  }

  // Pull the fullName from public.users (the trigger keeps it in
  // sync with auth.users.raw_user_meta_data.full_name).
  const [me] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, state.user.id))
    .limit(1);

  return {
    userId: state.user.id,
    userEmail: state.user.email ?? "clinician",
    fullName: me?.fullName ?? null,
    affiliationId: reachable.affiliationId,
    hospitalId: reachable.hospitalId,
    hospitalName: reachable.hospitalName,
    hospitalSlug: reachable.hospitalSlug,
    hospitalLevel: reachable.hospitalLevel,
    departmentId: reachable.departmentId,
    departmentName: reachable.departmentName,
    affiliationState: reachable.affiliationState,
  };
}
