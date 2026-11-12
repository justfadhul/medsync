/**
 * Status epilepticus (prescribing kit P5, FEATURES.md §2.7), `lib/protocols/rules/se.ts` over the
 * 0282 rules and the 0286 seed. Engine units, then S10's walk: Tumusiime Alex (22 kg), diazepam
 * 6.6 mg → 2nd dose → phenobarbital 440 mg → refractory alert at 40 minutes → fitting stopped → end.
 * Every act is checked against what the chart offers that role (as the server does) first.
 */
import type { Act, Role } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { deriveChart, isOffered } from "@/lib/protocols/engine/derive";
import { facts, lab, log, MIN, seedVersion, T0 } from "./_seed-0286";

const V = seedVersion("se");
const view = (events: Parameters<typeof deriveChart>[2], f = facts(), at = 1) =>
  deriveChart(V, { startedAt: T0 }, events, f, T0 + at * MIN);
const step = (v: ReturnType<typeof view>, title: string) =>
  [...v.phases.flatMap((p) => p.acts), ...v.rn.acts].find((s) => s.title.startsWith(title))!;
const DZ_IV: Act = { t: "give", key: "dzIv" };
const DZ_PR: Act = { t: "give", key: "dzPr" };

describe("status epilepticus (se)", () => {
  it("reads every number from the seed; without it the chart is blocked", () => {
    expect(view([]).blocked).toBeNull();
    expect(
      deriveChart({ ...V, seed: {} }, { startedAt: T0 }, [], facts(), T0).blocked,
    ).toBeTruthy();
  });

  it("adult: 10 mg IV or 10 to 20 mg rectally; low glucose 3.5 gives 50% glucose first", () => {
    const v = view([], facts({ weightKg: null, results: lab({ cbg: 3.5 }) }));
    const a2 = step(v, "Diazepam: first dose");
    expect(a2.rows[1]!.v).toBe("10 mg = 2 ml of 5 mg/ml, slowly");
    expect(a2.rows[2]!.v).toContain("10 to 20 mg");
    expect(isOffered(v, "rn", DZ_IV)).toBe(true);
    expect(isOffered(v, "dr", DZ_IV)).toBe(false);
    expect(step(v, "Stabilise").branches[0]!.on).toBe(true);
    expect(step(v, "Stabilise").branches[0]!.text).toContain("thiamine 100 mg");
    expect(v.tasks.some((t) => t.key === "glu")).toBe(true);
  });

  it("a child with no weight: no diazepam until the doctor records one (P7)", () => {
    const v = view([], facts({ ageYears: 6, weightKg: null }));
    expect(isOffered(v, "rn", DZ_IV)).toBe(false);
    expect(isOffered(v, "dr", { t: "weight" })).toBe(true);
  });

  it("the nurse's fitting card: stopped, then fitting again", () => {
    const { events, add } = log();
    add("mark", { key: "stopped" }, "rn", 2);
    let v = view(events, facts(), 3);
    expect(isOffered(v, "rn", { t: "mark", key: "again" })).toBe(true);
    expect(isOffered(v, "dr", { t: "mark", key: "again" })).toBe(false);
    expect(v.stats.find((s) => s.k === "Fitting")!.v).toBe("Stopped");
    add("mark", { key: "again" }, "rn", 4);
    v = view(events, facts(), 5);
    expect(isOffered(v, "rn", { t: "mark", key: "stopped" })).toBe(true);
  });

  it("S10: Tumusiime Alex, 6.6 mg → 2nd dose → phenobarbital 440 mg → refractory at 40 min", () => {
    const f = facts({ ageYears: 6, weightKg: 22, results: lab({ cbg: 5.1 }) });
    const { events, add } = log();
    const act = (role: Role, a: Act, minutes: number) => {
      expect(isOffered(view(events, f, minutes), role, a), JSON.stringify(a)).toBe(true);
      const { t, ...rest } = a;
      add(t, rest as Record<string, unknown>, role, minutes);
    };
    for (const x of ["Airway open, suctioned", "Oxygen on", "On the side"])
      act("rn", { t: "toggle", key: "abc", value: x }, 1);
    let v = view(events, f, 2);
    expect(step(v, "Stabilise").status).toBe("done");
    expect(step(v, "Diazepam: first dose").rows[1]!.v).toBe("6.6 mg = 1.3 ml of 5 mg/ml, slowly");
    act("rn", DZ_IV, 5);
    act("rn", DZ_PR, 15);
    // P6: no third diazepam, by any route.
    v = view(events, f, 16);
    expect(isOffered(v, "rn", DZ_IV)).toBe(false);
    expect(isOffered(v, "rn", DZ_PR)).toBe(false);
    expect(step(v, "Phenobarbital").rows[0]!.v).toContain("440 mg");
    v = view(events, f, 25);
    expect(v.tasks.find((t) => t.key === "pb")!.title).toContain("440 mg");
    act("rn", { t: "mark", key: "pbAt" }, 26);
    v = view(events, f, 40);
    const c1 = step(v, "Still fitting: refractory");
    expect(c1.status).toBe("needs");
    expect(c1.lines[0]!.text).toContain("40 minutes");
    act("dr", { t: "mark", key: "anaes" }, 40);
    act("rn", { t: "mark", key: "stopped" }, 45);
    act("dr", { t: "mark", key: "maint" }, 50);
    v = view(events, f, 51);
    expect(step(v, "After the fit stops").status).toBe("done");
    expect(isOffered(v, "dr", { t: "end" })).toBe(true);
    add("end", { reason: "fitting stopped" }, "dr", 52);
    v = view(events, f, 53);
    expect(v.tasks).toEqual([]);
  });
});
