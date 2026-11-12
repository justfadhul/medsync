/**
 * Quick protocols (prescribing kit P3, F6): the seeds in 0282 read as rules, the starting-value bands
 * and their holds, doses for this patient, the first supply, the protocol checks, and canStart (P1:
 * only a signed version starts in production). Pure: no database.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { drugById } from "@/lib/prescribing/formulary";
import {
  canStart,
  doseOf,
  fromBuilder,
  parseBands,
  planOf,
  protocolChecks,
  QuickRules,
  supplyOf,
  verifyProtocol,
} from "@/lib/protocols/quick";

const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/0282_prescribe_protocols.sql"),
  "utf8",
);
const seeds = Object.fromEntries(
  [...sql.matchAll(/SELECT '([a-z0-9_]+)', NULL, 1, 'draft', \$json\$(.+?)\$json\$/g)].map((m) => [
    m[1]!,
    QuickRules.parse(JSON.parse(m[2]!)),
  ]),
);
const adult = { ageYears: 34, sex: "female" as const, weightKg: 64, pregnant: false };
const ctx = (over = {}) => ({
  facts: adult,
  start: {},
  running: false,
  ivLine: true,
  startable: true,
  signed: true,
  ...over,
});

describe("quick protocols", () => {
  it("seeds the 10 protocols of §2, each reading as rules, every medicine in the formulary by its route", () => {
    expect(Object.keys(seeds).sort()).toEqual([
      "art",
      "dka",
      "hhs",
      "htn",
      "hyperk",
      "mgso4",
      "nac",
      "op",
      "se",
      "ssi",
    ]);
    for (const r of Object.values(seeds)) {
      expect(r.module).toBeTruthy();
      for (const s of r.supply) expect(drugById(s.drug)?.routes).toContain(s.route);
      for (const st of r.steps) if (st.drug) expect(drugById(st.drug), st.drug).toBeTruthy();
    }
  });

  it("DKA potassium 3.2 holds the insulin, changes bag 1 and needs an answer; 4.0 does not", () => {
    const dka = seeds.dka!;
    const low = ctx({ start: { k: "3.2" } });
    const checks = protocolChecks(dka, low);
    const band = checks.find((c) => c.id === "band_k")!;
    expect(band).toMatchObject({ level: "stop", hard: false, answers: ["plan_changed"] });
    const plan = planOf(dka, adult, { k: "3.2" });
    expect(plan.find((s) => s.id === "ins")).toMatchObject({
      held: true,
      note: "On hold until potassium is 3.3 or more.",
    });
    expect(plan.find((s) => s.id === "f1")!.title).toBe(
      "Bag 1: sodium chloride 0.9% with potassium",
    );
    const ok = planOf(dka, adult, { k: "4.0" });
    expect(ok.find((s) => s.id === "ins")!.held).toBe(false);
    expect(protocolChecks(dka, ctx({ start: { k: "4.0" } })).some((c) => c.id === "band_k")).toBe(
      false,
    );
  });

  it("works the insulin out by weight, capped at the version's maximum", () => {
    const ins = seeds.dka!.steps.find((s) => s.id === "ins")!;
    expect(doseOf(ins, adult).amount).toBeCloseTo(6.4);
    expect(doseOf(ins, adult).text).toContain("0.1 units/kg/h × 64 kg");
    expect(doseOf(ins, { ...adult, weightKg: 200 }).amount).toBe(15);
    expect(doseOf(ins, { ...adult, weightKg: null })).toMatchObject({
      amount: null,
      needWeight: true,
    });
  });

  it("supplies the first period: vials a dose, child doses under 20 kg, weight capped", () => {
    const vials = (id: string, p = adult) => supplyOf(seeds[id]!, p)[0]!.qty;
    expect(vials("art", { ...adult, weightKg: 70 })).toBe(9); // 168 mg → 3 vials × 3 doses
    expect(vials("art", { ...adult, ageYears: 4, weightKg: 15 })).toBe(3); // 3 mg/kg → 45 mg → 1 × 3
    expect(vials("mgso4")).toBe(9); // 4 g + 10 g + 6 × 5 g in 5 g ampoules
    expect(vials("nac")).toBe(11); // 9,600 + 3,200 + 6,400 mg in 2 g ampoules
    expect(vials("nac", { ...adult, weightKg: 150 })).toBe(
      vials("nac", { ...adult, weightKg: 110 }),
    );
    expect(supplyOf(seeds.dka!, adult).map((s) => s.qty)).toEqual([6, 1, 8, 3]);
  });

  it("checks: starting value missing, weight, adult or child, already running, IV access, indication", () => {
    const dka = seeds.dka!;
    const ids = (c: ReturnType<typeof protocolChecks>) => c.map((x) => x.id);
    const none = protocolChecks(
      dka,
      ctx({ ivLine: false, running: true, facts: { ...adult, ageYears: 8, weightKg: null } }),
    );
    expect(none.find((c) => c.id === "start")).toMatchObject({ hard: true });
    expect(none.find((c) => c.id === "weight")).toMatchObject({ hard: true });
    expect(ids(none)).toEqual(expect.arrayContaining(["who", "running", "iv", "indication"]));
    const fine = protocolChecks(dka, ctx({ start: { k: "4.4" } }));
    expect(fine.filter((c) => c.answers.length).map((c) => c.id)).toEqual(["indication"]);
    expect(verifyProtocol(fine, {}).ok).toBe(false);
    expect(verifyProtocol(fine, { indication: "confirmed" }).ok).toBe(true);
    expect(verifyProtocol(none, { indication: "confirmed" }).ok).toBe(false);
  });

  it("magnesium is for pregnant women 12 to 55: anyone else needs the check answered", () => {
    expect(protocolChecks(seeds.mgso4!, ctx()).some((c) => c.id === "who")).toBe(true);
    expect(
      protocolChecks(seeds.mgso4!, ctx({ facts: { ...adult, pregnant: true } })).some(
        (c) => c.id === "who",
      ),
    ).toBe(false);
  });

  it("the sliding scale reads its bands by the chosen scale", () => {
    const g = planOf(seeds.ssi!, adult, { scale: "Medium" }).find((s) => s.id === "g")!;
    expect(g.bands.find((b) => b.range === "14.1 to 18")!.text).toBe("6 units.");
  });

  it("canStart: a draft starts only in local dev and tests, never on Vercel or in production", () => {
    expect(canStart({ status: "signed" }, { NODE_ENV: "production", VERCEL: "1" })).toBe(true);
    expect(canStart({ status: "draft" }, { NODE_ENV: "production" })).toBe(false);
    expect(
      canStart({ status: "draft" }, { NODE_ENV: "production", VERCEL_ENV: "production" }),
    ).toBe(false);
    // A Vercel preview may use the real database: never, whatever NODE_ENV says.
    expect(canStart({ status: "draft" }, { NODE_ENV: "development", VERCEL: "1" })).toBe(false);
    expect(canStart({ status: "draft" }, { NODE_ENV: "test", VERCEL_ENV: "preview" })).toBe(false);
    expect(canStart({ status: "draft" }, { NODE_ENV: "development" })).toBe(true);
    expect(canStart({ status: "draft" }, { NODE_ENV: "test" })).toBe(true);
  });

  it("the builder makes a draft's rules: steps, ranges, supply one a dose", () => {
    expect(parseBands("<4: low\n4-10: fine\n>10: high").map((b) => b.range)).toEqual([
      "Under 4",
      "4 to 10",
      "Over 10",
    ]);
    const rules = fromBuilder(
      {
        name: "Test",
        intro: "",
        who: "adult",
        steps: [
          {
            kind: "give",
            title: "",
            drug: "labetalol",
            amt: 20,
            unit: "mg",
            at: 0,
            every: 10,
            count: 3,
            vol: 0,
            over: 0,
            conc: 0,
            checks: "Pulse over 60",
            double: false,
            input: "",
            inUnit: "",
            bands: "",
            note: "",
          },
          {
            kind: "result",
            title: "",
            drug: null,
            amt: null,
            unit: "",
            at: 10,
            every: 10,
            count: 3,
            vol: 0,
            over: 0,
            conc: 0,
            checks: "",
            double: false,
            input: "Systolic",
            inUnit: "mmHg",
            bands: ">180: give the next dose",
            note: "",
          },
        ],
      },
      (id) => drugById(id)?.generic,
      (id) => drugById(id)?.routes,
    );
    expect(rules.module).toBeNull();
    expect(rules.steps[0]).toMatchObject({ title: "Labetalol", checks: ["Pulse over 60"] });
    expect(supplyOf(rules, adult)).toMatchObject([{ drug: "labetalol", route: "oral", qty: 3 }]);
  });
});
