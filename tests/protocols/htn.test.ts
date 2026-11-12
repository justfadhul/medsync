/**
 * Hypertensive emergency, IV labetalol (prescribing kit P5, FEATURES.md §2.4): every number from the
 * 0285 seed, the MAP aim and floor, the P6 holds (pulse, floor, wheeze, not safe, 300 mg), the role
 * gates (P2), and scenario S10 (Nambi Rose) from 214/124 to the aim, then controlled and ended.
 */
import type { ChartEvent, ChartFacts, ChartVersion } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { HTN_COPY, HYPERK_COPY, MGSO4_COPY } from "@/content/protocol-charts-rules";
import { deriveChart, isOffered, offeredActs } from "@/lib/protocols/engine/derive";
import { fold } from "@/lib/protocols/engine/fold";
import { makeKit } from "@/lib/protocols/engine/kit";
import htn, { HtnSeed } from "@/lib/protocols/rules/htn";
import { ev, facts, lab, MIN, T0, versionOf } from "./_seed-0285";

it("the three P5 copies are draft until the CSO signs", () => {
  for (const c of [HTN_COPY, HYPERK_COPY, MGSO4_COPY])
    expect([c.status, c.signedBy, c.signedOn]).toEqual(["draft", null, null]);
});

const V = versionOf("htn");
const view = (
  events: ChartEvent[],
  over: Partial<ChartFacts> = {},
  at = 5,
  ver: ChartVersion = V,
) => deriveChart(ver, { startedAt: T0 }, events, facts(over), T0 + at * MIN);
const step = (v: ReturnType<typeof view>, title: string) =>
  v.phases.flatMap((p) => p.acts).find((s) => s.title === title)!;
/** A saved slot, with the MAP the server's save works out (`recordSlot` applies `derive`). */
const derive = htn.build(makeKit({ version: V, c: fold(T0, []), facts: facts(), now: T0 })).derive!;
const slot = (h: number, values: Record<string, string>) =>
  ev("slot", { slot: h, values: { ...values, ...derive(values) } }, "rn", h * 10 + 1);
const GIVE = { t: "give", key: "lab" } as const;
const BASE = { results: lab({ sbp: 214, dbp: 124, pulse: 92 }) };
/** Emergency with organ damage, labetalol checked safe. */
const assessed = () => [
  ev("toggle", { key: "tod", value: "Confusion or seizures" }, "dr", 1),
  ev("toggle", { key: "ci", value: "None" }, "dr", 1),
];
const gives = (mins: number[]) => mins.map((m) => ev("give", { key: "lab" }, "rn", m));

