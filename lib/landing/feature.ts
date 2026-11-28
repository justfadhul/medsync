import { TETHER_LANDING_COPY_STATUS } from "@/content/tether-landing/copy";
import { TETHER_FAQ_COPY_STATUS } from "@/content/tether-landing/faq";

/**
 * `LANDING_TETHER` (ADR 0477): "1" serves the Tether landing page at `/` (proxy.ts rewrites to `/tether`).
 * Production keeps it off while either copy status is draft, whatever the variable says. Deleted at Step 7.
 */
export function landingTetherOn(
  env: string | undefined = process.env.LANDING_TETHER,
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  if (env !== "1") return false;
  if (vercelEnv !== "production") return true;
  return [TETHER_LANDING_COPY_STATUS, TETHER_FAQ_COPY_STATUS].every((c) => c.status === "signed");
}

/** Paths the Tether build serves in place of the hospital app's page while the landing is on (ADR 0498). */
const TETHER_PAGES: Record<string, string> = {
  "/": "/tether",
  "/sign-in": "/tether/sign-in",
  "/sign-in/mfa": "/tether/sign-in/mfa",
  "/onboarding/mfa-setup": "/tether/onboarding/mfa-setup",
};

/** Where proxy.ts rewrites `pathname` to, or null. The visible address never changes. */
export function tetherRewrite(pathname: string, on: boolean = landingTetherOn()): string | null {
  return on ? (TETHER_PAGES[pathname] ?? null) : null;
}

/**
 * `TETHER_HOSTS` (ADR 0499): the domains that serve Tether, comma-separated (`tether.ug,www.tether.ug`). Tether
 * is this app on its own domain: there the Tether landing and sign-in are always on, and only booking opens.
 */
export function isTetherHost(
  host: string | null,
  env: string | undefined = process.env.TETHER_HOSTS,
): boolean {
  if (!host || !env) return false;
  const name = host.split(":")[0]?.toLowerCase();
  return env.split(",").some((h) => h.trim().toLowerCase() === name);
}

/**
 * What the Tether domain opens: sign-in and sign-up, emergency, and the booking side of each workspace. The
 * clinical workspaces (record, lab, pharmacy, wards, HMIS, IPC, NCD) stay on MedSync's domain.
 */
const TETHER_OPEN = [
  "/sign-in",
  "/sign-up",
  "/sign-out",
  "/forgot-password",
  "/signup",
  "/onboarding",
  "/get-started",
  "/emergency",
  "/share",
  "/privacy",
  "/terms",
  "/not-authorised",
  "/offline",
  "/api",
  "/opengraph-image",
  "/patient",
  "/pw",
  "/reception",
  "/clinic", // the Tether clinic floor and its waiting-room screen (ADR 0491)
  "/clinician",
  "/doctor/schedule",
  "/nurse/incoming",
  "/hospital-admin",
  "/admin",
];

/**
 * True when the Tether domain does not serve `pathname`. Files (`/sw.js`, `/robots.txt`) always serve. ADR 0547: with
 * `NURSE_WARD_V2` set for any hospital, the nurse ward desk (`/nurse` and its pages) opens too; the page decides who sees it.
 */
export function tetherClosed(
  pathname: string,
  nurseWard: string | undefined = process.env.NURSE_WARD_V2,
): boolean {
  if (pathname === "/" || /\.[a-z0-9]+$/i.test(pathname)) return false;
  if (nurseWard?.trim() && (pathname === "/nurse" || pathname.startsWith("/nurse/"))) return false;
  return !TETHER_OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * ADR 0509: on the Tether domain a nurse's or doctor's MedSync home is the clinic floor, so signing in (or the old
 * triage link) lands there, not on a closed workspace.
 */
const TETHER_HOMES: Record<string, string> = {
  "/nurse": "/clinic",
  "/nurse/triage": "/clinic?view=triage",
  "/doctor": "/clinic?view=line",
  "/hospital-admin": "/hospital-admin/today", // ADR 0512, 0521: Today is the admin home
  // ADR 0510: the four ways to join sit beside the Tether sign-in form; MedSync's door page is not Tether's.
  "/get-started": "/sign-in",
};

export function tetherHome(
  pathname: string,
  nurseWard: string | undefined = process.env.NURSE_WARD_V2,
): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  // ADR 0547: with the ward desk on, `/nurse` decides itself (ward nurses stay, floor nurses go to the clinic floor).
  if (path === "/nurse" && nurseWard?.trim()) return null;
  return TETHER_HOMES[path] ?? null;
}
