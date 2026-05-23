import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { listDistricts } from "@/lib/reference-data";
import { HospitalApplicationForm } from "./_form";
import {
  loadSubcountiesForDistrictActionHospital,
  submitHospitalApplicationAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Hospital application · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function HospitalSignupPage() {
  const [districts, [activeConsent]] = await Promise.all([
    listDistricts(),
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
        <h1 className="text-foreground font-display text-3xl">Applications unavailable</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          The current consent text isn&apos;t ready yet. Please check back shortly.
        </p>
      </div>
    );
  }

  return (
    <HospitalApplicationForm
      districts={districts.map((d) => ({ value: d.id, label: d.name }))}
      consent={{
        version: activeConsent.version,
        bodySha256: activeConsent.bodySha256,
        body: activeConsent.body,
        effectiveDate: activeConsent.effectiveDate,
      }}
      loadSubcounties={loadSubcountiesForDistrictActionHospital}
      submit={submitHospitalApplicationAction}
    />
  );
}
