import "server-only";

import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { wardInChargeAssignments } from "@/db/schema/nurse-workspace";
import { cadreGrades, cadres, roles } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { reachableAffiliation } from "@/lib/auth/reachable";
import { logger } from "@/lib/logger";

/**
 * Nurse workspace scope. The single source of truth for "who is the
 * signed-in nurse, at which hospital, in which cadre/grade/ward, and
 * whether they hold ward-in-charge."
 *
 * Resolution:
 *   - Auth + AAL2 (MFA mandatory for clinicians).
 *   - Most-recent active/approved staff_affiliations row whose cadre is
 *     in the UNMC nursing set. Non-nursing cadres bounce — they get
 *     their own workspace (doctor / generic clinician).
 *   - Ward-in-charge overlay (active ward_in_charge_assignments row).
 */

export const NURSE_CADRE_CODES = ["NURSE", "MIDWIFE", "SPECIALIST_NURSE"] as const;
export type NurseCadreCode = (typeof NURSE_CADRE_CODES)[number];

export const NURSE_GRADE_CODES = ["ENROLLED", "REGISTERED", "SPECIALIST"] as const;
export type NurseGradeCode = (typeof NURSE_GRADE_CODES)[number];

export interface NurseScope {
  userId: string;
  userEmail: string;
  fullName: string | null;

  affiliationId: string;
  hospitalId: string;
  hospitalName: string;
  hospitalLevel: string;
  departmentId: string;
  departmentName: string;

  cadreId: string;
  cadreCode: NurseCadreCode;
  cadreName: string;
  cadreGradeCode: NurseGradeCode | null;
  roleId: string;
  roleCode: string;
  roleName: string;

  /** Computed grade-derived flags. */
  isEnrolled: boolean;
  isRegistered: boolean;
  isSpecialist: boolean;
  isMidwife: boolean;

  /** Ward-in-charge overlay — currently holds the in-charge assignment
   * for at least one ward at this hospital. */
  isInCharge: boolean;
  /** When isInCharge, the wards they're in-charge of. */
  inChargeWardIds: string[];
}

export async function requireNurseScope(): Promise<NurseScope> {
  const state = await getAuthState();
  if (!state.user) redirect("/sign-in?redirect=/nurse");
  if (state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/nurse");

  const [me] = await db
    .select({
      affiliationId: staffAffiliations.id,
      hospitalId: staffAffiliations.hospitalId,
      hospitalName: hospitals.name,
      hospitalLevel: hospitals.level,
      departmentId: staffAffiliations.departmentId,
      departmentName: hospitalDepartments.name,
      cadreId: staffAffiliations.cadreId,
      cadreCode: cadres.code,
      cadreName: cadres.name,
      cadreGradeId: staffAffiliations.cadreGradeId,
      cadreGradeCode: cadreGrades.code,
      roleId: staffAffiliations.roleId,
      roleCode: roles.code,
      roleName: roles.name,
      fullName: users.fullName,
      userEmail: users.email,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .leftJoin(cadreGrades, eq(cadreGrades.id, staffAffiliations.cadreGradeId))
    .innerJoin(roles, eq(roles.id, staffAffiliations.roleId))
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .where(
      and(
        eq(staffAffiliations.userId, state.user.id),
        reachableAffiliation(),
        inArray(cadres.code, NURSE_CADRE_CODES as unknown as string[]),
      ),
    )
    .orderBy(desc(staffAffiliations.approvedAt), desc(staffAffiliations.createdAt))
    .limit(1);

  if (!me) {
    logger.warn("nurse.scope.no_active_nursing_affiliation", { user_id: state.user.id });
    // Not a nurse — bounce to /clinician (the generic shell handles
    // any other clinical role).
    redirect("/clinician");
  }

  // In-charge overlay: active ward_in_charge_assignments rows at this hospital.
  const wicRows = await db
    .select({ wardId: wardInChargeAssignments.wardId })
    .from(wardInChargeAssignments)
    .where(
      and(
        eq(wardInChargeAssignments.nurseUserId, state.user.id),
        eq(wardInChargeAssignments.hospitalId, me.hospitalId),
        isNull(wardInChargeAssignments.endsAt),
      ),
    );

  const cadreCode = me.cadreCode as NurseCadreCode;
  const cadreGradeCode = (me.cadreGradeCode as NurseGradeCode | null) ?? null;

  return {
    userId: state.user.id,
    userEmail: me.userEmail ?? state.user.email ?? "nurse",
    fullName: me.fullName,
    affiliationId: me.affiliationId,
    hospitalId: me.hospitalId,
    hospitalName: me.hospitalName,
    hospitalLevel: me.hospitalLevel,
    departmentId: me.departmentId,
    departmentName: me.departmentName,
    cadreId: me.cadreId,
    cadreCode,
    cadreName: me.cadreName,
    cadreGradeCode,
    roleId: me.roleId,
    roleCode: me.roleCode,
    roleName: me.roleName,
    isEnrolled: cadreGradeCode === "ENROLLED",
    isRegistered: cadreGradeCode === "REGISTERED",
    isSpecialist: cadreGradeCode === "SPECIALIST" || cadreCode === "SPECIALIST_NURSE",
    isMidwife: cadreCode === "MIDWIFE",
    isInCharge: wicRows.length > 0,
    inChargeWardIds: wicRows.map((r) => r.wardId),
  };
}
