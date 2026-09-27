/**
 * Two synthetic clerking-desk payloads (render tests and the scratch fixture harness). The safety
 * bar and context come from the real chart engine (buildChartPayload over projected rows), the
 * template from the real note-template file through the loader's own deskTemplateOf, the vital
 * concepts and exam signs from the catalogue — so a view never sees a shape the desk cannot make.
 *
 *  1. standardVisitMidway(): the standard visit of emr-clinical-reference §2.12, stopped after
 *     step 7 — NKDA confirmed, the medicine continued, fever (3 days) and headache (2 days), chills
 *     present, neck stiffness and rash absent, the seven general signs, "Malaria, uncomplicated"
 *     working and primary, an mRDT ordered (to collect). Signable.
 *  2. internAwaitingCosign(viewer): an intern's signed clerking awaiting co-signature — from the
 *     intern's side (their note, read-only, amber state) or a senior's (Co-sign offered).
 *
 * SYNTHETIC: "Test Patient D/E", made-up MRNs, illustrative values; nothing here is a threshold.
 */
import type { DeskNoteRow, DeskPayload } from "@/components/emr/desk/model";
import type { ChartPayload } from "@/lib/emr/chart";
import type { NoteContent } from "@/lib/emr/note-rules";
import type { ClinicalFact } from "@/lib/facts/types";

import { buildChartPayload } from "@/lib/emr/chart";
import { getTemplate } from "@/lib/emr/notes";
import { deskTemplateOf, generalSigns, vitalConcepts } from "@/lib/emr/read/terms";
import { projectAllergyAssertion } from "@/lib/facts/project/allergy";
import { projectMedication } from "@/lib/facts/project/medication";
import { assertionRow, medicationRow, P, U, uuid } from "../facts/_rows";

export const DESK_TZ = "Africa/Kampala";
const ADULT = getTemplate("tpl.clerking.adult_opd");
const at = (iso: string) => new Date(iso);

function chartOf(
  patient: { name: string; mrn: string; ageYears: number; sex: string },
  medicine: boolean,
): { payload: ChartPayload; medicineRowId: string | null } {
  const assertion = projectAllergyAssertion(
    assertionRow({ assertedAt: at("2026-09-20T08:20:00Z") }),
  );
  if (!assertion.ok) throw new Error(assertion.reason);
  const med = medicationRow({ drugCode: "metformin" });
  const facts: ClinicalFact[] = medicine ? projectMedication(med).facts : [];
  const payload = buildChartPayload({
    patient,
    snapshot: {
      patientId: P,
      asOf: "2026-09-26T00:00:00.000Z",
      manifest: [],
      facts,
      allergyAssertions: [assertion.assertion],
      quarantined: 0,
      hash: "fixture",
    },
    encounters: [],
    orders: [],
    results: [],
    notes: [],
    death: null,
    names: { [U]: "Dr Test Clinician" },
    timeZone: DESK_TZ,
  });
  return { payload, medicineRowId: medicine ? med.id : null };
}

function base(
  chart: ChartPayload,
  over: Partial<DeskPayload> & Pick<DeskPayload, "draft" | "viewer">,
): DeskPayload {
  const bar = chart.safetyBar;
  const encounterId = uuid();
  return {
    encounter: {
      id: encounterId,
      patientUserId: P,
      state: "in_progress",
      open: true,
      typeWord: "Outpatient visit",
      startedAt: "2026-09-20T08:30:00.000Z",
      triageRecordId: uuid(),
    },
    patient: { name: bar.name, mrn: bar.mrn, ageSex: bar.ageSex },
    safetyBar: bar,
    template: deskTemplateOf(ADULT, { sex: "male", ncd: false }),
    signed: null,
    notes: [],
    ros: [
      {
        system: "general",
        label: "General",
        items: [
          { token: "fever", label: "Fever", system: "general" },
          { token: "night_sweats", label: "Night sweats", system: "general" },
          { token: "weight_change", label: "Weight change", system: "general" },
        ],
      },
      {
        system: "respiratory",
        label: "Respiratory",
        items: [
          { token: "cough", label: "Cough", system: "respiratory" },
          { token: "haemoptysis", label: "Haemoptysis", system: "respiratory" },
        ],
      },
    ],
    generalSigns: generalSigns(ADULT),
    vitalConcepts: vitalConcepts(ADULT),
    context: {
      triage: {
        recordId: uuid(),
        level: 3,
        levelWord: "Urgent, stable",
        at: "2026-09-20T08:10:00.000Z",
        complaint: "Fever for three days",
        discriminators: ["Fever"],
      },
      vitals: [
        {
          id: "triage_records:t1:temperature",
          conceptId: "obs.temperature",
          label: "Body temperature",
          value: "38.9",
          unit: "°C",
          at: "2026-09-20T08:10:00.000Z",
          fromTriage: true,
        },
        {
          id: "triage_records:t1:heart_rate",
          conceptId: "obs.heart_rate",
          label: "Heart rate",
          value: "104",
          unit: "/min",
          at: "2026-09-20T08:10:00.000Z",
          fromTriage: true,
        },
      ],
      results: [],
      pendingOrders: chart.summary.pendingOrders,
      medicines: chart.summary.medicines,
      problems: chart.summary.problems,
    },
    suggestions: [],
    carried: { problems: [], medicines: [] },
    diagnoses: [],
    orders: [],
    substances: [
      { kind: "drug_ingredient", code: "adrenaline", label: "Adrenaline (epinephrine)" },
      {
        kind: "drug_class",
        code: "Sympathomimetic vasopressor",
        label: "Sympathomimetic vasopressor",
      },
    ],
    completionWarnings: [],
    flags: { ncd: false, actionsAllowed: bar.actionsAllowed },
    links: {
      chart: `/doctor/patients/${P}`,
      results: `/doctor/patients/${P}#chart-results`,
      orders: null,
      print: {
        summary: `/doctor/encounters/${encounterId}/print/summary`,
        referral: `/doctor/encounters/${encounterId}/print/referral`,
        labRequest: `/doctor/encounters/${encounterId}/print/lab-request`,
      },
    },
    settings: {
      autosaveDebounceMs: 1500,
      closureReasons: [
        "left_before_seen",
        "duplicate_encounter",
        "documented_elsewhere",
        "opened_in_error",
        "other",
      ],
    },
    serverTime: "2026-09-20T09:05:00.000Z",
    timeZone: DESK_TZ,
    ...over,
  };
}

