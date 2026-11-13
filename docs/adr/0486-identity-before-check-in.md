# ADR 0486 — Identity before check-in

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026, via the main chat (GATE A, `docs/reception/gate-a-proposal.md`). Built on `feat/reception-desk`.

## Context

A booking code proves possession of a ticket, not who is standing at the desk.

## Decision

Every booked check-in asks a second identifier: year of birth, else the last 3 phone digits; a consented photo is a hint, never the identifier. Each attempt writes a `desk_identity_attempts` row and an audit row with method and result only, never the answer given. Two misses stop the check-in and offer "Register as walk-in, identity to confirm".

## Consequences

One more question per check-in (target ≤ 6 key presses from code to triage). Records marked identity to confirm are cleared by the first matching check.
