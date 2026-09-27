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
import type { PregnancyAgeRange } from "@/lib/emr/reference/pregnancy";
import type { Projection } from "@/lib/facts/project/shared";
import type { AllergyAssertion, ClinicalFact } from "@/lib/facts/types";
import type { RefEntry } from "@/lib/resus/reference/ref";
import { describe, expect, it } from "vitest";

import { buildChartPayload, toPatientFacing } from "@/lib/emr/chart";
import { deriveOrderStatus } from "@/lib/emr/orders";
import { REF_PREG_AGE } from "@/lib/emr/reference/pregnancy";
import { projectAllergy, projectAllergyAssertion } from "@/lib/facts/project/allergy";
import { projectCondition } from "@/lib/facts/project/condition";
import { projectMedication } from "@/lib/facts/project/medication";
import { projectObservation } from "@/lib/facts/project/observation";
import { projectPregnancy } from "@/lib/facts/project/pregnancy";
import { projectProcedure } from "@/lib/facts/project/procedure";
import {
  allergyRow,
  assertionRow,
  cfcRowFor,
  conditionRow,
  H,
  medicationRow,
  P,
  pregnancyRow,
  procedureRow,
  U,
  uuid,
} from "./facts/_rows";

/**
 * lib/emr/chart.ts. Values are synthetic; the only "signed" references are TEST-ONLY fixtures that
 * prove a mechanism (the shipped entries are all pending_cso).
 */

const at = (iso: string) => new Date(iso);
const facts = (...ps: Projection[]): ClinicalFact[] =>
  ps
    .map((p) => {
      if (p.facts.length === 0)
        throw new Error(`fixture quarantined: ${JSON.stringify(p.quarantined)}`);
      return p.facts;
    })
    .flat();
const assertion = (over: Parameters<typeof assertionRow>[0] = {}): AllergyAssertion => {
  const r = projectAllergyAssertion(assertionRow(over));
  if (!r.ok) throw new Error(r.reason);
  return r.assertion;
};

function input(
  over: Partial<ChartInput> & { facts?: ClinicalFact[]; assertions?: AllergyAssertion[] } = {},
): ChartInput {
  const { facts: fs = [], assertions = [], ...rest } = over;
  return {
    patient: { name: "Test Patient", mrn: "MRN-0001", ageYears: 40, sex: "female" },
    snapshot: {
      patientId: P,
      asOf: "2026-03-20T00:00:00.000Z",
      manifest: [],
      facts: fs,
      allergyAssertions: assertions,
      quarantined: 0,
      hash: "h",
    },
    encounters: [],
    orders: [],
    results: [],
    notes: [],
    death: null,
    names: { [U]: "Dr Test Author" },
    ...rest,
  };
}
const build = (over: Parameters<typeof input>[0] = {}) => buildChartPayload(input(over));

