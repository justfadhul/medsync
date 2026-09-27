import type {
  CodeIndex,
  ExternalCode,
  FhirExportInput,
  FhirNoteInput,
  FhirOrderInput,
  FhirReportInput,
  FhirResource,
  FhirSpecimenInput,
} from "@/lib/emr/fhir";
import type { Projection } from "@/lib/facts/project/shared";
import type {
  AllergyFact,
  ClinicalFact,
  ConditionFact,
  DemographicFact,
  MedicationFact,
  ObservationFact,
  ProcedureFact,
} from "@/lib/facts/types";
import { describe, expect, it } from "vitest";

import v11 from "@/data/emr/clinical-fact-concepts.v1.1.json";
import terms from "@/data/emr/diagnosis-terms.v1.json";
import v1 from "@/docs/emr/clinical-fact-concepts.v1.json";
import {
  conceptCode,
  EXPORTABLE_STATUSES,
  exportBundle,
  fhirId,
  SYSTEMS,
  toFhirAllergyIntolerance,
  toFhirComposition,
  toFhirCondition,
  toFhirDiagnosticReport,
  toFhirEncounter,
  toFhirMedicationRequest,
  toFhirMedicationStatement,
  toFhirObservation,
  toFhirPatient,
  toFhirProcedure,
  toFhirServiceRequest,
  toFhirSpecimen,
} from "@/lib/emr/fhir";
import { deriveOrderStatus } from "@/lib/emr/orders";
import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { projectAllergy } from "@/lib/facts/project/allergy";
import { projectCondition, projectLegacyProblem } from "@/lib/facts/project/condition";
import { projectDemographics } from "@/lib/facts/project/demographic";
import { projectMedication } from "@/lib/facts/project/medication";
import { projectObservation } from "@/lib/facts/project/observation";
import { projectProcedure } from "@/lib/facts/project/procedure";
import {
  allergyRow,
  cfcRowFor,
  conditionRow,
  H,
  medicationRow,
  P,
  problemRow,
  procedureRow,
  U,
  uuid,
} from "./facts/_rows";

/** lib/emr/fhir.ts: one round trip per resource (project → minimal parse back → same key fields),
 *  the code rule over the whole catalogue, and restricted exclusion. */

/* ─── The code index, built from the seeded data files ─────────────── */

type RawCode = { system: string; code: string; status: string };
const INDEX: CodeIndex = Object.fromEntries([
  ...[...v1.concepts, ...v11.concepts].map((c) => [c.id, (c.codes ?? []) as RawCode[]]),
  ...v1.drugClassTags.map((t) => [t.tag, t.atc as RawCode[]]),
  ...terms.terms.map((t) => [
    t.id,
    t.icd11 ? [{ system: "ICD-11", code: t.icd11.code, status: t.icd11.status }] : [],
  ]),
]);
const ALL_CODES: ExternalCode[] = Object.values(INDEX).flat();

const one = <F extends ClinicalFact>(p: Projection): F => {
  if (!p.facts[0]) throw new Error(`quarantined: ${JSON.stringify(p.quarantined)}`);
  return p.facts[0] as F;
};
const at = (iso: string) => new Date(iso);
type Obj = Record<string, unknown>;
const get = (r: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Obj | undefined)?.[k], r);
const refId = (r: unknown, path: string) => String(get(r, `${path}.reference`)).split("/")[1];
const codings = (r: unknown, path: string) =>
  (get(r, `${path}.coding`) as { system: string; code: string }[] | undefined) ?? [];
/** Minimal parse back, shared by the fact resources: the fact id and primary concept. */
const factKey = (r: FhirResource) => ({
  factId: get(r, "identifier.0.value"),
  concept: codings(r, "code").find((c) => c.system === SYSTEMS.concept)?.code,
  patient: refId(r, r.resourceType === "AllergyIntolerance" ? "patient" : "subject"),
});

/* ─── Round trip per resource ─────────────────────────────────────── */

