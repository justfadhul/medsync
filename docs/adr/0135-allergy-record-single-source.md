# ADR 0135 — The allergy record as the single source

**Status:** Accepted — 2026-09-26. GATE A D-EMR-04, harmonised **[H, safety-positive]**. The cross-hospital read (STOP 1) awaits owner/CSO confirmation (O-8).

## Context

R1 was worse than the spec stated. Resus allergies (AMPLE, in `resus_timeline_events`) were invisible even to the patient's next resus episode. `patient_allergies` had no live writer. The resus emergency administration checked allergies only on the client, and the prescribing engine matched free text by name.

## Decision

1. **Two new tables:** `allergies` (versioned, insert-only) and `allergy_status_assertions`. The resolver (`lib/emr/allergy.ts`, pure) always answers one of four states: listed, no known drug allergies (an assertion by a named person at a time), unable to assess, not recorded. **An active, non-refuted allergy always outranks an assertion**; "not recorded" is never shown as NKDA. A property test holds this over 200 seeds.
2. **0071 copies both old stores once, with provenance, and changes neither** (insert-only, keyed on `legacy_ref`, re-runnable):
   - `patient_allergies` rows → `allergies`, informant `record`;
   - the latest resus AMPLE capture per episode → `allergies`, informant `resus_ample_migration`;
   - a resus "NKDA" capture → an assertion, only when a named person recorded it.
     Every copied item arrives `unconfirmed`. Copied rows hold no text (D2): the text is read from the untouched source through one resolver, `resolveAllergyTexts`, which serves both the prescribe path and the fact loader. Under RLS it goes through `private.allergy_source_text` (0073), which returns only that string and only with a basis.
3. **Every prescribe path reads the record** (`lib/emr/read/allergies.ts` → the existing `runSafetyChecks`). The resus AMPLE editor writes through `recordAllergy` with its look unchanged. **The server re-runs the allergy check on emergency administration.**
4. **[H, safety-positive] Name matching retained.** Uncoded allergen text is still passed to the existing name matcher; dropping it would weaken today's check. The label reads "Matched by name only — code it for class checks". Coded substances use the prescribing formulary's own keys and classes, so there is one vocabulary.
5. **[H, safety-positive] Allergies cross hospitals (STOP 1, O-8).** The SELECT policies on `allergies` and `allergy_status_assertions` do not require hospital equality: a clinician with a legitimate basis for the patient **at their own hospital** sees — and the prescribing check uses — the patient's allergies from every hospital, each labelled with where it was recorded. Everything else stays hospital-scoped. This keeps today's behaviour (the legacy read had no hospital filter).

## Consequences

- Scenario A2 green: an OPD-coded amiodarone allergy is refused by the resus server re-check, and an allergy written through AMPLE shows in the safety bar, named (the naming was fixed at gate STOP 4).
- 230 allergy tests; the backfill copied 4 + 2 rows and 1 NKDA in the fixture world, and a re-run adds 0.
- **Open for the CSO:** if the record cannot be read at emergency administration, the dose is still recorded after the amber warning and stamped `allergyRecord='unavailable'` (`app/nurse/resus/actions.ts`). Confirm, or require an override reason.
- **Open for the owner and CSO:** the cross-hospital read (O-8), with the DPA/MoU in view.
- **Not built:** version 2 with ciphertext for every backfilled allergy (O-5, extended), which must land before any legacy table retires; and `scripts/emr/backfill-allergies.ts` for AMPLE captures written while `EMR_V1` was off. Both scripts are still to be written.

## Alternatives considered

- **Keep allergies in resus AMPLE and `patient_allergies`** — the status quo is the R1 defect.
- **Stop name-matching uncoded text (the spec's wording)** — it removes a check prescribing does today.
- **Hospital-scoped allergies like every other row** — a patient's anaphylaxis recorded at one hospital would be invisible to the next.
