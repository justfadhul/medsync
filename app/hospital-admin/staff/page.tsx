import type { StaffTab } from "./_components/staff-tabs";
import type { Metadata } from "next";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { clinicianProfiles, staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitalStaffInvitations } from "@/db/schema/hospital-staff-invitations";
import { cadreGrades, cadres, councils, roles, specialties } from "@/db/schema/reference-data";
import { staffIdentityProfiles } from "@/db/schema/staff-identity-profiles";
import { users } from "@/db/schema/users";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { DirectoryTable } from "./_components/directory-table";
import { InvitationsPanel } from "./_components/invitations-panel";
import { PendingQueue } from "./_components/pending-queue";
import { StaffTabs } from "./_components/staff-tabs";

export const metadata: Metadata = {
  title: "Staff · Hospital Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ tab?: string; aff?: string }>;
}

/**
 * Staff Management — the daily admin surface.
 *
 * Three tabs (driven by ?tab=…):
 *   - pending   — pending_approval affiliations awaiting triage
 *   - directory — every staff member at this hospital, with filters
 *   - invites   — outstanding + completed staff invitations
 *
 * Server-rendered data fetch; client components handle the panel /
 * actions. The whole page re-renders cleanly on a Server Action
 * revalidation because we use force-dynamic + revalidatePath in
 * actions.ts.
 *
 * GATE B ships the Pending tab + slide-out evidence + approve / reject /
 * request-info actions. The Directory and Invites tabs are wired but
 * render thin placeholders for GATE C / D to land into without
 * touching this file.
 */
export default async function StaffPage({ searchParams }: PageProps) {
  const scope = await requireHospitalAdminScope();
  const params = await searchParams;
  const activeTab: StaffTab =
    params.tab === "directory" || params.tab === "invites" ? params.tab : "pending";

  const [pendingRows, directoryRows, departments, hospitalRoles, invitations] = await Promise.all([
    fetchPendingAffiliations(scope.hospitalId),
    activeTab === "directory" ? fetchDirectoryAffiliations(scope.hospitalId) : Promise.resolve([]),
    activeTab === "directory" ? fetchHospitalDepartments(scope.hospitalId) : Promise.resolve([]),
    activeTab === "directory" ? fetchHospitalRoles() : Promise.resolve([]),
    activeTab === "invites" ? fetchInvitations(scope.hospitalId) : Promise.resolve([]),
  ]);

  return (
    <div className="stagger-children mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex w-fit items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-brand-500 ring-brand-500/20 size-1 rounded-full ring-2" />
          {scope.hospitalName} · Staff
        </span>
        <h1 className="font-display text-foreground sm:text-heading-l text-[24px] leading-[1.15] font-medium tracking-[-0.015em]">
          Staff
        </h1>
        <p className="text-muted-foreground max-w-2xl text-[13.5px] leading-relaxed">
          Triage pending affiliations, manage your active directory, and invite staff to join. Every
          action is scoped to {scope.hospitalName} and audited.
        </p>
        <div className="bg-brand-500/60 dark:bg-brand-400/50 h-px w-10" aria-hidden />
      </header>

      <StaffTabs activeTab={activeTab} pendingCount={pendingRows.length} />

      {/* Keyed wrapper per tab → the panel reveals when the tab changes
          instead of popping. Presentation only. */}
      {activeTab === "pending" ? (
        <div key="tab-pending" className="reveal-up">
          <PendingQueue rows={pendingRows} selectedAffiliationId={params.aff ?? null} />
        </div>
      ) : null}

      {activeTab === "directory" ? (
        <div key="tab-directory" className="reveal-up">
          <DirectoryTable
            rows={directoryRows}
            selectedAffiliationId={params.aff ?? null}
            allDepartments={departments}
            allRoles={hospitalRoles}
          />
        </div>
      ) : null}

      {activeTab === "invites" ? (
        <div key="tab-invites" className="reveal-up">
          <InvitationsPanel rows={invitations} />
        </div>
      ) : null}
    </div>
  );
}

/* ─── Data fetchers ────────────────────────────────────────────────── */

export interface PendingAffiliationRow {
  id: string;
  fullName: string;
  email: string;
  /** Drives which evidence block the panel renders. Clinical → council
   * + licence. Non-clinical → NIN-on-file + appointment letter +
   * authorising officer. Migration 0033 added cadres.is_clinical for
   * this. */
  isClinical: boolean;
  cadreName: string;
  cadreGradeName: string | null;
  roleName: string;
  departmentName: string;
  specialtyName: string | null;
  employmentType: string;
  reviewNote: string | null;
  createdAtIso: string;
  /** Days since submission, computed server-side at fetch time.
   * The client renders this as the aging chip without calling
   * Date.now() during render (which React's new purity rules flag). */
  daysSinceSubmission: number;

