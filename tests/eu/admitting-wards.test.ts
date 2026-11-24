import { describe, expect, it } from "vitest";

import { admitsHere } from "@/lib/emr/read/close";

describe("admitsHere", () => {
  it("an emergency unit is never offered under Admit, whatever the flag (0312 refuses it)", () => {
    expect(admitsHere("emergency_observation")).toBe(false);
  });
  it("other wards admit", () => {
    expect(admitsHere(null)).toBe(true);
    expect(admitsHere("general")).toBe(true);
  });
});
