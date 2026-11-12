/**
 * The one Prescribe (prescribing kit P1, F2–F3), pure parts: supply quantity from the product's own
 * strength and pack, weight-band and per-kg regimens, the kit's checks behind PRESCRIBE_V2
 * (cross-reactivity, eGFR by CKD-EPI 2021, pregnancy, limits), order sets, and that with the flag off
 * every check reads as before.
 *
 * The amoxicillin regimens below are TEST FIXTURES (round illustrative numbers, not clinical values):
 * no amoxicillin regimen is signed, so production shows no dose for it.
 */
import type { PlanCheckContext } from "@/lib/prescribing/plan-checks";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import type { Drug } from "@/lib/prescribing/reference/formulary-types";
import { describe, expect, it } from "vitest";

import { drugById, resolveRegimens } from "@/lib/prescribing/formulary";
import { orderSetsFor } from "@/lib/prescribing/order-sets";
import { placeOfEncounter, rxWord } from "@/lib/prescribing/places";
import { egfrOf, planChecks } from "@/lib/prescribing/plan-checks";
import { parseStrength, supplyQuantity } from "@/lib/prescribing/supply";

const W = (kg: number) => ({ kg, at: "2026-11-11T08:00:00Z", source: "triage" });

const ctx = (over: Partial<PlanCheckContext> = {}): PlanCheckContext => ({
  ageYears: 52,
  weight: W(64),
  allergies: [],
  allergyStatus: "none_known",
  conditions: [],
  creatinine: null,
  kidneyTestPlanned: false,
  glucose: null,
  sepsisTypeProblem: false,
  bloodCulture: "none",
  others: [],
  cosign: "allowed",
  v2: true,
  sex: "female",
  pregnancy: { state: "not_pregnant", weeks: null },
  ...over,
});

const rx = (over: Partial<PlanRx>): PlanRx => ({
  clientKey: "rx-0000001",
  kind: "drug",
  drugId: "ceftriaxone",
  conditionId: null,
  regimenId: null,
  doseNum: 1,
  unit: "g",
  strength: null,
  route: "iv",
  method: null,
  infusionOver: null,
  diluent: null,
  frequency: "daily",
  prn: false,
  course: "5d",
  start: "now",
  note: null,
  fluid: null,
  answers: [],
  witness: null,
  weightAt: null,
  typedDose: null,
  ...over,
});

const amoxFixture = (): Drug => {
  const d = drugById("amoxicillin")!;
  const src = [{ citation: "test fixture", quote: "test fixture", checkedAt: "2026-11-11" }];
  return {
    ...d,
    dose: {
      ...d.dose,
      status: "verified",
      csoSigned: true,
      regimens: [
        {
          id: "fx.child.band_low",
          label: "Fixture band, under 10 kg",
          band: "child",
          doseNum: 125,
          unit: "mg",
          route: "oral",
          freq: "8h",
          course: "5d",
          appliesWhen: { weightKgBelow: 10 },
          sources: src,
        },
        {
          id: "fx.child.band_high",
          label: "Fixture band, 10 kg and over",
          band: "child",
          doseNum: 250,
          unit: "mg",
          route: "oral",
          freq: "8h",
          course: "5d",
          appliesWhen: { weightKgAtLeast: 10 },
          sources: src,
        },
        {
          id: "fx.adult.perkg",
          label: "Fixture per kg",
          band: "adult",
          perKg: { amount: 25, unit: "mg", max: 1000 },
          unit: "mg",
          route: "oral",
          freq: "8h",
          course: "5d",
          sources: src,
        },
      ],
    },
  };
};

