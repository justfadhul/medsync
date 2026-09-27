# Clinical Fact Contract v1.1 addendum

> **Doc** MS-DATA-CFC-001, addendum v1.1 (PROMPT-ENCOUNTER-EMR §7.9), harmonised per `HARMONISATION.md`.
> **Status** SIGNED as recommended by Fadhul (owner, CSO), 2026-09-26, in session. Items marked **[H]** change a
> signed decision's mechanism, not its intent; ADR 0130 records them.
> **Amends** `SPEC-CLINICAL-FACT-CONTRACT-v1.md`. Where this addendum and v1.0 differ, this addendum wins.
> **Data** `data/emr/clinical-fact-concepts.v1.1.json` (59 concepts, 8 conversions, all codes candidate).
> **Rule** No clinical number is added here. The only numbers are unit conversions (standard, derivable) and the
> age 18 in item 3, which is the signed D-CFC-09 text ("restrict pregnancy for minors").

## Part A — the seven items of PROMPT §7.9

### A1. New fact kind: `allergy`

`FactKind` gains `'allergy'`. Storage: `allergies` + `allergy_status_assertions` (gate-a-proposal §A.9).

```ts
export interface AllergyFact extends FactEnvelope {
  kind: "allergy";
  substance: {
    code?: string;
    kind?: "drug_ingredient" | "drug_class" | "food" | "environmental" | "other";
    text?: string;
  };
  category?: "medication" | "food" | "environment" | "biologic";
  allergyType?: "allergy" | "intolerance";
  criticality?: "low" | "high" | "unable_to_assess";
  manifestations: Array<
    "rash" | "urticaria" | "angioedema" | "anaphylaxis" | "bronchospasm" | "sjs_ten" | "other"
  >;
  severity?: "mild" | "moderate" | "severe";
  clinicalStatus: "active" | "inactive" | "resolved";
  verification: "unconfirmed" | "confirmed" | "refuted"; // entered in error lives in envelope.status
  informant: "patient" | "relative" | "record" | "clinician_observed" | "resus_ample_migration";
  matchedByNameOnly: boolean; // true when substance.code is absent
}
export type AllergyStatus =
  | { state: "listed"; allergies: AllergyFact[] }
  | { state: "no_known_drug_allergies"; assertedBy: string; assertedAt: string }
  | { state: "unable_to_assess"; assertedBy: string; assertedAt: string }
  | { state: "not_recorded" };
```

