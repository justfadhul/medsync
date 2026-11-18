import type { TodayState } from "@patient-core/today-hero";
import {
  careTodayState,
  kampalaInstant,
  medsWeek,
  planDay,
  tenDays,
} from "@patient-core/care-plan";
import { heroFor, heroTone } from "@patient-core/today-hero";
import { describe, expect, it } from "vitest";

const items = [
  { key: "metformin", name: "Metformin", why: "For your sugar", times: ["08:00", "20:00"] },
  { key: "sugar", name: "Sugar check", kind: "check" as const, times: ["07:00"] },
];
const at = (day: string, hhmm: string) => kampalaInstant(day, hhmm);
const tick = (
  key: string,
  day: string,
  hhmm: string,
  status: "taken" | "skipped" | "snoozed",
  rec = "2026-11-16T05:00:00Z",
) => ({
  medicineKey: key,
  dueAtIso: at(day, hhmm).toISOString(),
  status,
  recordedAtIso: rec,
});

describe("S17: the Today ladder picks the right hero for every combination", () => {
  const parts: (keyof TodayState)[] = ["danger", "teamAsks", "dueNow", "visitToday", "nextItem"];
  const filled: TodayState = {
    danger: { kind: "low_sugar", at: "x" },
    teamAsks: { id: "a", from: "Nurse", at: "x" },
    dueNow: { kind: "dose", key: "k", label: "Metformin", dueAt: "08:00" },
    visitToday: { appointmentId: "v", window: "08:00 to 10:00" },
    nextItem: { kind: "dose", label: "Metformin", at: "20:00" },
    nothingUntil: "tomorrow 08:00",
  };
  for (let mask = 0; mask < 32; mask++) {
    const s = { ...filled } as TodayState;
    parts.forEach((p, i) => {
      if (!(mask & (1 << i))) (s as unknown as Record<string, unknown>)[p] = null;
    });
    const first = parts.findIndex((_, i) => mask & (1 << i));
    it(`mask ${mask.toString(2).padStart(5, "0")} → rung ${first === -1 ? 6 : first + 1}`, () => {
      const h = heroFor(s);
      expect(h.rung).toBe(first === -1 ? 6 : first + 1);
      expect(heroTone(h) === "emergency").toBe(h.rung === 1);
    });
  }
});

describe("planDay", () => {
  const day = "2026-11-16";
  it("orders the day and reads each slot's state at now (Kampala time)", () => {
    const now = at(day, "08:10");
    const s = planDay(items, [tick("sugar", day, "07:00", "taken")], day, now);
    expect(s.map((x) => [x.at, x.name, x.state])).toEqual([
      ["07:00", "Sugar check", "done"],
      ["08:00", "Metformin", "due"],
      ["20:00", "Metformin", "later"],
    ]);
    expect(s[1]!.dueAtIso).toBe("2026-11-16T05:00:00.000Z");
  });
  it("missed after two hours; the newest tick wins", () => {
    const now = at(day, "10:30");
    expect(planDay(items, [], day, now)[1]!.state).toBe("missed");
    const both = [
      tick("metformin", day, "08:00", "skipped", "2026-11-16T05:10:00Z"),
      tick("metformin", day, "08:00", "taken", "2026-11-16T05:20:00Z"),
    ];
    expect(planDay(items, both, day, now)[1]!.state).toBe("done");
  });
});

describe("medsWeek", () => {
  it("taken, some, missed, and today due; checks are not medicines", () => {
    const now = at("2026-11-16", "12:00");
    const ticks = [
      tick("metformin", "2026-11-15", "08:00", "taken"),
      tick("metformin", "2026-11-15", "20:00", "taken"),
      tick("metformin", "2026-11-14", "08:00", "taken"),
      tick("metformin", "2026-11-16", "08:00", "taken"),
    ];
    const w = medsWeek(items, ticks, now);
    expect(w).toHaveLength(7);
    expect(w.slice(-3).map((d) => d.mark)).toEqual(["some", "taken", "due"]);
    expect(w[0]!.mark).toBe("missed");
    expect(medsWeek([items[1]!], [], now)[0]!.mark).toBe("none");
  });
});

