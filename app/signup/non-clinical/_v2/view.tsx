import { SignupUnavailable } from "@/app/signup/_components/unavailable";
import { STAFF } from "@/content/onboarding-staff";
import { liveNotice } from "@/lib/onboarding/notice";
import { listHospitals } from "@/lib/reference-data";
import { NonClinicalFormV2 } from "../_lazy";

/** Non-clinical staff signup v2 — server half: the live notice and the hospitals. */
export async function NonClinicalSignupV2() {
  const [notice, hospitals] = await Promise.all([liveNotice(), listHospitals()]);
  if (!notice)
    return (
      <SignupUnavailable title={STAFF.unavailableTitle}>{STAFF.unavailableBody}</SignupUnavailable>
    );
  return (
    <NonClinicalFormV2
      notice={notice}
      hospitals={hospitals.map((h) => ({ id: h.id, name: h.name }))}
    />
  );
}
