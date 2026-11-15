import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { startEnrollmentAction } from "@/app/(auth)/onboarding/mfa-setup/actions";
import { EnrollmentFailed, MfaSetupForm } from "@/app/(auth)/onboarding/mfa-setup/form";
import { AuthHead, AuthPage } from "@/components/landing/tether/auth";
import { MFA_SETUP } from "@/content/auth";
import { NAV } from "@/content/tether-landing/copy";

/** `/onboarding/mfa-setup` on the Tether domain (ADR 0512): the same enrolment in the Tether look. */
export const metadata: Metadata = { title: { absolute: `${MFA_SETUP.title} · ${NAV.brand}` } };

export default async function TetherMfaSetupPage() {
  const enrollment = await startEnrollmentAction();
  if (enrollment.kind === "signed-out") redirect("/sign-in?redirect=/onboarding/mfa-setup");
  if (enrollment.kind === "enrolled") redirect("/sign-in");
  return (
    <AuthPage>
      <AuthHead title={MFA_SETUP.title}>
        {enrollment.kind === "error" ? (
          <EnrollmentFailed message={enrollment.message} />
        ) : (
          <MfaSetupForm {...enrollment} look="tether" inline={{ redirect: "" }} />
        )}
      </AuthHead>
    </AuthPage>
  );
}
