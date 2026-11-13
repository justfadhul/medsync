# Reception desk — Step 0 discovery (STOP 0)

Branch `feat/reception-desk` from `origin/main` plus review-perimeter, booking-dry-run, reception-cancel-move,
desk-record-takeover and doctor-booking-confirm (CHANGELOG conflicts only). Canvas: claude.ai/artifact/94ZBrBRgpvmvFiXfDNtB6Y.

## Q1 Routes, actions and outside users

| Route                     | Does                                                | Engine calls                                                                             |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/reception`              | Today counts, incoming, coming days (read only)     | —                                                                                        |
| `/reception/incoming`     | pre-alert board                                     | `ha-update-pre-arrival`, `ha-pre-arrival-arrived`                                        |
| `/reception/expected`     | expected list, day strip, queue, reconcile, no-show | `ha-check-in-patient`, `ha-cancel-intake`, `ha-mark-no-show`, `ha-reconcile-identity`    |
| `/reception/intake`       | register walk-in / referral / emergency             | `ha-register-intake`, `ha-check-in-patient`, `pt-submit-symptoms`, `ha-register-patient` |
| `/reception/book`         | book for a caller                                   | `ha-book-on-behalf`                                                                      |
| `/reception/bookings`     | find, move, cancel                                  | `cancel-appointment`, `reschedule-appointment`                                           |
| `/reception/find`         | by name / patient code                              | reads                                                                                    |
| `/reception/flow`         | status board                                        | reads                                                                                    |
| `/reception/lab-payments` | lab payment record (flag `labPayment`)              | `recordPaymentAction`                                                                    |

Outside users: `app/nurse/incoming` imports `IncomingBoard`; `components/intake/*` import types from `app/reception/actions`;
`tests/reception/arrivals-queue.test.ts`; shared components front-door-form, incoming-panel, coming-days, pick-steps.
These stay where they are; Step 8 deletes only reception-private files.

## Q2 Section 5 capabilities

| Capability                   | Status      | Where                                                                                                                                                       | Gap                                                                               |
| ---------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Booking code                 | partial     | `_shared/slots.ts:858` (32-char alphabet incl. **L**), unique `(hospital_id, booking_code)` 0058:403; lookup `lib/reception/bookings.ts:79` upper-case only | drop L for new codes; strip spaces/dashes on lookup                               |
| Check-in                     | partial     | `ha-check-in-patient` (appointment → `arrived`, `patient_intakes` row)                                                                                      | no client id idempotency, no device                                               |
| Identity check               | **missing** | —                                                                                                                                                           | attempts table + audit                                                            |
| Walk-in registration         | yes         | `ha-register-patient`, 0291 (`desk_patient_candidates` duplicate check), 0292 claim code                                                                    | `identity_to_confirm` flag missing                                                |
| Pre-alert                    | yes         | `emergency_pre_arrivals` 0066:149 (acknowledged_by/at, arrived_at)                                                                                          | guard: arrived requires acknowledged                                              |
| Close the day                | **missing** | per booking only: `ha-mark-no-show`                                                                                                                         | bulk, reversible same day                                                         |
| Running late / move / cancel | yes         | `clinic_sessions.delay_minutes` + `ha-set-session-delay` (admin only); `cancel-appointment`, `reschedule-appointment` (SMS via dispatches)                  | reception may set lateness                                                        |
| SMS outbox                   | yes         | `notification_dispatches` 0061:57, Africa's Talking sender                                                                                                  | —                                                                                 |
| Payment status               | partial     | lab `lab_payment_events`, pharmacy `pharmacy_payment_statuses`; no appointment fee model, no Mobile Money                                                   | read model only; desk never writes `paid` (D-RD-09)                               |
| Desk session PIN             | **missing** | —                                                                                                                                                           | per-device PIN table                                                              |
| Audit                        | yes         | `sa_audit_log` + `recordSaAudit`; last CHECK re-issue 0292:260                                                                                              | new actions must keep `register_patient`, `issue_claim_code`, `claim_desk_record` |

## Q3 Tide kit and Ticket

`components/tide/` has kit, shell, controls, dialog-impl, cascade, visits-ticket, book-danger. Reception already sits
inside `TideScope group="reception"`. The shared `Ticket` is being built in `feat/landing-tether` (worktree
landing-tether-09c47a): `components/landing/tether/ticket.tsx` exists there **uncommitted**. Plan: merge that branch
before Step 5 and give `Ticket` a `mode` prop; if it is still uncommitted then, ask the main chat.

## Q4 Realtime or polling

Realtime once: `incoming-board.tsx:106` on `emergency_pre_arrivals`. Elsewhere `AutoRefresh` (30 s `router.refresh`).
The desk keeps both: realtime for pre-alerts, polling for Arrivals.

## Q5 Parity

Static inventory (by route and engine call, above) is the parity baseline; every row maps to a desk control in the
GATE A route map. The live role-and-name crawl needs a signed-in reception user on a dev server: it runs at Step 8
against the flag-off pages (unchanged until then) and fills `tests/parity/reception/renames.json`.

## Q6 Baselines

Deferred to Step 8 and measured against the same flag-off pages, so the before/after is like-for-like: screens at
1440/834/390, axe, first-load JS for `/reception` (from `next build`), INP with 300 rows.

## Q7 Tooling

| Tool       | State                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright | **not installed**; adding it is a new dev dependency → not added. E2E checks run as Vitest on pure engines + PGlite lane + in-app browser screenshots |
| axe        | `axe-core` ^4.13 (tests/a11y/static-pages.test.ts)                                                                                                    |
| Fake clock | `vi.useFakeTimers` / `setSystemTime` in 7 test files                                                                                                  |
| Harness    | `app/styleguide/*` exists; a `/styleguide/reception-desk` fixture page will host the desk on invented data                                            |

## Disagreements (repo wins)

1. Booking codes contain **L** today; the prompt's alphabet does not. New codes drop L; old codes keep working (lookup unchanged).
2. Check-in has no arrival-event table; the desk adds client-id idempotency on `patient_intakes`, not a new event stream.
3. Lateness is admin-only today; D-RD-11 lets the desk mark Running late → widen the role check, cancel-whole-day stays with the clinic lead.
4. Canvas photos and ratings: photos only with consent (D-RD-02), ratings off (D-RD-06); initials shown instead.
5. Playwright absent (see Q7).
