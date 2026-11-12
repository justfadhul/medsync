/**
 * Magnesium sulphate, Pritchard (prescribing kit P5, FEATURES.md §2.5): every number from the 0285
 * seed, confirmation, the P6 block on each maintenance dose (breathing, reflexes, urine; due time),
 * toxicity, the 24-hour clock from delivery or the last fit, and scenario S10 (Achieng Esther).
 */
import type { ChartEvent, ChartFacts } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { deriveChart, isOffered, offeredActs } from "@/lib/protocols/engine/derive";
import { Mgso4Seed } from "@/lib/protocols/rules/mgso4";
import { ev, facts, lab, MIN, T0, versionOf } from "./_seed-0285";

const V = versionOf("mgso4");
const PREG = { ageYears: 24, sex: "female" as const, pregnant: true };
const BASE = { ...PREG, results: lab({ sbp: 165, dbp: 112 }) };
const view = (events: ChartEvent[], over: Partial<ChartFacts> = BASE, at = 5) =>
  deriveChart(V, { startedAt: T0 }, events, facts(over), T0 + at * MIN);
const step = (v: ReturnType<typeof view>, title: string) =>
  v.phases.flatMap((p) => p.acts).find((s) => s.title === title)!;
const slot = (h: number, values: Record<string, string>) =>
  ev("slot", { slot: h, values }, "rn", h * 60 + 1);
const DOSE = { t: "give", key: "mg" } as const;
const MAINT = "Maintenance: 5 g IM every 4 hours";
/** Confirmed (a severe feature) and loaded at 10 minutes. */
const loaded = () => [
  ev("toggle", { key: "feat", value: "Severe headache" }, "dr", 1),
  ev("mark", { key: "ld1" }, "rn", 5),
  ev("mark", { key: "ld2" }, "rn", 10),
];
const hours = (rr: string, reflex = "1", uo = "40") =>
  [1, 2, 3, 4].map((h) => slot(h, { rr, reflex, uo, sbp: "150", dbp: "98" }));

