import { describe, expect, it } from "vitest";

import { admitsHere } from "@/lib/emr/read/close";

describe("admitsHere", () => {
  it("an emergency unit is not offered under Admit when the flag is on", () => {
    expect(admitsHere("emergency_observation", true)).toBe(false);
  });
  it("flag off: as today", () => {
    expect(admitsHere("emergency_observation", false)).toBe(true);
  });
  it("other wards admit", () => {
    expect(admitsHere(null, true)).toBe(true);
    expect(admitsHere("general", true)).toBe(true);
  });
});
