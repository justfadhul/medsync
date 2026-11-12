/**
 * Organophosphate poisoning (prescribing kit P5, FEATURES.md §2.8), `lib/protocols/rules/op.ts`
 * over the 0282 rules and the 0286 seed. Engine units, then S10's walk: Ouma Daniel, atropine 2, 4,
 * 8, 16 mg → all 5 signs → infusion 4.5 mg/h → too much → stop → restart at 80% → end. Every act is
 * checked against what the chart offers that role (as the server does) before it is logged.
 */
import type { Act, Role } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { deriveChart, isOffered } from "@/lib/protocols/engine/derive";
import { facts, log, MIN, seedVersion, T0 } from "./_seed-0286";

const V = seedVersion("op");
const view = (events: Parameters<typeof deriveChart>[2], f = facts(), at = 1) =>
  deriveChart(V, { startedAt: T0 }, events, f, T0 + at * MIN);
const step = (v: ReturnType<typeof view>, title: string) =>
  [...v.phases.flatMap((p) => p.acts), ...v.rn.acts].find((s) => s.title.startsWith(title))!;
const ATRO: Act = { t: "give", key: "atro" };
const NOT = { pulse: "58", sbp: "90", chest: "0", axil: "0", pupil: "0" };

function treated(f = facts()) {
  const { events, add } = log();
  add("toggle", { key: "sx", value: "Small pupils" }, "dr", 0);
  add("toggle", { key: "sx", value: "Sweating" }, "dr", 0);
  return { events, add, f };
}

describe("organophosphate poisoning (op)", () => {
  it("reads every number from the seed; without it the chart is blocked", () => {
    expect(view([]).blocked).toBeNull();
    expect(
      deriveChart({ ...V, seed: {} }, { startedAt: T0 }, [], facts(), T0).blocked,
    ).toBeTruthy();
  });

  it("no atropine before 2 signs; a child's dose is 0.02 mg/kg (at least 0.1 mg), with a weight", () => {
    expect(isOffered(view([]), "rn", ATRO)).toBe(false);
    const kid = treated(facts({ ageYears: 10, weightKg: 25 }));
    expect(step(view(kid.events, kid.f), "Atropine").sub).toContain("(0.5 mg)");
    const baby = treated(facts({ ageYears: 0, weightKg: 3 }));
    expect(step(view(baby.events, baby.f), "Atropine").sub).toContain("(0.1 mg)");
    const noW = treated(facts({ ageYears: 10, weightKg: null }));
    expect(isOffered(view(noW.events, noW.f), "rn", ATRO)).toBe(false);
    expect(isOffered(view(noW.events, noW.f), "dr", { t: "weight" })).toBe(true);
  });

  it("the doctor may call it at 3 signs with a clear chest; the nurse may not", () => {
    const { events, add, f } = treated();
    add("give", { key: "atro" }, "rn", 1);
    add("slot", { slot: 1, values: { ...NOT, pulse: "90", sbp: "100", chest: "1" } }, "rn", 6);
    const v = view(events, f, 7);
    expect(step(v, "Atropinised?").crit.filter((c) => c.ok)).toHaveLength(3);
    expect(isOffered(v, "dr", { t: "mark", key: "atrOk" })).toBe(true);
    expect(isOffered(v, "rn", { t: "mark", key: "atrOk" })).toBe(false);
  });

  it("S10: Ouma Daniel, 2, 4, 8, 16 mg → all 5 signs → infusion 4.5 mg/h → stop → 80%", () => {
    const { events, add, f } = treated();
    const act = (role: Role, a: Act, minutes: number) => {
      expect(isOffered(view(events, f, minutes), role, a), JSON.stringify(a)).toBe(true);
      const { t, ...rest } = a;
      add(t, rest as Record<string, unknown>, role, minutes);
    };
    expect(isOffered(view(events, f, 1), "dr", ATRO)).toBe(false);
    act("rn", ATRO, 1);
    for (const [h, m] of [
      [1, 6],
      [2, 11],
      [3, 16],
    ] as const) {
      expect(view(events, f, m).tasks.find((t) => t.key.startsWith("atro"))!.title).toContain(
        `${2 ** (h + 1)} mg`,
      );
      add("slot", { slot: h, values: NOT }, "rn", m);
      act("rn", ATRO, m);
    }
    let v = view(events, f, 20);
    expect(v.stats.find((s) => s.k === "Atropine")!.v).toBe("30 mg");
    add(
      "slot",
      { slot: 4, values: { pulse: "92", sbp: "110", chest: "1", axil: "1", pupil: "1" } },
      "rn",
      21,
    );
    v = view(events, f, 22);
    expect(step(v, "Atropinised?").status).toBe("done");
    expect(isOffered(v, "rn", ATRO)).toBe(false);
    expect(v.tasks.find((t) => t.key === "inf")!.title).toContain("4.5 mg an hour");
    expect(isOffered(v, "dr", { t: "mark", key: "infAt" })).toBe(false);
    act("rn", { t: "mark", key: "infAt" }, 23);
    expect(step(view(events, f, 24), "Atropine infusion").brief).toBe("4.5 mg/hour");

    // Too much atropine: the nurse stops it; the doctor restarts at 80% only after 30 minutes.
    act("rn", { t: "toggle", key: "tox", value: "Hot, fever" }, 60);
    act("rn", { t: "mark", key: "infHold" }, 61);
    expect(isOffered(view(events, f, 80), "dr", { t: "mark", key: "inf80" })).toBe(false);
    act("dr", { t: "mark", key: "inf80" }, 91);
    expect(step(view(events, f, 92), "Atropine infusion").brief).toBe("3.6 mg/hour");
    act("dr", { t: "end" } as Act, 120);
    v = view(events, f, 121);
    expect(v.endedAt).not.toBeNull();
    expect(v.tasks).toEqual([]);
  });
});
