# ADR 0492 — The triage UI is a pure consumer of the triage engine

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026 (GATE A, `docs/clinic-floor/gate-a-proposal.md`). Built on `feat/clinic-floor`.

## Context

The canvas imitates the engine with a stand-in. A second copy of any threshold is a clinical-safety hazard.

## Decision

The floor calls `runTriage`, `recommend` and `interpretVitals` (`lib/triage`) and saves through `submitTriageAction` (authority, override reason, audit). No scale, score, threshold, level or re-check interval lives outside `lib/triage`. Two projections were added inside the engine with CSO sign-off (D-CF-20): a typed `recheck` band on the existing `monitor_interval` suggestion and `RECHECK_DUE_MINUTES` for the bands that say "at minimum hourly". TEWS, mobility, injury and weight are not engine inputs and are not shown (G3, G4); Step 1 lists the engine's six manual life threats in its own words (G5); all five levels render (G6).

## Consequences

A guard test fails on vital-sign threshold literals in floor code; a parity test compares the panel with a direct engine call.
