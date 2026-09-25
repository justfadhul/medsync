import { SignupUnavailable } from "@/app/signup/_components/unavailable";
import { STAFF } from "@/content/onboarding-staff";
import { liveNotice } from "@/lib/onboarding/notice";
import { listHospitals, listSpecialties } from "@/lib/reference-data";
import { ClinicalFormV2 } from "../_lazy";

/** Clinical staff signup v2 — server half: the live notice, the hospitals and the specialties. */
export async function ClinicalSignupV2() {
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
    <ClinicalFormV2
      notice={notice}
      hospitals={hospitals.map((h) => ({ id: h.id, name: h.name }))}
      specialties={specialties.map((s) => ({ value: s.id, label: s.name }))}
    />
  );
}
