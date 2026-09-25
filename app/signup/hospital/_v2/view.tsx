import { SignupUnavailable } from "@/app/signup/_components/unavailable";
import { HOSPITAL_FORM } from "@/content/onboarding-hospital";
import { liveNotice } from "@/lib/onboarding/notice";
import { PNFP_BUREAUS } from "@/lib/registry";
import { HospitalFormV2 } from "../_lazy";

/** Hospital application v2 — server half: the live notice, and the registry's PNFP bureaus. */
export async function HospitalSignupV2() {
  const notice = await liveNotice();
  if (!notice)
    return (
      <SignupUnavailable title={HOSPITAL_FORM.unavailableTitle}>
        {HOSPITAL_FORM.unavailableBody}
      </SignupUnavailable>
    );
  return <HospitalFormV2 notice={notice} bureaus={PNFP_BUREAUS} />;
}
