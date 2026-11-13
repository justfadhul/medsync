# ADR 0488 — Offline check-in queue

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026, via the main chat (GATE A, `docs/reception/gate-a-proposal.md`). Built on `feat/reception-desk`.

## Context

Clinics lose internet; a lost check-in is a lost patient (RD10).

## Decision

Check-ins only work offline. Each carries a client id; it waits in an encrypted IndexedDB queue on the device (key held in memory for the signed-in session) and replays when online. The server dedupes by `(hospital_id, client_id)` on `patient_intakes`, so a replay returns the first result. Booking and walk-in registration need a connection; printing today's list works offline.

## Consequences

A device closed before syncing keeps its queue until next sign-in; the banner says how many wait.
