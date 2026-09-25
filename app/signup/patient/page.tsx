import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { fetchSmsConsentVersion } from "@/lib/notifications/consent";
import { onboardingV2 } from "@/lib/onboarding/feature";
import { listDistricts } from "@/lib/reference-data";
import { SignupUnavailable } from "../_components/unavailable";
import { PatientSignupForm } from "./_lazy";
import { PatientSignupV2 } from "./_v2/view";
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
  if (await onboardingV2()) return <PatientSignupV2 />;
  const districts = await listDistricts();
  const districtItems = districts.map((d) => ({ value: d.id, label: d.name }));

  const [[activeConsent], smsConsent] = await Promise.all([
    db
      .select()
      .from(consentVersions)
      .where(eq(consentVersions.consentType, "data_processing"))
      .orderBy(desc(consentVersions.effectiveDate))
      .limit(1),
    // Gate E (ADR 0090): separately declinable SMS consent. Null before
    // migration 0061 seeds v1.0 — the control is then simply absent.
    fetchSmsConsentVersion(),
  ]);

  if (!activeConsent) {
    return (
      <SignupUnavailable title="Signup unavailable">
        The current consent text isn&apos;t ready yet. Please check back shortly.
      </SignupUnavailable>
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
      smsConsent={smsConsent}
      loadSubcounties={loadSubcountiesForDistrictAction}
      submit={submitPatientSignupAction}
    />
  );
}
