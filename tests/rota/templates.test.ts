import type { Assignment } from "@/lib/rota/cover";
import type { TemplateLine } from "@/lib/rota/templates";
import { describe, expect, it } from "vitest";

import { windowFor } from "@/lib/rota/cover";
import { fillWeek, mondayOf, weekPublished } from "@/lib/rota/templates";

const WEEK = "2026-11-23"; // a Monday
const line = (o: Partial<TemplateLine>): TemplateLine => ({
  id: "l1",
  postId: "p1",
  weekdays: [1, 2],
  shift: "day",
  userId: "u1",
  ...o,
});
const held = (day: string, o: Partial<Assignment> = {}): Assignment => ({
  id: "a1",
  postId: "p1",
  userId: "u1",
  ...windowFor(day, "day"),
  kind: "rostered",
  coversAssignmentId: null,
  endedAt: null,
  ...o,
});

describe("fillWeek", () => {
  it("fill skips held windows and unnamed lines", () => {
    const out = fillWeek([line({}), line({ id: "l2", postId: "p2", userId: null })], WEEK, [
      held("2026-11-23"),
    ]);
    expect(out).toEqual([{ postId: "p1", userId: "u1", day: "2026-11-24", shift: "day" }]);
  });

  it("an early-ended duty holds only what it covered (R34)", () => {
    const w = windowFor("2026-11-23", "day");
    const early = held("2026-11-23", { endedAt: new Date(w.startsAt.getTime() + 3_600_000) });
    expect(fillWeek([line({ weekdays: [1] })], WEEK, [early])).toEqual([]);
    const empty = held("2026-11-23", { endedAt: w.startsAt }); // ended at its start: holds nothing
    expect(fillWeek([line({ weekdays: [1] })], WEEK, [empty])).toHaveLength(1);
  });

  it("a week duty fills once, on Monday", () => {
    const out = fillWeek([line({ shift: "week", weekdays: [1, 2, 3, 4, 5, 6, 7] })], WEEK, []);
    expect(out).toEqual([{ postId: "p1", userId: "u1", day: WEEK, shift: "week" }]);
  });
});

describe("week state", () => {
  const ev = (kind: "publish" | "unlock", h: number, d = "d1", w = WEEK) => ({
    departmentId: d,
    weekStart: w,
    kind,
    at: new Date(Date.UTC(2026, 10, 20, h)),
  });
  it("published until unlocked", () => {
    expect(weekPublished([], "d1", WEEK)).toBe(false);
    expect(weekPublished([ev("publish", 1)], "d1", WEEK)).toBe(true);
    expect(weekPublished([ev("unlock", 2), ev("publish", 1)], "d1", WEEK)).toBe(false);
    expect(weekPublished([ev("publish", 1), ev("unlock", 2), ev("publish", 3)], "d1", WEEK)).toBe(
      true,
    );
    expect(weekPublished([ev("publish", 1, "d2")], "d1", WEEK)).toBe(false);
  });
});

describe("mondayOf", () => {
  it("mondayOf Sunday is the Monday before", () => {
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(mondayOf("2026-11-25")).toBe("2026-11-23");
  });
});
