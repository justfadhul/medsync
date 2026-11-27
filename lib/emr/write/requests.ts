import "server-only";

import type { WriteCtx } from "./context";
import type { WriteResult } from "./orders";
import type { CareRequestRow } from "@/db/schema/care-requests";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { EmrActor } from "@/lib/emr/actor";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type {
  CancelReason,
  DeclineReason,
  DerivedRequest,
  RedirectReason,
  Relation,
  RequestAct,
  RequestEvent,
  RequestKind,
} from "@/lib/requests/engine";
import type { Candidate, RouteCandidates } from "@/lib/requests/routing";
import { and, asc, desc, eq, gt, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { admissions, OPEN_ADMISSION_STATUSES } from "@/db/schema/admissions";
import { careRequestEvents, careRequests } from "@/db/schema/care-requests";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { clinicalSupervision } from "@/db/schema/doctor-workspace";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { criticalContacts } from "@/db/schema/lab-safety";
import { wardInChargeAssignments } from "@/db/schema/nurse-workspace";
import { cadres } from "@/db/schema/reference-data";
import { saNotifications } from "@/db/schema/sa-notifications";
import { departmentHeads } from "@/db/schema/services-hub";
import { JUNIOR_CADRE_CODES, SENIOR_CADRE_CODES } from "@/lib/doctor/cadres";
import { asClinicalWriter } from "@/lib/emr/db";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { PHARMACY_MAP_CADRES } from "@/lib/pharmacy/access";
import { canAct } from "@/lib/requests/engine";
import { dueAt } from "@/lib/requests/escalation";
import { route } from "@/lib/requests/routing";
import { currentRound, deriveFromRows } from "@/lib/requests/rows";
import { signedRequestTimes } from "@/lib/requests/times";
import { whoCovers } from "@/lib/rota/cover";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { loadCoverWorld } from "@/lib/rota/read";
import { EmrWriteError } from "./context";
import { insertSignedNote } from "./notes";
import {
  checkReasonConditions,
  openEncounter,
  ORDERING_CADRES,
  replayed,
  requireCadre,
} from "./orders";

/**
 * Placing care requests (ADR 0533): reviews and consults from the Plan. Each line is written once,
 * routed (lib/requests/routing.ts) and its recipients get an in-app notice, all in the caller's
 * transaction; the notices sit in a savepoint so their failure never unplaces the request.
 */

const LIVE = ["active", "approved"] as const;
/** How far back a phone call may be recorded, and how far ahead (clock skew). */
const PHONED_WINDOW_MS = { past: 24 * 60 * 60_000, ahead: 5 * 60_000 };

/** R32: pharmacists cannot receive consults in v1. The pharmacy cadres (the signed pharmacy map's) are
 *  clinical, so every recipient and actor query also leaves them out. */
export const notPharmacyCadre = () => notInArray(cadres.code, [...PHARMACY_MAP_CADRES]);

/** R32: the pharmacy (catalogue code PHARMACY) and its dispensing points are not a team to ask. */
export const notPharmacyDepartment = sql`(${hospitalDepartments.catalogueCode} IS DISTINCT FROM 'PHARMACY'
  AND NOT EXISTS (SELECT 1 FROM ${hospitalDepartments} pd WHERE pd.id = ${hospitalDepartments.parentId}
    AND pd.catalogue_code = 'PHARMACY'))`;
export const isPharmacyDepartment = sql<boolean>`NOT ${notPharmacyDepartment}`;

/** Clinicians with an affiliation here (any state, in `codes` when given), and whether one of them is live.
 *  Never a pharmacy cadre. */
export async function cliniciansHere(
  tx: EmrTx,
  hospitalId: string,
  userIds: string[],
  codes?: readonly string[],
): Promise<Map<string, boolean>> {
  if (!userIds.length) return new Map();
  const rows = await tx
    .select({
      userId: staffAffiliations.userId,
      live: sql<boolean>`bool_or(${staffAffiliations.state} IN ('active','approved'))`,
    })
    .from(staffAffiliations)
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(
      and(
        inArray(staffAffiliations.userId, userIds),
        eq(staffAffiliations.hospitalId, hospitalId),
        eq(cadres.isClinical, true),
        notPharmacyCadre(),
        codes ? inArray(cadres.code, [...codes]) : undefined,
      ),
    )
    .groupBy(staffAffiliations.userId);
  return new Map(rows.map((r) => [r.userId, r.live]));
}

/**
 * Who holds the post at `at` when the rota is on (ADR 0534), by whoCovers's post steps only: a review the
 * ward's, else the department's, senior posts; a consult the department's takes-consults post. A holder who
 * cannot take it (not live clinical here, R25, or a junior on a review, R7) is skipped and recorded; when no
 * ward holder can, the department's post answers before the team list (R38). The read runs in a savepoint: a
 * failure falls through to the team list, never unplaces.
 */
async function postHolders(
  tx: EmrTx,
  q: { hospitalId: string; departmentId: string; wardId: string | null; at: Date },
  review: boolean,
): Promise<Candidate[]> {
  if (!dutyRotaLiveFor(q.hospitalId)) return [];
  try {
    return await tx.transaction(async (sp) => {
      const w = await loadCoverWorld(sp, q.hospitalId, {
        departmentIds: [q.departmentId],
        from: q.at,
        to: new Date(q.at.getTime() + 1),
      });
      const holders = async (wardId: string | null) => {
        const cover = whoCovers(w, {
          departmentId: q.departmentId,
          wardId,
          levels: review ? ["senior", "consultant"] : undefined,
          at: q.at,
        });
        if (cover.step !== "ward_post" && cover.step !== "department_post") return null;
        const ids = cover.people.map((p) => p.userId);
        const ok = await cliniciansHere(
          sp,
          q.hospitalId,
          ids,
          review ? SENIOR_CADRE_CODES : undefined,
        );
        return {
          step: cover.step,
          people: cover.people.map(
            (p): Candidate => ({
              userId: p.userId,
              active: ok.get(p.userId) ?? false,
              postId: p.postId,
            }),
          ),
        };
      };
      const first = await holders(review ? q.wardId : null);
      if (!first) return [];
      if (first.step === "department_post" || first.people.some((p) => p.active))
        return first.people;
      // Ahead of the department's holders, so route() records the ward's unusable ones as skips.
      return [...first.people, ...((await holders(null))?.people ?? [])];
    });
  } catch (e) {
    logger.warn("care_request.rota_read_failed", {
      reason: e instanceof Error ? e.name : "unknown",
    });
    return [];
  }
}

/**
 * The candidate lists route() walks: post holders only when the rota is on. A review takes senior cadres
 * only on the post and team lists, and a junior's review falls back to their open primary supervisor.
 */
export async function loadRouteCandidates(
  tx: EmrTx,
  q: {
    hospitalId: string;
    departmentId: string;
    kind: RequestKind;
    namedUserIds: string[];
    requester: { userId: string; affiliationId: string; cadreCode: string };
    wardId: string | null;
    at: Date;
  },
): Promise<RouteCandidates> {
  const review = q.kind === "review";
  const team = await tx
    .select({ userId: staffAffiliations.userId })
    .from(staffAffiliations)
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(
      and(
        eq(staffAffiliations.hospitalId, q.hospitalId),
        eq(staffAffiliations.departmentId, q.departmentId),
        inArray(staffAffiliations.state, [...LIVE]),
        eq(cadres.isClinical, true),
        notPharmacyCadre(),
        review ? inArray(cadres.code, [...SENIOR_CADRE_CODES]) : undefined,
      ),
    )
    .orderBy(asc(staffAffiliations.createdAt));

  const day = q.at.toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });
  const supervisor =
    review && (JUNIOR_CADRE_CODES as readonly string[]).includes(q.requester.cadreCode)
      ? await tx
          .select({
            userId: staffAffiliations.userId,
            active: sql<boolean>`${staffAffiliations.state} IN ('active','approved')`,
          })
          .from(clinicalSupervision)
          .innerJoin(
            staffAffiliations,
            eq(staffAffiliations.id, clinicalSupervision.supervisorAffiliationId),
          )
          .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
          .where(
            and(
              notPharmacyCadre(),
              eq(clinicalSupervision.hospitalId, q.hospitalId),
              eq(clinicalSupervision.superviseeAffiliationId, q.requester.affiliationId),
              eq(clinicalSupervision.relationshipKind, "primary"),
              lte(clinicalSupervision.startsOn, day),
              or(isNull(clinicalSupervision.endsOn), sql`${clinicalSupervision.endsOn} >= ${day}`),
            ),
          )
          .orderBy(desc(clinicalSupervision.startsOn))
          .limit(1)
      : [];

  // Named people with no live clinical affiliation here are skipped (and recorded).
  const live = await cliniciansHere(tx, q.hospitalId, q.namedUserIds);
  return {
    named: q.namedUserIds.map((userId) => ({ userId, active: live.get(userId) ?? false })),
    post: await postHolders(tx, q, review),
    team: team.map((r): Candidate => ({ userId: r.userId, active: true })),
    supervisor,
    ...(await headsAndContacts(tx, q.hospitalId, q.departmentId, q.at)),
  };
}

