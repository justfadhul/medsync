/**
 * Three synthetic charts for the EMR UI (render tests and the scratch fixture harness). Every
 * payload is built by the real engine (buildChartPayload) from synthetic source rows projected by
 * the real projectors, so a view never sees a shape the engine cannot produce.
 *
 * SYNTHETIC: the patients are "Test Patient A/B/C" with made-up MRNs; values are illustrative
 * test data, not thresholds. The one signed critical reference below is TEST-ONLY — it proves the
 * critical style renders when the payload says critical. Every shipped REF-CRIT entry is
 * pending_cso, so production shows no critical value today.
 */
import type { Provenance } from "@/components/emr/provenance";
import type {
  ChartEncounterInput,
  ChartInput,
  ChartNoteEventInput,
  ChartNoteInput,
  ChartOrderInput,
  ChartPayload,
  ChartResultInput,
} from "@/lib/emr/chart";
import type { CriticalRef } from "@/lib/emr/reference/critical";
import type { Projection } from "@/lib/facts/project/shared";
import type { AllergyAssertion, ClinicalFact } from "@/lib/facts/types";

import { provenanceFor } from "@/components/emr/provenance";
import { buildChartPayload } from "@/lib/emr/chart";
import { deriveOrderStatus } from "@/lib/emr/orders";
import { projectAllergy, projectAllergyAssertion } from "@/lib/facts/project/allergy";
import { projectCondition } from "@/lib/facts/project/condition";
import { projectMedication } from "@/lib/facts/project/medication";
import { projectObservation } from "@/lib/facts/project/observation";
import {
  allergyRow,
  assertionRow,
  cfcRowFor,
  conditionRow,
  H,
  medicationRow,
  P,
  U,
  uuid,
} from "../facts/_rows";

export const TIME_ZONE = "Africa/Kampala";
export const CLINICIAN = "Dr Test Clinician";
const at = (iso: string) => new Date(iso);

const facts = (...ps: Projection[]): ClinicalFact[] =>
  ps.flatMap((p) => {
    if (p.facts.length === 0)
      throw new Error(`fixture quarantined: ${JSON.stringify(p.quarantined)}`);
    return p.facts;
  });
const assertion = (over: Parameters<typeof assertionRow>[0]): AllergyAssertion => {
  const r = projectAllergyAssertion(assertionRow(over));
  if (!r.ok) throw new Error(r.reason);
  return r.assertion;
};
/** A quantity result on `concept`, with the catalogue's required context filled in. */
const q = (
  concept: string,
  iso: string,
  value: string,
  context: Record<string, unknown> = {},
  over: Parameters<typeof cfcRowFor>[2] = {},
) =>
  projectObservation(
    cfcRowFor(concept, undefined, {
      effectiveAt: at(iso),
      recordedAt: at(iso),
      valueNum: value,
      valueCanonical: value,
      context,
      ...over,
    }),
  );
const coded = (concept: string, iso: string, code: string) =>
  projectObservation(
    cfcRowFor(concept, undefined, { effectiveAt: at(iso), recordedAt: at(iso), valueCode: code }),
  );
const labRange = (low: number, high: number, unit: string) => ({
  referenceRange: { low, high, unit, source: "lab" },
});

const encounter = (over: Partial<ChartEncounterInput>): ChartEncounterInput => ({
  id: uuid(),
  hospitalId: H,
  encounterType: "opd",
  state: "completed",
  closureKind: "clinical",
  startedAt: at("2026-03-01T08:00:00Z"),
  endedAt: at("2026-03-01T09:00:00Z"),
  disposition: "home",
  ...over,
});
const order = (
  display: string,
  status: string,
  orderedAt: string,
  over: Partial<ChartOrderInput> = {},
): ChartOrderInput => {
  const id = uuid();
  return {
    derivation: deriveOrderStatus({ id, lifecycle: "legacy", status, kind: "lab" }),
    kind: "lab",
    display,
    priority: "routine",
    orderedAt: at(orderedAt),
    sensitivity: "standard",
    ...over,
  };
};
const report = (display: string, issuedAt: string, over: Partial<ChartResultInput> = {}) => ({
  reportId: uuid(),
  display,
  issuedAt: at(issuedAt),
  ack: { kind: "needs_review" } as ChartResultInput["ack"],
  critical: false,
  sensitivity: "standard",
  ...over,
});
const note = (over: Partial<ChartNoteInput>): ChartNoteInput => ({
  id: uuid(),
  noteType: "clerking",
  templateId: "tpl.clerking.adult_opd",
  state: "signed",
  authorUserId: U,
  authorCadre: "MEDICAL_OFFICER",
  addendumTo: null,
  signedAt: at("2026-03-01T10:52:00Z"),
  recordedAt: at("2026-03-01T10:00:00Z"),
  effectiveAt: at("2026-03-01T10:00:00Z"),
  lateEntry: false,
  sensitivity: "standard",
  ...over,
});

