import type { Metadata } from "next";

import { SignupUnavailable } from "@/app/signup/_components/unavailable";
import { fetchSmsConsentVersion } from "@/lib/notifications/consent";
import { SMS_CONSENT_COPY } from "@/lib/notifications/consent-copy";
import { liveNotice } from "@/lib/onboarding/notice";
import { PatientSignupForm } from "./_components/form";

export const metadata: Metadata = {
  title: "Patient signup · MedSync",
  robots: { index: false, follow: false },
};

// The live notice (and reference lists) are read per request.
export const dynamic = "force-dynamic";

/** Patient signup v2 — server half: the live notice (and SMS text) the form binds consent to. */
export default async function PatientSignupPage() {
  const [notice, sms] = await Promise.all([liveNotice(), fetchSmsConsentVersion()]);
  if (!notice)
    return (
      <SignupUnavailable title="Signup unavailable">
        The current consent text isn&apos;t ready yet. Please check back shortly.
      </SignupUnavailable>
    );
  return (
    <PatientSignupForm
      notice={notice}
      sms={
        sms
          ? {
              version: sms.version,
              sha: sms.bodySha256,
              body: sms.body,
              declined: SMS_CONSENT_COPY.declined,
              receipt: SMS_CONSENT_COPY.receiptException,
            }
          : null
      }
    />
  );
}
