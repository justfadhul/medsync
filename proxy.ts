import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getAuthState } from "@/lib/auth";
import { landingTetherOn } from "@/lib/landing/feature";
import { pwRedirect, pwRewrite } from "@/lib/patient-web/routes";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 proxy (formerly middleware). Runs on every matched request.
 *
 * Responsibilities, in order:
 *   1. Refresh the Supabase session cookie (mandatory; the SSR client's
 *      `setAll` no-op fallback depends on this happening here).
 *   2. Gate routes:
 *        - public routes — always allowed
 *        - protected routes — require an authenticated user
 *        - clinical/admin routes — additionally require AAL2 (TOTP MFA)
 *        - users with a clinical/admin role who haven't enrolled MFA
 *          are sent to /onboarding/mfa-setup
 *
 * Matcher (bottom of file) excludes static assets, the Sentry tunnel, and
 * Next internals so we don't pay the cost on every chunk request.
 */

const PUBLIC_PREFIXES = [
  "/sign-up",
  "/sign-in", // includes /sign-in/mfa
  // Password reset: ask for a link, the link's page, choose the password. The last needs the link's
  // session and checks it (and aal2 where the account has an authenticator) on the page itself.
  "/forgot-password",
  "/styleguide",
  "/api/health",
  // Phase 1 onboarding — intent selector + the three role-specific
  // signup flows. All public (signup pages run unauth by definition).
  "/signup", // covers /signup/{patient,clinical,hospital}
  // The Emergency Pathway (ADR 0098 ruling 7): a patient mid-emergency is
  // never locked behind sign-in. E1–E3, crisis and sexual-violence routes.
  "/emergency",
  // A patient's live location link for family (ADR 0402): read by token alone, no sign-in.
  "/share",
  // The patient kit's harness page (PROMPT-PATIENT-WEB-TIDE S1): fixtures only, no patient data.
  "/pw/gallery",
];

// /privacy and /terms are read before anyone signs up.
const PUBLIC_EXACT = new Set(["/", "/sign-out", "/get-started", "/privacy", "/terms"]);

const ALWAYS_AUTH_REQUIRED_PREFIXES = [
  "/onboarding/mfa-setup",
  "/admin",
  // Hospital-admin workspace. Same gate shape as /admin (auth + AAL2 +
  // MFA enrolment). The layout-level guard in
  // app/hospital-admin/layout.tsx adds the tenant-scope resolution on
  // top — that lives there, not here, because middleware can't talk
  // to the DB cheaply on every request.
  "/hospital-admin",
  // Clinician workspace — same auth + AAL2 + MFA gate. Per-clinician
  // affiliation scope resolves in app/clinician/layout.tsx.
  "/clinician",
  // Lab-technician workspace — same auth + AAL2 + MFA gate. The AHPC
  // lab-cadre scope resolves in app/lab/layout.tsx (requireLabTechScope).
  "/lab",
  // Pharmacy workspace — same auth + AAL2 + MFA gate. The pharmacy-cadre scope, pharmacy.view and
  // PHARMACY_WORKSPACE resolve in app/pharmacy/layout.tsx (requirePharmacyScope).
  "/pharmacy",
  // The HMIS desk (Lab Phase 3 Step 9): the In-Charge, the HMIS focal person and the hospital admin. The
  // designation resolves in lib/lab/hmis-scope.ts (hmisDeskScope).
  "/hmis",
  // The referral governance desk (Lab Phase 4): the data protection lead, the IPC lead and the hospital admin.
  // The designation resolves in lib/lab/governance-scope.ts (governanceScope).
  "/referral-governance",
  "/ipc",
  // Patient workspace — requires auth. Patients are MFA-optional
  // (per kickoff), so the MFA branches in proxy.ts don't fire for
  // pure patients; a clinician-also-patient still gets MFA.
  "/patient",
  // The new patient pages (D-PW-10), reached directly only while PATIENT_WEB_TIDE is on.
  "/pw",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isProtected(pathname: string): boolean {
  return ALWAYS_AUTH_REQUIRED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * A redirect that keeps the cookies `updateSession` just wrote. `getUser()` may
 * have rotated the refresh token; a bare `NextResponse.redirect` drops the new
 * one, leaves the browser holding a spent token, and ends the session early
 * (Supabase SSR guidance: copy the cookies onto any new response).
 */
function redirectTo(url: URL, response: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // GATE A §1: an old patient URL that moved answers 308 to its new home, then gates there.
  const moved = pwRedirect(request.nextUrl.pathname);
  if (moved) return NextResponse.redirect(new URL(moved, request.url), 308);
  // ADR 0477: the Tether landing page's address is `/`; `/tether` is only where it is built.
  if (request.nextUrl.pathname === "/tether")
    return NextResponse.redirect(new URL("/", request.url), 308);
  const response = await gate(request);
  // D-PW-10: the new patient pages serve at the old URLs while PATIENT_WEB_TIDE is on. Gating above ran on
  // the URL the patient asked for; redirects (sign-in, MFA) pass through untouched.
  const target =
    pwRewrite(request.nextUrl.pathname) ??
    (request.nextUrl.pathname === "/" && landingTetherOn() ? "/tether" : null);
  if (!target || response.headers.has("location")) return response;
  const url = request.nextUrl.clone();
  url.pathname = target;
  const rewrite = NextResponse.rewrite(url, { request }); // carries the cookies updateSession refreshed
  for (const cookie of response.cookies.getAll()) rewrite.cookies.set(cookie);
  return rewrite;
}

async function gate(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Refresh cookies first — must happen for both public and protected so an
  // expiring session on a public page (e.g. /styleguide) gets a new token.
  const { response, userId } = await updateSession(request);

  if (isPublic(pathname)) return response;
  if (!isProtected(pathname)) return response;

  // Protected path from here on.
  if (!userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("redirect", pathname);
    return redirectTo(url, response);
  }

  // For role-gated MFA enforcement we need the auth helper. It calls into
  // the DB so we only run it for the routes that actually require it.
  const state = await getAuthState();

  // Case 1: user has MFA enrolled but hasn't passed the challenge this session.
  if (state.nextAal === "aal2" && state.aal !== "aal2") {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in/mfa";
    url.searchParams.set("redirect", pathname);
    return redirectTo(url, response);
  }

  // Case 2: user holds a clinical/admin role but hasn't enrolled MFA yet.
  if (state.mfaRequired && state.nextAal !== "aal2") {
    if (!pathname.startsWith("/onboarding/mfa-setup")) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding/mfa-setup";
      return redirectTo(url, response);
    }
  }

  return response;
}

export const config = {
  // Skip static assets, _next internals, the Sentry tunnel, and favicon.
  //
  // /bioniccell is excluded too: it is the sensor bench, a self-contained
  // static build under public/ with no session, no Supabase call and no
  // clinical data. Excluding it here means neither the page nor any of its
  // assets pays for a cookie refresh, and it can never be caught by a future
  // change to the gating rules above.
  matcher: ["/((?!_next|monitoring|favicon|bioniccell|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
