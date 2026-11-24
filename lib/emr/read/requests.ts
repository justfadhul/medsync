import "server-only";

import type { CareRequestRow } from "@/db/schema/care-requests";
import type { EmrActor } from "@/lib/emr/actor";
import type { EmrDb } from "@/lib/emr/db";
import type {
  DerivedRequest,
  HelpWanted,
  RequestAct,
  RequestEvent,
  RequestKind,
} from "@/lib/requests/engine";
import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { careRequestEvents, careRequests } from "@/db/schema/care-requests";
import { conditions, diagnosisTerms } from "@/db/schema/emr";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { cadres } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { asClinicalReader } from "@/lib/emr/db";
import { identitiesFor } from "@/lib/emr/read/results";
import { notPharmacyDepartment, relationTo } from "@/lib/emr/write/requests";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { canAct } from "@/lib/requests/engine";
import { errorCode, runCareRequestEscalations } from "@/lib/requests/escalation-run";
import { currentRound, deriveFromRows } from "@/lib/requests/rows";

/**
 * Reading care requests (ADR 0537): Asked of you, For your department, Sent by you, and one request.
 * Two parts. The requests and their events come under `asClinicalReader`, so FORCED RLS
 * (private.care_request_visible) decides which exist for the viewer. Names, MRNs, places and the
 * problems' words then come as the owner, only for those requests. A restricted request the viewer has
 * no chart basis for is never named: no patient name, no MRN, no question, no restricted problem.
 * The state is deriveFromRows's, never re-derived here.
 */

type Viewer = Pick<EmrActor, "userId" | "hospitalId" | "departmentId">;
type Opts = {
  database?: EmrDb;
  now?: Date;
  /** false: no patient names or MRNs (the workspace reveals its own rows' names). */
  names?: boolean;
};

export interface RequestRow {
  id: string;
  kind: RequestKind;
  urgency: string;
  helpWanted: HelpWanted | null;
  stateWord: string;
  overdue: boolean;
  patientUserId: string;
  encounterId: string;
  patientName: string | null;
  mrn: string | null;
  wardName: string | null;
  /** The department the current round asks (the last redirect's, else the request's). */
  departmentName: string;
  requesterName: string | null;
  requesterCadre: string;
  questionFirstLine: string | null;
  askedAtMs: number;
  /** Asked of the viewer: a current-round recipient who has not declined, or the accepter. */
  mine: boolean;
  /** Someone has accepted it (or was phoned): nothing left for the department to pick up. */
  claimed: boolean;
  restricted: boolean;
  /** The viewer has a chart basis for the patient. Restricted without it: no name, MRN or question. */
  chart: boolean;
}

export interface RequestDetail extends RequestRow {
  /** The department the current round asks: Redirect leaves it out by id (names are not unique). */
  departmentId: string;
  question: string | null;
  problems: string[];
  history: { atMs: number; words: string }[];
  canAct: Record<RequestAct, true | string>;
  canOpenChart: boolean;
}

/** Never more rows than a list can show. shortcut: the newest 300 per list; page when a team passes it. */
const ROW_CAP = 300;
const SENT_WINDOW_MS = 7 * 24 * 60 * 60_000;
const URGENCY_RANK: Record<string, number> = { now: 0, urgent_today: 1, within_1h: 2, routine: 3 };
const ACTS: readonly RequestAct[] = [
  "seen",
  "accept",
  "decline",
  "redirect",
  "reply",
  "close",
  "cancel",
];

interface Loaded {
  request: CareRequestRow;
  events: RequestEvent[];
  derived: DerivedRequest;
  departmentId: string;
  /** The viewer has a chart basis for the patient (accessible_patient_ids, as the reader). */
  chart: boolean;
}

const appDb = async (database?: EmrDb): Promise<EmrDb> =>
  database ?? ((await import("@/db")).db as unknown as EmrDb);

