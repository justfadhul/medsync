import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { SignOutButton } from "@/components/medsync/sign-out-button";
import { MobileTabBar } from "@/components/responsive/mobile-tab-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { dataProcessingConsent, resolvePatientScope } from "@/lib/patient/scope";
import { PatientNavRail } from "./_components/patient-nav-rail";
import { RegisterServiceWorker } from "./_components/register-sw";
import { LANDING_NAV, PATIENT_NAV } from "./_lib/nav";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Patient workspace shell.
 *
 *   - Below `md:`: sticky top bar + bottom tab bar. Thumb-reachable, no rail.
 *   - `md:` and up: the same top bar + a persistent left rail (the tab bar
 *     hides itself at that breakpoint). At `lg:` the rail grows labels.
 *
 * Both navs render `PATIENT_NAV`. They used to render two different arrays,
 * which is why /patient/menu and everything under it had no desktop entry.
 *
 * The top bar is kept at every width on purpose. Dropping it at `lg:` would
 * have invalidated every `sticky top-*` offset below it and the global
 * `[data-section-anchor] { scroll-margin-top: 80px }`; keeping the 52px bar
 * makes `top-13` the single sticky constant in the workspace.
 *
 * `@container/page` on the content wrapper is what pages size their second
 * column against (`@5xl/page:`) — a container query, because with the rail
 * and the gutters the content box is ~300px narrower than the viewport and
 * a viewport breakpoint would fire at the wrong moment.
 *
 * `resolvePatientScope`, not `require`: the pages carry the consent gate
 * (ADR 0094) and redirect to /patient/consent, which renders inside this
 * shell — a layout that redirected too would loop. While the gate is closed
 * the shell drops its navigation: every rail and tab item would land straight
 * back on the consent page, and the phone hides the same screens for the same
 * case. The header's Sign out stays — it is the way not to agree.
 */
export default async function PatientLayout({ children }: { children: ReactNode }) {
  const scope = await resolvePatientScope();
  // Both `cache()`d, so the page's own gate check costs no second query.
  const consent = await dataProcessingConsent(scope.userId);
  const gated = consent !== null && consent.acceptedAt === null;
  const nav = scope.primaryHospitalId ? PATIENT_NAV : LANDING_NAV;

  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col">
      <RegisterServiceWorker />
      <header className="border-border glass sticky top-0 z-30 flex h-13 items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/patient"
            className="font-display text-foreground text-body-m inline-flex min-h-11 items-center font-semibold"
          >
            MedSync
          </Link>
          {scope.primaryHospitalName ? (
            <span
              data-place
              className="text-muted-foreground text-caption hidden min-w-0 items-center gap-1.5 font-mono tracking-[0.16em] uppercase sm:inline-flex"
              title={scope.primaryHospitalName}
            >
              {/* Static dot: nothing on this surface is live, so it doesn't
                  pulse. Plum, not teal: it says where you are, and teal on
                  this page only ever means something to press (ADR 0097). */}
              <span
                aria-hidden
                className="bg-sky-icon ring-sky-edge size-1 shrink-0 rounded-full ring-2"
              />
              <span className="truncate">{scope.primaryHospitalName}</span>
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* The shipped toggle is a 28px bordered box. The 44px touch floor
              is applied here rather than in the shared component, which five
              other workspaces render at their own density — and the chrome
              comes off with it, so a 44px target still reads as the bare
              glyph this header wants beside a plain text link. */}
          <ThemeToggle className="size-11 border-transparent bg-transparent" />
          <Link
            href="/accounts"
            className="text-muted-foreground hover:text-foreground decoration-border text-body-s inline-flex min-h-11 items-center underline-offset-4 transition-colors hover:underline"
          >
            Switch account
          </Link>
          <SignOutButton className="text-muted-foreground hover:text-foreground decoration-border text-body-s inline-flex min-h-11 items-center underline-offset-4 transition-colors hover:underline" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {gated ? null : <PatientNavRail hospitalName={scope.primaryHospitalName} items={nav} />}

        <main className="bg-muted min-w-0 flex-1 pb-24 md:pb-0">
          <div className="@container/page mx-auto w-full max-w-300 px-4 py-6 md:px-6 md:py-8">
            {/* The in-flow amber emergency block left this shell (ADR 0098
                ruling 7): the red pill in the root layout is the affordance
                on every screen, and /emergency carries the hospital's
                verified number. The consent gate keeps its own block. */}
            {children}
          </div>
        </main>
      </div>

      {gated ? null : <MobileTabBar items={nav} />}
    </div>
  );
}