describe("careTodayState", () => {
  const now = at("2026-11-16", "08:10");
  const base = { items, ticks: [], alerts: [], asks: [], visitToday: null, now };
  it("a dose due now is rung 3; nothing open is rung 6 with tomorrow's first time", () => {
    expect(heroFor(careTodayState(base)).rung).toBe(3);
    const evening = at("2026-11-16", "23:00");
    const done = [
      tick("sugar", "2026-11-16", "07:00", "taken"),
      tick("metformin", "2026-11-16", "08:00", "taken"),
      tick("metformin", "2026-11-16", "20:00", "taken"),
    ];
    const h = heroFor(careTodayState({ ...base, ticks: done, now: evening }));
    expect(h).toEqual({ rung: 6, kind: "rest", until: "tomorrow 07:00" });
  });
  it("only an unacknowledged alert from the last day is danger", () => {
    const fresh = {
      kind: "low_sugar" as const,
      atIso: "2026-11-16T04:00:00Z",
      acknowledged: false,
    };
    expect(heroFor(careTodayState({ ...base, alerts: [fresh] })).rung).toBe(1);
    expect(
      heroFor(careTodayState({ ...base, alerts: [{ ...fresh, acknowledged: true }] })).rung,
    ).toBe(3);
    expect(
      heroFor(careTodayState({ ...base, alerts: [{ ...fresh, atIso: "2026-11-14T04:00:00Z" }] }))
        .rung,
    ).toBe(3);
  });
});

describe("tenDays (the reading card)", () => {
  const now = new Date("2026-11-16T09:00:00Z");
  const r = (at: string, value: number, context = "fasting") => ({
    at,
    input: { kind: "sugar" as const, value, context },
  });
  it("one value per Kampala day, gaps kept, other timings left out, and the week-ago value", () => {
    const { days, weekAgo } = tenDays(
      [
        r("2026-11-16T04:00:00Z", 6.9),
        r("2026-11-16T10:00:00Z", 9.9, "after"),
        r("2026-11-15T22:30:00Z", 7.1), // 01:30 on the 16th in Kampala: an older reading that day
        r("2026-11-09T04:00:00Z", 7.5),
      ],
      "sugar",
      now,
    );
    expect(days).toHaveLength(10);
    expect(days[9]).toMatchObject({ date: "16 Nov", value: 6.9 });
    expect(days[8]!.value).toBeNull();
    expect(days[2]).toMatchObject({ date: "9 Nov", value: 7.5 });
    expect(weekAgo).toBe(7.5);
  });
  it("blood pressure carries both numbers; nothing logged is all gaps", () => {
    const bp = tenDays(
      [{ at: "2026-11-16T04:00:00Z", input: { kind: "bp", top: 142, bottom: 91 } }],
      "bp",
      now,
    );
    expect(bp.days[9]).toMatchObject({ value: 142, bottom: 91 });
    expect(tenDays([], "weight", now)).toMatchObject({ weekAgo: null });
  });
});

describe("daysOf and readingStats (the Readings page)", () => {
  it("30 days with gaps; stats over the days logged", async () => {
    const { daysOf, readingStats } = await import("@patient-core/care-plan");
    const now = new Date("2026-11-16T09:00:00Z");
    const r = (d: number, v: number) => ({
      at: new Date(now.getTime() - d * 86_400_000).toISOString(),
      input: { kind: "sugar" as const, value: v, context: "fasting" },
    });
    const { days } = daysOf([r(0, 6), r(2, 8), r(29, 7)], "sugar", now, 30);
    expect(days).toHaveLength(30);
    expect(days.filter((d) => d.value !== null)).toHaveLength(3);
    expect(readingStats(days, { lo: 4, hi: 7.2 })).toMatchObject({
      average: 7,
      inTarget: 2,
      logged: 3,
      latest: { value: 6 },
    });
    expect(
      readingStats(
        days.map((d) => ({ ...d, value: null })),
        null,
      ),
    ).toMatchObject({ average: null, inTarget: null, logged: 0 });
  });
});
