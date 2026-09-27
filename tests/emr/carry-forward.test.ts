import type { AllergyStatus } from "@/lib/emr/allergy";
import { describe, expect, it } from "vitest";

import {
  answerStillTrue,
  carryAllergyStatus,
  carryMedicines,
  carryProblems,
  reconciliationFor,
  triagePrefill,
  unanswered,
} from "@/lib/emr/carry-forward";

const TRIAGED = new Date("2026-09-26T07:40:00Z");
const triage = (computedBreakdown: unknown = {}, assignedLevel = 2) => ({
  id: "tr-1",
  assignedLevel,
  triagedAt: TRIAGED,
  computedBreakdown,
});
const SRC = { kind: "triage", triageRecordId: "tr-1", at: TRIAGED };

describe("triage prefill (zero taps, source-marked)", () => {
  it("carries the assigned acuity with its source", () => {
    expect(triagePrefill(triage({}, 1), null).acuity).toEqual({ level: 1, source: SRC });
  });
  it("carries the intake's presenting complaint, trimmed", () => {
    expect(triagePrefill(triage(), "  fever for 3 days ").complaint).toEqual({
      text: "fever for 3 days",
      source: SRC,
    });
  });
  it("a blank complaint carries nothing", () => {
    expect(triagePrefill(triage(), "   ").complaint).toBeNull();
    expect(triagePrefill(triage(), null).complaint).toBeNull();
  });
  it("carries the fired discriminators, each source-marked", () => {
    const p = triagePrefill(
      triage({
        firedDiscriminators: [
          {
            code: "chest_pain_cardiac",
            label: "Cardiac chest pain",
            minAcuity: 2,
            source: "manual",
          },
        ],
      }),
      null,
    );
    expect(p.discriminators).toEqual([
      { code: "chest_pain_cardiac", label: "Cardiac chest pain", source: SRC },
    ]);
  });
  it("duplicate discriminator codes carry once", () => {
    const d = { code: "x", label: "X" };
    expect(
      triagePrefill(triage({ firedDiscriminators: [d, d] }), null).discriminators,
    ).toHaveLength(1);
  });
  it("a malformed breakdown carries no discriminators rather than throwing", () => {
    for (const b of [
      null,
      "text",
      { firedDiscriminators: "nope" },
      { firedDiscriminators: [{ code: 1 }, null] },
    ]) {
      expect(triagePrefill(triage(b), null).discriminators).toEqual([]);
    }
  });
  it("vital signs are shown from the record, never copied", () => {
    const p = triagePrefill(triage({ firedDiscriminators: [] }), null);
    expect(p.vitals).toEqual({ mode: "shown_from_record", triageRecordId: "tr-1" });
    expect(JSON.stringify(p)).not.toMatch(/respiratoryRate|spo2|systolic|pulse|temperature/);
  });
  it("narrative never carries: the prefill has no free text beyond the complaint", () => {
    const p = triagePrefill(
      triage({ reasoning: ["long narrative"], firedDiscriminators: [] }),
      null,
    );
    expect(Object.keys(p).sort()).toEqual(["acuity", "complaint", "discriminators", "vitals"]);
    expect(JSON.stringify(p)).not.toContain("long narrative");
  });
});

const cond = (p: Record<string, unknown> = {}) => ({
  id: "c1",
  logicalId: "L1",
  version: 1,
  category: "problem_list_item",
  subjectRelation: "self",
  clinicalStatus: "active",
  verification: "confirmed",
  status: "final",
  ...p,
});

describe("problem list", () => {
  it("active own problems carry, pending", () => {
    const [c] = carryProblems([cond()]);
    expect(c).toMatchObject({
      kind: "problem",
      key: "L1",
      answer: "pending",
      source: { kind: "record" },
    });
  });
  it("recurrence and relapse carry; inactive, remission and resolved do not", () => {
    const rows = ["active", "recurrence", "relapse", "inactive", "remission", "resolved"].map(
      (s, i) => cond({ id: `c${i}`, logicalId: `L${i}`, clinicalStatus: s }),
    );
    expect(carryProblems(rows).map((c) => c.item.clinicalStatus)).toEqual([
      "active",
      "recurrence",
      "relapse",
    ]);
  });
  it("family history, encounter diagnoses, refuted and voided rows do not carry", () => {
    const rows = [
      cond({ logicalId: "a", subjectRelation: "mother" }),
      cond({ logicalId: "b", category: "encounter_diagnosis" }),
      cond({ logicalId: "c", verification: "refuted" }),
      cond({ logicalId: "d", status: "entered_in_error" }),
    ];
    expect(carryProblems(rows)).toEqual([]);
  });
  it("only the newest version carries (a resolved v2 stops the v1)", () => {
    const rows = [
      cond({ id: "v1", version: 1 }),
      cond({ id: "v2", version: 2, clinicalStatus: "resolved" }),
    ];
    expect(carryProblems(rows)).toEqual([]);
    const rows2 = [cond({ id: "v2", version: 2 }), cond({ id: "v1", version: 1 })];
    expect(carryProblems(rows2).map((c) => c.item.id)).toEqual(["v2"]);
  });
});

