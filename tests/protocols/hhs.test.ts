/**
 * HHS rule module (FEATURES.md §2.2, prescribing kit P5): `deriveChart` over the 0282 rules and the
 * 0284 seed (reference ranges from 0283, as the migration copies them). Unit checks of the sheet,
 * then S10's walk for Kato Joseph (fictional): osmolality 369.7 → high risk → fluids → glucose
 * plateau → insulin 4 units/h → resolution → SC insulin → end. Pure: no database.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChartEvent, ChartFacts, ChartVersion, Role } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { deriveChart, isOffered } from "@/lib/protocols/engine/derive";
import { fold } from "@/lib/protocols/engine/fold";
import { makeKit } from "@/lib/protocols/engine/kit";
import hhs, { HhsSeed, osmOf } from "@/lib/protocols/rules/hhs";

const mig = (f: string) => readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");
const json = (sql: string, re: RegExp) => JSON.parse(sql.match(re)![1]!) as Record<string, unknown>;
const dkaRefs = json(mig("0283_protocol_charts.sql"), /SET seed = \$json\$([\s\S]+?)\$json\$/).refs;
const seed = {
  ...json(mig("0284_protocol_seeds_hhs_ssi.sql"), /SET seed = \$json\$([\s\S]+?)\$json\$/),
  refs: dkaRefs,
};
const rules = json(
  mig("0282_prescribe_protocols.sql"),
  /SELECT 'hhs', NULL, 1, 'draft', \$json\$(.+?)\$json\$/,
);
const V: ChartVersion = {
  protocolId: "hhs",
  name: "Hyperosmolar hyperglycaemic state (HHS)",
  status: "draft",
  source: "JBDS-IP, UCG 2023",
  slotMinutes: 60,
  slotCount: 24,
  rules,
  seed,
};

const T0 = Date.UTC(2026, 10, 11, 8, 0);
const MIN = 60000;
const lab = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, value]) => [k, { value, source: "lab", at: T0 }]));
// Kato Joseph (fictional, the prototype's p8): 68, 74 kg.
const KATO = lab({
  cbg: 38.6,
  lglu: 41.2,
  na: 152,
  k: 4.6,
  urea: 24.5,
  ket: 0.8,
  ph: 7.34,
  hco3: 21,
  sbp: 102,
  pulse: 108,
  gcs: 13,
  spo2: 95,
});
const facts = (over: Partial<ChartFacts> = {}): ChartFacts => ({
  ageYears: 68,
  sex: "male",
  weightKg: 74,
  weightFrom: "triage",
  pregnant: false,
  problems: ["Type 2 diabetes"],
  creatinine: 168,
  egfr: 36,
  results: KATO,
  pending: {},
  ivLines: ["18G, left forearm"],
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
  ev("slot", { slot: h, values }, "rn", h * 60 + 5);
const view = (events: ChartEvent[], min: number, f: ChartFacts = facts()) =>
  deriveChart(V, { startedAt: T0 }, events, f, T0 + min * MIN);
const step = (vw: ReturnType<typeof view>, key: string) =>
  [...vw.phases.flatMap((p) => p.acts), ...vw.rn.acts].find((a) => a.key === key)!;
const mark = (key: string) => ({ t: "mark" as const, key });

describe("HHS rule module (§2.2)", () => {
  it("reads every number from the 0284 seed; a version without it is blocked", () => {
    expect(HhsSeed.safeParse(seed).success).toBe(true);
    expect(hhs.check(V)).toBeNull();
    expect(view([], 5).blocked).toBeNull();
    expect(deriveChart({ ...V, seed: {} }, { startedAt: T0 }, [], facts(), T0).blocked).toBe(
      "This HHS version has no numbers, so it cannot chart.",
    );
  });

  it("confirm: all 4, osmolality worked out; mixed ketoacidosis points to the DKA chart", () => {
    const v0 = view([], 5);
    expect(step(v0, "imm1").status).toBe("todo");
    expect(step(v0, "imm1").rows[0]!.v).toContain("369.7");
    const v1 = view([ev("set", { key: "hypov", value: "Yes" }, "dr", 2)], 5);
    expect(step(v1, "imm1").status).toBe("done");
    expect(step(v1, "imm1").brief).toBe("HHS confirmed · osmolality 369.7");
    const mixed = view([], 5, facts({ results: { ...KATO, ...lab({ ket: 3.4, ph: 7.2 }) } }));
    expect(step(mixed, "imm1").status).toBe("needs");
    expect(step(mixed, "imm1").btns.some((b) => b.act.t === "proto")).toBe(true);
    expect(osmOf(152, 41.2, 24.5)).toBe(369.7);
  });

  it("high risk: osmolality over 350 and pulse over 100 → HDU (doctor only)", () => {
    const v = view([], 5);
    const a2 = step(v, "imm2");
    expect(a2.items.filter((i) => i.lvl === "alert").map((i) => i.name)).toEqual([
      "Osmolality over 350 mOsm/kg",
      "Pulse over 100 or under 60",
    ]);
    expect(a2.status).toBe("needs");
    expect(isOffered(v, "dr", mark("hdu"))).toBe(true);
    expect(isOffered(v, "rn", mark("hdu"))).toBe(false);
  });

  it("fluids: shocked → 500 ml boluses by the nurse; else 1 L; IV request when no line", () => {
    const shocked = view([], 5, facts({ results: { ...KATO, ...lab({ sbp: 84 }) } }));
    expect(isOffered(shocked, "rn", { t: "give", key: "bolus" })).toBe(true);
    expect(isOffered(shocked, "dr", { t: "give", key: "bolus" })).toBe(false);
    expect(shocked.tasks.some((t) => t.key === "bolus0")).toBe(true);
    const v = view([], 5, facts({ ivLines: [] }));
    expect(isOffered(v, "dr", { t: "iv" })).toBe(true);
    expect(isOffered(v, "rn", mark("fluid1At"))).toBe(true);
    expect(isOffered(v, "dr", mark("fluid1At"))).toBe(false);
  });

  it("insulin only when ketones are over 1.5 or the glucose plateaus, and only with a weight (P7)", () => {
    expect(isOffered(view([], 5), "dr", mark("insOrder"))).toBe(false);
    const ketotic = facts({ results: { ...KATO, ...lab({ ket: 1.8 }) } });
    expect(isOffered(view([], 5, ketotic), "dr", mark("insOrder"))).toBe(true);
    const noWt = facts({ results: ketotic.results, weightKg: null });
    expect(isOffered(view([], 5, noWt), "dr", mark("insOrder"))).toBe(false);
    expect(step(view([], 5, noWt), "imm4").fields[0]!.key).toBe("weight");
  });

  it("potassium by band, capped at 10 mmol an hour; a low glucose adds 10% glucose; a hypo task", () => {
    const v = view([], 5);
    expect(step(v, "imm5").brief).toBe("K 4.6 → 40 mmol in each litre");
    const bag2 = view([], 65);
    expect(
      step(bag2, "imm5").lines.some((l) => l.kind === "alert" && l.text.includes("over 10")),
    ).toBe(true);
    const low = view([slot(0, { cbg: "12", nacl: "250", uo: "60" })], 30);
    expect(isOffered(low, "rn", mark("glucAt"))).toBe(true);
    expect(low.tasks.some((t) => t.key === "gluc")).toBe(true);
    const hypo = view([slot(0, { cbg: "3.4" })], 30);
    expect(hypo.tasks.some((t) => t.key.startsWith("hypo"))).toBe(true);
  });

  it("targets: glucose falling over 5 an hour is too fast; the fluid balance is worked out", () => {
    const evs = [
      slot(0, { cbg: "38", nacl: "1000", uo: "100" }),
      slot(1, { cbg: "31", nacl: "500", uo: "100" }),
    ];
    const v = view(evs, 100);
    const b2 = step(v, "mid2");
    expect(b2.status).toBe("needs");
    expect(isOffered(v, "dr", mark("slow"))).toBe(true);
    expect(v.stats.find((s) => s.k === "Fluid balance")!.v).toBe("+1.3 L");
  });

  it("osmolality is worked out on save from this slot's sodium and urea", () => {
    const evs = [slot(0, { cbg: "38.6" })];
    const K = makeKit({ version: V, c: fold(T0, evs), facts: facts(), now: T0 + 70 * MIN });
    const B = hhs.build(K);
    expect(B.derive!({ cbg: "33.6", na: "150", urea: "22" })).toEqual({ osm: "355.6" });
    expect(B.derive!({ cbg: "33.6" })).toEqual({});
    expect(B.labKeys).toEqual(["cbg", "na", "k", "urea"]);
  });

  it("S10: Kato Joseph from start to resolution", () => {
    const evs: ChartEvent[] = [];
    const at = (e: ChartEvent) => (evs.push(e), e);
    at(ev("set", { key: "hypov", value: "Yes" }, "dr", 2));
    at(ev("mark", { key: "hdu" }, "dr", 3));
    at(ev("mark", { key: "fluid1At" }, "rn", 4));
    // Hourly glucose on fluids alone: 38.6 → 34.0 → 33.6 (a plateau, under 1 an hour).
    const osm = (na: number, g: number, u: number) => String(osmOf(na, g, u));
    at(
      slot(0, {
        cbg: "38.6",
        nacl: "1000",
        uo: "40",
        na: "152",
        k: "4.6",
        urea: "24.5",
        osm: osm(152, 38.6, 24.5),
      }),
    );
    at(
      slot(1, {
        cbg: "34",
        nacl: "500",
        uo: "50",
        na: "153",
        k: "4.4",
        urea: "23",
        osm: osm(153, 34, 23),
      }),
    );
    let v = view(evs, 125);
    expect(isOffered(v, "dr", mark("insOrder"))).toBe(false);
    at(
      slot(2, {
        cbg: "33.6",
        nacl: "500",
        uo: "50",
        na: "152",
        k: "4.3",
        urea: "22",
        osm: osm(152, 33.6, 22),
      }),
    );
    v = view(evs, 130);
    expect(step(v, "imm4").brief).toBe("Needed: glucose has stopped falling on fluids");
    expect(
      step(v, "mid2").lines.some((l) => l.text.startsWith("Glucose has stopped falling")),
    ).toBe(true);
    // 0.05 units/kg/h × 74 kg = 3.7 → 4 units/h: the doctor prescribes, the nurse starts.
    const start = step(v, "imm4").btns.find((b) => b.act.t === "mark")!;
    expect(start.word).toBe("Start insulin 4 units/hour");
    expect(isOffered(v, "rn", mark("insOrder"))).toBe(false);
    at(ev("mark", { key: "insOrder" }, "dr", 131));
    v = view(evs, 132);
    expect(v.tasks.find((t) => t.key === "ins")!.title).toBe(
      "Start the insulin infusion at 4 ml/hour",
    );
    expect(isOffered(v, "dr", mark("insAt"))).toBe(false);
    at(ev("mark", { key: "insAt" }, "rn", 133));
    v = view(evs, 134);
    expect(v.stats.find((s) => s.k === "Insulin")!.v).toBe("4 units/h");
    expect(v.tasks.some((t) => t.key === "ins")).toBe(false);
    // Hours later: osmolality under 300, urine over 0.5 ml/kg/h, mind back, glucose under 15.
    at(
      slot(3, {
        cbg: "14.5",
        nacl: "250",
        gluc: "0",
        uo: "60",
        na: "140",
        k: "4.2",
        urea: "5",
        osm: osm(140, 14.5, 5),
      }),
    );
    at(ev("set", { key: "mind", value: "Back to usual" }, "dr", 13 * 60));
    v = view(evs, 13 * 60 + 1);
    const e1 = step(v, "end1");
    expect(e1.crit.map((c) => c.mark)).toEqual(["met", "met", "met", "met"]);
    expect(e1.status).toBe("done");
    expect(isOffered(v, "dr", { t: "set", key: "next", value: "sc" })).toBe(true);
    at(ev("set", { key: "next", value: "sc" }, "dr", 13 * 60 + 2));
    v = view(evs, 13 * 60 + 3);
    expect(isOffered(v, "dr", { t: "end" })).toBe(true);
    expect(isOffered(v, "rn", { t: "end" })).toBe(false);
    at(ev("end", { reason: "resolved" }, "dr", 13 * 60 + 4));
    v = view(evs, 13 * 60 + 5);
    expect(v.endedAt).not.toBeNull();
    expect(isOffered(v, "rn", mark("feet"))).toBe(false);
  });
});