/**
 * Routing's last steps and the escalation ladder's (D7): the department's heads in office at `at`
 * (substantive first) and the hospital contacts (critical_contacts level 2). One with no live clinical
 * affiliation here (or a pharmacy cadre, R32) is marked inactive, so route() skips and records them.
 */
export async function headsAndContacts(
  tx: EmrTx,
  hospitalId: string,
  departmentId: string,
  at: Date,
): Promise<Pick<RouteCandidates, "heads" | "hospitalContacts">> {
  const heads = await tx
    .select({
      userId: departmentHeads.userId,
    })
    .from(departmentHeads)
    .where(
      and(
        eq(departmentHeads.hospitalId, hospitalId),
        eq(departmentHeads.departmentId, departmentId),
        lte(departmentHeads.startsAt, at),
        or(isNull(departmentHeads.endsAt), gt(departmentHeads.endsAt, at)),
      ),
    )
    .orderBy(asc(departmentHeads.acting), asc(departmentHeads.startsAt));

  const hospitalContacts = await tx
    .select({
      userId: criticalContacts.userId,
    })
    .from(criticalContacts)
    .where(and(eq(criticalContacts.hospitalId, hospitalId), eq(criticalContacts.level, 2)))
    .orderBy(asc(criticalContacts.position));

  const live = await cliniciansHere(tx, hospitalId, [
    ...heads.map((r) => r.userId),
    ...hospitalContacts.map((r) => r.userId),
  ]);
  const checked = (ids: string[]): Candidate[] =>
    ids.map((userId) => ({ userId, active: live.get(userId) ?? false }));
  return {
    heads: checked(heads.map((r) => r.userId)),
    hospitalContacts: checked(hospitalContacts.map((r) => r.userId)),
  };
}

