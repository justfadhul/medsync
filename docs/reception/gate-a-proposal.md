# Reception desk — GATE A proposal (STOP 1)

Source: `PROMPT-RECEPTION-DESK.md` and the Reception Desk canvas. Findings: `step-0-discovery.md`.
Copy: `content/reception/desk.ts`, status `draft` (`RECEPTION_DESK_COPY_STATUS`, never edited by Claude).

## 1. Route map

Flag `receptionDesk` (`lib/reception/feature.ts`, `RECEPTION_DESK=1` or hospital ids). Off: today's pages, unchanged.
On: `/reception` serves the desk; views are a query param, so one client island keeps state across views.

| New                                       | Replaces (308 at Step 8)                                              |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `/reception` (Arrivals)                   | `/reception/expected`, `/reception/find`, `/reception/flow`           |
| `/reception?view=day\|week\|month`        | `/reception/bookings` (move, cancel from the calendar and side panel) |
| `/reception?open=book`                    | `/reception/book`                                                     |
| `/reception?open=walk`                    | `/reception/intake`                                                   |
| `/reception` pre-alert card + pinned rows | `/reception/incoming` (nurse keeps `IncomingBoard`)                   |
| `/reception/lab-payments`                 | kept as is (outside this slice)                                       |

No personal data in any URL (RD6): the query carries a view or a dialog name only.

## 2. Components (`components/reception/`, CSS module `desk.module.css`, every colour a Tide token)

| Component                                                                                  | Reuses                                                                 |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `desk.tsx` shell: sidebar (full, rail, drawer), top bar, banner, toasts, shortcuts         | `TideScope`, next-themes, lucide                                       |
| `arrivals.tsx` table, tabs, filters, sort, privacy, grouped rows, "N new" hold             | —                                                                      |
| `side-panel.tsx` booking details, identity Step 1/2, routing, move/cancel/no-show          | check-in, reconcile actions                                            |
| `code-dialog.tsx` 3+3 entry, scanner, found / not found, just checked in                   | `normalizeClaimCode` pattern                                           |
| `pre-alert.tsx` card + pinned group                                                        | `fetchIncomingPreArrivals`, realtime channel of `incoming-board.tsx`   |
| `book-dialog.tsx` five sections, live ticket, read-back, done                              | `ha-book-on-behalf`, `register-patient-dialog` engine, `Ticket`        |
| `walk-in-dialog.tsx` safety, returning / duplicate phone, clinics, route lock, slip        | `ha-register-patient`, `ha-register-intake`, `ha-check-in-patient`     |
| `calendar.tsx` Day / Week / Month, popover                                                 | `lib/scheduling/calendar.ts`, `clinic_sessions`                        |
| `small-dialogs.tsx` close the day, running late, move, cancel, keys, user (PIN), emergency | `cancel-appointment`, `reschedule-appointment`, `ha-set-session-delay` |
| `slip.tsx` + print stylesheet (80 / 58 mm)                                                 | browser print                                                          |
| `Ticket` (shared, `mode="example"\|"real"`)                                                | landing's `ExampleTicket`, merged before Step 5                        |

All dialogs are centred `EditorDialog`s (ADR 0161): focus trapped and returned. Pure logic lives in `lib/reception/desk/` (age rules, code input, identity flow, tone cascade, month aggregation, shortcuts) with Vitest.

## 3. Engine gaps (Step 2, migrations from 0294)

| Gap                   | Change                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking code alphabet | new codes from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (drop L); lookup strips spaces and dashes; old codes still found                                         |
| Check-in idempotency  | `patient_intakes.client_id` (unique per hospital) + `device_label`; replay returns the first result                                                       |
| Identity attempts     | table `desk_identity_attempts` (method yob / phone3 / photo, result, attempt no, who, when); no answer stored; audit row each                             |
| `identity_to_confirm` | flag on the walk-in / new-caller record; cleared by the first matching identity check                                                                     |
| Pre-alert guard       | trigger: `arrived_at` needs `acknowledged_at`                                                                                                             |
| Close the day         | table `desk_day_closures`; marks chosen sessions' Expected as `no_show` (reason `close_the_day`); undo the same day                                       |
| Running late          | `ha-set-session-delay` accepts the reception cadre (lateness only; cancelling a day stays with the clinic lead)                                           |
| Payment status        | read only, from existing lab / pharmacy / appointment fields; the desk has no write path to `paid`                                                        |
| Desk session PIN      | `desk_devices` (label, Mine clinics, set by the admin) + `desk_pins` (bcrypt hash, tries, locked)                                                         |
| Audit                 | `sa_audit_log_action_check` re-issued keeping every action of 0292 (`register_patient`, `issue_claim_code`, `claim_desk_record`) plus the desk's new ones |

