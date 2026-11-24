import "server-only";

import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type {
  Assignment,
  CoverStep,
  CoverWorld,
  DutyState,
  Leave,
  Post,
  PostLevel,
} from "@/lib/rota/cover";
import type { TemplateLine } from "@/lib/rota/templates";
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import {
  dutyAssignments,
  dutyPosts,
  dutyRotaDelegates,
  dutyRotaTemplates,
  dutyRotaWeekEvents,
  dutySwapRequestEvents,
  dutySwapRequests,
} from "@/db/schema/duty-rota";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { criticalContacts } from "@/db/schema/lab-safety";
import { cadres } from "@/db/schema/reference-data";
import { availabilityBlocks } from "@/db/schema/scheduling";
import { departmentHeads } from "@/db/schema/services-hub";
import { users } from "@/db/schema/users";
import { dutyState, endOf, gaps, whoCovers } from "@/lib/rota/cover";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { weekPublished } from "@/lib/rota/templates";

/**
 * Rota reads (ADR 0534). One snapshot on the server connection, every query scoped to the hospital; state, gaps
 * and cover come from lib/rota/cover.ts, never re-derived here. ADR 0199: staff names and places only, never a
 * patient. Leave is read as times only: no notes, no label, never the reason. Flag off, every read is empty.
 */

type Opts = { database?: EmrDb; now?: Date };
const HOUR = 3_600_000;

async function inSnapshot<T>(database: EmrDb | undefined, fn: (tx: EmrTx) => Promise<T>) {
  const conn = database ?? ((await import("@/db")).db as unknown as EmrDb);
  return conn.transaction(fn, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Active leave of these people overlapping [from, to): the times, nothing else of the block. */
async function leaveOf(
  tx: EmrTx,
  hospitalId: string,
  userIds: string[],
  from: Date,
  to: Date,
): Promise<Leave[]> {
  if (!userIds.length) return [];
  return tx
    .select({
      userId: availabilityBlocks.clinicianUserId,
      startsAt: availabilityBlocks.startsAt,
      endsAt: availabilityBlocks.endsAt,
    })
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.hospitalId, hospitalId),
        inArray(availabilityBlocks.clinicianUserId, [...new Set(userIds)]),
        eq(availabilityBlocks.kind, "leave"),
        eq(availabilityBlocks.state, "active"),
        lt(availabilityBlocks.startsAt, to),
        gt(availabilityBlocks.endsAt, from),
      ),
    );
}

async function namesOf(tx: EmrTx, userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const rows = await tx
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}
const nameIn = (m: Map<string, string>, id: string) => m.get(id) ?? DUTY_ROTA_COPY.unnamed;

const toAssignment = (a: typeof dutyAssignments.$inferSelect): Assignment => ({
  id: a.id,
  postId: a.postId,
  userId: a.userId,
  startsAt: a.startsAt,
  endsAt: a.endsAt,
  kind: a.kind as Assignment["kind"],
  coversAssignmentId: a.coversAssignmentId,
  endedAt: a.endedAt,
});

/**
 * The cover world for some departments over [from, to): their posts, the assignments overlapping the range,
 * the holders' leave in it, the heads in office at `from`, and the hospital contacts (critical_contacts level 2).
 */
