# MedSync — Clinical Fact Contract v1.0

### One read contract for every clinical engine. First consumer: the NCD engine (diabetes pack).

> **Doc ID** MS-DATA-CFC-001
> **Status** DRAFT for GATE A: CSO sign-off (clinical context rules, trust levels, sensitivity classes) and engineering review (schema, RLS, budgets). Stage 1: drafted, checked against section [12], revised.
> **Pairs with** MS-NCD-ENG-001 (NCD engine framework and diabetes pack structure) and `clinical-fact-concepts.v1.json` (seed catalogue, generated from the same source as section [08]).
> **Feeds** the Encounter/EMR engine prompt (next on the critical path; this document is its data brief) and the Monitoring engine prompt.
> **Rule** No clinical threshold appears in this document. Thresholds live in signed reference catalogues, the pattern the resus catalogues already use. This contract defines what must be recorded so that thresholds can be applied safely.

---

## [00] Why this exists

A glucose of 11.5 mmol/L can be diagnostic, borderline or meaningless. It depends on whether the sample was venous plasma or a finger-prick meter reading, whether the patient had fasted, whether it was taken two hours into an OGTT (oral glucose tolerance test), whether the tube sat unspun on a boda-boda for three hours, and whether the patient typed it at home or a laboratory released it. An engine that reads a bare number is guessing. MedSync's earlier failure mode was surfaces without engines; the equivalent failure for clinical intelligence is engines without context.

Timing matters. The Encounter/EMR engine is next on the critical path and no results model exists yet: the resus desk still takes laboratory values as manual codes. If the EMR ships first and context is bolted on later, every clinical table migrates. This contract is the EMR's data brief, so the record is born interpretable.

It also ends private vocabularies. Resus, triage, monitoring and the NCD engine each needed glucose, blood pressure and vital signs in slightly different shapes. From here there is one concept catalogue, one unit library and one loader.

## [01] Contract laws

| # | Law | What it prevents |
|---|---|---|
| C1 | Engines read facts, never source tables. Loaders project rows into typed facts validated with Zod; engines are pure functions over an immutable snapshot. | Engines coupled to schemas; untestable logic |
| C2 | Context travels with the value. Each concept declares its required context; a fact missing it is still stored, marked non-interpretable for the rules that need it, and the UI says what is missing. | Silent misreads (a random glucose read as fasting) |
| C3 | Not recorded, recorded absent and recorded normal are three different states. No engine may collapse them. | False reassurance from missing data |
| C4 | Keep what was reported; compute what is canonical. Both are stored, and one conversion library is used everywhere. | Unit errors; drift between services |
| C5 | MedSync concept IDs are primary. LOINC, WHO ICD-10, ICD-11, ATC and CIEL codes are mappings with a verification status. A LOINC code is a projection of concept plus context, not the concept. | Vendor-code lock-in; wrong codes presented as fact |
| C6 | Every fact carries provenance and a trust level (T1 to T4). Rules declare the minimum trust they accept. | A patient-typed reading confirming a diagnosis |
| C7 | Insert-only. Corrections are new versions that supersede; nothing is updated in place or deleted, the same guarantee the audit log already has. | Lost history; unreproducible decisions |
| C8 | Two clocks. Effective time is when something was clinically true; recorded time is when MedSync learned it. Snapshots are taken "as of" a recorded time, so any past engine output can be reproduced exactly. | "What did the system know then?" being unanswerable |
| C9 | Sensitivity is part of the fact. Restricted facts never reach SMS, push notifications, patient-facing text or exports. | Disclosure of HIV status or mental illness on a shared phone |
| C10 | Least privilege by manifest. A loader fetches only the concepts the requesting pack declares. | Over-collection; breaches of the minimality principle in the Data Protection and Privacy Act 2019 (DPPA) |
| C11 | Quarantine, never drop. A row that fails validation is quarantined with an integrity event and counted in the snapshot, so the UI can say that a record could not be read. | Invisible data loss |
| C12 | Location is not a clinical input in v1. District and parish stay out of the read contract; epidemiological use keeps its separate, independently declinable consent. | Proxy discrimination; purpose creep |

## [02] The fact model

TypeScript, strict. Zod schemas mirror each type one-to-one and live beside them in `lib/facts/**`. Per-concept rules (required context, answer sets, canonical unit) are generated from the seed catalogue as Zod refinements, so the catalogue and the validators cannot drift.

```ts
export type FactKind = 'observation' | 'finding' | 'condition' | 'medication' | 'pregnancy' | 'procedure' | 'demographic' | 'context';
export type Trust = 1 | 2 | 3 | 4;   // T4 lab final | T3 staff point-of-care or clinician exam | T2 validated patient device | T1 patient-typed or unverified import
export type FactSource = 'lab' | 'poc_staff' | 'clinician' | 'patient_reported' | 'device_synced' | 'imported';
export type FactStatus = 'preliminary' | 'final' | 'amended' | 'corrected' | 'entered_in_error' | 'cancelled';

export interface FactEnvelope {
  id: string;                    // deterministic: `${table}:${rowId}` (+ `:${component}` for multi-part rows)
  logicalId: string;             // stable across versions of the same item
  patientId: string;             // pseudonymous UUID; never MRN or name
  tenantId: string;              // facility that recorded it
  kind: FactKind;
  concept: ConceptId;            // e.g. 'obs.glucose'
  effective: { at: string } | { start: string; end?: string };   // ISO 8601, UTC
  recordedAt: string;            // knowledge time (C8)
  status: FactStatus;
  source: FactSource;
  trust: Trust;
  sensitivity: 'standard' | 'restricted';
  provenance: {
    table: string; rowId: string; version: number;
    encounterId?: string; orderId?: string; authorId?: string; authorCadre?: string;
    facilityLevel?: string; deviceId?: string; labId?: string;
    derivedFrom?: string[]; formula?: { id: string; version: string };   // derived values only
  };
  interpretable: { ok: true } | { ok: false; missing: string[] };      // C2
}

export type ObservationValue =
  | { type: 'quantity'; value: number; unit: string; canonical: { value: number; unit: string };
      comparator?: '<' | '<=' | '>' | '>=' }                          // meter HI/LO, "<0.5" lab results
  | { type: 'coded'; code: string }                                   // answer ID from the concept's answer set (coded or ordinal)
  | { type: 'boolean'; value: boolean };
// Free text is never a fact: it is stored encrypted and no rule can read it.

export interface ObservationFact extends FactEnvelope {
  kind: 'observation'; value: ObservationValue; context: ObservationContext;
}

export interface FindingFact extends FactEnvelope {
  kind: 'finding';
  token: string;                                     // the same token IDs the differential engine uses
  presence: 'present' | 'absent' | 'unknown';        // a question never asked produces no fact at all (C3)
  elicitedBy: 'history' | 'examination' | 'patient_self_report';
  onset?: string | { approxDaysAgo: number }; durationDays?: number;
  severity?: 'mild' | 'moderate' | 'severe'; laterality?: 'left' | 'right' | 'bilateral';
}

export interface ConditionFact extends FactEnvelope {
  kind: 'condition';
  clinicalStatus: 'active' | 'recurrence' | 'relapse' | 'inactive' | 'remission' | 'resolved';
  verification: 'unconfirmed' | 'provisional' | 'differential' | 'confirmed' | 'refuted' | 'entered_in_error';
  assertedBy: 'clinician' | 'patient_reported' | 'referral_document' | 'engine_proposal_accepted';
  subject: 'self' | 'mother' | 'father' | 'sibling' | 'child' | 'other_first_degree' | 'second_degree';  // family history lives here
  onset?: string | { ageYears: number }; abatement?: string;
  stage?: { system: string; value: string };         // e.g. { system: 'kdigo_ckd', value: 'G3a A2' }
  codes: { icd10?: string; icd11?: string; ciel?: string };
}

export interface MedicationFact extends FactEnvelope {
  kind: 'medication';
  drug: string; atc?: string; classTags: string[];  // tags from the drug class table in [08]
  status: 'active' | 'completed' | 'stopped' | 'on_hold' | 'intended' | 'unknown';
  period: { start?: string; end?: string };
  route?: 'oral' | 'iv' | 'im' | 'sc' | 'inhaled' | 'topical' | 'other';
  medicationSource: 'prescribed_here' | 'dispensed_here' | 'patient_reported' | 'external_record';
  // Dose is deliberately absent. Dosing belongs to the prescribing engine; the NCD engine never reads it.
}

export interface PregnancyFact extends FactEnvelope {
  kind: 'pregnancy'; episodeId: string;
  state: 'pregnant' | 'postpartum' | 'not_pregnant' | 'unknown';
  gestation?: { days: number; basis: 'lmp' | 'ultrasound' | 'fundal_height' | 'unknown'; asOf: string };
  edd?: string; deliveredAt?: string;
  outcome?: 'live_birth' | 'stillbirth' | 'miscarriage' | 'termination' | 'ectopic' | 'unknown';
  birthWeightGrams?: number;
}

export interface ProcedureFact extends FactEnvelope {
  kind: 'procedure'; outcome: 'completed' | 'not_done' | 'declined' | 'unable'; resultFactIds?: string[];
}

export interface DemographicFact extends FactEnvelope {
  kind: 'demographic';
  dateOfBirth: { value: string; precision: 'day' | 'month' | 'year' | 'estimated' };
  sexAtBirth: 'female' | 'male' | 'intersex' | 'unknown';   // physiological calculations only; not an identity field
}

export interface ContextFact extends FactEnvelope {
  kind: 'context'; facilityLevel: string;
  capabilities: Array<{ id: string; status: 'available' | 'intermittent' | 'unavailable'; updatedAt: string }>;
  setting: 'opd' | 'ipd' | 'ed' | 'antenatal' | 'hiv_clinic' | 'tb_clinic' | 'ncd_clinic' | 'community_outreach' | 'telehealth' | 'home';
}

export type ClinicalFact = ObservationFact | FindingFact | ConditionFact | MedicationFact
                         | PregnancyFact | ProcedureFact | DemographicFact | ContextFact;
```

