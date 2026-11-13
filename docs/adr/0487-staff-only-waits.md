# ADR 0487 — Staff-only waits under ADR 0084

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026, via the main chat (GATE A, `docs/reception/gate-a-proposal.md`). Built on `feat/reception-desk`.

## Context

ADR 0084 forbids showing patients a position, a count ahead or a promised hour. The desk needs a rough wait to choose a clinic for a walk-in.

## Decision

The desk may show a wait, labelled for staff. Slips, tickets and SMS never carry a position, a count ahead or an hour promise (a signed doctor's-time slot excepted). A guard test scans the slip, ticket and SMS templates.

## Consequences

Queue honesty holds for patients; staff keep their working estimate.
