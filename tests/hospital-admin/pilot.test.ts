import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { assemblePilot, median, pilotWeeks } from "@/lib/hospital-admin/pilot";

const H = "hosp-1";
const A = { hospitalId: H, lineId: "line-a", lineName: "Antenatal" };
const B = { hospitalId: H, lineId: "line-b", lineName: "Diabetes" };
const NONE = { hospitalId: H, lineId: null, lineName: null };
const WEEKS = ["2026-11-09", "2026-11-02"];

describe("median", () => {
  it("odd, even, unsorted, empty", () => {
    expect(median([7, 1, 3])).toBe(3);
    expect(median([10, 2, 4, 8])).toBe(6);
    expect(median([-5, 5])).toBe(0);
    expect(median([])).toBeNull();
  });
});

describe("pilotWeeks", () => {
  it("Monday-start Kampala weeks, newest first, from local midnight of the oldest Monday", () => {
    // Thu 12 Nov 2026, 09:00Z = 12:00 EAT.
    const { from, weeks } = pilotWeeks(new Date("2026-11-12T09:00:00Z"), 3);
    expect(weeks).toEqual(["2026-11-09", "2026-11-02", "2026-10-26"]);
    expect(from.toISOString()).toBe("2026-10-25T21:00:00.000Z");
  });

  it("late Sunday night UTC is already Monday in Kampala", () => {
    // 22:30Z Sun 15 Nov = 01:30 EAT Mon 16 Nov.
    const { weeks } = pilotWeeks(new Date("2026-11-15T22:30:00Z"), 1);
    expect(weeks).toEqual(["2026-11-16"]);
  });
});

describe("assemblePilot", () => {
  const out = assemblePilot(
    WEEKS,
    [
      { ...A, week: "2026-11-09", channel: "web", n: 3 },
      { ...A, week: "2026-11-09", channel: "desk", n: 2 },
      { ...B, week: "2026-11-09", channel: "app", n: 4 },
      { ...NONE, week: "2026-11-09", channel: "ussd", n: 1 },
      // Not a channel the pilot counts, and a week outside the window.
      { ...A, week: "2026-11-09", channel: "system", n: 9 },
      { ...A, week: "2026-10-26", channel: "web", n: 9 },
    ],
    [
      { ...A, week: "2026-11-02", noShow: 2, held: 12, unmarked: 1 },
      { ...B, week: "2026-11-02", noShow: 3, held: 8, unmarked: 0 },
    ],
    [
      { ...A, week: "2026-11-09", toCheckIn: [-10, 0, 20], toSeen: [30, 50] },
      { ...B, week: "2026-11-09", toCheckIn: [40], toSeen: [5, 100, 200] },
    ],
  );
  const h = out.get(H)!;
  const [thisWeek, lastWeek] = h.weeks;

  it("counts bookings by channel and totals only the four pilot channels", () => {
    expect(thisWeek!.booked).toEqual({ web: 3, app: 4, desk: 2, ussd: 1, total: 10 });
    expect(lastWeek!.booked.total).toBe(0);
  });

  it("sums lines into the hospital and keeps each line's own numbers", () => {
    const names = h.lines.map((l) => l.lineName);
    expect(names).toEqual(["Antenatal", "Diabetes", null]);
    const a = h.lines[0]!;
    expect(a.weeks[0]!.booked).toEqual({ web: 3, app: 0, desk: 2, ussd: 0, total: 5 });
    expect(a.weeks[1]).toMatchObject({ noShow: 2, held: 12, unmarked: 1, noShowShare: null });
    expect(h.lines[2]!.weeks[0]!.booked.total).toBe(1);
  });

  it("no-show share appears only once the held visits reach the sample floor", () => {
    expect(lastWeek).toMatchObject({ noShow: 5, held: 20, unmarked: 1, noShowShare: 0.25 });
    expect(h.lines[1]!.weeks[1]!.noShowShare).toBeNull();
  });

  it("the hospital median is over every line's minutes, not a median of medians", () => {
    // Lines' medians: check-in 0 and 40; seen 40 and 100.
    expect(h.lines[0]!.weeks[0]!.checkInVsBooked).toEqual({ median: 0, n: 3 });
    expect(h.lines[1]!.weeks[0]!.checkInToSeen).toEqual({ median: 100, n: 3 });
    // Pooled: [-10, 0, 20, 40] → 10; [5, 30, 50, 100, 200] → 50.
    expect(thisWeek!.checkInVsBooked).toEqual({ median: 10, n: 4 });
    expect(thisWeek!.checkInToSeen).toEqual({ median: 50, n: 5 });
    expect(lastWeek!.checkInToSeen).toEqual({ median: null, n: 0 });
  });

  it("every week is present, newest first, even when empty", () => {
    for (const series of [h.weeks, ...h.lines.map((l) => l.weeks)]) {
      expect(series.map((w) => w.week)).toEqual(WEEKS);
    }
  });

  it("a hospital with no rows is absent", () => {
    expect(out.size).toBe(1);
  });
});

describe("the pilot module selects counts and minutes, never a person", () => {
  const src = readFileSync(resolve(process.cwd(), "lib/hospital-admin/pilot.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("names no patient column, phone, code or note", () => {
    for (const needle of [
      "patientUserId",
      "provisionalPatientId",
      "bookingCode",
      "fullName",
      "phone",
      "reasonNote",
      "symptoms",
      "clinicianUserId",
      "users.",
    ]) {
      expect(src, needle).not.toContain(needle);
    }
  });

  it("every read is grouped by hospital", () => {
    const statements = src.split(/(?=\bdb\s*\n?\s*\.select\()/).slice(1);
    expect(statements).toHaveLength(3);
    for (const stmt of statements) expect(stmt).toMatch(/\.groupBy\(\s*appointments\.hospitalId/);
  });
});
