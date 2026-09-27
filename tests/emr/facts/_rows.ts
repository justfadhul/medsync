/**
 * Synthetic source rows for the pure fact tests: every column the Drizzle row type has, with valid
 * defaults, so a test states only what it is about. Built from the catalogue, never from a clinical
 * value: quantities are 1 in the canonical unit, coded values the first answer.
 */
import type { ConceptDef } from "@/lib/facts/catalogue.generated";
import type { AllergyAssertionRow, AllergyRow } from "@/lib/facts/project/allergy";
import type {
  ConditionRow,
  EncounterDiagnosisRow,
  ProblemListRow,
} from "@/lib/facts/project/condition";
import type { LegacyMedicationRow, MedicationRow } from "@/lib/facts/project/medication";
import type { ObservationRow } from "@/lib/facts/project/observation";
import type { PregnancyRow } from "@/lib/facts/project/pregnancy";
import type { ProcedureRow } from "@/lib/facts/project/procedure";
import type { TriageRow } from "@/lib/facts/project/triage-vitals";

import { CONCEPTS } from "@/lib/facts/catalogue.generated";

export const P = "00000000-0000-4000-8000-00000000000a"; // patient
export const H = "00000000-0000-4000-8000-00000000000b"; // hospital
export const U = "00000000-0000-4000-8000-00000000000c"; // author
export const T0 = new Date("2026-03-01T08:00:00.000Z");
export const T1 = new Date("2026-03-01T09:00:00.000Z");

let n = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

export const def = (id: string) => (CONCEPTS as Record<string, ConceptDef>)[id]!;

/** A valid value per catalogue context key (synthetic; none is a clinical threshold). */
export const CONTEXT_VALUES: Record<string, unknown> = {
  specimen: "venous_plasma",
  fastingState: "fasting",
  calibration: "plasma_equivalent",
  method: "enzymatic",
  certification: "ngsp",
  pointOfCare: false,
  idmsTraceable: true,
  deviceId: "00000000-0000-4000-8000-0000000000dd",
  position: "sitting",
  arm: "left",
  cuffSize: "adult",
  device: "validated_automated",
  setting: "clinic",
  readingSetId: "set-1",
  readingIndex: 1,
  measurement: "measured",
  protocol: "who_steps",
  formula: { id: "lane-formula", version: "1" },
  windowDays: 14,
  sensorWearPercent: 90,
  level: "level_1",
  laterality: "left",
  sitesTested: 10,
  sitesInsensate: 0,
  gradingScale: "icdr",
  elicitedBy: "history",
  site: "finger",
  derivation: "direct",
  unitBasis: "FEU",
  assay: "lane-assay",
  algorithmStep: "test_1",
  kit: "lane-kit",
  antigen: "gad65",
  scale: "nrs_0_10",
  oxygenSupport: "room_air",
  analyte: "I",
  highSensitivity: true,
  modality: "xray",
  bodySite: "chest",
};

/** Context keys that are columns of clinical_observations (the rest go in the jsonb). */
const COLUMN_KEYS: Record<string, keyof ObservationRow> = {
  specimen: "specimen",
  fastingState: "fastingState",
  calibration: "calibration",
  method: "method",
  certification: "certification",
  pointOfCare: "pointOfCare",
  deviceId: "deviceId",
};

export function observationRow(over: Partial<ObservationRow> = {}): ObservationRow {
  const id = over.id ?? uuid();
  return {
    id,
    hospitalId: H,
    patientUserId: P,
    encounterId: null,
    recordedByUserId: U,
    observationKind: "fact",
    numericValue1: null,
    numericValue2: null,
    unit: null,
    painScale: null,
    notes: null,
    recordedAt: T0,
    state: "fact",
    correctedByObservationId: null,
    triageRecordId: null,
    conceptId: null,
    logicalId: id,
    version: 1,
    supersedesId: null,
    category: "laboratory",
    valueType: null,
    valueNum: null,
    valueComparator: null,
    valueUnit: null,
    valueCanonical: null,
    valueCode: null,
    valueBool: null,
    presence: null,
    specimen: null,
    calibration: null,
    fastingState: null,
    challenge: null,
    challengeMinutes: null,
    method: null,
    certification: null,
    pointOfCare: null,
    deviceId: null,
    context: {},
    source: "lab",
    trust: 4,
    status: "final",
    sensitivity: "standard",
    effectiveAt: T0,
    authorCadre: null,
    noteCiphertext: null,
    reportId: null,
    orderId: null,
    entryMode: null,
    clientKey: null,
    createdAt: T1,
    updatedAt: T1,
    ...over,
  };
}

