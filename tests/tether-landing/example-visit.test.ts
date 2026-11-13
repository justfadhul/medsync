import { describe, expect, it } from "vitest";

import { countdown, exampleVisit } from "@/lib/landing/example-visit";

describe("example visit (D-LP-08)", () => {
  it("is six days ahead at 10:40 Kampala, across a month end", () => {
    // 27 Nov 2026, 22:30 UTC is 28 Nov 01:30 in Kampala, so the visit is Fri 4 Dec.
    const v = exampleVisit(Date.UTC(2026, 10, 27, 22, 30));
    expect(v.short).toBe("Fri 4 Dec");
    expect(v.long).toBe("Friday 4 December");
    expect(new Date(v.at).toISOString()).toBe("2026-12-04T07:40:00.000Z");
  });
  it("crosses a year end", () => {
    expect(exampleVisit(Date.UTC(2026, 11, 28, 12)).short).toBe("Sun 3 Jan");
  });
  it("counts down and stops at zero", () => {
    const now = Date.UTC(2026, 10, 13, 7, 40);
    const v = exampleVisit(now);
    expect(countdown(v.at, now)).toEqual(["6", "00", "00", "00"]);
    expect(countdown(v.at, now + 1000)).toEqual(["5", "23", "59", "59"]);
    expect(countdown(v.at, v.at + 5000)).toEqual(["0", "00", "00", "00"]);
  });
});
