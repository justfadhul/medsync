import "server-only";

import type { CodedWord } from "@/content/pharmacy-prescriber";
import type { EmrActor, EmrSurface } from "@/lib/emr/actor";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type { PrescriptionLane } from "@/lib/pharmacy/lanes";
import type { LineInput, LineStatus, PharmacyLineEvent, QueryLite } from "@/lib/pharmacy/lines";
import type { Answer, QueryEvent } from "@/lib/pharmacy/review/queries";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import {
  ANSWER_LABEL,
  PRESCRIBER_PHARMACY_COPY as COPY,
  DRAFT_KEEP_REASONS,
  DRAFT_NOT_SUPPLIED_REASONS,
  DRAFT_QUERY_TYPES,
  STOP_REASONS,
} from "@/content/pharmacy-prescriber";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { clinicalCosignRequests } from "@/db/schema/doctor-workspace";
import { pharmacyDispensingPoints } from "@/db/schema/pharmacy";
import {
  pharmacyLineEvents,
  pharmacyNoticeAcknowledgements,
  pharmacyQueries,
  pharmacyQueryEvents,
  pharmacySignedSets,
  prescriptionCancellations,
} from "@/db/schema/pharmacy-dispensing";
import { prescriptions } from "@/db/schema/prescribing";
import { cadres } from "@/db/schema/reference-data";
import { asClinicalReader, asClinicalWriter } from "@/lib/emr/db";
import { lineStatus, queryState } from "@/lib/pharmacy/lines";
import { printTime } from "@/lib/pharmacy/print/label";
import { notSuppliedNotice, QUERY_COPY } from "@/lib/pharmacy/review/queries";

/**
 * What the prescriber reads of the pharmacy (Pharmacy Phase 1, 5.4, RQ-2..RQ-8, RQ-11; PA2-5): the
 * patient's queries, the phone answers logged in their name, the not-supplied notices and each line's
 * stage, for the problem card and the plan step. The clinical record is read under RLS as the
 * clinician (0125's prescriber policies: same hospital, may prescribe here, may see the patient);
 * the registries (point phone, signed lists, cadre names) as the owner. Nothing here touches stock:
 * no batch, movement or product table is imported (AV-6, PA2-5; a test holds that).
 *
 * A not-supplied notice (RQ-11) is the pharmacy's own outcome on the line (`owed`, `buying_outside`
 * or `declined` in pharmacy_line_events, with its reason and what the patient was told), nudged to
 * the prescriber on `user:<id>`. It needs no answer and shows until the line closes (5.4) or the
 * prescriber acknowledges it: "Leave it as it is" or "Choose an alternative" writes one
 * pharmacy_notice_acknowledgements row for the line event (0132), whether or not a query covers it.
 */

export const NOT_SUPPLIED_KINDS: ReadonlySet<string> = new Set([
  "owed",
  "buying_outside",
  "declined",
]);
const WITHHELD = new Set(["returned", "cancelled", "expired"]);

/* ─── The record, as rows ─────────────────────────────────────────── */

export interface LineRow {
  id: string;
  encounterId: string | null;
  placementId: string | null;
  drugId: string;
  drugName: string;
  dose: string;
  route: string;
  frequency: string | null;
  duration: string | null;
  conditionId: string | null;
  state: LineInput["state"];
  createdAt: Date;
  updatedAt: Date;
}

export interface QueryEventRow {
  id: string;
  kind: QueryEvent["kind"];
  at: Date;
  answer: Answer | null;
  via: "app" | "phone" | null;
  answerReasonCode: string | null;
  answeredByUserId: string | null;
  recipientUserId: string | null;
  recipientRole: string | null;
  replacedBy: string | null;
  actorUserId: string;
  clientKey: string | null;
}

export interface QueryRow {
  id: string;
  scope: "line" | "prescription";
  prescriptionId: string;
  placementId: string | null;
  typeCode: string;
  proposal: string;
  patientWaiting: boolean;
  dispensingPointId: string;
  senderCadre: string | null;
  createdAt: Date;
  events: QueryEventRow[];
}

export type LineEventRow = PharmacyLineEvent & {
  patientTold: string | null;
  pointId: string | null;
};

