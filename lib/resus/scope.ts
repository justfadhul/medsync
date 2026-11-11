import "server-only";

import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { cadres, roles } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { reachableAffiliation } from "@/lib/auth/reachable";
import { logger } from "@/lib/logger";

/**
 * Resus scope. A resuscitation is a whole-team act — ANY active clinical
 * staff member at the hospital may open/participate (nurses trigger;
 * doctors lead). This resolves the signed-in clinical user + their
 * hospital/department + cadre, and a SOFT `leaderRecommended` flag
 * (doctor / clinical-officer cadres). Leadership is recommended, never
 * hard-gated — you must never block a role grab mid-resus (§D.2).
 *
 * Reception (is_clinical=false) bounces here AND at the DB (resus RLS).
 * AAL2 mandatory, same as triage.
 */

/** Cadres for whom the `leader` role is recommended (soft). */
export const RESUS_LEADER_CADRE_CODES = [
  "INTERN_DOCTOR",
  "MEDICAL_OFFICER",
  "MEDICAL_OFFICER_SG",
  "CONSULTANT",
  "SENIOR_CONSULTANT",
  "CLINICAL_OFFICER",
] as const;

export interface ResusScope {
  userId: string;
  fullName: string | null;
  affiliationId: string;
  hospitalId: string;
  hospitalName: string;
  departmentId: string;
  departmentName: string;
  cadreCode: string;
  cadreName: string;
  roleName: string;
  /** Soft: this cadre is recommended for the team-leader role. */
  leaderRecommended: boolean;
}

export async function requireResusScope(redirectTo = "/nurse"): Promise<ResusScope> {
  const state = await getAuthState();
  if (!state.user) redirect(`/sign-in?redirect=${encodeURIComponent(redirectTo)}`);
  if (state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect(`/sign-in/mfa?redirect=${encodeURIComponent(redirectTo)}`);

  const [me] = await db
    .select({
      affiliationId: staffAffiliations.id,
      hospitalId: staffAffiliations.hospitalId,
      hospitalName: hospitals.name,
      departmentId: staffAffiliations.departmentId,
      departmentName: hospitalDepartments.name,
      cadreCode: cadres.code,
      cadreName: cadres.name,
      roleName: roles.name,
      fullName: users.fullName,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .innerJoin(roles, eq(roles.id, staffAffiliations.roleId))
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .where(
      and(
        eq(staffAffiliations.userId, state.user!.id),
        eq(cadres.isClinical, true),
        reachableAffiliation(),
      ),
    )
    .orderBy(desc(staffAffiliations.approvedAt), desc(staffAffiliations.createdAt))
    .limit(1);

  if (!me) {
    logger.warn("resus.scope.no_clinical_affiliation", { user_id: state.user!.id });
    redirect("/");
  }

  return {
    userId: state.user!.id,
    fullName: me!.fullName,
    affiliationId: me!.affiliationId,
    hospitalId: me!.hospitalId,
    hospitalName: me!.hospitalName,
    departmentId: me!.departmentId,
    departmentName: me!.departmentName,
    cadreCode: me!.cadreCode,
    cadreName: me!.cadreName,
    roleName: me!.roleName,
    leaderRecommended: (RESUS_LEADER_CADRE_CODES as readonly string[]).includes(me!.cadreCode),
  };
}
