# Third-party notices

Clinical terminologies and code systems MedSync carries, their licences, and how MedSync uses them. Decision record:
[ADR 0137](docs/adr/0137-coding-and-terminology-licensing.md). Open software packages carry their own licences in
`node_modules`; this file covers terminology content only.

## ICD-11 — World Health Organization

- **Content:** ICD-11 for Mortality and Morbidity Statistics (MMS) codes and titles, in the 85 draft diagnosis terms
  (`data/emr/diagnosis-terms.v1.json`, seeded by `supabase/migrations/0072_emr_reference_seed.sql`) and in concept
  mappings (`data/emr/clinical-fact-concepts.v1.1.json`).
- **Licence:** Creative Commons Attribution-NoDerivatives 3.0 IGO (CC BY-ND 3.0 IGO).
- **Attribution:** "ICD-11 for Mortality and Morbidity Statistics. Geneva: World Health Organization. Licence: CC BY-ND
  3.0 IGO." Source: https://icd.who.int/.
- **How MedSync keeps the terms:** codes and titles are reproduced **unmodified**; the WHO title is kept beside each
  code (`icd11.title` in `data/emr/diagnosis-terms.v1.json`). MedSync's own clinician-facing wording is a separate
  `display` field and never replaces or edits the WHO title. Each code carries a verification status. All 85 draft terms are
  `verified-mirror`: checked against the findacode MMS v2026-01 mirror, not yet confirmed at icd.who.int.

## LOINC — Regenstrief Institute

- **Content:** LOINC codes in concept mappings (`data/emr/clinical-fact-concepts.v1.1.json`,
  `docs/emr/clinical-fact-concepts.v1.json`) and in the reference codes of `lib/encounter/reference-codes.ts`.
- **Notice:** "This material contains content from LOINC® (http://loinc.org). LOINC is copyright © Regenstrief Institute,
  Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee and is available at no cost under the
  license at http://loinc.org/license. LOINC® is a registered United States trademark of Regenstrief Institute, Inc."
- **How MedSync uses it:** a LOINC code is shown or exported **only when its status is verified**. Candidate codes
  stay internal. The FHIR projection (`lib/emr/fhir.ts`, ADR 0138) never emits one.

## ICD-10 — World Health Organization

- **Status: licence NOT yet held.** Owner action O-3 is to apply for the WHO ICD-10 licence.
- **Content present:** ICD-10 codes in `supabase/migrations/0041_clinical_code_reference.sql` and
  `lib/encounter/reference-codes.ts`, committed before this was recorded. Migrations are immutable, so the content
  stays.
- **How MedSync treats it until the licence is held:**
  - it is **unused by every surface**: no page, print or engine reads it;
  - it is **never exported**: the FHIR projection has no ICD-10 system;
  - `icd10_who_code` is CHECK-constrained to `NULL` on `diagnosis_terms` and `conditions` (0071).
- Allowing ICD-10 needs a new migration that drops those two CHECKs, after the licence is recorded here.

## CIEL — Columbia International eHealth Laboratory concept dictionary

- **Not used yet.** The `ciel_id` column exists on the concept registry and is empty. When CIEL mappings are added,
  their licence and attribution go here first.
