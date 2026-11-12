/**
 * Hyperkalaemia rule module (prescribing kit P5, FEATURES.md §2.3): every number from the 0285 seed,
 * the P6 blocks (calcium only with ECG changes, at most its dose count), the role gates (P2), and
 * scenario S10 (Nakato Sarah) from start to the end of the chart. Pure: `deriveChart`, no database.
 */
import type { ChartEvent, ChartFacts } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { deriveChart, isOffered, offeredActs } from "@/lib/protocols/engine/derive";
import { HyperkSeed } from "@/lib/protocols/rules/hyperk";
import { ev, facts, lab, MIN, T0, versionOf } from "./_seed-0285";

const V = versionOf("hyperk");
const view = (events: ChartEvent[], over: Partial<ChartFacts> = {}, at = 5) =>
  deriveChart(V, { startedAt: T0 }, events, facts(over), T0 + at * MIN);
const step = (v: ReturnType<typeof view>, title: string) =>
  v.phases.flatMap((p) => p.acts).find((s) => s.title === title)!;
const slot = (h: number, values: Record<string, string>) =>
  ev("slot", { slot: h, values }, "rn", h * 15 + 1);
const peaked = (m = 1) => ev("toggle", { key: "ecg", value: "Peaked T waves" }, "dr", m);
const CA = { t: "give", key: "ca" } as const;
const IG = { t: "mark", key: "ig" } as const;

