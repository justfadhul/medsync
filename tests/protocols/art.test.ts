/**
 * Severe malaria: IV artesunate (prescribing kit P5, FEATURES.md §2.6), `lib/protocols/rules/art.ts`
 * over the 0282 rules and the 0286 seed. Engine units, then S10's walk: Mugisha Ivan (3 y, 13 kg),
 * 39 mg × 3 doses → can swallow → artemether/lumefantrine → end. Every act is checked against what
 * the chart offers that role (as the server does) before it is logged.
 */
import type { Act, Role } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { deriveChart, isOffered } from "@/lib/protocols/engine/derive";
import { facts, lab, log, MIN, seedVersion, T0 } from "./_seed-0286";

const V = seedVersion("art");
const H = 60;
const view = (events: Parameters<typeof deriveChart>[2], f = facts(), at = 10) =>
  deriveChart(V, { startedAt: T0 }, events, f, T0 + at * MIN);
const step = (v: ReturnType<typeof view>, title: string) =>
  [...v.phases.flatMap((p) => p.acts), ...v.rn.acts].find((s) => s.title.startsWith(title))!;

describe("severe malaria (art)", () => {
  it("reads every number from the seed; without it the chart is blocked", () => {
    expect(view([]).blocked).toBeNull();
    const broken = deriveChart({ ...V, seed: {} }, { startedAt: T0 }, [], facts(), T0);
    expect(broken.blocked).toBeTruthy();
  });

  it("adult 50 kg: 2.4 mg/kg = 120 mg, 2 vials; IM is 20 mg/ml", () => {
    const f = facts({ weightKg: 50 });
    const a2 = step(view([], f), "First dose");
    expect(a2.rows[1]!.v).toContain("120 mg (2.4 × 50 kg)");
    expect(a2.rows[2]!.v).toContain("2 × 60 mg");
    expect(a2.rows[3]!.v).toContain("12 ml of 10 mg/ml IV");
    const { events, add } = log();
    add("set", { key: "route", value: "IM" }, "dr", 1);
    expect(step(view(events, f), "First dose").rows[3]!.v).toContain("6 ml of 20 mg/ml IM");
  });

  it("no weight: the doctor is asked for one and no dose is offered (P7)", () => {
    const v = view([], facts({ weightKg: null }));
    expect(isOffered(v, "dr", { t: "weight" })).toBe(true);
    expect(isOffered(v, "rn", { t: "give", key: "dose" })).toBe(false);
  });

  it("glucose under 3 raises a nurse task; adult Hb 6 asks the doctor to transfuse, a child's does not", () => {
    const { events, add } = log();
    add("slot", { slot: 1, values: { cbg: "2.5", temp: "38" } }, "rn", 4 * H);
    const v = view(events, facts({ results: lab({ hb: 6 }) }), 4 * H + 5);
    expect(v.tasks.some((t) => t.key === "glu")).toBe(true);
    expect(isOffered(v, "rn", { t: "mark", key: "glu" })).toBe(true);
    expect(isOffered(v, "dr", { t: "mark", key: "tx" })).toBe(true);
    expect(v.grid.rows.find((r) => r.key === "cbg")!.cells[1]!.flag!.lvl).toBe("crit");
    const kid = view(events, facts({ ageYears: 3, weightKg: 13, results: lab({ hb: 6 }) }));
    expect(isOffered(kid, "dr", { t: "mark", key: "tx" })).toBe(false);
    expect(step(kid, "Treat what").items[0]!.sub).toContain("5 ml/kg IV (65 ml)");
  });

  it("S10: Mugisha Ivan, 39 mg × 3 doses → can swallow → tablets → end", () => {
    const f = facts({ ageYears: 3, weightKg: 13 });
    const { events, add } = log();
    const act = (role: Role, a: Act, minutes: number) => {
      expect(isOffered(view(events, f, minutes), role, a), JSON.stringify(a)).toBe(true);
      const { t, ...rest } = a;
      add(t, rest as Record<string, unknown>, role, minutes);
    };
    act("dr", { t: "set", key: "test", value: "mRDT positive" }, 2);
    act("dr", { t: "toggle", key: "sf", value: "Prostration (cannot sit or stand)" }, 3);
    let v = view(events, f, 4);
    expect(step(v, "Confirm").status).toBe("done");
    expect(step(v, "First dose").rows[1]!.v).toContain("39 mg (3 × 13 kg)");
    expect(isOffered(v, "dr", { t: "give", key: "dose" })).toBe(false);
    act("rn", { t: "give", key: "dose" }, 10);

    // Dose 2: not before its early window, then due at 12 h.
    expect(isOffered(view(events, f, 11 * H), "rn", { t: "give", key: "dose" })).toBe(false);
    v = view(events, f, 12 * H);
    expect(v.tasks.find((t) => t.key === "dose2")!.title).toContain("39 mg IV (dose 2)");
    act("rn", { t: "give", key: "dose" }, 12 * H);
    act("rn", { t: "give", key: "dose" }, 24 * H);
    v = view(events, f, 24 * H + 5);
    expect(step(v, "Doses 2 and 3").status).toBe("done");
    expect(v.tasks.some((t) => t.key === "swallow")).toBe(true);
    expect(isOffered(v, "dr", { t: "mark", key: "al" })).toBe(false);

    act("rn", { t: "set", key: "swallow", value: "Can swallow" }, 25 * H);
    act("dr", { t: "mark", key: "al" }, 25 * H + 5);
    v = view(events, f, 25 * H + 6);
    expect(step(v, "Switch to tablets").status).toBe("done");
    expect(isOffered(v, "dr", { t: "end" })).toBe(true);
    add("end", { reason: "switched to tablets" }, "dr", 25 * H + 10);
    v = view(events, f, 25 * H + 11);
    expect(v.endedAt).not.toBeNull();
    expect(v.tasks).toEqual([]);
    expect(v.stats.find((s) => s.k === "Doses given")!.v).toBe("3 of 3");
  });
});
