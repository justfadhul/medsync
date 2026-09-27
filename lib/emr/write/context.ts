import "server-only";

import type { EmrAccessBasis } from "@/lib/emr/access";
import type { EmrActor } from "@/lib/emr/actor";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import { eq, sql } from "drizzle-orm";

import { encounters } from "@/db/schema/scheduling";
import { resolveEmrAccess } from "@/lib/emr/access";
import { asClinicalWriter } from "@/lib/emr/db";

/**
 * The one shape every EMR write takes: a transaction opened as the clinician
 * (identity set for the audit triggers), the access basis already resolved
 * inside it, and one clock. Write functions are `(ctx, input) => result`, so the
 * PGlite lane can drive them with an injected database and the server actions
 * stay thin wrappers (Zod → requireEmrActor → withPatientWrite → write fn).
 */
export interface WriteCtx {
  tx: EmrTx;
  actor: EmrActor;
  basis: EmrAccessBasis;
  now: Date;
}

export type EmrWriteErrorCode = "forbidden" | "invalid" | "conflict" | "not_found" | "config";

export class EmrWriteError extends Error {
  constructor(
    readonly code: EmrWriteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EmrWriteError";
  }
}

export async function withPatientWrite<T>(
  actor: EmrActor,
  patientUserId: string,
  fn: (ctx: WriteCtx) => Promise<T>,
  options?: { database?: EmrDb; now?: Date },
): Promise<T> {
  if (!actor.isClinical) throw new EmrWriteError("forbidden", "Not a clinical role.");
  return asClinicalWriter(
    { userId: actor.userId, hospitalId: actor.hospitalId },
    async (tx) => {
      // Service-role writes bypass RLS, so the one access rule is checked here,
      // in the same transaction as the write it guards.
      const access = await resolveEmrAccess(tx, {
        userId: actor.userId,
        patientUserId,
        hospitalId: actor.hospitalId,
      });
      if (!access.allowed) {
        throw new EmrWriteError("forbidden", "No legitimate clinical access to this patient.");
      }
      return fn({ tx, actor, basis: access.basis, now: options?.now ?? new Date() });
    },
    options?.database,
  );
}

/** The Workspace reads this to tell active clerking from an idle encounter. */
export async function stampActivity(
  ctx: WriteCtx,
  encounterId: string | null | undefined,
): Promise<void> {
  if (!encounterId) return;
  await ctx.tx
    .update(encounters)
    .set({
      // An ISO string cast in SQL: postgres-js cannot bind a raw Date inside a sql`` fragment
      // (prepare: false gives it no type to infer), and every note save failed on it in production.
      lastActivityAt: sql`GREATEST(COALESCE(${encounters.lastActivityAt}, ${ctx.now.toISOString()}::timestamptz), ${ctx.now.toISOString()}::timestamptz)`,
    })
    .where(eq(encounters.id, encounterId));
}

/** What every server action returns (PROMPT §8): the id and the server's clock. */
export type ActionResult<T = undefined> =
  | { ok: true; id: string; serverTime: string; data?: T; warnings?: string[] }
  | { ok: false; code: EmrWriteErrorCode; error: string };

export function actionError(e: unknown): ActionResult<never> {
  if (e instanceof EmrWriteError) return { ok: false, code: e.code, error: e.message };
  throw e;
}
