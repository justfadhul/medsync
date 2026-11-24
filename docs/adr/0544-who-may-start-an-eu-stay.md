# ADR 0544: Who may start an EU stay, and where the resus desk's bays and care units link

**Status:** Accepted, 24 Nov 2026 (owner/CSO, D4, D7, D8). Migration 0313 is GATED. All wording is a draft for the CSO.
Behind `EU_OBSERVATION` (needs `WARD_BUILDER` and `ENCOUNTER_CLOSE_V2`). The SQL guards run whatever the flag; `ha-eu-stay`
refuses when the function secret `EU_OBSERVATION` is not set for the hospital.

Builds on [ADR 0541](0541-the-eu-stay-observe-stays-open.md) (the stay and the close),
[ADR 0542](0542-boarding-in-the-eu.md) (boarding) and [ADR 0543](0543-the-eu-tracking-board-and-its-clocks.md) (the board).

## Decision

1. **The doctor sends at the close (D8).** `send_to_eu` (op of `ha-eu-stay`, SQL `observe_in_eu`) starts or adopts a stay
   from a visit in progress. The visit stays open. Closing it with an outcome ends the stay (`end_eu_stay`); an admission closes the visit but leaves the
   stay open as a boarder ([ADR 0542](0542-boarding-in-the-eu.md)), ended when the ward confirms arrival
   (`confirm_bed_arrival`) or by `end_eu_stay` if the patient leaves first (R62). A visit on
   the clinic floor then ends there as "Observed in EU": `clinic_floor_events_detail_check` gains `eu` (0313 section 2) and
   `ha-eu-stay` writes that finish, because the floor's own Finish dialog never offers it (`_shared/eu-floor.ts`; a visit
   the floor already finished keeps its outcome).
2. **The triage nurse sends a Level 1 or 2 patient to EU resus spaces only (D4).** `send_to_eu_resus` (op of `ha-eu-stay`,
   SQL function of 0313 section 3) takes the intake's latest triage and refuses any level above 2 ("Only a Level 1 or 2
   patient goes straight to EU resus."). The space must be a live resus space of an active, open emergency unit of the
   hospital. The stay is the nurse's: no encounter, the intake named, the space Arriving. Triage-capable means a live
   clinical affiliation whose cadre the hospital's policy allows to `triage_patient`. Audit verb `send_to_eu_resus`.
   The triage send does not finish the floor visit (R70): the patient stays in the doctor's line, and the floor visit
   ends as "Observed in EU" when the doctor's encounter of that visit adopts the stay (Send to EU, or an admission) or
   ends it with the close (`ha-complete-encounter`).
3. **A triage stay is adopted by the doctor's Send to EU.** `observe_in_eu` takes the open triage stay of that patient: the
   stay gets the encounter, `responsible_user_id` becomes the adopting doctor (R56), and a same-ward awaiting-space stay keeps
   the doctor's wait reason.
4. **Service role only.** `send_to_eu_resus` is revoked from PUBLIC, anon and authenticated and granted to `service_role`;
   `ha-eu-stay` calls it.
5. **D7: a resus bay and a care unit link to the drawn EU.** `resus_bay_profiles.bed_id` (one bay per space, unique index
   `rbp_bed_unique`) and `hospital_care_units.ward_id`, both `ON DELETE SET NULL`. Triggers `resus_bay_link_guard` and
   `care_unit_link_guard` refuse a bay linked to anything but a live resus space of an unarchived `emergency_observation`
   ward of the same hospital ("EU400 Choose a resus space of an emergency unit."), and a unit linked to anything but an
   unarchived ward of the same hospital ("EU400 Choose a ward of this hospital."). The new admin ops in `ha-services-hub`
   (`ops-wards.ts`) are `link_resus_bay` and `link_care_unit`, with audit verbs of the same names. The hub also refuses a
   space another bay already uses ("Another resus bay already uses that space.").

## Rulings made while building

- **R58: only the encounter's own clinician sends.** `send_to_eu` is a clinical decision. `ha-eu-stay` allows only
  `encounters.clinician_user_id` who still holds a live clinical affiliation at the encounter's hospital. There is no
  hospital-admin or superadmin arm. `ha-complete-encounter`'s own authorisation is unchanged.
