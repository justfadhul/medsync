# Reception desk — STOP reports

GATE A: signed in chat by Fadhul (CSO), 13 Nov 2026, via the main chat. Copy stays `draft`.

## STOP 0 — discovery

| Item      | Result                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base      | `feat/reception-desk` + review-perimeter, booking-dry-run, reception-cancel-move, desk-record-takeover, doctor-booking-confirm (CHANGELOG conflicts only, resolved by union) |
| Findings  | `docs/reception/step-0-discovery.md`                                                                                                                                         |
| Numbering | migrations from 0294 (0293 reserved for landing), ADRs 0485–0490                                                                                                             |

## STOP 1 — GATE A

| Item         | Result                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposal     | `docs/reception/gate-a-proposal.md` (route map, renames, data, permissions, deviations)                                                                                          |
| ADRs         | 0485 desk replaces workspace · 0486 identity before check-in · 0487 staff-only waits · 0488 offline queue · 0489 shared-desk PIN · 0490 one Ticket                               |
| Copy         | `content/reception/desk.ts`, `draft`                                                                                                                                             |
| Safest picks | other days' calendar cards show counts only; no doctor ratings, no MoMo, English only; close-day "next day / later" chips dropped; running-late uses the engine's 30-minute rule |

## STOP 2 — engine

| Item              | Result                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration         | `0294_reception_desk.sql` (GATED, unapplied)                                                                                                             |
| Edge Function     | `ha-reception-desk` (identity check, close day + undo, PIN unlock, running late)                                                                         |
| Changed functions | `ha-check-in-patient` (desk check-in needs a matched identity attempt ≤ 30 min), `ha-set-session-delay`, `ha-pre-arrival-arrived`, `ha-register-patient` |
| Server actions    | `app/reception/_desk/actions.ts`                                                                                                                         |
| Flag              | `lib/reception/feature.ts` (`RECEPTION_DESK`)                                                                                                            |
| Tests             | PGlite `tests/emr-db/reception-desk.test.ts` 7/7 · `desk-engine` 8/8 · `session-booking` 9/9                                                             |
| Owner             | `cd /Users/airm1/Desktop/medsync/.claude/worktrees/reception-desk-15bb79 && npm run db:migrate`, then redeploy the five functions above                  |

## STOP 3 — the desk UI on fixtures

| Item       | Result                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Components | `components/reception/` — desk, calendar, dialogs, forms, ui, port, CSS module                  |
| Rules      | `lib/reception/desk/model.ts` (pure); fixtures `lib/reception/desk/fixture.ts` (invented names) |
| Write seam | `DeskPort`; `fixturePort` now, live port at Step 6                                              |
| Preview    | `/styleguide/reception-desk` (404 unless `MEDSYNC_FIXTURES=1`)                                  |
| Pop-ups    | all centred `EditorDialog`s (ADR 0161)                                                          |
| Tests      | `desk-model` 9/9; typecheck and lint clean on the new files                                     |

## STOP 5 — one Ticket

| Item   | Result                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| Merge  | `feat/landing-tether` (70b6a7fb), CHANGELOG union only                                                     |
| Ticket | `components/landing/tether/ticket.tsx`: `Ticket` with `mode` (`example`, `real`) and a `visit` prop        |
| Users  | landing hero and Ways to book (`mode="example"`); the desk's booked view (`mode="real"`, from the booking) |
| Tests  | landing 52 pass; typecheck and lint clean                                                                  |

## STOP 6 — live data and writes (flag off)

| Item   | Result                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Loader | `lib/reception/desk/load.ts` (same audited reads as the old pages), mapping in `map.ts` (pure, tested)                                     |
| Port   | `components/reception/live-port.ts`: every desk write → an existing server action → its Edge Function                                      |
| Page   | `/reception` renders `DeskLive` only when `receptionDeskLiveFor(hospital)`; off, unchanged                                                 |
| Tests  | `desk-map` 3/3, `desk-model` 9/9                                                                                                           |
| Safest | no fee model → fee 0; unknown sex/age stay unknown; walk-in with no record → unknown-patient label; booking reason → `other` + their words |
| Limits | one session per clinic per day; desk users = the signed-in user; book search = today's board                                               |
