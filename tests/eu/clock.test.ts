import { describe, expect, it } from "vitest";

import { durationWords, euClocks, overLimit } from "@/lib/eu/clock";
import { isArriving } from "@/lib/wards/geometry";

describe("EU clocks", () => {
  it("exactly 24 h is not over; one minute more is", () => {
    expect(overLimit(24 * 3_600_000, 24)).toBe(false);
    expect(overLimit(24 * 3_600_000 + 60_000, 24)).toBe(true);
  });
  it("words: minutes, then hours and minutes, never days", () => {
    expect(durationWords(59_999)).toBe("0 min");
    expect(durationWords(45 * 60_000)).toBe("45 min");
    expect(durationWords((3 * 60 + 10) * 60_000)).toBe("3 h 10 min");
    expect(durationWords((26 * 60 + 5) * 60_000)).toBe("26 h 5 min");
  });
  it("four clocks from recorded times; across a DST change the count is still elapsed time", () => {
    const c = euClocks({
      nowMs: Date.parse("2026-03-29T03:00:00Z"),
      hospitalArrivedAt: "2026-03-29T00:30:00Z",
      decidedAt: "2026-03-29T01:30:00Z",
      spaceStartedAt: null,
      admissionDecidedAt: null,
    });
    expect(c).toEqual({
      inHospitalMs: 2.5 * 3_600_000,
      inEuMs: 1.5 * 3_600_000,
      inSpaceMs: null,
      boardingMs: null,
    });
  });
  it("space and boarding clocks count from their own start; a future start is 0", () => {
    const c = euClocks({
      nowMs: Date.parse("2026-11-24T08:00:00Z"),
      hospitalArrivedAt: null,
      decidedAt: "2026-11-24T05:00:00Z",
      spaceStartedAt: "2026-11-24T06:00:00Z",
      admissionDecidedAt: "2026-11-24T07:15:00Z",
    });
    expect(c).toEqual({
      inHospitalMs: null,
      inEuMs: 3 * 3_600_000,
      inSpaceMs: 2 * 3_600_000,
      boardingMs: 45 * 60_000,
    });
    expect(
      euClocks({
        nowMs: 0,
        hospitalArrivedAt: null,
        decidedAt: "2026-11-24T05:00:00Z",
        spaceStartedAt: null,
        admissionDecidedAt: null,
      }).inEuMs,
    ).toBe(0);
  });
  it("an EU space not yet arrived is Arriving; arrived is Occupied", () => {
    expect(isArriving({ admissionId: null, euStayId: "s", arrivedAt: null })).toBe(true);
    expect(isArriving({ admissionId: null, euStayId: "s", arrivedAt: new Date() })).toBe(false);
    expect(isArriving({ admissionId: null, euStayId: null, arrivedAt: null })).toBe(false);
    expect(isArriving({ admissionId: "a", arrivedAt: null })).toBe(true);
  });
});
