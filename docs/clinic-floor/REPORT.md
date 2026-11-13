# Clinic floor — report (STOP 8)

Branch `feat/clinic-floor` (worktree `clinic-floor-4f4be4`), cut from `feat/reception-desk` 4b44c851. Not pushed, not deployed. Flag `CLINIC_FLOOR` off: today's pages unchanged.

## What is built

| Area                | Where                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Floor surface       | `/clinic` (live, `requireTriageScope`, flag) · `/styleguide/clinic-floor?role=nurse\|doctor\|incharge&scenario=first\|offline` |
| Triage station      | `components/clinic-floor/triage.tsx` — worklist, next-up, re-checks, Steps 1–4 panel; engine only (`runTriage`, `recommend`)   |
| Clinic line         | `line.tsx` — status, call / here / call again / didn't come, With you, Trends, finish + follow-up Ticket, running late, end    |
| Floor board         | `board.tsx` — flow, clinic × step, everyone list, Needs a hand                                                                 |
| Waiting-room screen | `/clinic/screen?clinic=` — server sends codes, rooms, call times only (S3)                                                     |
| Offline             | `lib/clinic-floor/queue.ts` (ADR 0497)                                                                                         |
| Live data           | `lib/clinic-floor/load.ts`                                                                                                     |
| Data / engine       | migration `0295_clinic_floor.sql` **GATED, unapplied** · `recommend.ts` re-check band (projection only)                        |
| ADRs                | 0491–0497                                                                                                                      |
| Copy                | `content/clinic-floor/floor.ts`, `bands.ts` — `draft`                                                                          |

Screens: `docs/clinic-floor/screens/` (1440 light/dark, 834 light/dark, 390 light/dark; fixture data).

## Section 9 — numbers

| Measure                                  | Result                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| T10 parity (panel ↔ engine)              | **100 %** — 200 seeded sets, level and reasoning equal (`tests/clinic-floor/triage-parity.test.ts`) |
| Triage numbers outside the engine        | **0** (S10 guard)                                                                                   |
| Strings outside `content/clinic-floor/`  | **0** English JSX sentences (guard); a few unit glyphs (`%`, `°`, `L`) stay in code                 |
| Parity items lost                        | **5**, listed in `tests/parity/clinic-floor/renames.json` (unsigned) — see open items               |
| Controls, Start triage → Send (adult)    | 1 (None of these) + 6 vitals boxes + Send = 8, plus the doctor chip when not preset; not timed      |
| Taps: call, start, finish                | Call next (N) 1 · They're here 1 · Finish (F) 1 + Save 1                                            |
| First-load JS, INP, CLS, action p95, axe | **not measured** — no signed-in browser run, no Playwright (new dependency = STOP)                  |

## Checks

typecheck 0 · lint 0 · vitest: 8 files fail, all in the 92-file base list (env / PGlite), none new; clinic-floor + reception tests green

## Open — needs the owner

1. **Apply 0295** before the flag goes on: `cd /Users/airm1/Desktop/medsync/.claude/worktrees/clinic-floor-4f4be4 && npm run db:migrate`.
2. **Parity gaps before cut-over** (engine inputs): SpO₂ scale 2 and pregnancy are not asked on the floor (sent as off / unknown). Keep `/nurse/triage` until they are added. Also not on the floor: other discriminators, recommendation accept/dismiss.
3. **Not linked live:** follow-up booking (a clinician can't call the desk's reception-scope action; the desk books it), lab "results back" (no release join yet), past readings for Trends, age/sex on the live loader (the engine gets `ageYears: null`).
4. **Dropped from the canvas:** "Check this value" plausibility (no engine helper; S10 forbids local numbers) and mobility/injury chips (the engine takes neither).
5. **CSO:** sign the copy, the trend bands, the desk keyword list; confirm untriaged patients sit with L4 in the line (ADR 0493).
6. **Step 8 not done (owner):** pilot one clinic for 2 days, sign parity, then delete the old pages and flag (308s kept); axe and budgets on a signed-in run.
7. **Shared with the desk:** `components/reception/shell.tsx` (label prop, hydration-safe dark toggle), `desk.module.css` (wide dialog width, reset skips the Ticket), `lib/reception/desk/queue.ts` (`slot`).
8. At 834 the sidebar user card wraps its clinic line; cosmetic.
