import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { listDistricts } from "@/lib/reference-data";
import { PatientSignupForm } from "./_form";
import { loadSubcountiesForDistrictAction, submitPatientSignupAction } from "./actions";

export const metadata: Metadata = {
  title: "Patient signup · MedSync",
  robots: { index: false, follow: false },
};

// Districts + consent text are read from the DB at request time, so the
// page can't be statically prerendered at build (the build environment
// doesn't carry the production-DB connection / migrations).
export const dynamic = "force-dynamic";

/**
 * GATE C entry — patient signup.
 *
 * Server Component: hydrates the static reference data (districts) and
 * the live `data_processing` consent text + hash before handing off to
 * the Client Component multi-step form. The active consent row's body
 * + sha256 are rendered into the page so the user can SEE the text
 * they're agreeing to, and the sha256 round-trips back through
 * `<ConsentCheckbox />` for cross-validation in the Server Action.
 */
export default async function PatientSignupPage() {
  const districts = await listDistricts();
  const districtItems = districts.map((d) => ({ value: d.id, label: d.name }));

  const [activeConsent] = await db
    .select()
    .from(consentVersions)
    .where(eq(consentVersions.consentType, "data_processing"))
    .orderBy(desc(consentVersions.effectiveDate))
    .limit(1);

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
    <PatientSignupForm
      districts={districtItems}
      consent={{
        version: activeConsent.version,
        bodySha256: activeConsent.bodySha256,
        body: activeConsent.body,
        effectiveDate: activeConsent.effectiveDate,
      }}
      loadSubcounties={loadSubcountiesForDistrictAction}
      submit={submitPatientSignupAction}
    />
  );
}
