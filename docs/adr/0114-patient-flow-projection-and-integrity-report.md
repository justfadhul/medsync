# ADR 0114 — The patient flow projection and its integrity report

**Status:** Accepted — 2026-09-24. The rules that change what a clinician is shown — FW-5 (stale L1, D9), FW-6 (idle,
D3), FW-7 (death, D2) and FW-10 (wait colour, D4) — wait for the CSO's signature before the flag is set.

## Context

Triage records, assignments (planned encounters), encounters, resus episodes and deaths were each listed by their own
page with their own filters, so contradictions — a dead patient still waiting, three live assignments — could not be
seen anywhere. The fix belongs below the UI.

## Decision

1. **`computeFlow(input)`** in `lib/workspace/flow.ts`: pure, no I/O, deterministic. Rules FW-1 to FW-11 (prompt §6)
   each have a describe block in `tests/workspace/flow.test.ts`; `rule-coverage.test.ts` fails if one loses its cases.
2. **Nothing disappears (Law 3).** Every open item is on exactly one row: as its primary item, as an intake its
   encounter answers, or under **Also open** with the actions that already exist for it. Stale or contradictory items
   go to Needs closing; nothing closes itself. A 400-seed property test holds this, and one row per patient, on random
   boards.
3. **Current acuity** is the visit's latest triage record (FW-3). Duplicate planned encounters collapse onto the newest
   (FW-4), with an "N assignments" badge.
4. **No remembered numbers (Law 5).** The L1 lookback reuses the resus board's 24 h `OPENABLE_LOOKBACK_MS`; the
   encounter idle window is 24 h (D3, a constant); wait time is coloured only against a CSO-signed target, and none is
   signed, so it stays neutral elapsed time.
5. **Integrity report.** `computeFlow` also returns every contradiction it resolved — deceased with open items,
   duplicate assignments, stale L1, idle encounters and resus — for Needs closing and for the owner's baseline
   (`docs/doctor-workspace/integrity-probe.sql`, read-only).
6. **One query layer.** `lib/workspace/queries.ts` reads in three phases (nine calls) whatever the row count, the way
   the old pages read (the server `db`, scoped in the app), and reveals names through the audited
   `revealPatientIdentities` for the patients on the board only.

## Consequences

- The board, the encounter page's rail and the next-patient offer are views of one projection; a new rule starts as a
  test.
- `lib/resus/board-v2.ts` gains `patientUserId` on its rows (to group by patient) and exports its lookback.
- Each query is capped at 300 rows; a department past that has a bigger problem than the board.

## Alternatives considered

- **A Postgres view** — it would need `security_invoker` and its own RLS probes, and would put precedence in SQL; a pure
  function is testable on its own.
- **Fixing each page's filter** — four copies of the same rules.
