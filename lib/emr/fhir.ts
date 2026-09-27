import type { OrderDerivation } from "./orders";
import type { ClinicalNote, DiagnosticReport, Specimen } from "@/db/schema/emr";
import type { encounterOrders } from "@/db/schema/encounter";
import type { Encounter } from "@/db/schema/scheduling";
import type { ConceptDef } from "@/lib/facts/catalogue.generated";
import type {
  AllergyFact,
  ClinicalFact,
  ConditionFact,
  DemographicFact,
  FactStatus,
  MedicationFact,
  ObservationFact,
  ProcedureFact,
} from "@/lib/facts/types";

import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { NOTE_TEMPLATES } from "./notes";

/**
 * FHIR R4 projection (ADR 0138, E7) — for export TESTS only; there is no endpoint until a DPA/MoU
 * exists. PURE: facts and rows in, plain JSON resources out.
 *
 * Codes: the MedSync concept id is the primary coding. An external code (LOINC, ICD-11, ATC) is
 * emitted only when the code index lists it with a verified status (verified, verified-mirror,
 * verified-secondary), so a candidate code is never exported. ICD-10 has no system here at all
 * (unlicensed, O-3), so it is never emitted. Restricted facts and rows are left out of a bundle
 * unless `includeRestricted`.
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json | undefined };
export interface FhirResource {
  resourceType: string;
  id: string;
  [k: string]: Json | undefined;
}

/* ─── Codes ───────────────────────────────────────────────────────── */

export interface ExternalCode {
  system: string;
  code: string;
  status: string;
}
/** Owner id (concept id, diagnosis term id, drug class tag) → its external codes, as seeded
 *  (clinical_concepts.codes, diagnosis_terms icd11, drug_class_tags atc). */
export type CodeIndex = Readonly<Record<string, readonly ExternalCode[]>>;

export const MEDSYNC = "https://medsync.ug/fhir";
export const SYSTEMS = {
  concept: `${MEDSYNC}/CodeSystem/concept`,
  answer: `${MEDSYNC}/CodeSystem/answer`,
  drug: `${MEDSYNC}/CodeSystem/formulary`,
  specimen: `${MEDSYNC}/CodeSystem/specimen`,
  fact: `${MEDSYNC}/NamingSystem/fact`,
  mrn: `${MEDSYNC}/NamingSystem/mrn`,
} as const;
/** The only external systems MedSync exports. ICD-10 is deliberately absent. */
const EXTERNAL: Readonly<Record<string, string>> = {
  LOINC: "http://loinc.org",
  "ICD-11": "http://id.who.int/icd/release/11/mms",
  ATC: "http://www.whocc.no/atc",
};
export const EXPORTABLE_STATUSES: ReadonlySet<string> = new Set([
  "verified",
  "verified-mirror",
  "verified-secondary",
]);

const exportable = (c: ExternalCode) =>
  EXPORTABLE_STATUSES.has(c.status) && Object.hasOwn(EXTERNAL, c.system) && !c.code.includes("*");
const verifiedPair = (codes: CodeIndex | undefined, system: string, code: string) =>
  Object.values(codes ?? {}).some((cs) =>
    cs.some((c) => c.system === system && c.code === code && exportable(c)),
  );
const external = (c: Pick<ExternalCode, "system" | "code">) => ({
  system: EXTERNAL[c.system]!,
  code: c.code,
});

const def = (id: string): ConceptDef | undefined => (CONCEPTS as Record<string, ConceptDef>)[id];

/** The concept's codeable concept: the MedSync id first, then its verified external codes. */
export function conceptCode(conceptId: string, codes?: CodeIndex): Json {
  const display = def(conceptId)?.display ?? conceptId;
  return {
    coding: [
      { system: SYSTEMS.concept, code: conceptId, display },
      ...(codes?.[conceptId] ?? []).filter(exportable).map(external),
    ],
    text: display,
  };
}

/* ─── Shared ──────────────────────────────────────────────────────── */

