import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { cadres, roles } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * Doctor workspace scope. The single source of truth for "who is the
 * signed-in doctor, at which hospital, in which cadre, with which
 * department + role." Used by every doctor surface.
 *
 * Resolution:
 *   - Auth + AAL2 (MFA mandatory for clinicians).
 *   - Most-recent ACTIVE staff_affiliations row whose cadre is in the
 *     UMDPC doctor set. Other cadres bounce — they get the generic
 *     /clinician workspace, not /doctor.
 *   - The doctor's display name (users.fullName).
 *
 * Multi-affiliation: today we pin to the most-recent. A workspace
 * switcher for doctors holding >1 affiliation is a polish ticket.
 */

/** Junior cadres — these are the ones whose flagged actions can route to co-sign. */
export const JUNIOR_CADRE_CODES = ["INTERN_DOCTOR", "CLINICAL_OFFICER"] as const;

/** Senior cadres — these can review + co-sign. */
export const SENIOR_CADRE_CODES = [
  "MEDICAL_OFFICER",
  "MEDICAL_OFFICER_SG",
  "CONSULTANT",
  "SENIOR_CONSULTANT",
] as const;

/**
 * Every cadre the doctor workspace serves: the juniors (co-signed) and the
 * seniors (independent), exactly ADR 0027's matrix — the Clinical Officer
 * included. Derived, never hand-listed: sign-in routing and this scope read
 * the same constant, so a cadre can no longer pass one and fail the other
 * (a Clinical Officer did, and landed on /clinician/availability).
 */
export const DOCTOR_CADRE_CODES = [...JUNIOR_CADRE_CODES, ...SENIOR_CADRE_CODES] as const;

export type DoctorCadreCode = (typeof DOCTOR_CADRE_CODES)[number];

export interface DoctorScope {
  userId: string;
  userEmail: string;
  fullName: string | null;
  /** `users.avatar_path` — storage key of their photo, or null (ADR 0085 §1). */
  avatarPath: string | null;

  affiliationId: string;
  hospitalId: string;
  hospitalName: string;
  hospitalLevel: string;
  departmentId: string;
  departmentName: string;

  cadreId: string;
  cadreCode: DoctorCadreCode;
  cadreName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  specialtyId: string | null;

  /** Computed from cadre — used by UI affordances. */
  isJunior: boolean;
  /** Computed from cadre — used by UI affordances (co-sign queue, supervisees). */
  isSenior: boolean;
  /** True for MOSG / Consultant / Senior Consultant. */
  isConsultantLevel: boolean;
}

/**
 * Cached per request (React `cache`): the doctor layout, the page and the
 * workspace redirects of one render share one read. A redirect thrown by the
 * first call is thrown to every caller in that render, as it should be.
 */
export const requireDoctorScope = cache(async function requireDoctorScope(): Promise<DoctorScope> {
  const state = await getAuthState();
  if (!state.user) redirect("/sign-in?redirect=/doctor");

  // MFA is mandatory for clinicians (MFA_REQUIRED_ROLES already
  // includes 'clinician'). Mirror the gate.
  if (state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/doctor");

  const me = await findDoctorAffiliation(state.user.id);

  if (!me) {
    logger.warn("doctor.scope.no_active_doctor_affiliation", { user_id: state.user.id });
    // Not a doctor — send to the generic clinician workspace if they
    // have any other clinical role; otherwise to the landing.
    redirect("/clinician");
  }

  const cadreCode = me.cadreCode as DoctorCadreCode;
  const isJunior = (JUNIOR_CADRE_CODES as ReadonlyArray<string>).includes(cadreCode);
  const isSenior = (SENIOR_CADRE_CODES as ReadonlyArray<string>).includes(cadreCode);
  const isConsultantLevel = ["MEDICAL_OFFICER_SG", "CONSULTANT", "SENIOR_CONSULTANT"].includes(
    cadreCode,
  );

  return {
    userId: state.user.id,
    userEmail: me.userEmail ?? state.user.email ?? "doctor",
    fullName: me.fullName,
    avatarPath: me.avatarPath,
    affiliationId: me.affiliationId,
    hospitalId: me.hospitalId,
    hospitalName: me.hospitalName,
    hospitalLevel: me.hospitalLevel,
    departmentId: me.departmentId,
    departmentName: me.departmentName,
    cadreId: me.cadreId,
    cadreCode,
    cadreName: me.cadreName,
    roleId: me.roleId,
    roleCode: me.roleCode,
    roleName: me.roleName,
    specialtyId: me.specialtyId,
    isJunior,
    isSenior,
    isConsultantLevel,
  };
});

/**
 * The affiliation that makes someone a doctor here — most recent, active or
 * approved, in a doctor cadre, with its hospital, department, cadre and role
 * rows present. requireDoctorScope and isDoctorUser share it, so the doctor
 * gate and the /clinician guard can never disagree and bounce a user between
 * the two workspaces.
 */
async function findDoctorAffiliation(userId: string) {
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
      roleId: staffAffiliations.roleId,
      roleCode: roles.code,
      roleName: roles.name,
      specialtyId: staffAffiliations.specialtyId,
      fullName: users.fullName,
      userEmail: users.email,
      avatarPath: users.avatarPath,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .innerJoin(roles, eq(roles.id, staffAffiliations.roleId))
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .where(
      and(
        eq(staffAffiliations.userId, userId),
        inArray(staffAffiliations.state, ["active", "approved"]),
        inArray(cadres.code, DOCTOR_CADRE_CODES as unknown as string[]),
      ),
    )
    .orderBy(desc(staffAffiliations.approvedAt), desc(staffAffiliations.createdAt))
    .limit(1);
  return me;
}

/** True when the user would pass requireDoctorScope — the /clinician guard sends them to /doctor. */
export async function isDoctorUser(userId: string): Promise<boolean> {
  return (await findDoctorAffiliation(userId)) !== undefined;
}