describe("round trip per resource", () => {
  it("Patient", () => {
    const demo = projectDemographics({
      id: P,
      sex: "female",
      dateOfBirth: "1974-03-01",
      primaryFacilityId: H,
      createdAt: at("2026-01-01T00:00:00Z"),
    }).facts.find((f): f is DemographicFact => f.concept === "demo.date_of_birth")!;
    const r = toFhirPatient({
      patientId: P,
      mrn: "MRN-1",
      name: "Test Patient",
      demographic: demo,
    });
    expect([
      r.id,
      get(r, "identifier.0.value"),
      get(r, "name.0.text"),
      r.gender,
      r.birthDate,
    ]).toEqual([P, "MRN-1", "Test Patient", "female", "1974-03-01"]);
  });

  it("Encounter", () => {
    const e = {
      id: uuid(),
      patientUserId: P,
      encounterType: "emergency",
      state: "completed",
      startedAt: at("2026-03-01T08:00:00Z"),
      endedAt: at("2026-03-01T09:00:00Z"),
      disposition: "admitted",
      clinicianUserId: U,
    };
    const r = toFhirEncounter(e);
    expect({
      id: r.id,
      status: r.status,
      cls: get(r, "class.code"),
      start: get(r, "period.start"),
      disposition: get(r, "hospitalization.dischargeDisposition.text"),
      patient: refId(r, "subject"),
    }).toEqual({
      id: e.id,
      status: "finished",
      cls: "EMER",
      start: "2026-03-01T08:00:00.000Z",
      disposition: "admitted",
      patient: P,
    });
  });

  it("Condition, with a verified ICD-11 and never ICD-10", () => {
    const term = terms.terms.find((t) => t.icd11?.status === "verified-mirror")!;
    const f = one<ConditionFact>(
      projectCondition(
        conditionRow({ conceptId: "cond.hypertension", icd11Code: term.icd11!.code }),
      ),
    );
    const r = toFhirCondition(f, INDEX);
    expect(factKey(r)).toEqual({ factId: f.id, concept: "cond.hypertension", patient: P });
    expect(get(r, "clinicalStatus.coding.0.code")).toBe("active");
    expect(get(r, "verificationStatus.coding.0.code")).toBe("confirmed");
    expect(codings(r, "code").map((c) => c.code)).toContain(term.icd11!.code);
    // A legacy row carries ICD-10: it is read into the fact and never exported.
    const legacy = one<ConditionFact>(
      projectLegacyProblem(problemRow({ icd10Code: "I10" }), "cond.hypertension"),
    );
    expect(legacy.codes.icd10).toBe("I10");
    expect(JSON.stringify(toFhirCondition(legacy, INDEX))).not.toContain("I10");
  });

  it("Observation (quantity and coded)", () => {
    const k = one<ObservationFact>(
      projectObservation(
        cfcRowFor("obs.potassium", undefined, { context: { labInterpretation: "H" } }),
      ),
    );
    const r = toFhirObservation(k, INDEX);
    expect(factKey(r)).toEqual({ factId: k.id, concept: "obs.potassium", patient: P });
    expect(fhirId(k)).toBe(r.id);
    expect([r.status, get(r, "valueQuantity.value"), get(r, "valueQuantity.unit")]).toEqual([
      "final",
      1,
      CONCEPTS["obs.potassium"].canonicalUnit,
    ]);
    expect(get(r, "interpretation.0.coding.0.code")).toBe("H");
    const hiv = one<ObservationFact>(projectObservation(cfcRowFor("obs.hiv_test")));
    expect(get(toFhirObservation(hiv), "valueCodeableConcept.coding.0.code")).toBe("reactive");
  });

  it("AllergyIntolerance", () => {
    const f = one<AllergyFact>(projectAllergy(allergyRow()));
    const r = toFhirAllergyIntolerance(f);
    expect(factKey(r).factId).toBe(f.id);
    expect(refId(r, "patient")).toBe(P);
    expect([
      get(r, "code.coding.0.code"),
      r.criticality,
      get(r, "reaction.0.manifestation.0.text"),
    ]).toEqual(["penicillin", "high", "anaphylaxis"]);
    expect(get(r, "verificationStatus.coding.0.code")).toBe("confirmed");
  });

  it("MedicationStatement", () => {
    const f = one<MedicationFact>(projectMedication(medicationRow()));
    const r = toFhirMedicationStatement(f, INDEX);
    expect([factKey(r).factId, refId(r, "subject"), r.status]).toEqual([f.id, P, "active"]);
    expect(codings(r, "medicationCodeableConcept")[0]).toEqual({
      system: SYSTEMS.drug,
      code: "metformin",
    });
  });

  it("MedicationRequest (prescribed here; no dose)", () => {
    const f = one<MedicationFact>(
      projectMedication(medicationRow({ medicationSource: "prescribed_here" })),
    );
    const r = toFhirMedicationRequest(f, INDEX);
    expect([factKey(r).factId, r.intent, r.status, refId(r, "requester")]).toEqual([
      f.id,
      "order",
      "active",
      U,
    ]);
    expect(JSON.stringify(r)).not.toContain("dosage");
  });

  it("ServiceRequest", () => {
    const id = uuid();
    const o: FhirOrderInput = {
      id,
      encounterId: uuid(),
      patientUserId: P,
      kind: "lab",
      text: "Full blood count",
      loincCode: null,
      priority: "urgent",
      createdAt: at("2026-03-01T10:40:00Z"),
      authoredByUserId: U,
      sensitivity: "standard",
      derivation: deriveOrderStatus({ id, lifecycle: "legacy", status: "ordered", kind: "lab" }),
    };
    const r = toFhirServiceRequest(o, INDEX);
    expect([
      r.id,
      r.status,
      r.intent,
      r.priority,
      get(r, "code.text"),
      refId(r, "subject"),
    ]).toEqual([id, "active", "order", "urgent", "Full blood count", P]);
  });

  it("Specimen", () => {
    const s: FhirSpecimenInput = {
      id: uuid(),
      orderId: uuid(),
      patientUserId: P,
      specimenType: "venous_serum",
      container: "serum_plain",
      collectedAt: at("2026-03-01T09:40:00Z"),
      collectedByUserId: U,
      fastingState: "fasting",
      labelNo: "L-1",
    };
    const r = toFhirSpecimen(s);
    expect([
      r.id,
      get(r, "type.coding.0.code"),
      refId(r, "request.0"),
      get(r, "collection.collectedDateTime"),
    ]).toEqual([s.id, "venous_serum", s.orderId, "2026-03-01T09:40:00.000Z"]);
  });

  it("DiagnosticReport", () => {
    const r0: FhirReportInput = {
      id: uuid(),
      status: "amended",
      kind: "lab",
      orderId: uuid(),
      specimenId: uuid(),
      patientUserId: P,
      encounterId: null,
      effectiveAt: at("2026-03-01T09:40:00Z"),
      issuedAt: at("2026-03-01T10:31:00Z"),
      performer: "in_house",
      performerLabName: null,
      conclusionCode: null,
      sensitivity: "standard",
      resultFactIds: [],
    };
    const r = toFhirDiagnosticReport(r0, ["obs-1"]);
    expect([
      r.id,
      r.status,
      get(r, "category.0.coding.0.code"),
      refId(r, "basedOn.0"),
      refId(r, "result.0"),
    ]).toEqual([r0.id, "amended", "LAB", r0.orderId, "obs-1"]);
  });

  it("Procedure", () => {
    const f = one<ProcedureFact>(projectProcedure(procedureRow({ outcome: "declined" })));
    const r = toFhirProcedure(f, INDEX);
    expect(factKey(r)).toEqual({ factId: f.id, concept: "proc.foot_exam", patient: P });
    expect([r.status, get(r, "statusReason.text")]).toEqual(["not-done", "declined"]);
  });

  it("Composition (a signed note, addendum related)", () => {
    const n: FhirNoteInput = {
      id: uuid(),
      noteType: "addendum",
      templateId: "tpl.addendum",
      state: "signed",
      authorUserId: U,
      encounterId: uuid(),
      patientUserId: P,
      signedAt: at("2026-03-01T14:05:00Z"),
      addendumTo: uuid(),
      sensitivity: "standard",
      sections: [{ title: "Addendum", text: "Result reviewed <plan unchanged>" }],
    };
    const r = toFhirComposition(n);
    expect([
      r.id,
      r.status,
      r.title,
      refId(r, "relatesTo.0.targetReference"),
      refId(r, "author.0"),
    ]).toEqual([n.id, "final", "Addendum", n.addendumTo, U]);
    expect(get(r, "section.0.text.div")).toContain("&lt;plan unchanged&gt;");
  });
});

