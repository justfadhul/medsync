import "server-only";

import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitals } from "@/db/schema/hospitals";
import { cadres, roles } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { reachableAffiliation } from "@/lib/auth/reachable";
import { logger } from "@/lib/logger";

/**
 * Reception workspace scope. The single source of truth for "who is
 * the signed-in receptionist, at which hospital."
 *
 * Resolution:
 *   - Auth + AAL2 (MFA mandatory for clinical roles AND reception —
 *     reception touches identifiable patient data).
 *   - Most-recent active/approved staff_affiliations row whose cadre
 *     is RECEPTION. Non-reception cadres bounce — they get their own
 *     workspace.
 *
 * Reception is NON-CLINICAL: the cadre row has is_clinical = false,
 * and the clinical-content RLS policies require is_clinical = true.
 * So even though this scope helper grants access to /reception, the
 * DB itself denies clinical reads. The boundary is the design.
 */

export const RECEPTION_CADRE_CODE = "RECEPTION";

export interface ReceptionScope {
  userId: string;
  userEmail: string;
  fullName: string | null;

  affiliationId: string;
  hospitalId: string;
  hospitalName: string;
  hospitalLevel: string;

  cadreId: string;
  cadreCode: "RECEPTION";
  cadreName: string;
  roleId: string;
  roleName: string;
}

export async function requireReceptionScope(): Promise<ReceptionScope> {
  const state = await getAuthState();
  if (!state.user) redirect("/sign-in?redirect=/reception");
  if (state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/reception");

  const [me] = await db
    .select({
      affiliationId: staffAffiliations.id,
      hospitalId: staffAffiliations.hospitalId,
      hospitalName: hospitals.name,
      hospitalLevel: hospitals.level,
      cadreId: staffAffiliations.cadreId,
      cadreCode: cadres.code,
      cadreName: cadres.name,
      roleId: staffAffiliations.roleId,
      roleName: roles.name,
      fullName: users.fullName,
      userEmail: users.email,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .innerJoin(roles, eq(roles.id, staffAffiliations.roleId))
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .where(
      and(
        eq(staffAffiliations.userId, state.user.id),
        eq(cadres.code, RECEPTION_CADRE_CODE),
        reachableAffiliation(),
      ),
    )
    .orderBy(desc(staffAffiliations.approvedAt), desc(staffAffiliations.createdAt))
    .limit(1);

  if (!me) {
    logger.warn("reception.scope.no_active_reception_affiliation", { user_id: state.user.id });
    redirect("/");
  }

  return {
    userId: state.user.id,
    userEmail: me.userEmail ?? state.user.email ?? "reception",
    fullName: me.fullName,
    affiliationId: me.affiliationId,
    hospitalId: me.hospitalId,
    hospitalName: me.hospitalName,
    hospitalLevel: me.hospitalLevel,
    cadreId: me.cadreId,
    cadreCode: "RECEPTION",
    cadreName: me.cadreName,
    roleId: me.roleId,
    roleName: me.roleName,
  };
}