/** A legacy row (concept_id null) as the nurse form, resus mirror or Edge function wrote it. */
export function legacyRow(kind: string, over: Partial<ObservationRow> = {}): ObservationRow {
  return observationRow({
    observationKind: kind,
    state: "active",
    logicalId: null,
    version: null,
    category: null,
    source: null,
    trust: null,
    status: null,
    sensitivity: null,
    effectiveAt: null,
    ...over,
  });
}

/** A valid CFC observation row for `concept`, with every required context key set; `drop` leaves one out. */
export function cfcRowFor(
  concept: string,
  drop?: string,
  over: Partial<ObservationRow> = {},
): ObservationRow {
  const d = def(concept);
  const row = observationRow({ conceptId: concept, valueType: d.valueType });
  const json: Record<string, unknown> = {};
  switch (d.valueType) {
    case "quantity":
      Object.assign(row, { valueNum: "1", valueUnit: d.canonicalUnit, valueCanonical: "1" });
      break;
    case "coded":
    case "ordinal":
      row.valueCode = d.answers![0]!;
      break;
    case "boolean":
      row.valueBool = true;
      break;
    case "presence":
      row.presence = "present";
      break;
  }
  for (const key of d.contextRequired) {
    if (key === drop) continue;
    const col = COLUMN_KEYS[key];
    if (col) (row as Record<string, unknown>)[col] = CONTEXT_VALUES[key];
    else json[key] = CONTEXT_VALUES[key];
  }
  row.context = json;
  if (d.sensitivity === "restricted") row.sensitivity = "restricted";
  // Overrides win; a context override merges into the generated one.
  return { ...row, ...over, context: { ...json, ...(over.context as object | undefined) } };
}

const envelope = () => {
  const id = uuid();
  return {
    id,
    logicalId: id,
    version: 1,
    supersedesId: null,
    hospitalId: H,
    patientUserId: P,
    encounterId: null,
    effectiveAt: T0,
    recordedAt: T1,
    recordedByUserId: U,
    authorCadre: "MEDICAL_OFFICER",
    source: "clinician",
    trust: 3,
    status: "final",
    sensitivity: "standard",
    reasonCode: null,
    reasonCiphertext: null,
    clientKey: null,
  };
};

export function conditionRow(over: Partial<ConditionRow> = {}): ConditionRow {
  return {
    ...envelope(),
    category: "problem_list_item",
    subjectRelation: "self",
    termId: null,
    conceptId: null,
    textCiphertext: null,
    rank: null,
    clinicalStatus: "active",
    verification: "confirmed",
    assertedBy: "clinician",
    onset: null,
    abatementAt: null,
    stage: null,
    icd11Code: null,
    icd10WhoCode: null,
    cielId: null,
    hmisCategoryId: null,
    idsrClass: null,
    ...over,
  };
}

export function medicationRow(over: Partial<MedicationRow> = {}): MedicationRow {
  return {
    ...envelope(),
    drugCode: "metformin",
    drugTextCiphertext: null,
    productKind: "medicine",
    classTags: ["metformin", "glucose_lowering_any"],
    atcCode: null,
    medicationStatus: "active",
    periodStart: "2026-01-01",
    periodEnd: null,
    route: "oral",
    medicationSource: "patient_reported",
    reconciliation: null,
    ...over,
  };
}

