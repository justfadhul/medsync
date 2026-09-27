/**
 * The Clinical Fact Contract read side (MS-DATA-CFC-001 §2, amended by cfc-v1.1-addendum A1).
 *
 * The CFC field names stay on the fact (`patientId`, `tenantId`); only provenance speaks the repo's
 * language (`table`, `rowId`). `patientId` is `patient_user_id`, `tenantId` is `hospital_id`.
 * Engines read these types, never source tables (C1).
 */
import type { ConceptId, DrugClassTagId } from "./catalogue.generated";

/**
 * Two fact kinds have no catalogue concept: a medicine is identified by its drug and class tags, an
 * allergy by its substance. They are requested in a manifest (C10) under these pseudo-concepts.
 */
export type FactConcept = ConceptId | "medication" | "allergy";

export type FactKind =
  | "observation"
  | "finding"
  | "condition"
  | "medication"
  | "pregnancy"
  | "procedure"
  | "demographic"
  | "context"
  | "allergy";
/** T4 lab final | T3 staff point-of-care or clinician exam | T2 validated patient device | T1 patient-typed or unverified import */
export type Trust = 1 | 2 | 3 | 4;
export type FactSource =
  | "lab"
  | "poc_staff"
  | "clinician"
  | "patient_reported"
  | "device_synced"
  | "imported";
export type FactStatus =
  | "preliminary"
  | "final"
  | "amended"
  | "corrected"
  | "entered_in_error"
  | "cancelled";
export type Sensitivity = "standard" | "restricted";

export type Interpretable = { ok: true } | { ok: false; missing: string[] };

export interface FactEnvelope {
  /** Deterministic: `${table}:${rowId}` (+ `:${component}` for multi-part rows). */
  id: string;
  /** Stable across versions of the same item. */
  logicalId: string;
  /** patient_user_id: pseudonymous; never an MRN or a name. */
  patientId: string;
  /** hospital_id: the facility that recorded it. */
  tenantId: string;
  kind: FactKind;
  concept: FactConcept;
  effective: { at: string } | { start: string; end?: string };
  /** Knowledge time (C8). */
  recordedAt: string;
  status: FactStatus;
  source: FactSource;
  trust: Trust;
  sensitivity: Sensitivity;
  provenance: {
    table: string;
    rowId: string;
    version: number;
    encounterId?: string;
    orderId?: string;
    authorId?: string;
    authorCadre?: string;
    facilityLevel?: string;
    deviceId?: string;
    labId?: string;
    derivedFrom?: string[];
    formula?: { id: string; version: string };
  };
  /** C2: a fact missing required context is still returned, marked non-interpretable. */
  interpretable: Interpretable;
}

export type Comparator = "<" | "<=" | ">" | ">=";

export type ObservationValue =
  | {
      type: "quantity";
      value: number;
      unit: string;
      canonical: { value: number; unit: string };
      comparator?: Comparator;
    }
  | { type: "coded"; code: string }
  | { type: "boolean"; value: boolean };
// Free text is never a fact: it is stored encrypted and no rule can read it.

export type Specimen =
  | "venous_plasma"
  | "venous_serum"
  | "venous_whole_blood"
  | "capillary_whole_blood"
  | "arterial_blood"
  | "urine_spot"
  | "urine_first_morning"
  | "urine_24h"
  | "interstitial_fluid"
  | "unknown"
  | "sputum"; // v1.1 enum extension (STOP 1)

export type Container =
  | "fluoride_oxalate"
  | "serum_plain"
  | "lithium_heparin"
  | "edta"
  | "capillary_direct"
  | "unknown"
  | "sodium_citrate"
  | "blood_culture_bottle"
  | "sterile_container"; // the last three: v1.1 enum extension (STOP 1)

export type QualityFlag =
  | "haemolysed"
  | "lipaemic"
  | "icteric"
  | "clotted"
  | "delayed_processing"
  | "qc_failed"
  | "meter_error";

