import { SignupUnavailable } from "@/app/signup/_components/unavailable";
import { fetchSmsConsentVersion } from "@/lib/notifications/consent";
import { SMS_CONSENT_COPY } from "@/lib/notifications/consent-copy";
import { liveNotice } from "@/lib/onboarding/notice";
import { PatientFormV2 } from "../_lazy";

/** Patient signup v2 — server half: the live notice (and SMS text) the form binds consent to. */
export async function PatientSignupV2() {
  const [notice, sms] = await Promise.all([liveNotice(), fetchSmsConsentVersion()]);
  if (!notice)
    return (
      <SignupUnavailable title="Signup unavailable">
        The current consent text isn&apos;t ready yet. Please check back shortly.
      </SignupUnavailable>
    );
  return (
    <PatientFormV2
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
