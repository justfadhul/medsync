import type { Metadata } from "next";

import { SignupUnavailable } from "@/app/signup/_components/unavailable";
import { STAFF } from "@/content/onboarding-staff";
import { liveNotice } from "@/lib/onboarding/notice";
import { listHospitals, listSpecialties } from "@/lib/reference-data";
import { ClinicalSignupForm } from "./_components/form";

export const metadata: Metadata = {
  title: "Clinical staff signup · MedSync",
  robots: { index: false, follow: false },
};

// The live notice (and reference lists) are read per request.
export const dynamic = "force-dynamic";

/** Clinical staff signup v2 — server half: the live notice, the hospitals and the specialties. */
export default async function ClinicalSignupPage() {
  const [notice, hospitals, specialties] = await Promise.all([
    liveNotice(),
    listHospitals(),
    listSpecialties(),
  ]);
  if (!notice)
    return (
      <SignupUnavailable title={STAFF.unavailableTitle}>{STAFF.unavailableBody}</SignupUnavailable>
    );
  return (
    <ClinicalSignupForm
      notice={notice}
      hospitals={hospitals.map((h) => ({ id: h.id, name: h.name }))}
      specialties={specialties.map((s) => ({ value: s.id, label: s.name }))}
    />
  );
}
