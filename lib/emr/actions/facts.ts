"use server";

import { z } from "zod";

import * as facts from "@/lib/emr/write/facts";
import { runEmrWrite } from "@/lib/emr/write/orders";
import { ENUMS } from "@/lib/facts/catalogue.generated";

/**
 * Chart actions (PROMPT §8): Zod → requireEmrActor(surface) → EMR_V1 for the hospital → one
 * transaction with the access check → lib/emr/write/facts.ts. Idempotent on the client key; warnings
 * (possible duplicate, uncoded allergen, active allergy outranks NKDA…) are returned, never thrown.
 */

const surface = z.enum(["doctor", "nurse", "clinician"]);
const uuid = z.uuid();
const clientKey = z.string().trim().min(8).max(120);
const reason = {
  reasonCode: z.string().trim().max(60).optional(),
  reasonText: z.string().trim().max(1000).optional(),
};
const base = { surface, patientUserId: uuid, clientKey };
const encounterId = uuid.nullish();
const at = z.coerce.date();
const context = z.record(
  z.string().max(40),
  z.union([z.string().max(200), z.number(), z.boolean()]),
);

const Value = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("quantity"),
    value: z.union([z.number(), z.string().max(40)]),
    unit: z.string().max(30).optional(),
  }),
  z.object({ type: z.literal("coded"), code: z.string().max(60) }),
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  z.object({ type: z.literal("presence"), presence: z.enum(["present", "absent", "unknown"]) }),
]);

const Observation = z.object({
  conceptId: z.string().max(80),
  effectiveAt: at.optional(),
  value: Value,
  unitConfirmed: z.boolean().optional(),
  plausibilityConfirmed: z.boolean().optional(),
  context: context.optional(),
  specimen: z.enum(ENUMS.specimen).optional(),
  calibration: z.enum(ENUMS.calibration).optional(),
  fastingState: z.enum(ENUMS.fastingState).optional(),
  method: z.string().max(80).optional(),
  pointOfCare: z.boolean().optional(),
  deviceId: uuid.optional(),
  note: z.string().max(2000).optional(),
  restricted: z.boolean().optional(),
});

const RecordObservations = z.object({
  ...base,
  encounterId,
  source: z.enum(["clinician", "poc_staff", "patient_reported"]).optional(),
  observations: z.array(Observation).min(1).max(50),
});

const RecordAllergy = z.object({
  ...base,
  encounterId,
  supersedesId: uuid.optional(),
  substance: z
    .object({
      kind: z.enum(["drug_ingredient", "drug_class", "food", "environmental", "other"]).optional(),
      code: z.string().trim().max(80).optional(),
      text: z.string().trim().max(200).optional(),
    })
    .optional(),
  category: z.enum(["medication", "food", "environment", "biologic"]).optional(),
  allergyType: z.enum(["allergy", "intolerance"]).optional(),
  criticality: z.enum(["low", "high", "unable_to_assess"]).optional(),
  manifestations: z
    .array(
      z.enum([
        "rash",
        "urticaria",
        "angioedema",
        "anaphylaxis",
        "bronchospasm",
        "sjs_ten",
        "other",
      ]),
    )
    .max(7)
    .optional(),
  severity: z.enum(["mild", "moderate", "severe"]).optional(),
  clinicalStatus: z.enum(["active", "inactive", "resolved"]).optional(),
  verification: z.enum(["unconfirmed", "confirmed", "refuted"]).optional(),
  onset: context.optional(),
  informant: z.enum(["patient", "relative", "record", "clinician_observed"]).optional(),
  effectiveAt: at.optional(),
  ...reason,
});

const AssertAllergyStatus = z.object({
  ...base,
  encounterId,
  assertion: z.enum(["no_known_drug_allergies", "unable_to_assess"]),
  assertedAt: at.optional(),
});

const Condition = {
  ...base,
  termId: uuid.optional(),
  text: z.string().trim().max(300).optional(),
  subjectRelation: z
    .enum(["self", "mother", "father", "sibling", "child", "other_first_degree", "second_degree"])
    .optional(),
  assertedBy: z.enum(["clinician", "patient_reported", "referral_document"]).optional(),
  onset: context.optional(),
  effectiveAt: at.optional(),
};
const RecordProblem = z.object({
  ...Condition,
  encounterId,
  clinicalStatus: z.enum(["active", "recurrence", "relapse", "inactive", "remission"]).optional(),
  verification: z.enum(["unconfirmed", "provisional", "confirmed"]).optional(),
});
const RecordEncounterDiagnosis = z.object({
  ...Condition,
  encounterId: uuid,
  verification: z.enum(["provisional", "confirmed", "differential"]).optional(),
  rank: z.enum(["primary", "secondary"]).optional(),
  addToProblemList: z.boolean().optional(),
});
const UpdateProblemStatus = z.object({
  ...base,
  id: uuid,
  clinicalStatus: z
    .enum(["active", "recurrence", "relapse", "inactive", "remission", "resolved"])
    .optional(),
  verification: z
    .enum(["unconfirmed", "provisional", "differential", "confirmed", "refuted"])
    .optional(),
  rank: z.enum(["primary", "secondary"]).optional(),
  abatementAt: at.optional(),
  ...reason,
});

