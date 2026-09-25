# ADR 0119 — Onboarding v2: one page per form, no Next

**Status:** Accepted — 2026-09-25 (Onboarding v2, D1, D18). Build record: `docs/onboarding-v2/STOP-REPORTS.md`.

## Context

Testers (25 Sep 2026) found the four signup forms long and tiring: 2 / 3 / 0 / 6 Continue presses (patient / clinical / non-clinical / hospital). Fadhul didn't want to keep pressing Next.

## Decision

1. Each form is **one page with numbered sections** (`[01]`…) and **one primary button**. Sections fill in any order. The kit is `components/onboarding/sectioned-form.tsx`.
2. **Progress:** a sticky bar under the header on phones ("1 of 3 done"); a rail on desktop, whose plum dot marks the section in view (a place, not a state) with a state word for each item.
3. **Submit:** never disabled. It validates everything against the same Zod schema the server re-runs, then an amber summary at the top links to each field.
4. **Autosave:** a sessionStorage draft that never holds a password, NIN or file.
5. **Idempotent submit:** the key's SHA-256 rides in the new account's `user_metadata`, and a retry after a lost response signs back in instead of failing. There is no table.
6. **Behind `ONBOARDING_V2=1`,** or per browser at `/signup/preview`. The old forms stay the default until the Phase 7 targets are met.

## Consequences

- 0 Continue presses on all four forms.
- The kit is scoped to v2: `components/forms/*` is untouched, so flag-off pages behave exactly as before (S14).
- React Hook Form enters the client bundle; first-load JS stays within each route's baseline (STOP 7 numbers).
