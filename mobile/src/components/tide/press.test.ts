import { minHitSlop } from "@/components/tide/press";

/** Apple HIG: every control takes at least a 44 × 44 pt touch. */
describe("minHitSlop", () => {
  it("grows a small control to 44 × 44", () => {
    expect(minHitSlop({ w: 30, h: 36 })).toEqual({ top: 4, bottom: 4, left: 7, right: 7 });
  });
  it("adds nothing to a control already 44 or more", () => {
    expect(minHitSlop({ w: 120, h: 52 })).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
  it("keeps a caller's larger slop", () => {
    expect(minHitSlop({ w: 40, h: 40 }, 10)).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
  });
  it("passes the caller's slop through before the first layout", () => {
    expect(minHitSlop(null)).toBeUndefined();
    expect(minHitSlop(null, 6)).toEqual({ top: 6, bottom: 6, left: 6, right: 6 });
  });
});
