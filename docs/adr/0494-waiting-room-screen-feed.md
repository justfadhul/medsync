# ADR 0494 — Waiting-room screen feed under ADR 0084

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026 (GATE A, `docs/clinic-floor/gate-a-proposal.md`). Built on `feat/clinic-floor`.

## Context

A TV in the waiting room must call people without exposing them.

## Decision

`screenFeed()` returns only booking code, room and call time, plus rooms whose doctor is on a short break or called away (D-CF-03, D-CF-09). No name, phone, position, count ahead or wait.

## Consequences

A test pins the item shape to exactly three keys; a guard scans the screen's code and copy for names, positions and promised times.
