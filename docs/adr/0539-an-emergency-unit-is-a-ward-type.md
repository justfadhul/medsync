# ADR 0539: An emergency unit is a ward type, attached to an ordinary ward for display, and it does not admit

**Status:** Accepted, 24 Nov 2026 (owner/CSO, D1, D3, D5). Migration 0310 is GATED. Wording is a draft
(`content/eu/words.ts`, and `WARD_ATTACH_WORDS` in `ward-layout.ts`). Behind `EU_OBSERVATION` (see Decision 4).

Builds on [ADR 0191](0191-ward-layout-document-and-versioning.md) and the ward builder's ward types. Spec:
`docs/superpowers/specs/2026-11-24-eu-layout.md`. The spaces, checks and template of the same phase are in
[ADR 0540](0540-eu-space-types-chair-and-resus.md).

## Decision

1. **An emergency unit (EU) is a ward whose type is `emergency_observation` (D1).** No new table: it is laid out in the ward
   builder, has beds, and is read by the same board code as any ward. `EU_WARD_TYPE` is exported from
   `supabase/functions/_shared/ward-layout.ts`.
2. **An EU may be attached to an ordinary ward, for display only (D3).** `hospital_wards.parent_ward_id` (migration 0310) is a
   nullable self-reference, `ON DELETE SET NULL`. It decides nothing about beds, admissions or access. Only an EU has one, and
   never itself: `hospital_wards_parent_check` (mirrored in `db/schema/hospital-wards.ts`). The ward form shows an
   "Attached to (for display)" choice when the flag is live and the type is Emergency observation; the choices are live,
   non-EU wards of the hospital, and the function clears the value when the type moves away from EU.
3. **One rule decides it, twice.** `decideWardAttach` (pure, in `ward-layout.ts`, which has no imports) is what `upsert_ward`
   in `ha-services-hub` calls, with the facts it read (the parent row for this hospital only, the stored type, the count of
   unarchived EUs attached to the ward, the count of open bed assignments in it). It refuses, with words:
   - a parent on a ward that is not an EU (400);
   - a parent that is missing, in another hospital, archived, the ward itself or itself an EU (400);
   - changing a ward to or from an EU while patients are in its beds (409, "Move the patients out before changing whether this
     ward is an emergency unit.");
   - turning a ward into an EU while unarchived EUs are attached to it (409, "Detach its emergency units before making it one.").
     When it passes, it says what to write: the parent for an EU, `null` for any other type (so a ward that stops being an EU
     loses its parent), and, when the form sends no parent, the stored value is left alone.
4. **The database backs the rule for the race (R55).** `hospital_wards_parent_guard` (BEFORE INSERT OR UPDATE, re-runnable in 0310) raises `check_violation` with HINT `ward_parent_not_ordinary` or `ward_has_units` for the same cases, and locks the
   parent `FOR SHARE` (or the ward's own row `FOR UPDATE` when it becomes an EU), so two concurrent saves cannot leave an EU
   under an EU. `ops-structure.ts` turns the two hints into the app's own words (409); a raw database message does not reach
   the admin. 0310 had not shipped on this branch, so the guard is in 0310 itself.
5. **An EU leaves Admit, whatever the flag (D5, R71).** `admittingWards` (`lib/emr/read/close.ts`) drops wards of type
   `emergency_observation` through `admitsHere(wardType)`, so the close dialog's Admit step does not offer one. It
   applies the rule before it counts beds, so the board is not queried for EUs.
6. **Which things the flag gates.** `euObservationLiveFor(hospitalId)` (`lib/wards/feature.ts`): `EU_OBSERVATION` is `1` or a
   comma list of hospital ids, off by default, and only where `WARD_BUILDER` and `ENCOUNTER_CLOSE_V2` are both live. The flag
   gates what an admin and a clinician see: the "Attached to" choice, the Emergency unit template and the chair and resus
   entries in the editor. **Not gated by the flag** (they run for any EU ward, or any ward,
   because `ha-services-hub` cannot read app flags): the EU layout checks (ADR 0540), the blocking refusal of chair or resus
   spaces on a non-EU ward, the attach and type-change rules above, with the guard, and the removal of EUs from Admit.

## Rulings made while building

- **R14.** Migration 0310 opens with the "GATED" header of 0296 onward.
- **R20.** A ward that has EUs attached cannot itself become an EU (Decision 3, `ward_has_units`).
- **R55.** Because 0310 is unshipped, the guard is in 0310. The app keeps its own words and the database's refusal is the
  backstop. The row the function writes always has `parent_ward_id` null for a non-EU type.

## Consequences

- With the flag off the admin and the doctor see what they saw before. The one difference that is on at once, because the
  server cannot read the flag: a ward cannot change to or from Emergency observation while patients are in its beds, and a
  hand-made layout with chair or resus spaces on a non-EU ward cannot be published.
- **Deploy order:** apply migration 0310 (`cd <worktree> && npm run db:migrate`, run in the folder that holds it), deploy
  `ha-services-hub`, then set `EU_OBSERVATION`. The function names the new column, so deploying it first fails on a database
  without 0310.
- The server refuses an admission _into_ an EU whatever the flag (0312 and 0313, `AD409`), and the close dialog never offers
  one (R71). Applying 0312 ends admissions into any existing ward of type Emergency observation.
- Archiving a ward does not clear the EUs attached to it: the ward form then shows "Not attached" for the stale id and a save
  is refused until the admin picks another or none. (Deferred.)
- Open for the owner or CSO, not decided here:
  - **All wording** in `content/eu/words.ts` and `WARD_ATTACH_WORDS`.
  - **Whether the attachment should ever mean more than display** (shared staffing, board grouping). Today it does not.
  - **Whether archiving a parent should detach its EUs.**