const SENIOR = {
  userId: U,
  cadreWord: "Medical officer",
  senior: true,
  mustCosign: false,
  canFinalDiagnosis: true,
};
const INTERN = {
  userId: "00000000-0000-4000-8000-0000000000e1",
  cadreWord: "Intern doctor",
  senior: false,
  mustCosign: true,
  canFinalDiagnosis: false,
};

/** Steps 1–7 of the standard visit, as the note content holds them. */
export function standardVisitContent(dxId: string, orderId: string): NoteContent {
  const gen = [
    ["sign.pallor", "Pallor"],
    ["sign.jaundice", "Jaundice"],
    ["sign.cyanosis", "Cyanosis"],
    ["sign.clubbing", "Finger clubbing"],
    ["sign.lymphadenopathy", "Lymphadenopathy"],
    ["sign.oedema", "Oedema"],
    ["sign.dehydration", "Dehydration"],
  ].map(([token, label]) => ({ token, label, presence: "absent" }));
  return {
    header: { historian: "patient", language: "Luganda" },
    sections: {
      s01: {
        items: [
          { kind: "complaint_token", token: "fever", label: "Fever", durationDays: 3 },
          { kind: "complaint_token", token: "headache", label: "Headache", durationDays: 2 },
        ],
      },
      s02: {
        narrative: "Three days of fever with chills, worse at night.",
        items: [
          { kind: "finding", token: "chills", label: "Chills", presence: "present" },
          {
            kind: "finding",
            token: "sign.neck_stiffness",
            label: "Neck stiffness",
            presence: "absent",
          },
          { kind: "finding", token: "rash", label: "Rash", presence: "absent" },
        ],
      },
      s11: { items: [{ kind: "exam_finding", group: "general", items: gen }] },
      s13: {
        items: [
          {
            kind: "encounter_diagnosis",
            conditionId: dxId,
            display: "Malaria, uncomplicated",
            code: "1F4Z",
            verification: "provisional",
            rank: "primary",
          },
        ],
      },
      s14: { items: [{ kind: "order", orderId, display: "Malaria rapid diagnostic test (mRDT)" }] },
    },
  };
}

export function standardVisitMidway(): DeskPayload {
  const { payload, medicineRowId } = chartOf(
    { name: "Test Patient D", mrn: "MRN-2026-90004", ageYears: 34, sex: "male" },
    true,
  );
  const dxId = uuid();
  const orderId = uuid();
  return base(payload, {
    viewer: SENIOR,
    draft: { noteId: uuid(), revision: 4, content: standardVisitContent(dxId, orderId) },
    carried: {
      problems: [],
      medicines: [{ id: medicineRowId!, display: "Metformin", answer: "continued" }],
    },
    diagnoses: [
      {
        id: dxId,
        display: "Malaria, uncomplicated",
        code: "1F4Z",
        verification: "provisional",
        rank: "primary",
      },
    ],
    orders: [
      {
        id: orderId,
        display: "Malaria rapid diagnostic test (mRDT)",
        statusText: "To collect",
        at: "2026-09-20T09:00:00.000Z",
        open: true,
      },
    ],
    suggestions: [
      {
        key: "invx_glucose",
        text: "Consider an immediate bedside capillary glucose (altered mentation / stroke mimic).",
        rationale: "Glucose extremes are an instantly reversible, easily missed cause.",
        tests: [{ testId: uuid(), display: "Random blood glucose (laboratory)" }],
        state: "open",
      },
    ],
    completionWarnings: [
      "Your clerking note is not signed yet.",
      "1 order not yet collected: Malaria rapid diagnostic test (mRDT).",
    ],
  });
}

export function internAwaitingCosign(viewer: "intern" | "senior" = "intern"): DeskPayload {
  const { payload } = chartOf(
    { name: "Test Patient E", mrn: "MRN-2026-90005", ageYears: 41, sex: "female" },
    false,
  );
  const intern = viewer === "intern";
  const note: DeskNoteRow = {
    id: uuid(),
    title: "Adult outpatient clerking",
    author: "Dr Test Intern (INTERN_DOCTOR)",
    at: "2026-09-20T10:40:00.000Z",
    status: "awaiting_cosign",
    statusText: "Awaiting co-signature",
    tone: "caution",
    mine: intern,
    lateEntry: false,
    eieReason: null,
    addenda: [],
    canCosign: !intern,
    canMarkError: true,
  };
  const content = standardVisitContent(uuid(), uuid());
  return base(payload, {
    template: deskTemplateOf(ADULT, { sex: "female", ncd: false }),
    viewer: intern ? INTERN : SENIOR,
    draft: intern ? null : { noteId: null, revision: null, content: { sections: {} } },
    signed: intern ? { note, content } : null,
    notes: [note],
  });
}

export const DESK_FIXTURES = { standardVisitMidway, internAwaitingCosign };