describe("S1 · a child's dose by weight band and its supply quantity", () => {
  it("picks the 10 kg-and-over band for 13 kg and counts the suspension in bottles", () => {
    const r = resolveRegimens(amoxFixture(), { ageYears: 3, weight: W(13) });
    const applies = r.regimens.filter((x) => x.applies);
    expect(applies.map((x) => x.regimen.id)).toEqual(["fx.child.band_high"]);
    expect(applies[0]!.dose.num).toBe(250);
    // 250 mg 8-hourly for 5 days from 125 mg/5 mL in 100 mL bottles: 15 doses × 10 mL = 150 mL → 2 bottles.
    const s = supplyQuantity({
      doseNum: 250,
      unit: "mg",
      frequency: "8h",
      course: "5d",
      prn: false,
      product: { strength: "125 mg/5 mL", packSize: "100 mL", issueUnit: "bottle" },
    });
    expect(s).toMatchObject({ qty: 2, unit: "bottle", doses: 15 });
    expect(s!.text).toBe("2 bottles of 100 mL (150 mL for 15 doses)");
  });

  it("works out an adult per-kg dose with its cap, and tablets for it", () => {
    const heavy = resolveRegimens(amoxFixture(), { ageYears: 40, weight: W(64) });
    expect(heavy.regimens[0]!.dose.num).toBe(1000); // 25 × 64 = 1600, capped at 1000
    expect(heavy.regimens[0]!.working).toBe("25 mg/kg × 64 kg = 1000 mg");
    const s = supplyQuantity({
      doseNum: 500,
      unit: "mg",
      frequency: "8h",
      course: "5d",
      prn: false,
      product: { strength: "250 mg", packSize: "100", issueUnit: "Capsule" },
    });
    expect(s).toMatchObject({ qty: 30, unit: "capsule", doses: 15 });
  });

  it("gives no quantity it cannot work out", () => {
    const base = {
      doseNum: 500,
      unit: "mg" as const,
      frequency: "8h" as const,
      prn: false,
      product: { strength: "250 mg", packSize: null, issueUnit: "tablet" },
    };
    expect(supplyQuantity({ ...base, course: "until_review" })).toBeNull();
    expect(supplyQuantity({ ...base, course: "5d", prn: true })).toBeNull();
    expect(supplyQuantity({ ...base, course: "5d", product: null })).toBeNull();
    expect(
      supplyQuantity({ ...base, course: "5d", product: { ...base.product, strength: "mixed" } }),
    ).toBeNull();
    expect(supplyQuantity({ ...base, course: "single" })).toMatchObject({ qty: 2, doses: 1 });
    expect(parseStrength("1 g")).toEqual({ mg: 1000, perMl: null });
    expect(parseStrength("125 mg/5 mL")).toEqual({ mg: 125, perMl: 5 });
  });

  it("names the place and the line's word", () => {
    expect(placeOfEncounter("inpatient")).toBe("ward");
    expect(placeOfEncounter("opd")).toBe("clinic");
    expect(placeOfEncounter("emergency")).toBe("clinic");
    const line = { state: "active", awaitingCosign: false, cosignWithheld: false };
    expect(rxWord(line, "clinic")).toBe("Waiting at pharmacy");
    expect(rxWord(line, "resus")).toBe("Given from the cart");
    expect(rxWord({ ...line, awaitingCosign: true }, "clinic")).toBe("Waiting for co-sign");
  });
});

