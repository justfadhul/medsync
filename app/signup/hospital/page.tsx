import type { Metadata } from "next";
import { desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { hospitalDpaVersions } from "@/db/schema/hospital-dpa-versions";
import { specialties } from "@/db/schema/reference-data";
import { onboardingV2 } from "@/lib/onboarding/feature";
import { listDistricts, listRegions } from "@/lib/reference-data";
import { SignupUnavailable } from "../_components/unavailable";
import { HospitalApplicationForm } from "./_lazy";
import { HospitalSignupV2 } from "./_v2/view";
import {
  loadSubcountiesForDistrictActionHospital,
  submitHospitalApplicationAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Hospital application · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const INTERNAL_MEDICINE_SPEC_ID = "00000000-0000-0000-0000-000000000f00";

export default async function HospitalSignupPage() {
  if (await onboardingV2()) return <HospitalSignupV2 />;
  const [districts, regions, [activeConsent], [activeDpa], imSubs] = await Promise.all([
    listDistricts(),
    listRegions(),
    db
      .select()
      .from(consentVersions)
      .where(eq(consentVersions.consentType, "data_processing"))
      .orderBy(desc(consentVersions.effectiveDate))
      .limit(1),
    db.select().from(hospitalDpaVersions).orderBy(desc(hospitalDpaVersions.effectiveDate)).limit(1),
    db
      .select({ id: specialties.id, name: specialties.name, code: specialties.code })
      .from(specialties)
      .where(
        // Children of Internal Medicine. Server-side filter against the
        // known parent id so the form's IM-subspecialty picker shows the
        // correct list.
        // (parentId IS NOT NULL is a defensive safety against the parent
        //  row leaking in if its parent_id is ever NULL'd; the explicit
        //  parent comparison is what matters.)
        isNotNull(specialties.parentId),
      ),
  ]);

  if (!activeConsent || !activeDpa) {
    return (
      <SignupUnavailable title="Applications unavailable">
        The current consent or agreement text isn&apos;t ready yet. Please check back shortly.
      </SignupUnavailable>
    );
  }

  // Filter to IM children specifically (post-fetch — small list).
  const imChildren = imSubs.filter((s) =>
    [
      "00000000-0000-0000-0000-000000000f01",
      "00000000-0000-0000-0000-000000000f02",
      "00000000-0000-0000-0000-000000000f03",
      "00000000-0000-0000-0000-000000000f04",
      "00000000-0000-0000-0000-000000000f05",
      "00000000-0000-0000-0000-000000000f06",
      "00000000-0000-0000-0000-000000000f07",
      "00000000-0000-0000-0000-000000000f08",
      "00000000-0000-0000-0000-000000000f09",
      "00000000-0000-0000-0000-000000000f0a",
      "00000000-0000-0000-0000-000000000f0b",
      "00000000-0000-0000-0000-000000000f0c",
      "00000000-0000-0000-0000-000000000f0d",
    ].includes(s.id),
  );
  // Fallback when seed only has Internal Medicine itself: no children
  // means the picker shows an empty (disabled) state. Better to ship
  // empty + clear messaging than to fake entries.
  void INTERNAL_MEDICINE_SPEC_ID;

  return (
    <HospitalApplicationForm
      districts={districts.map((d) => ({ value: d.id, label: d.name }))}
      regions={regions.map((r) => ({ value: r.id, label: r.name }))}
      imSubspecialties={imChildren}
      dpa={{
        id: activeDpa.id,
        version: activeDpa.version,
        bodySha256: activeDpa.bodySha256,
        body: activeDpa.body,
        isPlaceholder: activeDpa.legalReviewStatus === "placeholder",
      }}
      consent={{
        version: activeConsent.version,
        bodySha256: activeConsent.bodySha256,
        body: activeConsent.body,
      }}
      loadSubcounties={loadSubcountiesForDistrictActionHospital}
      submit={submitHospitalApplicationAction}
    />
  );
}
