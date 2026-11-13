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

| Measure (budget)                         | Baseline (old pages)    | Result (desk)                                                          | How measured                                        |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| First-load JS `/reception` (≤ 160 KB gz) | not measured separately | 345 KB: shared root 229 + reception layout 65 + page 51                | `next build` client chunks, gzip; **over budget**   |
| INP, Arrivals, 300 rows (≤ 200 ms)       | not measured            | not measured                                                           | needs a signed-in browser run                       |
| CLS (≤ 0.05)                             | not measured            | not measured                                                           | same                                                |
| Code found → identity (≤ 1 s p95)        | —                       | local, no round trip (code entry is client-side over today's rows)     | code reading                                        |
| Server action p95 (≤ 300 ms)             | not measured            | not measured                                                           | needs the migration applied                         |
| axe serious/critical (0)                 | not measured            | not measured                                                           | needs a browser run; no Playwright                  |
| Horizontal scroll at 390 (0)             | not measured            | not measured                                                           | needs a browser run                                 |
| Guards, Appendix C (0 failures)          | —                       | 0 (5 static guards + shortcuts)                                        | `tests/reception/desk-guards.test.ts`, `desk-model` |
| Key presses, code check-in               | —                       | 4 commands (C, Enter, Enter, To triage) + 6 code and 4 year characters | static count                                        |
| Taps for a walk-in                       | —                       | not measured                                                           | needs a browser run                                 |
| Parity items lost (0)                    | —                       | 0 (unsigned)                                                           | `tests/reception/desk-parity.test.ts`               |
| Old reception components remaining (0)   | —                       | all (cut-over not done, by design)                                     | Step 8 stop                                         |
| Strings outside `content/reception/` (0) | —                       | 0 visible labels; audit reasons stay in the port                       | grep sweep, `DESK.ui`                               |

First-load JS: the shared root (framework, root layout) is 229 KB on its own, already over the 160 KB budget and
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