/** FHIR ids allow [A-Za-z0-9.-]{1,64}: the row id, plus the component for multi-part rows. */
export function fhirId(fact: Pick<ClinicalFact, "id" | "provenance">): string {
  const rest = fact.id.slice(fact.provenance.table.length + 1);
  return rest
    .replace(/:/g, ".")
    .replace(/[^A-Za-z0-9.-]/g, "-")
    .slice(0, 64);
}
const ref = (type: string, id: string | null | undefined) =>
  id ? { reference: `${type}/${id}` } : undefined;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);
const effective = (f: ClinicalFact) =>
  "at" in f.effective
    ? { effectiveDateTime: f.effective.at }
    : { effectivePeriod: { start: f.effective.start, end: f.effective.end } };

function base(resourceType: string, f: ClinicalFact): FhirResource {
  return {
    resourceType,
    id: fhirId(f),
    identifier: [{ system: SYSTEMS.fact, value: f.id }],
    meta: f.sensitivity === "restricted" ? { security: [{ code: "R" }] } : undefined,
  };
}

const FACT_STATUS: Record<FactStatus, string> = {
  preliminary: "preliminary",
  final: "final",
  amended: "amended",
  corrected: "corrected",
  entered_in_error: "entered-in-error",
  cancelled: "cancelled",
};
const dashed = (s: string) => s.replace(/_/g, "-");

/* ─── Patient, Encounter ──────────────────────────────────────────── */

export interface FhirPatientInput {
  patientId: string;
  mrn: string;
  name: string;
  demographic?: DemographicFact;
}
const GENDER = { female: "female", male: "male", intersex: "other", unknown: "unknown" } as const;

export function toFhirPatient(p: FhirPatientInput): FhirResource {
  const dob = p.demographic?.dateOfBirth;
  // FHIR partial dates carry the precision; an estimated date keeps only its year.
  const birthDate = !dob
    ? undefined
    : dob.precision === "day"
      ? dob.value.slice(0, 10)
      : dob.precision === "month"
        ? dob.value.slice(0, 7)
        : dob.value.slice(0, 4);
  return {
    resourceType: "Patient",
    id: p.patientId,
    identifier: [{ system: SYSTEMS.mrn, value: p.mrn }],
    name: [{ text: p.name }],
    gender: p.demographic ? GENDER[p.demographic.sexAtBirth] : "unknown",
    birthDate,
  };
}

export type FhirEncounterInput = Pick<
  Encounter,
  | "id"
  | "patientUserId"
  | "encounterType"
  | "state"
  | "startedAt"
  | "endedAt"
  | "disposition"
  | "clinicianUserId"
>;
const ENCOUNTER_STATUS: Record<string, string> = {
  planned: "planned",
  in_progress: "in-progress",
  completed: "finished",
  cancelled: "cancelled",
  entered_in_error: "entered-in-error",
};
const ENCOUNTER_CLASS: Record<string, string> = {
  opd: "AMB",
  follow_up: "AMB",
  antenatal: "AMB",
  procedure: "AMB",
  emergency: "EMER",
  inpatient: "IMP",
  tele: "VR",
  virtual: "VR",
  community: "HH",
};

export function toFhirEncounter(e: FhirEncounterInput): FhirResource {
  return {
    resourceType: "Encounter",
    id: e.id,
    status: ENCOUNTER_STATUS[e.state] ?? "unknown",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: ENCOUNTER_CLASS[e.encounterType] ?? "AMB",
    },
    type: [{ text: e.encounterType }],
    subject: ref("Patient", e.patientUserId),
    participant: e.clinicianUserId
      ? [{ individual: ref("Practitioner", e.clinicianUserId) }]
      : undefined,
    period: { start: iso(e.startedAt), end: iso(e.endedAt) },
    hospitalization: e.disposition ? { dischargeDisposition: { text: e.disposition } } : undefined,
  };
}

/* ─── Facts ───────────────────────────────────────────────────────── */