const safeDecrypt = (c: string | null | undefined) => {
  if (!c) return null;
  try {
    return decrypt(c);
  } catch {
    return null;
  }
};

const isOpen = (d: DerivedRequest) =>
  d.state !== "replied" && d.state !== "closed" && d.state !== "cancelled";
const hidden = (l: Loaded) => l.request.sensitivity !== "standard" && !l.chart;

/** No reply, close or cancel yet: keeps finished requests from crowding the row cap. */
const openSql = sql`NOT EXISTS (SELECT 1 FROM ${careRequestEvents} e WHERE e.request_id = ${careRequests.id}
  AND e.kind IN ('replied','closed','cancelled'))`;

const declinedByViewer = (l: Loaded, me: string) =>
  currentRound(l.events).some((e) => e.kind === "declined" && e.actorUserId === me);

/** Asked of me: a current-round recipient who has not declined in it, or the one who accepted. */
function askedOf(l: Loaded, me: string): boolean {
  const d = l.derived;
  if (d.state === "accepted") return d.ownerUserId === me;
  if (d.state !== "sent" && d.state !== "seen") return false;
  return d.recipients.includes(me) && !declinedByViewer(l, me);
}

/** Overdue first, then urgency (now, urgent today, within 1 h, routine), then the oldest. */
export function askedOrder(a: RequestRow, b: RequestRow): number {
  return (
    Number(b.overdue) - Number(a.overdue) ||
    (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9) ||
    a.askedAtMs - b.askedAtMs
  );
}

/** The requests RLS lets the viewer read that match `where`, with their events, derived. */
async function visible(viewer: Viewer, where: SQL | undefined, opts: Opts): Promise<Loaded[]> {
  const now = opts.now ?? new Date();
  return asClinicalReader(
    { userId: viewer.userId, hospitalId: viewer.hospitalId },
    async (tx) => {
      const rows = await tx
        .select({
          request: careRequests,
          chart: sql<boolean>`${careRequests.patientUserId} IN (SELECT private.accessible_patient_ids())`,
        })
        .from(careRequests)
        .where(and(eq(careRequests.hospitalId, viewer.hospitalId), where))
        .orderBy(desc(careRequests.requestedAt))
        .limit(ROW_CAP);
      const events = rows.length
        ? await tx
            .select()
            .from(careRequestEvents)
            .where(
              inArray(
                careRequestEvents.requestId,
                rows.map((r) => r.request.id),
              ),
            )
        : [];
      return rows.map(({ request, chart }) => ({
        request,
        chart: !!chart,
        ...deriveFromRows(
          request,
          events.filter((e) => e.requestId === request.id),
          now,
        ),
      }));
    },
    opts.database,
  );
}

