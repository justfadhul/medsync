# ADR 0496 — Trends across visits on the clinic line

**Status:** Proposed — 13 Nov 2026. GATE A signed in chat by Fadhul (CSO), 13 Nov 2026. Built on `feat/clinic-floor`.

## Context

The doctor wants to see whether blood pressure, weight or sugar is moving across visits, without a new clinical rule.

## Decision

`lib/clinic-floor/trends.ts` reads the person's past readings; the target bands are content (`content/clinic-floor/bands.ts`, `draft`), not engine thresholds. While the bands are unsigned each card says "draft". The card states the last reading's status in words, never by colour alone; every point is reachable by keyboard.

## Consequences

No band changes a level or a call. Signing the bands is a CSO item; the live loader has no past readings yet (`readings: []`), so live cards appear once the read model joins EMR observations.