export function toFhirObservation(f: ObservationFact, codes?: CodeIndex): FhirResource {
  const v = f.value;
  const value =
    v.type === "quantity"
      ? {
          valueQuantity: {
            value: v.value,
            comparator: v.comparator,
            unit: v.unit,
            system: "http://unitsofmeasure.org",
            code: v.unit,
          },
        }
      : v.type === "coded"
        ? {
            valueCodeableConcept: {
              coding: [{ system: SYSTEMS.answer, code: v.code }],
              text: v.code,
            },
          }
        : { valueBoolean: v.value };
  const range = f.context.referenceRange;
  return {
    ...base("Observation", f),
    status: FACT_STATUS[f.status],
    code: conceptCode(f.concept, codes),
    subject: ref("Patient", f.patientId),
    encounter: ref("Encounter", f.provenance.encounterId),
    ...effective(f),
    issued: f.recordedAt,
    ...value,
    interpretation: f.context.labInterpretation
      ? [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                code: f.context.labInterpretation,
              },
            ],
          },
        ]
      : undefined,
    // The laboratory's own range only; MedSync never supplies one.
    referenceRange:
      range && range.source === "lab"
        ? [
            {
              low: range.low === undefined ? undefined : { value: range.low, unit: range.unit },
              high: range.high === undefined ? undefined : { value: range.high, unit: range.unit },
            },
          ]
        : undefined,
  };
}

export function toFhirCondition(f: ConditionFact, codes?: CodeIndex): FhirResource {
  const code = conceptCode(f.concept, codes) as { coding: Json[]; text: string };
  const icd11 = f.codes.icd11;
  // ICD-11 from the diagnosis term, only when the index lists it verified. ICD-10 never.
  if (icd11 && verifiedPair(codes, "ICD-11", icd11))
    code.coding.push(external({ system: "ICD-11", code: icd11 }));
  return {
    ...base("Condition", f),
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: f.clinicalStatus,
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: f.status === "entered_in_error" ? "entered-in-error" : dashed(f.verification),
        },
      ],
    },
    code,
    subject: ref("Patient", f.patientId),
    encounter: ref("Encounter", f.provenance.encounterId),
    onsetDateTime: typeof f.onset === "string" ? f.onset : undefined,
    onsetAge:
      f.onset && typeof f.onset === "object"
        ? { value: f.onset.ageYears, unit: "a", system: "http://unitsofmeasure.org", code: "a" }
        : undefined,
    abatementDateTime: f.abatement,
    recordedDate: f.recordedAt,
  };
}

export function toFhirAllergyIntolerance(f: AllergyFact): FhirResource {
  return {
    ...base("AllergyIntolerance", f),
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: f.clinicalStatus,
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: f.status === "entered_in_error" ? "entered-in-error" : f.verification,
        },
      ],
    },
    type: f.allergyType,
    category: f.category ? [f.category] : undefined,
    criticality: f.criticality ? dashed(f.criticality) : undefined,
    code: {
      coding: f.substance.code ? [{ system: SYSTEMS.drug, code: f.substance.code }] : [],
      text: f.substance.text ?? f.substance.code,
    },
    patient: ref("Patient", f.patientId),
    encounter: ref("Encounter", f.provenance.encounterId),
    recordedDate: f.recordedAt,
    reaction: f.manifestations.length
      ? [{ manifestation: f.manifestations.map((m) => ({ text: m })), severity: f.severity }]
      : undefined,
  };
}

function medicationCode(f: MedicationFact, codes?: CodeIndex): Json {
  const atc = [
    ...(f.atc && verifiedPair(codes, "ATC", f.atc) ? [{ system: "ATC", code: f.atc }] : []),
    ...f.classTags.flatMap((t) => (codes?.[t] ?? []).filter(exportable)),
  ];
  return {
    coding: [...(f.drug ? [{ system: SYSTEMS.drug, code: f.drug }] : []), ...atc.map(external)],
    text: f.drug || undefined,
  };
}

