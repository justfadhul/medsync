# ADR 0497 — Offline triage on the clinic floor

**Status:** Proposed — 13 Nov 2026. GATE A (D-CF-12) signed in chat by Fadhul (CSO), 13 Nov 2026. Built on `feat/clinic-floor`.

## Context

The floor loses its connection. Triage must not be lost; a call to a room must never be pretended.

## Decision

Offline, a finished triage (the engine ran on the device, it is pure) is sealed in the reception desk's encrypted IndexedDB store under its own slot (`floor-triage`) and replayed through the same server action when the connection returns. The server dedupes by the floor's client id. A refusal stays queued for a person to see. Calls, finishing and booking refuse offline with a word.

## Consequences

`lib/reception/desk/queue.ts` gains a `slot` argument (default unchanged). A queued triage shows on this device only until it syncs.
