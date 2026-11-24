import type { OpenRequest } from "@/lib/requests/escalation";
import { describe, expect, it } from "vitest";

import {
  clockFor,
  dueAt,
  overdue,
  planRequestEscalations,
  replyDueSameDay,
  D4_DEFAULTS as T,
} from "@/lib/requests/escalation";

/** Kampala wall-clock time (UTC+3, no DST), never the machine's zone. */
const K = (s: string) => new Date(`${s}+03:00`);
const req = (o: Partial<OpenRequest> = {}): OpenRequest => ({
  id: "r1",
  hospitalId: "H",
  kind: "review",
  urgency: "now",
  level: 0,
  levelSince: K("2026-11-24T10:00:00"),
  accepted: false,
  replied: false,
  requestedAt: K("2026-11-24T10:00:00"),
  ...o,
});
const plan = (now: Date, r: OpenRequest[], t = T) => planRequestEscalations(now, r, () => t);

describe("escalation planner", () => {
  it("D4 values", () => {
    expect(clockFor("review", "now", T)).toEqual({ until: "accepted", minutes: 15 });
    expect(clockFor("review", "within_1h", T)).toEqual({ until: "accepted", minutes: 60 });
    expect(clockFor("consult", "urgent_today", T)).toEqual({ until: "accepted", minutes: 120 });
    expect(clockFor("review", "routine", T)).toEqual({ until: "replied", minutes: 1440 });
    expect(clockFor("consult", "routine", T)).toEqual({ until: "replied", minutes: 1440 });
  });

  it("no signed times, no escalation", () => {
    expect(planRequestEscalations(K("2026-11-25T10:00:00"), [req()], () => null)).toEqual([]);
  });

  it("review now escalates after 15 minutes unaccepted, not after accept", () => {
    expect(plan(K("2026-11-24T10:14:59"), [req()])).toEqual([]);
    expect(plan(K("2026-11-24T10:15:00"), [req()])).toEqual([
      { requestId: "r1", fromLevel: 0, toLevel: 1 },
    ]);
    expect(plan(K("2026-11-24T10:15:00"), [req({ accepted: true })])).toEqual([]);
  });

  it("routine waits for the reply, not the accept", () => {
    const r = req({ urgency: "routine", accepted: true });
    expect(plan(K("2026-11-25T09:59:59"), [r])).toHaveLength(0);
    expect(plan(K("2026-11-25T10:00:00"), [r])).toHaveLength(1);
    expect(dueAt({ ...r, replied: true }, T)).toBeNull();
  });

  it("level 2 is the last: it stays open and overdue", () => {
    const r = req({ level: 2 });
    expect(plan(K("2026-11-25T10:00:00"), [r])).toEqual([]);
    expect(overdue(r, T, K("2026-11-25T10:00:00"))).toBe(true);
  });

  it("planning twice at the same now is idempotent", () => {
    const now = K("2026-11-24T10:15:00");
    const s = plan(now, [req()])[0]!;
    expect(plan(now, [req({ level: s.toLevel, levelSince: now })])).toEqual([]);
  });

  it("urgent consult unreplied by the day's end is overdue", () => {
    const r = req({
      kind: "consult",
      urgency: "urgent_today",
      accepted: true,
      requestedAt: K("2026-11-24T23:00:00"),
    });
    expect(replyDueSameDay(r.requestedAt)).toEqual(K("2026-11-24T23:59:59.999"));
    expect(overdue(r, T, K("2026-11-24T23:59:59.999"))).toBe(false);
    expect(overdue(r, T, K("2026-11-25T00:00:00"))).toBe(true);
    expect(overdue({ ...r, replied: true }, T, K("2026-11-25T00:00:00"))).toBe(false);
  });
});
