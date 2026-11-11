import "server-only";

import type { TriageAuthority } from "@/lib/triage/authority";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { clinicalCosignPolicies } from "@/db/schema/doctor-workspace";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { cadres, roles } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { reachableAffiliation } from "@/lib/auth/reachable";
import { logger } from "@/lib/logger";
import { resolveTriageAuthority } from "@/lib/triage/authority";

/**
 * Triage scope. Resolves the signed-in clinical user who may triage,
 * at which hospital/department, with their authority (R1) precomputed
 * from that hospital's clinical_cosign_policies rows.
 *
 * Triage is a CLINICAL act: only cadres with cadres.is_clinical = true
 * AND a triage_patient=allowed policy row qualify. Reception bounces
 * here AND at the DB (triage_records RLS). AAL2 mandatory.
 */
export interface TriageScope {
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
  authority: TriageAuthority;
}

export async function requireTriageScope(): Promise<TriageScope> {
  const state = await getAuthState();
  if (!state.user) redirect("/sign-in?redirect=/nurse/triage");
  if (state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/nurse/triage");

  const [me] = await db
    .select({
      affiliationId: staffAffiliations.id,
      hospitalId: staffAffiliations.hospitalId,
      hospitalName: hospitals.name,
      departmentId: staffAffiliations.departmentId,
      departmentName: hospitalDepartments.name,
      cadreCode: cadres.code,
      cadreName: cadres.name,
      isClinical: cadres.isClinical,
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
    logger.warn("triage.scope.no_clinical_affiliation", { user_id: state.user!.id });
    redirect("/");
  }

  // Authority from this hospital's policy rows (R1).
  const policyRows = await db
    .select({
      cadreCode: clinicalCosignPolicies.cadreCode,
      actionKind: clinicalCosignPolicies.actionKind,
      requirement: clinicalCosignPolicies.requirement,
    })
    .from(clinicalCosignPolicies)
    .where(
      and(
        eq(clinicalCosignPolicies.hospitalId, me!.hospitalId),
        inArray(clinicalCosignPolicies.actionKind, ["triage_patient", "triage_downgrade"]),
      ),
    );

  const authority = resolveTriageAuthority(
    me!.cadreCode,
    policyRows.map((r) => ({
      cadreCode: r.cadreCode,
      actionKind: r.actionKind,
      requirement: r.requirement as "allowed" | "cosign_required" | "blocked",
    })),
  );

  if (!authority.mayTriage) {
    logger.warn("triage.scope.not_authorised", { user_id: state.user!.id, cadre: me!.cadreCode });
    redirect("/nurse");
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
    authority,
  };
}
