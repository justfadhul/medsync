# ADR 0512: Authenticator setup opens under the password on the sign-in page

**Status:** Accepted, 15 Nov 2026. Fadhul, in chat: "also make the setup MFA section appear below signin… because now it leads to the medsync page."

## Context

The code step already opens under the password. A clinical or admin account with no authenticator yet still went on to `/onboarding/mfa-setup`, a page of its own in MedSync's look, also on the Tether domain. After setup it went to `/admin` whatever the role.

## Decision

- After a right password, when the account has no authenticator and holds a role in `MFA_REQUIRED_ROLES` (read by user id, as `lib/auth.ts` does; never with `DEV_SKIP_MFA`), the sign-in returns `setup`. The QR code, the secret and the code field open under the password in the page's look.
- The enrolment starts in its own request (`startEnrollmentAction`), after the password step has set the session cookies. The setup page uses the same action.
- After the code is accepted, the account goes where signing in would have gone (`landingFor`), not to `/admin`.
- `/onboarding/mfa-setup` stays for a session that opens a workspace before setup is finished. On the Tether domain it is drawn in the Tether look (`app/tether/onboarding/mfa-setup`).

## Consequences

- The authenticator app still lists the account as "MedSync", and the code step's helper says "the 6-digit code for MedSync".