/** Inserts one notice per user and sends each its live nudge, in the caller's savepoint. */
async function insertNotices(
  sp: EmrTx,
  now: Date,
  userIds: string[],
  n: { kind: string; subject: string; body: string; relatedKind: string; relatedId: string },
): Promise<void> {
  if (!userIds.length) return;
  await sp.insert(saNotifications).values(
    userIds.map((recipientUserId) => ({
      recipientUserId,
      kind: n.kind,
      subject: n.subject,
      body: n.body,
      relatedKind: n.relatedKind,
      relatedId: n.relatedId,
      deliveredAt: now,
    })),
  );
  for (const u of userIds)
    await sp.execute(
      sql`SELECT private.notify_user_event(${u}::uuid, 'request', ${n.kind}, ${n.relatedId}::uuid)`,
    );
}

/**
 * In-app notices for a request, in a savepoint: they commit only with the request, and a failure is
 * logged, never thrown. Subjects carry the place, never the patient (ADR 0199).
 */
export async function notifyRecipients(
  ctx: Pick<WriteCtx, "tx" | "now">,
  requestId: string,
  userIds: string[],
  kind: "care_request" | "care_request_update",
  place: string,
  body: string = CARE_REQUEST_COPY.noticeBody,
): Promise<void> {
  if (!userIds.length) return;
  try {
    await ctx.tx.transaction((sp) =>
      insertNotices(sp, ctx.now, userIds, {
        kind,
        subject: CARE_REQUEST_COPY.noticeSubject(kind, place),
        body,
        relatedKind: "care_request",
        relatedId: requestId,
      }),
    );
  } catch (e) {
    logger.warn("care_request.notify_failed", { requestId, reason: String(e) });
  }
}

/**
 * The admission's ward is told (ADR 0533): its open in-charge assignments, substantive and acting, get a
 * `ward_incoming` notice naming the ward only (ADR 0199). Reads and writes sit in one savepoint, so a
 * failure is logged and never rolls back the close's own writes; it never throws.
 */