export interface PatientPharmacy {
  queries: QueryRow[];
  lines: Map<string, LineRow>;
  lineEvents: Map<string, LineEventRow[]>;
  cancellations: Map<
    string,
    { replacedBy: string | null; reasonCode: string; queryId: string | null }
  >;
  cosign: Map<string, { cosign: LineInput["cosign"]; cosignedAt: Date | null }>;
  /** RQ-11: line events whose not-supplied notice the prescriber acknowledged (0132). */
  acknowledged: Set<string>;
}

/**
 * The patient's queries at this hospital, every line they cover and every line the pharmacy did not
 * supply, with each line's events, cancellation and co-sign. Works in either transaction: under RLS (the read) or as the owner after
 * the access check (the store); the WHERE clauses name the hospital and patient either way.
 */
export async function loadPatientPharmacy(
  tx: EmrTx,
  p: {
    hospitalId: string;
    patientUserId: string;
    queryIds?: readonly string[];
    /** Lines read whatever their record (the one Prescribe's "already prescribed"). */
    lineIds?: readonly string[];
  },
): Promise<PatientPharmacy> {
  const qRows = await tx
    .select()
    .from(pharmacyQueries)
    .where(
      and(
        eq(pharmacyQueries.hospitalId, p.hospitalId),
        eq(pharmacyQueries.patientUserId, p.patientUserId),
        p.queryIds ? inArray(pharmacyQueries.id, [...p.queryIds]) : undefined,
      ),
    )
    .orderBy(asc(pharmacyQueries.createdAt));
  const notSupplied = p.queryIds
    ? []
    : await tx
        .selectDistinct({ id: pharmacyLineEvents.prescriptionId })
        .from(pharmacyLineEvents)
        .where(
          and(
            eq(pharmacyLineEvents.hospitalId, p.hospitalId),
            eq(pharmacyLineEvents.patientUserId, p.patientUserId),
            inArray(pharmacyLineEvents.kind, [...NOT_SUPPLIED_KINDS]),
          ),
        );
  const lineIds = [
    ...new Set([
      ...qRows.map((q) => q.prescriptionId),
      ...notSupplied.map((n) => n.id),
      ...(p.lineIds ?? []),
    ]),
  ];
  if (!lineIds.length)
    return {
      queries: [],
      lines: new Map(),
      lineEvents: new Map(),
      cancellations: new Map(),
      cosign: new Map(),
      acknowledged: new Set(),
    };

  const eRows = qRows.length
    ? await tx
        .select()
        .from(pharmacyQueryEvents)
        .where(
          inArray(
            pharmacyQueryEvents.queryId,
            qRows.map((q) => q.id),
          ),
        )
        .orderBy(asc(pharmacyQueryEvents.occurredAt))
    : [];
  const placements = [
    ...new Set(
      qRows.flatMap((q) => (q.scope === "prescription" && q.placementId ? [q.placementId] : [])),
    ),
  ];
  const lineRows = await tx
    .select({
      id: prescriptions.id,
      encounterId: prescriptions.encounterId,
      placementId: prescriptions.placementId,
      drugId: prescriptions.drugId,
      drugName: prescriptions.drugName,
      dose: prescriptions.dose,
      route: prescriptions.route,
      frequency: prescriptions.frequency,
      duration: prescriptions.duration,
      conditionId: prescriptions.conditionId,
      state: prescriptions.state,
      createdAt: prescriptions.createdAt,
      updatedAt: prescriptions.updatedAt,
    })
    .from(prescriptions)
    .where(
      and(
        eq(prescriptions.hospitalId, p.hospitalId),
        eq(prescriptions.patientUserId, p.patientUserId),
        placements.length
          ? or(inArray(prescriptions.id, lineIds), inArray(prescriptions.placementId, placements))
          : inArray(prescriptions.id, lineIds),
      ),
    );
  const ids = lineRows.map((l) => l.id);
  const [leRows, cRows, csRows, ackRows] = ids.length
    ? await Promise.all([
        tx
          .select()
          .from(pharmacyLineEvents)
          .where(inArray(pharmacyLineEvents.prescriptionId, ids))
          .orderBy(asc(pharmacyLineEvents.occurredAt)),
        tx
          .select()
          .from(prescriptionCancellations)
          .where(inArray(prescriptionCancellations.prescriptionId, ids)),
        tx
          .select({
            payload: clinicalCosignRequests.actionPayload,
            state: clinicalCosignRequests.state,
            reviewedAt: clinicalCosignRequests.reviewedAt,
          })
          .from(clinicalCosignRequests)
          .where(
            and(
              eq(clinicalCosignRequests.patientUserId, p.patientUserId),
              inArray(clinicalCosignRequests.actionKind, [
                "prescription_routine",
                "prescription_controlled",
              ]),
            ),
          ),
        tx
          .select({ id: pharmacyNoticeAcknowledgements.lineEventId })
          .from(pharmacyNoticeAcknowledgements)
          .where(
            and(
              eq(pharmacyNoticeAcknowledgements.hospitalId, p.hospitalId),
              eq(pharmacyNoticeAcknowledgements.patientUserId, p.patientUserId),
            ),
          ),
      ])
    : [[], [], [], []];

  const lineEvents = new Map<string, LineEventRow[]>();
  for (const e of leRows) {
    const list = lineEvents.get(e.prescriptionId) ?? [];
    list.push({
      id: e.id,
      kind: e.kind as PharmacyLineEvent["kind"],
      occurredAt: e.occurredAt,
      effectiveAt: e.effectiveAt,
      lane: e.lane,
      quantitySupplied: e.quantitySupplied,
      quantityNotSupplied: e.quantityNotSupplied,
      reasonCode: e.reasonCode,
      handoverId: e.handoverId,
      actorCadre: e.actorCadre,
      // ponytail: a back-entered hand-over (DT-3) is read from pharmacy_handovers, which the prescriber
      // may not read; the prescriber's fold treats it as live. Only the stage word can differ.
      patientTold: e.patientTold,
      pointId: e.dispensingPointId,
    });
    lineEvents.set(e.prescriptionId, list);
  }
  const cosign = new Map<string, { cosign: LineInput["cosign"]; cosignedAt: Date | null }>();
  for (const r of csRows) {
    const id = (r.payload as { prescriptionId?: string }).prescriptionId;
    if (!id || !ids.includes(id)) continue;
    cosign.set(id, {
      cosign:
        r.state === "pending_review" ? "awaiting" : WITHHELD.has(r.state) ? "withheld" : "signed",
      cosignedAt: r.reviewedAt,
    });
  }
  return {
    queries: qRows.map((q) => ({
      id: q.id,
      scope: q.scope,
      prescriptionId: q.prescriptionId,
      placementId: q.placementId,
      typeCode: q.typeCode,
      proposal: q.proposal,
      patientWaiting: q.patientWaiting,
      dispensingPointId: q.dispensingPointId,
      senderCadre: q.senderCadre,
      createdAt: q.createdAt,
      events: eRows
        .filter((e) => e.queryId === q.id)
        .map((e) => ({
          id: e.id,
          kind: e.kind as QueryEvent["kind"],
          at: e.occurredAt,
          answer: e.answer,
          via: e.via,
          answerReasonCode: e.answerReasonCode,
          answeredByUserId: e.answeredByUserId,
          recipientUserId: e.recipientUserId,
          recipientRole: e.recipientRole,
          replacedBy: e.replacedByPrescriptionId,
          actorUserId: e.actorUserId,
          clientKey: e.clientKey,
        })),
    })),
    lines: new Map(lineRows.map((l) => [l.id, { ...l, state: l.state as LineInput["state"] }])),
    lineEvents,
    cancellations: new Map(
      cRows.map((c) => [
        c.prescriptionId,
        { replacedBy: c.replacedByPrescriptionId, reasonCode: c.reasonCode, queryId: c.queryId },
      ]),
    ),
    cosign,
    acknowledged: new Set(ackRows.map((a) => a.id)),
  };
}