export async function loadCoverWorld(
  tx: EmrTx,
  hospitalId: string,
  q: { departmentIds: string[]; from: Date; to: Date },
): Promise<CoverWorld> {
  const depts = q.departmentIds;
  const postRows = depts.length
    ? await tx
        .select()
        .from(dutyPosts)
        .where(and(eq(dutyPosts.hospitalId, hospitalId), inArray(dutyPosts.departmentId, depts)))
    : [];
  const posts: Post[] = postRows.map((p) => ({
    id: p.id,
    departmentId: p.departmentId,
    wardId: p.wardId,
    name: p.name,
    level: p.level as PostLevel,
    eligibleCadres: p.eligibleCadres,
    takesConsults: p.takesConsults,
    escalatesToPostId: p.escalatesToPostId,
    capacity: p.capacity,
    archived: p.archivedAt !== null,
  }));
  const assignments = posts.length
    ? (
        await tx
          .select()
          .from(dutyAssignments)
          .where(
            and(
              eq(dutyAssignments.hospitalId, hospitalId),
              inArray(
                dutyAssignments.postId,
                posts.map((p) => p.id),
              ),
              lt(dutyAssignments.startsAt, q.to),
              gt(dutyAssignments.endsAt, q.from),
            ),
          )
          .orderBy(asc(dutyAssignments.startsAt))
      ).map(toAssignment)
    : [];
  // Up to the last loaded duty's end: dutyState looks for leave over the whole rest of a duty, past the range.
  const leave = await leaveOf(
    tx,
    hospitalId,
    assignments.map((a) => a.userId),
    q.from,
    new Date(Math.max(q.to.getTime(), ...assignments.map((a) => a.endsAt.getTime()))),
  );
  const heads = depts.length
    ? await tx
        .select({
          departmentId: departmentHeads.departmentId,
          userId: departmentHeads.userId,
          acting: departmentHeads.acting,
        })
        .from(departmentHeads)
        .where(
          and(
            eq(departmentHeads.hospitalId, hospitalId),
            inArray(departmentHeads.departmentId, depts),
            lte(departmentHeads.startsAt, q.from),
            or(isNull(departmentHeads.endsAt), gt(departmentHeads.endsAt, q.from)),
          ),
        )
        .orderBy(asc(departmentHeads.acting), asc(departmentHeads.startsAt))
    : [];
  const contacts = await tx
    .select({ userId: criticalContacts.userId })
    .from(criticalContacts)
    .where(and(eq(criticalContacts.hospitalId, hospitalId), eq(criticalContacts.level, 2)))
    .orderBy(asc(criticalContacts.position));
  return { posts, assignments, leave, heads, hospitalContacts: contacts.map((c) => c.userId) };
}

const WeekQ = z.object({ hospitalId: z.uuid(), departmentId: z.uuid(), weekStart: z.iso.date() });

