import "server-only";

import type { CareRequestRow } from "@/db/schema/care-requests";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type { OpenRequest, RequestTimes } from "@/lib/requests/escalation";
import type { Candidate, RouteCandidates, RouteResult } from "@/lib/requests/routing";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import {
  careRequestEvents,
  careRequests,
  careRequestResponseVersions as crrv,
} from "@/db/schema/care-requests";
import { dutyPosts } from "@/db/schema/duty-rota";
import { escalationHeartbeats } from "@/db/schema/lab-safety";
import { SENIOR_CADRE_CODES } from "@/lib/doctor/cadres";
import {
  cliniciansHere,
  headsAndContacts,
  notifyRecipients,
  placeOf,
  writeRouting,
} from "@/lib/emr/write/requests";
import { logger } from "@/lib/logger";
import { clockFor, planRequestEscalations } from "@/lib/requests/escalation";
import { route } from "@/lib/requests/routing";
import { currentRound, deriveFromRows } from "@/lib/requests/rows";
import { inPost } from "@/lib/rota/cover";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { loadCoverWorld } from "@/lib/rota/read";

/**
 * The care-request escalation run (D4 clock, D7 ladder; ADR 0536). The lab's one-minute tick calls it
 * (app/api/cron/lab-escalations) and every request read runs it lazily for its hospital. It only routes:
 * it never accepts, answers or closes, and never asks the requester or a pharmacist (R32). Idempotent:
 * requests are taken FOR UPDATE SKIP LOCKED, so two runs never escalate one request twice.
 */

type EventRows = Parameters<typeof deriveFromRows>[1];
const NOBODY: RouteCandidates = {
  named: [],
  post: [],
  team: [],
  supervisor: [],
  heads: [],
  hospitalContacts: [],
};

/**
 * A request and its events → the planner's view. The level is the highest routed level of the current
 * round, reached when it was routed (level 0: the round's start). A level's window starts no earlier than
 * the signing of the times in force (R40), so signing never bursts escalations. Accepted (or phoned) and
 * replied count in the current round only; the original request time stays for the day-end overdue (R39).
 */
export function openRequestOf(
  request: Pick<
    CareRequestRow,
    | "id"
    | "hospitalId"
    | "kind"
    | "urgency"
    | "requesterUserId"
    | "requestedAt"
    | "phonedUserId"
    | "phonedAt"
    | "targetDepartmentId"
  >,
  rows: EventRows,
  signedAt: Date | null,
  now: Date,
): OpenRequest {
  const { events, derived } = deriveFromRows(request, rows, now);
  const cur = currentRound(events);
  const routed = cur.filter((e) => e.kind === "routed");
  const level = Math.max(0, ...routed.map((e) => e.level)) as 0 | 1 | 2;
  const reached =
    level === 0
      ? (events.findLast((e) => e.kind === "redirected")?.at ?? request.requestedAt)
      : routed.find((e) => e.level === level)!.at;
  return {
    id: request.id,
    hospitalId: request.hospitalId,
    kind: request.kind as OpenRequest["kind"],
    urgency: request.urgency,
    level,
    levelSince: signedAt && signedAt > reached ? signedAt : reached,
    accepted: derived.acceptedAt !== null,
    replied: cur.some((e) => e.kind === "replied"),
    requestedAt: request.requestedAt,
  };
}

/**
 * Level 1 on the rota: whoever is in post now on the escalates-to posts of the level-0 posts (a review:
 * senior cadres only, R7). One who cannot take it is marked inactive, so the skip is recorded. Read in a
 * savepoint: a failure falls through to the department heads.
 */
