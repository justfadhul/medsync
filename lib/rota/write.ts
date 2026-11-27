import "server-only";

import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type { ActionResult } from "@/lib/emr/write/context";
import { and, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
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
import { asClinicalWriter } from "@/lib/emr/db";
import { actionError, EmrWriteError } from "@/lib/emr/write/context";
import { addDays, POST_LEVELS, SHIFTS, windowFor } from "@/lib/rota/cover";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { fillWeek, mondayOf } from "@/lib/rota/templates";

/**
 * Rota writes (ADR 0534), the pharmacy roster's shape (lib/pharmacy/write.ts runPharmacyWrite): Zod, then one
 * transaction as the actor (identity set for the audit triggers), then the write under the 0307 guard. The guard
 * owns the rules (rota maker, grade, leave, double booking, capacity, covers); its HINT refusals come back in
 * content/duty-rota.ts words, never as a Postgres error. The actor's hospital scopes every row touched.
 * Pure of Next.js: the action files resolve the actor from the session and pass it in.
 */

export interface RotaActor {
  userId: string;
  hospitalId: string;
}
export interface RotaCtx {
  tx: EmrTx;
  actor: RotaActor;
  now: Date;
}
type Opts = { database?: EmrDb; now?: Date };
type Hint = keyof typeof DUTY_ROTA_COPY.refusal;

/** The guard's HINT (check_violation, `rota_*`), wherever drizzle wrapped the Postgres error. */
function rotaHint(e: unknown): Hint | null {
  if (!e || typeof e !== "object") return null;
  const { code, hint, cause, constraint, constraint_name } = e as {
    code?: unknown;
    hint?: unknown;
    cause?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
  };
  // The unique index behind the delegate guard's own check, if two hand-overs race.
  if (code === "23505" && (constraint ?? constraint_name) === "duty_rota_delegates_one")
    return "rota_delegate_dup";
  if (code === "23514" && typeof hint === "string" && Object.hasOwn(DUTY_ROTA_COPY.refusal, hint))
    return hint as Hint;
  return rotaHint(cause);
}

export async function runRotaWrite<I, R extends { id: string }>(
  actor: RotaActor,
  schema: z.ZodType<I>,
  raw: unknown,
  fn: (ctx: RotaCtx, input: I) => Promise<R>,
  opts?: Opts,
): Promise<ActionResult<R>> {
  if (!dutyRotaLiveFor(actor.hospitalId))
    return { ok: false, code: "config", error: DUTY_ROTA_COPY.off };
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      code: "invalid",
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  try {
    const data = await asClinicalWriter(
      actor,
      (tx) => fn({ tx, actor, now: opts?.now ?? new Date() }, parsed.data),
      opts?.database,
    );
    return { ok: true, id: data.id, serverTime: new Date().toISOString(), data };
  } catch (e) {
    const hint = rotaHint(e);
    if (hint) return { ok: false, code: "forbidden", error: DUTY_ROTA_COPY.refusal[hint] };
    return actionError(e);
  }
}

const notFound = () => new EmrWriteError("not_found", DUTY_ROTA_COPY.notFound);

/** Posts have no insert guard in 0307: the maker rule is asked of the same SQL function here. */
async function mustMakeRota(ctx: RotaCtx, departmentId: string) {
  const res = (await ctx.tx.execute(
    sql`SELECT private.duty_rota_maker(${ctx.actor.hospitalId}::uuid, ${ctx.actor.userId}::uuid, ${departmentId}::uuid) AS ok`,
  )) as unknown as { ok: boolean }[] | { rows: { ok: boolean }[] };
  const rows = Array.isArray(res) ? res : res.rows;
  if (rows[0]?.ok !== true) throw new EmrWriteError("forbidden", DUTY_ROTA_COPY.refusal.rota_maker);
}

/**
 * A live post of the actor's hospital, or not found. Share-locked until commit (R37), so it cannot be archived
 * under a write in flight; archivePost reads it unlocked and relies on its guarded UPDATE instead, since two
 * archivers each holding a share lock would deadlock on their updates.
 */
async function livePost(ctx: RotaCtx, postId: string, lock = true) {
  const q = ctx.tx
    .select({ id: dutyPosts.id, departmentId: dutyPosts.departmentId })
    .from(dutyPosts)
    .where(
      and(
        eq(dutyPosts.id, postId),
        eq(dutyPosts.hospitalId, ctx.actor.hospitalId),
        isNull(dutyPosts.archivedAt),
      ),
    );
  const [p] = lock ? await q.for("share") : await q;
  if (!p) throw notFound();
  return p;
}

// ─── Posts ─────────────────────────────────────────────────────────────────
export const PostInput = z.object({
  departmentId: z.uuid(),
  wardId: z.uuid().nullable(),
  name: z.string().trim().min(2).max(80),
  level: z.enum(POST_LEVELS),
  eligibleCadres: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  takesConsults: z.boolean(),
  escalatesToPostId: z.uuid().nullable(),
  capacity: z.number().int().min(1).max(20),
});

export const createPost = (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    PostInput,
    raw,
    async (ctx, i) => {
      const h = ctx.actor.hospitalId;
      const [dept] = await ctx.tx
        .select({ id: hospitalDepartments.id })
        .from(hospitalDepartments)
        .where(
          and(eq(hospitalDepartments.id, i.departmentId), eq(hospitalDepartments.hospitalId, h)),
        );
      if (!dept) throw notFound();
      if (i.wardId) {
        const [w] = await ctx.tx
          .select({ id: hospitalWards.id })
          .from(hospitalWards)
          .where(and(eq(hospitalWards.id, i.wardId), eq(hospitalWards.hospitalId, h)));
        if (!w) throw notFound();
      }
      if (i.escalatesToPostId) await livePost(ctx, i.escalatesToPostId);
      await mustMakeRota(ctx, i.departmentId);
      const [row] = await ctx.tx
        .insert(dutyPosts)
        .values({
          hospitalId: h,
          departmentId: i.departmentId,
          wardId: i.wardId,
          scopeKind: i.wardId ? "ward" : "department",
          name: i.name,
          level: i.level,
          eligibleCadres: i.eligibleCadres,
          takesConsults: i.takesConsults,
          escalatesToPostId: i.escalatesToPostId,
          capacity: i.capacity,
          createdBy: ctx.actor.userId,
        })
        .returning({ id: dutyPosts.id });
      return row!;
    },
    opts,
  );

const PostRef = z.object({ postId: z.uuid() });
export const archivePost = (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    PostRef,
    raw,
    async (ctx, i) => {
      const p = await livePost(ctx, i.postId, false);
      await mustMakeRota(ctx, p.departmentId);
      // A post archived meanwhile matches nothing: not found, never the guard's raw error (R37).
      const [row] = await ctx.tx
        .update(dutyPosts)
        .set({ archivedAt: ctx.now, archivedBy: ctx.actor.userId })
        .where(and(eq(dutyPosts.id, p.id), isNull(dutyPosts.archivedAt)))
        .returning({ id: dutyPosts.id });
      if (!row) throw notFound();
      return row;
    },
    opts,
  );

// ─── Assignments ───────────────────────────────────────────────────────────
export const AssignInput = z
  .object({
    postId: z.uuid(),
    userId: z.uuid(),
    day: z.iso.date(),
    shift: z.enum(SHIFTS),
    kind: z.enum(["rostered", "cover"]),
    coversAssignmentId: z.uuid().nullable(),
  })
  .refine((i) => (i.kind === "cover") === (i.coversAssignmentId !== null), {
    message: DUTY_ROTA_COPY.refusal.rota_cover,
  });

/** The rest (maker, grade, leave, double booking, capacity, same-post cover) is the 0307 guard's. */
export const assignDuty = (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    AssignInput,
    raw,
    async (ctx, i) => {
      await livePost(ctx, i.postId);
      const { startsAt, endsAt } = windowFor(i.day, i.shift);
      const [row] = await ctx.tx
        .insert(dutyAssignments)
        .values({
          hospitalId: ctx.actor.hospitalId,
          postId: i.postId,
          userId: i.userId,
          startsAt,
          endsAt,
          kind: i.kind,
          coversAssignmentId: i.coversAssignmentId,
          createdBy: ctx.actor.userId,
        })
        .returning({ id: dutyAssignments.id });
      return row!;
    },
    opts,
  );

export const EndInput = z.object({
  assignmentId: z.uuid(),
  reason: z.string().trim().min(2).max(200),
});

/** Ends a duty now (R35: never after its planned end). Ended before it starts, it holds nothing (R34). */
export const endDuty = (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    EndInput,
    raw,
    async (ctx, i) => {
      const [row] = await ctx.tx
        .update(dutyAssignments)
        .set({ endedAt: ctx.now, endedBy: ctx.actor.userId, endReason: i.reason })
        .where(
          and(
            eq(dutyAssignments.id, i.assignmentId),
            eq(dutyAssignments.hospitalId, ctx.actor.hospitalId),
            isNull(dutyAssignments.endedAt),
            gt(dutyAssignments.endsAt, ctx.now),
          ),
        )
        .returning({ id: dutyAssignments.id });
      if (!row) throw notFound();
      return row;
    },
    opts,
  );

// ─── Upkeep (0309, ADR 0538) ───────────────────────────────────────────────
const Monday = z.iso.date().refine((d) => mondayOf(d) === d, { message: "Choose a Monday." });
const WeekRef = z.object({ departmentId: z.uuid(), weekStart: Monday });

/** The actor's hospital's department, or not found: the guard alone would take any department id. */
async function ownDepartment(ctx: RotaCtx, departmentId: string) {
  const [d] = await ctx.tx
    .select({ id: hospitalDepartments.id })
    .from(hospitalDepartments)
    .where(
      and(
        eq(hospitalDepartments.id, departmentId),
        eq(hospitalDepartments.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!d) throw notFound();
}

/** A request of the actor's hospital, or not found. */
async function ownRequest(ctx: RotaCtx, requestId: string) {
  const [r] = await ctx.tx
    .select({ id: dutySwapRequests.id })
    .from(dutySwapRequests)
    .where(
      and(
        eq(dutySwapRequests.id, requestId),
        eq(dutySwapRequests.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!r) throw notFound();
}

export const TemplateInput = z.object({
  postId: z.uuid(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  shift: z.enum(SHIFTS),
  userId: z.uuid().nullable(),
});

export const saveTemplateLine = (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    TemplateInput,
    raw,
    async (ctx, i) => {
      const p = await livePost(ctx, i.postId);
      const [row] = await ctx.tx
        .insert(dutyRotaTemplates)
        .values({
          hospitalId: ctx.actor.hospitalId,
          departmentId: p.departmentId,
          postId: p.id,
          weekdays: [...new Set(i.weekdays)].sort(),
          shift: i.shift,
          userId: i.userId,
          createdBy: ctx.actor.userId,
        })
        .returning({ id: dutyRotaTemplates.id });
      return row!;
    },
    opts,
  );

export const endTemplateLine = (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    z.object({ lineId: z.uuid() }),
    raw,
    async (ctx, i) => {
      const [row] = await ctx.tx
        .update(dutyRotaTemplates)
        .set({ endedAt: ctx.now, endedBy: ctx.actor.userId })
        .where(
          and(
            eq(dutyRotaTemplates.id, i.lineId),
            eq(dutyRotaTemplates.hospitalId, ctx.actor.hospitalId),
            isNull(dutyRotaTemplates.endedAt),
          ),
        )
        .returning({ id: dutyRotaTemplates.id });
      if (!row) throw notFound();
      return row;
    },
    opts,
  );

export interface FillSkip {
  line: { postId: string; userId: string; day: string; shift: (typeof SHIFTS)[number] };
  /** The guard's words (DUTY_ROTA_COPY.refusal), or the not-found words. */
  why: string;
}

/**
 * Writes the templates' drafts for one week, each through assignDuty (its own transaction, so the guard's
 * leave, room, double-booking and lock rules apply per duty). A refused line is reported, never thrown:
 * one refusal does not stop the week.
 */
export async function fillWeekFromTemplates(
  actor: RotaActor,
  raw: unknown,
  opts?: Opts,
): Promise<ActionResult<{ written: number; skipped: FillSkip[] }>> {
  const loaded = await runRotaWrite(
    actor,
    WeekRef,
    raw,
    async (ctx, i) => {
      await ownDepartment(ctx, i.departmentId);
      await mustMakeRota(ctx, i.departmentId);
      const lines = await ctx.tx
        .select()
        .from(dutyRotaTemplates)
        .where(
          and(
            eq(dutyRotaTemplates.hospitalId, ctx.actor.hospitalId),
            eq(dutyRotaTemplates.departmentId, i.departmentId),
            isNull(dutyRotaTemplates.endedAt),
          ),
        );
      const from = new Date(`${addDays(i.weekStart, -7)}T00:00:00+03:00`);
      const to = new Date(`${addDays(i.weekStart, 8)}T00:00:00+03:00`);
      const existing = await ctx.tx
        .select({ a: dutyAssignments })
        .from(dutyAssignments)
        .innerJoin(dutyPosts, eq(dutyPosts.id, dutyAssignments.postId))
        .where(
          and(
            eq(dutyAssignments.hospitalId, ctx.actor.hospitalId),
            eq(dutyPosts.departmentId, i.departmentId),
            lt(dutyAssignments.startsAt, to),
            gt(dutyAssignments.endsAt, from),
          ),
        );
      const drafts = fillWeek(
        lines.map((l) => ({
          id: l.id,
          postId: l.postId,
          weekdays: l.weekdays,
          shift: l.shift as (typeof SHIFTS)[number],
          userId: l.userId,
        })),
        i.weekStart,
        existing.map(({ a }) => ({ ...a, kind: a.kind as "rostered" | "cover" | "swap" })),
      );
      return { id: i.departmentId, drafts };
    },
    opts,
  );
  if (!loaded.ok) return loaded;
  const skipped: FillSkip[] = [];
  let written = 0;
  for (const d of loaded.data!.drafts) {
    const r = await assignDuty(actor, { ...d, kind: "rostered", coversAssignmentId: null }, opts);
    if (r.ok) written++;
    else skipped.push({ line: d, why: r.error });
  }
  return { ...loaded, data: { written, skipped } };
}

const weekEvent = (kind: "publish" | "unlock") => (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    kind === "publish" ? WeekRef : WeekRef.extend({ reason: z.string().trim().min(2).max(300) }),
    raw,
    async (ctx, i) => {
      await ownDepartment(ctx, i.departmentId);
      const [row] = await ctx.tx
        .insert(dutyRotaWeekEvents)
        .values({
          hospitalId: ctx.actor.hospitalId,
          departmentId: i.departmentId,
          weekStart: i.weekStart,
          kind,
          reason: "reason" in i ? (i.reason as string) : null,
          actorId: ctx.actor.userId,
        })
        .returning({ id: dutyRotaWeekEvents.id });
      return row!;
    },
    opts,
  );
export const publishWeek = weekEvent("publish");
export const unlockWeek = weekEvent("unlock");

export const AskInput = z
  .object({
    assignmentId: z.uuid(),
    kind: z.enum(["cover", "swap"]),
    colleagueUserId: z.uuid(),
    swapAssignmentId: z.uuid().optional(),
  })
  .refine((i) => (i.kind === "swap") === (i.swapAssignmentId !== undefined), {
    message: DUTY_ROTA_COPY.refusal.rota_cover,
  });

/** The holder asks a colleague of this hospital; the SQL guard checks the duty is theirs, live, and a swap's pair. */
export const askCoverOrSwap = (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    AskInput,
    raw,
    async (ctx, i) => {
      const [colleague] = await ctx.tx
        .select({ id: staffAffiliations.userId })
        .from(staffAffiliations)
        .where(
          and(
            eq(staffAffiliations.userId, i.colleagueUserId),
            eq(staffAffiliations.hospitalId, ctx.actor.hospitalId),
            inArray(staffAffiliations.state, ["active", "approved"]),
          ),
        )
        .limit(1);
      if (!colleague) throw notFound();
      const [row] = await ctx.tx
        .insert(dutySwapRequests)
        .values({
          hospitalId: ctx.actor.hospitalId,
          kind: i.kind,
          assignmentId: i.assignmentId,
          askedBy: ctx.actor.userId,
          colleagueUserId: i.colleagueUserId,
          swapAssignmentId: i.swapAssignmentId ?? null,
        })
        .returning({ id: dutySwapRequests.id });
      return row!;
    },
    opts,
  );

/** One event on a request; the 0309 trigger decides who may, in what order, and applies an approval. */
const requestEvent =
  <I extends { requestId: string }>(
    schema: z.ZodType<I>,
    kindOf: (i: I) => string,
    reasonOf: (i: I) => string | null = () => null,
  ) =>
  (actor: RotaActor, raw: unknown, opts?: Opts) =>
    runRotaWrite(
      actor,
      schema,
      raw,
      async (ctx, i) => {
        await ownRequest(ctx, i.requestId);
        const [row] = await ctx.tx
          .insert(dutySwapRequestEvents)
          .values({
            requestId: i.requestId,
            kind: kindOf(i),
            actorId: ctx.actor.userId,
            reason: reasonOf(i),
          })
          .returning({ id: dutySwapRequestEvents.id });
        return row!;
      },
      opts,
    );

export const answerSwap = requestEvent(
  z.object({ requestId: z.uuid(), answer: z.enum(["accepted", "declined"]) }),
  (i) => i.answer,
);
export const decideSwap = requestEvent(
  z.object({
    requestId: z.uuid(),
    decision: z.enum(["approved", "refused"]),
    reason: z.string().trim().min(2).max(300).optional(),
  }),
  (i) => i.decision,
  (i) => i.reason ?? null,
);

export const addDelegate = (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    z.object({
      departmentId: z.uuid(),
      toUserId: z.uuid(),
      canPublish: z.boolean(),
      until: z.iso.date().nullable(),
    }),
    raw,
    async (ctx, i) => {
      await ownDepartment(ctx, i.departmentId);
      const [row] = await ctx.tx
        .insert(dutyRotaDelegates)
        .values({
          hospitalId: ctx.actor.hospitalId,
          departmentId: i.departmentId,
          fromUser: ctx.actor.userId,
          toUser: i.toUserId,
          canPublish: i.canPublish,
          until: i.until,
        })
        .returning({ id: dutyRotaDelegates.id });
      return row!;
    },
    opts,
  );

export const revokeDelegate = (actor: RotaActor, raw: unknown, opts?: Opts) =>
  runRotaWrite(
    actor,
    z.object({ delegateId: z.uuid() }),
    raw,
    async (ctx, i) => {
      const [row] = await ctx.tx
        .update(dutyRotaDelegates)
        .set({ revokedAt: ctx.now, revokedBy: ctx.actor.userId })
        .where(
          and(
            eq(dutyRotaDelegates.id, i.delegateId),
            eq(dutyRotaDelegates.hospitalId, ctx.actor.hospitalId),
            isNull(dutyRotaDelegates.revokedAt),
          ),
        )
        .returning({ id: dutyRotaDelegates.id });
      if (!row) throw notFound();
      return row;
    },
    opts,
  );