The observation context. Which fields are required depends on the concept (see [08]); all are optional at type level and enforced per concept by the generated refinements.

```ts
export interface ObservationContext {
  specimen?: 'venous_plasma' | 'venous_serum' | 'venous_whole_blood' | 'capillary_whole_blood' | 'arterial_blood'
           | 'urine_spot' | 'urine_first_morning' | 'urine_24h' | 'interstitial_fluid' | 'unknown';
  calibration?: 'plasma_equivalent' | 'whole_blood' | 'unknown';          // glucose meters, from the device profile
  fastingState?: 'fasting' | 'non_fasting' | 'unknown';                    // unknown is never read as fasting
  fastingHours?: number;
  challenge?: { type: 'ogtt_75g'; minutesPostLoad: number } | { type: 'meal'; minutesPostMeal: number };
  method?: string;
  certification?: 'ngsp' | 'ifcc' | 'ngsp_and_ifcc' | 'none' | 'unknown';   // HbA1c
  idmsTraceable?: boolean | 'unknown';                                       // creatinine
  pointOfCare?: boolean; deviceId?: string; labId?: string;
  container?: 'fluoride_oxalate' | 'serum_plain' | 'lithium_heparin' | 'edta' | 'capillary_direct' | 'unknown';
  processingDelayMinutes?: number;
  testPurpose?: 'screening' | 'diagnostic' | 'monitoring' | 'acute_assessment' | 'antenatal_screening';
  qualityFlags?: Array<'haemolysed' | 'lipaemic' | 'icteric' | 'clotted' | 'delayed_processing' | 'qc_failed' | 'meter_error'>;
  referenceRange?: { low?: number; high?: number; unit: string; source: 'lab' | 'medsync' };
  labInterpretation?: 'L' | 'H' | 'LL' | 'HH' | 'N' | 'A';
  // Blood pressure
  position?: 'sitting' | 'standing' | 'supine'; arm?: 'left' | 'right';
  cuffSize?: 'small_adult' | 'adult' | 'large_adult' | 'child';
  device?: 'validated_automated' | 'aneroid' | 'mercury' | 'unknown';
  setting?: 'clinic' | 'home' | 'ambulatory'; readingSetId?: string; readingIndex?: number;
  // Anthropometry, derived values, CGM summaries, examination
  measurement?: 'measured' | 'reported' | 'estimated'; posture?: 'standing' | 'recumbent_length'; protocol?: string;
  formula?: { id: string; version: string };
  windowDays?: number; sensorWearPercent?: number;
  laterality?: 'left' | 'right' | 'bilateral';
  qualifiers?: Record<string, string | number | boolean>;                   // concept-specific extras, catalogue-validated
}

export interface FactSnapshot {
  patientId: string;
  asOf: string;                   // recorded-time cut-off (C8)
  manifest: string[];             // concepts requested by the pack (C10)
  facts: readonly ClinicalFact[]; // current version of each logical item as of asOf
  quarantined: number;            // rows that failed projection (C11)
  hash: string;                   // SHA-256 of the canonical fact list + asOf + manifest
}
```

## [03] Storage: what the source engines must persist

### 3.1 Tables and owners

| Table | Written by | Becomes | Notes |
|---|---|---|---|
| `patients` (exists) | onboarding, reception | demographic | Add `dob_precision`. Sex at birth is recorded for physiological calculations. |
| `observations` | EMR (labs, examination, history answers), triage and resus (vital signs), monitoring (spot readings) | observation, finding | One insert-only table. Findings live here with `presence`. |
| `conditions` | EMR | condition | Problem list, encounter diagnoses, family history (`subject_relation`). |
| `medication_statements` | EMR now; prescribing and pharmacy later | medication | Prescribed, dispensed, patient-reported and external medicines. Engines never read dose. |
| `pregnancy_episodes` | EMR (antenatal) | pregnancy | Gestation basis, EDD, outcome, birth weight. |
| `procedures` | EMR | procedure | Care processes: foot examination, retinal screening, education, transfusion, dialysis. |
| `telemetry_series` | monitoring | none directly | High-frequency streams (continuous glucose monitoring, CGM) never enter `observations`. A sensor sampling every five minutes produces about 105,000 readings per user per year; the monitoring engine writes daily summaries as `derived.cgm_*` observations instead. The device-ready ingestion contract and the fact store stay separate. |
| `facility_capabilities` | hospital setup (operating profile) | context | One row per capability: `available`, `intermittent` or `unavailable`. |
| `clinical_concepts`, `drug_class_tags`, `capabilities` | seed from `clinical-fact-concepts.v1.json` | registry | Versioned. Changes go through CSO sign-off like any clinical catalogue. |

### 3.2 The `observations` table

A sketch; the EMR prompt finalises names to project convention.

```sql
create table observations (
  id               uuid primary key,                  -- UUIDv7 for index locality
  logical_id       uuid not null,                     -- = id of version 1
  version          int  not null default 1,
  supersedes_id    uuid references observations(id),
  tenant_id        uuid not null,
  patient_id       uuid not null,
  encounter_id     uuid, order_id uuid,
  concept_id       text not null references clinical_concepts(id),
  category         text not null check (category in ('laboratory','vital_sign','anthropometric','symptom','sign',
                                                    'exam','history','social','event','derived')),
  value_type       text not null check (value_type in ('quantity','coded','ordinal','boolean','presence')),
  value_num        numeric,
  value_comparator text check (value_comparator in ('<','<=','>','>=')),
  value_unit       text,                              -- UCUM, as reported
  value_canonical  numeric,                           -- in the concept's canonical unit
  value_code       text,                              -- answer ID (coded, ordinal)
  value_bool       boolean,
  presence         text check (presence in ('present','absent','unknown')),
  specimen         text,
  calibration      text,
  fasting_state    text check (fasting_state in ('fasting','non_fasting','unknown')),
  challenge        text,
  challenge_minutes int,
  method           text,
  certification    text,
  point_of_care    boolean,
  device_id        uuid,
  lab_id           uuid,
  context          jsonb not null default '{}'::jsonb, -- remaining concept-specific context, catalogue-validated
  source           text not null check (source in ('lab','poc_staff','clinician','patient_reported','device_synced','imported')),
  trust            smallint not null check (trust between 1 and 4),
  status           text not null check (status in ('preliminary','final','amended','corrected','entered_in_error','cancelled')),
  sensitivity      text not null default 'standard' check (sensitivity in ('standard','restricted')),
  effective_at     timestamptz not null,
  recorded_at      timestamptz not null default now(),
  recorded_by      uuid,
  author_cadre     text,
  note_ciphertext  bytea,                             -- free text, AES-256-GCM via lib/encryption.ts; never rule-readable
  constraint value_matches_type check (
    (value_type = 'quantity' and value_num is not null and value_unit is not null and value_canonical is not null) or
    (value_type in ('coded','ordinal') and value_code is not null) or
    (value_type = 'boolean' and value_bool is not null) or
    (value_type = 'presence' and presence is not null))
);

-- Insert-only, like the audit log.
create trigger observations_block_mutation
  before update or delete on observations
  for each row execute function raise_immutable();
```

