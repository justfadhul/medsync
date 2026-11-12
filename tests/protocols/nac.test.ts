/**
 * Paracetamol overdose: acetylcysteine 21 h (prescribing kit P5, FEATURES.md §2.9),
 * `lib/protocols/rules/nac.ts` over the 0282 rules and the 0286 seed. Engine units, then S10's walk:
 * Nabirye Joan (52 kg), 5 h ago, level 120 at 5 h (line 84) → treat → bags 7,800, 2,600 and 5,200 mg
 * → a reaction paused and restarted → normal bloods at the end of bag 3 → mental health review → end.
 * Every act is checked against what the chart offers that role (as the server does) first.
 */
import type { Act, Role } from "@/lib/protocols/engine/types";
import { describe, expect, it } from "vitest";

import { deriveChart, isOffered } from "@/lib/protocols/engine/derive";
import { facts, log, MIN, seedVersion, T0 } from "./_seed-0286";

const V = seedVersion("nac");
const view = (events: Parameters<typeof deriveChart>[2], f = facts(), at = 1) =>
  deriveChart(V, { startedAt: T0 }, events, f, T0 + at * MIN);
const step = (v: ReturnType<typeof view>, title: string) =>
  [...v.phases.flatMap((p) => p.acts), ...v.rn.acts].find((s) => s.title.startsWith(title))!;

/** A chart with these values typed by the doctor. */
function typed(values: Record<string, string>, f = facts()) {
  const { events, add } = log();
  for (const [key, value] of Object.entries(values))
    add(key === "stag" ? "set" : "value", { key, value }, "dr", 0);
  return view(events, f, 1);
}
const decision = (v: ReturnType<typeof view>) => step(v, "Treat?").brief;

describe("paracetamol overdose (nac)", () => {
  it("reads every number from the seed; without it the chart is blocked", () => {
    expect(view([]).blocked).toBeNull();
    expect(
      deriveChart({ ...V, seed: {} }, { startedAt: T0 }, [], facts(), T0).blocked,
    ).toBeTruthy();
  });

  it("the treatment line: 100 at 4 h, halving every 4 h; a level before 4 h cannot be read", () => {
    const at8 = typed({ para: "60", lvlH: "8", stag: "Single time", ingH: "8" });
    expect(step(at8, "Level and bloods").rows[0]!.v).toContain("50 mg/L");
    expect(decision(at8)).toBe("Treat");
    const early = typed({ para: "200", lvlH: "3" });
    expect(step(early, "Level and bloods").rows[0]!.v).toContain("Under 4 hours");
    expect(decision(early)).toBe("Not decided");
  });

  it("decides: staggered or late treats; under the line with normal liver tests does not; early waits", () => {
    expect(decision(typed({ stag: "Over more than 1 hour" }))).toBe("Treat");
    expect(decision(typed({ ingH: "9", amt: "10" }))).toBe("Treat");
    const below = typed({
      ingH: "5",
      stag: "Single time",
      para: "50",
      lvlH: "5",
      alt: "30",
      inr: "1",
    });
    expect(decision(below)).toBe("No treatment");
    expect(isOffered(below, "dr", { t: "end" })).toBe(true);
    expect(decision(typed({ ingH: "2", stag: "Single time" }))).toBe("Wait for the level");
  });

  it("caps the weight at 110 kg; no bag without a weight (P7)", () => {
    const big = typed({ stag: "Time not known" }, facts({ weightKg: 130 }));
    expect(step(big, "Bag 1").rows[0]!.v).toContain("16,500 mg");
    const none = typed({ stag: "Time not known" }, facts({ weightKg: null }));
    expect(isOffered(none, "rn", { t: "mark", key: "b1" })).toBe(false);
    expect(isOffered(none, "dr", { t: "weight" })).toBe(true);
  });

  it("S10: Nabirye Joan, level 120 at 5 h (line 84) → bags 7,800, 2,600, 5,200 mg → fit → end", () => {
    const f = facts({ sex: "female", weightKg: 52 });
    const { events, add } = log();
    const act = (role: Role, a: Act, minutes: number, value?: string) => {
      expect(isOffered(view(events, f, minutes), role, a), JSON.stringify(a)).toBe(true);
      const { t, ...rest } = a;
      add(t, value === undefined ? rest : { ...rest, value }, role, minutes);
    };
    act("dr", { t: "value", key: "ingH" }, 1, "5");
    act("dr", { t: "value", key: "amt" }, 1, "12");
    act("dr", { t: "set", key: "stag", value: "Single time" }, 1);
    act("dr", { t: "value", key: "para" }, 2, "120");
    act("dr", { t: "value", key: "lvlH" }, 2, "5");
    let v = view(events, f, 3);
    expect(step(v, "Level and bloods").rows[1]!.v).toBe("120 vs 84.1: on or above the line");
    expect(decision(v)).toBe("Treat");
    expect(step(v, "Bag 1").rows[0]!.v).toContain("7,800 mg");
    expect(step(v, "Bag 2").rows[0]!.v).toContain("2,600 mg");
    expect(step(v, "Bag 3").rows[0]!.v).toContain("5,200 mg");
    expect(isOffered(v, "dr", { t: "mark", key: "b1" })).toBe(false);

    act("rn", { t: "mark", key: "b1" }, 10);
    act("rn", { t: "mark", key: "react" }, 20);
    expect(isOffered(view(events, f, 21), "rn", { t: "mark", key: "restart" })).toBe(false);
    act("dr", { t: "mark", key: "restart" }, 30);
    v = view(events, f, 70);
    expect(v.tasks.find((t) => t.key === "bag2")!.sub).toContain("125 ml/hour");
    act("rn", { t: "mark", key: "b2" }, 70);
    act("rn", { t: "mark", key: "b3" }, 310);
    v = view(events, f, 400);
    expect(step(v, "The infusion").items[0]!.sub).toBe("62.5 ml/hour");

    // Bloods an hour before bag 3 ends (310 + 960 min): normal → medically fit.
    act("dr", { t: "value", key: "alt" }, 1215, "40");
    act("dr", { t: "value", key: "inr" }, 1215, "1.1");
    v = view(events, f, 1216);
    expect(step(v, "At the end of bag 3").branches[1]!.on).toBe(true);
    act("dr", { t: "mark", key: "mh" }, 1216);
    act("dr", { t: "end" }, 1220);
    v = view(events, f, 1221);
    expect(v.endedAt).not.toBeNull();
    expect(v.tasks).toEqual([]);
  });

  it("at the end of bag 3: INR over 1.3 continues; INR over 3 asks for a liver unit", () => {
    const { events, add } = log();
    add("set", { key: "stag", value: "Time not known" }, "dr", 0);
    for (const [k, m] of [
      ["b1", 1],
      ["b2", 61],
      ["b3", 301],
    ] as const)
      add("mark", { key: k }, "rn", m);
    add("value", { key: "inr" }, "dr", 1205);
    events[events.length - 1]!.payload.value = "3.5";
    const v = view(events, facts(), 1206);
    const e1 = step(v, "At the end of bag 3");
    expect(e1.branches[0]!.on).toBe(true);
    expect(e1.lines[0]!.kind).toBe("alert");
    expect(isOffered(v, "dr", { t: "mark", key: "ext" })).toBe(true);
    expect(isOffered(v, "dr", { t: "mark", key: "liver" })).toBe(true);
    expect(isOffered(v, "dr", { t: "end" })).toBe(false);
  });
});
