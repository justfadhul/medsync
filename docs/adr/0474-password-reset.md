# ADR 0474 — Users reset their own password by email; staff still pass their authenticator

**Status:** Accepted — 2026-11-12 (owner approved building it for the booking pilot). Replaces the sign-in page's
"email hello@medsync.health" panel (ADR 0099, Gate 0).

## Context

No one could reset a password. A locked-out receptionist needed MedSync support; hospital admins can reset MFA, not
passwords. Staff and patients both sign in by email and password (`lib/onboarding/account.ts`), so both need it.

## Decision

1. **Sign-in → "Forgot password?" → `/forgot-password`.** The user types their email; the server calls Supabase Auth
   `resetPasswordForEmail` with `redirectTo` = this site's `/forgot-password/confirm`.
2. **One answer for every email.** The page always says "If an account uses that email, we've sent it a link". A
   known email can fail where an unknown one succeeds (the per-email minute, the hourly mail limit, an address the
   mailer refuses), so errors are logged by code and never shown.
3. **The link's page has a button.** `/forgot-password/confirm` only shows "Continue"; the link is verified when the
   person presses it (`verifyOtp` with a token hash, or `exchangeCodeForSession` with Supabase's default PKCE code).
   Mail scanners such as Microsoft Safe Links open links before people do and would spend a one-time link on GET.
4. **The link opens an ordinary aal1 session**, in its own account slot, made active (ADR 0280). Proxy and the 0288
   `mfa_gate` treat it exactly as a password-only sign-in, so it never stands in for the authentication code.
5. **An account with an authenticator passes it before choosing the password.** `/forgot-password/new` and its action
   send an aal1 session with a verified factor to `/sign-in/mfa?redirect=/forgot-password/new`. The check reads the
   account's factors, not its roles, and ignores `DEV_SKIP_MFA`. If Supabase itself refuses the change below aal2
   (`insufficient_aal`), that goes to the same place.
6. **The sign-up password rules apply** (12–72 bytes, not a common password, not the email). After saving, every
   session of the account ends (`signOut({ scope: "global" })`) and the user signs in again with the new password.
7. `/forgot-password` is a public prefix in `proxy.ts`. Nothing else is opened.

## Consequences

- Production needs custom SMTP: Supabase's built-in mailer sends a few emails an hour, to team members only.
- The recovery email template should link to `/forgot-password/confirm?token_hash=…&type=recovery`; with the default
  template the link works only in the browser that asked for it.
- Whoever controls a patient's mailbox can take over the patient's account, as with any email reset. A staff mailbox
  alone is not enough once the person has set up their authenticator: it is still needed, before the password and
  at every sign-in. Staff who have not set one up yet are as exposed as they are to a guessed password.
- The phone app has no reset screen yet; a patient there can use the web.