/* ─── Codes ───────────────────────────────────────────────────────── */

describe("codes", () => {
  const exported = Object.keys(CONCEPTS).flatMap((id) =>
    (get(conceptCode(id, INDEX), "coding") as { system: string; code: string }[]).filter(
      (c) => c.system !== SYSTEMS.concept,
    ),
  );
  it("exports no candidate code for any concept (all v1 + v1.1)", () => {
    const candidates = ALL_CODES.filter((c) => c.status === "candidate").map((c) => c.code);
    const verified = new Set(
      ALL_CODES.filter((c) => EXPORTABLE_STATUSES.has(c.status)).map((c) => c.code),
    );
    expect(candidates.length).toBeGreaterThan(100);
    const leaked = exported.filter((c) => !verified.has(c.code));
    expect(leaked).toEqual([]);
    expect(exported.length).toBeGreaterThan(0);
  });
  it("never has an ICD-10 system, even when the index lists an ICD-10 code as verified", () => {
    const idx: CodeIndex = {
      "cond.hypertension": [{ system: "ICD-10", code: "I10", status: "verified" }],
    };
    expect(JSON.stringify(conceptCode("cond.hypertension", idx))).not.toContain("I10");
  });
  it("keeps the MedSync concept id as the primary coding", () => {
    expect(get(conceptCode("obs.potassium", INDEX), "coding.0")).toMatchObject({
      system: SYSTEMS.concept,
      code: "obs.potassium",
    });
  });
  it("drops wildcard class codes (ATC 'A10*')", () => {
    const idx: CodeIndex = {
      glucose_lowering_any: [{ system: "ATC", code: "A10*", status: "verified" }],
    };
    const f = one<MedicationFact>(projectMedication(medicationRow()));
    expect(JSON.stringify(toFhirMedicationStatement(f, idx))).not.toContain("A10*");
  });
});