/** The list rows: places and staff names as the owner, patient names only where allowed. */
async function rowsOf(viewer: Viewer, loaded: Loaded[], opts: Opts): Promise<RequestRow[]> {
  if (!loaded.length) return [];
  const db = await appDb(opts.database);
  const ids = (pick: (l: Loaded) => string | null) => [
    ...new Set(loaded.map(pick).filter((x): x is string => !!x)),
  ];
  const deptIds = ids((l) => l.departmentId);
  const wardIds = ids((l) => l.request.wardId);
  const shown =
    opts.names === false ? [] : ids((l) => (hidden(l) ? null : l.request.patientUserId));
  const [depts, wards, people, cadreRows, who] = await Promise.all([
    db
      .select({ id: hospitalDepartments.id, name: hospitalDepartments.name })
      .from(hospitalDepartments)
      .where(inArray(hospitalDepartments.id, deptIds)),
    wardIds.length
      ? db
          .select({ id: hospitalWards.id, name: hospitalWards.name })
          .from(hospitalWards)
          .where(inArray(hospitalWards.id, wardIds))
      : [],
    db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(
        inArray(
          users.id,
          ids((l) => l.request.requesterUserId),
        ),
      ),
    db
      .select({ code: cadres.code, name: cadres.name })
      .from(cadres)
      .where(
        inArray(
          cadres.code,
          ids((l) => l.request.requesterCadre),
        ),
      ),
    identitiesFor(viewer, shown, "doctor_requests", db),
  ]);
  const dept = new Map(depts.map((d) => [d.id, d.name]));
  const ward = new Map(wards.map((w) => [w.id, w.name]));
  const person = new Map(people.map((p) => [p.id, p.name]));
  const cadre = new Map(cadreRows.map((c) => [c.code, c.name]));
  return loaded.map((l): RequestRow => {
    const r = l.request;
    const secret = hidden(l);
    return {
      id: r.id,
      kind: r.kind as RequestKind,
      urgency: r.urgency,
      helpWanted: r.helpWanted as HelpWanted | null,
      stateWord: CARE_REQUEST_COPY.state[l.derived.state],
      overdue: l.derived.overdue,
      patientUserId: r.patientUserId,
      encounterId: r.encounterId,
      patientName: secret ? null : (who.get(r.patientUserId)?.name ?? null),
      mrn: secret ? null : (who.get(r.patientUserId)?.mrn ?? null),
      wardName: r.wardId ? (ward.get(r.wardId) ?? null) : null,
      departmentName: dept.get(l.departmentId) ?? "",
      requesterName: person.get(r.requesterUserId) ?? null,
      requesterCadre: cadre.get(r.requesterCadre) ?? r.requesterCadre,
      questionFirstLine: secret
        ? null
        : (safeDecrypt(r.questionCiphertext)?.split("\n")[0]?.trim() ?? null) || null,
      askedAtMs: r.requestedAt.getTime(),
      mine: askedOf(l, viewer.userId),
      claimed: l.derived.state === "accepted",
      restricted: r.sensitivity !== "standard",
      chart: l.chart,
    };
  });
}

/** The lazy run (ADR 0536): what is due for the viewer's hospital escalates before a list is read. It
 *  writes no heartbeat, and a failure is logged by name, never breaks the read. */
async function escalateLazily(viewer: Viewer, opts: Opts): Promise<void> {
  try {
    await runCareRequestEscalations(await appDb(opts.database), {
      now: opts.now ?? new Date(),
      source: "lazy",
      hospitalId: viewer.hospitalId,
    });
  } catch (e) {
    logger.error("care_request.lazy_escalation_failed", {
      reason: e instanceof Error ? e.name : "unknown",
      code: errorCode(e),
    });
  }
}

/** Open requests asked of me, by user id: whatever department my scope picked today. */
export async function askedOfMe(viewer: Viewer, opts: Opts = {}): Promise<RequestRow[]> {
  await escalateLazily(viewer, opts);
  const loaded = await visible(
    viewer,
    and(
      openSql,
      or(
        eq(careRequests.phonedUserId, viewer.userId),
        sql`EXISTS (SELECT 1 FROM ${careRequestEvents} e WHERE e.request_id = ${careRequests.id}
              AND ${viewer.userId}::uuid IN (e.recipient_user_id, e.actor_user_id))`,
      ),
    ),
    opts,
  );
  const mine = loaded.filter((l) => askedOf(l, viewer.userId));
  return (await rowsOf(viewer, mine, opts)).sort(askedOrder);
}

/** Open requests the department the viewer is working in is asked (D6), unclaimed first. */
export async function forMyDepartment(viewer: Viewer, opts: Opts = {}): Promise<RequestRow[]> {
  const dept = viewer.departmentId;
  if (!dept) return [];
  await escalateLazily(viewer, opts);
  const loaded = await visible(
    viewer,
    and(
      openSql,
      or(
        eq(careRequests.targetDepartmentId, dept),
        sql`EXISTS (SELECT 1 FROM ${careRequestEvents} e WHERE e.request_id = ${careRequests.id}
              AND e.kind = 'redirected' AND e.redirect_department_id = ${dept}::uuid)`,
      ),
    ),
    opts,
  );
  const open = loaded.filter(
    (l) =>
      l.departmentId === dept &&
      l.request.requesterUserId !== viewer.userId &&
      isOpen(l.derived) &&
      l.derived.state !== "declined",
  );
  return (await rowsOf(viewer, open, opts)).sort(
    (a, b) => Number(a.claimed) - Number(b.claimed) || askedOrder(a, b),
  );
}