function chart(
  input: Omit<ChartInput, "snapshot" | "names" | "timeZone"> & {
    facts: ClinicalFact[];
    assertions?: AllergyAssertion[];
  },
): Fixture {
  const { facts: fs, assertions = [], ...rest } = input;
  const snapshot = {
    patientId: P,
    asOf: "2026-09-26T00:00:00.000Z",
    manifest: [],
    facts: fs,
    allergyAssertions: assertions,
    quarantined: 0,
    hash: "fixture",
  };
  const names = { [U]: CLINICIAN };
  return {
    payload: buildChartPayload({ ...rest, snapshot, names, timeZone: TIME_ZONE }),
    provenance: provenanceFor(snapshot, names, TIME_ZONE),
  };
}

export interface Fixture {
  payload: ChartPayload;
  provenance: Record<string, Provenance>;
}

/* ─── (1) Adult OPD, fever, two allergies (one uncoded), labs ────────── */

export function adultOpdFever(): Fixture {
  const day = "2026-09-20";
  return chart({
    patient: { name: "Test Patient A", mrn: "MRN-2026-90001", ageYears: 34, sex: "male" },
    facts: facts(
      projectAllergy(allergyRow()),
      projectAllergy(
        allergyRow({
          substanceCode: null,
          substanceKind: "drug_class",
          criticality: "low",
          manifestations: ["rash"],
          severity: "mild",
          verification: "unconfirmed",
        }),
        { text: "Sulfa drugs" },
      ),
      q(
        "obs.temperature",
        `${day}T08:10:00Z`,
        "38.9",
        {},
        { category: "vital-signs", source: "clinician", trust: 3 },
      ),
      q(
        "obs.heart_rate",
        `${day}T08:10:00Z`,
        "104",
        {},
        { category: "vital-signs", source: "clinician", trust: 3 },
      ),
      q("obs.haemoglobin", `${day}T09:40:00Z`, "11.2", { labInterpretation: "L" }),
      q("obs.wbc", `${day}T09:40:00Z`, "12.4", labRange(4, 11, "10*9/L")),
      q("obs.platelets", `${day}T09:40:00Z`, "210", labRange(150, 400, "10*9/L")),
      coded("obs.malaria_test", `${day}T09:15:00Z`, "positive"),
    ),
    encounters: [
      encounter({
        encounterType: "opd",
        state: "in_progress",
        closureKind: null,
        startedAt: at(`${day}T08:00:00Z`),
        endedAt: null,
        disposition: null,
      }),
    ],
    orders: [
      order("Full blood count", "resulted", `${day}T08:40:00Z`),
      order("Malaria rapid diagnostic test", "resulted", `${day}T08:40:00Z`),
    ],
    results: [
      report("Full blood count", `${day}T10:31:00Z`),
      report("Malaria rapid diagnostic test", `${day}T09:20:00Z`, {
        ack: {
          kind: "acknowledged",
          action: "acted",
          byUserId: U,
          at: at(`${day}T09:30:00Z`),
          forwardedToUserId: null,
        },
      }),
    ],
    notes: [],
    death: null,
  });
}

/* ─── (2) Type 2 diabetes: flowsheet history, NKDA, a pending order, an addendum ── */

export function knownType2Diabetes(): Fixture {
  const hba1c = (iso: string, v: string) => q("obs.hba1c", iso, v, labRange(4, 6, "%"));
  const glucose = (iso: string, v: string) => q("obs.glucose", iso, v);
  const parent = note({
    signedAt: at("2026-08-12T10:52:00Z"),
    recordedAt: at("2026-08-12T10:00:00Z"),
    effectiveAt: at("2026-08-12T10:00:00Z"),
  });
  const addendum = note({
    noteType: "addendum",
    addendumTo: parent.id,
    signedAt: at("2026-08-12T14:05:00Z"),
    recordedAt: at("2026-08-12T14:05:00Z"),
    effectiveAt: at("2026-08-12T14:05:00Z"),
  });
  return chart({
    patient: { name: "Test Patient B", mrn: "MRN-2026-90002", ageYears: 58, sex: "female" },
    assertions: [assertion({ assertedAt: at("2026-08-12T08:30:00Z") })],
    facts: facts(
      projectCondition(conditionRow({ conceptId: "cond.dm_type2", onset: "2019-05-01" })),
      projectCondition(conditionRow({ conceptId: "cond.hypertension", onset: "2021-02-01" })),
      projectCondition(conditionRow({ conceptId: "cond.dyslipidaemia", onset: "2022-07-01" })),
      projectCondition(conditionRow({ conceptId: "cond.dm_neuropathy", onset: "2024-03-01" })),
      projectMedication(medicationRow()),
      projectMedication(
        medicationRow({ drugCode: "amlodipine", classTags: ["antihypertensive_any"] }),
      ),
      hba1c("2025-11-10T08:00:00Z", "8.9"),
      hba1c("2026-02-12T08:00:00Z", "8.1"),
      hba1c("2026-05-14T08:00:00Z", "7.6"),
      hba1c("2026-08-12T08:00:00Z", "7.2"),
      glucose("2026-02-12T08:00:00Z", "9.8"),
      glucose("2026-05-14T08:00:00Z", "8.4"),
      glucose("2026-08-12T08:00:00Z", "7.9"),
      q("obs.creatinine", "2026-05-14T08:00:00Z", "96", labRange(45, 90, "umol/L")),
      q("obs.creatinine", "2026-08-12T08:00:00Z", "101", labRange(45, 90, "umol/L")),
    ),
    encounters: [
      encounter({ startedAt: at("2026-08-12T08:00:00Z"), endedAt: at("2026-08-12T11:00:00Z") }),
      encounter({ startedAt: at("2026-05-14T08:00:00Z"), endedAt: at("2026-05-14T09:30:00Z") }),
      encounter({ startedAt: at("2026-02-12T08:00:00Z"), endedAt: at("2026-02-12T09:10:00Z") }),
      encounter({ startedAt: at("2025-11-10T08:00:00Z"), endedAt: at("2025-11-10T09:00:00Z") }),
    ],
    orders: [
      order("HbA1c", "ordered", "2026-09-20T10:40:00Z", { priority: "routine" }),
      order("Urine albumin-creatinine ratio", "ordered", "2026-09-20T10:41:00Z", {
        priority: "urgent",
      }),
      order("Lipid profile", "resulted", "2026-08-12T08:10:00Z"),
    ],
    results: [
      report("Lipid profile", "2026-08-12T12:00:00Z", {
        ack: {
          kind: "acknowledged",
          action: "seen",
          byUserId: U,
          at: at("2026-08-12T14:00:00Z"),
          forwardedToUserId: null,
        },
      }),
    ],
    notes: [parent, addendum],
    death: null,
  });
}

