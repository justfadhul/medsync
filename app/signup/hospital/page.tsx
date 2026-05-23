import type { Metadata } from "next";

import { StubPanel } from "@/app/signup/_components/stub-panel";

export const metadata: Metadata = {
  title: "Hospital application",
  robots: { index: false, follow: false },
};

export default function HospitalSignupPage() {
  return (
    <StubPanel
      title="Hospital application"
      intro="Full application creates an account + a hospital application for MedSync superadmin review. On approval, your account is elevated to hospital admin scoped to that hospital only. Not ready to commit? Use the landing-page Express Interest form instead."
      gate="E"
      bullets={[
        "Official hospital name, facility level (HC II–IV / General / Regional / National referral / private), ownership (public-MoH / PNFP / private / private-clinic)",
        "Licence or registration identifiers (institutional proof)",
        "District + subcounty (cascading combobox from UBOS reference data), physical address",
        "Official institutional email domain (verification signal — e.g. mulago.go.ug)",
        "Applicant — name, role at facility, phone, authorisation document upload (signed letterhead)",
        "Password → verify → MFA → pending_approval (reviewed by superadmin)",
      ]}
    />
  );
}
