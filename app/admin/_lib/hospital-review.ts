import { HOSPITAL_REVIEW as R } from "@/content/onboarding-hospital";

/**
 * The super-admin's next step on a hospital application (D7: Verify → the applicant signs →
 * Approve & provision). v1 applications carry their agreement from submission and keep the plain
 * one-step "Approve".
 */
export function hospitalApprove(app: { state: string; agreementAcceptedVersion: string | null }): {
  approveLabel?: string;
  approveBlocked?: string;
} {
  if (app.state === "verified")
    return app.agreementAcceptedVersion
      ? { approveLabel: R.provision }
      : { approveBlocked: R.waitingSignature };
  return app.agreementAcceptedVersion ? {} : { approveLabel: R.verify };
}