export function pregnancyRow(over: Partial<PregnancyRow> = {}): PregnancyRow {
  return {
    ...envelope(),
    pregnancyState: "pregnant",
    lnmp: "2026-01-01",
    lnmpCertainty: "sure",
    edd: "2026-10-08",
    eddBasis: "lmp",
    testObservationId: null,
    gravida: 1,
    parity: 0,
    deliveredAt: T0,
    outcome: "live_birth",
    birthWeightGrams: 3000,
    hyperglycaemia: null,
    ...over,
  };
}

export function procedureRow(over: Partial<ProcedureRow> = {}): ProcedureRow {
  return {
    ...envelope(),
    conceptId: "proc.foot_exam",
    textCiphertext: null,
    outcome: "completed",
    laterality: null,
    noteId: null,
    ...over,
  };
}

export function allergyRow(over: Partial<AllergyRow> = {}): AllergyRow {
  return {
    ...envelope(),
    substanceKind: "drug_ingredient",
    substanceCode: "penicillin",
    substanceTextCiphertext: null,
    category: "medication",
    allergyType: "allergy",
    criticality: "high",
    manifestations: ["anaphylaxis"],
    severity: "severe",
    clinicalStatus: "active",
    verification: "confirmed",
    onset: null,
    informant: "patient",
    legacyRef: null,
    ...over,
  };
}

export function assertionRow(over: Partial<AllergyAssertionRow> = {}): AllergyAssertionRow {
  return {
    id: uuid(),
    hospitalId: H,
    patientUserId: P,
    encounterId: null,
    assertion: "no_known_drug_allergies",
    assertedByUserId: U,
    asserterCadre: "MEDICAL_OFFICER",
    assertedAt: T0,
    recordedAt: T1,
    source: "clinician",
    status: "final",
    supersedesId: null,
    reasonCode: null,
    reasonCiphertext: null,
    legacyRef: null,
    clientKey: null,
    ...over,
  };
}

export function triageRow(snapshot: unknown, over: Partial<TriageRow> = {}): TriageRow {
  return {
    id: uuid(),
    intakeId: null,
    patientUserId: P,
    hospitalId: H,
    departmentId: null,
    ruleset: "adult_news2",
    vitalsSnapshot: snapshot,
    computedLevel: 3,
    computedScore: null,
    computedBreakdown: {},
    assignedLevel: 3,
    overrideDirection: "none",
    overrideReason: null,
    baselineAdjusted: false,
    baselineReason: null,
    lifeThreatFastTracked: false,
    provisional: false,
    triagedByUserId: U,
    triagedAt: T0,
    createdAt: T1,
    updatedAt: T1,
    ...over,
  };
}

export function problemRow(over: Partial<ProblemListRow> = {}): ProblemListRow {
  return {
    id: uuid(),
    patientUserId: P,
    hospitalId: H,
    item: "lane problem text",
    icd10Code: "E11",
    active: true,
    onset: null,
    resolvedAt: null,
    sourceEncounterId: null,
    authoredByUserId: U,
    kind: null,
    status: null,
    linkedTo: null,
    provenance: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function diagnosisRow(over: Partial<EncounterDiagnosisRow> = {}): EncounterDiagnosisRow {
  return {
    id: uuid(),
    encounterId: uuid(),
    patientUserId: P,
    icd10Code: "E11.9",
    text: "lane diagnosis text",
    rank: 1,
    mustNotMiss: false,
    status: "working",
    authoredByUserId: U,
    createdAt: T0,
    ...over,
  };
}

export function legacyMedicationRow(over: Partial<LegacyMedicationRow> = {}): LegacyMedicationRow {
  return {
    id: uuid(),
    encounterId: uuid(),
    patientUserId: P,
    name: "Metformin",
    dose: "500 mg",
    route: "Oral",
    frequency: "BD",
    status: "active",
    source: "clerking",
    authoredByUserId: U,
    createdAt: T0,
    ...over,
  };
}
