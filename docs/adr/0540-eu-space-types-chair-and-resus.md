# ADR 0540: The emergency unit has chair and resus spaces, four warning checks and a template

**Status:** Accepted, 24 Nov 2026 (owner/CSO, D1, D3, D5). Migration 0310 is GATED. Wording and sizes are a draft, proposed
and not signed standards. Behind `EU_OBSERVATION` for what is offered; the checks are not flag-gated (see Decision 4).

Builds on [ADR 0539](0539-an-emergency-unit-is-a-ward-type.md) and the ward builder's layout, checks and presets
([ADRs 0191 to 0196](0191-ward-layout-document-and-versioning.md)).

## Decision

1. **Two new space types (D5).** `BED_TYPES` in `ward-layout.ts` gains `chair` (2 by 2 cells) and `resus` (3 by 4 cells), each
   cell 0.5 m. Migration 0310 widens `hospital_beds_bed_type_check` to `standard, icu, cot, couch, chair, resus`, `NOT VALID`
   as 0090 did, so a value written before stays valid. Drizzle mirrors it. The sizes are proposed.
2. **Only an EU offers them.** `bedTypesFor(wardType, keep)` filters the palette and the bed's type chips: chair and resus
   appear only for an EU ward; the editor passes the ward type only when the flag is live, so with the flag off they are
   hidden everywhere, and a bed already of such a type still shows its own. The Emergency unit
   template is offered only under the same condition.
3. **The server refuses them elsewhere (R54).** `layoutChecks` adds a BLOCKING issue `eu_spaces` when a ward that is not an EU
   holds a chair or resus space, and `publishWardLayout` already refuses on a blocking issue. The palette filter alone would
   not stop a hand-made layout.
4. **Four EU checks, warnings only (the [ADR 0196](0196-layout-checks-are-proposed-warnings.md) pattern, never blocking).** They run for any ward of type
   `emergency_observation`, whatever the flag, because `ha-services-hub` recomputes checks at publish and cannot read flags.
   - `resus_services`: every in-service resus space records oxygen, suction and a monitor.
   - `resus_trolley_reach`: every in-service resus space has a resus trolley within `RESUS_TROLLEY_REACH_CELLS` = 10 cells
     (5 m), measured between centres. Proposed, not a signed standard. The two resus checks appear only when the plan has a
     resus space. The older `resus_trolley` check (a trolley exists on the plan) is unchanged.
   - `eu_isolation`: the plan has a room of kind isolation.
   - `children_apart`: only when the ward's age group is "all" and it has in-service cots; each cot must be inside a room or
     bay. `layoutChecks` takes the age group as a third argument; `publishWardLayout` and the editor pass it. A chair or couch
     is not tested, only a cot.
5. **The Emergency unit template** (`emergencyUnit` in `lib/wards/presets.ts`), first in the list when the EU condition holds:
   a Resus bay with two resus spaces (R1, R2) recording `EU_RESUS_SERVICES` (oxygen, suction, air, monitor, call, power,
   pump, IV pole; no pressure mattress) and a resus trolley between; a Trolleys bay with four couches (two when the floor is
   narrower than 30 cells); four chairs (two when narrow) in the open floor; an Isolation room with one couch and a sink; a
   nurses' station, a sink and a door. Only the resus spaces record services. It is a start for the admin to change, not a
   standard.

## Rulings made while building

- **R19.** The palette and chip filter for chair and resus is part of this work, not a later task.
- **R54.** The server refuses chair or resus on a non-EU ward (Decision 3), and Drizzle mirrors the CHECK.
- **R14.** 0310 uses the "GATED" header of 0296 onward.

## Consequences

- A published EU layout writes `hospital_beds` rows of type chair or resus. Nothing reads those types yet in the app beyond the
  board's generic bed drawing; the stay and arrival work is Phase 2.
- **Deploy order:** apply migration 0310 (`cd <worktree> && npm run db:migrate`), deploy `ha-services-hub`, then set
  `EU_OBSERVATION`. The function would otherwise publish a layout the database then refuses.
- The EU checks are warnings, never blockers: an EU without an isolation room or a trolley within 5 m publishes once the
  admin acknowledges the current warnings (the existing ADR 0196 rule).
- Open for the owner or CSO, not decided here:
  - **The sizes** of chair and resus, the **10-cell (5 m) reach**, and whether the three required resus services are the right
    list.
  - **Whether any EU check should block** (today none does).
  - **All check wording**, and the template's make-up and numbers.
  - **Whether `children_apart` should also cover chairs and couches.**
