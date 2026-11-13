# ADR 0489 — Shared-desk PIN sessions

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026, via the main chat (GATE A, `docs/reception/gate-a-proposal.md`). Built on `feat/reception-desk`.

## Context

Several receptionists share one desk computer; every action must carry the right name (RD9) without a full sign-in each time.

## Decision

Each user sets a 4-digit PIN per desk device (`desk_devices`, `desk_pins`), stored as a bcrypt hash. The desk locks after 10 minutes unused; 5 wrong tries end the PIN and require full sign-in with MFA. A user switch is audited. Security review before the pilot.

## Consequences

A PIN never replaces the first sign-in with MFA on a device.