`conditions`, `medication_statements`, `pregnancy_episodes` and `procedures` follow the same pattern: `logical_id`, `version`, `supersedes_id`, effective time, `recorded_at`, `source`, `trust`, `status`, `sensitivity`, and a BEFORE UPDATE OR DELETE block.

### 3.3 Versions, corrections and "as of"

- A correction inserts a new row with `supersedes_id` set, `version + 1`, and status `amended`, `corrected` or `entered_in_error`.
- The current version of a logical item is the newest row not superseded by another. Expose it as a view (`observations_current`, and so on) so ordinary reads stay simple.
- An as-of snapshot takes, for each logical item, the newest version with `recorded_at <= asOf`. Items whose newest version is `entered_in_error` or `cancelled` are excluded.
- When a correction lands, every profile that used the old version recomputes, and any state change that depended on it gets a visible "reversed by correction" entry (MS-NCD-ENG-001, invariant I12).

### 3.4 Indexes

```sql
create index obs_patient_concept_time on observations (patient_id, concept_id, effective_at desc);
create index obs_supersedes          on observations (supersedes_id) where supersedes_id is not null;
create index obs_sweep               on observations (concept_id, effective_at)
                                     include (patient_id, value_canonical, fasting_state, specimen, trust)
                                     where status in ('final','amended','corrected');
create index obs_tenant_time         on observations (tenant_id, effective_at desc);
```

The sweep index serves the incidental-hyperglycaemia search (MS-NCD-ENG-001, rule family DM-SUS-INCID) without touching the table heap.

### 3.5 Row-level security (RLS)

- **Reads.** One predicate for all clinical tables, taken from the pending GATE A decision on patient-access basis (care team, assigned or department). Implement it as a `security definer` function in a non-exposed schema and call it as `patient_id in (select private.accessible_patient_ids())`, so Postgres evaluates it once per statement as an initPlan. Index every column a policy touches, and filter explicitly in queries as well, because RLS is for security, not filtering. These are Supabase's documented RLS performance practices (checked 26 Sep 2026).
- **Writes.** Never from the client. Edge Functions only, with Zod validation, auth, role and cadre checks, and audit, and with `aal2` (a completed MFA challenge) required for every clinical write, since MFA is mandatory for clinical roles.
- **Probes.** Every new table ships with RLS probes (select, insert, update and delete for each role) in the same phase, per the engine-first law.

### 3.6 Encryption boundary (needs an ADR)

The current rule encrypts PHI at application level. Applied to every column, it would make the incidental-hyperglycaemia sweep, trend queries and registries impossible in the database. Recommendation: structured coded values (concept, numbers, codes, context) are stored in plaintext columns, protected by RLS, pseudonymous patient IDs and at-rest disk encryption; direct identifiers and all free text stay application-encrypted with AES-256-GCM. This refines the security model, so it needs an ADR and your sign-off (D-CFC-04).

### 3.7 Integrity jobs

A nightly job recomputes `value_canonical` from `value_num` and `value_unit` with the unit library and alerts on any mismatch; lists quarantined rows for review; and checks that every non-candidate external code in use still matches the seeded catalogue.

## [04] Context rules that matter clinically

This is the heart of the contract. The dossier sets the numbers; these rules set what must be captured so the numbers can be applied.

### 4.1 Glucose

- **Specimen and calibration.** Venous plasma, capillary meter and whole-blood values are not interchangeable. Meter readings carry `calibration`, taken from the registered device profile rather than typed each time. An unknown specimen is never used by the confirm lane.
- **Fasting state.** Three values: `fasting`, `non_fasting`, `unknown`. Unknown is treated as non-fasting, never as fasting. The fasting definition shown on the entry chip is a dossier reference (REF-DM-FASTING-DEF).
- **Challenge.** OGTT time points carry `ogtt_75g` and minutes post-load. This supports the 2-hour criteria and, as a separate named criteria set, the 1-hour criteria in the IDF's 2024 position statement.
- **Pre-analytical delay.** Glucose falls while blood sits unseparated. `container` and `processingDelayMinutes` are captured where known; the dossier decides how a delayed sample may be read (for example, usable to raise suspicion but not to rule out).
- **Meter limits.** HI and LO are stored as a comparator plus the meter's limit from the device profile (for example `> 33.3`), never as missing values.
- **Code projection.** The LOINC code is chosen at export time from context.

| Specimen and method | Context | LOINC (mmol/L; mg/dL) | Status |
|---|---|---|---|
| Serum or plasma, laboratory | random or unspecified | 14749-6; 2345-7 | ✓ |
| Serum or plasma, laboratory | fasting | 14771-0; 1558-6 | ○ |
| Capillary blood, glucometer | any | 14743-9; 41653-7 | ✓ |
| Blood, unspecified | any | 15074-8; 2339-0 | ✓ |
| Venous whole blood | any | 39480-9 (molar only) | ✓ |
| Capillary blood, not a meter | any | 51596-5 (molar only) | ✓ |
| Serum or plasma | OGTT, 60 or 120 min post-load | to map | ○ |

### 4.2 HbA1c and its validity modifiers

Context: `method`, `certification` (NGSP, IFCC, both, none, unknown) and `pointOfCare`. Before any rule reads an HbA1c, the engine decides whether it is usable for this patient. The ADA Standards of Care 2026 advise that HbA1c may not suit diagnosis in anaemia, erythropoietin treatment, haemodialysis or HIV treatment; that people with sickle cell trait need an assay free of haemoglobin-variant interference; that plasma glucose criteria should be used where the relationship between HbA1c and glycaemia is altered (haemoglobin variants, pregnancy, G6PD deficiency, HIV, altered red-cell turnover); and that HbA1c cannot be measured at all in HbSS. Many Ugandan patients fall into at least one of these groups, so the contract must capture:

| Modifier | Captured as |
|---|---|
| Haemoglobin phenotype, sickle screen | `obs.hb_phenotype`, `obs.sickle_solubility`, `cond.sickle_cell_disease`, `cond.thalassaemia` |
| G6PD deficiency | `obs.g6pd`, `cond.g6pd_deficiency` |
| Anaemia, iron deficiency | `obs.haemoglobin`, `cond.iron_deficiency_anaemia` |
| Recent transfusion | `proc.blood_transfusion` (effective date) |
| Pregnancy and postpartum | pregnancy facts (trimester and postpartum windows derived) |
| Kidney failure, dialysis | `derived.egfr`, `proc.dialysis`, `cond.ckd` |
| Erythropoiesis-stimulating agents, dapsone | drug tags `erythropoiesis_stimulating`, `dapsone` |
| HIV and antiretroviral treatment | `cond.hiv` (restricted) and regimen tags |
| Recent malaria or haemolysis | `obs.malaria_test` |
| Assay interference profile | `method`, `certification`, device or laboratory ID |

The windows (how recent a transfusion or malaria episode must be to matter) are dossier references. The output is a validity object on the evidence item, so the UI can say "HbA1c can't be used for diagnosis: sickle cell trait on record" instead of silently ignoring the value.

### 4.3 Creatinine and eGFR

Creatinine carries `method` (enzymatic or Jaffe) and `idmsTraceable`. MedSync computes eGFR with one signed, versioned equation and stores it with `formula`; a laboratory-reported eGFR is kept as a separate fact for reference. The ARK study measured GFR in 2,578 adults across Malawi, South Africa and Uganda: creatinine-based equations overestimated kidney function, most at low function, and no equation (including the race-free CKD-EPI 2021) came within 30% of measured GFR for three-quarters of participants. So the equation name is always displayed; values near a stage boundary are treated conservatively; albuminuria carries more weight in staging decisions; and cystatin C is reserved as a v1.1 concept. LOINC defines the CKD-EPI 2021 term for adults 18 and over, so paediatric eGFR is out of scope until a paediatric equation is signed.

