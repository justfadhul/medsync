import { describe, expect, it } from "vitest";

import { byRound, roundOf } from "@/lib/nurse/round";

describe("the medicines round (ADR 0545)", () => {
  it("places doses in the four rounds by Kampala time", () => {
    expect(roundOf("2026-11-30T03:00:00Z")).toBe(1); // 06:00 EAT
    expect(roundOf("2026-11-30T02:59:00Z")).toBe(0); // 05:59 EAT
    expect(roundOf("2026-11-30T15:00:00Z")).toBe(3); // 18:00 EAT
    const r = byRound([{ at: "2026-11-30T05:00:00Z" }, { at: "2026-11-30T19:30:00Z" }]);
    expect(r.map((x) => x.length)).toEqual([0, 1, 0, 1]);
  });
});
