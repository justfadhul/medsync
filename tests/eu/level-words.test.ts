import { describe, expect, it } from "vitest";

import { levelWords } from "@/lib/eu/level-words";
import { freeByNeed } from "@/lib/wards/geometry";

describe("level words (DRAFT for the CSO)", () => {
  it("the hospital's own words, with the level after", () => {
    expect(levelWords("sats", 2)).toBe("Orange (L2)");
    expect(levelWords("etat", 1)).toBe("Emergency (L1)");
    expect(levelWords(null, 3)).toBe("L3 · Yellow");
  });
  it("level words never say Blue", () => {
    for (const s of ["sats", "etat", "other", "none", null])
      for (const l of [1, 2, 3, 4, 5] as const) expect(levelWords(s, l)).not.toMatch(/blue/i);
  });
});

describe("freeByNeed with the EU needs", () => {
  const bed = (id: string, type: "resus" | "chair" | "standard") => ({
    id,
    label: id,
    state: "free" as const,
    services: [],
    roomKind: null,
    type,
  });
  const beds = [bed("R1", "resus"), bed("C1", "chair"), bed("B1", "standard")];
  it("lists resus and chair by type only when asked", () => {
    const eu = Object.fromEntries(
      freeByNeed(beds, { eu: true }).map((n) => [n.need, n.beds.map((b) => b.label)]),
    );
    expect(eu.resus).toEqual(["R1"]);
    expect(eu.chair).toEqual(["C1"]);
    expect(freeByNeed(beds).map((n) => n.need)).toEqual([
      "any",
      "o2",
      "suction",
      "monitor",
      "single",
    ]);
  });
});