### 4.4 Albuminuria

Urine albumin-to-creatinine ratio (ACR) carries `specimen` (spot or first morning) and `method` (quantitative laboratory or semi-quantitative strip). The protein dipstick is kept as a fallback screen for facilities without ACR and is never used for staging.

### 4.5 Blood pressure

Each reading carries position, arm, cuff size, device, setting (clinic, home, ambulatory), a `readingSetId` and its index in the set. Which readings of a set are averaged is a signed rule of the hypertension pack, computed as `derived.bp_set_mean`. Triage vital signs write to the same table, so each patient's blood pressure history is one series.

### 4.6 Findings

Symptoms and signs use the shared token catalogue owned by the differential engine; the NCD engine never keeps its own symptom list. Presence is `present`, `absent` or `unknown`, and a question never asked produces no fact. `elicitedBy` separates history, examination and patient self-report. The 28 finding concepts in [08] each need a token: map each to an existing token or add it to the shared catalogue (D-CFC-11).

### 4.7 Medicines

Engines read class tags, status, period, route and source, never dose. Route matters: systemic glucocorticoids raise glucose and topical ones do not. Patient-reported and external medicines count, because dolutegravir started at another clinic is still dolutegravir.

### 4.8 Pregnancy

Pregnancy is an episode, not a flag. Gestational age carries its basis; trimester and postpartum windows are derived, never typed. A resolved episode with hyperglycaemia is the durable record of prior hyperglycaemia in pregnancy, which is a lifelong risk factor.

### 4.9 Demographics

Date of birth carries a precision (day, month, year, estimated). Many older rural patients have estimated dates of birth, so age-threshold rules treat imprecise ages conservatively: if the uncertainty spans a screening threshold, the patient is treated as eligible. Sex at birth is recorded for physiological calculations only.

### 4.10 Facility capabilities

Hospital setup records which tests and services exist and whether each is `available`, `intermittent` or `unavailable`. Intermittent matters in Uganda, where reagent and test-strip stock-outs are routine. The act lane uses this to choose the next-best test that can actually be done here, or to offer referral.

## [05] Units and conversions

One library (`lib/units`) implements this table, and nothing else converts units. Canonical units follow Ugandan laboratory practice.

| Analyte | From | To | Operation | Basis | Status |
|---|---|---|---|---|---|
| glucose | mg/dL | mmol/L | divide by 18.0156 | molar mass 180.156 g/mol | ✓ verified |
| HbA1c | mmol/mol (IFCC) | % (NGSP) | NGSP = 0.09148 x IFCC + 2.152 | NGSP master equation | ✓ verified |
| HbA1c | % (NGSP) | mmol/mol (IFCC) | IFCC = (NGSP - 2.152) / 0.09148 | inverse of the master equation | ✓ verified |
| creatinine | mg/dL | umol/L | multiply by 88.42 | molar mass 113.12 g/mol | standard (derivable) |
| cholesterol (total, HDL, LDL, non-HDL) | mg/dL | mmol/L | divide by 38.67 | molar mass 386.65 g/mol | standard (derivable) |
| triglycerides | mg/dL | mmol/L | divide by 88.57 | as triolein, 885.7 g/mol | standard (derivable) |
| urea | mg/dL (urea nitrogen) | mmol/L (urea) | multiply by 0.357 | two nitrogen atoms per urea | standard (derivable) |
| urine ACR | mg/g | mg/mmol | divide by 8.84 | creatinine 113.12 g/mol | standard (derivable) |
| haemoglobin | g/L | g/dL | divide by 10 | unit prefix | standard (derivable) |
| C-peptide | ng/mL | nmol/L | multiply by 0.331 | molar mass 3020.3 g/mol | standard (derivable) |
| C-peptide | pmol/L | nmol/L | divide by 1000 | unit prefix | standard (derivable) |
| weight | [lb_av] | kg | multiply by 0.45359237 | definition | standard (derivable) |
| height | [in_i] | cm | multiply by 2.54 | definition | standard (derivable) |
| temperature | [degF] | Cel | (F - 32) x 5/9 | definition | standard (derivable) |

Canonical units: glucose mmol/L; HbA1c % (NGSP), with IFCC mmol/mol derived; creatinine µmol/L (UCUM `umol/L`); lipids mmol/L; urine ACR mg/mmol; haemoglobin g/dL; weight kg; height cm; temperature °C. Display may switch units; storage never does.

## [06] Entry-time guards (write path)

Context capture must cost at most one tap in the common case, or staff will skip it.

- **Defaults from the device.** A registered glucometer supplies specimen, calibration and meter limits; a laboratory interface supplies method and certification. Staff choose only the fasting chip: `Fasting`, `Not fasting` or `Not sure` (the chip text carries the signed fasting definition).
- **Unit-mismatch prompts.** They ask for confirmation and never reject, because a genuine extreme value must never be blocked. Proposed triggers, for CSO sign-off:

| Concept | Entered unit | Prompt when | Question shown |
|---|---|---|---|
| `obs.glucose` | `mmol/L` | value > 60 | Is this mg/dL? |
| `obs.hba1c` | `%` | value > 20 | Is this IFCC mmol/mol? |
| `obs.creatinine` | `umol/L` | value < 15 | Is this mg/dL? |
| `obs.haemoglobin` | `g/dL` | value > 30 | Is this g/L? |
| `obs.chol_total` | `mmol/L` | value > 30 | Is this mg/dL? |

- **Plausibility bounds.** Each quantity concept gets a soft bound (asks the user to confirm) and a hard bound (rejects a physically impossible value). The numbers are signed in the dossier; the mechanism ships with the EMR.
- **Duplicate detection.** The same concept and value at the same effective time, entered within minutes from two sources (triage and a nurse, for example), is flagged for merging rather than counted twice.
- **Missing required context.** The save succeeds; the fact is stored as non-interpretable for the rules that need the missing field, and the UI shows exactly what is missing.

## [07] The snapshot loader

```ts
export async function loadFactSnapshot(
  db: Db,
  patientId: string,
  opts: { manifest: ConceptId[]; asOf?: Date; purpose: 'interactive' | 'sweep'; lookbackYears?: number },
): Promise<FactSnapshot>
```

- Server-only (Edge Function or server action). Interactive reads run under the caller's auth and RLS; sweeps run under a dedicated service role, and every sweep run is logged.
- Loads only the manifest's concepts (C10), the current version of each item as of `asOf` (C8), within the lookback window, with per-concept caps (most recent N). Raw CGM data is never loaded.
- Projects rows with pure functions (`projectObservation`, `projectCondition` and so on) validated by Zod; rows that fail are quarantined (C11).
- Returns a deterministic hash, so an identical snapshot reproduces an identical engine output.
- Reuses the global `PrismaClient` singleton (G1) and adds no new infrastructure: local development runs on the existing `prisma dev` setup with Node 22 and pnpm only.
- Budgets: p95 at most 60 ms for a patient with 2,000 facts; payload to the engine at most 1 MB.

## [08] Concept catalogue v1

Generated from the same source as `clinical-fact-concepts.v1.json`: 145 concepts (66 observations, 28 findings, 33 conditions, 5 pregnancy, 8 procedures, 2 demographic, 3 context), 21 drug class tags and 29 facility capabilities, carrying 157 external codes (13 verified at primary sources, 28 via a mirror or secondary source, 116 candidates).

Legend. ✓ verified at the primary source. ◐ verified via a mirror of the WHO ICD-11 browser or a secondary source; confirm at the primary source before use. ○ candidate from domain knowledge; verify before any export or rule uses it. "to map" means no code has been assigned yet.
Lanes. CORE shared cardiometabolic core; SUS suspect; CON confirm; CLS classify; STR stratify; ACT act; ACU acute-routing context.

