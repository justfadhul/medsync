import type { Metadata } from "next";
import { Suspense } from "react";

import { MfaChallengeForm } from "@/app/(auth)/sign-in/mfa/form";
import { AuthHead, AuthPage } from "@/components/landing/tether/auth";
import { MFA } from "@/content/auth";
import { NAV } from "@/content/tether-landing/copy";

/** `/sign-in/mfa` while LANDING_TETHER is on (ADR 0498): the authenticator-code step in the Tether look. */
export const metadata: Metadata = { title: { absolute: `Two-factor · ${NAV.brand}` } };

export default function TetherMfaPage() {
  return (
    <AuthPage>
      <Suspense
        fallback={
          <AuthHead title={MFA.title} lead={MFA.helper}>
            {null}
          </AuthHead>
        }
      >
        <MfaChallengeForm look="tether" />
      </Suspense>
    </AuthPage>
  );
}
