# ADR 0127 — One password policy, and the NIST SP 800-63B-4 deviation

**Status:** Accepted — 2026-09-25 (Onboarding v2, D14). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

The non-clinical form took 8+ characters while the others required 12–72, and the 72 limit counted characters although bcrypt stops at 72 bytes.

## Decision

- 12 characters minimum and 72 **bytes** maximum on every form.
- The common-password list: 1,259 entries of 12+ characters, from the UK NCSC top-100k list, checked on the server only.
- The password may not contain the email's local part.
- Show/hide, paste allowed, `autocomplete="new-password"`.

## Consequences

**Recorded deviation.** NIST SP 800-63B-4 asks for 15 characters when a password is the only factor, which it is for patients. Revisit when phone one-time codes arrive. Staff add TOTP after approval, so 12 is above NIST's 8-with-MFA minimum.