describe("S2 · the kit's checks (PRESCRIBE_V2)", () => {
  const penicillin = {
    allergies: [{ substance: "Penicillin" }],
    allergyStatus: "has_allergies" as const,
  };

  it("ceftriaxone with a penicillin allergy shows cross-reactivity as a Check", () => {
    const c = planChecks(drugById("ceftriaxone")!, rx({}), ctx(penicillin)).find(
      (x) => x.code === "allergy",
    )!;
    expect(c.outcome).toBe("check");
    expect(c.message).toMatch(/Penicillin.*cross-reaction is possible/);
    // A direct match stays a Stop.
    const amox = planChecks(
      drugById("amoxicillin")!,
      rx({ drugId: "amoxicillin", route: "oral" }),
      ctx(penicillin),
    ).find((x) => x.code === "allergy")!;
    expect(amox.outcome).toBe("stop");
  });

  it("gentamicin with creatinine 168 shows eGFR by CKD-EPI 2021", () => {
    const creatinine = { value: 168, unit: "µmol/L", at: "2026-11-10T09:00:00Z" };
    const e = egfrOf({ creatinine, ageYears: 52, sex: "female" })!;
    expect(e.value).toBe(31); // CKD-EPI 2021, female, 52 y, 168 µmol/L
    expect(e.category).toBe("G3b");
    const c = planChecks(
      drugById("gentamicin")!,
      rx({ drugId: "gentamicin", doseNum: 320, unit: "mg" }),
      ctx({ creatinine }),
    ).find((x) => x.code === "kidney")!;
    expect(c.outcome).toBe("check");
    expect(c.message).toMatch(/^eGFR 31 mL\/min\/1\.73 m² \(G3b\), worked out with CKD-EPI 2021/);
  });

  it("asks about pregnancy for a woman aged 12 to 55, never for a man", () => {
    const d = drugById("amoxicillin")!;
    const r = rx({ drugId: "amoxicillin", route: "oral" });
    const notAsked = planChecks(d, r, ctx({ pregnancy: null })).find(
      (x) => x.code === "pregnancy",
    )!;
    expect(notAsked.outcome).toBe("check");
    const man = planChecks(d, r, ctx({ sex: "male", pregnancy: null })).find(
      (x) => x.code === "pregnancy",
    )!;
    expect(man.outcome).toBe("not_applicable");
    const preg = planChecks(d, r, ctx({ pregnancy: { state: "pregnant", weeks: 20 } })).find(
      (x) => x.code === "pregnancy",
    )!;
    expect(preg.outcome).toBe("check");
    expect(preg.message).toMatch(/^Pregnant, 20 weeks\. No signed pregnancy advice/);
  });

  it("stops a dose above the signed regimen's own maximum; says when there is none", () => {
    const glucagon = drugById("glucagon")!;
    const perKg = glucagon.dose.regimens.find((g) => g.perKg?.max != null);
    if (perKg) {
      const over = planChecks(
        glucagon,
        rx({
          drugId: "glucagon",
          regimenId: perKg.id,
          doseNum: perKg.perKg!.max! + 1,
          unit: perKg.unit,
          route: perKg.route,
        }),
        ctx({ ageYears: 6 }),
      ).find((x) => x.code === "limits")!;
      expect(over.outcome).toBe("stop");
    }
    const none = planChecks(drugById("ceftriaxone")!, rx({}), ctx()).find(
      (x) => x.code === "limits",
    )!;
    expect(none.outcome).toBe("not_checked");
  });

  it("with the flag off, every check reads as before", () => {
    const creatinine = { value: 168, unit: "µmol/L", at: "2026-11-10T09:00:00Z" };
    const off = { ...ctx({ ...penicillin, creatinine }), v2: false };
    const cef = planChecks(drugById("ceftriaxone")!, rx({}), off);
    expect(cef.find((x) => x.code === "allergy")!.outcome).toBe("passed");
    expect(cef.some((x) => x.code === "pregnancy" || x.code === "limits")).toBe(false);
    const gent = planChecks(drugById("gentamicin")!, rx({ drugId: "gentamicin" }), off);
    expect(gent.find((x) => x.code === "kidney")!.outcome).toBe("note");
  });
});

describe("order sets", () => {
  it("are drafts: shown outside production only, by band", () => {
    expect(orderSetsFor("child", false).every((s) => s.who === "child")).toBe(true);
    expect(orderSetsFor("olderAdult", false).every((s) => s.who === "adult")).toBe(true);
    expect(orderSetsFor("adult", true)).toEqual([]);
    expect(orderSetsFor(null, false)).toEqual([]);
    for (const s of orderSetsFor("adult", false).concat(orderSetsFor("child", false)))
      for (const id of s.drugIds) expect(drugById(id), id).toBeDefined();
  });
});
