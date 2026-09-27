import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthState } from "@/lib/auth";
import { ClaimInvitationForm } from "./_components/form";

export const metadata: Metadata = {
  title: "Claim hospital admin role · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface SearchParams {
  token?: string;
}

/**
 * Hospital-admin invitation claim landing (GATE E §G).
 *
 * The invited admin arrives here from the URL the superadmin shared:
 *   /admin/claim-invitation?token=<plaintext>
 *
 * Requirements before the claim Edge Function will accept:
 *   1. Signed in (we bounce to /sign-up if not — they need to make an
 *      account first using the invited email address).
 *   2. AAL2 session (TOTP MFA enrolled + challenged this session).
 *      The proxy already gates /admin to AAL2; this page lives under
 *      /admin so unmet MFA bounces to /onboarding/mfa-setup
 *      automatically.
 *   3. Email match (enforced server-side by the Edge Function).
 *
 * The form below is a thin client component that POSTs the token to
 * accept-hospital-admin-invitation and displays the result.
 */
export default async function ClaimInvitationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const state = await getAuthState();

  // The proxy already enforces auth + AAL2 + MFA-enrolment for /admin.
  // Defence in depth: if for any reason getAuthState returned no user
  // (e.g. session expired between proxy + render), bounce to sign-in
  // with this URL as the post-sign-in destination.
  if (!state.user) {
    const next = `/admin/claim-invitation${sp.token ? `?token=${encodeURIComponent(sp.token)}` : ""}`;
    redirect(`/sign-up?redirect=${encodeURIComponent(next)}`);
  }

  if (!sp.token) {
    return (
      <div className="mx-auto max-w-xl px-5 py-12">
        <h1 className="font-display text-display-s text-foreground">Missing invitation token</h1>
        <p className="text-muted-foreground mt-2 text-[13.5px]">
          The link you followed doesn&apos;t include a token. Ask the superadmin who invited you to
          re-share the URL.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-12">
      <header className="mb-6 flex flex-col gap-2">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
          Hospital admin invitation
        </span>
        <h1 className="font-display text-display-s text-foreground">Claim your role</h1>
        <p className="text-muted-foreground text-[13.5px]">
          You&apos;ve been invited as a hospital admin. Confirming below grants your account the
          hospital_admin role for that hospital + records you in the admin roster as the primary (or
          backup, if a primary is already in place). This is the only legitimate way to take the
          role on this hospital.
        </p>
      </header>
      <ClaimInvitationForm token={sp.token} />
    </div>
  );
}
