/**
 * The duty rota engine (spec §3.1), pure: shift windows, who is in post, duty state and gaps.
 * The rota is what was planned, never proof of presence. Times are real instants; shift days are
 * Africa/Kampala wall-clock days (UTC+03:00, no daylight saving), never the machine's zone.
 * Nothing here reads the clock: `at` and `now` are passed in.
 */

export const POST_LEVELS = ["junior", "senior", "consultant", "nurse_in_charge", "allied"] as const;
export const SHIFTS = ["day", "night", "day24", "week"] as const;
export type PostLevel = (typeof POST_LEVELS)[number];
export type Shift = (typeof SHIFTS)[number];

const HOUR = 3_600_000;
/** Each shift starts at a Kampala hour on the named day and lasts a fixed number of hours (no DST, so no 23/25-hour days). */
const SHIFT_HOURS: Record<Shift, { start: number; hours: number }> = {
  day: { start: 8, hours: 9 },
  night: { start: 17, hours: 15 },
  day24: { start: 8, hours: 24 },
  week: { start: 8, hours: 7 * 24 },
};

export function windowFor(day: string, shift: Shift): { startsAt: Date; endsAt: Date } {
  const { start, hours } = SHIFT_HOURS[shift];
  const startsAt = new Date(`${day}T${String(start).padStart(2, "0")}:00:00+03:00`);
  // Round-trip on the Kampala day: refuses junk, and dates like 2026-02-30 that JS rolls into March.
  const kampalaDay = Number.isNaN(startsAt.getTime())
    ? ""
    : new Date(startsAt.getTime() + 3 * HOUR).toISOString().slice(0, 10);
  if (kampalaDay !== day) throw new RangeError(`Not a day: ${day}`);
  return { startsAt, endsAt: new Date(startsAt.getTime() + hours * HOUR) };
}

export interface Post {
  id: string;
  departmentId: string;
  wardId: string | null;
  name: string;
  level: PostLevel;
  eligibleCadres: string[];
  takesConsults: boolean;
  escalatesToPostId: string | null;
  capacity: number;
  archived: boolean;
}

export interface Assignment {
  id: string;
  postId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  kind: "rostered" | "cover" | "swap";
  coversAssignmentId: string | null;
  endedAt: Date | null;
}

export interface Leave {
  userId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CoverWorld {
  posts: Post[];
  assignments: Assignment[];
  leave: Leave[];
  heads: { departmentId: string; userId: string; acting: boolean }[];
  hospitalContacts: string[];
}

/** The instant the duty really stops: its planned end, or an earlier end. */
const endOf = (a: Assignment): number =>
  Math.min(a.endsAt.getTime(), a.endedAt?.getTime() ?? Infinity);
const onLeave = (userId: string, leave: Leave[], t: number) =>
  leave.some((l) => l.userId === userId && l.startsAt.getTime() <= t && t < l.endsAt.getTime());

export function inPost(a: Assignment, leave: Leave[], at: Date): boolean {
  const t = at.getTime();
  return a.startsAt.getTime() <= t && t < endOf(a) && !onLeave(a.userId, leave, t);
}

export type CoverStep =
  | "ward_post"
  | "department_post"
  | "department_head"
  | "hospital_contacts"
  | "none";
export interface CoverPerson {
  userId: string;
  postId: string | null;
  postName: string | null;
  until: Date | null;
}

/**
 * Who covers a ward or department at `at`, walking the fixed order of spec §3.1 and naming the step used:
 * the ward's posts, the department's consult posts, the heads (substantive first), the hospital contacts.
 * `levels` narrows both post steps, so a review that wants a senior never lands on a junior post.
 */
export function whoCovers(
  w: CoverWorld,
  q: { departmentId: string; wardId?: string | null; levels?: PostLevel[]; at: Date },
): { step: CoverStep; people: CoverPerson[] } {
  const t = q.at.getTime();
  const holders = (posts: Post[]): CoverPerson[] =>
    posts.flatMap((p) =>
      w.assignments
        .filter((a) => a.postId === p.id && inPost(a, w.leave, q.at))
        .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())
        .map((a) => {
          // Until the duty ends or the holder's next leave begins, whichever is sooner.
          const leaveStarts = w.leave
            .filter((l) => l.userId === a.userId && l.startsAt.getTime() > t)
            .map((l) => l.startsAt.getTime());
          return {
            userId: a.userId,
            postId: p.id,
            postName: p.name,
            until: new Date(Math.min(endOf(a), ...leaveStarts)),
          };
        }),
    );
  const live = w.posts.filter((p) => !p.archived && (!q.levels || q.levels.includes(p.level)));

