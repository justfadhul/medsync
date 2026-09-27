import type { Metadata } from "next";
import Link from "next/link";

import { EmergencyButton } from "@/components/landing/emergency-button";
import { FeedbackForm } from "./_components/feedback-form";

export const metadata: Metadata = {
  title: "Tester feedback · MedSync",
  robots: { index: false, follow: false },
};

/** `/feedback` — public tester form; responses land in the console at /admin/feedback. */
export default function FeedbackPage() {
  return (
    <div className="bg-background min-h-svh w-full">
      {/* Inline Emergency button; the floating pill steps aside so it never covers an answer. */}
      <header className="border-border/60 border-b" data-emergency-inline="">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-8">
          <Link
            href="/"
            className="font-display text-foreground text-heading-s font-semibold transition-opacity hover:opacity-80"
          >
            MedSync
          </Link>
          <EmergencyButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
        <FeedbackForm />
      </main>
    </div>
  );
}