describe("hyperkalaemia (§2.3, numbers from the 0285 seed)", () => {
  it("reads its seed: §2 numbers, 15 min × 24 slots, not blocked", () => {
    const S = HyperkSeed.parse(V.seed);
    expect(S.grade).toEqual({ mildFrom: 5.5, moderateFrom: 6, severeFrom: 6.5 });
    expect(S.calcium).toMatchObject({ g: 1, ml: 10, everyMinutes: 10, maxDoses: 3 });
    expect(S.insulin).toMatchObject({ units: 10, glucoseMl: 50, lowGlucoseUnder: 7, d10MlH: 50 });
    expect(S.watch.potassiumMinutes).toEqual([60, 120, 240, 360]);
    const v = view([], { results: lab({ k: 6.8 }) });
    expect(v.blocked).toBeNull();
    expect([v.slotMinutes, v.slotCount]).toEqual([15, 24]);
    expect(v.over).toContain("prototype values");
  });

  it("grades the potassium: mild treats the cause, moderate needs insulin with glucose, severe is an emergency", () => {
    const mild = view([], { results: lab({ k: 5.7, cbg: 8 }) });
    expect(step(mild, "Confirm and grade").branches.map((b) => b.on)).toEqual([false, false, true]);
    expect(isOffered(mild, "rn", IG)).toBe(false);
    const mod = view([], { results: lab({ k: 6.2, cbg: 8 }) });
    expect(step(mod, "Confirm and grade").branches.map((b) => b.on)).toEqual([false, true, false]);
    expect(isOffered(mod, "rn", IG)).toBe(true);
    expect(isOffered(mod, "rn", CA)).toBe(false); // no ECG change: no calcium
    const sev = view([], { results: lab({ k: 6.8, cbg: 8 }) });
    expect(step(sev, "Confirm and grade").branches[0]!.on).toBe(true);
    expect(step(sev, "Confirm and grade").branches[1]!.range).toBe("6 to 6.4, ECG normal");
  });

  it("P6: calcium only while the ECG has changed, by the nurse, never past 3 doses", () => {
    const base = { results: lab({ k: 6.1, cbg: 8 }) };
    const v = view([peaked()], base);
    expect(isOffered(v, "rn", CA)).toBe(true);
    expect(isOffered(v, "dr", CA)).toBe(false);
    expect(offeredActs(v, "ph")).toEqual([]);
    expect(isOffered(v, "rn", IG)).toBe(true); // ECG changes: an emergency at any potassium
    const three = [peaked(), ev("give", { key: "ca" }, "rn", 2)];
    three.push(ev("give", { key: "ca" }, "rn", 12), ev("give", { key: "ca" }, "rn", 22));
    const v3 = view(three, base, 25);
    expect(isOffered(v3, "rn", CA)).toBe(false);
    expect(step(v3, "Protect the heart: calcium gluconate").lines[0]!.text).toContain("3 g given");
    // The doctor marks the ECG back to normal: calcium is no longer due.
    const ok = view([...three.slice(0, 2), ev("mark", { key: "ecgOk" }, "dr", 8)], base, 9);
    expect(isOffered(ok, "rn", CA)).toBe(false);
    expect(ok.tasks.some((t) => t.key.startsWith("ca"))).toBe(false);
  });

  it("glucose under 7 before: 10% glucose at 50 ml/h after the insulin; a hypo raises a nurse task", () => {
    const base = { results: lab({ k: 6.3, cbg: 5 }) };
    const v = view([ev("mark", { key: "ig" }, "rn", 2)], base, 3);
    expect(isOffered(v, "rn", { t: "mark", key: "d10" })).toBe(true);
    expect(v.tasks.find((t) => t.key === "d10")!.title).toContain("50 ml/hour for 5 hours");
    const hypo = view([ev("mark", { key: "ig" }, "rn", 2), slot(2, { cbg: "3.4" })], base, 32);
    expect(hypo.tasks.find((t) => t.key === "hypo")!.title).toContain("3.4");
    expect(isOffered(hypo, "rn", { t: "mark", key: "hypo" })).toBe(true);
    const treated = view(
      [
        ev("mark", { key: "ig" }, "rn", 2),
        slot(2, { cbg: "3.4" }),
        ev("mark", { key: "hypo" }, "rn", 33),
      ],
      base,
      34,
    );
    expect(treated.tasks.some((t) => t.key === "hypo")).toBe(false);
  });

  it("recheck bands: 6.0 to 6.4 repeats insulin with glucose; 6.5 or more also calls the renal team", () => {
    const base = { results: lab({ k: 6.6, cbg: 8 }) };
    const at1h = (k: string) =>
      view([ev("mark", { key: "ig" }, "rn", 2), slot(4, { cbg: "7", k })], base, 62);
    const r62 = at1h("6.2");
    expect(step(r62, "Recheck the potassium").branches.map((b) => b.on)).toEqual([
      false,
      true,
      false,
    ]);
    expect(isOffered(r62, "rn", { t: "mark", key: "ig2" })).toBe(true);
    const r67 = at1h("6.7");
    expect(step(r67, "Recheck the potassium").branches[0]!.on).toBe(true);
    expect(step(r67, "Remove the potassium and stop the causes").items[2]!.lvl).toBe("alert");
  });

  it("dashes the cells that are due and asks only for what is due at the next slot", () => {
    const v = view([], { results: lab({ k: 6.6 }) }, 70);
    const cbg = v.grid.rows.find((r) => r.key === "cbg")!;
    expect(cbg.cells[1]!.due).toBe(true); // 15 min
    expect(cbg.cells[3]!.due).toBe(false); // 45 min: not a glucose time
    expect(v.grid.rows.find((r) => r.key === "k")!.cells[4]!.due).toBe(true); // 1 h
    expect(v.formReq).toEqual([]); // slot 0: nothing due
    const v1 = view([slot(0, { ecg: "1" })], { results: lab({ k: 6.6 }) }, 16);
    expect(v1.formReq).toEqual(["cbg"]);
  });

  it("S10 Nakato Sarah: potassium 7.1 with peaked T waves → calcium ×1 → insulin with glucose → recheck 5.2 → end", () => {
    const base = { results: lab({ k: 7.1, cbg: 8 }) };
    const e: ChartEvent[] = [peaked()];
    let v = view(e, base, 1);
    expect(step(v, "Confirm and grade").brief).toBe("K 7.1 · Severe · ECG changes");
    expect(v.tasks.map((t) => t.key)).toEqual(expect.arrayContaining(["mon", "ca0", "ig"]));
    e.push(ev("mark", { key: "mon" }, "rn", 2), ev("give", { key: "ca" }, "rn", 3));
    e.push(ev("mark", { key: "ig" }, "rn", 5));
    v = view(e, base, 6);
    expect(step(v, "Protect the heart: calcium gluconate").brief).toBe("1 dose given");
    expect(isOffered(v, "dr", { t: "mark", key: "ecgOk" })).toBe(true);
    expect(isOffered(v, "rn", { t: "mark", key: "ecgOk" })).toBe(false);
    e.push(ev("mark", { key: "ecgOk" }, "dr", 12));
    e.push(slot(1, { cbg: "7.2" }), slot(2, { cbg: "6.6" }), slot(3, { ecg: "0" }));
    e.push(slot(4, { cbg: "6.1", k: "5.2", ecg: "0" }));
    v = view(e, base, 62);
    const end = step(v, "Resolution");
    expect(end.crit.map((c) => c.mark)).toEqual(["met", "met"]);
    expect(end.status).toBe("done");
    expect(isOffered(v, "dr", { t: "end" })).toBe(true);
    expect(isOffered(v, "rn", { t: "end" })).toBe(false);
    expect(v.aims.map((a) => a.ok)).toEqual([true, true, true]);
    e.push(ev("end", { reason: "Potassium under 5.5" }, "dr", 63));
    v = view(e, base, 64);
    expect(v.endedAt).toBe(T0 + 63 * MIN);
    expect(v.tasks).toEqual([]);
    expect(offeredActs(v, "rn")).toEqual([]);
    expect(v.log.map((l) => l.text)).toEqual(
      expect.arrayContaining([
        "Calcium gluconate given",
        "Insulin with glucose given",
        "ECG back to normal",
      ]),
    );
  });
});
