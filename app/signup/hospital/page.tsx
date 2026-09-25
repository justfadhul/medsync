import type { Metadata } from "next";

import { SignupUnavailable } from "@/app/signup/_components/unavailable";
import { HOSPITAL_FORM } from "@/content/onboarding-hospital";
import { liveNotice } from "@/lib/onboarding/notice";
import { PNFP_BUREAUS } from "@/lib/registry";
import { HospitalApplicationForm } from "./_components/form";

export const metadata: Metadata = {
  title: "Hospital application · MedSync",
  robots: { index: false, follow: false },
};

// The live notice (and reference lists) are read per request.
export const dynamic = "force-dynamic";

/** Hospital application v2 — server half: the live notice, and the registry's PNFP bureaus. */
export default async function HospitalSignupPage() {
  const notice = await liveNotice();
  if (!notice)
    return (
      <SignupUnavailable title={HOSPITAL_FORM.unavailableTitle}>
        {HOSPITAL_FORM.unavailableBody}
      </SignupUnavailable>
    );
  return <HospitalApplicationForm notice={notice} bureaus={PNFP_BUREAUS} />;
}