export async function notifyWardIncoming(ctx: WriteCtx, admissionId: string): Promise<void> {
  try {
    await ctx.tx.transaction(async (sp) => {
      const [ward] = await sp
        .select({ id: hospitalWards.id, name: hospitalWards.name })
        .from(admissions)
        .innerJoin(hospitalWards, eq(hospitalWards.id, admissions.wardId))
        .where(
          and(eq(admissions.id, admissionId), eq(admissions.hospitalId, ctx.actor.hospitalId)),
        );
      if (!ward) return;
      const nurses = await sp
        .selectDistinct({ userId: wardInChargeAssignments.nurseUserId })
        .from(wardInChargeAssignments)
        .where(
          and(
            eq(wardInChargeAssignments.wardId, ward.id),
            or(isNull(wardInChargeAssignments.endsAt), gt(wardInChargeAssignments.endsAt, ctx.now)),
            lte(wardInChargeAssignments.startsAt, ctx.now),
          ),
        );
      await insertNotices(
        sp,
        ctx.now,
        nurses.map((r) => r.userId),
        {
          kind: "ward_incoming",
          subject: CARE_REQUEST_COPY.noticeSubject("ward_incoming", ward.name),
          body: CARE_REQUEST_COPY.wardIncomingBody,
          relatedKind: "admission",
          relatedId: admissionId,
        },
      );
    });
  } catch (e) {
    logger.warn("ward_incoming.notify_failed", { admissionId, reason: String(e) });
  }
}

/** The `routed` rows of one routing round, or of one escalation level (one row with no recipient when it
 *  reached nobody), with its skips; returns the recipients. */
export async function writeRouting(
  ctx: { tx: EmrTx; now: Date; actor: { hospitalId: string } },
  requestId: string,
  routed: ReturnType<typeof route>,
  level = 0,
): Promise<string[]> {
  const base = {
    requestId,
    hospitalId: ctx.actor.hospitalId,
    kind: "routed",
    at: ctx.now,
    level,
    step: routed.step,
    skippedUserIds: routed.skipped.map((k) => k.userId),
  };
  await ctx.tx
    .insert(careRequestEvents)
    .values(
      routed.recipients.length
        ? routed.recipients.map((r) => ({ ...base, recipientUserId: r.userId, postId: r.postId }))
        : [{ ...base, recipientUserId: null, postId: null }],
    );
  return routed.recipients.map((r) => r.userId);
}

/**
 * Places the Plan's request lines, in order; a replayed client key returns the request it placed.
 * Callers gate the cadre (placePlan: PRESCRIBING_CADRES).
 */
