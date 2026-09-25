import type { Metadata } from "next";
import { Suspense } from "react";

import { MfaChallengeForm, MfaSkeleton } from "./form";

export const metadata: Metadata = { title: "Two-factor" };

export default function MfaChallengePage() {
  return (
    <Suspense fallback={<MfaSkeleton />}>
      <MfaChallengeForm />
    </Suspense>
  );
}
