/**
 * Protocol chart engine (prescribing kit P4, F7–F8): `deriveChart` over the seed versions of 0282
 * (rules) and 0283 (the DKA seed's numbers). DKA is ported in full; the other nine modules chart
 * their step list from their version. Pure: no database.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChartEvent, ChartFacts, ChartVersion, Role } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { deriveChart, isOffered, offeredActs } from "@/lib/protocols/engine/derive";
import { RULE_MODULES } from "@/lib/protocols/rules";

const mig = (f: string) => readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");
const m82 = mig("0282_prescribe_protocols.sql");
const names = Object.fromEntries(
  [
    ...m82.matchAll(
      /INSERT INTO public\.protocols \(id, hospital_id, name, group_key\) VALUES \('([a-z0-9_]+)', NULL, '([^']*)'/g,
    ),
  ].map((m) => [m[1]!, m[2]!]),
);
// Each seed as 0283–0286 fill it; HHS and SSI take the DKA seed's reference ranges (0284).
const SEEDS: Record<string, Record<string, unknown>> = {};
for (const f of [
  "0283_protocol_charts.sql",
  "0284_protocol_seeds_hhs_ssi.sql",
  "0285_protocol_seeds_hyperk_htn_mgso4.sql",
  "0286_protocol_seeds_art_se_op_nac.sql",
])
  for (const m of mig(f).matchAll(
    /SET seed = \$json\$([\s\S]+?)\$json\$::jsonb([\s\S]*?)\nWHERE protocol_id = '([a-z0-9_]+)'/g,
  ))
    SEEDS[m[3]!] = JSON.parse(m[1]!) as Record<string, unknown>;
for (const [id, seed] of Object.entries(SEEDS))
  if (id !== "dka" && !seed.refs) seed.refs = SEEDS.dka!.refs;
const VERSIONS: Record<string, ChartVersion> = Object.fromEntries(
  [
    ...m82.matchAll(
      /SELECT '([a-z0-9_]+)', NULL, 1, 'draft', \$json\$(.+?)\$json\$::jsonb, '\{\}'::jsonb, (\d+), (\d+), '([^']*)'/g,
    ),
  ].map((m) => [
    m[1]!,
    {
      protocolId: m[1]!,
      name: names[m[1]!]!,
      status: "draft",
      source: m[5]!,
      slotMinutes: Number(m[3]),
      slotCount: Number(m[4]),
      rules: JSON.parse(m[2]!),
      seed: SEEDS[m[1]!] ?? {},
    } satisfies ChartVersion,
  ]),
);

const T0 = Date.UTC(2026, 10, 11, 8, 0);
const MIN = 60000;
const facts = (over: Partial<ChartFacts> = {}): ChartFacts => ({
  ageYears: 34,
  sex: "female",
  weightKg: 64,
  weightFrom: "weighed",
  pregnant: false,
  problems: ["Type 1 diabetes"],
  creatinine: 90,
  egfr: 75,
  results: {},
  pending: {},
  ivLines: [],
  ivTaskOpen: false,
  ...over,
});
const lab = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).map(([k, value]) => [k, { value, source: "lab", at: T0 }]));

let n = 0;
const ev = (
  type: string,
  payload: Record<string, unknown>,
  role: Role,
  minutes: number,
): ChartEvent => ({
  id: `e${++n}`,
  type,
  payload,
  role,
  at: T0 + minutes * MIN,
  reversesId: null,
});
const slot = (h: number, values: Record<string, string>) =>
  ev("slot", { slot: h, values }, "rn", h * 60 + 5);

describe("protocol chart engine", () => {
  it("has a rule module for each of the 10 seed protocols, and every seed charts from its version", () => {
    expect(Object.keys(VERSIONS).sort()).toEqual(Object.keys(RULE_MODULES).sort());
    for (const [id, v] of Object.entries(VERSIONS)) {
      const view = deriveChart(
        v,
        { startedAt: T0 },
        [],
        facts({ ivLines: ["18G left forearm"] }),
        T0 + 5 * MIN,
      );
      expect(view.blocked, id).toBeNull();
      expect(view.protocolId).toBe(id);
      expect(view.slotMinutes).toBe(v.slotMinutes);
      expect(view.slotCount).toBe(v.slotCount);
      expect(view.signed).toBe(false);
      const steps = view.phases.flatMap((p) => p.acts);
      expect(steps.length, id).toBeGreaterThan(0);
      for (const s of steps) expect(["todo", "needs", "done"]).toContain(s.status);
      expect(view.flow.length).toBeGreaterThan(0);
      expect(offeredActs(view, "ph")).toEqual([]);
    }
  });

  it("every module: a give step offers the nurse 'Given' with every check, not the doctor (P2, P6)", () => {
    for (const id of ["hhs", "hyperk", "htn", "mgso4", "art", "se", "op", "nac", "ssi"]) {
      const view = deriveChart(
        VERSIONS[id]!,
        { startedAt: T0 },
        [],
        facts({ ivLines: ["18G"] }),
        T0 + MIN,
      );
      const gives = offeredActs(view, "rn").filter((a) => a.t === "give");
      for (const g of gives) {
        expect(isOffered(view, "dr", g), id).toBe(false);
        if (g.t === "give" && g.checks?.length)
          expect(isOffered(view, "rn", { ...g, checks: g.checks.slice(1) }), id).toBe(false);
      }
      // A dose given is counted and its time is kept.
      const g = gives[0];
      if (g && g.t === "give") {
        const after = deriveChart(
          VERSIONS[id]!,
          { startedAt: T0 },
          [ev("give", { key: g.key }, "rn", 2)],
          facts({ ivLines: ["18G"] }),
          T0 + 3 * MIN,
        );
        expect(after.log.length, id).toBeGreaterThan(0);
      }
    }
  });

  it("a version its module cannot read is blocked: shown, nothing offered", () => {
    const broken = { ...VERSIONS.dka!, seed: {} };
    const view = deriveChart(broken, { startedAt: T0 }, [], facts(), T0);
    expect(view.blocked).toBeTruthy();
    expect(offeredActs(view, "dr")).toEqual([]);
  });

  describe("DKA (full port, numbers from the 0283 seed)", () => {
    const V = VERSIONS.dka!;
    const base = lab({ cbg: 25, ket: 4.5, ph: 7.05, hco3: 12, k: 4.2, na: 136, cl: 100 });
    const view = (events: ChartEvent[], over: Partial<ChartFacts> = {}, at = 10) =>
      deriveChart(V, { startedAt: T0 }, events, facts({ results: base, ...over }), T0 + at * MIN);
    const step = (v: ReturnType<typeof view>, title: string) =>
      v.phases.flatMap((p) => p.acts).find((s) => s.title === title)!;

    it("confirms from the results, calls it severe, works out the anion gap and the start rate", () => {
      const v = view([]);
      const a1 = step(v, "Confirm the diagnosis");
      expect(a1.crit.map((c) => c.mark)).toEqual(["met", "met", "met"]);
      expect(a1.status).toBe("done");
      expect(a1.brief).toContain("severe");
      expect(isOffered(v, "dr", { t: "mark", key: "hdu" })).toBe(true);
      expect(isOffered(v, "rn", { t: "mark", key: "hdu" })).toBe(false);
      expect(
        step(v, "Baseline assessment").rows.find((r) => r.k.startsWith("Anion gap"))!.v,
      ).toContain("24");
      // 0.1 units/kg/h × 64 kg = 6.4, under the 15 cap.
      expect(step(v, "Insulin: fixed-rate IV infusion").rows[1]!.v).toContain("6.4 units/hour");
      expect(v.phase.id).toBe("imm");
    });

    it("no IV line: the doctor asks for one; the insulin is not offered until a line is on record", () => {
      const v = view([]);
      expect(isOffered(v, "dr", { t: "iv" })).toBe(true);
      expect(isOffered(v, "rn", { t: "mark", key: "insAt" })).toBe(false);
      const lined = view([], { ivLines: ["18G left forearm"] });
      expect(isOffered(lined, "rn", { t: "mark", key: "insAt" })).toBe(true);
      expect(isOffered(lined, "dr", { t: "mark", key: "insAt" })).toBe(false);
      expect(lined.tasks.map((t) => t.key)).toContain("ins");
    });

    it("potassium under 3.3 holds the insulin (P6) and marks the senior band", () => {
      const v = view([], { ivLines: ["18G"], results: { ...base, ...lab({ k: 3.1 }) } });
      expect(isOffered(v, "rn", { t: "mark", key: "insAt" })).toBe(false);
      const a6 = step(v, "Insulin: fixed-rate IV infusion");
      expect(a6.lines.some((l) => l.kind === "alert" && l.text.includes("hold the insulin"))).toBe(
        true,
      );
      expect(a6.status).toBe("needs");
      const a7 = step(v, "Potassium replacement");
      expect(a7.branches.find((b) => b.on)!.range).toContain("Under 3.5");
    });

    it("off target: lines checked by the nurse before the doctor may raise; a raise sets a pump task and locks", () => {
      const ev0 = [
        ev("mark", { key: "insAt" }, "rn", 15),
        slot(0, { cbg: "25", ket: "4.5", ph: "7.05", hco3: "12" }),
        slot(1, { cbg: "24.5", ket: "4.4" }),
      ];
      const lined = { ivLines: ["18G"] };
      const v1 = view(ev0, lined, 70);
      const raise = { t: "mark", key: "insUp" } as const;
      const lines = { t: "mark", key: "linesAt" } as const;
      expect(isOffered(v1, "dr", raise)).toBe(false);
      expect(isOffered(v1, "rn", lines)).toBe(true);
      expect(v1.tasks.some((t) => t.key.startsWith("lines"))).toBe(true);

      const v2 = view([...ev0, ev("mark", { key: "linesAt" }, "rn", 72)], lined, 75);
      expect(isOffered(v2, "dr", raise)).toBe(true);
      expect(isOffered(v2, "rn", raise)).toBe(false);

      const ev3 = [
        ...ev0,
        ev("mark", { key: "linesAt" }, "rn", 72),
        ev("mark", { key: "insUp" }, "dr", 76),
      ];
      const v3 = view(ev3, lined, 80);
      expect(isOffered(v3, "dr", raise)).toBe(false);
      expect(v3.tasks.find((t) => t.key.startsWith("pump"))!.title).toContain("7.4");
      const v4 = view([...ev3, ev("mark", { key: "pumpAt" }, "rn", 82)], lined, 85);
      expect(v4.tasks.some((t) => t.key.startsWith("pump"))).toBe(false);
    });

    it("hypoglycaemia raises a nurse task until treated; glucose under 14 asks for 10% glucose", () => {
      const evs = [
        ev("mark", { key: "insAt" }, "rn", 15),
        slot(0, { cbg: "25" }),
        slot(1, { cbg: "3.5" }),
      ];
      const v = view(evs, { ivLines: ["18G"] }, 70);
      expect(v.tasks.some((t) => t.key.startsWith("hypo"))).toBe(true);
      expect(v.tasks.some((t) => t.key === "gluc")).toBe(true);
      const v2 = view([...evs, ev("mark", { key: "hypoAt" }, "rn", 68)], { ivLines: ["18G"] }, 70);
      expect(v2.tasks.some((t) => t.key.startsWith("hypo"))).toBe(false);
    });

    it("resolution: the doctor picks SC insulin and ends; an ended chart has no tasks and offers nothing", () => {
      const evs = [
        ev("mark", { key: "insAt" }, "rn", 15),
        slot(0, { cbg: "25", ket: "4.5", ph: "7.05", hco3: "12" }),
        slot(13, { cbg: "9", ket: "0.2", ph: "7.35", hco3: "19" }),
      ];
      const v = view(evs, { ivLines: ["18G"] }, 13 * 60 + 10);
      const e1 = step(v, "Resolution of DKA");
      expect(e1.crit.every((c) => c.mark === "met")).toBe(true);
      expect(isOffered(v, "dr", { t: "set", key: "next", value: "sc" })).toBe(true);
      expect(isOffered(v, "dr", { t: "end" })).toBe(false);
      const v2 = view(
        [...evs, ev("set", { key: "next", value: "sc" }, "dr", 13 * 60 + 11)],
        { ivLines: ["18G"] },
        13 * 60 + 12,
      );
      expect(isOffered(v2, "dr", { t: "end" })).toBe(true);
      expect(isOffered(v2, "rn", { t: "end" })).toBe(false);
      const ended = view(
        [...evs, ev("end", { reason: "Resolved, on SC insulin" }, "dr", 13 * 60 + 15)],
        { ivLines: ["18G"] },
        13 * 60 + 20,
      );
      expect(ended.endedAt).not.toBeNull();
      expect(ended.tasks).toEqual([]);
      expect(offeredActs(ended, "dr")).toEqual([]);
      expect(offeredActs(ended, "rn")).toEqual([]);
    });

    it("the monitoring chart: trend panels, gas cells due at the seed's hours, vitals with GCS E/V/M and an added parameter", () => {
      const evs = [
        slot(0, { cbg: "25", ket: "4.5", ph: "7.05", hco3: "12" }),
        slot(1, { cbg: "22", ket: "3.9" }),
        ev(
          "vitals",
          {
            values: {
              sbp: "104",
              dbp: "62",
              pulse: "112",
              rr: "24",
              gcs: "14",
              gcsE: "4",
              gcsV: "4",
              gcsM: "6",
            },
          },
          "rn",
          20,
        ),
        ev("param_add", { name: "SpO₂", unit: "%" }, "dr", 21),
      ];
      const v = view(evs, {}, 80);
      expect(v.panels.map((p) => p.key)).toEqual(["cbg", "ket", "hco3", "ph"]);
      expect(v.panels[0]!.points.map((p) => p.v)).toEqual([25, 22]);
      const gasRow = v.grid.rows.find((r) => r.key === "ph")!;
      const due = gasRow.cells.flatMap((c, h) => (c.due ? [h] : []));
      // The grid shows the first 6 hours until the chart runs past them: gas due at 2, 4 and 6.
      expect(due).toEqual([2, 4, 6]);
      const late = view(evs, {}, 13 * 60);
      const lateDue = late.grid.rows
        .find((r) => r.key === "ph")!
        .cells.flatMap((c, h) => (c.due ? [h] : []));
      expect(lateDue).toEqual([2, 4, 6, 12]);
      const gcs = v.vitals.tiles.find((t) => t.key === "gcs")!;
      expect(gcs.value).toBe("14");
      expect(gcs.word).toContain("E4 V4 M6");
      expect(v.vitals.tiles.some((t) => t.label === "SpO₂" && t.paramId)).toBe(true);
      expect(v.vitals.inputs.map((i) => i.label)).toEqual(
        expect.arrayContaining(["E", "V", "M", "SpO₂"]),
      );
    });

    it("an undone entry no longer counts", () => {
      const give = ev("give", { key: "bolus" }, "rn", 5);
      const rev: ChartEvent = { ...ev("reverse", {}, "rn", 6), reversesId: give.id };
      const low = { ...base, ...lab({ sbp: 80 }) };
      const v = view([give, rev], { results: low }, 10);
      expect(step(v, "Is the patient shocked?").btns[0]!.word).toBe("500 ml bolus given");
    });
  });
});
