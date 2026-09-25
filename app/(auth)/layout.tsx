import Link from "next/link";

import { EmergencyButton } from "@/components/landing/emergency-button";
import { LANDING_FOCUS } from "@/components/landing/primitives";
import { AUTH_SHELL } from "@/content/auth";
import { legalConfig } from "@/lib/legal";
import { cn } from "@/lib/utils";

/**
 * AuthLayout (ADR 0099) — the shell for /sign-in, the MFA step, /forgot-password,
 * and the other (auth) pages (/sign-up, /onboarding/mfa-setup) that share this
 * route group. Light only (app/providers.tsx forces it; no theme switch), calm
 * and plain: a 64px top bar with the wordmark and the one EmergencyButton, a
 * centred 400px column whose top sits at 12vh, and a minimal legal footer. No
 * gradients, glows, grain or entrance animation.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("bg-background text-foreground flex min-h-svh flex-col", LANDING_FOCUS)}>
      <header className="border-border border-b">
        <div className="mx-auto flex h-16 w-full max-w-300 items-center justify-between gap-4 px-4 sm:px-8">
          <Link
            href="/"
            className="font-display text-heading-s text-foreground inline-flex min-h-11 items-center rounded-sm"
          >
            {AUTH_SHELL.wordmark}
          </Link>
          <EmergencyButton />
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 pt-[12vh] pb-16 sm:px-8">
        <div className="w-full max-w-100">{children}</div>
      </main>

      <footer className="border-border border-t">
        <p className="text-body-s text-muted-foreground mx-auto w-full max-w-300 px-4 py-6 sm:px-8">
          {[...AUTH_SHELL.footer, `${AUTH_SHELL.copyright} ${legalConfig.legalEntityName}`].join(
            " · ",
          )}
        </p>
      </footer>
    </div>
  );
}