export async function placeRequests(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    encounterId: string;
    placementId: string;
    lines: PlanRequestLine[];
  },
): Promise<string[]> {
  const { tx, actor, now } = ctx;
  const hospitalId = actor.hospitalId;
  const encounter = await openEncounter(ctx, input.patientUserId, input.encounterId);
  // Null when nothing is signed: then no request has a due time (ADR 0244 §1).
  const times = await signedRequestTimes(tx, hospitalId);
  const ids: string[] = [];

  for (const line of input.lines) {
    const replay = await replayed(tx, careRequests, line.clientKey, input.patientUserId);
    if (replay) {
      ids.push(replay);
      continue;
    }

    const [dept] = await tx
      .select({ name: hospitalDepartments.name, pharmacy: isPharmacyDepartment })
      .from(hospitalDepartments)
      .where(
        and(
          eq(hospitalDepartments.id, line.targetDepartmentId),
          eq(hospitalDepartments.hospitalId, hospitalId),
        ),
      );
    if (!dept) throw new EmrWriteError("invalid", "That department is not at this hospital.");
    if (dept.pharmacy) throw new EmrWriteError("invalid", CARE_REQUEST_COPY.refusal.pharmacy);
    let place = dept.name;
    if (line.wardId) {
      const [ward] = await tx
        .select({ name: hospitalWards.name })
        .from(hospitalWards)
        .where(and(eq(hospitalWards.id, line.wardId), eq(hospitalWards.hospitalId, hospitalId)));
      if (!ward) throw new EmrWriteError("invalid", "That ward is not at this hospital.");
      place = ward.name;
    }
    // R24: recipients are a trust boundary. Named people are clinicians here (an inactive one is
    // skipped by routing); the phoned consultant is a live clinician here, not the requester.
    const named = [...new Set(line.namedUserIds)];
    const phoned = line.phoned;
    const here = await cliniciansHere(tx, hospitalId, [
      ...named,
      ...(phoned ? [phoned.userId] : []),
    ]);
    if (named.some((u) => !here.has(u)))
      throw new EmrWriteError("invalid", "A named person is not a clinician at this hospital.");
    if (phoned) {
      if (phoned.userId === actor.userId)
        throw new EmrWriteError("invalid", "You cannot record a call to yourself.");
      if (!here.get(phoned.userId))
        throw new EmrWriteError("invalid", "The person phoned is not a clinician here now.");
      const at = new Date(phoned.at).getTime();
      if (
        !(
          at <= now.getTime() + PHONED_WINDOW_MS.ahead &&
          at >= now.getTime() - PHONED_WINDOW_MS.past
        )
      )
        throw new EmrWriteError("invalid", "The call time must be within the last 24 hours.");
    }

    const { restricted } = await checkReasonConditions(
      tx,
      input.patientUserId,
      line.reasonConditionIds,
    );
    const [admission] = await tx
      .select({ id: admissions.id })
      .from(admissions)
      .where(
        and(
          eq(admissions.patientUserId, input.patientUserId),
          eq(admissions.hospitalId, hospitalId),
          inArray(admissions.status, [...OPEN_ADMISSION_STATUSES]),
        ),
      )
      .limit(1);
    const question = line.question.trim();

    const [request] = await tx
      .insert(careRequests)
      .values({
        hospitalId,
        patientUserId: input.patientUserId,
        encounterId: encounter.id,
        admissionId: admission?.id ?? null,
        wardId: line.wardId,
        kind: line.kind,
        targetDepartmentId: line.targetDepartmentId,
        namedUserIds: named,
        urgency: line.urgency,
        helpWanted: line.helpWanted,
        reasonConditionIds: [...new Set(line.reasonConditionIds)],
        questionCiphertext: question ? encrypt(question) : null,
        phonedUserId: phoned?.userId ?? null,
        phonedAt: phoned ? new Date(phoned.at) : null,
        requesterUserId: actor.userId,
        requesterCadre: actor.cadreCode,
        requestedAt: now,
        placementId: input.placementId,
        clientKey: line.clientKey,
        sensitivity: restricted ? "restricted" : "standard",
        // A phoned request counts as accepted (the engine), so an accept clock has no due time.
        dueAt: dueAt(
          {
            kind: line.kind,
            urgency: line.urgency,
            levelSince: now,
            accepted: Boolean(phoned),
            replied: false,
          },
          times,
        ),
      })
      .returning({ id: careRequests.id });
    const id = request!.id;

    const candidates = await loadRouteCandidates(tx, {
      hospitalId,
      departmentId: line.targetDepartmentId,
      kind: line.kind,
      namedUserIds: named,
      requester: {
        userId: actor.userId,
        affiliationId: actor.affiliationId,
        cadreCode: actor.cadreCode,
      },
      wardId: line.wardId,
      at: now,
    });
    const routed = await writeRouting(ctx, id, route(candidates, actor.userId));
    await notifyRecipients(ctx, id, routed, "care_request", place);
    ids.push(id);
  }
  return ids;
}

/* ─── The lifecycle: seen, accept, decline, redirect, reply, close, cancel ─── */

export interface RequestCtx {
  tx: EmrTx;
  actor: EmrActor;
  now: Date;
  request: CareRequestRow;
  events: RequestEvent[];
  derived: DerivedRequest;
  who: Relation;
  /** The department the current round asks: the last redirect's, else the request's. */
  departmentId: string;
}

/** Locks the request (this hospital's) and derives its state and the actor's relation to it. */
async function loadRequest(
  tx: EmrTx,
  actor: EmrActor,
  requestId: string,
  now: Date,
): Promise<RequestCtx> {
  const [request] = await tx
    .select()
    .from(careRequests)
    .where(and(eq(careRequests.id, requestId), eq(careRequests.hospitalId, actor.hospitalId)))
    .for("update");
  if (!request) throw new EmrWriteError("not_found", "Request not found here.");
  const rows = await tx
    .select()
    .from(careRequestEvents)
    .where(eq(careRequestEvents.requestId, requestId));
  const { events, derived, departmentId } = deriveFromRows(request, rows, now);
  return {
    tx,
    actor,
    now,
    request,
    events,
    derived,
    departmentId,
    who: await relationTo(tx, actor, { request, derived, departmentId }, now),
  };
}