  // Clinical-only fields (null for non-clinical applicants).
  councilName: string | null;
  /** e.g. "UMDPC" — drives the register link in the approval sheet. */
  councilCode: string | null;
  registrationNumber: string | null;
  registrationExpiry: string | null;
  licenceDocumentPath: string | null;

  // Non-clinical-only fields (null for clinical applicants).
  ninOnFile: boolean;
  staffNumber: string | null;
  appointmentLetterPath: string | null;
  authorisingOfficerName: string | null;
  authorisingOfficerRole: string | null;
}

async function fetchPendingAffiliations(hospitalId: string): Promise<PendingAffiliationRow[]> {
  // LEFT joins on the cadre-conditional rows so non-clinical applicants
  // (no clinician_profiles row, no council on cadre, but has a
  // staff_identity_profiles row) still surface in this queue.
  const rows = await db
    .select({
      id: staffAffiliations.id,
      employmentType: staffAffiliations.employmentType,
      reviewNote: staffAffiliations.reviewNote,
      createdAt: staffAffiliations.createdAt,
      fullName: users.fullName,
      email: users.email,
      cadreName: cadres.name,
      isClinical: cadres.isClinical,
      cadreGradeName: cadreGrades.name,
      roleName: roles.name,
      departmentName: hospitalDepartments.name,
      specialtyName: specialties.name,
      councilName: councils.name,
      councilCode: councils.code,
      registrationNumber: clinicianProfiles.registrationNumber,
      registrationExpiry: clinicianProfiles.registrationExpiry,
      licenceDocumentPath: clinicianProfiles.licenceDocumentPath,
      identityProfileId: staffIdentityProfiles.id,
      staffNumber: staffIdentityProfiles.staffNumber,
      appointmentLetterPath: staffIdentityProfiles.appointmentLetterUrl,
      authorisingOfficerName: staffIdentityProfiles.authorisingOfficerName,
      authorisingOfficerRole: staffIdentityProfiles.authorisingOfficerRole,
    })
    .from(staffAffiliations)
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .leftJoin(clinicianProfiles, eq(clinicianProfiles.id, staffAffiliations.userId))
    .leftJoin(councils, eq(councils.id, clinicianProfiles.councilId))
    .leftJoin(staffIdentityProfiles, eq(staffIdentityProfiles.id, staffAffiliations.userId))
    .leftJoin(cadreGrades, eq(cadreGrades.id, staffAffiliations.cadreGradeId))
    .innerJoin(roles, eq(roles.id, staffAffiliations.roleId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .leftJoin(specialties, eq(specialties.id, staffAffiliations.specialtyId))
    .where(
      and(
        eq(staffAffiliations.hospitalId, hospitalId),
        eq(staffAffiliations.state, "pending_approval"),
      ),
    )
    .orderBy(desc(staffAffiliations.createdAt));

  const nowMs = Date.now();

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    email: r.email,
    isClinical: r.isClinical,
    cadreName: r.cadreName,
    cadreGradeName: r.cadreGradeName,
    roleName: r.roleName,
    departmentName: r.departmentName,
    specialtyName: r.specialtyName,
    employmentType: r.employmentType,
    reviewNote: r.reviewNote,
    createdAtIso: r.createdAt.toISOString(),
    daysSinceSubmission: Math.floor((nowMs - r.createdAt.getTime()) / 86_400_000),
    councilName: r.councilName,
    councilCode: r.councilCode,
    registrationNumber: r.registrationNumber,
    registrationExpiry: r.registrationExpiry ? r.registrationExpiry.toString() : null,
    licenceDocumentPath: r.licenceDocumentPath,
    ninOnFile: r.identityProfileId !== null,
    staffNumber: r.staffNumber,
    appointmentLetterPath: r.appointmentLetterPath,
    authorisingOfficerName: r.authorisingOfficerName,
    authorisingOfficerRole: r.authorisingOfficerRole,
  }));
}

/* ─── Directory ────────────────────────────────────────────────────── */

export interface DirectoryAffiliationRow {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  cadreName: string;
  roleId: string;
  roleName: string;
  departmentId: string;
  departmentName: string;
  employmentType: string;
  state: string;
  councilName: string;
  /** Council registration number — operationally queryable, intentionally
   * plaintext, but the UI keeps it masked-until-expanded. */
  registrationNumber: string;
}

const DIRECTORY_STATES = ["approved", "active", "suspended", "deactivated"] as const;

