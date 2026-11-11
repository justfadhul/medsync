import "server-only";

import type { PharmacyAccess } from "@/lib/pharmacy/access";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { cadres } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { reachableAffiliation } from "@/lib/auth/reachable";
import { logger } from "@/lib/logger";
import { can, PHARMACY_MAP_CADRES, pharmacyAccess } from "@/lib/pharmacy/access";
import { pharmacyWorkspaceLiveFor, tier } from "@/lib/pharmacy/feature";

/**
 * Pharmacy workspace scope (Pharmacy Phase 0, PA-3, PA-6). Who is the signed-in pharmacy
 * professional, at which hospital and department, in which approved cadre, with which pharmacy
 * permissions. The hospital comes from the affiliation, never from the client. With
 * PHARMACY_WORKSPACE off for that hospital, /pharmacy is not found (5.10); without `pharmacy.view`,
 * the not-authorised page.
 */
export interface PharmacyScope {
  userId: string;
  fullName: string | null;
  userEmail: string | null;
  affiliationId: string;
  hospitalId: string;
  hospitalName: string;
  /** The affiliation's department: Pharmacy itself, or one of its units (a dispensing point). */
  departmentId: string;
  departmentName: string | null;
  departmentParentCode: string | null;
  cadreCode: string;
  /** The approved cadre's own name: the only title a pharmacy screen shows (Law 4). */
  cadreName: string;
  access: PharmacyAccess;
}

export async function requirePharmacyScope(): Promise<PharmacyScope> {
  const state = await getAuthState();
  if (!state.user) redirect("/sign-in?redirect=/pharmacy");
  // AAL2 for every clinical workspace, pharmacy staff included (Law 14).
  if (state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/pharmacy");

  const me = await findPharmacyAffiliation(state.user.id);
  if (!me) {
    if (!tier("CORE", "WORKSPACE")?.trim()) notFound();
    logger.warn("pharmacy.scope.no_pharmacy_affiliation", { user_id: state.user.id });
    redirect("/not-authorised?for=pharmacy");
  }
  if (!pharmacyWorkspaceLiveFor(me.hospitalId)) notFound();

  const access = pharmacyAccess(me.cadreCode);
  if (!can(access, "pharmacy.view")) {
    logger.warn("pharmacy.scope.no_pharmacy_view", { user_id: state.user.id });
    redirect("/not-authorised?for=pharmacy");
  }

  return { userId: state.user.id, ...me, access };
}

/**
 * True when the user's pharmacy affiliation is at a hospital with the pharmacy workspace on: the
 * /clinician guard sends them to /pharmacy (LD-P4). Same query as the gate above, so the two cannot
 * bounce a user back and forth.
 */
export async function isPharmacyUser(userId: string): Promise<boolean> {
  const me = await findPharmacyAffiliation(userId);
  return !!me && pharmacyWorkspaceLiveFor(me.hospitalId);
}

const parentDepartment = alias(hospitalDepartments, "parent_department");

async function findPharmacyAffiliation(userId: string) {
  const [me] = await db
    .select({
      affiliationId: staffAffiliations.id,
      hospitalId: staffAffiliations.hospitalId,
      hospitalName: hospitals.name,
      departmentId: staffAffiliations.departmentId,
      departmentName: hospitalDepartments.name,
      departmentParentCode: parentDepartment.catalogueCode,
      cadreCode: cadres.code,
      cadreName: cadres.name,
      fullName: users.fullName,
      userEmail: users.email,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .leftJoin(parentDepartment, eq(parentDepartment.id, hospitalDepartments.parentId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .where(
      and(
        eq(staffAffiliations.userId, userId),
        reachableAffiliation(),
        inArray(cadres.code, [...PHARMACY_MAP_CADRES]),
      ),
    )
    .orderBy(desc(staffAffiliations.approvedAt), desc(staffAffiliations.createdAt))
    .limit(1);
  return me;
}