/** The actor's relation to a request (the writer's and the reader's one rule): the current round's
 *  recipients, and a live clinical member or the head of the department the round asks. */
export async function relationTo(
  tx: EmrTx | EmrDb,
  actor: { userId: string; hospitalId: string },
  r: {
    request: Pick<CareRequestRow, "requesterUserId">;
    derived: DerivedRequest;
    departmentId: string;
  },
  now: Date,
): Promise<Relation> {
  const { request, derived, departmentId } = r;
  const [team] = await tx
    .select({ one: sql`1` })
    .from(staffAffiliations)
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(
      and(
        eq(staffAffiliations.userId, actor.userId),
        eq(staffAffiliations.hospitalId, actor.hospitalId),
        eq(staffAffiliations.departmentId, departmentId),
        inArray(staffAffiliations.state, [...LIVE]),
        eq(cadres.isClinical, true),
        notPharmacyCadre(),
      ),
    )
    .limit(1);
  const [head] = await tx
    .select({ one: sql`1` })
    .from(departmentHeads)
    .where(
      and(
        eq(departmentHeads.userId, actor.userId),
        eq(departmentHeads.hospitalId, actor.hospitalId),
        eq(departmentHeads.departmentId, departmentId),
        lte(departmentHeads.startsAt, now),
        or(isNull(departmentHeads.endsAt), gt(departmentHeads.endsAt, now)),
      ),
    )
    .limit(1);
  return {
    requester: request.requesterUserId === actor.userId,
    recipient: derived.recipients.includes(actor.userId),
    teamMember: !!team,
    head: !!head,
  };
}

/**
 * One lifecycle act on one request, in one writer transaction with the request row locked. Seen,
 * accept, decline, redirect, close and cancel need no chart basis (reply does: replyToRequest).
 */
export async function withRequestWrite<T>(
  actor: EmrActor,
  requestId: string,
  fn: (c: RequestCtx) => Promise<T>,
  opts?: { database?: EmrDb; now?: Date },
): Promise<T> {
  if (!actor.isClinical) throw new EmrWriteError("forbidden", "Not a clinical role.");
  return asClinicalWriter(
    { userId: actor.userId, hospitalId: actor.hospitalId },
    async (tx) => fn(await loadRequest(tx, actor, requestId, opts?.now ?? new Date())),
    opts?.database,
  );
}

function must(c: RequestCtx, act: RequestAct): void {
  const ok = canAct(c.derived, act, c.who);
  if (ok === true) return;
  const r = CARE_REQUEST_COPY.refusal;
  throw new EmrWriteError(
    ok === r.not_asked || ok === r.requester_only ? "forbidden" : "conflict",
    ok,
  );
}

/** The event this client key already wrote, if any: only the same act by the same person on this
 *  request counts as the replay (R27), never a key alone. */
async function replayedEvent(
  c: RequestCtx,
  clientKey: string,
  kind: RequestEvent["kind"],
): Promise<string | null> {
  const [e] = await c.tx
    .select({
      id: careRequestEvents.id,
      requestId: careRequestEvents.requestId,
      kind: careRequestEvents.kind,
      actorUserId: careRequestEvents.actorUserId,
    })
    .from(careRequestEvents)
    .where(eq(careRequestEvents.clientKey, clientKey));
  if (!e) return null;
  if (e.requestId !== c.request.id || e.kind !== kind || e.actorUserId !== c.actor.userId)
    throw new EmrWriteError("conflict", CARE_REQUEST_COPY.refusal.replay_mismatch);
  return e.id;
}

/** The events of the current round (after the last redirect). */
const roundEvents = (c: RequestCtx) => currentRound(c.events);

async function writeEvent(
  c: RequestCtx,
  e: Omit<typeof careRequestEvents.$inferInsert, "requestId" | "hospitalId" | "at" | "actorUserId">,
): Promise<string> {
  const [row] = await c.tx
    .insert(careRequestEvents)
    .values({
      ...e,
      requestId: c.request.id,
      hospitalId: c.request.hospitalId,
      at: c.now,
      actorUserId: c.actor.userId,
    })
    .returning({ id: careRequestEvents.id });
  return row!.id;
}

