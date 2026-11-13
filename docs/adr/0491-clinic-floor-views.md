# ADR 0491 — Clinic floor views and placement

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026 (GATE A, `docs/clinic-floor/gate-a-proposal.md`). Built on `feat/clinic-floor`.

## Context

The booking-first pilot needs a triage station, the doctor's clinic line and a floor board after the reception desk hands off. The Doctor Workspace exists but is an inpatient-first lane board.

## Decision

One route, `/clinic`, with three views (Triage, Clinic line, Floor) and `/clinic/screen` for the waiting room, behind `CLINIC_FLOOR` (`1` or hospital ids; production also needs the floor copy signed). Default view by role: nurse → Triage, doctor → Clinic line, in-charge → Floor (D-CF-01). The shell is the reception desk's, extracted once and shared.

## Consequences

Old triage pages stay until parity is signed; then 308s to `/clinic` (Step 8). One append-only table, `clinic_floor_events` (migration 0295, GATED), holds the floor's state changes.