| Rule                              | Detail                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolution (`lib/emr/allergy.ts`) | Any current allergy with `clinicalStatus='active'` and `verification<>'refuted'` gives `listed`, whatever the assertions say. Otherwise the newest non-voided assertion. Otherwise `not_recorded`. Nothing is ever updated. |
| Projection                        | `projectAllergy(row)`, Zod-validated; a failing row is quarantined (C11). Backfilled rows (`legacy_ref`) read their display text from the untouched source row until O-5 inserts version 2 with ciphertext.                 |
| Envelope mapping                  | `source='clinician'`, `trust=3` for every v1 write (the informant is a separate column, renamed from the prompt's `source`, **[H]**: the table also carries the CFC `source`).                                              |
| Entered in error                  | `status='entered_in_error'` with a reason, not `verification` (**[H]**, one mechanism for every fact table). FHIR maps it to `verificationStatus=entered-in-error`.                                                         |
| Prescribing input                 | `allergyCheckInput(status)`: every active allergy's code, else its text (see B4).                                                                                                                                           |

### A2. Concept extension

`clinical-fact-concepts.v1.1.json` adds 52 concepts from MS-EMR-CLIN-001 §8 and 7 finding concepts the signed
templates need (template 2.1 [11] general examination; the standard visit 2.12). Same concept shape as v1, plus
`symptomCode` on findings. Every LOINC code is `candidate` (57 codes, 0 verified); no candidate is exported
(CI check, CFC §10 item 4). New conversions (all "standard"): bilirubin ×17.1, calcium ÷4.008, magnesium ÷2.431,
phosphate (as P) ÷3.097, uric acid ×59.48, lactate ÷9.008, albumin and total protein g/dL ×10.

### A3. Conditional sensitivity

| Rule                    | Detail                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SR-PREG-MINOR`         | Facts of kind `pregnancy` and `obs.pregnancy_test` are `restricted` when the patient is under 18 at the fact's effective time (D-CFC-09, signed). |
| Imprecise date of birth | If the uncertainty spans 18, restrict (D-CFC-12).                                                                                                 |
| When applied            | At insert, into the row's `sensitivity` column. Rows are immutable, so the value never flips later; a correction re-evaluates.                    |
| Where declared          | `sensitivityRules` in the v1.1 JSON, seeded into `clinical_concepts.sensitivity_rule`.                                                            |

### A4. Uncatalogued results

`obs.uncatalogued`, value type **`as_typed`** (new). Test name, value and unit as typed are stored encrypted in
`clinical_observations.note_ciphertext` and displayed with the label "Uncatalogued". It is never in a manifest,
never exported and never interpretable (C2). The DB CHECK allows `as_typed` only for this concept.

### A5. Write-path wording (§3.5)

Replace "Edge Functions only" with: _server-side only, through audited server actions: Zod, AAL2, scope and cadre
checks, then one owner-role Drizzle transaction (`asClinicalWriter`) that first calls
`private.patient_access_basis()` and writes one audit row._ **[H]**: the repo writes clinical rows with owner-role
Drizzle in server actions, not the service-role Supabase client. Edge Functions remain for the two visit-lifecycle
functions (`ha-start-encounter`, `ha-complete-encounter`).

### A6. The observation store is the evolved `clinical_observations` (E3, **[H]**)

| v1.0                                          | v1.1                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A new insert-only `observations` table        | `clinical_observations` gains the §3.2 columns (nullable for legacy rows)                                                                                                                                                                                    |
| Every row insert-only                         | CFC rows (`concept_id IS NOT NULL`) are immutable. Legacy rows allow only the resus `active → corrected` move (`retractMirror`, `actions-survey.ts:346`). DELETE is refused for all rows                                                                     |
| Backfill `value_canonical`, `source`, `trust` | **No backfill mutation.** Legacy rows and `triage_records.vitals_snapshot` are _projected_ into facts by the loader (§10 item 9, "or projected into")                                                                                                        |
| `recorded_at` = knowledge time                | On this table the legacy `recorded_at` keeps its bedside meaning. Knowledge time is `created_at` for every row; effective time is `coalesce(effective_at, recorded_at)`                                                                                      |
| —                                             | A CFC row is tagged `observation_kind='fact'` and `state='fact'` (its status lives in `status`). Every legacy reader filters `state='active'`, so none can show a CFC row as a blank legacy one; P4 re-points the three readers to the loader under `EMR_V1` |

Legacy projection (`lib/facts/project/legacy-observation.ts`, `triage-vitals.ts`):

| Legacy source                                        | Concept                               | Notes                                                                                                  |
| ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `bp` (v1, v2) / snapshot `systolicBp`, `diastolicBp` | `obs.bp_systolic`, `obs.bp_diastolic` | one legacy row gives two facts, ids `clinical_observations:<id>:sys` / `:dia`                          |
| `hr` / `pulse`                                       | `obs.heart_rate`                      |                                                                                                        |
| `rr` / `respiratoryRate`                             | `obs.resp_rate`                       |                                                                                                        |
| `temperature` / `temperature`                        | `obs.temperature`                     | unit `°C` read as `Cel`                                                                                |
| `spo2` / `spo2`                                      | `obs.spo2`                            | `oxygenSupport` missing: stored, non-interpretable for rules that need it (C2)                         |
| `glucose` / `bloodGlucose`                           | `obs.glucose`                         | specimen and fasting unknown: never used by a confirm lane                                             |
| `pain`                                               | `obs.pain_score`                      | `pain_scale` → `scale`                                                                                 |
| `weight`, `height`, `gcs`                            | `obs.weight`, `obs.height`, `obs.gcs` |                                                                                                        |
| `acvpu` / `consciousness`                            | none yet                              | ACVPU "C" has no AVPU answer. Quarantined with a reason until a concept is signed (C11, never dropped) |
| `intake`, `output`, `urine_output`, `etco2`, `other` | none                                  | no concept, so no manifest requests them                                                               |

| Legacy attribute    | Envelope                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `state='active'`    | `status='final'`                                                                   |
| `state='corrected'` | `status='entered_in_error'` (a resus artefact retraction; excluded from snapshots) |
| any legacy row      | `source='poc_staff'`, `trust=3` (nurse, triage or resus staff measurement)         |

### A7. Result provenance

Result values are observation rows with `report_id`, `order_id` and `entry_mode` (`direct | transcribed |
interface`; `interface` reserved). Trust per D-EMR-08:

| Entry                                 | Trust                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Laboratory staff, direct, final       | T4                                                                                       |
| Laboratory staff, direct, preliminary | T3                                                                                       |
| Interface (reserved)                  | T4                                                                                       |
| Clinician transcription               | T3; T4 once laboratory staff verify it (a new report version with `verified_by_user_id`) |
| Point-of-care test by staff           | T3 (`source='poc_staff'`, `point_of_care=true`)                                          |

The laboratory's reference range and flag travel per result in `context.referenceRange` and
`context.labInterpretation`, shown as text. MedSync marks a value critical only from a signed REF-CRIT entry; none
is signed, so none is marked.

## Part B — harmonised items

### B1. Repo naming (**[H]**)

| CFC v1.0                   | v1.1 (repo)                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `tenant_id` / `tenantId`   | `hospital_id` (TS envelope keeps `tenantId`, filled from `hospital_id`)                                               |
| `patient_id` / `patientId` | `patient_user_id` (TS keeps `patientId`)                                                                              |
| `recorded_by`              | `recorded_by_user_id`                                                                                                 |
| `observations`             | `clinical_observations`                                                                                               |
| `*_ciphertext bytea`       | `*_ciphertext text` (the `lib/encryption.ts` wire format `iv:tag:ct`, as `resus_timeline_events.narrative_encrypted`) |
| pg enums                   | text + CHECK (DROP-then-ADD to change)                                                                                |
| `raise_immutable()`        | the existing `public.block_modify_append_only()` (0040:118)                                                           |

### B2. Observation store: see A6.

### B3. Finding-token ownership (D-CFC-11, **[H]**)

The differential engine that was to own the catalogue was removed (ADR 0081). A finding token is now a clinician
`symptom_catalog` code (0042, 0045) **or** a `clinical_concepts` id of kind `finding`.
`clinical_concepts.symptom_code` (unique) maps a concept to its catalogue code, so one finding has one identity.
Mapped today: `sx.nocturia`, `sx.weight_loss_unintended`, `sx.fatigue`, `sx.abdominal_pain`, `sx.vomiting`,
`sx.claudication`, `sign.jaundice`, `sign.oedema`. A broader review-of-systems screen (e.g. `polyuria_polydipsia`)
is not the same token; it is listed in `broaderRosScreens`. The patient booking list
(`patient_symptom_catalog_items`) is untouched. A symptom property (e.g. fever's `rigors`, "chills") is a qualifier
of its finding, not a token.

### B4. Allergy name matching retained (D-EMR-04, **[H]**, safety-positive)

Uncoded allergen text is still passed to the prescribing name matcher (`runSafetyChecks`, `engine.ts:123`);
dropping it would weaken today's check. The UI label is "Matched by name only — code it for class checks". A coded
substance uses the formulary's own keys (`drugKey` for an ingredient, `drugClass` for a class), so there is one
vocabulary.

### B5. Other refinements

| Item                     | Change                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report concepts          | `rpt.imaging`, `rpt.ecg` are kind `observation`, value type `coded` (the conclusion); report text lives encrypted in `diagnostic_reports`                                                                                                                                                                                                 |
| `FactKind`               | + `allergy` only. Reports are `diagnostic_reports` rows plus observation facts                                                                                                                                                                                                                                                            |
| Other legacy projections | `problem_list`, `encounter_diagnoses` → condition facts (`verification` working→provisional, final→confirmed, excluded→refuted); `encounter_results` → observation facts with `entry_mode='direct'`, `labInterpretation` from the stored flag only; `encounter_medications` → medication facts with `medicationSource='patient_reported'` |
| Integrity job (§3.7)     | Runs over CFC rows only; legacy rows are re-projected, never recomputed in place                                                                                                                                                                                                                                                          |
| Enum extension (STOP 1)  | `specimen` + `sputum`; `container` + `sodium_citrate`, `blood_culture_bottle`, `sterile_container`, recorded in the v1.1 JSON `enumsAdded` (appended to the v1 lists) so the test menu's specimens and containers are expressible                                                                                                         |
