import type { Metadata } from "next";

import { SignupUnavailable } from "@/app/signup/_components/unavailable";
import { STAFF } from "@/content/onboarding-staff";
import { liveNotice } from "@/lib/onboarding/notice";
import { listHospitals } from "@/lib/reference-data";
import { NonClinicalSignupForm } from "./_components/form";

export const metadata: Metadata = {
  title: "Non-clinical staff signup · MedSync",
  robots: { index: false, follow: false },
};

// The live notice (and reference lists) are read per request.
export const dynamic = "force-dynamic";

/** Non-clinical staff signup v2 — server half: the live notice and the hospitals. */
export default async function NonClinicalSignupPage() {
  const [notice, hospitals] = await Promise.all([liveNotice(), listHospitals()]);
  if (!notice)
    return (
      <SignupUnavailable title={STAFF.unavailableTitle}>{STAFF.unavailableBody}</SignupUnavailable>
    );
  return (
    <NonClinicalSignupForm
      notice={notice}
      hospitals={hospitals.map((h) => ({ id: h.id, name: h.name }))}
    />
  );
}
