import type { Assignment, Shift } from "./cover";

import { addDays, endOf, windowFor } from "./cover";

/**
 * Week templates and week state, pure. A template line names a post, the weekdays and a shift;
 * `fillWeek` turns it into drafts for one rota week. Shift windows come from the engine (windowFor),
 * never re-derived here. Nothing reads the clock.
 */

export interface TemplateLine {
  id: string;
  postId: string;
  /** 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  shift: Shift;
  userId: string | null;
}

export interface WeekEvent {
  departmentId: string;
  weekStart: string;
  kind: "publish" | "unlock";
  at: Date;
}

/** The Monday on or before a calendar day (a plain YYYY-MM-DD, no zone involved). */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/**
 * One draft per weekday per named line, skipping any window the user already holds on that post.
 * A held window is [startsAt, endOf) and only counts when non-empty (R34). A week duty fills once, on Monday.
 */
export function fillWeek(
  lines: TemplateLine[],
  weekStart: string,
  existing: Assignment[],
): { postId: string; userId: string; day: string; shift: Shift }[] {
  return lines.flatMap((l) => {
    const userId = l.userId;
    if (!userId) return [];
    const weekdays = l.shift === "week" ? [1] : [...new Set(l.weekdays)];
    return weekdays.flatMap((wd) => {
      const day = addDays(weekStart, wd - 1);
      const w = windowFor(day, l.shift);
      const taken = existing.some(
        (a) =>
          a.postId === l.postId &&
          a.userId === userId &&
          a.startsAt.getTime() < w.endsAt.getTime() &&
          endOf(a) > w.startsAt.getTime() &&
          endOf(a) > a.startsAt.getTime(),
      );
      return taken ? [] : [{ postId: l.postId, userId, day, shift: l.shift }];
    });
  });
}

/** A week is published when the latest publish/unlock event for it is a publish. */
export function weekPublished(
  events: WeekEvent[],
  departmentId: string,
  weekStart: string,
): boolean {
  const mine = events.filter((e) => e.departmentId === departmentId && e.weekStart === weekStart);
  const latest = mine.reduce<WeekEvent | null>((m, e) => (!m || e.at >= m.at ? e : m), null);
  return latest?.kind === "publish";
}