async function fetchDirectoryAffiliations(hospitalId: string): Promise<DirectoryAffiliationRow[]> {
  const rows = await db
    .select({
      id: staffAffiliations.id,
      userId: staffAffiliations.userId,
      roleId: staffAffiliations.roleId,
      departmentId: staffAffiliations.departmentId,
      employmentType: staffAffiliations.employmentType,
      state: staffAffiliations.state,
      fullName: users.fullName,
      email: users.email,
      cadreName: cadres.name,
      roleName: roles.name,
      departmentName: hospitalDepartments.name,
      councilName: councils.name,
      registrationNumber: clinicianProfiles.registrationNumber,
    })
    .from(staffAffiliations)
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .innerJoin(clinicianProfiles, eq(clinicianProfiles.id, staffAffiliations.userId))
    .innerJoin(councils, eq(councils.id, clinicianProfiles.councilId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .innerJoin(roles, eq(roles.id, staffAffiliations.roleId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .where(
      and(
        eq(staffAffiliations.hospitalId, hospitalId),
        inArray(staffAffiliations.state, [...DIRECTORY_STATES]),
      ),
    )
    .orderBy(asc(users.fullName));

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    fullName: r.fullName,
    email: r.email,
    cadreName: r.cadreName,
    roleId: r.roleId,
    roleName: r.roleName,
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    employmentType: r.employmentType,
    state: r.state,
    councilName: r.councilName,
    registrationNumber: r.registrationNumber,
  }));
}

export interface DirectoryDepartmentOption {
  id: string;
  name: string;
}

async function fetchHospitalDepartments(hospitalId: string): Promise<DirectoryDepartmentOption[]> {
  const rows = await db
    .select({ id: hospitalDepartments.id, name: hospitalDepartments.name })
    .from(hospitalDepartments)
    .where(eq(hospitalDepartments.hospitalId, hospitalId))
    .orderBy(asc(hospitalDepartments.name));
  return rows;
}

export interface DirectoryRoleOption {
  id: string;
  name: string;
  cadreName: string;
}

/* ─── Invitations ──────────────────────────────────────────────────── */

export interface InvitationRow {
  id: string;
  email: string;
  name: string | null;
  source: string;
  invitedAtIso: string;
  expiresAtIso: string;
  acceptedAtIso: string | null;
  revokedAtIso: string | null;
  revocationReason: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
}

async function fetchInvitations(hospitalId: string): Promise<InvitationRow[]> {
  const rows = await db
    .select({
      id: hospitalStaffInvitations.id,
      email: hospitalStaffInvitations.invitedEmail,
      name: hospitalStaffInvitations.invitedName,
      source: hospitalStaffInvitations.source,
      invitedAt: hospitalStaffInvitations.invitedAt,
      expiresAt: hospitalStaffInvitations.expiresAt,
      acceptedAt: hospitalStaffInvitations.acceptedAt,
      revokedAt: hospitalStaffInvitations.revokedAt,
      revocationReason: hospitalStaffInvitations.revocationReason,
    })
    .from(hospitalStaffInvitations)
    .where(eq(hospitalStaffInvitations.hospitalId, hospitalId))
    .orderBy(desc(hospitalStaffInvitations.invitedAt));

  const nowMs = Date.now();
  return rows.map((r) => {
    const acceptedAtIso = r.acceptedAt?.toISOString() ?? null;
    const revokedAtIso = r.revokedAt?.toISOString() ?? null;
    const expiresAtIso = r.expiresAt.toISOString();
    const expired = !acceptedAtIso && !revokedAtIso && r.expiresAt.getTime() < nowMs;
    const status: InvitationRow["status"] = acceptedAtIso
      ? "accepted"
      : revokedAtIso
        ? "revoked"
        : expired
          ? "expired"
          : "pending";
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      source: r.source,
      invitedAtIso: r.invitedAt.toISOString(),
      expiresAtIso,
      acceptedAtIso,
      revokedAtIso,
      revocationReason: r.revocationReason,
      status,
    };
  });
}

async function fetchHospitalRoles(): Promise<DirectoryRoleOption[]> {
  // Roles are catalog-wide, not hospital-scoped. The admin sees the
  // full catalog when picking a new role (filtered client-side by
  // search). The role row carries cadre_id; we join to surface the
  // cadre label so the admin doesn't pick a nurse role for a doctor.
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      cadreName: cadres.name,
    })
    .from(roles)
    .innerJoin(cadres, eq(cadres.id, roles.cadreId))
    .orderBy(asc(cadres.name), asc(roles.name));
  return rows;
}