export interface SwapLine {
  id: string;
  kind: "cover" | "swap";
  postName: string;
  askedByName: string;
  colleagueName: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Requests with no final event (declined, approved, refused, withdrawn). `accepted: true` keeps those the colleague
 * accepted (a maker decides them); `false` keeps those not yet answered (the colleague's "asked of you").
 * Staff names and posts only (ADR 0199).
 */
async function openSwaps(
  tx: EmrTx,
  hospitalId: string,
  q: { departmentId?: string; colleagueUserId?: string; accepted: boolean },
) {
  const rows = await tx
    .select({
      id: dutySwapRequests.id,
      kind: dutySwapRequests.kind,
      askedBy: dutySwapRequests.askedBy,
      colleagueUserId: dutySwapRequests.colleagueUserId,
      postName: dutyPosts.name,
      startsAt: dutyAssignments.startsAt,
      endsAt: dutyAssignments.endsAt,
    })
    .from(dutySwapRequests)
    .innerJoin(dutyAssignments, eq(dutyAssignments.id, dutySwapRequests.assignmentId))
    .innerJoin(dutyPosts, eq(dutyPosts.id, dutyAssignments.postId))
    .where(
      and(
        eq(dutySwapRequests.hospitalId, hospitalId),
        q.departmentId ? eq(dutyPosts.departmentId, q.departmentId) : undefined,
        q.colleagueUserId ? eq(dutySwapRequests.colleagueUserId, q.colleagueUserId) : undefined,
      ),
    )
    .orderBy(asc(dutyAssignments.startsAt));
  if (!rows.length) return [];
  const events = await tx
    .select({ requestId: dutySwapRequestEvents.requestId, kind: dutySwapRequestEvents.kind })
    .from(dutySwapRequestEvents)
    .where(
      inArray(
        dutySwapRequestEvents.requestId,
        rows.map((r) => r.id),
      ),
    );
  const kinds = (id: string) => events.filter((e) => e.requestId === id).map((e) => e.kind);
  return rows.filter((r) => {
    const k = kinds(r.id);
    if (k.some((x) => x !== "accepted")) return false;
    return k.includes("accepted") === q.accepted;
  });
}

const swapLine = (
  r: Awaited<ReturnType<typeof openSwaps>>[number],
  names: Map<string, string>,
): SwapLine => ({
  id: r.id,
  kind: r.kind as SwapLine["kind"],
  postName: r.postName,
  askedByName: nameIn(names, r.askedBy),
  colleagueName: nameIn(names, r.colleagueUserId),
  startsAt: r.startsAt,
  endsAt: r.endsAt,
});

/** Requests asked of this person that they have not answered yet. */
export async function swapsAskedOfMe(
  userId: string,
  hospitalId: string,
  opts?: Opts,
): Promise<SwapLine[]> {
  if (!dutyRotaLiveFor(hospitalId) || !z.uuid().safeParse(userId).success) return [];
  return inSnapshot(opts?.database, async (tx) => {
    const rows = await openSwaps(tx, hospitalId, { colleagueUserId: userId, accepted: false });
    const names = await namesOf(
      tx,
      rows.flatMap((r) => [r.askedBy, r.colleagueUserId]),
    );
    return rows.map((r) => swapLine(r, names));
  });
}

/** One department's week (from 00:00 Kampala on `weekStart`, seven days), with gaps over it and the next 72 h. */
export async function loadRotaWeek(
  hospitalId: string,
  departmentId: string,
  weekStart: string,
  opts?: Opts,
): Promise<{
  posts: Post[];
  assignments: (Assignment & { name: string; state: DutyState })[];
  gaps: ReturnType<typeof gaps>;
  /** departmentName is null for the department's own staff, who come first (R36). */
  eligible: { userId: string; name: string; cadre: string; departmentName: string | null }[];
  /** Duties needing cover over the same range as the gaps: the week and the next 72 h. */
  needsCover: (Assignment & { name: string })[];
  /** Whether this department week is published (its latest week event is a publish). */
  published: boolean;
  /** The department's live template lines, for every week. */
  templates: TemplateLine[];
  /** Accepted by the colleague, awaiting a rota maker. Staff names and posts only. */
  swapsToDecide: SwapLine[];
  /** Active hand-overs of this department's rota. */
  delegates: {
    id: string;
    toUserId: string;
    name: string;
    canPublish: boolean;
    until: string | null;
  }[];
}> {
  if (
    !dutyRotaLiveFor(hospitalId) ||
    !WeekQ.safeParse({ hospitalId, departmentId, weekStart }).success
  )
    return {
      posts: [],
      assignments: [],
      gaps: [],
      eligible: [],
      needsCover: [],
      published: false,
      templates: [],
      swapsToDecide: [],
      delegates: [],
    };
  const now = opts?.now ?? new Date();
  const from = new Date(`${weekStart}T00:00:00+03:00`);
  const to = new Date(from.getTime() + 7 * 24 * HOUR);
  const soon = new Date(now.getTime() + 72 * HOUR);

  return inSnapshot(opts?.database, async (tx) => {
    const lo = new Date(Math.min(from.getTime(), now.getTime()));
    const hi = new Date(Math.max(to.getTime(), soon.getTime()));
    const w = await loadCoverWorld(tx, hospitalId, {
      departmentIds: [departmentId],
      from: lo,
      to: hi,
    });
    const shown = w.assignments.filter((a) => a.startsAt < to && a.endsAt > from);
    const needs = w.assignments.filter(
      (a) =>
        ((a.startsAt < to && a.endsAt > from) || (a.startsAt < soon && a.endsAt > now)) &&
        dutyState(a, w.leave, now) === "needs_cover",
    );
    const names = await namesOf(
      tx,
      [...shown, ...needs].map((a) => a.userId),
    );
    // One sweep when the week and the next 72 h touch, so a gap across their seam is not split in two.
    const holes =
      from < soon && now < to
        ? gaps(w.posts, w.assignments, w.leave, lo, hi)
        : [
            ...gaps(w.posts, w.assignments, w.leave, now, soon),
            ...gaps(w.posts, w.assignments, w.leave, from, to),
          ];

    const codes = [...new Set(w.posts.filter((p) => !p.archived).flatMap((p) => p.eligibleCadres))];
    // R36: everyone live at the hospital whose cadre a post accepts, as the guard; own department first.
    const own = sql<boolean>`${staffAffiliations.departmentId} = ${departmentId}::uuid`;
    const staff = codes.length
      ? await tx
          .select({
            userId: staffAffiliations.userId,
            name: users.fullName,
            cadre: cadres.code,
            own,
            departmentName: hospitalDepartments.name,
          })
          .from(staffAffiliations)
          .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
          .innerJoin(
            hospitalDepartments,
            eq(hospitalDepartments.id, staffAffiliations.departmentId),
          )
          .leftJoin(users, eq(users.id, staffAffiliations.userId))
          .where(
            and(
              eq(staffAffiliations.hospitalId, hospitalId),
              inArray(staffAffiliations.state, ["active", "approved"]),
              inArray(cadres.code, codes),
            ),
          )
          .orderBy(desc(own), asc(users.fullName))
      : [];
    // First row per person wins: their own-department affiliation when they have one.
    const eligible = new Map<
      string,
      { userId: string; name: string; cadre: string; departmentName: string | null }
    >();
    for (const s of staff)
      if (!eligible.has(s.userId))
        eligible.set(s.userId, {
          userId: s.userId,
          name: s.name ?? DUTY_ROTA_COPY.unnamed,
          cadre: s.cadre,
          departmentName: s.own ? null : s.departmentName,
        });

    const events = await tx
      .select({ kind: dutyRotaWeekEvents.kind, at: dutyRotaWeekEvents.at })
      .from(dutyRotaWeekEvents)
      .where(
        and(
          eq(dutyRotaWeekEvents.hospitalId, hospitalId),
          eq(dutyRotaWeekEvents.departmentId, departmentId),
          eq(dutyRotaWeekEvents.weekStart, weekStart),
        ),
      );
    const templates = (
      await tx
        .select()
        .from(dutyRotaTemplates)
        .where(
          and(
            eq(dutyRotaTemplates.hospitalId, hospitalId),
            eq(dutyRotaTemplates.departmentId, departmentId),
            isNull(dutyRotaTemplates.endedAt),
          ),
        )
        .orderBy(asc(dutyRotaTemplates.createdAt))
    ).map((t) => ({
      id: t.id,
      postId: t.postId,
      weekdays: t.weekdays,
      shift: t.shift as TemplateLine["shift"],
      userId: t.userId,
    }));
    const delegateRows = await tx
      .select()
      .from(dutyRotaDelegates)
      .where(
        and(
          eq(dutyRotaDelegates.hospitalId, hospitalId),
          eq(dutyRotaDelegates.departmentId, departmentId),
          isNull(dutyRotaDelegates.revokedAt),
        ),
      )
      .orderBy(asc(dutyRotaDelegates.createdAt));
    const toDecide = await openSwaps(tx, hospitalId, { departmentId, accepted: true });
    const people = await namesOf(tx, [
      ...delegateRows.map((d) => d.toUser),
      ...toDecide.flatMap((r) => [r.askedBy, r.colleagueUserId]),
    ]);

    return {
      published: weekPublished(
        events.map((e) => ({
          departmentId,
          weekStart,
          kind: e.kind as "publish" | "unlock",
          at: e.at,
        })),
        departmentId,
        weekStart,
      ),
      templates,
      swapsToDecide: toDecide.map((r) => swapLine(r, people)),
      delegates: delegateRows.map((d) => ({
        id: d.id,
        toUserId: d.toUser,
        name: nameIn(people, d.toUser),
        canPublish: d.canPublish,
        until: d.until,
      })),
      posts: w.posts,
      assignments: shown.map((a) => ({
        ...a,
        name: nameIn(names, a.userId),
        state: dutyState(a, w.leave, now),
      })),
      gaps: holes,
      eligible: [...eligible.values()],
      needsCover: needs.map((a) => ({ ...a, name: nameIn(names, a.userId) })),
    };
  });
}

const kampalaMidnight = (now: Date) =>
  new Date(`${new Date(now.getTime() + 3 * HOUR).toISOString().slice(0, 10)}T00:00:00+03:00`);

/** The duty chip: the person's duties held today (Kampala) and over the next 24 h. */
export async function myDuties(
  userId: string,
  hospitalId: string,
  now: Date,
  opts?: Opts,
): Promise<{ postName: string; until: Date; state: DutyState }[]> {
  if (!dutyRotaLiveFor(hospitalId) || !z.uuid().safeParse(userId).success) return [];
  const from = kampalaMidnight(now);
  const to = new Date(now.getTime() + 24 * HOUR);
  return inSnapshot(opts?.database, async (tx) => {
    const rows = await tx
      .select({ a: dutyAssignments, postName: dutyPosts.name })
      .from(dutyAssignments)
      .innerJoin(dutyPosts, eq(dutyPosts.id, dutyAssignments.postId))
      .where(
        and(
          eq(dutyAssignments.hospitalId, hospitalId),
          eq(dutyAssignments.userId, userId),
          lt(dutyAssignments.startsAt, to),
          gt(dutyAssignments.endsAt, from),
        ),
      )
      .orderBy(asc(dutyAssignments.startsAt));
    // R34: the held window is [startsAt, endOf); empty (cancelled before it started) holds nothing.
    const held = rows
      .map((r) => ({ a: toAssignment(r.a), postName: r.postName }))
      .filter(({ a }) => endOf(a) > Math.max(a.startsAt.getTime(), from.getTime()));
    if (!held.length) return [];
    const leave = await leaveOf(
      tx,
      hospitalId,
      [userId],
      from,
      new Date(Math.max(...held.map(({ a }) => a.endsAt.getTime()))),
    );
    return held.map(({ a, postName }) => ({
      postName,
      until: new Date(endOf(a)),
      state: dutyState(a, leave, now),
    }));
  });
}

export interface SwapOption {
  id: string;
  postName: string;
  startsAt: Date;
  endsAt: Date;
  state: DutyState;
  /** Live staff whose grade the post takes (not the asker): who can be asked. */
  colleagues: { userId: string; name: string }[];
  /** Their live duties on the same post, for a swap. */
  theirDuties: { id: string; userId: string; startsAt: Date; endsAt: Date }[];
}

/**
 * This person's live duties over the next 14 days, each with who they may ask and the duties a swap could take.
 * Staff names and posts only (ADR 0199). The guard checks the holder, the post and the pair again.
 */
export async function swapOptions(
  userId: string,
  hospitalId: string,
  now: Date,
  opts?: Opts,
): Promise<SwapOption[]> {
  if (!dutyRotaLiveFor(hospitalId) || !z.uuid().safeParse(userId).success) return [];
  const to = new Date(now.getTime() + 14 * 24 * HOUR);
  return inSnapshot(opts?.database, async (tx) => {
    const rows = await tx
      .select({ a: dutyAssignments, post: dutyPosts })
      .from(dutyAssignments)
      .innerJoin(dutyPosts, eq(dutyPosts.id, dutyAssignments.postId))
      .where(
        and(
          eq(dutyAssignments.hospitalId, hospitalId),
          eq(dutyAssignments.userId, userId),
          isNull(dutyAssignments.endedAt),
          lt(dutyAssignments.startsAt, to),
          gt(dutyAssignments.endsAt, now),
        ),
      )
      .orderBy(asc(dutyAssignments.startsAt));
    const mine = rows
      .map((r) => ({ a: toAssignment(r.a), post: r.post }))
      .filter(({ a }) => endOf(a) > now.getTime());
    if (!mine.length) return [];
    const postIds = [...new Set(mine.map(({ post }) => post.id))];
    const codes = [...new Set(mine.flatMap(({ post }) => post.eligibleCadres))];
    const staff = codes.length
      ? await tx
          .selectDistinct({
            userId: staffAffiliations.userId,
            name: users.fullName,
            cadre: cadres.code,
          })
          .from(staffAffiliations)
          .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
          .leftJoin(users, eq(users.id, staffAffiliations.userId))
          .where(
            and(
              eq(staffAffiliations.hospitalId, hospitalId),
              inArray(staffAffiliations.state, ["active", "approved"]),
              inArray(cadres.code, codes),
            ),
          )
          .orderBy(asc(users.fullName))
      : [];
    const theirs = (
      await tx
        .select()
        .from(dutyAssignments)
        .where(
          and(
            eq(dutyAssignments.hospitalId, hospitalId),
            inArray(dutyAssignments.postId, postIds),
            isNull(dutyAssignments.endedAt),
            lt(dutyAssignments.startsAt, to),
            gt(dutyAssignments.endsAt, now),
          ),
        )
        .orderBy(asc(dutyAssignments.startsAt))
    )
      .map(toAssignment)
      .filter((a) => a.userId !== userId && endOf(a) > now.getTime());
    const leave = await leaveOf(
      tx,
      hospitalId,
      [userId],
      now,
      new Date(Math.max(...mine.map(({ a }) => a.endsAt.getTime()))),
    );
    return mine.map(({ a, post }) => {
      const colleagues = new Map<string, string>();
      for (const s of staff)
        if (s.userId !== userId && post.eligibleCadres.includes(s.cadre))
          colleagues.set(s.userId, s.name ?? DUTY_ROTA_COPY.unnamed);
      return {
        id: a.id,
        postName: post.name,
        startsAt: a.startsAt,
        endsAt: new Date(endOf(a)),
        state: dutyState(a, leave, now),
        colleagues: [...colleagues].map(([id, name]) => ({ userId: id, name })),
        theirDuties: theirs
          .filter((t) => t.postId === post.id)
          .map((t) => ({
            id: t.id,
            userId: t.userId,
            startsAt: t.startsAt,
            endsAt: new Date(endOf(t)),
          })),
      };
    });
  });
}

/** Who covers a ward now, by whoCovers's fixed order: staff names and post names only. */
export async function coverForWard(
  hospitalId: string,
  wardId: string,
  now: Date,
  opts?: Opts,
): Promise<{
  step: CoverStep;
  people: { name: string; postName: string | null; until: string | null }[];
}> {
  const none = { step: "none" as const, people: [] };
  if (!dutyRotaLiveFor(hospitalId) || !z.uuid().safeParse(wardId).success) return none;
  return inSnapshot(opts?.database, async (tx) => {
    const [ward] = await tx
      .select({ departmentId: hospitalWards.departmentId })
      .from(hospitalWards)
      .where(and(eq(hospitalWards.id, wardId), eq(hospitalWards.hospitalId, hospitalId)));
    if (!ward) return none;
    const postDepts = await tx
      .selectDistinct({ departmentId: dutyPosts.departmentId })
      .from(dutyPosts)
      .where(and(eq(dutyPosts.hospitalId, hospitalId), eq(dutyPosts.wardId, wardId)));
    const departmentIds = [
      ...new Set([ward.departmentId, ...postDepts.map((p) => p.departmentId)]),
    ].filter((d): d is string => d !== null);
    // A duty lasts at most a week (the "week" shift), so a holder's next leave before it ends falls in range.
    const w = await loadCoverWorld(tx, hospitalId, {
      departmentIds,
      from: now,
      to: new Date(now.getTime() + 7 * 24 * HOUR),
    });
    const cover = whoCovers(w, { departmentId: ward.departmentId ?? "", wardId, at: now });
    const names = await namesOf(
      tx,
      cover.people.map((p) => p.userId),
    );
    return {
      step: cover.step,
      people: cover.people.map((p) => ({
        name: nameIn(names, p.userId),
        postName: p.postName,
        until: p.until?.toISOString() ?? null,
      })),
    };
  });
}

/** What the rota editor offers: the department's wards (and any ward its posts sit on), and the clinical grades. */
export async function rotaChoices(
  hospitalId: string,
  departmentId: string,
  opts?: Opts,
): Promise<{ wards: { id: string; name: string }[]; cadres: { code: string; name: string }[] }> {
  if (!dutyRotaLiveFor(hospitalId) || !z.uuid().safeParse(departmentId).success)
    return { wards: [], cadres: [] };
  return inSnapshot(opts?.database, async (tx) => {
    const postWards = tx
      .select({ id: dutyPosts.wardId })
      .from(dutyPosts)
      .where(and(eq(dutyPosts.hospitalId, hospitalId), eq(dutyPosts.departmentId, departmentId)));
    const wards = await tx
      .select({ id: hospitalWards.id, name: hospitalWards.name })
      .from(hospitalWards)
      .where(
        and(
          eq(hospitalWards.hospitalId, hospitalId),
          or(
            and(eq(hospitalWards.departmentId, departmentId), isNull(hospitalWards.archivedAt)),
            inArray(hospitalWards.id, postWards),
          ),
        ),
      )
      .orderBy(asc(hospitalWards.name));
    const grades = await tx
      .select({ code: cadres.code, name: cadres.name })
      .from(cadres)
      .where(eq(cadres.isClinical, true))
      .orderBy(asc(cadres.sortOrder));
    return { wards, cadres: grades };
  });
}
