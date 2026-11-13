import type { Metadata } from "next";

import { SignupUnavailable } from "@/app/signup/_components/unavailable";
import { liveNotice } from "@/lib/onboarding/notice";
import { DeskClaimForm } from "./form";

export const metadata: Metadata = {
  title: "Take over your clinic record · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** A patient the desk registered takes that record over with the desk's claim code (ADR 0475). */
export default async function DeskClaimPage() {
  const notice = await liveNotice();
  if (!notice)
    return (
      <SignupUnavailable title="Signup unavailable">
        The current consent text isn&apos;t ready yet. Please check back shortly.
      </SignupUnavailable>
    );
  return <DeskClaimForm notice={notice} />;
}
