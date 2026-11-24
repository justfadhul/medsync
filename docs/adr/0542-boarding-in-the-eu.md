# ADR 0542: Boarding in the EU: admit from the EU, arrival ends the stay

**Status:** Accepted, 24 Nov 2026 (owner/CSO, D6). Migration 0312 is GATED. All wording is a draft for the CSO. Behind
`EU_OBSERVATION` (needs `WARD_BUILDER` and `ENCOUNTER_CLOSE_V2`), as [ADR 0541](0541-the-eu-stay-observe-stays-open.md).

Builds on [ADR 0541](0541-the-eu-stay-observe-stays-open.md) and the admission work
([ADRs 0198 to 0203](0199-bed-assignment-for-admissions.md)). It supersedes [ADR 0200](0200-admission-is-atomic-and-its-cascade.md)
decision 5 ("Arrival opens the inpatient encounter") **in part, for boarders only**.

## Context

A patient the doctor admits while they are in an emergency unit (EU) usually waits there for a ward bed: they are
"boarding". ADR 0200 opens the inpatient encounter only when the ward confirms Arrived, and the admission closes the
source visit. A boarder would then have no open encounter for observations and drugs given on the EU trolley. Phase 2
refused admit-from-EU in words to avoid this. The database also allowed one open bed row per patient, so a boarder could
not hold their EU space and a ward bed.

## Decision

1. **D6: the inpatient record opens at the decision to admit, for a boarder.** `admit_from_encounter` inserts the
   `inpatient` encounter (`in_progress`, department of the ward) when the patient has an open stay at the hospital, and the
   admission is inserted with `inpatient_encounter_id` already set. Everyone else's inpatient record still opens on arrival;
   `confirm_bed_arrival` reuses a record that already exists instead of opening a second (one per admission). The source
   visit still completes as `admitted` in the same transaction.
2. **`admissions_guard` allows that insert only for a boarder.** An admission may be inserted with an inpatient record only
   while the patient has an open stay at the hospital; the record is stamped once and never changes.
3. **The stay boards for the admission.** In the same transaction `admit_from_encounter` stamps `eu_stays.admission_id`
   (and the encounter, if a triage stay had none) before the ward bed and before the close, so the close guard of ADR 0541
   (a visit with an open stay and no admission closes only through `end_eu_stay`) lets the source visit complete. The stay
   stays open; the EU space stays held.
