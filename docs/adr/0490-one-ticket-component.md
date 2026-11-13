# ADR 0490 — One Ticket for example and real tickets

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026, via the main chat (GATE A, `docs/reception/gate-a-proposal.md`). Built on `feat/reception-desk`.

## Context

The landing hero shows an example ticket; the desk shows a caller's real ticket. Two components would drift.

## Decision

`Ticket` takes `mode: "example" | "real"`. Example mode shows invented data and the example label; real mode shows the booking from the engine. Built in the landing branch, merged here before the desk uses it.

## Consequences

One component, two consumers; motion follows the design system and reduced motion.