const STATEMENT_STATUS: Record<MedicationFact["medicationStatus"], string> = {
  active: "active",
  completed: "completed",
  stopped: "stopped",
  on_hold: "on-hold",
  intended: "intended",
  unknown: "unknown",
};
const REQUEST_STATUS: Record<MedicationFact["medicationStatus"], string> = {
  ...STATEMENT_STATUS,
  intended: "draft",
};

export function toFhirMedicationStatement(f: MedicationFact, codes?: CodeIndex): FhirResource {
  return {
    ...base("MedicationStatement", f),
    status:
      f.status === "entered_in_error" ? "entered-in-error" : STATEMENT_STATUS[f.medicationStatus],
    medicationCodeableConcept: medicationCode(f, codes),
    subject: ref("Patient", f.patientId),
    context: ref("Encounter", f.provenance.encounterId),
    effectivePeriod: { start: f.period.start, end: f.period.end },
    dateAsserted: f.recordedAt,
    dosage: f.route ? [{ route: { text: f.route } }] : undefined,
  };
}

/** A medicine prescribed here. No dose: dosing belongs to the prescribing engine. */
export function toFhirMedicationRequest(f: MedicationFact, codes?: CodeIndex): FhirResource {
  return {
    ...base("MedicationRequest", f),
    status:
      f.status === "entered_in_error" ? "entered-in-error" : REQUEST_STATUS[f.medicationStatus],
    intent: "order",
    medicationCodeableConcept: medicationCode(f, codes),
    subject: ref("Patient", f.patientId),
    encounter: ref("Encounter", f.provenance.encounterId),
    authoredOn: f.recordedAt,
    requester: ref("Practitioner", f.provenance.authorId),
  };
}

export function toFhirProcedure(f: ProcedureFact, codes?: CodeIndex): FhirResource {
  return {
    ...base("Procedure", f),
    status:
      f.status === "entered_in_error"
        ? "entered-in-error"
        : f.outcome === "completed"
          ? "completed"
          : "not-done",
    statusReason: f.outcome === "completed" ? undefined : { text: f.outcome },
    code: conceptCode(f.concept, codes),
    subject: ref("Patient", f.patientId),
    encounter: ref("Encounter", f.provenance.encounterId),
    performedDateTime: "at" in f.effective ? f.effective.at : f.effective.start,
    recorder: ref("Practitioner", f.provenance.authorId),
  };
}

/* ─── Orders, specimens, reports ──────────────────────────────────── */

export type FhirOrderInput = Pick<
  typeof encounterOrders.$inferSelect,
  | "id"
  | "encounterId"
  | "patientUserId"
  | "kind"
  | "text"
  | "loincCode"
  | "priority"
  | "createdAt"
  | "authoredByUserId"
  | "sensitivity"
> & { derivation: OrderDerivation };

const REQUEST_STATE: Record<OrderDerivation["status"]["state"], string> = {
  proposed: "draft",
  active: "active",
  on_hold: "on-hold",
  collected: "active",
  in_progress: "active",
  resulted: "active",
  acknowledged: "completed",
  cancelled: "revoked",
};

export function toFhirServiceRequest(o: FhirOrderInput, codes?: CodeIndex): FhirResource {
  const s = o.derivation.status.state;
  return {
    resourceType: "ServiceRequest",
    id: o.id,
    status: REQUEST_STATE[s],
    intent: s === "proposed" ? "proposal" : "order",
    priority:
      o.priority && ["routine", "urgent", "asap", "stat"].includes(o.priority)
        ? o.priority
        : undefined,
    code: {
      coding:
        o.loincCode && verifiedPair(codes, "LOINC", o.loincCode)
          ? [external({ system: "LOINC", code: o.loincCode })]
          : [],
      text: o.text,
    },
    category: [{ text: o.kind }],
    subject: ref("Patient", o.patientUserId),
    encounter: ref("Encounter", o.encounterId),
    authoredOn: iso(o.createdAt),
    requester: ref("Practitioner", o.authoredByUserId),
  };
}

