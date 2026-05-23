import type { Metadata } from "next";

import { StubPanel } from "@/app/signup/_components/stub-panel";

export const metadata: Metadata = {
  title: "Medical-staff signup",
  robots: { index: false, follow: false },
};

export default function ClinicalSignupPage() {
  return (
    <StubPanel
      title="Medical-staff signup"
      intro="Council registration is the verification anchor. Each hospital × department × role affiliation is approved independently by the hospital admin. MFA is mandatory before any clinical access opens up."
      gate="D"
      bullets={[
        "Account basics — title, name, phone, institutional email, password",
        "Professional identity — council (UMDPC / UNMC / AHPC / Pharmacy Board), registration number, licence document upload, expiry",
        "Optional: claim a pre-loaded hospital roster slot (pre-fill only, grants nothing)",
        "Affiliation(s) — hospital × department × cadre × role/grade × employment type (add multiple, each independently approved)",
        "Role-specific details that vary by cadre: specialty, ward/unit, dispensing scope, scope confirmation",
        "MFA enrolment (mandatory, TOTP/AAL2) → pending_approval holding screen per affiliation",
      ]}
    />
  );
}