/** My requests: the open ones first, then those replied in the last 7 days; newest first in each. */
export async function sentByMe(viewer: Viewer, opts: Opts = {}): Promise<RequestRow[]> {
  await escalateLazily(viewer, opts);
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - SENT_WINDOW_MS).toISOString();
  const loaded = await visible(
    viewer,
    and(
      eq(careRequests.requesterUserId, viewer.userId),
      sql`NOT EXISTS (SELECT 1 FROM ${careRequestEvents} e WHERE e.request_id = ${careRequests.id}
            AND (e.kind = 'cancelled' OR (e.kind = 'replied' AND e.at < ${since}::timestamptz)))`,
    ),
    opts,
  );
  const keep = loaded.filter(
    (l) =>
      isOpen(l.derived) ||
      (!!l.derived.repliedAt &&
        l.derived.state !== "cancelled" &&
        now.getTime() - l.derived.repliedAt.getTime() <= SENT_WINDOW_MS),
  );
  const openIds = new Set(keep.filter((l) => isOpen(l.derived)).map((l) => l.request.id));
  const open = (r: RequestRow) => Number(!openIds.has(r.id));
  return (await rowsOf(viewer, keep, opts)).sort(
    (a, b) => open(a) - open(b) || b.askedAtMs - a.askedAtMs,
  );
}