#### Glycaemia

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `obs.glucose` | Glucose (blood, plasma or serum) | quantity, `mmol/L` (accepts mg/dL) | specimen, fastingState; conditional: calibration, challenge, deviceId | LOINC 14749-6 ✓; LOINC 2345-7 ✓; LOINC 14743-9 ✓; LOINC 41653-7 ✓; LOINC 15074-8 ✓; LOINC 2339-0 ✓; LOINC 39480-9 ✓; LOINC 51596-5 ✓; LOINC 14771-0 ○; LOINC 1558-6 ○ | SUS CON STR ACU |
| `obs.hba1c` | HbA1c | quantity, `%` (accepts mmol/mol) | method, certification, pointOfCare | LOINC 4548-4 ✓; LOINC 59261-8 ✓ | SUS CON STR |
| `obs.fructosamine` | Fructosamine | quantity, `umol/L` | none | LOINC 15069-8 ○ | STR |
| `obs.ketones_blood` | Beta-hydroxybutyrate (blood ketones) | quantity, `mmol/L` | specimen, pointOfCare | to map | CLS ACU |
| `obs.ketones_urine` | Ketones (urine dipstick) | ordinal: negative / trace / plus1 / plus2 / plus3 | specimen | LOINC 2514-8 ○ | CLS ACU |
| `obs.glucose_urine` | Glucose (urine dipstick) | ordinal: negative / trace / plus1 / plus2 / plus3 / plus4 | none | LOINC 25428-4 ○ | SUS |
| `obs.c_peptide` | C-peptide | quantity, `nmol/L` (accepts pmol/L, ng/mL) | fastingState | LOINC 1986-9 ○ | CLS |
| `obs.islet_autoantibody` | Islet autoantibody | coded: positive / negative / indeterminate | antigen, method | to map | CLS |

#### Continuous glucose monitoring summaries (written by the monitoring engine)

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `derived.cgm_tir` | Time in range (CGM) | quantity, `%` | windowDays, sensorWearPercent | to map | STR |
| `derived.cgm_tbr` | Time below range (CGM) | quantity, `%` | windowDays, sensorWearPercent, level | to map | STR |
| `derived.cgm_tar` | Time above range (CGM) | quantity, `%` | windowDays, sensorWearPercent, level | to map | STR |
| `derived.cgm_gmi` | Glucose management indicator (CGM) | quantity, `%` | windowDays, sensorWearPercent | to map | STR |
| `derived.cgm_cv` | Glucose coefficient of variation (CGM) | quantity, `%` | windowDays, sensorWearPercent | to map | STR |
| `derived.cgm_mean` | Mean sensor glucose (CGM) | quantity, `mmol/L` | windowDays, sensorWearPercent | to map | STR |

#### Acid-base and electrolytes (context for acute routing)

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `obs.sodium` | Sodium | quantity, `mmol/L` | specimen | LOINC 2951-2 ○ | ACU CLS |
| `obs.potassium` | Potassium | quantity, `mmol/L` | specimen | LOINC 2823-3 ○ | ACU CLS |
| `obs.chloride` | Chloride | quantity, `mmol/L` | specimen | LOINC 2075-0 ○ | ACU CLS |
| `obs.bicarbonate` | Bicarbonate | quantity, `mmol/L` | specimen | LOINC 1963-8 ○ | ACU CLS |
| `obs.ph` | Blood pH | quantity, `[pH]` | specimen | LOINC 2744-1 ○ | ACU |
| `obs.urea` | Urea | quantity, `mmol/L` (accepts mg/dL (urea nitrogen)) | none | LOINC 3094-0 ○ | ACU STR |
| `derived.anion_gap` | Anion gap | quantity, `mmol/L` | formula | to map | ACU |
| `derived.osmolality_effective` | Effective serum osmolality | quantity, `mOsm/kg` | formula | to map | ACU |

#### Kidney

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `obs.creatinine` | Creatinine | quantity, `umol/L` (accepts mg/dL) | method, idmsTraceable | LOINC 14682-9 ○; LOINC 2160-0 ○ | STR |
| `derived.egfr` | Estimated GFR | quantity, `mL/min/{1.73_m2}` | formula | LOINC 98979-8 ✓; LOINC 98980-6 ✓ | STR |
| `obs.cystatin_c` | Cystatin C *(v1.1)* | quantity, `mg/L` | none | LOINC 33863-2 ○ | STR |
| `obs.uacr` | Urine albumin-to-creatinine ratio | quantity, `mg/mmol` (accepts mg/g) | specimen, method | LOINC 9318-7 ○; LOINC 14959-1 ○ | STR |
| `obs.urine_protein_dipstick` | Protein (urine dipstick) | ordinal: negative / trace / plus1 / plus2 / plus3 / plus4 | none | LOINC 20454-5 ○ | STR |

#### Lipids

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `obs.chol_total` | Total cholesterol | quantity, `mmol/L` (accepts mg/dL) | none | LOINC 14647-2 ○; LOINC 2093-3 ○ | STR |
| `obs.chol_hdl` | HDL cholesterol | quantity, `mmol/L` (accepts mg/dL) | none | LOINC 14646-4 ○; LOINC 2085-9 ○ | STR |
| `obs.chol_ldl` | LDL cholesterol | quantity, `mmol/L` (accepts mg/dL) | derivation | LOINC 13457-7 ○ | STR |
| `obs.triglycerides` | Triglycerides | quantity, `mmol/L` (accepts mg/dL) | none | LOINC 14927-8 ○; LOINC 2571-8 ○ | STR |
| `derived.chol_non_hdl` | Non-HDL cholesterol | quantity, `mmol/L` | formula | to map | STR |

#### Haematology and HbA1c validity

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `obs.haemoglobin` | Haemoglobin | quantity, `g/dL` (accepts g/L) | none | LOINC 718-7 ○ | CON |
| `obs.hb_phenotype` | Haemoglobin phenotype | coded: AA / AS / SS / SC / AC / CC / S_beta_thal / other / indeterminate | method | to map | CON |
| `obs.sickle_solubility` | Sickle solubility test | coded: positive / negative | none | to map | CON |
| `obs.g6pd` | G6PD status | coded: normal / intermediate / deficient | method | to map | CON |
| `obs.malaria_test` | Malaria test | coded: positive / negative | method | to map | CON STR |

#### Liver

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `obs.alt` | ALT *(v1.1)* | quantity, `U/L` | none | LOINC 1742-6 ○ | STR |
| `obs.ast` | AST *(v1.1)* | quantity, `U/L` | none | LOINC 1920-8 ○ | STR |
| `obs.platelets` | Platelet count *(v1.1)* | quantity, `10*9/L` | none | LOINC 777-3 ○ | STR |
| `derived.fib4` | FIB-4 index *(v1.1)* | quantity, `{index}` | formula | to map | STR |

#### Anthropometry

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `obs.weight` | Body weight | quantity, `kg` (accepts [lb_av]) | none | LOINC 29463-7 ○ | CORE |
| `obs.height` | Height or length | quantity, `cm` (accepts [in_i]) | measurement | LOINC 8302-2 ○ | CORE |
| `derived.bmi` | Body mass index | quantity, `kg/m2` | formula | LOINC 39156-5 ○ | CORE |
| `obs.waist` | Waist circumference | quantity, `cm` | protocol | LOINC 8280-0 ○ | CORE |
| `derived.whtr` | Waist-to-height ratio | quantity, `{ratio}` | formula | to map | CORE |
| `obs.muac` | Mid-upper arm circumference | quantity, `cm` | none | to map | CLS CORE |

#### Vital signs

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `obs.bp_systolic` | Systolic blood pressure | quantity, `mm[Hg]` | position, arm, cuffSize, device, setting, readingSetId, readingIndex | LOINC 8480-6 ○ | CORE |
| `obs.bp_diastolic` | Diastolic blood pressure | quantity, `mm[Hg]` | position, arm, cuffSize, device, setting, readingSetId, readingIndex | LOINC 8462-4 ○ | CORE |
| `derived.bp_set_mean` | Blood pressure, reading-set mean | quantity, `mm[Hg]` | formula, readingSetId | to map | CORE |
| `obs.heart_rate` | Heart rate | quantity, `/min` | none | LOINC 8867-4 ○ | ACU |
| `obs.resp_rate` | Respiratory rate | quantity, `/min` | none | LOINC 9279-1 ○ | ACU |
| `obs.temperature` | Body temperature | quantity, `Cel` (accepts [degF]) | none | LOINC 8310-5 ○ | ACU |
| `obs.gcs` | Glasgow Coma Scale, total | quantity, `{score}` | none | LOINC 9269-2 ○ | ACU |
| `obs.avpu` | AVPU | coded: alert / voice / pain / unresponsive | none | to map | ACU |

