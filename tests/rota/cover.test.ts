import type { Assignment, CoverWorld, Post, Shift } from "@/lib/rota/cover";
import { describe, expect, it } from "vitest";

import { dutyState, gaps, inPost, whoCovers, windowFor } from "@/lib/rota/cover";

/** Kampala wall-clock time (UTC+3, no DST), never the machine's zone. */
const K = (s: string) => new Date(`${s}+03:00`);

const post = (id: string, o: Partial<Post> = {}): Post => ({
  id,
  departmentId: "D",
  wardId: null,
  name: id,
  level: "junior",
  eligibleCadres: [],
  takesConsults: false,
  escalatesToPostId: null,
  capacity: 1,
  archived: false,
  ...o,
});

let n = 0;
const duty = (
  postId: string,
  userId: string,
  day: string,
  shift: Shift,
  o: Partial<Assignment> = {},
): Assignment => ({
  id: `a${++n}`,
  postId,
  userId,
  ...windowFor(day, shift),
  kind: "rostered",
  coversAssignmentId: null,
  endedAt: null,
  ...o,
});

const world = (o: Partial<CoverWorld> = {}): CoverWorld => ({
  posts: [],
  assignments: [],
  leave: [],
  heads: [],
  hospitalContacts: [],
  ...o,
});

const wardSho = post("ward-sho", { wardId: "W", name: "Ward 4B SHO" });
const deptOnCall = post("dept-oncall", { name: "SHO on call", takesConsults: true });

