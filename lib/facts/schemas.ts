/**
 * Zod schemas mirroring lib/facts/types.ts one-to-one (CFC §2). Structural only: the per-concept
 * rules (required context, answer sets, canonical unit) are layered on in refinements.ts.
 * Objects are strict, so a projection that drifts from the type fails here instead of leaking a
 * stray field to an engine. The `Same<>` checks at the bottom fail the typecheck if a schema and
 * its type disagree.
 */
import type * as T from "./types";
import { z } from "zod";

import { DRUG_CLASS_TAGS, ENUMS } from "./catalogue.generated";

const iso = z.string().min(1);
const tags = Object.keys(DRUG_CLASS_TAGS) as [
  T.MedicationFact["classTags"][number],
  ...T.MedicationFact["classTags"],
];

export const InterpretableSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), missing: z.array(z.string()).min(1) }),
]);

const envelope = {
  id: z.string().min(1),
  logicalId: z.string().min(1),
  patientId: z.string().min(1),
  tenantId: z.string().min(1),
  // Known-concept membership is a refinement (refinements.ts), not structure.
  concept: z.custom<T.FactConcept>((v) => typeof v === "string" && v.length > 0),
  effective: z.union([
    z.strictObject({ at: iso }),
    z.strictObject({ start: iso, end: iso.optional() }),
  ]),
  recordedAt: iso,
  status: z.enum(ENUMS.status),
  source: z.enum(ENUMS.source),
  trust: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  sensitivity: z.enum(ENUMS.sensitivity),
  provenance: z.strictObject({
    table: z.string().min(1),
    rowId: z.string().min(1),
    version: z.number().int().min(1),
    encounterId: z.string().optional(),
    orderId: z.string().optional(),
    authorId: z.string().optional(),
    authorCadre: z.string().optional(),
    facilityLevel: z.string().optional(),
    deviceId: z.string().optional(),
    labId: z.string().optional(),
    derivedFrom: z.array(z.string()).optional(),
    formula: z.strictObject({ id: z.string(), version: z.string() }).optional(),
  }),
  interpretable: InterpretableSchema,
};

const finite = z.number().refine(Number.isFinite, "not finite");

export const ObservationValueSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("quantity"),
    value: finite,
    unit: z.string().min(1),
    canonical: z.strictObject({ value: finite, unit: z.string().min(1) }),
    comparator: z.enum(["<", "<=", ">", ">="]).optional(),
  }),
  z.strictObject({ type: z.literal("coded"), code: z.string().min(1) }),
  z.strictObject({ type: z.literal("boolean"), value: z.boolean() }),
]);

