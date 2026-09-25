# ADR 0117 — Triage opens as a sheet over the board (intercepting route)

**Status:** Accepted — 2026-09-24 (E1).

## Context

Triage → Assign Dr → Assigned → Start → encounter took four taps and four page loads (W6). The triage form
(`TriageDesk`) is a component shared with the nurses' pages.

## Decision

1. `app/doctor/(workspace)/@panel/(.)triage/[intakeId]` intercepts the triage link from the board and renders
   `TriageDesk` in a sheet. A reload or a shared link lands on the full `/doctor/triage/[intakeId]` page. The
   interception is scoped to the `(workspace)` route group, so no other route changes.
2. `TriageDesk` gains two optional props, `onSubmitted` and `backLabel`, and `submitTriageAction` also returns `why` and
   `lifeThreat`. Without the props the desk behaves exactly as before.
3. On submit the sheet shows the result and the next step: **Open resus** first for L1 or a Step-0 life threat, with
   Take & start still beside it (decision support, never a block); **Take & start**; Assign; Back to board.
4. **Take & start** is `takePatientAction`: it chains the existing audited assign and start rather than copying them,
   then opens the encounter. If the start fails after the assignment, the patient is left clearly assigned.

## Consequences

- From triage submit to the open encounter is one tap, with no list page.
- The sheet re-checks the flag and the triage scope on the server and reads the intake through the audited reveal.

## Alternatives considered

- **A client-only modal** — no shareable URL, and nothing to land on after a reload.
- **A second triage form for the sheet** — a copy of a 1,441-line clinical form.