/** The place a notice names: the ward, else the department (never the patient, ADR 0199). */
export async function placeOf(
  c: Pick<RequestCtx, "tx" | "request" | "departmentId">,
  departmentId = c.departmentId,
): Promise<string> {
  if (c.request.wardId) {
    const [w] = await c.tx
      .select({ name: hospitalWards.name })
      .from(hospitalWards)
      .where(eq(hospitalWards.id, c.request.wardId));
    if (w) return w.name;
  }
  const [d] = await c.tx
    .select({ name: hospitalDepartments.name })
    .from(hospitalDepartments)
    .where(eq(hospitalDepartments.id, departmentId));
  return d?.name ?? "";
}

const tidy = (note: string | undefined) => (note?.trim() ? encrypt(note.trim()) : null);

/** Idempotent per person per round; only a routed recipient's look counts as seen. */
export async function markSeen(c: RequestCtx): Promise<void> {
  must(c, "seen");
  if (!c.who.recipient) return;
  const already = roundEvents(c).some((e) => e.kind === "seen" && e.actorUserId === c.actor.userId);
  if (!already) await writeEvent(c, { kind: "seen" });
}

export async function acceptRequest(
  c: RequestCtx,
  i: { clientKey: string; expectInMin: 15 | 30 | 60 | null },
): Promise<{ id: string }> {
  const replay = await replayedEvent(c, i.clientKey, "accepted");
  if (replay) return { id: replay };
  must(c, "accept");
  const expectAt = i.expectInMin ? new Date(c.now.getTime() + i.expectInMin * 60_000) : null;
  return { id: await writeEvent(c, { kind: "accepted", expectAt, clientKey: i.clientKey }) };
}

export async function declineRequest(
  c: RequestCtx,
  i: { clientKey: string; reasonCode: DeclineReason; note?: string },
): Promise<{ id: string }> {
  const replay = await replayedEvent(c, i.clientKey, "declined");
  if (replay) return { id: replay };
  must(c, "decline");
  if (roundEvents(c).some((e) => e.kind === "declined" && e.actorUserId === c.actor.userId))
    throw new EmrWriteError("conflict", CARE_REQUEST_COPY.refusal.already_declined);
  const id = await writeEvent(c, {
    kind: "declined",
    reasonCode: i.reasonCode,
    noteCiphertext: tidy(i.note),
    clientKey: i.clientKey,
  });
  await notifyRecipients(
    c,
    c.request.id,
    [c.request.requesterUserId],
    "care_request_update",
    await placeOf(c),
  );
  return { id };
}

/** Requester only, after a decline: a new round, routed afresh to the new department (no named people). */
export async function redirectRequest(
  c: RequestCtx,
  i: { clientKey: string; departmentId: string; reasonCode: RedirectReason; note?: string },
): Promise<{ id: string }> {
  const replay = await replayedEvent(c, i.clientKey, "redirected");
  if (replay) return { id: replay };
  must(c, "redirect");
  const [dept] = await c.tx
    .select({ id: hospitalDepartments.id, pharmacy: isPharmacyDepartment })
    .from(hospitalDepartments)
    .where(
      and(
        eq(hospitalDepartments.id, i.departmentId),
        eq(hospitalDepartments.hospitalId, c.actor.hospitalId),
      ),
    );
  if (!dept) throw new EmrWriteError("invalid", "That department is not at this hospital.");
  if (dept.pharmacy) throw new EmrWriteError("invalid", CARE_REQUEST_COPY.refusal.pharmacy);
  const id = await writeEvent(c, {
    kind: "redirected",
    reasonCode: i.reasonCode,
    noteCiphertext: tidy(i.note),
    redirectDepartmentId: i.departmentId,
    clientKey: i.clientKey,
  });
  const candidates = await loadRouteCandidates(c.tx, {
    hospitalId: c.actor.hospitalId,
    departmentId: i.departmentId,
    kind: c.request.kind as RequestKind,
    namedUserIds: [],
    requester: {
      userId: c.actor.userId,
      affiliationId: c.actor.affiliationId,
      cadreCode: c.actor.cadreCode,
    },
    wardId: c.request.wardId,
    at: c.now,
  });
  const recipients = await writeRouting(c, c.request.id, route(candidates, c.actor.userId));
  await notifyRecipients(
    c,
    c.request.id,
    recipients,
    "care_request",
    await placeOf(c, i.departmentId),
  );
  return { id };
}

