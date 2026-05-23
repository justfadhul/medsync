import type { SQL } from "drizzle-orm";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { clinicianProfiles, staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalApplications } from "@/db/schema/hospital-applications";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { roles as rolesTable } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ReviewRow } from "./_review-row";
import {
  approveHospitalApplicationAction,
  approveStaffAffiliationAction,
  rejectHospitalApplicationAction,
  rejectStaffAffiliationAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Admin review queue (GATE F).
 *
 * Two queues side by side:
 *   - Pending staff_affiliations — visible to the hospital_admin of
 *     the affiliation's hospital, OR to any superadmin.
 *   - Pending hospital_applications — superadmin only.
 *
 * The page is intentionally minimal; the heavy lifting is in the
 * Edge Functions. This UI is the visible signal that the workflow
 * exists end-to-end and the approval pathway is wired.
 */
export default async function AdminQueuePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id;

  const service = createServiceClient();
  const { data: rolesData } = await service
    .from("user_roles")
    .select("role, hospital_id")
    .eq("user_id", userId);

  const isSuperadmin = !!rolesData?.some((r) => r.role === "superadmin");
  const hospitalAdminScopes = (rolesData ?? [])
    .filter((r) => r.role === "hospital_admin" && r.hospital_id)
    .map((r) => r.hospital_id as string);

  // ─── Staff queue ────────────────────────────────────────────────────
  let staffRows: Array<{
    id: string;
    title: string;
    meta: Array<{ label: string; value: string }>;
  }> = [];

  if (isSuperadmin || hospitalAdminScopes.length > 0) {
    const whereClauses: SQL[] = [eq(staffAffiliations.state, "pending_approval")];
    if (!isSuperadmin) {
      whereClauses.push(inArray(staffAffiliations.hospitalId, hospitalAdminScopes));
    }
    const rows = await db
      .select({
        id: staffAffiliations.id,
        userId: staffAffiliations.userId,
        hospitalId: staffAffiliations.hospitalId,
        departmentId: staffAffiliations.departmentId,
        roleId: staffAffiliations.roleId,
        employmentType: staffAffiliations.employmentType,
        createdAt: staffAffiliations.createdAt,
      })
      .from(staffAffiliations)
      .where(whereClauses.length === 1 ? whereClauses[0] : and(...whereClauses))
      .orderBy(desc(staffAffiliations.createdAt))
      .limit(50);

    if (rows.length > 0) {
      const userIds: string[] = [...new Set(rows.map((r) => r.userId))];
      const hospitalIds: string[] = [...new Set(rows.map((r) => r.hospitalId))];
      const deptIds: string[] = [...new Set(rows.map((r) => r.departmentId))];
      const roleIds: string[] = [...new Set(rows.map((r) => r.roleId))];

      const [usersData, hospitalsData, deptsData, rolesData2, clinicianData] = await Promise.all([
        db.select().from(users).where(inArray(users.id, userIds)),
        db.select().from(hospitals).where(inArray(hospitals.id, hospitalIds)),
        db.select().from(hospitalDepartments).where(inArray(hospitalDepartments.id, deptIds)),
        db.select().from(rolesTable).where(inArray(rolesTable.id, roleIds)),
        db.select().from(clinicianProfiles).where(inArray(clinicianProfiles.id, userIds)),
      ]);

      const userById = new Map(usersData.map((u) => [u.id, u]));
      const hospitalById = new Map(hospitalsData.map((h) => [h.id, h]));
      const deptById = new Map(deptsData.map((d) => [d.id, d]));
      const roleById = new Map(rolesData2.map((r) => [r.id, r]));
      const clinicianById = new Map(clinicianData.map((c) => [c.id, c]));

      staffRows = rows.map((r) => {
        const u = userById.get(r.userId);
        const h = hospitalById.get(r.hospitalId);
        const d = deptById.get(r.departmentId);
        const role = roleById.get(r.roleId);
        const clinician = clinicianById.get(r.userId);
        return {
          id: r.id,
          title: u?.fullName ?? "(unknown clinician)",
          meta: [
            { label: "Hospital", value: h?.name ?? "—" },
            { label: "Department", value: d?.name ?? "—" },
            { label: "Role", value: role?.name ?? "—" },
            { label: "Employment", value: r.employmentType },
            {
              label: "Reg number",
              value: clinician?.registrationNumber ?? "(not on file)",
            },
            {
              label: "Licence",
              value: clinician?.licenceDocumentPath ? "uploaded" : "missing",
            },
            { label: "Requested", value: new Date(r.createdAt).toISOString().slice(0, 10) },
          ],
        };
      });
    }
  }

  // ─── Application queue (superadmin only) ────────────────────────────
  let appRows: Array<{
    id: string;
    title: string;
    meta: Array<{ label: string; value: string }>;
  }> = [];

  if (isSuperadmin) {
    const rows = await db
      .select()
      .from(hospitalApplications)
      .where(eq(hospitalApplications.state, "pending_approval"))
      .orderBy(desc(hospitalApplications.createdAt))
      .limit(50);
    appRows = rows.map((r) => ({
      id: r.id,
      title: r.hospitalName,
      meta: [
        { label: "Facility level", value: r.facilityLevel },
        { label: "Ownership", value: r.ownership },
        { label: "Reg number", value: r.registrationNumber },
        { label: "Authority", value: r.registrationAuthority ?? "—" },
        { label: "Address", value: r.physicalAddress },
        { label: "Email domain", value: r.institutionalEmailDomain },
        { label: "Applicant role", value: r.applicantRole },
        {
          label: "Authorisation doc",
          value: r.authorisationDocumentPath ? "uploaded" : "missing",
        },
        { label: "Submitted", value: new Date(r.createdAt).toISOString().slice(0, 10) },
      ],
    }));
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 py-12 sm:px-8 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1
          className="font-display text-foreground text-[28px] leading-[1.1] tracking-[-0.02em] sm:text-[36px]"
          style={{ fontWeight: 400 }}
        >
          Approvals queue
        </h1>
        <p className="text-muted-foreground text-[13.5px]">
          {isSuperadmin
            ? "You see all pending staff affiliations and hospital applications."
            : "You see pending staff affiliations for hospitals you administer."}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-foreground text-[16px] font-medium tracking-tight">
          Pending staff affiliations{" "}
          <span className="text-muted-foreground font-normal">({staffRows.length})</span>
        </h2>
        {staffRows.length === 0 ? (
          <p className="text-muted-foreground border-border bg-card rounded-md border p-4 text-[13px]">
            Nothing pending right now.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {staffRows.map((r) => (
              <ReviewRow
                key={r.id}
                id={r.id}
                title={r.title}
                meta={r.meta}
                approveAction={approveStaffAffiliationAction}
                rejectAction={rejectStaffAffiliationAction}
              />
            ))}
          </div>
        )}
      </section>

      {isSuperadmin ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-foreground text-[16px] font-medium tracking-tight">
            Pending hospital applications{" "}
            <span className="text-muted-foreground font-normal">({appRows.length})</span>
          </h2>
          {appRows.length === 0 ? (
            <p className="text-muted-foreground border-border bg-card rounded-md border p-4 text-[13px]">
              No applications waiting.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {appRows.map((r) => (
                <ReviewRow
                  key={r.id}
                  id={r.id}
                  title={r.title}
                  meta={r.meta}
                  approveAction={approveHospitalApplicationAction}
                  rejectAction={rejectHospitalApplicationAction}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