/** Required fields depend on the concept; all optional here and enforced by refinements.ts. */
export interface ObservationContext {
  specimen?: Specimen;
  calibration?: "plasma_equivalent" | "whole_blood" | "unknown";
  /** unknown is never read as fasting */
  fastingState?: "fasting" | "non_fasting" | "unknown";
  fastingHours?: number;
  challenge?:
    | { type: "ogtt_75g"; minutesPostLoad: number }
    | { type: "meal"; minutesPostMeal: number };
  method?: string;
  certification?: "ngsp" | "ifcc" | "ngsp_and_ifcc" | "none" | "unknown";
  idmsTraceable?: boolean | "unknown";
  pointOfCare?: boolean;
  deviceId?: string;
  labId?: string;
  container?: Container;
  processingDelayMinutes?: number;
  testPurpose?:
    | "screening"
    | "diagnostic"
    | "monitoring"
    | "acute_assessment"
    | "antenatal_screening";
  qualityFlags?: QualityFlag[];
  referenceRange?: { low?: number; high?: number; unit: string; source: "lab" | "medsync" };
  labInterpretation?: "L" | "H" | "LL" | "HH" | "N" | "A";
  // Blood pressure
  position?: "sitting" | "standing" | "supine";
  arm?: "left" | "right";
  cuffSize?: "small_adult" | "adult" | "large_adult" | "child";
  device?: "validated_automated" | "aneroid" | "mercury" | "unknown";
  setting?: "clinic" | "home" | "ambulatory";
  readingSetId?: string;
  readingIndex?: number;
  // Anthropometry, derived values, CGM summaries, examination
  measurement?: "measured" | "reported" | "estimated";
  posture?: "standing" | "recumbent_length";
  protocol?: string;
  formula?: { id: string; version: string };
  windowDays?: number;
  sensorWearPercent?: number;
  laterality?: "left" | "right" | "bilateral";
  /** Concept-specific extras (e.g. pain `scale`, SpO2 `oxygenSupport`). */
  qualifiers?: Record<string, string | number | boolean>;
}

export interface ObservationFact extends FactEnvelope {
  kind: "observation";
  value: ObservationValue;
  context: ObservationContext;
}

export interface FindingFact extends FactEnvelope {
  kind: "finding";
  /** A clinician symptom_catalog code, or the concept id (D-CFC-11 [H]). */
  token: string;
  /** A question never asked produces no fact at all (C3). */
  presence: "present" | "absent" | "unknown";
  elicitedBy: "history" | "examination" | "patient_self_report";
  onset?: string | { approxDaysAgo: number };
  durationDays?: number;
  severity?: "mild" | "moderate" | "severe";
  laterality?: "left" | "right" | "bilateral";
}

export interface ConditionFact extends FactEnvelope {
  kind: "condition";
  clinicalStatus: "active" | "recurrence" | "relapse" | "inactive" | "remission" | "resolved";
  verification:
    | "unconfirmed"
    | "provisional"
    | "differential"
    | "confirmed"
    | "refuted"
    | "entered_in_error";
  assertedBy: "clinician" | "patient_reported" | "referral_document" | "engine_proposal_accepted";
  /** Family history lives here. */
  subject:
    | "self"
    | "mother"
    | "father"
    | "sibling"
    | "child"
    | "other_first_degree"
    | "second_degree";
  onset?: string | { ageYears: number };
  abatement?: string;
  stage?: { system: string; value: string };
  codes: { icd10?: string; icd11?: string; ciel?: string };
}

export interface MedicationFact extends FactEnvelope {
  kind: "medication";
  /** Formulary drugKey; the name as recorded for a legacy row; "" when uncoded. */
  drug: string;
  atc?: string;
  classTags: DrugClassTagId[];
  /** CFC §2 names this `status`, which collides with the envelope's FactStatus (a type error as
   *  written). Renamed to the column's name, medication_status; recorded as a CFC erratum. */
  medicationStatus: "active" | "completed" | "stopped" | "on_hold" | "intended" | "unknown";
  period: { start?: string; end?: string };
  route?: "oral" | "iv" | "im" | "sc" | "inhaled" | "topical" | "other";
  medicationSource: "prescribed_here" | "dispensed_here" | "patient_reported" | "external_record";
  // Dose is deliberately absent. Dosing belongs to the prescribing engine; no engine here reads it.
}