/* ─── Pure projections ────────────────────────────────────────────── */

/** RQ-5: one line, or every line of the prescription that existed when the query was sent. */
export function coveredLineIds(q: QueryRow, lines: ReadonlyMap<string, LineRow>): string[] {
  if (q.scope === "line" || !q.placementId)
    return lines.has(q.prescriptionId) ? [q.prescriptionId] : [];
  return [...lines.values()]
    .filter(
      (l) => l.placementId === q.placementId && l.createdAt.getTime() <= q.createdAt.getTime(),
    )
    .map((l) => l.id);
}

/** The queries as lines.ts folds them. */
export function queryLites(data: PatientPharmacy): QueryLite[] {
  return data.queries.map((q) => ({
    id: q.id,
    scope: q.scope,
    lineIds: coveredLineIds(q, data.lines),
    sentAt: q.createdAt,
    events: q.events.map((e) => ({ kind: e.kind, at: e.at, answer: e.answer })),
  }));
}

/** RQ-11: the line's not-supplied outcome while it stands (the latest event, still the status). */
export function notSuppliedOutcome(data: PatientPharmacy, lineId: string): LineEventRow | null {
  const l = data.lines.get(lineId);
  const outcome = [...(data.lineEvents.get(lineId) ?? [])]
    .reverse()
    .find((e) => NOT_SUPPLIED_KINDS.has(e.kind));
  if (!l || l.state !== "active" || !outcome) return null;
  const s = statusOf(data, lineId);
  const now = s?.kind === "open" ? s.outcome : s?.kind === "closed" ? s.outcome : null;
  return now === outcome.kind ? outcome : null;
}

