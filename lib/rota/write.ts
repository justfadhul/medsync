import "server-only";

import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type { ActionResult } from "@/lib/emr/write/context";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { dutyAssignments, dutyPosts } from "@/db/schema/duty-rota";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { asClinicalWriter } from "@/lib/emr/db";
import { actionError, EmrWriteError } from "@/lib/emr/write/context";
import { POST_LEVELS, SHIFTS, windowFor } from "@/lib/rota/cover";
import { dutyRotaLiveFor } from "@/lib/rota/feature";

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
  const { code, hint, cause } = e as { code?: unknown; hint?: unknown; cause?: unknown };
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
