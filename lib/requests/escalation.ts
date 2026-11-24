import type { RequestKind } from "@/lib/requests/engine";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { ago } from "@/lib/workspace/words";

/** The signed clock times (D4), in minutes. The planner only says what is due; it never accepts, answers or closes. */
export interface RequestTimes {
  reviewNowAcceptMin: number;
  review1hAcceptMin: number;
  consultUrgentAcceptMin: number;
  routineReplyMin: number;
}

export const D4_DEFAULTS: RequestTimes = {
  reviewNowAcceptMin: 15,
  review1hAcceptMin: 60,
  consultUrgentAcceptMin: 120,
  routineReplyMin: 1440,
};

export function clockFor(
  kind: RequestKind,
  urgency: string,
  t: RequestTimes,
): { until: "accepted" | "replied"; minutes: number } {
  if (kind === "review" && urgency === "now")
    return { until: "accepted", minutes: t.reviewNowAcceptMin };
  if (kind === "review" && urgency === "within_1h")
    return { until: "accepted", minutes: t.review1hAcceptMin };
  if (kind === "consult" && urgency === "urgent_today")
    return { until: "accepted", minutes: t.consultUrgentAcceptMin };
  return { until: "replied", minutes: t.routineReplyMin };
}

const KAMPALA_MS = 3 * 3_600_000; // UTC+3, no DST
const DAY_MS = 86_400_000;

/** 23:59:59.999 Kampala on the day of `requestedAt`: an overdue marker for urgent_today consults, never an escalation. */
export const replyDueSameDay = (requestedAt: Date) =>
  new Date(
    Math.floor((requestedAt.getTime() + KAMPALA_MS) / DAY_MS) * DAY_MS + DAY_MS - 1 - KAMPALA_MS,
  );

export interface OpenRequest {
  id: string;
  hospitalId: string;
  kind: RequestKind;
  urgency: string;
  level: 0 | 1 | 2;
  levelSince: Date;
  accepted: boolean;
  replied: boolean;
  requestedAt: Date;
}

/** When the current level's window ends; null with no times or once the clock's condition is met. */
export function dueAt(
  r: Pick<OpenRequest, "kind" | "urgency" | "levelSince" | "accepted" | "replied">,
  t: RequestTimes | null,
): Date | null {
  if (!t) return null;
  const c = clockFor(r.kind, r.urgency, t);
  if (c.until === "accepted" ? r.accepted || r.replied : r.replied) return null;
  return new Date(r.levelSince.getTime() + c.minutes * 60_000);
}

export function planRequestEscalations(
  now: Date,
  open: readonly OpenRequest[],
  timesFor: (hospitalId: string) => RequestTimes | null,
): { requestId: string; fromLevel: 0 | 1; toLevel: 1 | 2 }[] {
  return open.flatMap((r) => {
    if (r.level === 2) return [];
    const due = dueAt(r, timesFor(r.hospitalId));
    return due && due <= now
      ? [{ requestId: r.id, fromLevel: r.level, toLevel: (r.level + 1) as 1 | 2 }]
      : [];
  });
}

export function overdue(r: OpenRequest, t: RequestTimes | null, now: Date): boolean {
  const due = dueAt(r, t);
  if (due && due <= now) return true;
  return (
    r.kind === "consult" &&
    r.urgency === "urgent_today" &&
    !r.replied &&
    now > replyDueSameDay(r.requestedAt)
  );
}

const kampalaTime = (d: Date) =>
  d.toLocaleTimeString("en-GB", {
    timeZone: "Africa/Kampala",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/**
 * The due words on a request (R41: from the live signed times, never the stored due_at). With nothing
 * signed there is no due time, so the words are elapsed ones (ADR 0244 §1). `due` is `dueAt()`'s; `overdue`
 * is `overdue()`'s, which also covers the urgent consult's day end (no due time, just "Overdue").
 */
export function dueWords(a: {
  signed: boolean;
  due: Date | null;
  overdue: boolean;
  askedAt: Date;
  now: Date;
}): string | null {
  const P = CARE_REQUEST_COPY.page;
  if (!a.signed) return P.asked(ago(a.now.getTime() - a.askedAt.getTime()));
  if (a.due && a.due > a.now) return P.dueBy(kampalaTime(a.due));
  if (a.due && a.overdue) return P.overdueBy(ago(a.now.getTime() - a.due.getTime()));
  return a.overdue ? P.overdue : null;
}
