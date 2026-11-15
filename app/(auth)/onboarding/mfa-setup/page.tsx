import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { startEnrollmentAction } from "./actions";
import { EnrollmentFailed, MfaSetupForm } from "./form";

export const metadata: Metadata = { title: "Set up two-factor" };

/**
 * MFA enrolment. Server-rendered: the QR code lives in the HTML. Signing in opens the same step under the password
 * (ADR 0512); this page stays for a session that opens a workspace before it has an authenticator.
 */
export default async function MfaSetupPage() {
  const enrollment = await startEnrollmentAction();
  if (enrollment.kind === "signed-out") redirect("/sign-in?redirect=/onboarding/mfa-setup");
  if (enrollment.kind === "enrolled") redirect("/admin");
  if (enrollment.kind === "error") return <EnrollmentFailed message={enrollment.message} />;
  return <MfaSetupForm {...enrollment} />;
}
