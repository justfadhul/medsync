"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SirenIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The persistent Emergency pill (ADR 0098 ruling 7; PRD MS-PRD-SYM-001
 * §8.1): on every route, signed in or out, one tap to the Emergency sheet
 * and two to a call. Mounted once in the root layout. It is the one place
 * outside the sheet that paints red (`variant="emergency"`), and the word
 * rides with the icon — never colour or glyph alone.
 *
 * Placement: bottom-right on `md:` and up. On phones under /patient it
 * clears the fixed `MobileTabBar` (3.5rem + safe area, the constant
 * `BottomActionBar` clears) AND the resting sticky action bar above it
 * (~4.5rem: py-3 + a lg button + border), so a full-width "Book a place"
 * is never covered; elsewhere on phones it sits on the safe-area edge.
 * `z-30` like the tab bar — below dialogs, so a modal can cover it.
 *
 * Hidden on /emergency/** itself: the sheet IS the affordance there. Also
 * hidden on the landing (`/`, `/about`), `/get-started` and the (auth) shell
 * (ADR 0099): their top bar carries the shared EmergencyButton, so a second
 * control would double up. It also stands down on any page that renders its
 * own Emergency link marked `data-emergency-inline` (the resus desk header,
 * PROMPT §5.7 / P11), so it never floats over bedside controls — and never
 * leaves a page without one.
 * Pulses once on mount (PRD §7.5), `motion-safe:` only — no continuous
 * pulse, no pulse at all for reduced-motion users.
 */
/** Routes whose top bar carries the shared EmergencyButton (ADR 0099: get-started and the (auth) shell). */
const HEADER_EMERGENCY = [
  "/get-started",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/onboarding/mfa-setup",
];

export function EmergencyPill() {
  const pathname = usePathname();
  if (pathname === "/emergency" || pathname.startsWith("/emergency/")) return null;
  if (pathname === "/" || pathname === "/about") return null; // ADR 0099: the landing header carries Emergency
  if (HEADER_EMERGENCY.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  const abovePatientBars = pathname === "/patient" || pathname.startsWith("/patient/");

  // Its own landmark: axe's region rule wants every piece of page content
  // inside one, and the pill floats outside every page's <main>.
  return (
    <nav
      aria-label="Emergency"
      className={cn(
        "fixed right-4 z-30 md:right-6 md:bottom-6",
        abovePatientBars
          ? "bottom-[calc(8.5rem+max(env(safe-area-inset-bottom),0.5rem))]"
          : "bottom-[max(env(safe-area-inset-bottom),1rem)]",
        // While the catalog's tray is unfolded the bar grows past the pill's
        // resting height: the pill moves to the top-right for that moment.
        "[body:has([data-bottom-bar-expanded])_&]:top-4 [body:has([data-bottom-bar-expanded])_&]:bottom-auto",
        "[body:has([data-emergency-inline])_&]:hidden",
      )}
    >
      <Link
        href="/emergency"
        aria-label="Emergency — get help now"
        className={cn(
          buttonVariants({ variant: "emergency", size: "lg" }),
          "min-h-12 rounded-full shadow-lg",
          "motion-safe:animate-[medsync-pulse-dot_400ms_var(--ease-symmetric)_1]",
        )}
      >
        <SirenIcon aria-hidden className="size-5" strokeWidth={2} />
        Emergency
      </Link>
    </nav>
  );
}
