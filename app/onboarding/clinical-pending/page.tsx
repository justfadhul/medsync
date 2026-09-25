import type { Metadata } from "next";

import { STAFF_PENDING } from "@/content/onboarding-staff";
import { ClinicalPendingView } from "./_components/view";

export const metadata: Metadata = {
  title: STAFF_PENDING.metaTitle,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The staff status page — clinical and non-clinical — for every applicant, whichever form they
 * used (ADR 0124). Not behind ONBOARDING_V2: approval now waits for a licence on file (DOC-1), so
 * the "Still needed" upload has to reach everyone; and the old page promised emails nothing sends
 * (Q11) and told reception staff about a council registry (O13).
 */
export default function ClinicalPendingPage() {
  return <ClinicalPendingView />;
}