describe("rota cover engine", () => {
  it("night shift covers 02:00", () => {
    const night = windowFor("2026-11-24", "night");
    expect(night.startsAt.toISOString()).toBe("2026-11-24T14:00:00.000Z");
    expect(night.endsAt.toISOString()).toBe("2026-11-25T05:00:00.000Z");
    expect(() => windowFor("2026-02-30", "day")).toThrow(RangeError);
    expect(() => windowFor("24/11/2026", "day")).toThrow(RangeError);

    const w = world({
      posts: [wardSho],
      assignments: [
        duty("ward-sho", "DAY", "2026-11-24", "day"),
        duty("ward-sho", "NIGHT", "2026-11-24", "night"),
      ],
    });
    const r = whoCovers(w, { departmentId: "D", wardId: "W", at: K("2026-11-25T02:00:00") });
    expect(r.step).toBe("ward_post");
    expect(r.people).toEqual([
      {
        userId: "NIGHT",
        postId: "ward-sho",
        postName: "Ward 4B SHO",
        until: K("2026-11-25T08:00:00"),
      },
    ]);
  });

  it("no false gap at midnight or week start", () => {
    const day = [
      duty("ward-sho", "A", "2026-11-24", "day"),
      duty("ward-sho", "B", "2026-11-24", "night"),
      duty("ward-sho", "C", "2026-11-25", "day"),
    ];
    expect(gaps([wardSho], day, [], K("2026-11-24T08:00:00"), K("2026-11-25T17:00:00"))).toEqual(
      [],
    );
    // Coverage that really stops still shows, so the empty answer above is not vacuous.
    expect(gaps([wardSho], day, [], K("2026-11-24T08:00:00"), K("2026-11-25T20:00:00"))).toEqual([
      { postId: "ward-sho", from: K("2026-11-25T17:00:00"), to: K("2026-11-25T20:00:00") },
    ]);

    // 2026-11-23 and 2026-11-30 are Mondays.
    const consultant = post("cons", { level: "consultant" });
    const first = duty("cons", "X", "2026-11-23", "week");
    const second = duty("cons", "Y", "2026-11-30", "week");
    const weeks = [first, second];
    expect(first.endsAt).toEqual(second.startsAt);
    expect(second.startsAt).toEqual(K("2026-11-30T08:00:00"));
    expect(
      gaps([consultant], weeks, [], K("2026-11-23T08:00:00"), K("2026-12-07T08:00:00")),
    ).toEqual([]);
  });

  it("fallback order", () => {
    const at = K("2026-11-24T10:00:00");
    const q = { departmentId: "D", wardId: "W", at };
    const posts = [wardSho, deptOnCall];
    const heads = [
      { departmentId: "D", userId: "ACTING", acting: true },
      { departmentId: "D", userId: "HEAD", acting: false },
      { departmentId: "OTHER", userId: "ELSEWHERE", acting: false },
    ];
    const full = world({
      posts,
      assignments: [duty("dept-oncall", "ONCALL", "2026-11-24", "day24")],
      heads,
      hospitalContacts: ["C1", "C2"],
    });

    const r1 = whoCovers(full, q);
    expect(r1.step).toBe("department_post");
    expect(r1.people).toEqual([
      {
        userId: "ONCALL",
        postId: "dept-oncall",
        postName: "SHO on call",
        until: K("2026-11-25T08:00:00"),
      },
    ]);

    const r2 = whoCovers({ ...full, assignments: [] }, q);
    expect(r2.step).toBe("department_head");
    expect(r2.people.map((p) => p.userId)).toEqual(["HEAD", "ACTING"]);
    expect(r2.people[0]).toEqual({ userId: "HEAD", postId: null, postName: null, until: null });

    const r3 = whoCovers({ ...full, assignments: [], heads: [] }, q);
    expect(r3.step).toBe("hospital_contacts");
    expect(r3.people.map((p) => p.userId)).toEqual(["C1", "C2"]);

    expect(whoCovers(world({ posts }), q)).toEqual({ step: "none", people: [] });
  });

  it("levels filter the ward post", () => {
    const wardCons = post("ward-cons", {
      wardId: "W",
      level: "consultant",
      name: "Ward 4B consultant",
    });
    const at = K("2026-11-24T10:00:00");
    const sho = duty("ward-sho", "SHO", "2026-11-24", "day");
    const cons = duty("ward-cons", "CONS", "2026-11-23", "week");
    const levels = ["senior", "consultant"] as const;

    const both = world({ posts: [wardSho, wardCons, deptOnCall], assignments: [sho, cons] });
    const r = whoCovers(both, { departmentId: "D", wardId: "W", levels: [...levels], at });
    expect(r.step).toBe("ward_post");
    expect(r.people.map((p) => p.userId)).toEqual(["CONS"]);

    // Without a senior on the ward the junior is still skipped.
    const juniorOnly = world({
      posts: [wardSho, wardCons],
      assignments: [sho],
      heads: [{ departmentId: "D", userId: "HEAD", acting: false }],
    });
    expect(
      whoCovers(juniorOnly, { departmentId: "D", wardId: "W", levels: [...levels], at }).step,
    ).toBe("department_head");
    // No levels: the junior counts.
    expect(
      whoCovers(juniorOnly, { departmentId: "D", wardId: "W", at }).people.map((p) => p.userId),
    ).toEqual(["SHO"]);
  });

  it("leave makes needs cover and falls through", () => {
    const a = duty("ward-sho", "ONLEAVE", "2026-11-24", "day");
    const b = duty("dept-oncall", "ONCALL", "2026-11-24", "day");
    const leave = [
      { userId: "ONLEAVE", startsAt: K("2026-11-24T00:00:00"), endsAt: K("2026-11-25T00:00:00") },
    ];

    expect(dutyState(a, leave, K("2026-11-23T20:00:00"))).toBe("needs_cover");
    expect(dutyState(a, leave, K("2026-11-24T10:00:00"))).toBe("needs_cover");
    expect(dutyState(a, leave, K("2026-11-24T18:00:00"))).toBe("past");
    expect(dutyState(a, [], K("2026-11-23T20:00:00"))).toBe("planned");
    // Someone else's leave does not touch this duty.
    expect(dutyState(b, leave, K("2026-11-24T10:00:00"))).toBe("in_post");

    const at = K("2026-11-24T10:00:00");
    expect(inPost(a, leave, at)).toBe(false);
    const r = whoCovers(world({ posts: [wardSho, deptOnCall], assignments: [a, b], leave }), {
      departmentId: "D",
      wardId: "W",
      at,
    });
    expect(r.step).toBe("department_post");
    expect(r.people.map((p) => p.userId)).toEqual(["ONCALL"]);

    // The gap report sees the leave as a hole.
    const half = [
      { userId: "ONLEAVE", startsAt: K("2026-11-24T12:00:00"), endsAt: K("2026-11-24T14:00:00") },
    ];
    expect(gaps([wardSho], [a], half, K("2026-11-24T08:00:00"), K("2026-11-24T17:00:00"))).toEqual([
      { postId: "ward-sho", from: K("2026-11-24T12:00:00"), to: K("2026-11-24T14:00:00") },
    ]);
  });

  it("an ended assignment stops at ended_at", () => {
    const a = duty("ward-sho", "EARLY", "2026-11-24", "day", { endedAt: K("2026-11-24T12:00:00") });
    expect(inPost(a, [], K("2026-11-24T11:59:00"))).toBe(true);
    expect(inPost(a, [], K("2026-11-24T12:00:00"))).toBe(false);
    expect(dutyState(a, [], K("2026-11-24T11:00:00"))).toBe("in_post");
    expect(dutyState(a, [], K("2026-11-24T13:00:00"))).toBe("ended_early");

    const ward = { departmentId: "D", wardId: "W" };
    expect(
      whoCovers(world({ posts: [wardSho], assignments: [a] }), {
        ...ward,
        at: K("2026-11-24T11:00:00"),
      }).people[0]?.until,
    ).toEqual(K("2026-11-24T12:00:00"));
    expect(
      whoCovers(world({ posts: [wardSho], assignments: [a] }), {
        ...ward,
        at: K("2026-11-24T13:00:00"),
      }).step,
    ).toBe("none");
    expect(gaps([wardSho], [a], [], K("2026-11-24T08:00:00"), K("2026-11-24T17:00:00"))).toEqual([
      { postId: "ward-sho", from: K("2026-11-24T12:00:00"), to: K("2026-11-24T17:00:00") },
    ]);
    // An archived post is never a gap.
    expect(
      gaps(
        [{ ...wardSho, archived: true }],
        [a],
        [],
        K("2026-11-24T08:00:00"),
        K("2026-11-24T17:00:00"),
      ),
    ).toEqual([]);
  });

  it("capacity two lists both holders", () => {
    const shos = post("ward-shos", { wardId: "W", name: "The SHOs on Ward 4B", capacity: 2 });
    const w = world({
      posts: [shos],
      assignments: [
        duty("ward-shos", "S1", "2026-11-24", "day"),
        duty("ward-shos", "S2", "2026-11-24", "day"),
      ],
    });
    const r = whoCovers(w, { departmentId: "D", wardId: "W", at: K("2026-11-24T10:00:00") });
    expect(r.step).toBe("ward_post");
    expect(r.people.map((p) => p.userId)).toEqual(["S1", "S2"]);
  });
});