/** LO-1: the line's stage or outcome, folded from its stored record (lines.lineStatus). */
export function statusOf(data: PatientPharmacy, lineId: string): LineStatus | null {
  const l = data.lines.get(lineId);
  if (!l) return null;
  const events = data.lineEvents.get(lineId) ?? [];
  const lane: PrescriptionLane =
    [...events].reverse().find((e) => e.lane)?.lane ?? "pharmacist_first"; // LN-4: no rule, pharmacist-first
  const cs = data.cosign.get(lineId);
  const cancel = data.cancellations.get(lineId);
  return lineStatus(
    {
      id: l.id,
      state: l.state,
      cosign: cs?.cosign ?? "none",
      createdAt: l.createdAt,
      cosignedAt: cs?.cosignedAt ?? null,
      stateChangedAt: l.state === "active" ? null : l.updatedAt,
      cancellation: cancel
        ? { replacedBy: cancel.replacedBy, reasonCode: cancel.reasonCode }
        : null,
    },
    events,
    queryLites(data),
    lane,
  );
}

/** RQ-6: the answered event that stands, with who gave it, or null (a dispute reopens). */
export function standingEvent(q: Pick<QueryRow, "events">): QueryEventRow | null {
  let current: QueryEventRow | null = null;
  for (const e of q.events) {
    if (e.kind === "answered") current = e;
    else if (e.kind === "disputed") current = null;
  }
  return current;
}

/* ─── Signed lists (pharmacy_signed_sets, D-PH1-43), read as the owner ─── */

const SetContent = z.object({
  items: z.array(z.object({ code: z.string().min(2).max(60), words: z.string().min(1).max(200) })),
});

/**
 * The hospital's signed list of a kind, or the drafted one. Law 8: an unsigned list never acts in
 * production, so there the draft is withheld (`items: []`); outside production it acts, labelled.
 */
export async function signedList(
  tx: EmrTx,
  hospitalId: string,
  kind: "keep_reasons" | "query_codes" | "outcome_reasons",
  draft: readonly CodedWord[],
): Promise<{ items: readonly CodedWord[]; signed: boolean }> {
  const [row] = await tx
    .select({ content: pharmacySignedSets.content })
    .from(pharmacySignedSets)
    .where(
      and(
        eq(pharmacySignedSets.hospitalId, hospitalId),
        eq(pharmacySignedSets.kind, kind),
        eq(pharmacySignedSets.status, "signed"),
      ),
    )
    .limit(1);
  const parsed = row ? SetContent.safeParse(row.content) : null;
  if (parsed?.success) return { items: parsed.data.items, signed: true };
  return { items: process.env.VERCEL_ENV === "production" ? [] : draft, signed: false };
}

/* ─── The prescriber's view ───────────────────────────────────────── */

export interface PharmacyLineRef {
  id: string;
  drugId: string;
  conditionId: string | null;
  /** As written (Law 7): the stored fields, unchanged. */
  words: string;
  standing: boolean;
  /** Replaced under this query (a whole-prescription query's "changed" so far). */
  changed: boolean;
}