4. **Admit-from-EU rules.** Admitting is refused for an EU ward ("An emergency unit is not a ward to admit to"), and, for a
   patient with a stay, only from the stay's own visit (a triage stay with no encounter may be admitted from any visit).
   If a ward bed is chosen while the EU space is still Arriving the admission is refused ("Mark the patient as arrived in
   the EU first"); a patient on the waiting list for a ward bed is accepted at any time, and `allocate_admission_bed`
   applies the same refusal when a bed is given later. The patient's EU space is not "already in a bed" for these checks;
   any other open bed row still is.
5. **One Occupied plus one Arriving place per patient (index split).** 0090's `bed_assignments_one_open_per_patient`
   is replaced by two partial unique indexes on `patient_user_id`: `bed_assignments_one_occupied_per_patient` (open and
   arrived, or open with neither admission nor stay: a direct assignment) and `bed_assignments_one_arriving_per_patient`
   (open, not arrived, for an admission or a stay). A boarder holds an Occupied EU space and an Arriving ward bed. Both
   new indexes are created first and the old one dropped after, so uniqueness never lapses; every live row already
   satisfies both (the old index allowed one open row per patient). Proof is on the PGlite lane
   (`tests/emr-db/eu-boarding-index.test.ts`) over live-shaped rows. The Drizzle schema mirrors both indexes.
6. **The race the split opens (R61).** Each index sees only its own kind of row, so two inserts could each pass one.
   `bed_assignments_guard` takes, on INSERT only, `pg_advisory_xact_lock(hashtext(patient_user_id))` and refuses a second open row
   unless the two are the boarding pair, which needs the stay's `admission_id` already set (admit stamps it first): an Occupied (arrived) space of the patient's open stay, and an Arriving ward bed
   for the admission that stay boards for (either order). Direct assignments, and any other pairing, are refused
   ("A patient holds one open bed, or their EU space and the ward bed they board for").
7. **Arrival on the ward ends the stay in the same transaction.** `confirm_bed_arrival` takes the stay's encounter, then the
   stay, then the assignment (the lock order of ADR 0541). For a boarder it ends the EU space ("Arrived on <ward>") and the
   stay (`end_kind = admitted`, `admission_id` stamped in that same update) **before** it stamps the ward row's arrival,
   so the Occupied index never sees two. It then marks the admission arrived with the existing inpatient record, and ends
   nursing assignments of other wards as before. Only an open stay is ended.
8. **A move inside the EU while boarding.** `move_eu_space` no longer reads the boarder's Arriving ward bed as "already in
   a bed". The new space starts Occupied when the stay is waiting or arrived, as in ADR 0541, so the pair holds. The hub's
   direct bed assignment reads the first open row instead of expecting exactly one, because a boarder has two.
9. **A boarder who leaves the EU before the ward (R62).** Recording a death or a discharge must never need a ward step
   first. `end_eu_stay` (redefined from 0311's body) also cancels the stay's open admission (`awaiting_bed` or
   `bed_allocated`, reason "Left the EU before reaching the ward") and ends its not-yet-arrived ward row ("Left the EU"),
   in the same transaction, locking visit, stay, admission, row in that order. No bed stays held and the ward cannot arrive
   them later. `confirm_bed_arrival` ignores an ended stay when it looks up the boarder's stay (defence). Draft wording for the CSO.
10. **Which visit ends a boarder's stay.** The source visit completes at the admission, so a boarder who leaves the EU is
    closed on the **inpatient** visit. `end_eu_stay` now also finds the stay whose admission's inpatient encounter is the
    visit being closed, and the `encounters` close guard (one arm in 0311, two now) gains a second arm: a boarder's
    inpatient record, while their stay is open, completes only through `end_eu_stay`. In `ha-complete-encounter` the
    first stay lookup (the visit's own, or a triage stay) runs as before; only when it finds nothing does the function
    look up the admission whose inpatient encounter is this visit and then that admission's stay. A failure of the
    admissions query is logged and the close goes on without the boarder arm (the SQL guard still protects); a failure of
    the follow-up `eu_stays` lookup returns a server error. For an **admission** close from the EU the function does not call `end_eu_stay`: the
    stay stays open. The Phase 2 refusal of admit-from-EU is removed.
11. **The app.** `openStay` keys on the stay's `encounter_id`, the source visit, which `admit_from_encounter` completes in
    the same transaction. The close context is loaded for any visit the desk opens (`lib/emr/read/desk.ts`), whatever its
    state, so the close dialog shows "Admitted · <ward> · waiting <duration>" (`EU_SEND.boarding`; `OpenStayView.boarding`
    and `admit`) only where a close dialog is opened for that source visit after the admission. The wait counts from the
    admission's creation time (`admissions.created_at`, there is no decision timestamp) with the shared `durationWords`.
    Otherwise boarding is visible on the EU board (Phase 4). The board's Arriving rule
    (`isArriving`) is unchanged.

## Rulings made while building

- **R61.** The per-patient lock and the boarding-pair rule in the assignment guard (Decision 6), plus the ordering of the
  end-then-stamp in `confirm_bed_arrival` (Decision 7). A boarder whose EU space is still Arriving cannot hold an Arriving
  ward bed (Decision 4).
- **R62.** A boarder who leaves the EU has the admission cancelled and its Arriving ward row ended (Decision 9).
- **Review outcomes, Tasks 17 to 19:** the hub's bed-assign pre-check handles two open rows; the hub operation count in
  `tests/hospital-services/invariants.test.ts` is 43 (it includes `move_eu_space`); `ha-complete-encounter` keeps the stay
  open on an admission so the admission is not refused after commit; `waited` uses the shared `durationWords`; the boarder
  lookup runs only when the first stay lookup finds nothing, and only its admissions query is non-fatal.

## Consequences

- **Deploy order:** apply migration 0312 **after 0311** (`cd <worktree> && npm run db:migrate`, in the folder that holds
  it), then deploy `ha-complete-encounter` and `ha-services-hub`, then the app. Deploying `ha-complete-encounter` before
  0312 would let an admission from the EU through without the database changes: apply the migration first. The index
  section creates unique indexes on `bed_assignments` without `CONCURRENTLY`, so inserts and updates on that table wait
  for the brief duration of the build (small table; the migration runs as one transaction). Do not apply it in the middle
  of a busy bed-allocation window.
- **Reversal:** with at most one open assignment per patient, recreate 0090's index and drop the two new ones; recreate the
  section 2 functions from 0311 (guard, `confirm_bed_arrival`, `move_eu_space`, close guard, `end_eu_stay`) and 0091
  (`admissions_guard`, `admit_from_encounter`, `allocate_admission_bed`). A reverse after boarders exist leaves their rows
  unresolved.
- The inpatient record of a boarder exists from the decision, so nurses and doctors can chart on it while the patient is
  still in the EU.
- Open for the owner or CSO, not decided here:
  - **Re-admission of a boarder after the ward admission falls through** (for example "ward full after all"). The admission
    is ended or cancelled, the stay stamps its admission once and the source visit is completed, so the patient cannot be
    admitted again from the EU. Today the only way out is ending the stay from the EU. Should re-admission from the EU be
    supported (a new admission on the same stay), and who may do it?
  - **The new refusal and cancel wording:** "An emergency unit is not a ward to admit to", "Mark the patient as arrived in
    the EU first", "This patient is in the emergency unit on another visit. Admit them from that visit", the cancel reason
    "Left the EU before reaching the ward", the space reason "Left the EU", and "Admitted · <ward> · waiting <duration>".
  - **The boarding wait clock** starts at the admission's creation, not a separate decision time; confirm that is the clock
    the CSO wants.
  - **The close dialog of the inpatient visit** does not show the stay: it reads the stay named by the visit being closed,
    which is the source visit. Decide whether the inpatient visit's close should say the patient is still in the EU.
  - **Where a boarder's waiting status should show for the admitting doctor**, given the source visit is completed at the
    admission.
  - **A boarder's cancelled admission on a death or discharge** is recorded on the admission and the assignment only; no
    separate event is written to the source visit.
