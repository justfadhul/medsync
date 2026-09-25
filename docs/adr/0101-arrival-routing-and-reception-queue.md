# ADR 0101 — The desk sends an arrival to triage or the clinic; a queue by when people booked; the doctor ends the visit

**Status:** Accepted — product-owner and CSO decision (2026-09-23, the owner's words: "if a patient booked … via
coming to hospital today, when they arrive at the hospital the receptionist can assign them to triage or the
respective clinic … the receptionist should also have a queue basing on when someone booked, how they booked", and "a
doctor can end a session with a patient"). Built the same day on `feat/booking-app`.
**Needs, in order:** migration `0067_intake_route.sql` (owner-applied, after 0066), then the five Edge Functions below
(owner-deployed), then the web.

**Supersedes in part:** [ADR 0098](0098-symptom-catalog-and-emergency-pathway.md) ruling 1 ("hospital triage
re-assesses every arrival") and [ADR 0031](0031-patient-entry-points-intake.md)'s single order intake → triage →
encounter → queue — for a non-emergency arrival the desk sends to the clinic. Settles ADR 0084's open item "triage
placement relative to check-in". **Builds on** [ADR 0032](0032-reception-non-clinical-boundary.md) (reception is
non-clinical), [ADR 0084](0084-book-or-queue-two-doors-relabelled.md) §7b (presence orders the physical line),
[ADR 0087](0087-clinic-days.md), [ADR 0023](0023-appointment-lifecycle.md).

## Context

Check-in sent every arrival to triage and to the booked department's queue at once; the desk had no choice. A patient
who declared "Coming to the hospital today" was checked in as a walk-in without a booking, so the doctor's Call failed
(`ha-start-encounter` 404) and the visit could never start. Nothing called `ha-complete-encounter`, so no visit ever
ended: patients stayed "Now seeing" until midnight, bookings stayed "In progress", reception never saw "Seen". The desk
saw bookings by start time and declared tickets in a separate list, with nothing saying how anyone had booked.

## Decision

1. **(owner/CSO) The desk routes at check-in.** For a declared ticket, a booking, or a patient who tapped "I have
   arrived", reception chooses **Send to triage** (the default) or **Send to clinic**, and may pick another department
   at the same hospital. The choice is administrative — which door — never an acuity: reception still sees no
   clinical data (ADR 0032). Safeguards: an emergency entry type is always triaged (`effectiveRoute`); triage stays the
   default; the route is stored on the intake (`patient_intakes.routed_to`, migration 0067) and in the
   `check_in_patient` audit row. Triage route: intake `awaiting_triage` plus the clinic queue row (as before). Clinic
   route: intake `arrived`, `routed_to = 'clinic'`, the clinic queue row — and the triage worklist leaves it out.
   Rows written before 0067 (`routed_to` NULL) mean triage.
2. **(owner) The desk's queue is ordered by when people booked.** "Expected today" merges the day's bookings and
   declared tickets, oldest booking first (a clinic-day position is the same order), each with a **How booked** label
   (Phone app, Web, USSD, At the desk, By a clinician, Urgent (system), Same day (patient), Walk-in, Pre-alert) and the
   booked-at time. Patients who marked themselves arrived and have not been sent on are listed on their own, first.
   How someone booked is a label, never a sort key: the app must not outrank a walk-in (PRD equity rule). Once in the
   building, the line is unchanged — acuity, then presence (ADR 0084 §7b).
3. **(owner) The doctor ends the visit.** "End visit" on the queue rail's "Now seeing" row and on the encounter page
   calls `ha-complete-encounter`, now scoped to that encounter — its queue row and its department, the intake linked to
   its booking — instead of everything the patient had at the hospital that day. The booking completes, the patient
   leaves the queue, reception shows Seen. `ha-start-encounter` starts a queue row with no booking (walk-ins and
   same-day patients), with the calling doctor as clinician.
4. **What the feature needed on the way.** Desk-registered walk-ins with a department join that clinic's queue;
   registration refuses a second live ticket for the same patient that day; a triage-opened encounter carries the
   booking, so ending it completes the booking, and reuses an open encounter instead of starting a second.

## Consequences

- A clinic-routed patient is never triaged unless a clinician sends them back — the owner's ruling, recorded here with
  its safeguards. The PRD's red-flag-escape and time-to-triage telemetry (Gate H) is still unbuilt; it is the measure
  that would show whether the clinic door is hiding anyone.
- Not built: interleaving clinic-day bookings with walk-ins on the doctor's rail (ADR 0087's 2:1), a per-doctor queue
  (`queue_entries` has no clinician column), "left without being seen", closing a no-show's queue row, and the
  count+1 queue number race (marked `ponytail:` in `_shared/queue.ts`).

## Owner actions, in order

1. `npm run db:migrate` — applies `0067_intake_route.sql` (after 0066).
2. `npx supabase functions deploy ha-check-in-patient ha-complete-encounter ha-start-encounter ha-register-intake ha-pre-arrival-arrived --use-api`
   (the last two share `_shared/intake.ts`).
3. The web deploy.