const encounter = (over: Partial<ChartEncounterInput> = {}): ChartEncounterInput => ({
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
const order = (over: Partial<ChartOrderInput> & { status?: string } = {}): ChartOrderInput => {
  const id = uuid();
  const { status = "ordered", ...rest } = over;
  return {
    derivation: deriveOrderStatus({ id, lifecycle: "legacy", status, kind: "lab" }),
    kind: "lab",
    display: "Full blood count",
    priority: "routine",
    orderedAt: at("2026-03-01T10:40:00Z"),
    sensitivity: "standard",
    ...rest,
  };
};
const result = (over: Partial<ChartResultInput> = {}): ChartResultInput => ({
  reportId: uuid(),
  display: "Potassium",
  issuedAt: at("2026-03-01T10:31:00Z"),
  ack: { kind: "needs_review" },
  critical: false,
  sensitivity: "standard",
  ...over,
});
const note = (over: Partial<ChartNoteInput> = {}): ChartNoteInput => ({
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
const eie = (noteId: string, over: Partial<ChartNoteEventInput> = {}): ChartNoteEventInput => ({
  id: uuid(),
  noteId,
  kind: "entered_in_error",
  actorUserId: U,
  cosignRequestId: null,
  recordedAt: at("2026-03-02T09:00:00Z"),
  reasonCode: "wrong_patient",
  ...over,
});
const signedPregAge = (
  fromYears: number,
  toYears: number,
): RefEntry & { data: PregnancyAgeRange } => ({
  ...REF_PREG_AGE,
  status: "signed",
  value: `${fromYears}-${toYears}`,
  data: { fromYears, toYears },
});

const hypertension = () => projectCondition(conditionRow({ conceptId: "cond.hypertension" }));
const hiv = () => projectCondition(conditionRow({ conceptId: "cond.hiv" }));

/* ─── Safety bar ──────────────────────────────────────────────────── */

describe("safety bar: identifiers", () => {
  it("shows two identifiers and age/sex in words", () => {
    const b = build({
      patient: { name: "Amina N", mrn: "MRN-4812", ageYears: 52, sex: "F" },
    }).safetyBar;
    expect([b.name, b.mrn, b.ageSex]).toEqual(["Amina N", "MRN-4812", "52 y · Female"]);
  });
  it("says what is missing rather than guessing", () => {
    const b = build({ patient: { name: "X", mrn: "M", ageYears: null, sex: null } }).safetyBar;
    expect(b.ageSex).toBe("Age not recorded · Sex not recorded");
  });
  it("reads a screen-reader sentence first: name, age, MRN, allergies, critical", () => {
    const b = build({
      facts: facts(projectAllergy(allergyRow())),
      results: [result({ critical: true })],
    }).safetyBar;
    expect(b.accessibleSummary).toContain("Test Patient, 40 y, Female, MRN MRN-0001.");
    expect(b.accessibleSummary).toContain("Allergies: Penicillin — anaphylaxis, high, confirmed.");
    expect(b.accessibleSummary).toContain("1 critical result awaiting acknowledgement.");
  });
});

describe("safety bar: allergy line", () => {
  it("not recorded stays not recorded (caution), never NKDA", () => {
    const a = build().safetyBar.allergy;
    expect(a).toMatchObject({
      state: "not_recorded",
      text: "Allergy status not recorded",
      tone: "caution",
    });
  });
  it("NKDA names who confirmed it and when", () => {
    const a = build({ assertions: [assertion({ assertedAt: at("2026-03-12T08:00:00Z") })] })
      .safetyBar.allergy;
    expect(a.state).toBe("no_known_drug_allergies");
    expect(a.text).toBe("No known drug allergies — confirmed by Dr Test Author, 12 Mar 2026");
    expect(a.tone).toBe("neutral");
  });
  it("unable to assess is amber with the time recorded", () => {
    const a = build({
      assertions: [
        assertion({ assertion: "unable_to_assess", assertedAt: at("2026-03-12T06:12:00Z") }),
      ],
    }).safetyBar.allergy;
    expect(a).toMatchObject({
      state: "unable_to_assess",
      tone: "caution",
      text: "Unable to assess — recorded 09:12, 12 Mar 2026",
    });
  });
  it("lists worst criticality first", () => {
    const a = build({
      facts: facts(
        projectAllergy(
          allergyRow({
            substanceCode: "ceftriaxone",
            criticality: "low",
            severity: "mild",
            manifestations: ["rash"],
            verification: "unconfirmed",
          }),
        ),
        projectAllergy(allergyRow()),
      ),
    }).safetyBar.allergy;
    expect(a.state).toBe("listed");
    expect(a.items.map((i) => i.text)).toEqual([
      "Penicillin — anaphylaxis, high, confirmed",
      "Ceftriaxone — rash",
    ]);
  });
  it("an active allergy outranks an NKDA assertion", () => {
    const a = build({ facts: facts(projectAllergy(allergyRow())), assertions: [assertion()] })
      .safetyBar.allergy;
    expect(a.state).toBe("listed");
  });
  it("an uncoded substance is labelled by name only", () => {
    const f = facts(
      projectAllergy(
        allergyRow({ substanceCode: null, substanceKind: null, substanceTextCiphertext: "x" }),
        { text: "Sulfa drugs" },
      ),
    );
    const a = build({ facts: f }).safetyBar.allergy;
    expect(a.items[0]).toMatchObject({
      byNameOnly: true,
      text: "Sulfa drugs — anaphylaxis, high, confirmed · by name only",
    });
  });
  it("refuted and entered-in-error allergies are not listed, and do not become NKDA", () => {
    const a = build({
      facts: facts(
        projectAllergy(allergyRow({ verification: "refuted", reasonCode: "tolerated" })),
        projectAllergy(allergyRow({ status: "entered_in_error" })),
      ),
    }).safetyBar.allergy;
    expect(a.state).toBe("not_recorded");
  });
});

describe("safety bar: pregnancy line", () => {
  it("is absent while REF-PREG-AGE is pending and nothing is recorded", () => {
    expect(REF_PREG_AGE.status).toBe("pending_cso");
    expect(build().safetyBar.pregnancy).toBeNull();
  });
  it("prompts 'not recorded' only once the age range is signed (test fixture) and applies", () => {
    const ref = signedPregAge(10, 60);
    expect(build({ pregnancyAgeRef: ref }).safetyBar.pregnancy).toMatchObject({
      text: "Pregnancy status not recorded",
      tone: "caution",
    });
    expect(build({ pregnancyAgeRef: signedPregAge(50, 60) }).safetyBar.pregnancy).toBeNull();
    const male = input({ pregnancyAgeRef: ref });
    male.patient.sex = "male";
    expect(buildChartPayload(male).safetyBar.pregnancy).toBeNull();
  });
  it("shows a recorded pregnancy even while the reference is pending", () => {
    const p = build({ facts: facts(projectPregnancy(pregnancyRow())) }).safetyBar.pregnancy;
    expect(p?.text).toBe("Pregnant — 8 weeks on 1 Mar 2026");
  });
  it("words not pregnant with its date", () => {
    const p = build({
      facts: facts(
        projectPregnancy(
          pregnancyRow({
            pregnancyState: "not_pregnant",
            lnmp: null,
            edd: null,
            outcome: null,
            deliveredAt: null,
            birthWeightGrams: null,
          }),
        ),
      ),
    }).safetyBar.pregnancy;
    expect(p?.text).toBe("Not pregnant (recorded 1 Mar 2026)");
  });
});

describe("safety bar: deceased, problems, critical, restricted", () => {
  it("shows a neutral died chip and removes actions", () => {
    const b = build({
      death: {
        patientId: P,
        atMs: Date.parse("2026-03-12T08:06:00Z"),
        source: "encounter",
        sourceId: "e",
        byName: null,
      },
    }).safetyBar;
    expect(b.deceased?.text).toBe("Died 11:06, 12 Mar 2026");
    expect(b.actionsAllowed).toBe(false);
    expect(build().safetyBar.actionsAllowed).toBe(true);
  });
  it("shows the top three active problems, confirmed first, and counts the rest", () => {
    const b = build({
      facts: facts(
        projectCondition(conditionRow({ conceptId: "cond.ckd", verification: "provisional" })),
        hypertension(),
        projectCondition(conditionRow({ conceptId: "cond.dm_type2" })),
        projectCondition(conditionRow({ conceptId: "cond.heart_failure" })),
      ),
    }).safetyBar;
    expect(b.problems.map((p) => p.display)).not.toContain("Chronic kidney disease");
    expect(b.problems).toHaveLength(3);
    expect(b.moreProblems).toBe(1);
  });
  it("leaves out resolved, refuted, entered-in-error and family-history conditions", () => {
    const b = build({
      facts: facts(
        projectCondition(
          conditionRow({ conceptId: "cond.hypertension", clinicalStatus: "resolved" }),
        ),
        projectCondition(conditionRow({ conceptId: "cond.ckd", verification: "refuted" })),
        projectCondition(conditionRow({ conceptId: "cond.dm_type2", subjectRelation: "mother" })),
        projectCondition(
          conditionRow({ conceptId: "cond.heart_failure", status: "entered_in_error" }),
        ),
      ),
    }).safetyBar;
    expect(b.problems).toEqual([]);
  });
  it("one chip per concept", () => {
    const b = build({ facts: facts(hypertension(), hypertension()) }).safetyBar;
    expect(b.problems).toHaveLength(1);
  });
  it("counts unacknowledged critical results only", () => {
    const b = build({
      results: [
        result({ critical: true }),
        result({ critical: true, ack: { kind: "needs_re_ack", previousAction: "seen" } }),
        result({
          critical: true,
          ack: {
            kind: "acknowledged",
            action: "seen",
            byUserId: U,
            at: at("2026-03-01T11:00:00Z"),
            forwardedToUserId: null,
          },
        }),
        result({ critical: true, ack: { kind: "withdrawn", status: "entered_in_error" } }),
        result({ critical: false }),
      ],
    }).safetyBar;
    expect(b.criticalUnacknowledged).toHaveLength(2);
    expect(b.criticalText).toBe("2 critical results awaiting acknowledgement");
    expect(build().safetyBar.criticalText).toBeNull();
  });
  it("sets the restricted marker when any restricted item exists, and only then", () => {
    expect(build({ facts: facts(hiv()) }).safetyBar.restricted).toBe(true);
    expect(build({ notes: [note({ sensitivity: "restricted" })] }).safetyBar.restricted).toBe(true);
    expect(build({ facts: facts(hypertension()) }).safetyBar.restricted).toBe(false);
  });
});

/* ─── Summary ─────────────────────────────────────────────────────── */

describe("summary", () => {
  it("lists current medicines; stopped ones leave", () => {
    const s = build({
      facts: facts(
        projectMedication(medicationRow()),
        projectMedication(medicationRow({ drugCode: "amlodipine", medicationStatus: "stopped" })),
      ),
    }).summary;
    expect(s.medicines.map((m) => m.display)).toEqual(["Metformin"]);
  });
  it("shows the last three encounters, newest first, with disposition words; entered in error is gone", () => {
    const s = build({
      encounters: [
        encounter({
          startedAt: at("2026-01-10T08:00:00Z"),
          encounterType: "emergency",
          disposition: "deceased",
        }),
        encounter({
          startedAt: at("2026-02-02T08:00:00Z"),
          disposition: "discharge",
          closureKind: null,
        }),
        encounter({ startedAt: at("2026-03-12T08:00:00Z") }),
        encounter({ startedAt: at("2026-03-13T08:00:00Z"), state: "entered_in_error" }),
        encounter({ startedAt: at("2025-12-01T08:00:00Z") }),
      ],
    }).summary;
    expect(s.encounters.map((e) => e.title)).toEqual([
      "12 Mar 2026 · OPD",
      "2 Feb 2026 · OPD",
      "10 Jan 2026 · Emergency",
    ]);
    expect(s.encounters[0]!.detail).toBe("Completed · Home");
    expect(s.encounters[1]!.detail).toBe("Legacy completed · Home");
    expect(s.encounters[2]!.detail).toBe("Completed · Died");
  });
  it("puts abnormal results first and gives no flag without a laboratory range", () => {
    const s = build({
      facts: facts(
        projectObservation(
          cfcRowFor("obs.potassium", undefined, { effectiveAt: at("2026-03-12T08:00:00Z") }),
        ),
        projectObservation(
          cfcRowFor("obs.haemoglobin", undefined, {
            effectiveAt: at("2026-03-01T08:00:00Z"),
            context: { labInterpretation: "L" },
          }),
        ),
      ),
    }).summary;
    expect(s.results.map((r) => r.conceptId)).toEqual(["obs.haemoglobin", "obs.potassium"]);
    expect(s.results[0]).toMatchObject({ abnormal: true });
    expect(s.results[1]).toMatchObject({ flag: null, abnormal: false });
  });
  it("keeps vitals out of the results card", () => {
    const s = build({ facts: facts(projectObservation(cfcRowFor("obs.heart_rate"))) }).summary;
    expect(s.results).toEqual([]);
  });
  it("lists pending orders with status words; resulted and cancelled are not pending", () => {
    const s = build({
      orders: [
        order(),
        order({ status: "collected", display: "Malaria RDT" }),
        order({ status: "resulted" }),
        order({ status: "cancelled" }),
      ],
    }).summary;
    expect(s.pendingOrders.map((o) => [o.display, o.status])).toEqual([
      ["Full blood count", "To collect"],
      ["Malaria RDT", "Collected"],
    ]);
  });
});

/* ─── Flowsheet ───────────────────────────────────────────────────── */

describe("flowsheet", () => {
  const k = (iso: string, value: string, over: object = {}) =>
    projectObservation(
      cfcRowFor("obs.potassium", undefined, {
        effectiveAt: at(iso),
        valueNum: value,
        valueCanonical: value,
        ...over,
      }),
    );

  it("is concepts down, dates across, with a canonical series oldest first", () => {
    const f = build({
      facts: facts(k("2026-03-11T08:00:00Z", "5"), k("2026-03-10T08:00:00Z", "4")),
    }).flowsheet;
    expect(f.dates).toEqual(["2026-03-10", "2026-03-11"]);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]!.series.map((p) => p.value)).toEqual([4, 5]);
    expect(f.rows[0]!.cells.map((c) => c.value)).toEqual(["4 mmol/L", "5 mmol/L"]);
  });
  it("shows the laboratory's own flag as text", () => {
    const f = build({
      facts: facts(k("2026-03-11T08:00:00Z", "5", { context: { labInterpretation: "H" } })),
    }).flowsheet;
    expect(f.rows[0]!.cells[0]!.flag).toBe("Lab flag: high");
  });
  it("marks critical only from a signed entry (none shipped signed)", () => {
    const one = facts(k("2026-03-11T08:00:00Z", "9"));
    expect(build({ facts: one }).flowsheet.rows[0]!.cells[0]!.critical).toBe(false);
    const testSigned: CriticalRef = {
      id: "TEST-CRIT-K",
      text: "test only",
      value: "1",
      source: "TEST",
      url: "test",
      verifiedOn: "2026-09-26",
      confidence: "design",
      status: "signed",
      conceptId: "obs.potassium",
      operator: ">",
    };
    const b = build({ facts: one, criticalRefs: [testSigned] });
    expect(b.flowsheet.rows[0]!.cells[0]!.critical).toBe(true);
    expect(b.summary.results[0]!.critical).toBe(true);

    // Missing context (no specimen) makes a value non-interpretable for rules that need it,
    // but it must never hide an alarm.
    const noSpecimen = facts(k("2026-03-11T08:00:00Z", "9", { specimen: null }));
    expect(noSpecimen[0]!.interpretable.ok).toBe(false);
    const c = build({ facts: noSpecimen, criticalRefs: [testSigned] });
    expect(c.flowsheet.rows[0]!.cells[0]!.critical).toBe(true);
    expect(c.summary.results[0]!.critical).toBe(true);
  });
  it("words coded values", () => {
    const f = build({ facts: facts(projectObservation(cfcRowFor("obs.hiv_test"))) }).flowsheet;
    expect(f.rows[0]!.cells[0]!.value).toBe("Reactive");
  });
});

/* ─── Notes and timeline ──────────────────────────────────────────── */

describe("notes", () => {
  it("threads addenda under their parent", () => {
    const parent = note();
    const add = note({
      noteType: "addendum",
      addendumTo: parent.id,
      templateId: "tpl.addendum",
      signedAt: at("2026-03-01T14:05:00Z"),
    });
    const n = build({ notes: [add, parent] }).notes;
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toBe("Adult outpatient clerking");
    expect(n[0]!.addenda.map((a) => [a.id, a.title])).toEqual([[add.id, "Addendum"]]);
  });
  it("keeps entered-in-error notes visible, struck, with the reason", () => {
    const n1 = note();
    const n2 = note();
    const out = build({
      notes: [n1, n2],
      noteEvents: [
        eie(n1.id),
        eie(n2.id, { reasonCode: null, reasonText: "Documented on the wrong chart" }),
      ],
    }).notes;
    const byId = Object.fromEntries(out.map((n) => [n.id, n]));
    expect(byId[n1.id]).toMatchObject({
      struck: true,
      eieReason: "Wrong patient",
      statusText: "Entered in error — Wrong patient",
    });
    expect(byId[n2.id]!.eieReason).toBe("Documented on the wrong chart");
  });
  it("leaves drafts out and marks late entries and awaiting co-signature", () => {
    const signed = note({ lateEntry: true });
    const out = build({
      notes: [note({ state: "draft", signedAt: null }), signed],
      noteEvents: [
        {
          id: uuid(),
          noteId: signed.id,
          kind: "cosign_requested",
          actorUserId: U,
          cosignRequestId: uuid(),
          recordedAt: at("2026-03-01T11:00:00Z"),
          reasonCode: null,
        },
      ],
    }).notes;
    expect(out).toHaveLength(1);
    expect(out[0]!.statusText).toBe("Awaiting co-signature · Late entry");
  });
});

describe("timeline", () => {
  it("is every kind in reverse order", () => {
    const t = build({
      encounters: [encounter({ startedAt: at("2026-03-01T08:00:00Z") })],
      notes: [note({ signedAt: at("2026-03-01T10:52:00Z") })],
      orders: [order({ orderedAt: at("2026-03-01T09:00:00Z") })],
      results: [result({ issuedAt: at("2026-03-01T12:00:00Z") })],
      facts: facts(projectProcedure(procedureRow({ effectiveAt: at("2026-03-01T08:30:00Z") }))),
    }).timeline;
    expect(t.map((i) => i.kind)).toEqual(["result", "note", "order", "procedure", "encounter"]);
    expect(t.every((i) => typeof i.restricted === "boolean")).toBe(true);
  });
});

/* ─── Entered in error: withdrawn, never vanished (Law 4) ────────────── */

describe("entered in error", () => {
  const voided = () => {
    const bp = facts(
      projectObservation(
        cfcRowFor("obs.potassium", undefined, {
          status: "entered_in_error",
          effectiveAt: at("2026-03-03T08:00:00Z"),
          valueNum: "5",
          valueCanonical: "5",
        }),
      ),
    );
    const dx = facts(
      projectCondition(
        conditionRow({ conceptId: "cond.hypertension", status: "entered_in_error" }),
      ),
    );
    const allergy = facts(
      projectAllergy(allergyRow({ substanceCode: "penicillin", status: "entered_in_error" })),
    );
    const med = facts(projectMedication(medicationRow({ status: "entered_in_error" })));
    const secret = facts(
      projectCondition(
        conditionRow({
          conceptId: "cond.hiv",
          status: "entered_in_error",
          sensitivity: "restricted",
        }),
      ),
    );
    return { bp: bp[0]!, dx: dx[0]!, allergy: allergy[0]!, med: med[0]!, secret: secret[0]! };
  };

  it("carries voided facts struck, with the reason, in the Timeline and each section's history", () => {
    const v = voided();
    const eieEncounter = encounter({ state: "entered_in_error", closureReason: "opened_in_error" });
    const p = build({
      facts: [v.bp, v.dx, v.allergy, v.med, v.secret],
      encounters: [eieEncounter],
      eieReasons: {
        [v.bp.provenance.rowId]: { code: null, text: "Wrong patient: transcribed onto this chart" },
        [v.dx.provenance.rowId]: { code: "wrong_patient", text: null },
      },
    });
    // The engines' view is unchanged: nothing voided counts as current.
    expect(p.summary.problems).toEqual([]);
    expect(p.summary.medicines).toEqual([]);
    expect(p.summary.allergies.state).toBe("not_recorded");
    expect(p.flowsheet.rows).toEqual([]);
    expect(p.summary.encounters).toEqual([]);

    const bySection = (s: string) => p.enteredInError.filter((i) => i.section === s);
    expect(bySection("results")).toMatchObject([
      {
        id: v.bp.id,
        title: "Potassium 5 mmol/L",
        reason: "Wrong patient: transcribed onto this chart",
      },
    ]);
    expect(
      bySection("problems")
        .map((i) => [i.title, i.reason, i.restricted])
        .sort(),
    ).toEqual([
      ["HIV infection", "Reason not recorded", true],
      ["Hypertension", "Wrong patient", false],
    ]);
    expect(bySection("allergies")).toHaveLength(1);
    expect(bySection("medicines")).toHaveLength(1);

    const struck = p.timeline.filter((t) => t.struck);
    expect(struck.map((t) => t.id).sort()).toEqual(
      [v.bp.id, v.dx.id, v.allergy.id, v.med.id, v.secret.id, eieEncounter.id].sort(),
    );
    expect(struck.find((t) => t.id === eieEncounter.id)).toMatchObject({
      kind: "encounter",
      detail: "Entered in error — Opened in error",
    });
    expect(struck.find((t) => t.id === v.bp.id)!.detail).toBe(
      "Entered in error — Wrong patient: transcribed onto this chart",
    );
  });

  it("a struck note is struck in the Timeline too", () => {
    const n = note();
    const t = build({ notes: [n], noteEvents: [eie(n.id)] }).timeline;
    expect(t).toMatchObject([{ id: n.id, kind: "note", struck: true }]);
  });

  it("shows a patient none of it: no voided item, no reason", () => {
    const v = voided();
    const n = note();
    const pf = toPatientFacing(
      build({
        facts: [v.bp, v.dx],
        notes: [n],
        noteEvents: [eie(n.id, { reasonCode: null, reasonText: "Documented on the wrong chart" })],
        eieReasons: { [v.bp.provenance.rowId]: { code: null, text: "Transcription slip" } },
      }),
    );
    expect(pf.enteredInError).toEqual([]);
    expect(pf.timeline.some((t) => t.struck)).toBe(false);
    const json = JSON.stringify(pf);
    for (const s of [v.bp.id, v.dx.id, "Transcription slip", "Documented on the wrong chart"])
      expect(json).not.toContain(s);
  });
});

/* ─── Patient-facing ──────────────────────────────────────────────── */

describe("toPatientFacing", () => {
  it("strips restricted problems, results, notes and orders, and recomputes the bar", () => {
    const p = build({
      facts: facts(hiv(), hypertension(), projectObservation(cfcRowFor("obs.hiv_viral_load"))),
      notes: [note({ sensitivity: "restricted" }), note()],
      orders: [order({ sensitivity: "restricted" }), order()],
      results: [result({ sensitivity: "restricted", critical: true })],
    });
    expect(p.safetyBar.problems).toHaveLength(2);
    const pf = toPatientFacing(p);
    expect(pf.audience).toBe("patient");
    expect(pf.safetyBar.problems.map((x) => x.conceptId)).toEqual(["cond.hypertension"]);
    expect(pf.safetyBar.restricted).toBe(false);
    expect(pf.safetyBar.criticalText).toBeNull();
    expect(pf.notes).toHaveLength(1);
    expect(pf.summary.pendingOrders).toHaveLength(1);
    expect(pf.flowsheet.rows).toEqual([]);
    expect(pf.safetyBar.accessibleSummary).not.toContain("HIV");
  });
  it("an addendum under a restricted note is restricted with it", () => {
    const parent = note({ sensitivity: "restricted" });
    const add = note({ noteType: "addendum", addendumTo: parent.id, templateId: "tpl.addendum" });
    const p = build({ notes: [parent, add] });
    expect(p.notes[0]!.addenda[0]!.restricted).toBe(true);
    expect(toPatientFacing(p).notes).toEqual([]);
  });
  it("a list emptied by stripping reads not recorded, never NKDA", () => {
    const p = build({
      facts: facts(projectAllergy(allergyRow({ sensitivity: "restricted" }))),
      assertions: [],
    });
    expect(p.safetyBar.allergy.state).toBe("listed");
    expect(toPatientFacing(p).safetyBar.allergy).toMatchObject({
      state: "not_recorded",
      tone: "caution",
    });
  });
  it("hides a restricted pregnancy line", () => {
    const p = build({
      facts: facts(projectPregnancy(pregnancyRow({ sensitivity: "restricted" }))),
    });
    expect(p.safetyBar.pregnancy?.restricted).toBe(true);
    expect(toPatientFacing(p).safetyBar.pregnancy).toBeNull();
  });
});

/* ─── Property: nothing restricted reaches a patient; missing is never normal ─ */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONDS = ["cond.hypertension", "cond.dm_type2", "cond.hiv", "cond.tuberculosis", "cond.ckd"];
const OBS = [
  "obs.potassium",
  "obs.haemoglobin",
  "obs.hiv_viral_load",
  "obs.hiv_test",
  "obs.heart_rate",
];

function world(seed: number) {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const n = (max: number) => Math.floor(rnd() * (max + 1));
  const sens = () => (rnd() < 0.3 ? "restricted" : "standard");
  const day = () => at(`2026-03-${String(1 + n(27)).padStart(2, "0")}T0${n(9)}:00:00Z`);
  const fs: ClinicalFact[] = [];
  for (let i = n(5); i > 0; i--)
    fs.push(
      ...facts(
        projectCondition(
          conditionRow({
            conceptId: pick(CONDS),
            sensitivity: sens(),
            clinicalStatus: pick(["active", "resolved"]),
            effectiveAt: day(),
          }),
        ),
      ),
    );
  for (let i = n(8); i > 0; i--)
    fs.push(
      ...facts(
        projectObservation(
          cfcRowFor(pick(OBS), undefined, { sensitivity: sens(), effectiveAt: day() }),
        ),
      ),
    );
  for (let i = n(3); i > 0; i--)
    fs.push(
      ...facts(
        projectAllergy(
          allergyRow({
            sensitivity: sens(),
            substanceCode: pick(["penicillin", "ceftriaxone", null]),
            clinicalStatus: pick(["active", "active", "resolved"]),
            verification: pick(["confirmed", "unconfirmed"]),
            status: pick(["final", "final", "entered_in_error"]),
          }),
        ),
      ).map((f) =>
        f.kind === "allergy" && !f.substance.code
          ? { ...f, substance: { text: "Typed substance" } }
          : f,
      ),
    );
  if (rnd() < 0.5) fs.push(...facts(projectMedication(medicationRow({ sensitivity: sens() }))));
  if (rnd() < 0.3) fs.push(...facts(projectPregnancy(pregnancyRow({ sensitivity: sens() }))));
  if (rnd() < 0.3) fs.push(...facts(projectProcedure(procedureRow({ sensitivity: sens() }))));
  const assertions =
    rnd() < 0.5
      ? [assertion({ assertion: pick(["no_known_drug_allergies", "unable_to_assess"]) })]
      : [];
  const notes: ChartNoteInput[] = [];
  for (let i = n(4); i > 0; i--) {
    const parent = note({ sensitivity: sens(), signedAt: day() });
    notes.push(parent);
    if (rnd() < 0.5)
      notes.push(
        note({
          noteType: "addendum",
          addendumTo: parent.id,
          templateId: "tpl.addendum",
          sensitivity: sens(),
          signedAt: day(),
        }),
      );
  }
  return input({
    facts: fs,
    assertions,
    notes,
    orders: Array.from({ length: n(3) }, () =>
      order({ sensitivity: sens(), status: pick(["ordered", "collected", "resulted"]) }),
    ),
    results: Array.from({ length: n(3) }, () =>
      result({ sensitivity: sens(), critical: rnd() < 0.5 }),
    ),
    encounters: Array.from({ length: n(3) }, () =>
      encounter({ sensitivity: sens(), startedAt: day() }),
    ),
  });
}

function restrictedIds(w: ChartInput): string[] {
  return [
    ...w.snapshot.facts
      .filter((f) => f.sensitivity === "restricted")
      .flatMap((f) => [f.id, f.provenance.rowId]),
    ...w.notes.filter((x) => x.sensitivity === "restricted").map((x) => x.id),
    ...w.orders.filter((x) => x.sensitivity === "restricted").map((x) => x.derivation.orderId),
    ...w.results.filter((x) => x.sensitivity === "restricted").map((x) => x.reportId),
    ...w.encounters.filter((x) => x.sensitivity === "restricted").map((x) => x.id),
  ];
}

describe("property (200 seeds)", () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
  it("no restricted item ever appears in the patient-facing payload", () => {
    let restrictedSeen = 0;
    for (const seed of seeds) {
      const w = world(seed);
      const clinician = buildChartPayload(w);
      const json = JSON.stringify(toPatientFacing(clinician));
      const ids = restrictedIds(w);
      restrictedSeen += ids.length;
      for (const id of ids) expect(json, `seed ${seed}: ${id}`).not.toContain(id);
      expect(json, `seed ${seed}`).not.toContain('"restricted":true');
      if (ids.length) expect(clinician.safetyBar.restricted, `seed ${seed}`).toBe(true);
    }
    expect(restrictedSeen).toBeGreaterThan(200); // the generator really produces restricted items
  });
  it("missing is never rendered as normal: not recorded stays not recorded, NKDA only when asserted", () => {
    for (const seed of seeds) {
      const w = world(seed);
      const clinician = buildChartPayload(w);
      const patient = toPatientFacing(clinician);
      const hasAssertion = (w.snapshot.allergyAssertions ?? []).length > 0;
      for (const p of [clinician, patient] as ChartPayload[]) {
        const a = p.safetyBar.allergy;
        if (a.state === "no_known_drug_allergies") expect(hasAssertion, `seed ${seed}`).toBe(true);
        if (a.state === "not_recorded")
          expect(a).toMatchObject({ text: "Allergy status not recorded", tone: "caution" });
        if (a.state === "listed") expect(a.items.length, `seed ${seed}`).toBeGreaterThan(0);
      }
      if (clinician.safetyBar.allergy.state === "not_recorded")
        expect(patient.safetyBar.allergy.state).toBe("not_recorded");
      if (clinician.safetyBar.allergy.state === "listed")
        expect(patient.safetyBar.allergy.state).toMatch(/^(listed|not_recorded)$/);
      expect(JSON.stringify(buildChartPayload(w)), `seed ${seed} deterministic`).toBe(
        JSON.stringify(clinician),
      );
    }
  });
});