/** One request the viewer may read, with its question, problems, history in words and what they may do. */
export async function requestDetail(
  viewer: Viewer,
  requestId: string,
  opts: Opts = {},
): Promise<RequestDetail | null> {
  const now = opts.now ?? new Date();
  const [l] = await visible(viewer, eq(careRequests.id, requestId), opts);
  if (!l) return null;
  const db = await appDb(opts.database);
  const r = l.request;
  const secret = hidden(l);
  const actorIds = l.events.flatMap((e) => [e.actorUserId, e.recipientUserId]);
  const staffIds = [...new Set(actorIds.filter((x): x is string => !!x))];
  const [[row], problems, people, who, redirects] = await Promise.all([
    rowsOf(viewer, [l], opts),
    r.reasonConditionIds.length
      ? db
          .select({
            id: conditions.id,
            sensitivity: conditions.sensitivity,
            text: conditions.textCiphertext,
            term: diagnosisTerms.display,
          })
          .from(conditions)
          .leftJoin(diagnosisTerms, eq(diagnosisTerms.id, conditions.termId))
          .where(
            and(
              eq(conditions.hospitalId, r.hospitalId),
              eq(conditions.patientUserId, r.patientUserId),
              inArray(conditions.id, r.reasonConditionIds),
            ),
          )
      : [],
    staffIds.length
      ? db
          .select({ id: users.id, name: users.fullName })
          .from(users)
          .where(inArray(users.id, staffIds))
      : [],
    relationTo(db, viewer, l, now),
    db
      .select({ at: careRequestEvents.at, to: hospitalDepartments.name })
      .from(careRequestEvents)
      .innerJoin(
        hospitalDepartments,
        eq(hospitalDepartments.id, careRequestEvents.redirectDepartmentId),
      )
      .where(and(eq(careRequestEvents.requestId, r.id), eq(careRequestEvents.kind, "redirected"))),
  ]);
  const copy = CARE_REQUEST_COPY.read;
  const name = new Map(people.map((p) => [p.id, p.name]));
  const nameOf = (id: string | null) => (id && name.get(id)) || copy.someone;
  const redirectTo = (at: Date) => redirects.find((x) => x.at.getTime() === at.getTime())?.to ?? "";
  const reason = (table: Record<string, string>, code: string | null) =>
    (code && table[code]) || code || "";

  const history: RequestDetail["history"] = [];
  for (const e of l.events) {
    const atMs = e.at.getTime();
    const ev = copy.event;
    if (e.kind === "routed") {
      if (!e.recipientUserId) {
        history.push({ atMs, words: ev.unrouted });
        continue;
      }
      // One routing writes one row per person: one line names them all.
      const last = history.at(-1);
      const prev = l.events[l.events.indexOf(e) - 1];
      if (last && prev?.kind === "routed" && prev.recipientUserId && prev.at.getTime() === atMs)
        last.words = `${last.words}, ${nameOf(e.recipientUserId)}`;
      else history.push({ atMs, words: ev.routed(nameOf(e.recipientUserId)) });
      continue;
    }
    const by = nameOf(e.actorUserId);
    const words = {
      seen: () => ev.seen(by),
      accepted: () => ev.accepted(by),
      declined: () => ev.declined(by, reason(CARE_REQUEST_COPY.DECLINE_REASONS, e.reasonCode)),
      redirected: () =>
        ev.redirected(redirectTo(e.at), reason(CARE_REQUEST_COPY.REDIRECT_REASONS, e.reasonCode)),
      replied: () => ev.replied(by),
      closed: () => ev.closed(by),
      cancelled: () => ev.cancelled(by, reason(CARE_REQUEST_COPY.CANCEL_REASONS, e.reasonCode)),
      escalated: () => ev.escalated(e.level),
    }[e.kind]();
    history.push({ atMs, words });
  }

  return {
    ...row!,
    departmentId: l.departmentId,
    question: secret ? null : safeDecrypt(r.questionCiphertext),
    problems: problems.map((p) =>
      p.sensitivity !== "standard" && !l.chart
        ? copy.restrictedProblem
        : (p.term ?? safeDecrypt(p.text) ?? copy.problem),
    ),
    history,
    canAct: {
      ...(Object.fromEntries(ACTS.map((a) => [a, canAct(l.derived, a, who)])) as Record<
        RequestAct,
        true | string
      >),
      // The writer refuses a second decline in one round (R27): never offer it.
      ...(declinedByViewer(l, viewer.userId)
        ? { decline: CARE_REQUEST_COPY.refusal.already_declined }
        : {}),
    },
    canOpenChart: l.chart,
  };
}

/** The hospital's clinical teams, for Redirect: names only, never the pharmacy (R32). */
export async function redirectDepartments(
  hospitalId: string,
  database?: EmrDb,
): Promise<{ id: string; name: string }[]> {
  const db = await appDb(database);
  return db
    .select({ id: hospitalDepartments.id, name: hospitalDepartments.name })
    .from(hospitalDepartments)
    .where(
      and(
        eq(hospitalDepartments.hospitalId, hospitalId),
        eq(hospitalDepartments.kind, "clinical"),
        isNull(hospitalDepartments.archivedAt),
        notPharmacyDepartment,
      ),
    )
    .orderBy(asc(hospitalDepartments.name));
}

/** The request page (ADR 0537): the three lists, and the request `?request=` names when the viewer may read it. */
export async function requestsPageData(viewer: Viewer, requestId: unknown, opts: Opts = {}) {
  const id = z.uuid().safeParse(requestId);
  const [asked, department, sent, detail] = await Promise.all([
    askedOfMe(viewer, opts),
    forMyDepartment(viewer, opts),
    sentByMe(viewer, opts),
    id.success ? requestDetail(viewer, id.data, opts) : null,
  ]);
  const departments =
    detail?.canAct.redirect === true
      ? await redirectDepartments(viewer.hospitalId, opts.database)
      : [];
  return { asked, department, sent, detail, departments };
}
