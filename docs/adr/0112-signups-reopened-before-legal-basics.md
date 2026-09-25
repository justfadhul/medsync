# ADR 0112 — Sign-ups reopened in production before the privacy notice and PDPO registration

**Status:** Accepted — product-owner decision (2026-09-23, the owner's words: "change it back to hospital onboarding",
then "and so are the other onboarding routes please bring the forms back").

**Supersedes:** landing v4 S8 decision D1 as built with [ADR 0099](0099-landing-v4-slim.md) — "production collects no
personal data until a privacy notice is published and the PDPO registration is done".

## Context

D1 put a holding page ("Registration opens once our privacy notice is published.") on every `/signup/*` route in
production, made every sign-up submit action refuse, showed a closed note on `/get-started`, and switched the landing
FAQ's "Is MedSync live?" answer to its closed variant. All four follow `signupsOpen` in `lib/legal.ts`, which was
`privacyPublished && pdpoRegistered` — both still false. The owner found the hospital application unreachable in
production and asked for every form back.

## Decision

`lib/legal.ts` gains `signupsOwnerOverride = true`, and
`signupsOpen = signupsOwnerOverride || (privacyPublished && pdpoRegistered)`. Everything that reads `signupsOpen`
opens together: the four forms (patient, clinical, non-clinical, hospital), their submit actions, `/get-started` (no
closed note) and the FAQ (the "register now" variant). `legalConfig` is unchanged: the privacy notice, the terms and
the PDPO registration are still not done, and the footer still names Privacy/Terms as plain text.

## Consequences

- Production collects personal data again (patients, staff and hospital contacts) before the privacy notice is published or
  the PDPO registration is done. Uganda's Data Protection and Privacy Act 2019 requires both before collecting
  personal data. That risk is the owner's, taken knowingly.
- To restore D1, set `signupsOwnerOverride` to `false`; nothing else changes. When both legal flags become true, the
  override no longer matters and can be deleted.
- `tests/landing/faq.test.ts` §3 now expects the override in the `signupsOpen` formula; §9 (the production guard is
  still wired through the layout and every submit action) is unchanged.