/* ─── Bundle: restricted exclusion ────────────────────────────────── */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function world(seed: number): FhirExportInput {
  const rnd = mulberry32(seed);
  const sens = () => (rnd() < 0.35 ? "restricted" : "standard");
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const facts: ClinicalFact[] = [];
  for (let i = 0; i < 4; i++) {
    facts.push(
      one(
        projectCondition(
          conditionRow({
            conceptId: pick(["cond.hypertension", "cond.hiv", "cond.ckd"]),
            sensitivity: sens(),
          }),
        ),
      ),
    );
    facts.push(
      one(
        projectObservation(
          cfcRowFor(pick(["obs.potassium", "obs.hiv_viral_load", "obs.haemoglobin"]), undefined, {
            sensitivity: sens(),
          }),
        ),
      ),
    );
  }
  facts.push(one(projectAllergy(allergyRow({ sensitivity: sens() }))));
  facts.push(
    one(
      projectMedication(
        medicationRow({
          sensitivity: sens(),
          medicationSource: pick(["prescribed_here", "patient_reported"]),
        }),
      ),
    ),
  );
  facts.push(one(projectProcedure(procedureRow({ sensitivity: sens() }))));
  const orders: FhirOrderInput[] = Array.from({ length: 2 }, () => {
    const id = uuid();
    return {
      id,
      encounterId: uuid(),
      patientUserId: P,
      kind: "lab",
      text: "Test",
      loincCode: null,
      priority: null,
      createdAt: at("2026-03-01T10:00:00Z"),
      authoredByUserId: U,
      sensitivity: sens(),
      derivation: deriveOrderStatus({ id, lifecycle: "legacy", status: "ordered", kind: "lab" }),
    };
  });
  const specimens: FhirSpecimenInput[] = orders.map((o) => ({
    id: uuid(),
    orderId: o.id,
    patientUserId: P,
    specimenType: "venous_serum",
    container: "serum_plain",
    collectedAt: at("2026-03-01T10:10:00Z"),
    collectedByUserId: U,
    fastingState: null,
    labelNo: null,
  }));
  const obs = facts.filter((f) => f.kind === "observation");
  const reports: FhirReportInput[] = orders.map((o, i) => ({
    id: uuid(),
    status: "final",
    kind: "lab",
    orderId: o.id,
    specimenId: specimens[i]!.id,
    patientUserId: P,
    encounterId: null,
    effectiveAt: at("2026-03-01T10:10:00Z"),
    issuedAt: at("2026-03-01T11:00:00Z"),
    performer: "in_house",
    performerLabName: null,
    conclusionCode: null,
    sensitivity: sens(),
    resultFactIds: obs.map((f) => f.id),
  }));
  const parent: FhirNoteInput = {
    id: uuid(),
    noteType: "clerking",
    templateId: "tpl.clerking.adult_opd",
    state: "signed",
    authorUserId: U,
    encounterId: uuid(),
    patientUserId: P,
    signedAt: at("2026-03-01T10:52:00Z"),
    addendumTo: null,
    sensitivity: sens(),
  };
  const addendum: FhirNoteInput = {
    ...parent,
    id: uuid(),
    noteType: "addendum",
    templateId: "tpl.addendum",
    addendumTo: parent.id,
    sensitivity: "standard",
  };
  return {
    patient: { patientId: P, mrn: "MRN-1", name: "Test Patient" },
    facts,
    orders,
    specimens,
    reports,
    notes: [
      parent,
      addendum,
      { ...parent, id: uuid(), state: "draft", signedAt: null, sensitivity: "standard" },
    ],
  };
}