  const ward = q.wardId ? holders(live.filter((p) => p.wardId === q.wardId)) : [];
  if (ward.length) return { step: "ward_post", people: ward };

  const dept = holders(live.filter((p) => p.departmentId === q.departmentId && p.takesConsults));
  if (dept.length) return { step: "department_post", people: dept };

  const heads = w.heads
    .filter((h) => h.departmentId === q.departmentId)
    .sort((x, y) => Number(x.acting) - Number(y.acting))
    .map((h) => ({ userId: h.userId, postId: null, postName: null, until: null }));
  if (heads.length) return { step: "department_head", people: heads };

  if (w.hospitalContacts.length)
    return {
      step: "hospital_contacts",
      people: w.hospitalContacts.map((userId) => ({
        userId,
        postId: null,
        postName: null,
        until: null,
      })),
    };

  return { step: "none", people: [] };
}

export type DutyState = "planned" | "in_post" | "past" | "ended_early" | "needs_cover";

/** Derived, never stored. Leave over a duty that has not passed marks it "needs cover"; it never removes it. */
export function dutyState(a: Assignment, leave: Leave[], now: Date): DutyState {
  const t = now.getTime();
  const end = endOf(a);
  if (t >= end)
    return a.endedAt && a.endedAt.getTime() < a.endsAt.getTime() ? "ended_early" : "past";
  const start = a.startsAt.getTime();
  if (
    leave.some(
      (l) => l.userId === a.userId && l.startsAt.getTime() < end && l.endsAt.getTime() > start,
    )
  )
    return "needs_cover";
  return t >= start ? "in_post" : "planned";
}

type Span = [number, number];

/** Maximal stretches of [from, to) in which a non-archived post has no holder who is in post and off leave. */
export function gaps(
  posts: Post[],
  assignments: Assignment[],
  leave: Leave[],
  from: Date,
  to: Date,
): { postId: string; from: Date; to: Date }[] {
  const lo = from.getTime();
  const hi = to.getTime();
  return posts
    .filter((p) => !p.archived)
    .flatMap((p) => {
      const covered = assignments
        .filter((a) => a.postId === p.id)
        .flatMap((a) =>
          leave
            .filter((l) => l.userId === a.userId)
            .reduce<Span[]>(
              (spans, l) =>
                spans.flatMap(([s, e]): Span[] => {
                  const ls = l.startsAt.getTime();
                  const le = l.endsAt.getTime();
                  if (le <= s || ls >= e) return [[s, e]];
                  return [
                    ...(ls > s ? [[s, ls] as Span] : []),
                    ...(le < e ? [[le, e] as Span] : []),
                  ];
                }),
              [[a.startsAt.getTime(), endOf(a)]],
            ),
        )
        .sort((x, y) => x[0] - y[0]);

      const out: { postId: string; from: Date; to: Date }[] = [];
      let cursor = lo;
      for (const [s, e] of covered) {
        if (e <= cursor) continue;
        if (s >= hi) break;
        if (s > cursor) out.push({ postId: p.id, from: new Date(cursor), to: new Date(s) });
        cursor = e;
      }
      if (cursor < hi) out.push({ postId: p.id, from: new Date(cursor), to: new Date(hi) });
      return out;
    });
}