export type FhirSpecimenInput = Pick<
  Specimen,
  | "id"
  | "orderId"
  | "patientUserId"
  | "specimenType"
  | "container"
  | "collectedAt"
  | "collectedByUserId"
  | "fastingState"
  | "labelNo"
>;

export function toFhirSpecimen(s: FhirSpecimenInput): FhirResource {
  return {
    resourceType: "Specimen",
    id: s.id,
    accessionIdentifier: s.labelNo ? { value: s.labelNo } : undefined,
    type: { coding: [{ system: SYSTEMS.specimen, code: s.specimenType }] },
    subject: ref("Patient", s.patientUserId),
    request: [ref("ServiceRequest", s.orderId)!],
    collection: {
      collectedDateTime: iso(s.collectedAt),
      collector: ref("Practitioner", s.collectedByUserId),
      fastingStatusCodeableConcept: s.fastingState ? { text: s.fastingState } : undefined,
    },
    container: [{ type: { text: s.container } }],
  };
}

export type FhirReportInput = Pick<
  DiagnosticReport,
  | "id"
  | "status"
  | "kind"
  | "orderId"
  | "specimenId"
  | "patientUserId"
  | "encounterId"
  | "effectiveAt"
  | "issuedAt"
  | "performer"
  | "performerLabName"
  | "conclusionCode"
  | "sensitivity"
> & { /** The result observation facts' ids (fact.id). */ resultFactIds: readonly string[] };

const REPORT_CATEGORY: Record<string, string> = { lab: "LAB", imaging: "RAD", ecg: "EC" };

/** `resultIds` are FHIR Observation ids (fhirId), already filtered to what the export includes. */
export function toFhirDiagnosticReport(
  r: FhirReportInput,
  resultIds: readonly string[],
): FhirResource {
  return {
    resourceType: "DiagnosticReport",
    id: r.id,
    status: FACT_STATUS[r.status as FactStatus] ?? "unknown",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0074",
            code: REPORT_CATEGORY[r.kind] ?? "OTH",
          },
        ],
      },
    ],
    code: { text: r.kind },
    basedOn: r.orderId ? [ref("ServiceRequest", r.orderId)!] : undefined,
    subject: ref("Patient", r.patientUserId),
    encounter: ref("Encounter", r.encounterId),
    effectiveDateTime: iso(r.effectiveAt),
    issued: iso(r.issuedAt),
    performer: [{ display: r.performerLabName ?? r.performer }],
    specimen: r.specimenId ? [ref("Specimen", r.specimenId)!] : undefined,
    result: resultIds.map((id) => ref("Observation", id)!),
    conclusionCode: r.conclusionCode ? [{ text: r.conclusionCode }] : undefined,
  };
}

/* ─── Composition (a signed note) ─────────────────────────────────── */

export type FhirNoteInput = Pick<
  ClinicalNote,
  | "id"
  | "noteType"
  | "templateId"
  | "state"
  | "authorUserId"
  | "encounterId"
  | "patientUserId"
  | "signedAt"
  | "addendumTo"
  | "sensitivity"