const date = z.iso.date();
const MedicationLine = z.object({
  drugCode: z.string().trim().max(80).optional(),
  drugText: z.string().trim().max(200).optional(),
  productKind: z.enum(["medicine", "otc", "herbal_traditional"]).optional(),
  classTags: z.array(z.string().max(60)).max(10).optional(),
  atcCode: z.string().max(10).optional(),
  medicationStatus: z.enum(["active", "completed", "stopped", "on_hold", "intended", "unknown"]),
  periodStart: date.optional(),
  periodEnd: date.optional(),
  route: z.enum(["oral", "iv", "im", "sc", "inhaled", "topical", "other"]).optional(),
  medicationSource: z.enum([
    "prescribed_here",
    "dispensed_here",
    "patient_reported",
    "external_record",
  ]),
});
const RecordMedicationStatements = z.object({
  ...base,
  encounterId,
  statements: z.array(MedicationLine).min(1).max(40),
});
const ConfirmCurrentMedicines = z.object({
  ...base,
  encounterId: uuid,
  items: z
    .array(
      z.object({
        id: uuid,
        reconciliation: z.enum(["continued", "stopped", "changed"]),
        ...reason,
      }),
    )
    .min(1)
    .max(40),
});

const RecordPregnancy = z.object({
  ...base,
  encounterId,
  supersedesId: uuid.optional(),
  pregnancyState: z.enum(["pregnant", "postpartum", "not_pregnant", "unknown"]),
  lnmp: date.nullish(),
  lnmpCertainty: z.enum(["sure", "unsure"]).nullish(),
  edd: date.nullish(),
  eddBasis: z.enum(["lmp", "ultrasound", "fundal_height", "unknown"]).nullish(),
  gravida: z.number().int().min(0).max(40).nullish(),
  parity: z.number().int().min(0).max(40).nullish(),
  deliveredAt: at.nullish(),
  outcome: z
    .enum(["live_birth", "stillbirth", "miscarriage", "termination", "ectopic", "unknown"])
    .nullish(),
  birthWeightGrams: z.number().int().positive().max(10_000).nullish(),
  effectiveAt: at.optional(),
});

const RecordProcedure = z.object({
  ...base,
  encounterId,
  conceptId: z.string().max(80).optional(),
  text: z.string().trim().max(300).optional(),
  outcome: z.enum(["completed", "not_done", "declined", "unable"]),
  laterality: z.enum(["left", "right", "bilateral"]).optional(),
  noteId: uuid.optional(),
  effectiveAt: at.optional(),
});

const MarkFactEnteredInError = z.object({
  ...base,
  surface: z.enum(["doctor", "nurse", "clinician", "lab"]),
  kind: z.enum([
    "observation",
    "condition",
    "medication",
    "pregnancy",
    "procedure",
    "allergy",
    "allergy_assertion",
  ]),
  id: uuid,
  ...reason,
});

export async function recordObservations(raw: unknown) {
  return runEmrWrite(RecordObservations, raw, facts.recordObservations);
}
export async function recordAllergy(raw: unknown) {
  return runEmrWrite(RecordAllergy, raw, facts.recordAllergy);
}
export async function assertAllergyStatus(raw: unknown) {
  return runEmrWrite(AssertAllergyStatus, raw, facts.assertAllergyStatus);
}
export async function recordProblem(raw: unknown) {
  return runEmrWrite(RecordProblem, raw, facts.recordProblem);
}
export async function updateProblemStatus(raw: unknown) {
  return runEmrWrite(UpdateProblemStatus, raw, facts.updateProblemStatus);
}
export async function recordEncounterDiagnosis(raw: unknown) {
  return runEmrWrite(RecordEncounterDiagnosis, raw, facts.recordEncounterDiagnosis);
}
export async function recordMedicationStatements(raw: unknown) {
  return runEmrWrite(RecordMedicationStatements, raw, facts.recordMedicationStatements);
}
export async function confirmCurrentMedicines(raw: unknown) {
  return runEmrWrite(ConfirmCurrentMedicines, raw, facts.confirmCurrentMedicines);
}
export async function recordPregnancy(raw: unknown) {
  return runEmrWrite(RecordPregnancy, raw, facts.recordPregnancy);
}
export async function recordProcedure(raw: unknown) {
  return runEmrWrite(RecordProcedure, raw, facts.recordProcedure);
}
export async function markFactEnteredInError(raw: unknown) {
  return runEmrWrite(MarkFactEnteredInError, raw, facts.markFactEnteredInError);
}