export interface PregnancyFact extends FactEnvelope {
  kind: "pregnancy";
  episodeId: string;
  state: "pregnant" | "postpartum" | "not_pregnant" | "unknown";
  gestation?: {
    days: number;
    basis: "lmp" | "ultrasound" | "fundal_height" | "unknown";
    asOf: string;
  };
  edd?: string;
  deliveredAt?: string;
  outcome?: "live_birth" | "stillbirth" | "miscarriage" | "termination" | "ectopic" | "unknown";
  birthWeightGrams?: number;
}

export interface ProcedureFact extends FactEnvelope {
  kind: "procedure";
  outcome: "completed" | "not_done" | "declined" | "unable";
  resultFactIds?: string[];
}

export interface DemographicFact extends FactEnvelope {
  kind: "demographic";
  dateOfBirth: { value: string; precision: "day" | "month" | "year" | "estimated" };
  /** Physiological calculations only; not an identity field. */
  sexAtBirth: "female" | "male" | "intersex" | "unknown";
}

export type CareSetting =
  | "opd"
  | "ipd"
  | "ed"
  | "antenatal"
  | "hiv_clinic"
  | "tb_clinic"
  | "ncd_clinic"
  | "community_outreach"
  | "telehealth"
  | "home";

export interface ContextFact extends FactEnvelope {
  kind: "context";
  facilityLevel: string;
  capabilities: Array<{
    id: string;
    status: "available" | "intermittent" | "unavailable";
    updatedAt: string;
  }>;
  /** Deviation from CFC §2 (required there): no source records a care setting for every context,
   *  so it is absent rather than guessed; the ctx.care_setting fact always carries it. */
  setting?: CareSetting;
}

/** cfc-v1.1-addendum A1. Entered in error lives in the envelope status, not in `verification`. */
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
  verification: "unconfirmed" | "confirmed" | "refuted";
  informant: "patient" | "relative" | "record" | "clinician_observed" | "resus_ample_migration";
  /** True when substance.code is absent. */
  matchedByNameOnly: boolean;
}

/** An NKDA / unable-to-assess row (allergy_status_assertions), the input AllergyStatus resolves from. */
export interface AllergyAssertion {
  id: string;
  patientId: string;
  tenantId: string;
  state: "no_known_drug_allergies" | "unable_to_assess";
  assertedBy: string;
  assertedAt: string;
  recordedAt: string;
  status: "final" | "entered_in_error";
  supersedesId?: string;
}

export type AllergyStatus =
  | { state: "listed"; allergies: AllergyFact[] }
  | { state: "no_known_drug_allergies"; assertedBy: string; assertedAt: string }
  | { state: "unable_to_assess"; assertedBy: string; assertedAt: string }
  | { state: "not_recorded" };

export type ClinicalFact =
  | ObservationFact
  | FindingFact
  | ConditionFact
  | MedicationFact
  | PregnancyFact
  | ProcedureFact
  | DemographicFact
  | ContextFact
  | AllergyFact;

export interface FactSnapshot {
  patientId: string;
  /** Recorded-time cut-off (C8). */
  asOf: string;
  /** Concepts requested by the pack (C10). */
  manifest: string[];
  /** The current version of each logical item as of asOf. */
  facts: readonly ClinicalFact[];
  /** v1.1: present only when the manifest asks for 'allergy' (AllergyStatus needs them). */
  allergyAssertions?: readonly AllergyAssertion[];
  /** Rows that failed projection (C11). */
  quarantined: number;
  /** SHA-256 of the canonical fact list + asOf + manifest. */
  hash: string;
}