/** Requester only, until a reply. The current recipients and the owner are told. */
export async function cancelRequest(
  c: RequestCtx,
  i: { clientKey: string; reasonCode: CancelReason; note?: string },
): Promise<{ id: string }> {
  const replay = await replayedEvent(c, i.clientKey, "cancelled");
  if (replay) return { id: replay };
  must(c, "cancel");
  const id = await writeEvent(c, {
    kind: "cancelled",
    reasonCode: i.reasonCode,
    noteCiphertext: tidy(i.note),
    clientKey: i.clientKey,
  });
  const told = new Set(c.derived.recipients);
  if (c.derived.ownerUserId) told.add(c.derived.ownerUserId);
  await notifyRecipients(c, c.request.id, [...told], "care_request_update", await placeOf(c));
  return { id };
}

/** Requester only, after a reply. */
export async function closeRequest(
  c: RequestCtx,
  i: { clientKey: string },
): Promise<{ id: string }> {
  const replay = await replayedEvent(c, i.clientKey, "closed");
  if (replay) return { id: replay };
  must(c, "close");
  return { id: await writeEvent(c, { kind: "closed", clientKey: i.clientKey }) };
}

/** Who may sign a reply: the clerking cadres plus the allied cadres a consult reaches. */
export const REPLY_CADRES: readonly string[] = [
  ...ORDERING_CADRES,
  "PHYSIOTHERAPIST",
  "NUTRITIONIST",
];

/**
 * The reply is a signed note on the request's encounter, open or not (the patient may have been admitted
 * since): tpl.consult for a consult, tpl.ward_round for a review. The same transaction writes `replied`
 * (naming the note) and, on "No follow-up needed", `closed`. Runs in withPatientWrite: the replier needs
 * chart access, which accepting grants (care_team).
 */
export async function replyToRequest(
  ctx: WriteCtx,
  i: {
    patientUserId: string;
    requestId: string;
    clientKey: string;
    findings?: string;
    assessment: string;
    recommendations: string;
    followUp: boolean;
  },
): Promise<WriteResult & { noteId: string }> {
  requireCadre(ctx, REPLY_CADRES, "reply to a request");
  const c = await loadRequest(ctx.tx, ctx.actor, i.requestId, ctx.now);
  if (c.request.patientUserId !== i.patientUserId)
    throw new EmrWriteError("not_found", "Request not found for this patient.");
  const replay = await replayedEvent(c, i.clientKey, "replied");
  if (replay) {
    const [e] = await ctx.tx
      .select({ noteId: careRequestEvents.noteId })
      .from(careRequestEvents)
      .where(eq(careRequestEvents.id, replay));
    return { id: c.request.id, noteId: e!.noteId! };
  }
  must(c, "reply");
  const text = (t: string | undefined) => (t?.trim() ? { narrative: t.trim() } : undefined);
  const consult = c.request.kind === "consult";
  const sections = Object.fromEntries(
    Object.entries(
      consult
        ? { s01: text(i.findings), s02: text(i.assessment), s03: text(i.recommendations) }
        : { s01: text(i.findings), s03: text(i.assessment), s04: text(i.recommendations) },
    ).filter(([, v]) => v),
  ) as Record<string, { narrative: string }>;
  const noteId = await insertSignedNote(ctx, {
    patientUserId: i.patientUserId,
    encounterId: c.request.encounterId,
    templateId: consult ? "tpl.consult" : "tpl.ward_round",
    content: { sections },
    sensitivity: c.request.sensitivity === "restricted" ? "restricted" : "standard",
    clientKey: `${i.clientKey}:note`,
  });
  await writeEvent(c, { kind: "replied", noteId, clientKey: i.clientKey });
  if (!i.followUp) await writeEvent(c, { kind: "closed", clientKey: `${i.clientKey}:closed` });
  await notifyRecipients(
    c,
    c.request.id,
    [c.request.requesterUserId],
    "care_request_update",
    await placeOf(c),
  );
  return { id: c.request.id, noteId };
}