describe("hypertensive emergency: IV labetalol (§2.4, numbers from the 0285 seed)", () => {
  it("reads its seed and works out the MAP aim (−15%) and floor (−25%)", () => {
    const S = HtnSeed.parse(V.seed);
    expect(S.boluses).toEqual({
      mg: [20, 40, 80, 80, 80],
      everyMinutes: 10,
      overMinutes: 2,
      maxTotalMg: 300,
    });
    expect(S.target).toMatchObject({ aimFall: 0.15, floorFall: 0.25, thenSbp: 160, thenDbp: 100 });
    const v = view(assessed(), BASE);
    expect(v.blocked).toBeNull();
    expect([v.slotMinutes, v.slotCount]).toEqual([10, 18]);
    expect(step(v, "Set the target").brief).toBe("MAP 154 → about 131, floor 116");
    expect(step(v, "Is this an emergency?").branches[0]!.on).toBe(true);
  });

  it("urgency (no organ damage): no IV boluses; the doctor prescribes tablets and ends the chart", () => {
    const v = view([ev("toggle", { key: "tod", value: "None found" }, "dr", 1)], BASE);
    expect(step(v, "Is this an emergency?").branches[1]!.on).toBe(true);
    expect(isOffered(v, "rn", GIVE)).toBe(false);
    expect(isOffered(v, "dr", { t: "end" })).toBe(true);
  });

  it("P2: the nurse gives the bolus, the doctor cannot; the pharmacy presses nothing", () => {
    const v = view(assessed(), BASE);
    expect(isOffered(v, "rn", GIVE)).toBe(true);
    expect(isOffered(v, "dr", GIVE)).toBe(false);
    expect(isOffered(v, "dr", { t: "mark", key: "inf" })).toBe(true);
    expect(isOffered(v, "rn", { t: "mark", key: "inf" })).toBe(false);
    expect(offeredActs(v, "ph")).toEqual([]);
    expect(v.tasks[0]!.title).toBe("Give labetalol 20 mg IV over 2 minutes");
  });

  it("P6: held at a pulse under 60, a MAP under the floor, a wheeze, or when not safe", () => {
    const slowP = view(
      [...assessed(), ...gives([2]), slot(1, { sbp: "200", dbp: "118", pulse: "55" })],
      BASE,
      12,
    );
    expect(isOffered(slowP, "rn", GIVE)).toBe(false);
    expect(step(slowP, "Labetalol boluses").lines[0]!.text).toContain("under 60");
    const low = view(
      [...assessed(), ...gives([2]), slot(1, { sbp: "150", dbp: "95", pulse: "80" })],
      BASE,
      12,
    );
    expect(isOffered(low, "rn", GIVE)).toBe(false); // MAP 113 under the floor 116
    expect(low.tasks.some((t) => t.title.startsWith("BP falling too fast"))).toBe(true);
    expect(low.grid.rows.find((r) => r.key === "map")!.cells[1]!.flag!.lvl).toBe("crit");
    const wz = view([...assessed(), ev("set", { key: "wz", value: "Yes" }, "rn", 3)], BASE);
    expect(isOffered(wz, "rn", GIVE)).toBe(false);
    const asthma = view(
      [...assessed(), ev("toggle", { key: "ci", value: "Asthma or COPD" }, "dr", 2)],
      BASE,
    );
    expect(isOffered(asthma, "rn", GIVE)).toBe(false);
    expect(step(asthma, "Is labetalol safe?").status).toBe("needs");
  });

  it("P6: a bolus never takes the total over the maximum", () => {
    const v5 = view([...assessed(), ...gives([2, 12, 22, 32, 42])], BASE, 45);
    expect(isOffered(v5, "rn", GIVE)).toBe(false);
    expect(step(v5, "Labetalol boluses").rows[1]!.v).toBe("300 of 300 mg");
    // A version capped at 250: the fifth bolus is cut to the 30 mg left.
    const seed = { ...(V.seed as Record<string, object>) };
    const capped: ChartVersion = {
      ...V,
      seed: { ...seed, boluses: { ...seed.boluses, maxTotalMg: 250 } },
    };
    const v4 = view([...assessed(), ...gives([2, 12, 22, 32])], BASE, 45, capped);
    expect(isOffered(v4, "rn", GIVE)).toBe(true);
    expect(step(v4, "Labetalol boluses").btns.find((b) => b.act.t === "give")!.word).toBe(
      "Give 30 mg now",
    );
  });

  it("an infusion replaces the boluses: the doctor switches, the nurse starts it at the chosen rate", () => {
    const e = [...assessed(), ...gives([2]), ev("mark", { key: "inf" }, "dr", 5)];
    const v = view(e, BASE, 6);
    expect(isOffered(v, "rn", GIVE)).toBe(false);
    expect(isOffered(v, "dr", { t: "set", key: "infR", value: "2 mg/minute" })).toBe(true);
    expect(isOffered(v, "rn", { t: "mark", key: "infAt" })).toBe(true);
    const v2 = view([...e, ev("set", { key: "infR", value: "2 mg/minute" }, "dr", 6)], BASE, 7);
    expect(step(v2, "Infusion (if chosen)").rows[0]!.v).toBe(
      "2 mg/minute = 120 ml/hour of 1 mg/ml",
    );
  });

  it("S10 Nambi Rose: 214/124 → boluses 20, 40, 80, 80 → MAP 130, at the aim (131) → controlled → end", () => {
    const e: ChartEvent[] = [...assessed()];
    const doses: string[] = [];
    const bp: [number, string, string][] = [
      [1, "200", "118"],
      [2, "190", "112"],
      [3, "185", "108"],
    ];
    for (const [i, at] of [2, 12, 22, 32].entries()) {
      const v = view(e, BASE, at);
      const b = step(v, "Labetalol boluses").btns.find((x) => x.act.t === "give")!;
      expect(isOffered(v, "rn", b.act)).toBe(true);
      doses.push(b.word);
      e.push(ev("give", { key: "lab" }, "rn", at));
      if (bp[i]) e.push(slot(bp[i]![0], { sbp: bp[i]![1], dbp: bp[i]![2], pulse: "88" }));
    }
    expect(doses).toEqual(["Give 20 mg now", "Give 40 mg now", "Give 80 mg now", "Give 80 mg now"]);
    e.push(slot(4, { sbp: "180", dbp: "105", pulse: "84" })); // MAP 130
    let v = view(e, BASE, 42);
    expect(v.stats.find((s) => s.k === "MAP")).toMatchObject({
      v: "130",
      s: "Aim 131, floor 116",
      cls: "ok",
    });
    expect(isOffered(v, "rn", GIVE)).toBe(false);
    expect(step(v, "Labetalol boluses").lines[0]!.text).toContain("At the first-hour aim");
    expect(step(v, "Labetalol boluses").rows[1]!.v).toBe("220 of 300 mg");
    expect(v.panels.find((p) => p.key === "map")!.status).toBe("At the aim");
    expect(v.grid.rows.find((r) => r.key === "map")!.cells[4]!.t).toBe("130");
    expect(isOffered(v, "dr", { t: "end" })).toBe(false); // not yet an hour
    e.push(
      slot(5, { sbp: "165", dbp: "100", pulse: "80" }),
      slot(6, { sbp: "158", dbp: "98", pulse: "78" }),
    );
    v = view(e, BASE, 62);
    expect(step(v, "Controlled").crit.map((c) => c.mark)).toEqual(["met", "met"]);
    expect(isOffered(v, "dr", { t: "end" })).toBe(true);
    e.push(ev("end", { reason: "BP controlled" }, "dr", 63));
    v = view(e, BASE, 64);
    expect(v.endedAt).not.toBeNull();
    expect(v.tasks).toEqual([]);
  });
});
