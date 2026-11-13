/**
 * The clinic floor model (lib/clinic-floor/model.ts): CF11 one patient one place, D-CF-02 line order (S14),
 * D-CF-04 didn't come (S17), D-CF-15 results ready (S15), D-CF-20 re-check due, S13 calls blocked, S3 the screen
 * feed carries codes and rooms only, D-CF-18 medians hidden until 3.
 */
import type { FloorEvent, FloorVisit } from "@/lib/clinic-floor/model";
import { describe, expect, it } from "vitest";

import {
  canCall,
  doctorStates,
  FLOOR_STEPS,
  floorMetrics,
  lineOrder,
  projectFloor,
  projectVisit,
  recheckDueAt,
  screenFeed,
  triageOrder,
} from "@/lib/clinic-floor/model";

const T0 = Date.UTC(2026, 10, 13, 6, 0);
const min = (n: number) => T0 + n * 60_000;

function visit(id: string, o: Partial<FloorVisit> = {}): FloorVisit {
  return {
    intakeId: id,
    code: `C${id}`,
    departmentId: "opd",
    doctorUserId: null,
    arrivedAt: min(0),
    needsTriage: true,
    level: null,
    triagedAt: null,
    recheck: null,
    deskFlag: false,
    resultsReleasedAt: [],
    ...o,
  };
}
const ev = (
  intakeId: string | null,
  kind: FloorEvent["kind"],
  at: number,
  o: Partial<FloorEvent> = {},
): FloorEvent => ({
  intakeId,
  kind,
  detail: null,
  doctorUserId: "doc",
  departmentId: "opd",
  room: "Room 2",
  at,
  ...o,
});

describe("CF11: one patient, one place", () => {
  it("every visit lands in exactly one step, none lost or doubled, over random event streams", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const kinds: FloorEvent["kind"][] = [
      "call",
      "call_again",
      "here",
      "didnt_come",
      "sent_for_tests",
      "finish",
      "moved",
    ];
    for (let run = 0; run < 200; run++) {
      const visits = Array.from({ length: 12 }, (_, i) =>
        visit(
          `v${i}`,
          rnd() > 0.5 ? { level: (1 + Math.floor(rnd() * 5)) as 1, triagedAt: min(5) } : {},
        ),
      );
      const events = Array.from({ length: 40 }, (_, i) =>
        ev(`v${Math.floor(rnd() * 12)}`, kinds[Math.floor(rnd() * kinds.length)]!, min(10 + i)),
      );
      const rows = projectFloor(visits, events);
      expect(rows.map((r) => r.intakeId).sort()).toEqual(visits.map((v) => v.intakeId).sort());
      for (const r of rows) expect(FLOOR_STEPS).toContain(r.step);
    }
  });
});

describe("S14: line order (D-CF-02)", () => {
  it("level, then back from tests before L4, then arrival; untriaged sits with L4", () => {
    const rows = projectFloor(
      [
        visit("l4-early", { level: 4, triagedAt: min(1), arrivedAt: min(1) }),
        visit("l2", { level: 2, triagedAt: min(2), arrivedAt: min(9) }),
        visit("desk", { needsTriage: false, arrivedAt: min(2) }),
        visit("l3", { level: 3, triagedAt: min(3), arrivedAt: min(8) }),
        visit("l5", { level: 5, triagedAt: min(3), arrivedAt: min(0) }),
        visit("tests", {
          level: 4,
          triagedAt: min(1),
          arrivedAt: min(7),
          resultsReleasedAt: [min(30)],
        }),
      ],
      [ev("tests", "sent_for_tests", min(20))],
    );
    expect(lineOrder(rows).map((r) => r.intakeId)).toEqual([
      "l2",
      "l3",
      "tests",
      "l4-early",
      "desk",
      "l5",
    ]);
  });
  it("ties by arrival", () => {
    const rows = projectFloor(
      [
        visit("b", { level: 3, triagedAt: min(1), arrivedAt: min(5) }),
        visit("a", { level: 3, triagedAt: min(1), arrivedAt: min(4) }),
      ],
      [],
    );
    expect(lineOrder(rows).map((r) => r.intakeId)).toEqual(["a", "b"]);
  });
});

describe("S17: didn't come (D-CF-04)", () => {
  it("first time: end of their group; second time: visit over, didn't wait", () => {
    const visits = [
      visit("x", { level: 3, triagedAt: min(1), arrivedAt: min(1) }),
      visit("y", { level: 3, triagedAt: min(1), arrivedAt: min(5) }),
    ];
    const once = projectFloor(visits, [ev("x", "call", min(10)), ev("x", "didnt_come", min(15))]);
    expect(lineOrder(once).map((r) => r.intakeId)).toEqual(["y", "x"]);
    const twice = projectVisit(visits[0]!, [
      ev("x", "call", min(10)),
      ev("x", "didnt_come", min(15)),
      ev("x", "call", min(20)),
      ev("x", "didnt_come", min(25)),
    ]);
    expect(twice).toMatchObject({ step: "done", outcome: "didnt_wait", didntCome: 2 });
  });
});