#### Symptoms (tokens shared with the differential engine)

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `sx.polyuria` | Polyuria (passing large volumes of urine) | present / absent / unknown | elicitedBy | to map | SUS CLS |
| `sx.polydipsia` | Polydipsia (excessive thirst) | present / absent / unknown | elicitedBy | to map | SUS CLS |
| `sx.polyphagia` | Polyphagia (excessive hunger) | present / absent / unknown | elicitedBy | to map | SUS |
| `sx.nocturia` | Nocturia | present / absent / unknown | elicitedBy | to map | SUS |
| `sx.secondary_enuresis` | Secondary enuresis (child previously dry) | present / absent / unknown | elicitedBy | to map | SUS CLS |
| `sx.weight_loss_unintended` | Unintended weight loss | present / absent / unknown | elicitedBy | to map | SUS CLS |
| `sx.fatigue` | Fatigue | present / absent / unknown | elicitedBy | to map | SUS |
| `sx.blurred_vision` | Blurred vision | present / absent / unknown | elicitedBy | to map | SUS STR |
| `sx.genital_itch_discharge` | Genital itch or discharge (vulvovaginal candidiasis, balanitis) *(restricted)* | present / absent / unknown | elicitedBy | to map | SUS |
| `sx.recurrent_skin_infection` | Recurrent skin infections (boils, abscesses) | present / absent / unknown | elicitedBy | to map | SUS |
| `sx.slow_healing_wound` | Slow-healing wound | present / absent / unknown | elicitedBy | to map | SUS STR |
| `sx.foot_numbness_burning` | Numbness, tingling or burning in the feet | present / absent / unknown | elicitedBy | to map | STR |
| `sx.erectile_dysfunction` | Erectile dysfunction *(restricted)* | present / absent / unknown | elicitedBy | to map | STR |
| `sx.abdominal_pain` | Abdominal pain | present / absent / unknown | elicitedBy | to map | ACU |
| `sx.vomiting` | Vomiting | present / absent / unknown | elicitedBy | to map | ACU |
| `sx.hypoglycaemia_symptoms` | Symptoms of low glucose (sweating, tremor, palpitations, hunger, confusion) | present / absent / unknown | elicitedBy | to map | STR ACU |
| `sx.claudication` | Calf pain on walking, relieved by rest | present / absent / unknown | elicitedBy | to map | STR |

#### History findings

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `hist.childhood_undernutrition` | Undernutrition in childhood (history) | present / absent / unknown | elicitedBy | to map | CLS |
| `hist.high_glucose_ever` | Ever told of high blood glucose, including in pregnancy | present / absent / unknown | elicitedBy | to map | SUS |

#### Events

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `evt.hypoglycaemia` | Hypoglycaemia episode | coded: level1 / level2 / level3 | none | to map | STR ACT |

#### Signs

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `sign.acanthosis_nigricans` | Acanthosis nigricans | present / absent / unknown | elicitedBy | to map | SUS CLS |
| `sign.kussmaul_breathing` | Kussmaul (deep, laboured) breathing | present / absent / unknown | elicitedBy | to map | ACU CLS |
| `sign.ketotic_breath` | Ketotic (fruity) breath odour | present / absent / unknown | elicitedBy | to map | ACU |
| `sign.dehydration` | Dehydration | ordinal: none / some / severe | elicitedBy | to map | ACU |
| `sign.foot_ulcer` | Foot ulcer (active) | present / absent / unknown | elicitedBy, laterality | to map | STR |
| `sign.foot_infection` | Signs of foot infection | present / absent / unknown | elicitedBy, laterality | to map | STR ACU |
| `sign.foot_deformity` | Foot deformity | present / absent / unknown | elicitedBy, laterality | to map | STR |
| `sign.foot_callus` | Foot callus | present / absent / unknown | elicitedBy, laterality | to map | STR |
| `sign.gangrene` | Gangrene | present / absent / unknown | elicitedBy, laterality | to map | STR ACU |

#### Examination

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `exam.pedal_pulses` | Pedal pulses | coded: present / reduced / absent | laterality | to map | STR |
| `exam.monofilament` | 10 g monofilament test | coded: normal / abnormal | laterality, sitesTested, sitesInsensate | to map | STR |
| `exam.vibration_128hz` | Vibration sense (128 Hz tuning fork) | coded: normal / reduced / absent | laterality | to map | STR |
| `exam.ankle_reflex` | Ankle reflex | coded: present / reduced / absent | laterality | to map | STR |
| `exam.retinopathy_grade` | Retinopathy grade | coded: none / mild_npdr / moderate_npdr / severe_npdr / pdr / ungradable | laterality, method, gradingScale | to map | STR |
| `exam.maculopathy` | Maculopathy | coded: absent / present / ungradable | laterality, method | to map | STR |

#### Conditions (problem list, diagnoses, family history)

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `cond.dm_type1` | Type 1 diabetes | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E10 ◐; ICD-11 5A10 ◐ | SUS CON CLS STR ACT |
| `cond.dm_type2` | Type 2 diabetes | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E11 ◐; ICD-11 5A11 ◐ | SUS CON CLS STR ACT |
| `cond.dm_mrdm` | Malnutrition-related diabetes | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E12 ◐; ICD-11 5A12 ◐ | SUS CON CLS STR ACT |
| `cond.dm_other` | Diabetes, other specified type | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E13 ◐; ICD-11 5A13 ◐; ICD-11 5A13.2 ◐; ICD-11 5A13.3 ◐; ICD-11 5A13.4 ◐ | SUS CON CLS STR ACT |
| `cond.dm_unspecified` | Diabetes, type unspecified | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E14 ◐; ICD-11 5A14 ◐ | SUS CON CLS STR ACT |
| `cond.dm_in_pregnancy` | Diabetes or hyperglycaemia in pregnancy | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) O24.2 ◐; ICD-10 (WHO) O24.0-O24.9 ○; ICD-11 JA63.0 ◐; ICD-11 JA63.1 ◐; ICD-11 JA63.2 ◐; ICD-11 JA63.Y ◐ | SUS CON CLS ACT |
| `cond.intermediate_hyperglycaemia` | Intermediate hyperglycaemia | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) R73.0 ○; ICD-11 5A40.0 ◐; ICD-11 5A40.1 ◐; ICD-11 5A40.Y ◐; ICD-11 5A40.Z ◐ | SUS CON ACT |
| `cond.elevated_glucose_unspecified` | Elevated blood glucose, not yet explained | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) R73.9 ○; ICD-11 MA18.0 ◐ | SUS |
| `cond.dka` | Diabetic ketoacidosis | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E10.1-E14.1 ○; ICD-11 5A22.0 ◐ | CLS ACU |
| `cond.hhs` | Hyperosmolar hyperglycaemic state | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) by type ○; ICD-11 5A20 ◐ | CLS ACU |
| `cond.hypoglycaemia_in_dm` | Hypoglycaemia in diabetes | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E16.0 ○; ICD-10 (WHO) E16.2 ○; ICD-11 5A21 ◐; ICD-11 5A41 ◐ | STR ACU |
| `cond.hypertension` | Hypertension | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) I10 ○; ICD-11 BA00 ○ | SUS STR |
| `cond.ckd` | Chronic kidney disease | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) N18 ○; ICD-11 GB61 ○ | STR |
| `cond.ascvd` | Atherosclerotic cardiovascular disease | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) I20-I25, I63-I64, I70.2 ○ | SUS STR |
| `cond.heart_failure` | Heart failure | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) I50 ○ | STR |
| `cond.dyslipidaemia` | Dyslipidaemia | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E78 ○ | STR |
| `cond.hiv` | HIV infection *(restricted)* | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) B20-B24 ○; ICD-11 1C60-1C62 ○ | SUS CON CLS |
| `cond.tuberculosis` | Tuberculosis *(restricted)* | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) A15-A19 ○; ICD-11 1B10-1B14 ○ | SUS STR |
| `cond.chronic_pancreatitis` | Chronic pancreatitis | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) K86.1 ○ | SUS CLS |
| `cond.pcos` | Polycystic ovary syndrome *(restricted)* | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E28.2 ○; ICD-11 5A80.1 ○ | SUS |
| `cond.sickle_cell_disease` | Sickle cell disease | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) D57 ○; ICD-11 3A51 ○ | CON |
| `cond.thalassaemia` | Thalassaemia | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) D56 ○; ICD-11 3A50 ○ | CON |
| `cond.g6pd_deficiency` | G6PD deficiency | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) D55.0 ○ | CON |
| `cond.iron_deficiency_anaemia` | Iron deficiency anaemia | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) D50 ○ | CON |
| `cond.undernutrition_current` | Undernutrition (current) | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) E40-E46 ○ | CLS |
| `cond.masld` | Metabolic dysfunction-associated steatotic liver disease *(v1.1)* | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) K76.0 ○; ICD-11 DB92 ○ | STR |
| `cond.dm_retinopathy` | Diabetic retinopathy | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) H36.0 ○; ICD-11 9B71.0 ○ | STR |
| `cond.dm_neuropathy` | Diabetic neuropathy | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) G63.2 ○ | STR |
| `cond.dm_kidney_disease` | Diabetic kidney disease | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) N08.3 ○ | STR |
| `cond.dm_foot_ulcer` | Diabetic foot ulcer | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) L97 ○ | STR |
| `cond.amputation_history` | Lower-limb amputation (history) | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) Z89 ○ | STR |
| `fh.diabetes` | Family history of diabetes | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) Z83.3 ○ | SUS CLS |
| `fh.premature_cvd` | Family history of premature cardiovascular disease | condition | clinicalStatus, verificationStatus, assertedBy, subjectRelation | ICD-10 (WHO) Z82.4 ○ | STR |

