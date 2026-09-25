import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { SIGNUP_HOLD, SITE } from "@/content/landing";
import { signupsClosedHere } from "@/lib/legal";
import { SignupUnavailable } from "./_components/unavailable";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Shared signup layout — wraps the per-path stubs at /signup/*. The
 * real multi-step flows replace the stubs in gates C / D / E.
 *
 * robots: noindex (signup pages shouldn't appear in search results
 * during the build phase).
 *
 * Production collects no personal data until a privacy notice is published
 * and the PDPO registration is done (landing v4 S8, decision D1; lib/legal.ts):
 * every /signup/* route renders the holding page instead of its form.
 */
export default function SignupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background relative isolate flex min-h-svh w-full flex-col">
      {/* Quiet teal wash behind the flow header — atmosphere, not decoration */}
      <div
        aria-hidden
        className="fade-in-slow pointer-events-none absolute top-0 left-1/2 -z-10 h-72 w-[120%] max-w-none -translate-x-1/2 [background:radial-gradient(closest-side,oklch(0.95_0.06_342/0.35),transparent_72%)] dark:[background:radial-gradient(closest-side,oklch(0.45_0.08_342/0.18),transparent_72%)]"
      />

      <header className="border-border/60 glass sticky top-0 z-30 w-full border-b">
        <div className="mx-auto flex w-full max-w-300 items-center justify-between px-5 py-3 sm:px-8">
          <div className="flex items-center gap-5">
            <Link
              href="/"
              className="font-display text-foreground text-[16px] tracking-tight transition-opacity hover:opacity-80"
            >
              MedSync
            </Link>
            <Link
              href="/get-started"
              className="text-muted-foreground hover:text-foreground group inline-flex items-center gap-1.5 text-[12.5px] transition-colors"
            >
              <ArrowLeftIcon
                className="ease-expo-out size-3 transition-transform duration-200 group-hover:-translate-x-0.5"
                strokeWidth={2}
              />
              Choose a different door
            </Link>
          </div>
          <Link
            href="/sign-in"
            className="text-muted-foreground hover:text-foreground text-[12.5px] transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="flex-1">
        {signupsClosedHere() ? (
          <SignupUnavailable title={SIGNUP_HOLD.title}>
            {SIGNUP_HOLD.lead}{" "}
            <a
              href={`mailto:${SITE.email}`}
              className="font-medium text-teal-700 underline decoration-teal-700/40 underline-offset-4"
            >
              {SITE.email}
            </a>
            .
          </SignupUnavailable>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