describe("S15: tests round-trip (D-CF-15)", () => {
  it("a result released after they were sent returns them to the line, results ready", () => {
    const v = visit("f", { level: 4, triagedAt: min(1), resultsReleasedAt: [min(5), min(40)] });
    const away = projectVisit({ ...v, resultsReleasedAt: [min(5)] }, [
      ev("f", "here", min(10)),
      ev("f", "sent_for_tests", min(20)),
    ]);
    expect(away.step).toBe("tests");
    const back = projectVisit(v, [ev("f", "here", min(10)), ev("f", "sent_for_tests", min(20))]);
    expect(back).toMatchObject({ step: "line", resultsReady: true, since: min(40) });
  });
});

describe("re-check due (D-CF-20)", () => {
  it("hourly and continuous fall due 60 min after the check; longer bands and finished visits none", () => {
    const hourly = projectVisit(
      visit("h", { level: 3, triagedAt: min(10), recheck: "hourly" }),
      [],
    );
    expect(recheckDueAt(hourly)).toBe(min(70));
    expect(
      recheckDueAt(
        projectVisit(visit("c", { level: 2, triagedAt: min(0), recheck: "continuous" }), []),
      ),
    ).toBe(min(60));
    expect(
      recheckDueAt(projectVisit(visit("s", { level: 4, triagedAt: min(0), recheck: "4-6h" }), [])),
    ).toBeNull();
    const seen = projectVisit(visit("w", { level: 3, triagedAt: min(0), recheck: "hourly" }), [
      ev("w", "here", min(5)),
    ]);
    expect(recheckDueAt(seen)).toBeNull();
  });
});

describe("S13 and D-CF-09: doctor status", () => {
  it("calls only In room; no status counts as In room; breaks carry their end", () => {
    const states = doctorStates([
      ev(null, "doctor_status", min(0), { detail: "in_room", doctorUserId: "a" }),
      ev(null, "doctor_status", min(5), { detail: "break_15", doctorUserId: "a", room: null }),
      ev(null, "doctor_status", min(5), { detail: "away", doctorUserId: "b", room: "Room 4" }),
    ]);
    expect(canCall(states.get("a"))).toBe(false);
    expect(states.get("a")).toMatchObject({ until: min(20), room: "Room 2" });
    expect(canCall(states.get("nobody"))).toBe(true);
  });
});

describe("S3: the screen feed (D-CF-03, ADR 0084)", () => {
  it("holds codes, rooms and call times only, and the paused rooms", () => {
    const rows = projectFloor(
      [
        visit("1", { level: 3, triagedAt: min(1) }),
        visit("2", { level: 3, triagedAt: min(1) }),
        visit("3"),
      ],
      [ev("1", "call", min(10)), ev("2", "call", min(5)), ev("2", "here", min(7))],
    );
    const feed = screenFeed(
      rows,
      doctorStates([
        ev(null, "doctor_status", min(8), {
          detail: "break_10",
          doctorUserId: "doc",
          room: "Room 3",
        }),
      ]),
    );
    expect(feed).toEqual({
      now: [{ code: "C1", room: "Room 2", calledAt: min(10) }],
      recent: [{ code: "C2", room: "Room 2", calledAt: min(7) }],
      paused: [{ room: "Room 3", status: "break" }],
    });
    for (const it of [...feed.now, ...feed.recent])
      expect(Object.keys(it).sort()).toEqual(["calledAt", "code", "room"]);
  });
});

describe("D-CF-18 and CF6: metrics and the worklist", () => {
  it("medians stay hidden until 3 completions, then clear-by uses the measured median", () => {
    const two = [
      visit("a", { level: 4, triagedAt: min(4) }),
      visit("b", { level: 4, triagedAt: min(6) }),
    ];
    const now = min(60);
    expect(floorMetrics(projectFloor(two, []), [], now).medianTriage).toBeNull();
    const three = [...two, visit("c", { level: 4, triagedAt: min(8) }), visit("w1"), visit("w2")];
    const m = floorMetrics(projectFloor(three, []), [], now);
    expect(m.medianTriage).toBe(6 * 60_000);
    expect(m.clearTriageIn).toBe(2 * 6 * 60_000);
    expect(m.count).toMatchObject({ triage: 2, line: 3 });
    expect(m.slowest).toBe("triage");
  });
  it("desk flags order the worklist and never set a level (S11)", () => {
    const rows = projectFloor(
      [visit("old", { arrivedAt: min(0) }), visit("flag", { arrivedAt: min(9), deskFlag: true })],
      [],
    );
    expect(triageOrder(rows).map((r) => r.intakeId)).toEqual(["flag", "old"]);
    expect(rows.every((r) => r.level === null)).toBe(true);
  });
});
