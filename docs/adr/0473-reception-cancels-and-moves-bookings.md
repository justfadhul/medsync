# ADR 0473 — Reception cancels and moves bookings at its own hospital

**Status:** Proposed — 2026-11-12. Built for the booking pilot (clinic set-up gap 2). The SMS wording is CSO-provisional
until the owner signs it.

## Context

Writing the pilot's reception training showed the desk cannot cancel or move a booking: there was no screen, and
`cancel-appointment` and `reschedule-appointment` refused a reception caller. Only the patient (app) or the clinician
(`/doctor/schedule`) could cancel. Nobody could move a numbered clinic-day booking: `reschedule-appointment` refused it
("a different input and a different function"), so the only way was cancel and book again.

Two more things turned up on the way:

- A staff cancel told the patient nothing. `cancel-appointment` queues no message; the app only shows "Cancelled by
  the clinic." when the patient next opens it. A new caller booked at the desk has no app.
- The dispatcher reaped every message whose appointment was no longer live (rule C in `planDispatch`). The
  `session_cancelled` and `unconfirmed_release` messages point at the cancelled appointment by design, so they were
  reaped `related_cancelled` and never sent.

## Decision

1. **No second path.** Reception uses the two existing Edge Functions. Both now also allow a caller who is reception
   at the booking's own hospital: a RECEPTION-cadre affiliation there, approved, at a live hospital
   (`isReceptionAt` → the pure `receptionAt` in `_shared/booking-change.ts`). Reception elsewhere, or any other staff
   role at the hospital, is refused (unless they are the booking's own clinician or a hospital admin, as before).
   `getCaller` already refuses a caller without MFA (0288).
2. **A move goes through the booking core.** `reschedule-appointment` takes a new input `to`: another clinic day of
   the same line (`to.session_id`), or another time in the same department (`to.slot`). `moveRefusal` keeps it in
   the same clinic; then `bookAppointment` books the new visit like any other: capacity and a fresh number from
   `allocate_session_position`, opening hours via `checkSlot`, the line's reasons, a receipt to the patient. Its new
   `movedFrom` links the new row back (`rescheduled_from_appointment_id`) and copies the old quote (ADR 0092). Only
   then is the old row flipped to `rescheduled`, once (status guard), giving its clinic-day place back
   (`release_session_position`: booked_count only, numbers are never re-issued) and its slot to the waitlist. The
   patient app's existing move (`new_starts_at`, same clinician) is unchanged.
3. **History stays append-only.** Nothing is deleted or overwritten: a cancel flips the status with a closed code
   (ADR 0094), a move adds a new row and flips the old one. Each writes a `sa_audit_log` row with the clerk's reason;
   the reason never goes on the appointment.
4. **The patient is told.** When anyone but the patient cancels, `cancel-appointment` queues one `visit_cancelled`
   message, push and SMS (SMS alone for a new caller), through the ordinary dispatcher. Migration 0290 lets the kind
   into `notification_dispatches`. A move needs nothing new: the core's receipt carries the new day and code.
5. **Rule C spares the endings.** `planDispatch` no longer reaps `session_cancelled`, `unconfirmed_release` or
   `visit_cancelled` for their appointment being cancelled. Every other kind is reaped as before.
6. **The screen.** `/reception/bookings` ("Bookings" in the sidebar) finds bookings at this hospital from today on by
   booking code (exact) or patient code (prefix). Codes only: no name is revealed. Cancel and Move open centred
   `EditorDialog`s; Move reuses the Book page's day and time pickers.

## Consequences

- A clinician's or hospital admin's cancel now also texts the patient. That is intended: the clinic cancelled.
- A clinic-day booking moved to another day gets a new code and the next free number on that day; the old number is
  not re-used. Reception reads the new code out; the receipt texts it.
- A move is limited to the same clinic. Moving to another clinic is cancel and book again.
- The audit row for a move is written after the core books (so a refused move leaves no row saying it happened). If
  that write fails the move stands; the new row's link back still records it.
- Ceiling: if the function dies between booking the new visit and flipping the old one, both stay live, and a retry
  answers with the new booking without flipping the old one. The desk sees both on the Bookings page and cancels one.
- Deploy order: migration 0290 first, then `cancel-appointment` and `reschedule-appointment`.

## Alternatives considered

- **A new reception-only Edge Function.** Rejected: a second cancel path to keep in step with the first.
- **Folding the patient app's move into the core too.** Better in the end (hours checked on the server for patients),
  but it changes a live patient flow (status, rate limit, horizon). Left for its own change.
- **No message on a staff cancel**, leaving the app to show it. Rejected: a new caller has no app, and the PRD says
  nobody is dropped silently.
