# ADR 0541: The EU stay: Observe in EU keeps the visit open

**Status:** Accepted, 24 Nov 2026 (owner/CSO, D2, D8). Migration 0311 is GATED. All wording is a draft for the CSO. Behind
`EU_OBSERVATION` (needs `WARD_BUILDER` and `ENCOUNTER_CLOSE_V2`). Only the app's pages, `ha-eu-stay` and the hub's assign guard are flag-gated. `move_eu_space`, the EU release refusal, `ha-complete-encounter`'s stay lookup and refusals and the `encounters` close trigger run whatever the flag; with it off they change nothing only because no stay can exist.

Builds on [ADR 0539](0539-an-emergency-unit-is-a-ward-type.md) and [0540](0540-eu-space-types-chair-and-resus.md), and the
admission-with-a-bed work ([ADRs 0198 to 0203](0199-bed-assignment-for-admissions.md)).

## Decision

1. **Observe in EU keeps the visit open (D8).** Sending a patient to an emergency unit (EU) does not close the visit. The
   doctor stays responsible and the visit stays `in_progress`; the stay ends when the visit is closed with an outcome (D2:
   the 24 h limit only flags, it never ends a stay).
2. **`eu_stays`** (one row per stay, from the decision to the end). Status `awaiting_space`, `in_space` or `ended`; one open
   stay per patient (partial unique index `eu_stays_one_open_per_patient`). A doctor's stay names its encounter; a triage
   nurse's names the intake and the encounter is stamped later (`eu_stays_who_check`). A waiting stay records a reason
   (`no_free_bed`, `extra_bed`, `floor`, `other`); `other` needs the encrypted note. `end_kind` allows `admitted`, `home`,
   `referred_out`, `transferred`, `theatre`, `died`, `left_before_completion`, `left_against_advice`.
3. **The guard (`eu_stays_guard`).** A stay is never deleted (only a cascade from the hospital or patient row, by trigger
   depth); it starts open, not arrived, with no admission; only status, wait fields, ward, arrival, responsible clinician,
   end and the stamped encounter and admission move; encounter, arrival and admission are stamped once; an ended stay never
   changes; the only status moves are awaiting_space and in_space either way, and either to ended. `updated_at`, the row audit
   and the PHI-free `ward-beds:<hospital>` broadcast follow; a stay that moves to another EU also tells the board it left.
4. **RLS.** Enabled and forced; clients only read (superadmin, the hospital's admin, active clinical staff of the hospital, as
   admissions), behind the `mfa_gate`. Every write is a SQL function run on the service role.
5. **`bed_assignments.eu_stay_id`.** An assignment serves an admission or a stay, never both
   (`bed_assignments_one_purpose_check`); only an assignment with an admission or a stay may be arrived. The assignment guard
   lets an insert for a stay come already arrived (a move inside the EU), and refuses an EU space whose stay is not that
   patient's, at that hospital.
6. **Four SQL functions (service role only).**
   - `observe_in_eu`: send to an EU ward with a space or a wait reason; the visit stays open and an event is written. It
     refuses a visit not in progress, a ward that is not an active EU of the hospital, a patient with an open admission or in
     an EU already. **Adoption (R56):** an open stay a triage nurse started at the same hospital is adopted, not duplicated:
     it gets the encounter, and the adopting doctor becomes the responsible clinician. If the doctor picks the same space or
     waits on the same EU, the doctor's own wait reason and note replace the nurse's while the stay is waiting; a different
     space or ward moves the stay as `move_eu_space` does.
   - `confirm_bed_arrival` (0091's function, widened): Arrived on an EU space stamps the space and the stay and returns; no
     encounter opens and no nursing ends.
   - `move_eu_space`: another space of the same EU, another EU of the hospital, or out of a space to wait. The stay's clock
     (`decided_at`) never moves. The new space starts Occupied only when the patient was waiting (`awaiting_space`) or had already arrived; an in-space patient who has not yet arrived (Arriving) stays Arriving in the new space. `observe_in_eu` does the same when adoption moves a stay.
   - `end_eu_stay`: ends the space, the stay, the visit and writes the event in one transaction (see Decision 8).
7. **One lock order (R57).** In every EU function: encounter, then stay, then assignment (then the bed, inside
   `admission_free_bed`), so two of them never deadlock. A deadlock (40P01) or serialization failure (40001) that still
   happens reads "Someone changed this patient just now. Try again."
8. **Which encounter ends a stay.** `end_eu_stay` takes no `hospital_id`: the caller checks the encounter's hospital is its own. Whoever `ha-complete-encounter` lets close clinically ends the stay (the encounter's clinician, a superadmin, or a scoped hospital admin). It ends the one open stay of the patient at the encounter's hospital when the
   stay names this encounter, or has no encounter yet (a triage stay: the close stamps it), or its admission's inpatient
   encounter is this one. Another visit's stay is left alone and the function returns `ended: false`. It refuses `admitted`
   (an admission ends the stay on arrival, Phase 3) and a visit not in progress.
   `ha-complete-encounter` looks the stay up first (encounter id equal to the visit's, or none), calls `end_eu_stay` for a clinical close,
   audits `end_eu_stay`, then runs its usual cascade; with no stay found it closes as before. A missing table
   (42P01 or PGRST205, before 0311) is treated as no stay.
9. **A visit with an open stay closes only through `end_eu_stay` (R59).** A `BEFORE UPDATE OF state` trigger on `encounters`
   refuses completing a visit while an open stay names it and has no admission, in words. This closes the race where a close
   looks for a stay before a send commits one. `end_eu_stay` ends the stay first in the same transaction, so it passes.
   `ha-complete-encounter` also refuses, in words, an administrative close and an admission while a stay is open
   (the admission arrives with boarding in Phase 3).
10. **`ha-eu-stay`, op `send_to_eu`.** Only the encounter's own clinician, with an active or approved clinical affiliation at
    the encounter's hospital, may send (R58: a clinical decision, no admin or superadmin arm). It refuses when the function
    secret `EU_OBSERVATION` is not set for the hospital, audits `send_to_eu` (reason of at least 8 characters), and calls
    `observe_in_eu` with the caller as actor and the checked encounter, never the body's. Only the words after `EU4xx` / `AD4xx`
    reach the caller; any other database error is logged by code and returned as a plain server error.
11. **Ward staff.** `ha-services-hub` gains `move_eu_space` (a ward worker of the stay's ward, and of the target ward on a
    cross-EU call), audited. Release is refused for an EU space: "Use Move to change the space; the stay ends when the
    visit closes." Assigning a bed on an emergency-observation ward is refused when the flag is on for the hospital, in both
    the app and the hub (R60), because patients enter the EU from their visit. The two read different flags: the app's
    `euObservationLiveFor` needs `EU_OBSERVATION`, `WARD_BUILDER` and `ENCOUNTER_CLOSE_V2`; the hub and functions read only
    the `EU_OBSERVATION` secret (`_shared/eu.ts`). A ward worker confirms Arrived.
    The board shows an EU space Arriving until Arrived (`isArriving`, the one rule for board, counts and close), then
    Occupied. Its Move dialog offers this unit's free spaces or a wait reason; the note is capped at 500 characters and
    encrypted before it leaves the app.
12. **The app.** The Plan lists the hospital's EUs for "Observe in EU" and the close dialog starts Send to EU from the Plan's
    unit: choose a space or why the patient waits, then Send. The dialog shows "In <ward> since <time>" or "Waiting for a
    space in <ward>" while a stay is open and says closing ends it. The stay's four clocks (`lib/eu/clock.ts`) and the
    hospital's limit (`eu_stay_limit_hours`, default 24; the 72 h cap is the capability catalogue's, the read side clamps only the lower bound at 1; `lib/eu/limit.ts`) exist as pure code; nothing displays or flags
    them yet.