interface ItemBase {
  id: string;
  lines: PharmacyLineRef[];
  /** Any line it covers was prescribed at this visit. */
  thisVisit: boolean;
  /** The dispensing point's phone (W1); null when none is set, and "Call the pharmacy" is absent. */
  phone: string | null;
}

export interface PharmacyQueryItem extends ItemBase {
  kind: "query";
  scope: "line" | "prescription";
  typeCode: string;
  /** B-26, filled. */
  words: string;
  patientWaiting: boolean;
  state: "open" | "answered" | "withdrawn" | "not_sent";
  /** Minutes since sent, by the server's clock (Law 13). */
  waitingMin: number;
  /** "Answered by {cadre} at {time}: {answer}." or the withdrawn words; null while open. */
  outcome: string | null;
  /** B-25's time, when the standing answer is a phone answer logged in the viewer's name. */
  phoneAnswerAt: string | null;
  seen: boolean;
}

export interface PharmacyNoticeItem extends ItemBase {
  /** The line event's id. */
  kind: "not_supplied";
  /** B-27, filled. */
  words: string;
  /** "Leave it as it is" is offered. Every notice shown is unacknowledged, and RLS shows notices only
   *  to a clinician who may prescribe here for this patient (0125), so this is true for every one. */
  canAcknowledge: boolean;
}

export type PharmacyItem = PharmacyQueryItem | PharmacyNoticeItem;

export interface PrescriberPharmacyView {
  surface: EmrSurface;
  viewerUserId: string;
  patientUserId: string;
  items: PharmacyItem[];
  /** X-5: open queries and notices not yet acknowledged. */
  count: number;
  keepReasons: readonly CodedWord[];
  keepSigned: boolean;
  stopReasons: readonly CodedWord[];
  /** The newest open query, said once in a polite live region (Section 10). */
  announce: { id: string; text: string } | null;
  /** LO-1 per line covered, for the card. */
  lineStatus: Record<string, LineStatus>;
}