## 4. Decisions (Section 11) — signed in chat by Fadhul (CSO), 13 Nov 2026, via the main chat

| #       | Decision taken                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| D-RD-01 | Category shown; their own words only on the side panel; Privacy hides both                                           |
| D-RD-02 | Photo only if the patient uploaded it with consent for identity at reception; none for walk-ins; initials otherwise  |
| D-RD-03 | Live distance only with separate, declinable consent; "about N km"; ends at check-in; kept ≤ 24 h                    |
| D-RD-04 | Year of birth, fallback last 3 phone digits; photo is a hint only                                                    |
| D-RD-05 | 7 signs as in `DESK.dangerSigns`, same list in booking and walk-in; wording stays draft until CSO signs the copy     |
| D-RD-06 | Ratings off at launch (no stars rendered)                                                                            |
| D-RD-07 | Staff-only waits on the desk, labelled; never on slips, tickets or SMS                                               |
| D-RD-08 | Walk-ins past capacity allowed, after bookings, labelled                                                             |
| D-RD-09 | The desk never takes or marks money                                                                                  |
| D-RD-10 | 6 chars, Section 5 alphabet, read 3 + 3                                                                              |
| D-RD-11 | Clinic lead cancels a day; the desk marks Running late                                                               |
| D-RD-12 | No-shows from Close the day; no penalty                                                                              |
| D-RD-13 | 4-digit PIN, hashed, per device, lock after 10 min, 5 tries then full sign-in with MFA; security review before pilot |
| D-RD-14 | Offline: check-ins only, encrypted local queue; booking and walk-in need a connection; print today's list works      |
| D-RD-15 | Under-18s blocked; paper registration                                                                                |
| D-RD-16 | SMS in English only                                                                                                  |
| D-RD-17 | UG, KE, TZ, RW, SS, CD; default UG                                                                                   |
| D-RD-18 | Doctor names and photos only with consent; initials otherwise                                                        |
| D-RD-19 | Pre-alerts cannot be dismissed; acknowledgement and arrival audited; behind the pre-alert flag                       |
| D-RD-20 | Mine set per device by the hospital admin; default all clinics of the desk's department                              |
| D-RD-21 | Glossary as given                                                                                                    |
| D-RD-22 | Browser print, 80 mm default, 58 mm option                                                                           |

New decisions taken by recommendation (same signature):

| #       | Decision                                                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D-RD-23 | Views live at `/reception?view=…`, not separate routes (one island, no state loss)                                                 |
| D-RD-24 | No Playwright (no new dependency); end-to-end flows are Vitest on pure engines + PGlite + in-app browser screenshots               |
| D-RD-25 | Old booking codes containing L stay valid; only new codes drop L                                                                   |
| D-RD-26 | Arrivals refreshes by the existing realtime channel for pre-alerts and 10 s polling for the rest; new rows are held behind "N new" |
| D-RD-27 | Fixture page `/styleguide/reception-desk` renders the desk on the invented Busy morning day (Appendix A) for screenshots and axe   |

## 5. Test plan

| Gate    | Check                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1–S3   | PGlite: cross-tenant probes per new table; reception sees no clinical columns; replayed check-in = one intake; identity attempt rows carry no answer                                      |
| S4–S6   | Vitest (jsdom) on the shell: Emergency named at every width; shortcuts ignored in inputs; Esc closes top layer; clinic filter drives rows and calendar                                    |
| S7–S11  | Engines: code input (alphabet, paste, scanner), identity flow (yob → phone3 → stop), pre-alert ack before hide, privacy hides reason/photo/distance; 500-row render timing in the browser |
| S12–S14 | Age rules table; danger sign blocks Book and logs; one booking, one code, one dispatch; duplicate warned                                                                                  |
| S15–S18 | Safety gate; duplicate phone; route lock; slip has no position or hour (guard)                                                                                                            |
| S19–S21 | Month totals equal engine on a fixture month; Needs attention exact; move/cancel one dispatch each, Undo                                                                                  |
| S22     | Offline queue: 3 check-ins survive reload, sync once, no duplicates (idempotent client id)                                                                                                |
| Guards  | Appendix C as `tests/reception/guards.test.ts`                                                                                                                                            |

## 6. ADR drafts (0485–0490; 0477–0481 are taken by the landing branch)

- **0485** Reception desk replaces the receptionist workspace (one `/reception` island behind `receptionDesk`; 308s).
- **0486** Identity before check-in (second identifier, audited attempts, stop and offer walk-in).
- **0487** Staff-only waits under ADR 0084 (desk may show waits; slips, tickets, SMS never).
- **0488** Offline check-in queue (encrypted IndexedDB, client id idempotency, check-ins only).
- **0489** Shared-desk PIN sessions (per device, hashed, 10 min lock, 5 tries).
- **0490** One `Ticket` for example and real tickets (`mode` prop).