#### Pregnancy

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `preg.status` | Pregnancy status | coded: pregnant / postpartum / not_pregnant / unknown | episodeId | LOINC 82810-3 ○ | SUS CON CLS |
| `preg.gestational_age` | Gestational age | quantity, `d` | episodeId, basis, asOf | LOINC 18185-9 ○ | CON CLS |
| `preg.edd` | Estimated date of delivery | date | episodeId, basis | LOINC 11778-8 ○ | CON |
| `preg.outcome` | Pregnancy outcome | coded: live_birth / stillbirth / miscarriage / termination / ectopic / unknown | episodeId, date | to map | CLS |
| `preg.birth_weight` | Birth weight of baby | quantity, `g` | episodeId | LOINC 8339-4 ○ | SUS |

#### Social and risk-factor history

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `soc.tobacco` | Tobacco use | coded: never / former / current_daily / current_non_daily / smokeless_current / unknown | none | LOINC 72166-2 ○ | SUS STR |
| `soc.alcohol` | Alcohol use | coded: none / within_limits / above_limits / unknown | none | to map | STR |
| `soc.physical_activity` | Physical activity | coded: meets_recommended / below_recommended / unknown | none | to map | SUS |
| `soc.fruit_veg_daily` | Eats vegetables or fruit every day | boolean | none | to map | SUS |

#### Care processes

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `proc.foot_exam` | Comprehensive foot examination | procedure | outcome | to map | STR ACT |
| `proc.eye_screen` | Retinal screening | procedure | outcome | to map | STR ACT |
| `proc.dsme_session` | Diabetes self-management education session | procedure | outcome | to map | ACT |
| `proc.nutrition_counselling` | Nutrition counselling | procedure | outcome | to map | ACT |
| `proc.blood_transfusion` | Blood transfusion | procedure | outcome | to map | CON |
| `proc.dialysis` | Dialysis | procedure | outcome | to map | CON STR |
| `proc.pancreatectomy` | Pancreatic surgery (history) | procedure | outcome | to map | SUS CLS |
| `proc.ecg` | Electrocardiogram *(v1.1)* | procedure | outcome | to map | STR |

#### Demographics

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `demo.date_of_birth` | Date of birth | date | precision | to map | CORE |
| `demo.sex_at_birth` | Sex recorded for physiological calculations | coded: female / male / intersex / unknown | none | to map | CORE |

#### Context

| Concept | Meaning | Value | Context required | External codes | Lanes |
|---|---|---|---|---|---|
| `ctx.facility_level` | Facility level | coded: catalogue | none | to map | ACT |
| `ctx.care_setting` | Care setting | coded: opd / ipd / ed / antenatal / hiv_clinic / tb_clinic / ncd_clinic / community_outreach / telehealth / home | none | to map | SUS ACT |
| `ctx.facility_capability` | Facility capability | coded: catalogue | capabilityStatus, updatedAt | to map | ACT |

#### Drug class tags

Medication facts carry these tags. The NCD engine reads tags, never doses.

| Tag | Meaning | ATC | Lanes | Note |
|---|---|---|---|---|
| `glucose_lowering_any` | Any glucose-lowering medicine | A10* ○ | SUS CLS | Reconciliation: on a glucose-lowering medicine with no diabetes on the problem list. |
| `insulin` | Insulins and analogues | A10A* ○ | CLS STR |  |
| `metformin` | Metformin | A10BA02 ○ | CLS STR |  |
| `sulfonylurea` | Sulfonylureas | A10BB* ○ | STR | Hypoglycaemia-risk context. |
| `dpp4_inhibitor` | DPP-4 inhibitors | A10BH* ○ | STR |  |
| `sglt2_inhibitor` | SGLT2 inhibitors | A10BK* ○ | STR ACU | Ketoacidosis with near-normal glucose: context for acute routing. |
| `glp1_ra` | GLP-1 receptor agonists | A10BJ* ○ | STR |  |
| `thiazolidinedione` | Thiazolidinediones | A10BG* ○ | STR |  |
| `dolutegravir` | Dolutegravir-containing regimens *(restricted)* | J05AJ03 ◐; J05AR27 ✓; other DTG fixed-dose combinations ○ | SUS CLS | Ugandan signal: new-onset hyperglycaemia on DTG. |
| `boosted_protease_inhibitor` | Ritonavir-boosted protease inhibitors *(restricted)* | J05AE* ○; J05AR10 ○ | SUS |  |
| `systemic_glucocorticoid` | Systemic glucocorticoids | H02AB* ○ | SUS CLS | Topical and inhaled routes excluded unless a signed rule says otherwise. Routes: oral, iv, im. |
| `antipsychotic_metabolic` | Antipsychotics with metabolic risk *(restricted)* | N05AH03 ○; N05AH02 ○; N05AH04 ○; N05AX08 ○; N05AA01 ○ | SUS |  |
| `thiazide` | Thiazide and thiazide-like diuretics | C03AA* ○; C03BA04 ○ | SUS |  |
| `calcineurin_inhibitor` | Calcineurin inhibitors | L04AD* ○ | SUS |  |
| `erythropoiesis_stimulating` | Erythropoiesis-stimulating agents | B03XA* ○ | CON | HbA1c validity modifier. |
| `dapsone` | Dapsone | J04BA02 ○ | CON | Haemolysis: HbA1c validity modifier. |
| `ace_inhibitor` | ACE inhibitors | C09A* ○; C09B* ○ | STR |  |
| `arb` | Angiotensin receptor blockers | C09C* ○; C09D* ○ | STR |  |
| `statin` | Statins | C10AA* ○; C10B* ○ | STR |  |
| `aspirin_antiplatelet` | Aspirin (antiplatelet) | B01AC06 ○ | STR |  |
| `antihypertensive_any` | Any blood-pressure-lowering medicine | C02* ○; C03* ○; C07* ○; C08* ○; C09* ○ | SUS STR | Risk-score item. |

#### Facility capabilities

Each capability is recorded per facility as `available`, `intermittent` or `unavailable`.

| Capability | Meaning | Capability | Meaning |
|---|---|---|---|
| `cap.glucometer` | Capillary glucose meter | `cap.hb_phenotype` | Haemoglobin phenotype test |
| `cap.lab_plasma_glucose` | Laboratory plasma glucose | `cap.g6pd` | G6PD test |
| `cap.ogtt` | Oral glucose tolerance test | `cap.monofilament` | 10 g monofilament |
| `cap.hba1c_poc` | HbA1c point-of-care analyser | `cap.tuning_fork_128` | 128 Hz tuning fork |
| `cap.hba1c_lab` | HbA1c laboratory assay | `cap.fundoscopy` | Ophthalmoscopy |
| `cap.fructosamine` | Fructosamine | `cap.retinal_camera` | Retinal camera |
| `cap.blood_ketone_meter` | Blood ketone meter | `cap.ecg` | ECG |
| `cap.urine_dipstick` | Urine dipstick | `cap.insulin_initiation` | Insulin initiation |
| `cap.creatinine` | Creatinine | `cap.insulin_cold_chain` | Insulin cold chain |
| `cap.uacr_quantitative` | Urine ACR, quantitative | `cap.nutrition_service` | Nutrition service |
| `cap.uacr_semiquantitative` | Urine ACR, semi-quantitative strip | `cap.diabetes_educator` | Diabetes self-management education |
| `cap.lipid_panel` | Lipid panel | `cap.endocrine_clinic` | Endocrine or diabetes specialist clinic |
| `cap.electrolytes` | Electrolytes | `cap.paediatric_clinic` | Paediatric specialist clinic |
| `cap.blood_gas` | Blood gas | `cap.hyperglycaemic_emergency_care` | Inpatient care for hyperglycaemic emergencies |
| `cap.haemoglobin` | Haemoglobin |  |  |