const fill = (s: string, v: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
const wordOf = (list: readonly CodedWord[], code: string | null | undefined) =>
  (code && list.find((c) => c.code === code)?.words) || code || "";
const asWritten = (l: LineRow) =>
  [l.drugName, l.dose, l.route, l.frequency, l.duration].filter(Boolean).join(", ");

export interface ViewWords {
  cadreName: (code: string | null) => string;
  answererCadre: (userId: string | null) => string;
  phone: (pointId: string) => string | null;
  queryTypes: readonly CodedWord[];
  outcomeReasons: readonly CodedWord[];
}

/** The view from the record: pure, so the unit lane can drive it. */
export function buildView(
  data: PatientPharmacy,
  ctx: {
    surface: EmrSurface;
    viewerUserId: string;
    patientUserId: string;
    encounterId: string;
    now: Date;
    words: ViewWords;
    keep: { items: readonly CodedWord[]; signed: boolean };
  },
): PrescriberPharmacyView {
  const items: PharmacyItem[] = [];
  const lineStatus: Record<string, LineStatus> = {};
  for (const q of data.queries) {
    const covered = coveredLineIds(q, data.lines);
    const refs = covered.map((id): PharmacyLineRef => {
      const l = data.lines.get(id)!;
      const c = data.cancellations.get(id);
      return {
        id,
        drugId: l.drugId,
        conditionId: l.conditionId,
        words: asWritten(l),
        standing: l.state === "active",
        changed: !!c?.replacedBy && (c.queryId === q.id || q.scope === "line"),
      };
    });
    for (const id of covered) {
      const s = statusOf(data, id);
      if (s) lineStatus[id] = s;
    }
    const thisVisit = covered.some((id) => data.lines.get(id)?.encounterId === ctx.encounterId);
    const base = { id: q.id, lines: refs, thisVisit, phone: ctx.words.phone(q.dispensingPointId) };

    const lite = queryLites({ ...data, queries: [q] })[0]!;
    const sent = q.events.some((e) => e.kind === "notified");
    const folded = queryState(lite); // never "not_sent_yet": no time bound is given
    const state = folded === "open" && !sent ? "not_sent" : (folded as PharmacyQueryItem["state"]);
    const stands = standingEvent(q);
    const phoneMine =
      stands?.via === "phone" && stands.answeredByUserId === ctx.viewerUserId
        ? printTime(stands.at.toISOString())
        : null;
    const open = state === "open" || state === "not_sent";
    // Open queries show wherever the patient's plan is opened; closed ones only at their own visit,
    // or while a phone answer in the viewer's name can still be disputed.
    if (!open && !thisVisit && !phoneMine) continue;
    const withdrawn = q.events.find((e) => e.kind === "withdrawn");
    items.push({
      ...base,
      kind: "query",
      scope: q.scope,
      typeCode: q.typeCode,
      words: fill(COPY.query, {
        cadre: ctx.words.cadreName(q.senderCadre),
        time: printTime(q.createdAt.toISOString()),
        type: wordOf(ctx.words.queryTypes, q.typeCode),
        proposal: q.proposal,
      }),
      patientWaiting: q.patientWaiting,
      state,
      waitingMin: Math.max(0, Math.floor((ctx.now.getTime() - q.createdAt.getTime()) / 60_000)),
      outcome:
        state === "withdrawn" && withdrawn
          ? fill(QUERY_COPY.withdrawn, { time: printTime(withdrawn.at.toISOString()) })
          : state === "answered" && stands
            ? firstAnswerWords(stands, ctx.words.answererCadre(stands.answeredByUserId))
            : null,
      phoneAnswerAt: phoneMine,
      seen: q.events.some((e) => e.kind === "seen" && e.recipientUserId === ctx.viewerUserId),
    });
  }
  // RQ-11: each line the pharmacy did not supply, until acknowledged or the line moves on.
  for (const [lineId, l] of data.lines) {
    const outcome = notSuppliedOutcome(data, lineId);
    if (!outcome || data.acknowledged.has(outcome.id)) continue;
    const s = statusOf(data, lineId);
    if (s) lineStatus[lineId] = s;
    items.push({
      kind: "not_supplied",
      id: outcome.id,
      lines: [
        {
          id: lineId,
          drugId: l.drugId,
          conditionId: l.conditionId,
          words: asWritten(l),
          standing: true,
          changed: false,
        },
      ],
      thisVisit: l.encounterId === ctx.encounterId,
      phone: outcome.pointId ? ctx.words.phone(outcome.pointId) : null,
      words: notSuppliedNotice({
        at: outcome.occurredAt,
        medicine: l.drugName,
        reason: wordOf(ctx.words.outcomeReasons, outcome.reasonCode),
        patientTold: outcome.patientTold ?? "",
      }).words,
      canAcknowledge: true,
    });
  }
  // Every loaded line's stage (the plan loads only the lines above; the one Prescribe names its own).
  for (const id of data.lines.keys()) {
    const st = lineStatus[id] ?? statusOf(data, id);
    if (st) lineStatus[id] = st;
  }
  const open = items.filter(
    (i) => i.kind === "not_supplied" || i.state === "open" || i.state === "not_sent",
  );
  const newest = open.filter((i) => i.kind === "query").at(-1);
  return {
    surface: ctx.surface,
    viewerUserId: ctx.viewerUserId,
    patientUserId: ctx.patientUserId,
    items,
    count: open.length,
    keepReasons: ctx.keep.items,
    keepSigned: ctx.keep.signed,
    stopReasons: STOP_REASONS,
    announce: newest ? { id: newest.id, text: COPY.announce } : null,
    lineStatus,
  };
}

/** RQ-6: what a later attempt is shown. */
export const firstAnswerWords = (e: Pick<QueryEventRow, "answer" | "at">, cadre: string) =>
  fill(COPY.firstAnswer, {
    cadre,
    time: printTime(e.at.toISOString()),
    answer: e.answer ? ANSWER_LABEL[e.answer] : "",
  });

/** The answering clinicians' cadres at this hospital, by user (never a name). */
export async function cadresOfUsers(
  tx: EmrTx,
  hospitalId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const rows = await tx
    .select({ userId: staffAffiliations.userId, name: cadres.name })
    .from(staffAffiliations)
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(
      and(
        eq(staffAffiliations.hospitalId, hospitalId),
        inArray(staffAffiliations.userId, [...userIds]),
      ),
    )
    .orderBy(desc(staffAffiliations.createdAt));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.userId)) out.set(r.userId, r.name);
  return out;
}