describe("magnesium sulphate, Pritchard (§2.5, numbers from the 0285 seed)", () => {
  it("reads its seed: §2 numbers, 1 h × 24 slots, not blocked", () => {
    const S = Mgso4Seed.parse(V.seed);
    expect(S.loading).toMatchObject({
      ivG: 4,
      ivMl50: 8,
      ivWaterMl: 12,
      imG: 10,
      imEachG: 5,
      lidocaineMl: 1,
    });
    expect(S.maintenance).toMatchObject({ g: 5, everyH: 4 });
    expect(S.checks).toEqual({ rrFrom: 16, urineMlFrom: 100, urineHours: 4 });
    expect(S.toxicity).toEqual({ rrUnder: 12, calciumG: 1, calciumMinutes: 10 });
    expect(S.loading.ivG * S.ml50PerG).toBe(S.loading.ivMl50);
    const v = view([]);
    expect(v.blocked).toBeNull();
    expect([v.slotMinutes, v.slotCount]).toEqual([60, 24]);
  });

  it("confirms severe pre-eclampsia (160/110, or 140/90 with a severe feature) or eclampsia (a fit)", () => {
    const mild = { ...PREG, results: lab({ sbp: 150, dbp: 95 }) };
    expect(step(view([], mild), "Confirm").status).toBe("todo");
    const feat = view([ev("toggle", { key: "feat", value: "Blurred vision" }, "dr", 1)], mild);
    expect(step(feat, "Confirm").brief).toBe("Severe pre-eclampsia");
    expect(step(view([]), "Confirm").status).toBe("done"); // 165/112
    const fit = view([ev("toggle", { key: "feat", value: "Fit (eclampsia)" }, "dr", 1)], mild);
    expect(step(fit, "Confirm").brief).toBe("Eclampsia");
    expect(fit.tasks.map((t) => t.key)).toEqual(expect.arrayContaining(["ld1", "ld2", "cath"]));
    expect(fit.tasks.find((t) => t.key === "ld1")!.sub).toBe(
      "8 ml of 50% + 12 ml water for injection",
    );
  });

  it("P6: a maintenance dose only when due and when every check passes, by the nurse", () => {
    const ok = [...loaded(), ...hours("18")];
    expect(isOffered(view(ok, BASE, 200), "rn", DOSE)).toBe(false); // due at 4 h 10 min
    const due = view(ok, BASE, 245);
    expect(isOffered(due, "rn", DOSE)).toBe(true);
    expect(isOffered(due, "dr", DOSE)).toBe(false);
    expect(offeredActs(due, "ph")).toEqual([]);
    expect(step(due, MAINT).crit.map((c) => c.mark)).toEqual(["met", "met", "met"]);
    const noReflex = view([...loaded(), ...hours("18", "0")], BASE, 245);
    expect(isOffered(noReflex, "rn", DOSE)).toBe(false);
    expect(step(noReflex, MAINT).lines[0]!.text).toContain("withhold this dose");
    const lowUrine = view([...loaded(), ...hours("18", "1", "20")], BASE, 245);
    expect(isOffered(lowUrine, "rn", DOSE)).toBe(false);
    expect(step(lowUrine, "Toxicity").items[2]!.lvl).toBe("alert");
    expect(step(lowUrine, MAINT).crit[2]!.val).toBe("80 ml");
  });

  it("a fit restarts the 24-hour clock; the nurse gives 2 g, the doctor records the delivery", () => {
    const e = [...loaded(), ev("give", { key: "fit" }, "rn", 120)];
    const v = view(e, BASE, 121);
    // 24 h after the fit at 2 h: 10:00 UTC the next day, 13:00 in Kampala.
    expect(step(v, "Delivery and fits").rows[2]!.v).toMatch(/^\w{3} 13:00$/);
    expect(isOffered(v, "rn", { t: "give", key: "fit" })).toBe(true);
    expect(isOffered(v, "dr", { t: "mark", key: "deliv" })).toBe(true);
    expect(isOffered(v, "rn", { t: "mark", key: "deliv" })).toBe(false);
    // 24 h after loading but not after the fit: not over.
    const later = view([...e, ev("mark", { key: "deliv" }, "dr", 60)], BASE, 24 * 60 + 30);
    expect(step(later, "Stop the magnesium").crit[0]!.mark).not.toBe("met");
  });

  it("S10 Achieng Esther: loaded → the dose is blocked when breathing is 11 → calcium gluconate → delivery → stop", () => {
    const e: ChartEvent[] = [ev("toggle", { key: "feat", value: "Severe headache" }, "dr", 1)];
    let v = view(e, BASE, 2);
    expect(isOffered(v, "rn", { t: "mark", key: "ld1" })).toBe(true);
    e.push(ev("mark", { key: "ld1" }, "rn", 5), ev("mark", { key: "ld2" }, "rn", 10));
    e.push(ev("mark", { key: "cath" }, "rn", 20));
    e.push(slot(1, { rr: "18", reflex: "1", uo: "40", sbp: "150", dbp: "98" }));
    e.push(slot(2, { rr: "16", reflex: "1", uo: "35", sbp: "148", dbp: "96" }));
    e.push(slot(3, { rr: "14", reflex: "1", uo: "30", sbp: "146", dbp: "95" }));
    e.push(slot(4, { rr: "11", reflex: "1", uo: "30", sbp: "144", dbp: "94" }));
    v = view(e, BASE, 245);
    expect(step(v, "Loading dose").status).toBe("done");
    expect(isOffered(v, "rn", DOSE)).toBe(false);
    expect(v.tasks.find((t) => t.key === "mg0")!.title).toBe(
      "Magnesium dose due: a check has failed, call the doctor",
    );
    expect(step(v, "Toxicity").brief).toBe("Breathing 11: toxic");
    expect(v.tasks.find((t) => t.key === "ca")!.title).toBe(
      "Breathing under 12: stop magnesium, give calcium gluconate 1 g IV",
    );
    expect(isOffered(v, "rn", { t: "mark", key: "ca" })).toBe(true);
    expect(v.grid.rows.find((r) => r.key === "rr")!.cells[4]!.flag!.lvl).toBe("crit");
    e.push(ev("mark", { key: "ca" }, "rn", 247));
    v = view(e, BASE, 248);
    expect(v.tasks.some((t) => t.key === "ca")).toBe(false);
    expect(v.log.map((l) => l.text)).toContain("Calcium gluconate given");
    // Breathing recovers; the dose is given; the baby is delivered; 24 h later the doctor ends it.
    e.push(slot(5, { rr: "17", reflex: "1", uo: "40", sbp: "142", dbp: "92" }));
    v = view(e, BASE, 302);
    expect(isOffered(v, "rn", DOSE)).toBe(true);
    e.push(ev("give", { key: "mg" }, "rn", 303), ev("mark", { key: "deliv" }, "dr", 360));
    v = view(e, BASE, 360 + 24 * 60 + 1);
    expect(step(v, "Stop the magnesium").crit.map((c) => c.mark)).toEqual(["met", "met"]);
    expect(isOffered(v, "dr", { t: "end" })).toBe(true);
    e.push(ev("end", { reason: "Magnesium stopped" }, "dr", 360 + 24 * 60 + 2));
    v = view(e, BASE, 360 + 24 * 60 + 3);
    expect(v.endedAt).not.toBeNull();
    expect(v.tasks).toEqual([]);
  });
});
