import type { Metadata } from "next";

import { StubPanel } from "@/app/signup/_components/stub-panel";

export const metadata: Metadata = {
  title: "Patient signup",
  robots: { index: false, follow: false },
};

export default function PatientSignupPage() {
  return (
    <StubPanel
      title="Patient signup"
      intro="Phone-verified account, optional MFA, active immediately. From the dashboard you'll join queues, pick a primary facility, and see your visit history."
      gate="C"
      bullets={[
        "Title, first name, surname (encrypted at rest)",
        "Sex (segmented), date of birth (date picker, past-only, capped today)",
        "ID type — NIN / Passport / None (segmented); ID number conditional, encrypted",
        "Phone +256 (primary verify channel), email optional",
        "District + subcounty (cascading combobox from UBOS reference data)",
        "Village / address line (optional), preferred language",
        "Primary facility (combobox from active hospitals — durable care relationship)",
        "Known conditions (multi-select), next-of-kin name / relationship / phone",
        "Consent (versioned text from consent_versions), password → OTP verify",
      ]}
    />
  );
}
