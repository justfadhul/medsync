import "server-only";

import type { LabAccess } from "@/lib/lab/access";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { cadres, roles } from "@/db/schema/reference-data";
import { departmentHeads } from "@/db/schema/services-hub";
import { users } from "@/db/schema/users";
import { getAuthState } from "@/lib/auth";
import { reachableAffiliation } from "@/lib/auth/reachable";
import { can, labAccess } from "@/lib/lab/access";
import { labWorkspaceLiveFor } from "@/lib/lab/feature";
import { logger } from "@/lib/logger";

/**
 * Laboratory-technician workspace scope. The single source of truth for "who is
 * the signed-in lab tech, at which hospital + department, in which cadre." Mirrors
 * the doctor/nurse scope pattern (auth + AAL2/MFA, most-recent active affiliation,
 * server-enforced cadre — never hardcoded on the client).
 *
 * GATE A (CSO-signed 2026-06-14): the lab cadres register under the AHPC branch
 * (LAB_TECH / LAB_TECHNOLOGIST — already seeded), and the cadre is is_clinical, so
 * the tech acts on orders/results under the existing clinical-relationship RLS,
 * department-scoped. A non-lab user who reaches /lab bounces to the landing.
 *
 * Lab Phase 0 (ADR 0221): the scope also carries the viewer's lab permissions (derived from the
 * signed cadre map and department headship), their lab sections, and whether the lab workspace is
 * on for their hospital. Where LAB_WORKSPACE is set, a user without `lab.view` gets the
 * not-authorised page instead of the landing; with it unset, /lab behaves as it always has.
 */

export const LAB_TECH_CADRE_CODES = ["LAB_TECH", "LAB_TECHNOLOGIST"] as const;
export type LabTechCadreCode = (typeof LAB_TECH_CADRE_CODES)[number];

export interface LabTechScope {
  userId: string;
  userEmail: string;
  fullName: string | null;

  affiliationId: string;
  hospitalId: string;
  hospitalName: string;
  hospitalLevel: string;
  /** The department the affiliation names (NOT NULL in the table): the Laboratory, or a section. */
  departmentId: string | null;
  departmentName: string | null;
  /** The viewer's lab sections: the affiliation's department when it is a unit of LABORATORY. */
  sectionIds: string[];

  /** Lab permissions and what lab.manage covers (lib/lab/access.ts). */
  access: LabAccess;
  /** LAB_WORKSPACE on for this hospital (the Phase 0 shell, worklist, lists and notice). */
  workspaceLive: boolean;

  cadreId: string;
  cadreCode: LabTechCadreCode;
  cadreName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
}

export async function requireLabTechScope(): Promise<LabTechScope> {
  const state = await getAuthState();
  if (!state.user) redirect("/sign-in?redirect=/lab");

  // MFA mandatory (MFA_REQUIRED_ROLES includes lab_tech) — mirror the gate.
  if (state.nextAal !== "aal2") redirect("/onboarding/mfa-setup");
  if (state.aal !== "aal2") redirect("/sign-in/mfa?redirect=/lab");

  const me = await findLabTechAffiliation(state.user.id);
  if (!me) {
    logger.warn("lab_tech.scope.no_active_affiliation", { user_id: state.user.id });
    redirect(process.env.LAB_WORKSPACE?.trim() ? "/not-authorised?for=lab" : "/");
  }

  const heads = await openLabHeadships(state.user.id, me.hospitalId);
  const access = labAccess({
    cadreCode: me.cadreCode,
    headOf: { laboratory: heads.laboratory, sectionIds: heads.sectionIds },
  });
  const workspaceLive = labWorkspaceLiveFor(me.hospitalId);
  if (workspaceLive && !can(access, "lab.view")) {
    logger.warn("lab_tech.scope.no_lab_view", { user_id: state.user.id });
    redirect("/not-authorised?for=lab");
  }

  return {
    userId: state.user.id,
    userEmail: me.userEmail ?? state.user.email ?? "lab-tech",
    fullName: me.fullName,
    affiliationId: me.affiliationId,
    hospitalId: me.hospitalId,
    hospitalName: me.hospitalName,
    hospitalLevel: me.hospitalLevel,
    departmentId: me.departmentId,
    departmentName: me.departmentName,
    sectionIds:
      me.departmentParentCode === "LABORATORY" && me.departmentId ? [me.departmentId] : [],
    access,
    workspaceLive,
    cadreId: me.cadreId,
    cadreCode: me.cadreCode as LabTechCadreCode,
    cadreName: me.cadreName,
    roleId: me.roleId,
    roleCode: me.roleCode,
    roleName: me.roleName,
  };
}

/**
 * True when the user has an active lab affiliation — the /clinician guard uses it so a lab tech
 * who lands there (a stale link, an old ?redirect=) goes to /lab. Same query as the gate above,
 * so the two cannot bounce a user back and forth.
 */
export async function isLabTechUser(userId: string): Promise<boolean> {
  return !!(await findLabTechAffiliation(userId));
}

const parentDepartment = alias(hospitalDepartments, "parent_department");

async function findLabTechAffiliation(userId: string) {
  const [me] = await db
    .select({
      affiliationId: staffAffiliations.id,
      hospitalId: staffAffiliations.hospitalId,
      hospitalName: hospitals.name,
      hospitalLevel: hospitals.level,
      departmentId: staffAffiliations.departmentId,
      departmentName: hospitalDepartments.name,
      departmentParentCode: parentDepartment.catalogueCode,
      cadreId: staffAffiliations.cadreId,
      cadreCode: cadres.code,
      cadreName: cadres.name,
      roleId: staffAffiliations.roleId,
      roleCode: roles.code,
      roleName: roles.name,
      fullName: users.fullName,
      userEmail: users.email,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .leftJoin(parentDepartment, eq(parentDepartment.id, hospitalDepartments.parentId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .innerJoin(roles, eq(roles.id, staffAffiliations.roleId))
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .where(
      and(
        eq(staffAffiliations.userId, userId),
        reachableAffiliation(),
        inArray(cadres.code, LAB_TECH_CADRE_CODES as unknown as string[]),
      ),
    )
    .orderBy(desc(staffAffiliations.approvedAt), desc(staffAffiliations.createdAt))
    .limit(1);
  return me;
}

/** Open department_heads rows over the Laboratory and its sections at this hospital (LA-5). */
async function openLabHeadships(
  userId: string,
  hospitalId: string,
): Promise<{ laboratory: boolean; sectionIds: string[] }> {
  const rows = await db
    .select({
      departmentId: departmentHeads.departmentId,
      code: hospitalDepartments.catalogueCode,
      parentCode: parentDepartment.catalogueCode,
    })
    .from(departmentHeads)
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, departmentHeads.departmentId))
    .leftJoin(parentDepartment, eq(parentDepartment.id, hospitalDepartments.parentId))
    .where(
      and(
        eq(departmentHeads.userId, userId),
        eq(departmentHeads.hospitalId, hospitalId),
        isNull(departmentHeads.endsAt),
        or(
          eq(hospitalDepartments.catalogueCode, "LABORATORY"),
          eq(parentDepartment.catalogueCode, "LABORATORY"),
        ),
      ),
    );
  return {
    laboratory: rows.some((r) => r.code === "LABORATORY"),
    sectionIds: rows.filter((r) => r.parentCode === "LABORATORY").map((r) => r.departmentId),
  };
}