export const ObservationContextSchema = z.strictObject({
  specimen: z.enum(ENUMS.specimen).optional(),
  calibration: z.enum(ENUMS.calibration).optional(),
  fastingState: z.enum(ENUMS.fastingState).optional(),
  fastingHours: finite.optional(),
  challenge: z
    .union([
      z.strictObject({ type: z.literal("ogtt_75g"), minutesPostLoad: finite }),
      z.strictObject({ type: z.literal("meal"), minutesPostMeal: finite }),
    ])
    .optional(),
  method: z.string().min(1).optional(),
  certification: z.enum(ENUMS.certification).optional(),
  idmsTraceable: z.union([z.boolean(), z.literal("unknown")]).optional(),
  pointOfCare: z.boolean().optional(),
  deviceId: z.string().optional(),
  labId: z.string().optional(),
  container: z.enum(ENUMS.container).optional(),
  processingDelayMinutes: finite.optional(),
  testPurpose: z.enum(ENUMS.testPurpose).optional(),
  qualityFlags: z
    .array(
      z.enum([
        "haemolysed",
        "lipaemic",
        "icteric",
        "clotted",
        "delayed_processing",
        "qc_failed",
        "meter_error",
      ]),
    )
    .optional(),
  referenceRange: z
    .strictObject({
      low: finite.optional(),
      high: finite.optional(),
      unit: z.string(),
      source: z.enum(["lab", "medsync"]),
    })
    .optional(),
  labInterpretation: z.enum(["L", "H", "LL", "HH", "N", "A"]).optional(),
  position: z.enum(ENUMS.bpPosition).optional(),
  arm: z.enum(["left", "right"]).optional(),
  cuffSize: z.enum(ENUMS.cuffSize).optional(),
  device: z.enum(ENUMS.bpDevice).optional(),
  setting: z.enum(ENUMS.bpSetting).optional(),
  readingSetId: z.string().min(1).optional(),
  readingIndex: z.number().int().optional(),
  measurement: z.enum(ENUMS.measurement).optional(),
  posture: z.enum(["standing", "recumbent_length"]).optional(),
  protocol: z.string().min(1).optional(),
  formula: z.strictObject({ id: z.string(), version: z.string() }).optional(),
  windowDays: finite.optional(),
  sensorWearPercent: finite.optional(),
  laterality: z.enum(ENUMS.laterality).optional(),
  qualifiers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const ObservationFactSchema = z.strictObject({
  ...envelope,
  kind: z.literal("observation"),
  value: ObservationValueSchema,
  context: ObservationContextSchema,
});

export const FindingFactSchema = z.strictObject({
  ...envelope,
  kind: z.literal("finding"),
  token: z.string().min(1),
  presence: z.enum(ENUMS.presence),
  elicitedBy: z.enum(ENUMS.elicitedBy),
  onset: z.union([iso, z.strictObject({ approxDaysAgo: finite })]).optional(),
  durationDays: finite.optional(),
  severity: z.enum(ENUMS.severity).optional(),
  laterality: z.enum(ENUMS.laterality).optional(),
});

export const ConditionFactSchema = z.strictObject({
  ...envelope,
  kind: z.literal("condition"),
  clinicalStatus: z.enum(ENUMS.clinicalStatus),
  verification: z.enum(ENUMS.verificationStatus),
  assertedBy: z.enum(ENUMS.assertedBy),
  subject: z.enum(ENUMS.subjectRelation),
  onset: z.union([iso, z.strictObject({ ageYears: finite })]).optional(),
  abatement: iso.optional(),
  stage: z.strictObject({ system: z.string(), value: z.string() }).optional(),
  codes: z.strictObject({
    icd10: z.string().optional(),
    icd11: z.string().optional(),
    ciel: z.string().optional(),
  }),
});

export const MedicationFactSchema = z.strictObject({
  ...envelope,
  kind: z.literal("medication"),
  drug: z.string(),
  atc: z.string().optional(),
  classTags: z.array(z.enum(tags)),
  medicationStatus: z.enum(ENUMS.medicationStatus),
  period: z.strictObject({ start: iso.optional(), end: iso.optional() }),
  route: z.enum(ENUMS.route).optional(),
  medicationSource: z.enum(ENUMS.medicationSource),
});

export const PregnancyFactSchema = z.strictObject({
  ...envelope,
  kind: z.literal("pregnancy"),
  episodeId: z.string().min(1),
  state: z.enum(ENUMS.pregnancyState),
  gestation: z
    .strictObject({ days: z.number().int().min(0), basis: z.enum(ENUMS.gestationBasis), asOf: iso })
    .optional(),
  edd: iso.optional(),
  deliveredAt: iso.optional(),
  outcome: z
    .enum(["live_birth", "stillbirth", "miscarriage", "termination", "ectopic", "unknown"])
    .optional(),
  birthWeightGrams: z.number().int().positive().optional(),
});

export const ProcedureFactSchema = z.strictObject({
  ...envelope,
  kind: z.literal("procedure"),
  outcome: z.enum(["completed", "not_done", "declined", "unable"]),
  resultFactIds: z.array(z.string()).optional(),
});

export const DemographicFactSchema = z.strictObject({
  ...envelope,
  kind: z.literal("demographic"),
  dateOfBirth: z.strictObject({ value: iso, precision: z.enum(ENUMS.dobPrecision) }),
  sexAtBirth: z.enum(["female", "male", "intersex", "unknown"]),
});

export const ContextFactSchema = z.strictObject({
  ...envelope,
  kind: z.literal("context"),
  facilityLevel: z.string().min(1),
  capabilities: z.array(
    z.strictObject({
      id: z.string().min(1),
      status: z.enum(ENUMS.capabilityStatus),
      updatedAt: iso,
    }),
  ),
  setting: z
    .enum([
      "opd",
      "ipd",
      "ed",
      "antenatal",
      "hiv_clinic",
      "tb_clinic",
      "ncd_clinic",
      "community_outreach",
      "telehealth",
      "home",
    ])
    .optional(),
});

export const AllergyFactSchema = z.strictObject({
  ...envelope,
  kind: z.literal("allergy"),
  substance: z.strictObject({
    code: z.string().min(1).optional(),
    kind: z.enum(["drug_ingredient", "drug_class", "food", "environmental", "other"]).optional(),
    text: z.string().min(1).optional(),
  }),
  category: z.enum(["medication", "food", "environment", "biologic"]).optional(),
  allergyType: z.enum(["allergy", "intolerance"]).optional(),
  criticality: z.enum(["low", "high", "unable_to_assess"]).optional(),
  manifestations: z.array(
    z.enum(["rash", "urticaria", "angioedema", "anaphylaxis", "bronchospasm", "sjs_ten", "other"]),
  ),
  severity: z.enum(ENUMS.severity).optional(),
  clinicalStatus: z.enum(["active", "inactive", "resolved"]),
  verification: z.enum(["unconfirmed", "confirmed", "refuted"]),
  informant: z.enum([
    "patient",
    "relative",
    "record",
    "clinician_observed",
    "resus_ample_migration",
  ]),
  matchedByNameOnly: z.boolean(),
});

export const AllergyAssertionSchema = z.strictObject({
  id: z.string().min(1),
  patientId: z.string().min(1),
  tenantId: z.string().min(1),
  state: z.enum(["no_known_drug_allergies", "unable_to_assess"]),
  assertedBy: z.string().min(1),
  assertedAt: iso,
  recordedAt: iso,
  status: z.enum(["final", "entered_in_error"]),
  supersedesId: z.string().optional(),
});

export const ClinicalFactSchema = z.discriminatedUnion("kind", [
  ObservationFactSchema,
  FindingFactSchema,
  ConditionFactSchema,
  MedicationFactSchema,
  PregnancyFactSchema,
  ProcedureFactSchema,
  DemographicFactSchema,
  ContextFactSchema,
  AllergyFactSchema,
]);

/* ─── Schema ↔ type parity (compile-time) ─── */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Parity = [
  Same<z.infer<typeof ObservationFactSchema>, T.ObservationFact>,
  Same<z.infer<typeof FindingFactSchema>, T.FindingFact>,
  Same<z.infer<typeof ConditionFactSchema>, T.ConditionFact>,
  Same<z.infer<typeof MedicationFactSchema>, T.MedicationFact>,
  Same<z.infer<typeof PregnancyFactSchema>, T.PregnancyFact>,
  Same<z.infer<typeof ProcedureFactSchema>, T.ProcedureFact>,
  Same<z.infer<typeof DemographicFactSchema>, T.DemographicFact>,
  Same<z.infer<typeof ContextFactSchema>, T.ContextFact>,
  Same<z.infer<typeof AllergyFactSchema>, T.AllergyFact>,
  Same<z.infer<typeof AllergyAssertionSchema>, T.AllergyAssertion>,
];
export const SCHEMA_TYPE_PARITY: Parity = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