async function escalationHolders(
  tx: EmrTx,
  hospitalId: string,
  level0Posts: string[],
  review: boolean,
  at: Date,
): Promise<Candidate[]> {
  if (!level0Posts.length || !dutyRotaLiveFor(hospitalId)) return [];
  try {
    return await tx.transaction(async (sp) => {
      const up = await sp
        .selectDistinct({ id: dutyPosts.id, departmentId: dutyPosts.departmentId })
        .from(dutyPosts)
        .where(
          inArray(
            dutyPosts.id,
            sp
              .select({ id: dutyPosts.escalatesToPostId })
              .from(dutyPosts)
              .where(
                and(inArray(dutyPosts.id, level0Posts), isNotNull(dutyPosts.escalatesToPostId)),
              ),
          ),
        );
      if (!up.length) return [];
      const w = await loadCoverWorld(sp, hospitalId, {
        departmentIds: [...new Set(up.map((p) => p.departmentId))],
        from: at,
        to: new Date(at.getTime() + 1),
      });
      const ids = new Set(up.map((p) => p.id));
      const people = w.posts
        .filter((p) => ids.has(p.id) && !p.archived)
        .flatMap((p) =>
          w.assignments
            .filter((a) => a.postId === p.id && inPost(a, w.leave, at))
            .map((a) => ({ userId: a.userId, postId: p.id })),
        );
      const ok = await cliniciansHere(
        sp,
        hospitalId,
        people.map((p) => p.userId),
        review ? SENIOR_CADRE_CODES : undefined,
      );
      return people.map((p) => ({ ...p, active: ok.get(p.userId) ?? false }));
    });
  } catch (e) {
    logger.warn("care_request.escalation_rota_read_failed", {
      reason: e instanceof Error ? e.name : "unknown",
    });
    return [];
  }
}

type Signed = { times: RequestTimes; signedAt: Date | null };

/** The step due now, or null. A fully declined round is the requester's to redirect, never escalated (R42). */
function stepFor(request: CareRequestRow, rows: EventRows, signed: Signed, now: Date) {
  if (deriveFromRows(request, rows, now).derived.state === "declined") return null;
  const open = openRequestOf(request, rows, signed.signedAt, now);
  return planRequestEscalations(now, [open], () => signed.times)[0] ?? null;
}