13. **`theatre` is reserved.** The stay allows `end_kind = 'theatre'`, but the close has no theatre outcome yet, so nothing
    writes it.
14. **Phase 2 refuses admit-from-EU.** Admitting a patient who is in the EU is refused in `ha-complete-encounter` ("comes with
    boarding, which is not switched on yet") and `observe_in_eu` refuses a patient with an open admission. Boarding, the ward's
    Arrived ending the stay, and the inpatient record opening at the decision are Phase 3 (migration 0312).

## Rulings made while building

- **R10/R11.** `PlanPayload.euWards` is optional; the observe_eu disposition keeps its ward id, as the admit review rule does,
  with a test.
- **R56.** Adoption makes the doctor responsible and keeps the doctor's own wait reason (Decision 6).
- **R57.** One lock order, encounter then stay then assignment (Decision 7).
- **R58.** Only the encounter's own clinician sends (Decision 10).
- **R59.** A visit with an open stay closes only through `end_eu_stay`, enforced by a database trigger (Decision 9).
- **R60.** The assign guard is server-side too, the wait note is capped before it is encrypted, and a missing table (42P01 or
  PGRST205) is handled gracefully on the move path.
- **R14.** 0311 uses the "GATED" header of 0296 onward.

## Consequences

- **Deploy order:** apply migration 0311 (`cd <worktree> && npm run db:migrate`, in the folder that holds it), then deploy
  `ha-eu-stay`, `ha-complete-encounter` and `ha-services-hub`, then set `EU_OBSERVATION` in the app and the same value as a
  function secret, the secret only for hospitals where the app's flag chain (`WARD_BUILDER`, `ENCOUNTER_CLOSE_V2`) is fully on; otherwise the hub refuses plain assigns into EU wards that the app still offers. A function secret that differs from the app flag makes sends refuse or the board and the functions
  disagree.
- Migration 0311 widens the `sa_audit_log` action list with `send_to_eu`, `move_eu_space` and `end_eu_stay`, and adds
  `bed_assignments.eu_stay_id` and the `encounters` close guard; it is additive and re-runnable.
- A stay with a space and no arrival shows Arriving on the board; only the ward's Arrived makes it Occupied. A triage nurse's
  op that starts a stay is Task 25 (the table and adoption are ready for it).
- Open for the owner or CSO, not decided here:
  - **All wording** (EU_SEND, EU_BOARD, the refusals), including the two event labels: `end_eu_stay` writes
    "Visit completed: deceased, left <ward>" and `ha-complete-encounter` writes "Visit completed: died".
  - **The 24 h limit**, its upper cap of 72 h, and what flagging looks like (nothing is shown yet).
  - **Cross-EU moves from the board:** the server allows a move to another EU; the board offers only this unit's spaces.
  - **A triage stay blocks the administrative closure** of a duplicate encounter of the same patient (the stay has no
    encounter yet).
  - **A theatre outcome** at the close.
