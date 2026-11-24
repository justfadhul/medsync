import "server-only";

import type { WriteCtx } from "./context";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { EmrTx } from "@/lib/emr/db";
import type { RequestKind } from "@/lib/requests/engine";
import type { Candidate, RouteCandidates } from "@/lib/requests/routing";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { admissions, OPEN_ADMISSION_STATUSES } from "@/db/schema/admissions";
import { careRequestEvents, careRequests } from "@/db/schema/care-requests";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { clinicalSupervision } from "@/db/schema/doctor-workspace";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { criticalContacts } from "@/db/schema/lab-safety";
import { cadres } from "@/db/schema/reference-data";
import { saNotifications } from "@/db/schema/sa-notifications";
import { departmentHeads } from "@/db/schema/services-hub";
import { JUNIOR_CADRE_CODES, SENIOR_CADRE_CODES } from "@/lib/doctor/cadres";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { route } from "@/lib/requests/routing";
import { EmrWriteError } from "./context";
import { checkReasonConditions, openEncounter, replayed } from "./orders";

/**
 * Placing care requests (ADR 0533): reviews and consults from the Plan. Each line is written once,
 * routed (lib/requests/routing.ts) and its recipients get an in-app notice, all in the caller's
 * transaction; the notices sit in a savepoint so their failure never unplaces the request.
 */

const LIVE = ["active", "approved"] as const;
/** How far back a phone call may be recorded, and how far ahead (clock skew). */
const PHONED_WINDOW_MS = { past: 24 * 60 * 60_000, ahead: 5 * 60_000 };

/** Clinicians with an affiliation here (any state), and whether one of them is live. */
async function cliniciansHere(
  tx: EmrTx,
  hospitalId: string,
  userIds: string[],
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
      ),
    )
    .groupBy(staffAffiliations.userId);
  return new Map(rows.map((r) => [r.userId, r.live]));
}

/**
 * The candidate lists route() walks. Phase 1 has no posts. A review takes senior cadres only on the
 * team list, and a junior's review falls back to their open primary supervisor.
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
          .where(
            and(
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

  const heads = await tx
    .select({
      userId: departmentHeads.userId,
    })
    .from(departmentHeads)
    .where(
      and(
        eq(departmentHeads.hospitalId, q.hospitalId),
        eq(departmentHeads.departmentId, q.departmentId),
        lte(departmentHeads.startsAt, q.at),
        or(isNull(departmentHeads.endsAt), gt(departmentHeads.endsAt, q.at)),
      ),
    )
    .orderBy(asc(departmentHeads.acting), asc(departmentHeads.startsAt));

  const hospitalContacts = await tx
    .select({
      userId: criticalContacts.userId,
    })
    .from(criticalContacts)
    .where(and(eq(criticalContacts.hospitalId, q.hospitalId), eq(criticalContacts.level, 2)))
    .orderBy(asc(criticalContacts.position));

  // Named people, heads and contacts with no live clinical affiliation here are skipped (and recorded).
  const live = await cliniciansHere(tx, q.hospitalId, [
    ...q.namedUserIds,
    ...heads.map((r) => r.userId),
    ...hospitalContacts.map((r) => r.userId),
  ]);
  const checked = (ids: string[]): Candidate[] =>
    ids.map((userId) => ({ userId, active: live.get(userId) ?? false }));
  return {
    named: checked(q.namedUserIds),
    post: [],
    team: team.map((r): Candidate => ({ userId: r.userId, active: true })),
    supervisor,
    heads: checked(heads.map((r) => r.userId)),
    hospitalContacts: checked(hospitalContacts.map((r) => r.userId)),
  };
}

/**
 * In-app notices for a request, in a savepoint: they commit only with the request, and a failure is
 * logged, never thrown. Subjects carry the place, never the patient (ADR 0199).
 */
export async function notifyRecipients(
  ctx: WriteCtx,
  requestId: string,
  userIds: string[],
  kind: "care_request" | "care_request_update",
  place: string,
): Promise<void> {
  if (!userIds.length) return;
  try {
    await ctx.tx.transaction(async (sp) => {
      await sp.insert(saNotifications).values(
        userIds.map((recipientUserId) => ({
          recipientUserId,
          kind,
          subject: CARE_REQUEST_COPY.noticeSubject(kind, place),
          body: CARE_REQUEST_COPY.noticeBody,
          relatedKind: "care_request",
          relatedId: requestId,
          deliveredAt: ctx.now,
        })),
      );
      for (const u of userIds)
        await sp.execute(
          sql`SELECT private.notify_user_event(${u}::uuid, 'request', ${kind}, ${requestId}::uuid)`,
        );
    });
  } catch (e) {
    logger.warn("care_request.notify_failed", { requestId, reason: String(e) });
  }
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
  const ids: string[] = [];

  for (const line of input.lines) {
    const replay = await replayed(tx, careRequests, line.clientKey, input.patientUserId);
    if (replay) {
      ids.push(replay);
      continue;
    }

    const [dept] = await tx
      .select({ name: hospitalDepartments.name })
      .from(hospitalDepartments)
      .where(
        and(
          eq(hospitalDepartments.id, line.targetDepartmentId),
          eq(hospitalDepartments.hospitalId, hospitalId),
        ),
      );
    if (!dept) throw new EmrWriteError("invalid", "That department is not at this hospital.");
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
    const routed = route(candidates, actor.userId);
    const base = {
      requestId: id,
      hospitalId,
      kind: "routed",
      at: now,
      level: 0,
      step: routed.step,
      skippedUserIds: routed.skipped.map((k) => k.userId),
    };
    await tx
      .insert(careRequestEvents)
      .values(
        routed.recipients.length
          ? routed.recipients.map((r) => ({ ...base, recipientUserId: r.userId, postId: r.postId }))
          : [{ ...base, recipientUserId: null, postId: null }],
      );

    await notifyRecipients(
      ctx,
      id,
      routed.recipients.map((r) => r.userId),
      "care_request",
      place,
    );
    ids.push(id);
  }
  return ids;
}
