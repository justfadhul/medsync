# ADR 0477: The Tether landing page is booking-first

**Status:** Accepted, 13 Nov 2026, signed by Fadhul (CSO) in chat at GATE A of `PROMPT-LANDING-TETHER.md` (`docs/landing/gate-a-proposal.md`).

## Context

The v4 landing page (ADR 0099) sells the whole hospital system and was built before the engines existed. Tether launches with booking at about five private clinics in Uganda.

## Decision

- `/` sells booking only: how a patient books, what a clinic gets, and the next step for each.
- It is rebuilt from the Tether canvas behind `LANDING_TETHER` (`lib/landing/feature.ts`) and replaces v4 at cutover. Production keeps the flag off while the page's copy is `draft`.
- The new components live in `components/landing/tether/`, the copy in `content/tether-landing/`.
- `/about`, `/get-started`, the legal pages and the auth shell keep the shared old nav, footer and primitives.

## Consequences

- Founders, Trust and the ward mock leave `/`; the parity report lists them as intentional removals.
- Supersedes ADR 0099 for `/` only. The old page and the flag are deleted at Step 7, with 308s for any moved URL.