## [09] External codes: rules and sources

- **WHO ICD-10, not ICD-10-CM.** The roadmap codes EMR diagnoses in ICD-10; use the WHO edition. The difference is material here: WHO ICD-10 has E12 for malnutrition-related diabetes, which ICD-10-CM does not.
- **ICD-11 alongside.** ICD-11 has been in effect at WHO since January 2022 and national guidelines will move to it, so every condition concept carries an ICD-11 mapping now. ICD-11 post-coordination is supported: diabetic ketoacidosis in type 2 diabetes is `5A22.0/5A11`.
- **CIEL for interoperability.** UgandaEMR is built on OpenMRS and driven by a concept dictionary. CIEL, distributed through Open Concept Lab, is OpenMRS's standard dictionary and maps to ICD-10 (WHO), LOINC and SNOMED CT. Adding CIEL IDs to MedSync concepts is the cheapest route to exchanging data with public facilities. Confirm which dictionary UgandaEMR ships before committing.
- **No code is used on the strength of this document alone.** ◐ and ○ codes are verified during Phase 0 of the EMR build against icd.who.int, loinc.org and the WHO Collaborating Centre ATC index. A code that fails verification is removed, never guessed.

Sources (checked 26 Sep 2026):

| Claim | Source |
|---|---|
| Glucose LOINC codes | loinc.org/14743-9; gematik HDDT glucose value set (LOINC 2.82); VSAC blood-glucose value set |
| HbA1c LOINC 4548-4 (NGSP) and 59261-8 (IFCC) | loinc.org/4548-4 |
| eGFR CKD-EPI 2021 LOINC 98979-8 and 98980-6; adults 18 and over | loinc.org/98979-8 |
| NGSP–IFCC master equation | ngsp.org/ifcc.asp |
| ICD-11 5A10–5A14, 5A13.x, 5A20–5A22, 5A40.x, JA63.x, MA18.0, 5A41 | WHO ICD-11 MMS v2026-01, via the findacode.com and autoicdapi.com mirrors |
| WHO ICD-10 E10–E14 and O24.2 | secondary table (arXiv 2106.11360) |
| ATC J05AR27 (TLD) | WHO Prequalification public assessment report HA755 |
| ATC J05AJ03 (dolutegravir) | MIMS product listing (secondary) |
| HbA1c validity conditions | ADA Standards of Care in Diabetes 2026, sections 2 and 6 (Diabetes Care 49, Suppl 1) |
| Creatinine equations in Malawi, South Africa and Uganda | Fabian J et al., Lancet Glob Health 2022;10:e1159–69 (ARK consortium) |
| Supabase RLS performance practice | supabase.com/docs/guides/database/postgres/row-level-security |
| UgandaEMR on OpenMRS; CIEL via Open Concept Lab | emrportal.mets.or.ug; OpenMRS wiki |

## [10] What the EMR prompt must implement

Carry this checklist into PROMPT-ENCOUNTER-EMR as its data phase.

1. The tables in 3.1 with insert-only triggers, versioning, the `*_current` views and the indexes in 3.4.
2. RLS on every table with the probe suite (select, insert, update and delete for each role), using the shared access predicate.
3. `lib/units` implementing [05], with at least 30 known-pair tests (for example 126 mg/dL ↔ 7.0 mmol/L glucose; 6.5 % ↔ 48 mmol/mol HbA1c).
4. Seed import of `clinical-fact-concepts.v1.json`, plus a CI check that no candidate code is ever exported.
5. Write paths (Edge Functions) with device defaults, the fasting chip, unit-mismatch prompts, the plausibility mechanism and duplicate detection.
6. `lib/facts`: projections and Zod schemas for every fact kind, generated refinements from the catalogue, and `loadFactSnapshot` with manifests, as-of and quarantine.
7. Tests with numbers reported at the gate: projection round-trip for all 145 concepts; as-of reproducibility (the same `asOf` gives the same hash); correction propagation; the quarantine path; loader p95 at 2,000 facts.
8. `facility_capabilities` in the hospital setup operating profile.
9. Triage and resus vital signs written to (or projected into) `observations`, so each patient has one vital-signs series.

## [11] Decisions for GATE A

| ID | Decision | Recommendation |
|---|---|---|
| D-CFC-01 | MedSync concept IDs are primary; external codes are verified mappings | Yes |
| D-CFC-02 | One insert-only `observations` table for labs, vital signs, anthropometry, findings, examination and history; CGM streams kept separate | Yes |
| D-CFC-03 | Versioned, bitemporal clinical tables with as-of snapshots | Yes |
| D-CFC-04 | Structured values in plaintext under RLS and at-rest encryption; identifiers and free text application-encrypted | Yes, with an ADR |
| D-CFC-05 | Canonical units as in [05] | Yes |
| D-CFC-06 | eGFR computed by MedSync with one signed equation: interim CKD-EPI 2021 (creatinine) for adults with the ARK caveat displayed; final choice in the dossier | Yes (interim) |
| D-CFC-07 | Trust levels T1–T4; every rule declares its minimum | Yes |
| D-CFC-08 | Location excluded from the v1 read contract | Yes |
| D-CFC-09 | Restricted classes: HIV and antiretrovirals, metabolic antipsychotics, TB, sexual and reproductive findings. Also decide whether pregnancy is restricted for patients under 18. | Yes; restrict pregnancy for minors |
| D-CFC-10 | WHO ICD-10 plus ICD-11 now; CIEL mapping for UgandaEMR interoperability | Yes |
| D-CFC-11 | The 28 finding concepts join the shared token catalogue, owned by the differential engine | Yes |
| D-CFC-12 | Imprecise dates of birth handled conservatively at age thresholds | Yes |
| D-CFC-13 | `facility_capabilities` with an intermittent status, maintained in hospital setup | Yes |
| D-CFC-14 | Unit-mismatch triggers as proposed in [06] | Sign or amend the values |
| D-CFC-15 | Plausibility bounds per quantity concept, signed in the dossier | Yes |

## [12] Stage 1 self-review

| Check | Result |
|---|---|
| Engine-first law: tables, RLS and tests precede any surface | Pass. [10] makes RLS probes and tests part of the data phase. |
| No clinical threshold in this document | Pass after revision: numeric definitions (fasting duration, glucose loss per hour in unspun samples) were removed from 4.1 and replaced by dossier references. Remaining numbers are unit conversions, a meter-limit example and engineering budgets. |
| Every external code carries a verification status | Pass. 157 codes: 13 verified at primary sources, 28 through a mirror or secondary source, 116 candidates. |
| Interlinks: EMR, monitoring, triage, resus, differential engine, hospital setup, prescribing, CGM ingestion | Pass. Resus manual labs, triage vital signs and the device-ready telemetry contract are handled explicitly. |
| DPPA 2019: minimality, purpose limitation, sensitive data | Pass (C9, C10, C12, D-CFC-04, D-CFC-09). |
| Security model: RLS everywhere, Edge Function writes, `aal2`, append-only | Pass. One deliberate refinement (D-CFC-04) is raised for an ADR rather than assumed. |
| Local-first constraints: Node 22, pnpm, `prisma dev`, the PrismaClient singleton | Pass. No new infrastructure. |
| Ugandan realities: estimated ages, stock-outs, unspun samples, haemoglobinopathies, dolutegravir, shared phones | Pass. |
| Revisions made during review | A database view unifying all clinical tables was replaced by typed projections in the loader (a view cannot carry per-concept typing or quarantine). CGM readings were moved out of `observations` on volume grounds. Unit-mismatch rules changed from reject to confirm. The WHO-versus-CM ICD-10 rule was added after checking that E12 exists only in the WHO edition. |