/** 5.4 on the plan step: everything the prescriber reads of the pharmacy for this patient. */
export async function loadPrescriberPharmacy(
  actor: EmrActor,
  input: { patientUserId: string; encounterId: string; now: Date; database?: EmrDb },
): Promise<PrescriberPharmacyView> {
  const scope = { userId: actor.userId, hospitalId: actor.hospitalId };
  const data = await asClinicalReader(
    scope,
    (tx) =>
      loadPatientPharmacy(tx, { hospitalId: actor.hospitalId, patientUserId: input.patientUserId }),
    input.database,
  );
  return asClinicalWriter(scope, (tx) => viewOf(tx, actor, data, input), input.database);
}

/**
 * The same view inside the caller's transaction, after its access check, with the stage of every named
 * line too (the one Prescribe's "already prescribed", prescribing kit F4).
 */
export async function prescriberViewIn(
  tx: EmrTx,
  actor: EmrActor,
  input: { patientUserId: string; encounterId: string; now: Date; lineIds: readonly string[] },
): Promise<PrescriberPharmacyView> {
  const data = await loadPatientPharmacy(tx, {
    hospitalId: actor.hospitalId,
    patientUserId: input.patientUserId,
    lineIds: input.lineIds,
  });
  return viewOf(tx, actor, data, input);
}

/** The words the view needs (phones, cadre names, signed lists), read as the owner, then the view. */
async function viewOf(
  tx: EmrTx,
  actor: EmrActor,
  data: PatientPharmacy,
  input: { patientUserId: string; encounterId: string; now: Date },
): Promise<PrescriberPharmacyView> {
  const answerers = [
    ...new Set(
      data.queries.flatMap((q) =>
        q.events.flatMap((e) => (e.answeredByUserId ? [e.answeredByUserId] : [])),
      ),
    ),
  ];
  const points = [
    ...new Set([
      ...data.queries.map((q) => q.dispensingPointId),
      ...[...data.lineEvents.values()].flat().flatMap((e) => (e.pointId ? [e.pointId] : [])),
    ]),
  ];
  const codes = [...new Set(data.queries.flatMap((q) => (q.senderCadre ? [q.senderCadre] : [])))];
  const [phones, names, people, keep, types, outcomes] = await Promise.all([
    points.length
      ? tx
          .select({
            id: pharmacyDispensingPoints.departmentId,
            phone: pharmacyDispensingPoints.phone,
          })
          .from(pharmacyDispensingPoints)
          .where(
            and(
              eq(pharmacyDispensingPoints.hospitalId, actor.hospitalId),
              inArray(pharmacyDispensingPoints.departmentId, points),
            ),
          )
      : [],
    codes.length
      ? tx
          .select({ code: cadres.code, name: cadres.name })
          .from(cadres)
          .where(inArray(cadres.code, codes))
      : [],
    cadresOfUsers(tx, actor.hospitalId, answerers),
    signedList(tx, actor.hospitalId, "keep_reasons", DRAFT_KEEP_REASONS),
    signedList(tx, actor.hospitalId, "query_codes", DRAFT_QUERY_TYPES),
    signedList(tx, actor.hospitalId, "outcome_reasons", DRAFT_NOT_SUPPLIED_REASONS),
  ]);
  const phone = new Map(phones.map((p) => [p.id, p.phone]));
  const cadre = new Map(names.map((n) => [n.code, n.name]));
  return buildView(data, {
    surface: actor.surface,
    viewerUserId: actor.userId,
    patientUserId: input.patientUserId,
    encounterId: input.encounterId,
    now: input.now,
    keep,
    words: {
      cadreName: (c) => (c ? (cadre.get(c) ?? c) : ""),
      answererCadre: (u) => (u ? (people.get(u) ?? "") : ""),
      phone: (id) => phone.get(id) ?? null,
      // Labels only: in production with no signed list they read as the stored code.
      queryTypes: types.items,
      outcomeReasons: outcomes.items,
    },
  });
}