/* ─── (3) Deceased emergency patient; a restricted fact; a critical value (test-only ref) ── */

/** TEST-ONLY: a signed entry so the critical style has something to show. Never shipped. */
export const TEST_ONLY_CRITICAL: CriticalRef = {
  id: "TEST-ONLY-CRIT-K",
  text: "test only — proves the mechanism",
  value: "6.5",
  source: "TEST",
  url: "test",
  verifiedOn: "2026-09-26",
  confidence: "design",
  status: "signed",
  conceptId: "obs.potassium",
  operator: ">",
};

export function deceasedEmergency(): Fixture {
  const day = "2026-09-24";
  const handover = note({
    noteType: "handover",
    templateId: "tpl.clerking.emergency",
    signedAt: at(`${day}T07:30:00Z`),
    recordedAt: at(`${day}T07:30:00Z`),
    effectiveAt: at(`${day}T07:10:00Z`),
  });
  const wrong = note({
    noteType: "progress",
    templateId: "tpl.progress",
    signedAt: at(`${day}T06:20:00Z`),
    recordedAt: at(`${day}T06:20:00Z`),
    effectiveAt: at(`${day}T06:20:00Z`),
    authorCadre: "NURSE",
  });
  const eie: ChartNoteEventInput = {
    id: uuid(),
    noteId: wrong.id,
    kind: "entered_in_error",
    actorUserId: U,
    cosignRequestId: null,
    recordedAt: at(`${day}T06:40:00Z`),
    reasonCode: "wrong_patient",
    reasonText: "Recorded against the wrong patient",
  };
  return chart({
    patient: { name: "Test Patient C", mrn: "MRN-2026-90003", ageYears: 61, sex: "male" },
    assertions: [assertion({ assertion: "unable_to_assess", assertedAt: at(`${day}T05:12:00Z`) })],
    facts: facts(
      projectCondition(
        conditionRow({ conceptId: "cond.hiv", sensitivity: "restricted", onset: "2018-01-01" }),
      ),
      projectCondition(conditionRow({ conceptId: "cond.ckd", onset: "2023-06-01" })),
      q("obs.potassium", `${day}T05:40:00Z`, "6.9", { labInterpretation: "HH" }),
      q("obs.potassium", "2026-09-10T08:00:00Z", "5.2", { labInterpretation: "H" }),
      q("obs.creatinine", `${day}T05:40:00Z`, "412", labRange(60, 110, "umol/L")),
    ),
    encounters: [
      encounter({
        encounterType: "emergency",
        state: "completed",
        startedAt: at(`${day}T05:00:00Z`),
        endedAt: at(`${day}T08:06:00Z`),
        disposition: "deceased",
      }),
    ],
    orders: [
      order("Urea and electrolytes", "resulted", `${day}T05:20:00Z`, { priority: "immediate" }),
    ],
    results: [report("Urea and electrolytes", `${day}T06:31:00Z`, { critical: true })],
    notes: [handover, wrong],
    noteEvents: [eie],
    death: {
      patientId: P,
      atMs: at(`${day}T08:06:00Z`).getTime(),
      source: "resus",
      sourceId: uuid(),
      byName: CLINICIAN,
    },
    criticalRefs: [TEST_ONLY_CRITICAL],
  });
}

export const FIXTURES = {
  adultOpdFever,
  knownType2Diabetes,
  deceasedEmergency,
} as const;
