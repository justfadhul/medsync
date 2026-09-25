# ADR 0115 — A patient's death is read from the records that hold it, not copied to the patient

**Status:** Accepted for the build — 2026-09-24. **CSO signature pending** (D2); the flag stays unset until then.

## Context

A death is recorded on the resus episode (`death_confirmed_at`, `outcome_code` died_after_cpr / died_cpr_not_attempted,
`disposition` mortuary / deceased) and on `encounters.disposition = 'deceased'`. Nothing outside resus read it, so a
patient who died at 11:06 was still offered Triage and Start at 11:10 (W1). The prompt proposed copying it to
`patients.deceased_at` with source and author columns (D2).

## Decision

1. **No column.** `deathsFor(hospitalId, patientIds)` reads both records in the board's second phase. When a patient
   has more than one, the projection uses the latest, with its source and author.
2. **With a death on record** (FW-7), every open item of that patient is in Needs closing under a neutral
   **Died hh:mm** chip. The row's next step is Review; Triage, Take, Start and Open resus are never its primary action.
3. **Never a block (Law 2).** "Start encounter…" stays available and asks for a reason (≥ 8 characters), written to the
   audit log **before** anything opens (`startForWorkspaceAction`, `takePatientAction`). A death recorded after the
   board loaded brings up the same confirm.
4. A wrong death record is corrected in the record that holds it (the resus close-out), not from the workspace.

## Consequences

- One truth, no drift: a stored copy could disagree with the immutable resus record.
- One more read per board load. When a surface outside the workspace needs a cheap lookup, add the column then — set
  in the same transaction as the death confirmation, corrected under four-eyes.
- A death recorded anywhere other than resus or an encounter (there is none today) would not be seen.

## Alternatives considered

- **`patients.deceased_at` (the prompt's D2)** — there is no `patients` table (the patient is `patient_profiles`), and a
  copy needs a writer in every death path plus its own correction process.