> & {
  enteredInError?: boolean;
  /** Decrypted section texts, when the exporter may read them. */
  sections?: readonly { title: string; text: string }[];
};

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toFhirComposition(n: FhirNoteInput): FhirResource {
  return {
    resourceType: "Composition",
    id: n.id,
    status: n.enteredInError ? "entered-in-error" : "final",
    type: { text: n.noteType },
    subject: ref("Patient", n.patientUserId),
    encounter: ref("Encounter", n.encounterId),
    date: iso(n.signedAt),
    author: [ref("Practitioner", n.authorUserId)!],
    title: NOTE_TEMPLATES.templates.find((t) => t.id === n.templateId)?.title ?? n.noteType,
    relatesTo: n.addendumTo
      ? [{ code: "appends", targetReference: ref("Composition", n.addendumTo) }]
      : undefined,
    section: n.sections?.map((s) => ({
      title: s.title,
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXml(s.text)}</div>`,
      },
    })),
  };
}

/* ─── Bundle ──────────────────────────────────────────────────────── */

export interface FhirExportInput {
  patient: FhirPatientInput;
  encounters?: readonly FhirEncounterInput[];
  facts?: readonly ClinicalFact[];
  orders?: readonly FhirOrderInput[];
  specimens?: readonly FhirSpecimenInput[];
  reports?: readonly FhirReportInput[];
  notes?: readonly FhirNoteInput[];
}
export interface FhirExportOptions {
  codes?: CodeIndex;
  /** Default false: restricted facts, orders, reports and notes never leave. */
  includeRestricted?: boolean;
}

/** A collection Bundle of the patient's record. Family history (a condition about a relative),
 *  findings, pregnancy and context facts have no resource among the twelve and are left out. */
export function exportBundle(input: FhirExportInput, opts: FhirExportOptions = {}): FhirResource {
  const ok = (s: string | null | undefined) => opts.includeRestricted || s !== "restricted";
  const codes = opts.codes;
  const facts = (input.facts ?? []).filter((f) => ok(f.sensitivity));
  const resources: FhirResource[] = [toFhirPatient(input.patient)];
  resources.push(...(input.encounters ?? []).map(toFhirEncounter));
  const observationIds = new Map<string, string>();
  for (const f of facts) {
    switch (f.kind) {
      case "observation":
        observationIds.set(f.id, fhirId(f));
        resources.push(toFhirObservation(f, codes));
        break;
      case "condition":
        if (f.subject === "self") resources.push(toFhirCondition(f, codes));
        break;
      case "allergy":
        resources.push(toFhirAllergyIntolerance(f));
        break;
      case "medication":
        resources.push(
          f.medicationSource === "prescribed_here"
            ? toFhirMedicationRequest(f, codes)
            : toFhirMedicationStatement(f, codes),
        );
        break;
      case "procedure":
        resources.push(toFhirProcedure(f, codes));
        break;
    }
  }
  const orders = (input.orders ?? []).filter((o) => ok(o.sensitivity));
  const orderIds = new Set(orders.map((o) => o.id));
  resources.push(...orders.map((o) => toFhirServiceRequest(o, codes)));
  // A specimen belongs to its order: an order left out takes its specimens with it.
  const specimens = (input.specimens ?? []).filter((s) => orderIds.has(s.orderId));
  const specimenIds = new Set(specimens.map((s) => s.id));
  resources.push(...specimens.map(toFhirSpecimen));
  for (const r of input.reports ?? []) {
    if (!ok(r.sensitivity)) continue;
    const ids = r.resultFactIds.flatMap((id) => {
      const o = observationIds.get(id);
      return o ? [o] : [];
    });
    // References only to what this export contains: a left-out order or specimen is not named.
    resources.push(
      toFhirDiagnosticReport(
        {
          ...r,
          orderId: r.orderId && orderIds.has(r.orderId) ? r.orderId : null,
          specimenId: r.specimenId && specimenIds.has(r.specimenId) ? r.specimenId : null,
        },
        ids,
      ),
    );
  }
  // An addendum goes only with its parent (it may discuss what the parent restricts).
  const notes = new Map((input.notes ?? []).map((n) => [n.id, n]));
  const kept = (n: FhirNoteInput, depth = 0): boolean =>
    n.state === "signed" &&
    ok(n.sensitivity) &&
    (!n.addendumTo ||
      (depth < notes.size &&
        !!notes.get(n.addendumTo) &&
        kept(notes.get(n.addendumTo)!, depth + 1)));
  resources.push(...[...notes.values()].filter((n) => kept(n)).map(toFhirComposition));
  return {
    resourceType: "Bundle",
    id: `export-${input.patient.patientId}`,
    type: "collection",
    entry: resources.map((r) => ({ fullUrl: `${r.resourceType}/${r.id}`, resource: r })),
  };
}
