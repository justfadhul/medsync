import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { listCouncils, listHospitals } from "@/lib/reference-data";
import { ClinicalSignupForm } from "./_form";
import {
  loadCadreGradesForCadreAction,
  loadCadresForCouncilAction,
  loadDepartmentsForHospitalAction,
  loadRolesForCadreAction,
  submitClinicalSignupAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Clinical staff signup · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClinicalSignupPage() {
  const [councils, hospitals, [activeConsent]] = await Promise.all([
    listCouncils(),
    listHospitals(),
    db
      .select()
      .from(consentVersions)
      .where(eq(consentVersions.consentType, "data_processing"))
      .orderBy(desc(consentVersions.effectiveDate))
      .limit(1),
  ]);

  if (!activeConsent) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20 text-center">
        <h1 className="text-foreground font-display text-3xl">Signup unavailable</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          The current consent text isn&apos;t ready yet. Please check back shortly.
        </p>
      </div>
    );
  }

  return (
    <ClinicalSignupForm
      councils={councils.map((c) => ({
        value: c.id,
        label: c.name,
        searchText: c.code,
      }))}
      hospitals={hospitals.map((h) => ({ value: h.id, label: h.name }))}
      consent={{
        version: activeConsent.version,
        bodySha256: activeConsent.bodySha256,
        body: activeConsent.body,
        effectiveDate: activeConsent.effectiveDate,
      }}
      loadCadres={loadCadresForCouncilAction}
      loadCadreGrades={loadCadreGradesForCadreAction}
      loadRoles={loadRolesForCadreAction}
      loadDepartments={loadDepartmentsForHospitalAction}
      submit={submitClinicalSignupAction}
    />
  );
}