/** A failure's SQLSTATE (Postgres errors carry `code`; Drizzle wraps them in `cause`). Never the message. */
export function errorCode(e: unknown): string | undefined {
  const x = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = x?.code ?? x?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/** One request past its window: escalated level by level until someone is asked or level 2 is reached. */
async function escalateOne(
  tx: EmrTx,
  request: CareRequestRow,
  rows: EventRows,
  signed: Signed,
  now: Date,
): Promise<boolean> {
  const step = stepFor(request, rows, signed, now);
  if (!step) return false;
  const { events, departmentId } = deriveFromRows(request, rows, now);
  const round = currentRound(events).filter((e) => e.kind === "routed");
  const level0Posts = [
    ...new Set(round.filter((e) => e.level === 0 && e.postId).map((e) => e.postId!)),
  ];
  // R44: whoever this round already asked is not asked again (a recorded skip); a level of repeats is empty.
  const asked = new Set(round.flatMap((e) => (e.recipientUserId ? [e.recipientUserId] : [])));
  const notAgain = (c: Candidate[]) =>
    c.map((p) => (asked.has(p.userId) ? { ...p, active: false } : p));
  const ctx = { tx, now, actor: { hospitalId: request.hospitalId } };
  let routed!: RouteResult;
  let recipients: string[] = [];
  // An empty level is passed at once, in this run (ADR 0243 §3); the next run finds the level reached.
  for (let level = step.toLevel; level <= 2; level++) {
    const { heads, hospitalContacts } = await headsAndContacts(
      tx,
      request.hospitalId,
      departmentId,
      now,
    );
    routed = route(
      level === 1
        ? {
            ...NOBODY,
            post: notAgain(
              await escalationHolders(
                tx,
                request.hospitalId,
                level0Posts,
                request.kind === "review",
                now,
              ),
            ),
            heads: notAgain(heads),
          }
        : { ...NOBODY, hospitalContacts: notAgain(hospitalContacts) },
      request.requesterUserId,
    );
    await tx.insert(careRequestEvents).values({
      requestId: request.id,
      hospitalId: request.hospitalId,
      kind: "escalated",
      at: now,
      level,
    });
    recipients = await writeRouting(ctx, request.id, routed, level);
    if (recipients.length) break;
  }

  const place = await placeOf({ tx, request, departmentId });
  await notifyRecipients(ctx, request.id, recipients, "care_request", place);
  const postId = routed.step === "post" ? routed.recipients[0]?.postId : null;
  const [post] = postId
    ? await tx.select({ name: dutyPosts.name }).from(dutyPosts).where(eq(dutyPosts.id, postId))
    : [];
  const clock = clockFor(request.kind as OpenRequest["kind"], request.urgency, signed.times);
  await notifyRecipients(
    ctx,
    request.id,
    [request.requesterUserId],
    "care_request_update",
    place,
    CARE_REQUEST_COPY.escalatedBody(clock.until, clock.minutes, routed.step, post?.name ?? null),
  );
  return true;
}

/** Still waiting on the clock: no reply, close or cancel yet. */
const unfinished = sql`NOT EXISTS (SELECT 1 FROM ${careRequestEvents} e WHERE e.request_id = ${careRequests.id}
  AND e.kind IN ('replied','closed','cancelled'))`;

const eventsOf = async (tx: EmrTx, ids: string[]) =>
  ids.length
    ? tx.select().from(careRequestEvents).where(inArray(careRequestEvents.requestId, ids))
    : [];

/**
 * Escalates every open request past its window, once, in one transaction. With no signed times a hospital
 * has no automatic escalation (ADR 0244 §1). Before migrations 0306-0308 there is nothing to do (R13).
 * It plans without locks, then locks only the due requests (SKIP LOCKED), re-reads and re-plans them (R43),
 * so the lifecycle's writes never wait on a request that is not due. Each request runs in its own savepoint:
 * one failing is logged and skipped, never the run (R45). Only the scheduler records a heartbeat: a read
 * escalating on its own must never hide a stopped scheduler.
 */
export async function runCareRequestEscalations(
  db: EmrDb,
  opts: { now: Date; source: "scheduler" | "lazy"; hospitalId?: string },
): Promise<{ escalated: number }> {
  return db.transaction(async (tx) => {
    const res = await tx.execute(
      sql`SELECT to_regclass('public.care_request_response_versions') IS NOT NULL AS ok`,
    );
    const [ready] = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as {
      ok: boolean;
    }[];
    if (!ready?.ok) return { escalated: 0 };

    const signed = await tx
      .select()
      .from(crrv)
      .where(
        and(
          eq(crrv.status, "signed"),
          opts.hospitalId ? eq(crrv.hospitalId, opts.hospitalId) : undefined,
        ),
      );
    const times = new Map<string, Signed>(
      signed.map((v) => [
        v.hospitalId,
        {
          times: {
            reviewNowAcceptMin: v.reviewNowAcceptMin,
            review1hAcceptMin: v.review1hAcceptMin,
            consultUrgentAcceptMin: v.consultUrgentAcceptMin,
            routineReplyMin: v.routineReplyMin,
          },
          signedAt: v.csoSignedAt,
        },
      ]),
    );
    let escalated = 0;
    if (times.size) {
      // shortcut: every unfinished request of a signed hospital is derived each run; filter on a stored
      // level and due time in SQL when open requests per hospital reach the thousands.
      const candidates = await tx
        .select()
        .from(careRequests)
        .where(and(inArray(careRequests.hospitalId, [...times.keys()]), unfinished));
      const seen = await eventsOf(
        tx,
        candidates.map((r) => r.id),
      );
      const due = candidates
        .filter((r) =>
          stepFor(
            r,
            seen.filter((e) => e.requestId === r.id),
            times.get(r.hospitalId)!,
            opts.now,
          ),
        )
        .map((r) => r.id);
      const locked = due.length
        ? await tx
            .select()
            .from(careRequests)
            .where(and(inArray(careRequests.id, due), unfinished))
            .for("update", { skipLocked: true })
        : [];
      const rows = await eventsOf(
        tx,
        locked.map((r) => r.id),
      );
      for (const request of locked) {
        const mine = rows.filter((e) => e.requestId === request.id);
        try {
          if (
            await tx.transaction((sp) =>
              escalateOne(sp, request, mine, times.get(request.hospitalId)!, opts.now),
            )
          )
            escalated++;
        } catch (e) {
          logger.error("care_request.escalation_failed", {
            requestId: request.id,
            reason: e instanceof Error ? e.name : "unknown",
            code: errorCode(e),
          });
        }
      }
    }
    if (opts.source === "scheduler")
      await tx
        .insert(escalationHeartbeats)
        .values({ source: "care_requests", ranAt: opts.now, escalated });
    return { escalated };
  });
}

/** The scheduler's last care-request run; pair it with the lab's heartbeatStale (ES-5). */
export async function lastRequestHeartbeat(tx: EmrTx): Promise<Date | null> {
  const [h] = await tx
    .select({ at: escalationHeartbeats.ranAt })
    .from(escalationHeartbeats)
    .where(eq(escalationHeartbeats.source, "care_requests"))
    .orderBy(desc(escalationHeartbeats.ranAt))
    .limit(1);
  return h?.at ?? null;
}
