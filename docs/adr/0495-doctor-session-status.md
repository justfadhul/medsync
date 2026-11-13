# ADR 0495 — Doctor session status

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026 (GATE A, `docs/clinic-floor/gate-a-proposal.md`). Built on `feat/clinic-floor`.

## Context

A doctor on a break must not be able to call, and the desk and screen must know without promising a time.

## Decision

Status is the latest `doctor_status` event: In room, short break (10, 15 or 30 min) or called away. Anything but In room blocks calls on the server (S13) and shows on the desk and screen with no time. No status yet counts as In room.

## Consequences

Running late keeps using `clinic_sessions.delay_minutes` (the reception desk's path); the floor logs its own event for the audit.
