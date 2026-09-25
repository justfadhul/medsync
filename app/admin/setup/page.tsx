import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { hospitalAdminRoster } from "@/db/schema/hospital-admin-roster";
import { hospitalAgreements } from "@/db/schema/hospital-agreements";
import { hospitalApplicationDepartments } from "@/db/schema/hospital-application-departments";
import { hospitalApplications } from "@/db/schema/hospital-applications";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitalDpaVersions } from "@/db/schema/hospital-dpa-versions";
import { hospitalStaffInvitations } from "@/db/schema/hospital-staff-invitations";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { hospitals } from "@/db/schema/hospitals";
import { facilityLocations } from "@/db/schema/onboarding";
import { specialties } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SetupWizard } from "./_components/wizard";
import { catalogCodeForSlug, imParentId, slugify } from "./_lib/rules";

export const metadata: Metadata = {
  title: "Set up your hospital · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** The seeded Internal Medicine specialty (0009); its children are the IM sub-specialties. */
const IM_SPECIALTY_ID = "00000000-0000-0000-0000-000000000f00";

/**
 * Hospital setup checklist (kickoff §F, GATE D; onboarding v2 §5.10).
 *
 * Lives under /admin so the admin shell renders. Gated to hospital_admins whose hospital is in
 * `provisioning` — superadmins are bounced to /admin (ADR 0018 Q3: superadmin can SEE the data,
 * but submission requires the hospital_admin's session).
 *
 * Every task's done state is derived here from rows (no setup-state table, gate-a §6.8).
 */
export default async function HospitalSetupPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/sign-in?redirect=/admin/setup");

  const service = createServiceClient();
  const { data: roles } = await service
    .from("user_roles")
    .select("role,hospital_id")
    .eq("user_id", userData.user.id);

  const isSuperadmin = !!roles?.some((r) => r.role === "superadmin");
  const adminHospitalIds = (roles ?? [])
    .filter((r) => r.role === "hospital_admin" && r.hospital_id)
    .map((r) => r.hospital_id as string);

  // The checklist runs the hospital admin, not the superadmin.
  if (adminHospitalIds.length === 0) {
    if (isSuperadmin) redirect("/admin/tenants");
    redirect("/admin");
  }

  // This admin's hospital in provisioning (not just the first provisioning hospital by name).
  const [provisioning] = await db
    .select()
    .from(hospitals)
    .where(and(eq(hospitals.state, "provisioning"), inArray(hospitals.id, adminHospitalIds)))
    .orderBy(asc(hospitals.name))
    .limit(1);
  if (!provisioning) redirect("/admin");
  const hospitalId = provisioning.id;

  const [app] = await db
    .select()
    .from(hospitalApplications)
    .where(eq(hospitalApplications.approvedHospitalId, hospitalId))
    .limit(1);

  const [
    junction,
    deptRows,
    imSubs,
    wards,
    rosterRows,
    pendingInvitations,
    [location],
    [agreement],
  ] = await Promise.all([
    app
      ? db
          .select({
            code: hospitalApplicationDepartments.departmentFamily,
            isPrimary: hospitalApplicationDepartments.isPrimary,
          })
          .from(hospitalApplicationDepartments)
          .where(eq(hospitalApplicationDepartments.applicationId, app.id))
      : Promise.resolve([]),
    db
      .select({
        id: hospitalDepartments.id,
        parentId: hospitalDepartments.parentId,
        slug: hospitalDepartments.slug,
        name: hospitalDepartments.name,
      })
      .from(hospitalDepartments)
      .where(eq(hospitalDepartments.hospitalId, hospitalId)),
    db
      .select({ id: specialties.id, name: specialties.name })
      .from(specialties)
      .where(eq(specialties.parentId, IM_SPECIALTY_ID))
      .orderBy(asc(specialties.name)),
    db
      .select()
      .from(hospitalWards)
      .where(eq(hospitalWards.hospitalId, hospitalId))
      .orderBy(asc(hospitalWards.name)),
    db
      .select({
        id: hospitalAdminRoster.id,
        designation: hospitalAdminRoster.designation,
        email: users.email,
        fullName: users.fullName,
      })
      .from(hospitalAdminRoster)
      .leftJoin(users, eq(users.id, hospitalAdminRoster.userId))
      .where(
        and(
          eq(hospitalAdminRoster.hospitalId, hospitalId),
          isNull(hospitalAdminRoster.succeededAt),
        ),
      ),
    db
      .select()
      .from(hospitalStaffInvitations)
      .where(
        and(
          eq(hospitalStaffInvitations.hospitalId, hospitalId),
          isNull(hospitalStaffInvitations.acceptedAt),
          isNull(hospitalStaffInvitations.revokedAt),
        ),
      )
      .orderBy(desc(hospitalStaffInvitations.invitedAt))
      .limit(50),
    db
      .select({ accuracyM: facilityLocations.accuracyM, at: facilityLocations.confirmedAt })
      .from(facilityLocations)
      .where(eq(facilityLocations.hospitalId, hospitalId)),
    db
      .select({
        version: hospitalDpaVersions.version,
        name: hospitalAgreements.signatoryName,
        signedAt: hospitalAgreements.signedAt,
      })
      .from(hospitalAgreements)
      .innerJoin(hospitalDpaVersions, eq(hospitalDpaVersions.id, hospitalAgreements.dpaVersionId))
      .where(
        and(eq(hospitalAgreements.hospitalId, hospitalId), isNull(hospitalAgreements.supersededBy)),
      )
      .orderBy(desc(hospitalAgreements.signedAt))
      .limit(1),
  ]);

  // Departments: confirmed rows win; before any exist, the application's picks pre-fill.
  const topRows = deptRows.filter((d) => d.parentId === null);
  const confirmedCodes = [
    ...new Set(topRows.map((d) => catalogCodeForSlug(d.slug)).filter((c) => c !== null)),
  ];
  const others = topRows.filter((d) => catalogCodeForSlug(d.slug) === null).map((d) => d.name);
  const ticked = topRows.length > 0 ? confirmedCodes : junction.map((d) => d.code);
  const imId = imParentId(deptRows);
  const subSlugs = new Set(deptRows.filter((d) => imId && d.parentId === imId).map((d) => d.slug));
  const primary = junction.find((d) => d.isPrimary)?.code ?? null;
  const start = primary && ticked.includes(primary) ? primary : null;

  return (
    <SetupWizard
      hospital={{ id: hospitalId, name: provisioning.name }}
      hasApplication={!!app}
      departments={{
        confirmedCount: topRows.length,
        startConfirmed: !app || (!!start && confirmedCodes.includes(start)),
        ticked,
        others,
        start,
        subspecialties: imSubs.map((s) => ({
          id: s.id,
          name: s.name,
          checked: subSlugs.has(slugify(s.name)),
        })),
      }}
      wards={wards.map((w) => ({ id: w.id, name: w.name, bedCount: w.bedCount }))}
      roster={rosterRows.map((r) => ({
        id: r.id,
        designation: r.designation,
        email: r.email ?? "(unknown)",
        fullName: r.fullName ?? "(unknown)",
      }))}
      pendingInvitations={pendingInvitations.map((i) => ({
        id: i.id,
        email: i.invitedEmail,
        invitedAtIso: i.invitedAt.toISOString(),
      }))}
      location={
        location
          ? { accuracyM: location.accuracyM ?? 0, atIso: location.at?.toISOString() ?? null }
          : null
      }
      profile={
        app
          ? {
              servicesOffered: app.servicesOffered,
              specialisedClinics: app.specialisedClinics,
              diagnosticServices: app.diagnosticServices,
              supportServices: app.supportServices,
              hasOnsitePharmacy: app.hasOnsitePharmacy,
              internetConnectivity: app.internetConnectivity,
              powerBackup: app.powerBackup,
              bedCapacityBand: app.bedCapacityBand,
              clinicalStaffBand: app.clinicalStaffBand,
              dailyOpdBand: app.dailyOpdBand,
              existingEmr: app.existingEmr,
              existingEmrName: app.existingEmrName,
              mainPhone: app.mainPhone,
              officialEmail: app.officialEmail,
              website: app.website,
              hospitalAka: app.hospitalAka,
              yearEstablished: app.yearEstablished,
              physicalAddress: app.physicalAddress,
            }
          : null
      }
      agreement={
        agreement
          ? {
              version: agreement.version,
              name: agreement.name,
              signedAtIso: agreement.signedAt.toISOString(),
            }
          : null
      }
    />
  );
}