const med = (p: Record<string, unknown> = {}) => ({
  id: "m1",
  logicalId: "M1",
  version: 1,
  medicationStatus: "active",
  status: "final",
  ...p,
});

describe("medicines", () => {
  it("active, on hold and intended carry; completed, stopped and unknown do not", () => {
    const rows = ["active", "on_hold", "intended", "completed", "stopped", "unknown"].map((s, i) =>
      med({ logicalId: `M${i}`, medicationStatus: s }),
    );
    expect(carryMedicines(rows).map((m) => m.item.medicationStatus)).toEqual([
      "active",
      "on_hold",
      "intended",
    ]);
  });
  it("voided rows and superseded versions do not carry", () => {
    expect(carryMedicines([med({ status: "entered_in_error" })])).toEqual([]);
    expect(
      carryMedicines([med(), med({ id: "m2", version: 2, medicationStatus: "stopped" })]),
    ).toEqual([]);
  });
  it("each answer maps to the reconciliation value written", () => {
    expect(reconciliationFor("confirmed")).toBe("continued");
    expect(reconciliationFor("stopped")).toBe("stopped");
    expect(reconciliationFor("changed")).toBe("changed");
    expect(reconciliationFor("pending")).toBeNull();
  });
});

describe("allergy status", () => {
  const nkda: AllergyStatus = {
    kind: "no_known_drug_allergies",
    assertedByUserId: "u",
    asserterCadre: "MO",
    assertedAt: TRIAGED,
    hospitalId: "h",
  };
  it("NKDA carries pending, for a one-tap re-confirm at each encounter", () => {
    expect(carryAllergyStatus(nkda)).toMatchObject({
      kind: "allergy_status",
      answer: "pending",
      item: nkda,
    });
  });
  it("listed and unable to assess carry pending too", () => {
    expect(carryAllergyStatus({ kind: "listed", allergies: [] })?.answer).toBe("pending");
    expect(
      carryAllergyStatus({
        kind: "unable_to_assess",
        assertedByUserId: "u",
        assertedAt: TRIAGED,
        hospitalId: "h",
      })?.answer,
    ).toBe("pending");
  });
  it("'not recorded' carries nothing (never an implied NKDA)", () => {
    expect(carryAllergyStatus({ kind: "not_recorded" })).toBeNull();
  });
  it("the status is confirmed or changed, never stopped", () => {
    const item = carryAllergyStatus(nkda)!;
    expect(answerStillTrue(item, "confirmed").answer).toBe("confirmed");
    expect(answerStillTrue(item, "changed").answer).toBe("changed");
    expect(() => answerStillTrue(item, "stopped")).toThrow();
  });
});

describe("one-tap answers", () => {
  it("confirm, stop and change each set the answer without mutating the item", () => {
    const item = carryMedicines([med()])[0]!;
    for (const a of ["confirmed", "stopped", "changed"] as const) {
      expect(answerStillTrue(item, a).answer).toBe(a);
    }
    expect(item.answer).toBe("pending");
  });
  it("answering again replaces; 'pending' undoes", () => {
    const item = carryProblems([cond()])[0]!;
    const twice = answerStillTrue(answerStillTrue(item, "stopped"), "confirmed");
    expect(twice.answer).toBe("confirmed");
    expect(answerStillTrue(twice, "pending").answer).toBe("pending");
  });
  it("unanswered lists what still waits", () => {
    const [a, b] = carryMedicines([med(), med({ id: "m2", logicalId: "M2" })]);
    const answered = [answerStillTrue(a!, "confirmed"), b!];
    expect(unanswered(answered).map((i) => i.key)).toEqual(["M2"]);
  });
});
