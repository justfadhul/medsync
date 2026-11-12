/**
 * Correctional (sliding-scale) insulin rule module (FEATURES.md §2.10, prescribing kit P5): the
 * scale is the version's own table (0284 seeds the example). Unit checks of the sheet, then S10's
 * walk for Namusoke Grace (fictional): medium scale, glucose 16.2 → 6 units suggested and saved →
 * the pattern review → 48 h → end. Pure: no database.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChartEvent, ChartFacts, ChartVersion, Role } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { deriveChart, isOffered } from "@/lib/protocols/engine/derive";
import ssi, { doseFor, SsiSeed } from "@/lib/protocols/rules/ssi";

const mig = (f: string) => readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");
const json = (sql: string, re: RegExp) => JSON.parse(sql.match(re)![1]!) as Record<string, unknown>;
const dkaRefs = json(mig("0283_protocol_charts.sql"), /SET seed = \$json\$([\s\S]+?)\$json\$/).refs;
const seeds = [
  ...mig("0284_protocol_seeds_hhs_ssi.sql").matchAll(/SET seed = \$json\$([\s\S]+?)\$json\$/g),
];
const seed = { ...(JSON.parse(seeds[1]![1]!) as Record<string, unknown>), refs: dkaRefs };
const rules = json(
  mig("0282_prescribe_protocols.sql"),
  /SELECT 'ssi', NULL, 1, 'draft', \$json\$(.+?)\$json\$/,
);
const V: ChartVersion = {
  protocolId: "ssi",
  name: "Correctional (sliding-scale) insulin",
  status: "draft",
  source: "Hospital scale (example)",
  slotMinutes: 360,
  slotCount: 8,
  rules,
  seed,
};

const T0 = Date.UTC(2026, 10, 11, 7, 0);
const MIN = 60000;
const SLOT = 360;
// Namusoke Grace (fictional, the prototype's p1): 54, creatinine 168.
const facts = (over: Partial<ChartFacts> = {}): ChartFacts => ({
  ageYears: 54,
  sex: "female",
  weightKg: 68,
  weightFrom: "triage",
  pregnant: false,
  problems: ["Type 2 diabetes"],
  creatinine: 168,
  egfr: 31,
  results: {},
  pending: {},
  ivLines: [],
  ivTaskOpen: false,
  ...over,
});
let n = 0;
const ev = (
  type: string,
  payload: Record<string, unknown>,
  role: Role,
  min: number,
): ChartEvent => ({
  id: `e${++n}`,
  type,
  payload,
  role,
  at: T0 + min * MIN,
  reversesId: null,
});
const slot = (h: number, values: Record<string, string>) =>
  ev("slot", { slot: h, values }, "rn", h * SLOT + 10);
const view = (events: ChartEvent[], min: number, f: ChartFacts = facts(), v = V) =>
  deriveChart(v, { startedAt: T0 }, events, f, T0 + min * MIN);
const step = (vw: ReturnType<typeof view>, key: string) =>
  [...vw.phases.flatMap((p) => p.acts), ...vw.rn.acts].find((a) => a.key === key)!;
const scale = (s: string) => ev("set", { key: "scale", value: s }, "dr", 1);

describe("sliding-scale rule module (§2.10)", () => {
  it("reads the scale table from the seed; an incomplete table is refused", () => {
    const S = SsiSeed.parse(seed);
    expect(ssi.check(V)).toBeNull();
    expect(doseFor(S, "Medium", 16.2)!.units).toBe(6);
    expect(doseFor(S, "Low", 12)!.units).toBe(2);
    expect(doseFor(S, "High", 25)!.units).toBe(12);
    expect(doseFor(S, "Medium", 10)!.units).toBe(0);
    expect(doseFor(S, "Medium", 3.5)!.band.hypo).toBe(true);
    const holed = {
      ...S,
      bands: S.bands.map((b, i) => (i === 2 ? { ...b, units: { Low: 2 } } : b)),
    };
    expect(SsiSeed.safeParse(holed).success).toBe(false);
    expect(view([], 5, facts(), { ...V, seed: holed }).blocked).not.toBeNull();
  });

  it("the hospital's own table changes the dose (FEATURES §5)", () => {
    const S = SsiSeed.parse(seed);
    const mine = {
      ...S,
      bands: S.bands.map((b) =>
        b.range === "14.1 to 18" ? { ...b, units: { ...b.units, Medium: 5 } } : b,
      ),
    };
    const v = view([scale("Medium"), slot(0, { cbg: "16.2", units: "5" })], 20, facts(), {
      ...V,
      seed: mine,
    });
    expect(v.stats.find((s) => s.k === "Suggested dose")!.v).toBe("5 units");
  });

  it("suggests the scale: low for eGFR under 30 or age 75+, high with infection, else medium", () => {
    const sug = (f: ChartFacts) => view([], 5, f).stats.find((s) => s.k === "Scale")!.s;
    expect(sug(facts())).toBe("Suggested Medium");
    expect(sug(facts({ egfr: 25 }))).toBe("Suggested Low");
    expect(sug(facts({ ageYears: 80 }))).toBe("Suggested Low");
    expect(sug(facts({ problems: ["Community-acquired pneumonia"] }))).toBe("Suggested High");
  });

  it("only the doctor chooses the scale; nil by mouth and ketones 3+ with glucose over 11 stop it", () => {
    const v = view([], 5);
    expect(isOffered(v, "dr", { t: "set", key: "scale", value: "Medium" })).toBe(true);
    expect(isOffered(v, "rn", { t: "set", key: "scale", value: "Medium" })).toBe(false);
    const nbm = view([ev("set", { key: "eat", value: "Nil by mouth" }, "dr", 2)], 5);
    expect(step(nbm, "set2").status).toBe("needs");
    const dka = view(
      [],
      5,
      facts({
        results: {
          cbg: { value: 19, source: "lab", at: T0 },
          ket: { value: 3.4, source: "lab", at: T0 },
        },
      }),
    );
    expect(step(dka, "set2").status).toBe("needs");
    expect(step(dka, "set2").btns.some((b) => b.act.t === "proto")).toBe(true);
    expect(step(view([], 5, facts({ egfr: 25 })), "set3").lines[0]!.text).toContain("eGFR 25");
  });

  it("under 4: no insulin and a task; over 22: check ketones and call the doctor", () => {
    const hypo = view([scale("Medium"), slot(0, { cbg: "3.5", units: "0" })], 20);
    expect(step(hypo, "run1").rows[0]!.v).toContain("No insulin: treat the hypoglycaemia");
    expect(hypo.tasks.some((t) => t.key.startsWith("hypo"))).toBe(true);
    const high = view([scale("Medium"), slot(0, { cbg: "24" })], 20);
    expect(step(high, "run1").rows[0]!.v).toContain("10 units soluble insulin SC, check ketones");
    expect(step(high, "run1").status).toBe("needs");
  });

  it("S10: Namusoke Grace, medium scale, glucose 16.2 → 6 units suggested and saved → review → end", () => {
    const evs: ChartEvent[] = [];
    const at = (e: ChartEvent) => (evs.push(e), e);
    at(scale("Medium"));
    at(ev("set", { key: "eat", value: "Eating normally" }, "dr", 2));
    at(ev("mark", { key: "usual" }, "dr", 3));
    let v = view(evs, 5);
    expect(v.phases[0]!.acts.map((a) => a.status)).toEqual(["done", "done", "done"]);
    // The nurse types the glucose on her card: the dose fills in from the medium scale.
    expect(isOffered(v, "rn", { t: "value", key: "cbg" })).toBe(true);
    at(ev("value", { key: "cbg", value: "16.2" }, "rn", 6));
    v = view(evs, 7);
    expect(step(v, "rn1").rows[1]!.v).toBe("6 units soluble insulin SC");
    expect(step(v, "rn1").branches.find((b) => b.on)!.range).toBe("14.1 to 18");
    expect(v.form.find((f) => f.key === "units")!.dflt).toBe("6");
    expect(v.stats.find((s) => s.k === "Suggested dose")!.v).toBe("6 units");
    expect(v.tasks.find((t) => t.key === "dose0")!.sub).toContain("now 6 units soluble insulin SC");
    // Saved as given.
    at(slot(0, { cbg: "16.2", units: "6" }));
    v = view(evs, 20);
    expect(step(v, "run1").rows[1]!.v).toBe("6 units at 0 h");
    expect(v.form.find((f) => f.key === "units")!.dflt).toBe("");
    // Day 1: two more over 14 → review the basal insulin (doctor).
    at(slot(1, { cbg: "15.1", units: "6" }));
    at(slot(2, { cbg: "11.2", units: "4" }));
    at(slot(3, { cbg: "9.8", units: "0" }));
    v = view(evs, 4 * SLOT + 5);
    expect(step(v, "run2").status).toBe("needs");
    expect(isOffered(v, "rn", { t: "mark", key: "rev" })).toBe(false);
    at(ev("mark", { key: "rev" }, "dr", 4 * SLOT + 6));
    for (const [h, g, u] of [
      [4, "9.4", "0"],
      [5, "8.8", "0"],
      [6, "12.1", "4"],
      [7, "9.1", "0"],
    ] as const)
      at(slot(h, { cbg: g, units: u }));
    v = view(evs, 8 * SLOT + 5);
    const e1 = step(v, "end1");
    expect(e1.status).toBe("needs");
    expect(e1.rows.map((r) => r.v)).toEqual(["11.5 mmol/L over 8 readings", "20 units"]);
    expect(v.aims.find((a) => a.word === "Reviewed by 48 hours")!.ok).toBe(true);
    expect(isOffered(v, "dr", { t: "end" })).toBe(true);
    at(ev("end", { reason: "reviewed" }, "dr", 8 * SLOT + 6));
    v = view(evs, 8 * SLOT + 7);
    expect(v.endedAt).not.toBeNull();
    expect(isOffered(v, "rn", { t: "value", key: "cbg" })).toBe(false);
  });
});