- **R59: the close and the send cannot race.** `encounters_eu_stay_close_guard` (0311, a `BEFORE UPDATE OF state` trigger on
  `encounters`) refuses completing an encounter while an open stay names it and has no admission (EU409 "This patient is
  in the emergency unit. Close the visit with an outcome; that ends the EU stay."). 0312 added the arm for a boarder's
  inpatient record. `end_eu_stay` passes because it ends the stay first in its own transaction. `ha-complete-encounter`
  maps the refusal through `euRefusal` (no 500).
- **R65: a triage stay is ended or adopted only by its own visit.** A triage stay has no encounter, only its intake. 0312's
  `end_eu_stay` ended it for any encounter of the patient at the hospital, so an unrelated clinic visit closing could have
  released the resus space. 0313 section 4 redefines `observe_in_eu`, `end_eu_stay` and `admit_from_encounter` verbatim but
  for one rule: the stay belongs to an encounter whose `visit_id` is the stay's intake, else whose triage record's intake
  is it, else (the queue start) the intake whose `encounter_id` names that encounter. `ha-complete-encounter` looks the
  stay up with the same three tests, and a failed link lookup fails the close rather than leave a space held. Another
  visit of the patient closes normally and leaves the stay alone; `admit_from_encounter` from another visit keeps its
  existing AD409 "in the emergency unit on another visit" words. No new 500: the missing-table case (before 0311) is
  tolerated.
- **R66: a link outlives no rule it was checked against.** Beds are archived, never deleted, so `ON DELETE SET NULL`
  never runs. The guards also refuse an archived space or ward, and two `SECURITY DEFINER` triggers clear the dependent
  link in the same statement: `eu_links_clear_bed` on `hospital_beds` (archived, re-typed away from resus, or moved to
  another ward) and `eu_links_clear_ward` on `hospital_wards` (archived, or no longer an emergency unit; an archived ward
  also clears its care units). The bay's and unit's own audit triggers record the clearing.

## Consequences

- **Deploy order:** (1) apply 0313 (`cd <worktree> && npm run db:migrate`, in the folder that holds it); (2) deploy
  `ha-eu-stay`, `ha-complete-encounter` and `ha-services-hub`; (3) set the function secret `EU_OBSERVATION` to match the app
  flag; (4) then turn the app flag on. The app's Drizzle `select()` on `resus_bay_profiles` and `hospital_care_units` reads
  the new columns, so 0313 must come before the app deploy (the resus desk would fail on the missing columns otherwise).
- **Reversal:** see the 0313 header: restore 0101's basis list (no `eu_staff` rows), 0295's floor detail list (no `eu` row),
  0311's audit list and `observe_in_eu`, 0312's `end_eu_stay` and `admit_from_encounter`; drop `send_to_eu_resus`, the two
  link guards, the two clearing triggers and the two columns.
- Open for the owner or CSO, not decided here:
  - **An unidentified patient cannot take the triage-to-resus path.** The stay needs a patient, so a triage nurse is told
    "Register the patient at the desk first, or take them to resus." Does an unregistered emergency arrival need an EU path?
  - **A clinic alert still fires for EU-resus triage.** Whether it should stay quiet once the
    patient is in an EU resus space is a product question.
  - **`link_care_unit` has no screen.** The op exists in the hub but the wards actions allow-list in
    `app/hospital-admin/departments/wards/_lib/actions.ts` offers only `link_resus_bay`, which the ward panel uses.
  - **The queue-start link can be re-stamped.** Step 3 of `ha-complete-encounter` re-stamps
    `patient_intakes.encounter_id` without an `encounter_id IS NULL` guard, which could orphan the link R65 relies on for a
    queue-started encounter.
  - **The send and close wording** (draft, `content/eu/words.ts` and the SQL refusal words), and the "Visit completed" event
    labels, which differ between `end_eu_stay` and `ha-complete-encounter`.
  - **A triage stay blocks an administrative closure** of a duplicate encounter of the same visit.
  - **A link racing a publish** that archives the space can leave a stale database link for a moment; the loaders hide it.
