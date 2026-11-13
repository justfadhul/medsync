# ADR 0493 — Line-order rule

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026 (GATE A, `docs/clinic-floor/gate-a-proposal.md`). Built on `feat/clinic-floor`.

## Context

The doctor calls the next person; the order must be explainable and staff-only (ADR 0084).

## Decision

`lineOrder()` (`lib/clinic-floor/model.ts`): engine level, most urgent first; back from tests with results ranks after L3 and before L4 (D-CF-15); not triaged (straight from the desk) sits with L4; a first "didn't come" moves them to the end of their group; then arrival (D-CF-02, D-CF-04). A second "didn't come" ends the visit as didn't wait.

## Consequences

Pure and table-tested. Open question for the CSO: the untriaged-with-L4 placement is this ADR's reading, not a signed line.
