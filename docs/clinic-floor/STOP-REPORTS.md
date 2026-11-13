# Clinic floor — STOP reports

Owner said "go through all gates" (13 Nov 2026): steps run back to back; each STOP is logged here.

## STOP 0 — discovery

| Item            | Result                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Files           | `docs/clinic-floor/PROMPT.md`, `step-0-discovery.md`; canvas source `docs/design/canvases/clinic-floor/`                      |
| Base            | `feat/reception-desk` @ 4b44c851, not `main` (main has no shell) — D-CF-19                                                    |
| Engine          | `runTriage` `lib/triage/engine.ts:51`; 5 levels (L5 Blue); NEWS2 + ESI v5, **no TEWS**; per-parameter exposed                 |
| Gaps            | G1 re-check prose only · G2 no plausibility · G3 TEWS · G4 mobility/injury/weight · G5 Step 1 wording · G6 L5                 |
| Migration       | next free `0295` (checked every local + remote ref); ADRs next free `0491`                                                    |
| Baseline checks | typecheck 0 errors; vitest 92 files / 3 tests fail before any change (env `.env.local` absent in worktree, PGlite); list kept |
| Not measured    | screens, axe, INP, first-load JS (need a signed-in browser; no Playwright)                                                    |

## STOP 1 — GATE A

| Item   | Result                                                                              |
| ------ | ----------------------------------------------------------------------------------- |
| Files  | `gate-a-proposal.md` (routes, reuse, gaps, D-CF-01…21, tests, ADR slots, migration) |
| Signed | all as recommended — Fadhul, chat, 13 Nov 2026                                      |
| Copy   | `content/clinic-floor/floor.ts`, `draft` (grows per step)                           |
