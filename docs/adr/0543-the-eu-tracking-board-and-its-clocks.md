# ADR 0543: The EU tracking board, its clocks and who sees names

**Status:** Accepted, 24 Nov 2026 (owner/CSO, D9, D10). Migration 0313 is GATED (its first section is this ADR's). All
wording is a draft for the CSO. Behind `EU_OBSERVATION` (needs `WARD_BUILDER` and `ENCOUNTER_CLOSE_V2`).

Builds on [ADR 0541](0541-the-eu-stay-observe-stays-open.md) (the stay and its clocks' inputs) and
[ADR 0542](0542-boarding-in-the-eu.md) (boarding). [ADR 0544](0544-who-may-start-an-eu-stay.md) covers who may start a stay and
the links to the resus desk.

## Decision

1. **Four clocks, no 4-hour target (D9).** `euClocks` (`lib/eu/clock.ts`) gives time in hospital, in the EU, in the space and
   boarding, each the elapsed time between two recorded instants (so the same in Africa/Kampala, UTC and across any DST
   change). Clocks are text (`durationWords`), never colour. There is no 4-hour target; the only limit is the hospital's
   `eu_stay_limit_hours` (24 by default, read by `euStayLimitHours`; missing, not a whole number or below 1 gives 24),
   and it only flags (D2).
2. **Over the limit is a `Tag` plus a line, never a colour.** `euTracking` (`lib/eu/board.ts`) marks a stay over the limit
   when it is strictly past it (`overLimit`: exactly the limit is still within it) and adds it to "Needs attention".
3. **Needs attention.** Five codes: `over_limit`, `arriving_long` (Arriving for over 1 h), `obs_overdue` (the next
   observation, from the Plan's frequency, is past; continuous has no due time), `boarding_long` (waiting for a ward bed
   over 12 h) and `waiting_space`. Rows sort waiting-for-a-space first, then by when the stay was decided.
4. **Level words are the hospital's own (draft).** `levelWords` (`lib/eu/level-words.ts`) uses the hospital's
   `triage_system` capability: `sats` and `etat` words, otherwise MedSync's own form `L<n> · <word>`. Level 5 is never
   "Blue" on the EU board (SATS Blue means dead): level 4 and 5 both read "Green" in SATS and in MedSync's own words.
5. **Who sees names (D10).** The EU list shows names and MRNs only to EU staff: whoever works the ward's beds
   (`mayWorkBeds`, which includes the ward's nurses, its in-charge and the hospital admin) and the EU doctor on duty
   (`mayReadEuNames`, `lib/eu/cover.ts`). Others get no name and no MRN, and nothing is logged. The list is read on the
   nurse beds page, the hospital-admin ward board page and the doctor's `app/doctor/eu` page. The ward board's plan view keeps
   its older rule (MRN only for the admin).
6. **Every reveal is logged.** `auditEuNames` (`lib/eu/load.ts`) writes one `clinical_phi_access_log` row per shown patient
   per viewer per Kampala day, surface `eu_board`.

## Rulings made while building

- **R63: the rota seam.** `euDoctorOnDuty` (`lib/eu/cover.ts`) returns the holders of the EU ward's own doctor posts
  (junior, senior, consultant) from `whoCovers` when `DUTY_ROTA` is on for the hospital (`dutyRotaLiveFor`), and nobody
  when it is off, with no query. The rota read fails soft (`soft`): a failure gives nobody and never breaks the board.
  There is no fallback to the department, its heads or the hospital contacts. In words the rota is "planned", never
  "present": the doctor's page says the list shows "to the EU doctor on duty, from the duty rota". This supersedes R12
  (empty seam) now that the rota exists on this branch.
- **R64: the `eu_staff` basis.** A name shown to EU staff who hold no chart basis for the patient (the ward's nurses, the
  in-charge, the rota doctor, the hospital admin) must not be logged as "assigned", which means a nursing assignment.
  Migration 0313 section 1 redefines `phi_access_basis_check` with 0101's list verbatim plus `eu_staff` (the Drizzle check
  in `db/schema/doctor-workspace.ts` mirrors it). `euNameBasis` logs the viewer's real chart basis if there is one, else
  `eu_staff`. **Fail closed:** until 0313 is applied the log insert fails, `auditEuNames` logs the error and returns no
  patients, so names stay hidden (MRNs still show for those allowed).

## Consequences

- **Deploy order:** (1) apply 0313 (`cd <worktree> && npm run db:migrate`, in the folder that holds it); (2) deploy
  `ha-eu-stay`, `ha-complete-encounter` and `ha-services-hub`; (3) set the function secret `EU_OBSERVATION` to match the app
  flag; (4) then turn the app flag on. The app's Drizzle `select()` on `resus_bay_profiles` and `hospital_care_units`
  reads the new 0313 columns, so 0313 must come before the app deploy ([ADR 0544](0544-who-may-start-an-eu-stay.md)).
- **Reversal:** restore 0101's `phi_access_basis_check` after removing any `eu_staff` rows.
- The board shows boarding and the clocks for the admin, nurse and doctor lists alike; only names differ.
- Open for the owner or CSO, not decided here:
  - **Level 5 shows "Green" on the EU board while `levelTxt` (`components/clinic-floor/shared.ts`, used by the floor) says
    "L5 · Blue".** Two words for one level across the app until the CSO decides.
  - **All wording is a draft** (`content/eu/words.ts`, headed "DRAFT wording for the CSO"): the status words, the Needs
    attention lines, the level words and the 24 h default.
  - **Observations overdue** also fires for a stay still waiting for a space (kept on purpose: a waiting patient still
    needs observations).
  - **A read failure of `eu_stays` breaks the whole board** (it throws `eu_stays read failed`); only the names and the rota
    fail soft.
  - **The boarding clock** starts at the admission's creation time ([ADR 0542](0542-boarding-in-the-eu.md)).
