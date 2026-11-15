# Reception desk — final report (STOP 8)

Branch `feat/reception-desk`, worktree `.claude/worktrees/reception-desk-15bb79`. GATE A signed in chat by Fadhul (CSO),
13 Nov 2026. Copy `draft`. Per-step reports: `STOP-REPORTS.md`.

**Stopped before:** turning `RECEPTION_DESK` on for a pilot clinic, deleting the old pages and flag, and the 308s.
Those wait for the owner: migration 0294 applied, five functions redeployed, parity signed, copy signed.

## Owner steps, in order

1. `cd /Users/airm1/Desktop/medsync/.claude/worktrees/reception-desk-15bb79 && npm run db:migrate` (0293 clinic leads, 0294 reception desk; both GATED).
2. Deploy `ha-reception-desk`; redeploy `ha-check-in-patient`, `ha-set-session-delay`, `ha-pre-arrival-arrived`, `ha-register-patient`.
3. Sign `tests/parity/reception/renames.json` and the desk copy (`RECEPTION_DESK_COPY_STATUS`).
4. `RECEPTION_DESK=<pilot hospital id>` for two days; then Step 8's cut-over (delete old pages, keep 308s).

## Section 9 — numbers

| Measure (budget)                         | Baseline (old pages)    | Result (desk)                                                                           | How measured                                                                               |
| ---------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| First-load JS `/reception` (≤ 160 KB gz) | 341.6 KB (main, 15 Nov) | 263.4 KB: shared root 229.7 + reception 33.7 (15 Nov, `perf/reception-desk-first-load`) | `.next/diagnostics/route-bundle-stats.json`, gzip -9; **over budget** (root alone is over) |
| INP, Arrivals, 300 rows (≤ 200 ms)       | not measured            | fixture, ~20 rows: 136–224 ms; 232–296 ms at 4× CPU (main 160–272; noise)               | needs a signed-in browser run                                                              |
| CLS (≤ 0.05)                             | not measured            | 0.0027–0.0038 (fixture; main 0)                                                         | same                                                                                       |
| Code found → identity (≤ 1 s p95)        | —                       | local, no round trip (code entry is client-side over today's rows)                      | code reading                                                                               |
| Server action p95 (≤ 300 ms)             | not measured            | not measured                                                                            | needs the migration applied                                                                |
| axe serious/critical (0)                 | not measured            | 3 (same on main; see below)                                                             | needs a browser run; no Playwright                                                         |
| Horizontal scroll at 390 (0)             | not measured            | 0 (fixture)                                                                             | needs a browser run                                                                        |
| Guards, Appendix C (0 failures)          | —                       | 0 (5 static guards + shortcuts)                                                         | `tests/reception/desk-guards.test.ts`, `desk-model`                                        |
| Key presses, code check-in               | —                       | 4 commands (C, Enter, Enter, To triage) + 6 code and 4 year characters                  | static count                                                                               |
| Taps for a walk-in                       | —                       | not measured                                                                            | needs a browser run                                                                        |
| Parity items lost (0)                    | —                       | 0 (unsigned)                                                                            | `tests/reception/desk-parity.test.ts`                                                      |
| Old reception components remaining (0)   | —                       | all (cut-over not done, by design)                                                      | Step 8 stop                                                                                |
| Strings outside `content/reception/` (0) | —                       | 0 visible labels; audit reasons stay in the port                                        | grep sweep, `DESK.ui`                                                                      |

First-load JS: the shared root (react-dom, the Next router, the Sentry SDK, tailwind-merge) is 229 KB on its own, already over the 160 KB budget and
untouched by this work. The page's own 51 KB holds the desk and the old page's islands together while the flag
exists; the cut-over removes the old ones. Bringing the root under budget is its own task.

## Tests

| Suite                                  | Result               |
| -------------------------------------- | -------------------- |
| `tests/emr-db/reception-desk` (PGlite) | 7/7 (`EMR_PGLITE=1`) |
| `desk-engine`, `session-booking`       | 8/8, 9/9             |
| `desk-model`, `desk-map`               | 9/9, 3/3             |
| `desk-queue` (S22 included)            | 4/4                  |
| `desk-guards`, `desk-parity`           | 5/5, 1/1             |
| landing (Ticket)                       | 52 pass              |

## Safest choices made (for the CSO)

- Red only for emergencies: "code not found", "identity to confirm" and no-show now take ink with the word.
- Offline, the identity answer is kept and judged by the server at sync; a mismatch is not checked in and the desk names them.
- No fee model: fee shows "No fee"; unknown sex or age stay unknown; a walk-in with no record uses the unknown-patient label.
- Booking reason goes as `other` with the caller's words; the engine's reason codes are not guessed.

## Known limits (follow-ups)

- One session per clinic per day on the desk; doctor's-time slots not yet loaded live.
- Desk users list only the signed-in user until the admin sets the desk's people (D-RD-20); PIN set-up has no UI yet.
- Book search covers today's board; the wider patient search is a follow-up.
- Two older tests (`arrivals-queue`, `desk-takeover`) need `.env.local` to load; 12 drizzle-parity failures predate this work.

## First-load JS follow-up (15 Nov 2026, branch `perf/reception-desk-first-load`)

No behaviour change. Three splits:

1. **⌘K bar** (`components/medsync/command-bar.tsx`): the dialog and combobox (`command-bar-panel.tsx`, with
   floating-ui) load on their own chunk, fetched when the page is idle or on first open. Every workspace gains.
2. **Desk calendar and dialogs** (`components/reception/desk.tsx`): `DeskCalendar` and `DeskDialogs` (forms,
   ticket, slip) are `next/dynamic`; the calendar preloads when idle, and the dialogs mount when the desk is idle
   or at once when one is asked for first (all are closed on first paint). `DeskDialog` moved to `desk-dialog.tsx` so the
   desk's shared `ui.tsx` no longer pulls `EditorDialog`.
3. **`fill`** moved to `content/fill.ts` (re-exported from `content/lab-workspace-v2.ts`), so the desk no longer
   loads the lab copy.

| Route (gzip, first load)     | main  | branch |
| ---------------------------- | ----- | ------ |
| `/reception`                 | 341.6 | 263.4  |
| `/reception/book`            | 361.0 | 333.0  |
| `/hospital-admin`            | 290.5 | 262.1  |
| `/admin`                     | 304.5 | 277.1  |
| `/nurse`                     | 398.3 | 369.0  |
| `/doctor`                    | 417.3 | 363.2  |
| `/styleguide/reception-desk` | 303.5 | 255.9  |

The rest of `/reception` is the shared root (229.7) and the desk itself (33.7: `desk.tsx`, its copy, the model,
the CSS module). 160 KB needs the root cut: deferring the Sentry SDK and trimming what the root layout imports.
That changes when errors start being captured, so it is the owner's call and its own task.

**Browser run** (Chromium, `next start`, `/styleguide/reception-desk` with `MEDSYNC_FIXTURES=1`, main and branch
built the same way; medians of 5, two rounds each where shown):

| Measure                                              | main          | branch        |
| ---------------------------------------------------- | ------------- | ------------- |
| Hydrated (desk answers), 4× CPU, 1.6 Mb/s 150 ms RTT | 3,928 / 3,887 | 3,704 / 3,711 |
| Hydrated, 4× CPU, no network limit                   | 1,022 / 1,131 | 1,279 / 1,084 |
| FCP, 4× CPU, 1.6 Mb/s                                | 2,212         | 2,208         |
| INP over 11 interactions, CPU 1× (two rounds)        | 160 / 200     | 136 / 224     |
| INP, CPU 4× (two rounds)                             | 256 / 272     | 232 / 296     |
| Slowest step: typing in Code check-in, 4×            | 256 / 272     | 232 / 296     |
| CLS                                                  | 0             | 0.0027–0.0038 |
| Horizontal scroll at 390                             | 0             | 0             |

On a slow network the desk is ready about 200 ms sooner; unthrottled and for INP the two are within run-to-run
noise (INP swings ±40 ms between rounds). FCP is held by the 213 KB fixture HTML, not the scripts. INP at 4× CPU
is over the 200 ms budget on both, from typing in the Code check-in dialog: a follow-up, not caused here. The
small CLS happens during load, not on any interaction: text widths change by 4–15 px with nothing moving
vertically (the font swap now lands after an earlier first paint). It is under the 0.05 budget. The pre-alert
card's later LCP entry comes from its 400 ms fade-in (`pIn`); it is the same element on both builds, never
remounted (checked with a MutationObserver).

**axe serious/critical, the same on main** (left for a design pass, not changed here):

- critical `aria-required-children`: the Arrivals table (`role=table`) holds a tablist, a group and a button.
- serious `aria-dialog-name`: the Code check-in dialog's `aria-label` is empty.
- serious `color-contrast` (22): day-strip dates in the calendar, #a3a9ba on #f6f7f9 (2.19:1).

**Not measured (needs a signed-in browser on a real database):** the desk under `/reception` with its layout
(sidebar, ⌘K), 300 rows (the fixture has about 20; no rows were invented), server action p95, taps for a
walk-in on a phone.