function restrictedIds(w: FhirExportInput): string[] {
  const facts = (w.facts ?? []).filter((f) => f.sensitivity === "restricted");
  const orders = (w.orders ?? []).filter((o) => o.sensitivity === "restricted").map((o) => o.id);
  const notes = (w.notes ?? []).filter((n) => n.sensitivity === "restricted");
  return [
    ...facts.flatMap((f) => [f.id, fhirId(f)]),
    ...orders,
    ...(w.specimens ?? []).filter((s) => orders.includes(s.orderId)).map((s) => s.id),
    ...(w.reports ?? []).filter((r) => r.sensitivity === "restricted").map((r) => r.id),
    ...notes.map((n) => n.id),
    // an addendum travels with its parent
    ...(w.notes ?? [])
      .filter((n) => n.addendumTo && notes.some((p) => p.id === n.addendumTo))
      .map((n) => n.id),
  ];
}

describe("bundle", () => {
  it("contains the twelve resource types (includeRestricted, a full world)", () => {
    const w = world(3);
    const types = new Set(
      (
        exportBundle(
          {
            ...w,
            encounters: [
              {
                id: uuid(),
                patientUserId: P,
                encounterType: "opd",
                state: "completed",
                startedAt: at("2026-03-01T08:00:00Z"),
                endedAt: null,
                disposition: null,
                clinicianUserId: U,
              },
            ],
            facts: [
              ...w.facts!,
              one(projectMedication(medicationRow({ medicationSource: "prescribed_here" }))),
              one(projectMedication(medicationRow())),
            ],
          },
          { includeRestricted: true },
        ).entry as { resource: FhirResource }[]
      ).map((e) => e.resource.resourceType),
    );
    expect([...types].sort()).toEqual(
      [
        "AllergyIntolerance",
        "Composition",
        "Condition",
        "DiagnosticReport",
        "Encounter",
        "MedicationRequest",
        "MedicationStatement",
        "Observation",
        "Patient",
        "Procedure",
        "ServiceRequest",
        "Specimen",
      ].sort(),
    );
  });
  it("leaves drafts and family history out", () => {
    const fam = one<ConditionFact>(
      projectCondition(conditionRow({ conceptId: "cond.dm_type2", subjectRelation: "mother" })),
    );
    const draft = world(1).notes!.find((n) => n.state === "draft")!;
    const json = JSON.stringify(
      exportBundle({ ...world(1), facts: [fam] }, { includeRestricted: true }),
    );
    expect(json).not.toContain(fam.id);
    expect(json).not.toContain(draft.id);
  });
  it("property (200 seeds): no restricted item or reference to one leaves without includeRestricted", () => {
    let seen = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const w = world(seed);
      const json = JSON.stringify(exportBundle(w, { codes: INDEX }));
      const ids = restrictedIds(w);
      seen += ids.length;
      for (const id of ids) expect(json, `seed ${seed}: ${id}`).not.toContain(id);
      const all = JSON.stringify(exportBundle(w, { codes: INDEX, includeRestricted: true }));
      for (const id of ids) expect(all, `seed ${seed}: ${id} with includeRestricted`).toContain(id);
    }
    expect(seen).toBeGreaterThan(200);
  });
});
