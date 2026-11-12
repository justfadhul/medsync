import type { EmrDb } from "@/lib/emr/db";
import type { StoredAnswer } from "@/lib/pharmacy/checks";
import type { LaneLine, LaneReasonCode, LaneResult, LaneRule } from "@/lib/pharmacy/lanes";
import type {
  LineEventKind,
  LineInput,
  LineScope,
  LineStatus,
  PharmacyLineEvent,
  QueryLite,
} from "@/lib/pharmacy/lines";
import type { QueueEncounter } from "@/lib/pharmacy/queue";
import type { QueryEvent } from "@/lib/pharmacy/review/queries";
import type { ReviewEvent } from "@/lib/pharmacy/review/review";
import type { Batch } from "@/lib/pharmacy/stock/ledger";
import type { SQL } from "drizzle-orm";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { conditions, diagnosisTerms } from "@/db/schema/emr";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { pharmacyDispensingPoints } from "@/db/schema/pharmacy";
import {
  pharmacyBatches,
  pharmacyCountLines,
  pharmacyCounts,
  pharmacyHandovers,
  pharmacyHospitalSettings,
  pharmacyLineEvents,
  pharmacyPaymentStatuses,
  pharmacyProductPoints,
  pharmacyProducts,
  pharmacyQueries,
  pharmacyQueryEvents,
  pharmacyScopeEntries,
  pharmacySignedSets,
  pharmacyStockouts,
  pharmacySupplies,
  pharmacySupplyReversals,
  prescriptionCancellations,
  prescriptionPrintEvents,
} from "@/db/schema/pharmacy-dispensing";
import { prescriptions } from "@/db/schema/prescribing";
import { controlledClasses } from "@/lib/pharmacy/controlled";
import { LANE_REASON_ORDER, laneFor } from "@/lib/pharmacy/lanes";
import { inScope, lineStatus } from "@/lib/pharmacy/lines";
import { byWrittenOrder, laneOf, placementKey } from "@/lib/pharmacy/queue";
import {
  cadreNames,
  cadreOfUsers,
  cosignsFor,
  dispensable,
  encountersFor,
  keyFilter,
  lineColumns,
} from "@/lib/pharmacy/read";
import { notRecalled } from "@/lib/pharmacy/stores/recall-read";

/**
 * The record a review, a query or an outcome reads (Pharmacy Phase 1, LO-1..LO-9, LN-1..LN-8, RQ-2,
 * LO-6). One loader for the store (inside its transaction, after the line locks) and the reads: it
 * brings the hospital's points, settings and signed lane rule, the prescription rows of each placement
 * (with the lines that replaced them, H4, grouped under the original placement, gate-a-proposal §3.1),
 * their co-sign, encounter, line events, queries, payment status and print record, and folds each line
 * through `lines.ts`. Nothing here decides a move: the engines do. Read as the owner, every query scoped
 * to the caller's hospital (the Phase 0 read pattern, RV-7).
 */

export type PaymentStatus = "paid" | "exempt" | "insured" | "emergency" | "not_recorded";

export interface PointRow {
  id: string;
  name: string;
  serves: "window" | "wards" | "emergency" | "all";
  liveAt: Date | null;
  switchedOffAt: Date | null;
  phone: string | null;
}

export interface HospitalContext {
  hospitalId: string;
  points: PointRow[];
  /** LO-6: when the hospital's first dispensing point went live. */
  firstLiveAt: Date | null;
  settings: {
    individualInpatientSupply: boolean;
    supplyWithoutPharmacist: boolean;
    paymentStatusRequired: boolean;
    liveSms: boolean;
  };
  /** LN-1: the signed lane rule in force, or null (LN-4). */
  rule: LaneRule;
  /** D-PH1-29: the signed high-risk list's medicine ids, or null when none is signed. */
  highRisk: ReadonlySet<string> | null;
  /** CD-1, CT-7: the signed controlled class of each medicine signed controlled (none while unsigned). */
  controlledClasses: ReadonlyMap<string, string>;
}

export const pointIsLive = (p: Pick<PointRow, "liveAt" | "switchedOffAt">) =>
  p.liveAt !== null && p.switchedOffAt === null;

const LANE_CODES = new Set<string>(LANE_REASON_ORDER);

function parseRule(content: unknown, version: number): LaneRule {
  const reasons = (content as { reasons?: unknown })?.reasons;
  if (!Array.isArray(reasons)) return { version, reasons: [] };
  return {
    version,
    reasons: reasons.flatMap((r: unknown) => {
      const o = r as { code?: unknown; on?: unknown };
      return typeof o?.code === "string" && LANE_CODES.has(o.code)
        ? [{ code: o.code as LaneReasonCode, on: o.on === true }]
        : [];
    }),
  };
}

/** The points, settings and signed sets of one hospital. Three round trips. */
export async function loadHospitalContext(
  database: EmrDb,
  hospitalId: string,
): Promise<HospitalContext> {
  const [points, [settings], sets] = await Promise.all([
    database
      .select({
        id: pharmacyDispensingPoints.departmentId,
        name: hospitalDepartments.name,
        serves: pharmacyDispensingPoints.serves,
        liveAt: pharmacyDispensingPoints.liveAt,
        switchedOffAt: pharmacyDispensingPoints.switchedOffAt,
        phone: pharmacyDispensingPoints.phone,
      })
      .from(pharmacyDispensingPoints)
      .innerJoin(
        hospitalDepartments,
        eq(hospitalDepartments.id, pharmacyDispensingPoints.departmentId),
      )
      .where(
        and(
          eq(pharmacyDispensingPoints.hospitalId, hospitalId),
          isNull(hospitalDepartments.archivedAt),
        ),
      )
      .orderBy(asc(hospitalDepartments.name)),
    database
      .select({
        individualInpatientSupply: pharmacyHospitalSettings.individualInpatientSupply,
        supplyWithoutPharmacist: pharmacyHospitalSettings.supplyWithoutPharmacist,
        paymentStatusRequired: pharmacyHospitalSettings.paymentStatusRequired,
        liveSms: pharmacyHospitalSettings.liveSms,
      })
      .from(pharmacyHospitalSettings)
      .where(eq(pharmacyHospitalSettings.hospitalId, hospitalId)),
    database
      .select({
        kind: pharmacySignedSets.kind,
        version: pharmacySignedSets.version,
        content: pharmacySignedSets.content,
      })
      .from(pharmacySignedSets)
      .where(
        and(
          eq(pharmacySignedSets.hospitalId, hospitalId),
          eq(pharmacySignedSets.status, "signed"),
          inArray(pharmacySignedSets.kind, ["lane_rule", "high_risk_list", "controlled_classes"]),
        ),
      ),
  ]);
  const lives = points.flatMap((p) => (p.liveAt ? [p.liveAt.getTime()] : []));
  const rule = sets.find((s) => s.kind === "lane_rule");
  const highRisk = sets.find((s) => s.kind === "high_risk_list");
  return {
    hospitalId,
    points: points as PointRow[],
    firstLiveAt: lives.length ? new Date(Math.min(...lives)) : null,
    settings: settings ?? {
      individualInpatientSupply: false,
      supplyWithoutPharmacist: false,
      paymentStatusRequired: false,
      liveSms: false,
    },
    rule: rule ? parseRule(rule.content, rule.version) : null,
    highRisk:
      highRisk && highRisk.content && typeof highRisk.content === "object"
        ? new Set(Object.keys(highRisk.content as Record<string, unknown>))
        : null,
    controlledClasses: controlledClasses(
      sets.find((s) => s.kind === "controlled_classes")?.content,
    ),
  };
}

/* ─── The prescription rows ─────────────────────────────────────────── */

const rxColumns = {
  ...lineColumns,
  drugId: prescriptions.drugId,
  concentration: prescriptions.concentration,
  dose: prescriptions.dose,
  route: prescriptions.route,
  frequency: prescriptions.frequency,
  duration: prescriptions.duration,
  quantity: prescriptions.quantity,
  method: prescriptions.method,
  infusionOver: prescriptions.infusionOver,
  diluent: prescriptions.diluent,
  prn: prescriptions.prn,
  fluidPurpose: prescriptions.fluidPurpose,
  volumeMl: prescriptions.volumeMl,
  overMinutes: prescriptions.overMinutes,
  instructionsCiphertext: prescriptions.instructionsCiphertext,
  indication: prescriptions.indication,
  edits: prescriptions.edits,
  reasonCiphertext: prescriptions.confirmReasonCiphertext,
  conditionTerm: diagnosisTerms.display,
  conditionText: conditions.textCiphertext,
};

export type RxRow = Omit<
  Awaited<ReturnType<typeof selectRows>>[number],
  "checkAnswers" | "confirmedFlags" | "edits"
> & {
  checkAnswers: StoredAnswer[];
  confirmedFlags: string[];
  edits: { field: string; from: string; to: string }[];
};

function selectRows(database: EmrDb, hospitalId: string, where: SQL | undefined) {
  return database
    .select(rxColumns)
    .from(prescriptions)
    .leftJoin(conditions, eq(conditions.id, prescriptions.conditionId))
    .leftJoin(diagnosisTerms, eq(diagnosisTerms.id, conditions.termId))
    .where(and(eq(prescriptions.hospitalId, hospitalId), dispensable(), where));
}

async function rowsWhere(database: EmrDb, hospitalId: string, where: SQL | undefined) {
  return (await selectRows(database, hospitalId, where)).map(
    (r): RxRow => ({
      ...r,
      checkAnswers: (r.checkAnswers ?? []) as StoredAnswer[],
      confirmedFlags: (r.confirmedFlags ?? []) as string[],
      edits: (r.edits ?? []) as RxRow["edits"],
    }),
  );
}

/* ─── The group ─────────────────────────────────────────────────────── */

export interface LoadedEvent extends PharmacyLineEvent {
  prescriptionId: string;
  decision: unknown;
  patientTold: string | null;
  reasonNote: string | null;
  actorUserId: string;
  dispensingPointId: string | null;
}

export interface LoadedQuery {
  id: string;
  scope: "line" | "prescription";
  prescriptionId: string;
  placementId: string | null;
  typeCode: string;
  proposal: string;
  patientWaiting: boolean;
  senderUserId: string;
  senderCadre: string | null;
  createdAt: Date;
  lite: QueryLite;
  /** The events as the pharmacy reads them (`queryOutcomeForPharmacy`). */
  events: QueryEvent[];
}

export interface GroupLine {
  row: RxRow;
  input: LineInput;
  cosign: { state: string; reviewedAt: Date | null; reviewedByUserId: string | null } | null;
  events: LoadedEvent[];
  /** The events as `review.ts` reads them (RQ-1, RQ-9, RQ-12). */
  reviewEvents: ReviewEvent[];
  /** LO-1: null when the prescription is out of scope (LO-6). */
  status: LineStatus | null;
  reasons: LaneReasonCode[];
  /** H4: the line that replaced this one, and the one this replaced. */
  replacedBy: string | null;
  replaces: string | null;
  cancellationAt: Date | null;
  /** RQ-9: what was handed over on the version this replaced (Step 6 writes supplies). */
  suppliedEarlier: { quantity: number; at: Date } | null;
}

export interface Group {
  key: string;
  groupedByTime: boolean;
  placementId: string | null;
  patientUserId: string;
  encounter: QueueEncounter | undefined;
  origin: "window" | "ward";
  writtenAt: Date;
  prescriberCadre: string | null;
  lines: GroupLine[];
  lane: LaneResult;
  scope: LineScope;
  broughtIn: boolean;
  queries: LoadedQuery[];
  payment: { status: PaymentStatus; detail: string | null; at: Date } | null;
  lastPrintAt: Date | null;
  /** PQ-7, B-08: a line changed after the paper was last printed. */
  changedSincePrint: boolean;
}

const ACTIVE = new Set(["active", "administered"]);
const MAX_EXPANSIONS = 8;
const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];

/**
 * Every group touching the seed rows, complete: each row's whole placement (or time group, PQ-1) and
 * every line that replaced, or was replaced by, one of them (H4). A fixed number of round trips per
 * expansion; the expansions stop when nothing new is found.
 */
export async function loadGroups(
  database: EmrDb,
  ctx: HospitalContext,
  seed: SQL | undefined,
): Promise<Group[]> {
  const { hospitalId } = ctx;
  const rows = new Map<string, RxRow>();
  const cancellations = new Map<
    string,
    { replacedBy: string | null; reasonCode: string; at: Date }
  >();
  const add = (list: RxRow[]) => {
    const fresh = list.filter((r) => !rows.has(r.id));
    for (const r of fresh) {
      // CD-1, S61: a medicine signed controlled is controlled on every path, flagged at prescribing or not.
      if (ctx.controlledClasses.has(r.drugId)) r.controlled = true;
      rows.set(r.id, r);
    }
    return fresh;
  };
  let fresh = add(await rowsWhere(database, hospitalId, seed));
  const seenPlacements = new Set<string>();
  const seenCancels = new Set<string>();
  for (let i = 0; fresh.length && i < MAX_EXPANSIONS; i++) {
    const ids = fresh.map((r) => r.id);
    const placements = uniq(fresh.flatMap((r) => (r.placementId ? [r.placementId] : []))).filter(
      (p) => !seenPlacements.has(p),
    );
    for (const p of placements) seenPlacements.add(p);
    const timeKeys = uniq(
      fresh.filter((r) => !r.placementId).map((r) => placementKey(r).key),
    ).flatMap((k) => {
      const f = keyFilter(k);
      return f ? [f] : [];
    });
    const cancels = await database
      .select({
        prescriptionId: prescriptionCancellations.prescriptionId,
        replacedBy: prescriptionCancellations.replacedByPrescriptionId,
        reasonCode: prescriptionCancellations.reasonCode,
        at: prescriptionCancellations.cancelledAt,
      })
      .from(prescriptionCancellations)
      .where(
        and(
          eq(prescriptionCancellations.hospitalId, hospitalId),
          or(
            inArray(prescriptionCancellations.prescriptionId, ids),
            inArray(prescriptionCancellations.replacedByPrescriptionId, ids),
          ),
        ),
      )
      .orderBy(asc(prescriptionCancellations.cancelledAt));
    const linked: string[] = [];
    for (const c of cancels) {
      const k = `${c.prescriptionId}:${c.replacedBy ?? ""}`;
      if (seenCancels.has(k)) continue;
      seenCancels.add(k);
      if (!cancellations.has(c.prescriptionId))
        cancellations.set(c.prescriptionId, {
          replacedBy: c.replacedBy,
          reasonCode: c.reasonCode,
          at: c.at,
        });
      linked.push(c.prescriptionId, ...(c.replacedBy ? [c.replacedBy] : []));
    }
    const missing = uniq(linked).filter((id) => !rows.has(id));
    const conds = [
      ...(placements.length ? [inArray(prescriptions.placementId, placements)] : []),
      ...timeKeys,
      ...(missing.length ? [inArray(prescriptions.id, missing)] : []),
    ];
    fresh = conds.length ? add(await rowsWhere(database, hospitalId, or(...conds))) : [];
  }
  if (!rows.size) return [];
  const all = [...rows.values()];
  const ids = all.map((r) => r.id);

  const [cosigns, encs, names, events, queryRows, payments, scopes, prints, supplies] =
    await Promise.all([
      cosignsFor(database, hospitalId, ids),
      encountersFor(
        database,
        hospitalId,
        uniq(all.flatMap((r) => (r.encounterId ? [r.encounterId] : []))),
      ),
      cadreNames(database),
      database
        .select({
          id: pharmacyLineEvents.id,
          prescriptionId: pharmacyLineEvents.prescriptionId,
          kind: pharmacyLineEvents.kind,
          occurredAt: pharmacyLineEvents.occurredAt,
          effectiveAt: pharmacyLineEvents.effectiveAt,
          lane: pharmacyLineEvents.lane,
          quantitySupplied: pharmacyLineEvents.quantitySupplied,
          quantityNotSupplied: pharmacyLineEvents.quantityNotSupplied,
          reasonCode: pharmacyLineEvents.reasonCode,
          reasonNote: pharmacyLineEvents.reasonNote,
          handoverId: pharmacyLineEvents.handoverId,
          actorCadre: pharmacyLineEvents.actorCadre,
          actorUserId: pharmacyLineEvents.actorUserId,
          decision: pharmacyLineEvents.decision,
          patientTold: pharmacyLineEvents.patientTold,
          dispensingPointId: pharmacyLineEvents.dispensingPointId,
          enteredAfterDowntime: pharmacyHandovers.enteredAfterDowntime,
          clientKey: pharmacyLineEvents.clientKey,
        })
        .from(pharmacyLineEvents)
        .leftJoin(pharmacyHandovers, eq(pharmacyHandovers.id, pharmacyLineEvents.handoverId))
        .where(
          and(
            eq(pharmacyLineEvents.hospitalId, hospitalId),
            inArray(pharmacyLineEvents.prescriptionId, ids),
          ),
        )
        .orderBy(asc(pharmacyLineEvents.occurredAt), asc(pharmacyLineEvents.id)),
      database
        .select()
        .from(pharmacyQueries)
        .where(
          and(
            eq(pharmacyQueries.hospitalId, hospitalId),
            inArray(pharmacyQueries.prescriptionId, ids),
          ),
        )
        .orderBy(asc(pharmacyQueries.createdAt)),
      database
        .select({
          prescriptionId: pharmacyPaymentStatuses.prescriptionId,
          placementId: pharmacyPaymentStatuses.placementId,
          status: pharmacyPaymentStatuses.status,
          detail: pharmacyPaymentStatuses.detail,
          at: pharmacyPaymentStatuses.recordedAt,
        })
        .from(pharmacyPaymentStatuses)
        .where(
          and(
            eq(pharmacyPaymentStatuses.hospitalId, hospitalId),
            inArray(pharmacyPaymentStatuses.prescriptionId, ids),
          ),
        )
        .orderBy(desc(pharmacyPaymentStatuses.recordedAt)),
      database
        .select({ prescriptionId: pharmacyScopeEntries.prescriptionId })
        .from(pharmacyScopeEntries)
        .where(
          and(
            eq(pharmacyScopeEntries.hospitalId, hospitalId),
            inArray(pharmacyScopeEntries.prescriptionId, ids),
          ),
        ),
      database
        .select({
          prescriptionId: prescriptionPrintEvents.prescriptionId,
          at: sql<Date>`max(${prescriptionPrintEvents.printedAt})`.mapWith(
            prescriptionPrintEvents.printedAt,
          ),
        })
        .from(prescriptionPrintEvents)
        .where(
          and(
            eq(prescriptionPrintEvents.hospitalId, hospitalId),
            inArray(prescriptionPrintEvents.prescriptionId, ids),
          ),
        )
        .groupBy(prescriptionPrintEvents.prescriptionId),
      database
        .select({
          prescriptionId: pharmacySupplies.prescriptionId,
          quantity: pharmacySupplies.quantity,
          at: pharmacySupplies.suppliedAt,
        })
        .from(pharmacySupplies)
        .leftJoin(
          pharmacySupplyReversals,
          eq(pharmacySupplyReversals.supplyId, pharmacySupplies.id),
        )
        .where(
          and(
            eq(pharmacySupplies.hospitalId, hospitalId),
            inArray(pharmacySupplies.prescriptionId, ids),
            isNull(pharmacySupplyReversals.id),
          ),
        ),
    ]);
  const queryIds = queryRows.map((q) => q.id);
  const queryEvents = queryIds.length
    ? await database
        .select()
        .from(pharmacyQueryEvents)
        .where(
          and(
            eq(pharmacyQueryEvents.hospitalId, hospitalId),
            inArray(pharmacyQueryEvents.queryId, queryIds),
          ),
        )
        .orderBy(asc(pharmacyQueryEvents.occurredAt))
    : [];
  const people = await cadreOfUsers(
    database,
    hospitalId,
    queryEvents.flatMap((e) => [
      e.actorUserId,
      ...(e.answeredByUserId ? [e.answeredByUserId] : []),
    ]),
  );

  // H4: each replacement points at what it replaced; the group is the root's placement.
  const replaces = new Map<string, string>();
  for (const [id, c] of cancellations) if (c.replacedBy) replaces.set(c.replacedBy, id);
  const rootOf = (id: string) => {
    let cur = id;
    for (let i = 0; replaces.has(cur) && i < 50; i++) cur = replaces.get(cur)!;
    return cur;
  };
  const byKey = new Map<string, RxRow[]>();
  for (const r of all) {
    const root = rows.get(rootOf(r.id)) ?? r;
    const k = placementKey(root).key;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }

  const eventsOf = new Map<string, LoadedEvent[]>();
  for (const { clientKey, ...e } of events) {
    const le: LoadedEvent = {
      ...e,
      kind: e.kind as LineEventKind,
      lane: e.lane,
      // DT-9: a "not supplied" row from a downtime sheet has no hand-over; its key marks it.
      enteredAfterDowntime: e.enteredAfterDowntime === true || !!clientKey?.startsWith("dtns:"),
    };
    eventsOf.set(e.prescriptionId, [...(eventsOf.get(e.prescriptionId) ?? []), le]);
  }
  const suppliedOf = new Map<string, { quantity: number; at: Date }>();
  for (const s of supplies) {
    if (!s.prescriptionId) continue;
    const prev = suppliedOf.get(s.prescriptionId);
    suppliedOf.set(s.prescriptionId, {
      quantity: (prev?.quantity ?? 0) + s.quantity,
      at: prev && prev.at < s.at ? prev.at : s.at,
    });
  }
  const printOf = new Map(prints.map((p) => [p.prescriptionId, p.at]));
  const broughtIn = new Set(scopes.map((s) => s.prescriptionId));

  const groups: Group[] = [];
  for (const [key, members] of byKey) {
    const roots = members.filter((m) => !replaces.has(m.id)).sort(byWrittenOrder);
    const first = roots[0] ?? [...members].sort(byWrittenOrder)[0]!;
    const replacementsOrdered = members
      .filter((m) => replaces.has(m.id))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const ordered = [...roots, ...replacementsOrdered];
    const encounter = first.encounterId ? encs.get(first.encounterId) : undefined;
    const origin: "window" | "ward" = laneOf(encounter) === "ward" ? "ward" : "window";
    const active = ordered.filter((r) => ACTIVE.has(r.state));
    const lane = laneFor(
      active.map(
        (r): LaneLine => ({
          id: r.id,
          controlled: r.controlled,
          regimenId: r.regimenId,
          edits: r.edits,
          conditionId: r.conditionId,
          kind: r.kind as LaneLine["kind"],
          drugId: r.drugId,
          checkAnswers: r.checkAnswers,
          confirmedFlags: r.confirmedFlags,
        }),
      ),
      ctx.rule,
      ctx.highRisk,
    );
    const writtenAt = first.createdAt;
    const isBroughtIn = ordered.some((r) => broughtIn.has(r.id));
    const scope = inScope({
      writtenAt,
      firstLiveAt: ctx.firstLiveAt,
      broughtIn: isBroughtIn,
      lane: lane.lane,
      origin,
      inpatientSupply: ctx.settings.individualInpatientSupply,
    });

    const lineIds = new Set(ordered.map((r) => r.id));
    const queries: LoadedQuery[] = queryRows
      .filter((q) => lineIds.has(q.prescriptionId))
      .map((q) => {
        const evs = queryEvents.filter((e) => e.queryId === q.id);
        const covered =
          q.scope === "line"
            ? [q.prescriptionId]
            : ordered
                .filter((r) => r.createdAt.getTime() <= q.createdAt.getTime())
                .map((r) => r.id);
        return {
          id: q.id,
          scope: q.scope,
          prescriptionId: q.prescriptionId,
          placementId: q.placementId,
          typeCode: q.typeCode,
          proposal: q.proposal,
          patientWaiting: q.patientWaiting,
          senderUserId: q.senderUserId,
          senderCadre: q.senderCadre,
          createdAt: q.createdAt,
          lite: {
            id: q.id,
            scope: q.scope,
            lineIds: covered,
            sentAt: q.createdAt,
            events: evs.map((e) => ({ kind: e.kind, at: e.occurredAt, answer: e.answer })),
          },
          events: evs.map(
            (e): QueryEvent => ({
              kind: e.kind as QueryEvent["kind"],
              at: e.occurredAt,
              answer: e.answer,
              via: e.via,
              answerReasonCode: e.answerReasonCode,
              answeredByCadre: e.answeredByUserId ? (people.get(e.answeredByUserId) ?? null) : null,
              loggedByCadre: e.via === "phone" ? (people.get(e.actorUserId) ?? null) : null,
            }),
          ),
        };
      });

    const lines: GroupLine[] = ordered.map((r) => {
      const c = cosigns.get(r.id) ?? null;
      const cancel = cancellations.get(r.id) ?? null;
      const input: LineInput = {
        id: r.id,
        state: r.state as LineInput["state"],
        cosign: !c
          ? "none"
          : c.state === "pending_review"
            ? "awaiting"
            : c.state === "approved"
              ? "signed"
              : "withheld",
        createdAt: r.createdAt,
        cosignedAt: c?.reviewedAt ?? null,
        stateChangedAt: ACTIVE.has(r.state) ? null : (cancel?.at ?? r.updatedAt),
        reviewOnly: scope === "review_only",
        cancellation: cancel
          ? { replacedBy: cancel.replacedBy, reasonCode: cancel.reasonCode }
          : null,
      };
      const evs = eventsOf.get(r.id) ?? [];
      const prior = replaces.get(r.id) ?? null;
      return {
        row: r,
        input,
        cosign: c,
        events: evs,
        reviewEvents: evs.map((e) => ({
          id: e.id,
          prescriptionId: e.prescriptionId,
          kind: e.kind,
          reasonCode: e.reasonCode,
        })),
        status:
          scope === "out"
            ? null
            : lineStatus(
                input,
                evs,
                queries.map((q) => q.lite),
                lane.lane,
              ),
        reasons: lane.perLine.get(r.id) ?? [],
        replacedBy: cancel?.replacedBy ?? null,
        replaces: prior,
        cancellationAt: cancel?.at ?? null,
        suppliedEarlier: prior ? (suppliedOf.get(prior) ?? null) : null,
      };
    });

    const pay = payments.find(
      (p) =>
        lineIds.has(p.prescriptionId) || (first.placementId && p.placementId === first.placementId),
    );
    const printed = ordered.flatMap((r) => {
      const at = printOf.get(r.id);
      return at ? [at.getTime()] : [];
    });
    const lastPrintAt = printed.length ? new Date(Math.max(...printed)) : null;
    groups.push({
      key,
      groupedByTime: !first.placementId,
      placementId: first.placementId,
      patientUserId: first.patientUserId,
      encounter,
      origin,
      writtenAt,
      prescriberCadre: first.prescriberCadre
        ? (names.get(first.prescriberCadre) ?? first.prescriberCadre)
        : null,
      lines,
      lane,
      scope,
      broughtIn: isBroughtIn,
      queries,
      payment: pay ? { status: pay.status, detail: pay.detail, at: pay.at } : null,
      lastPrintAt,
      changedSincePrint:
        lastPrintAt !== null &&
        ordered.some(
          (r) =>
            r.createdAt > lastPrintAt ||
            (!ACTIVE.has(r.state) && (cancellations.get(r.id)?.at ?? r.updatedAt) > lastPrintAt),
        ),
    });
  }
  return groups;
}

/** LO-1, with what a write is about to add: the fold the store checks a move against. */
export function foldWith(
  group: Group,
  line: GroupLine,
  extra: { events?: readonly PharmacyLineEvent[]; queries?: readonly QueryLite[] } = {},
): LineStatus {
  return lineStatus(
    line.input,
    [...line.events, ...(extra.events ?? [])],
    [...group.queries.map((q) => q.lite), ...(extra.queries ?? [])],
    group.lane.lane,
  );
}

/** The group a line belongs to (following H4 up to the original placement), or null. */
export async function loadGroupOfLine(
  database: EmrDb,
  ctx: HospitalContext,
  lineId: string,
): Promise<{ group: Group; line: GroupLine } | null> {
  const groups = await loadGroups(database, ctx, eq(prescriptions.id, lineId));
  for (const group of groups) {
    const line = group.lines.find((l) => l.row.id === lineId);
    if (line) return { group, line };
  }
  return null;
}

/** The group of a placement key (PQ-1), or null. */
export async function loadGroupByKey(
  database: EmrDb,
  ctx: HospitalContext,
  key: string,
): Promise<Group | null> {
  const filter = keyFilter(key);
  if (!filter) return null;
  const groups = await loadGroups(database, ctx, filter);
  return groups.find((g) => g.key === key) ?? null;
}

/**
 * LO-6: every group that can be in the queue or in Open lines: written since the first point went
 * live, or brought in by a person.
 * ponytail: reads every prescription since go-live and folds it in memory; when that grows past a
 * few thousand rows, keep a per-line "has an outcome" projection and seed from the open ones only.
 */
export async function loadScopeGroups(database: EmrDb, ctx: HospitalContext): Promise<Group[]> {
  const brought = database
    .select({ id: pharmacyScopeEntries.prescriptionId })
    .from(pharmacyScopeEntries)
    .where(eq(pharmacyScopeEntries.hospitalId, ctx.hospitalId));
  const since = ctx.firstLiveAt
    ? sql`${prescriptions.createdAt} >= ${ctx.firstLiveAt.toISOString()}::timestamptz`
    : sql`false`;
  const groups = await loadGroups(database, ctx, or(since, inArray(prescriptions.id, brought)));
  return groups.filter((g) => g.scope !== "out");
}

/* ─── The shelf (SL-2, AV-3, AV-5; read from the ledger, never a stored figure) ─── */

export interface ShelfProduct {
  id: string;
  name: string;
  strength: string | null;
  issueUnit: string;
}

export interface Shelf {
  /** products set up (active) at each point, per medicine: `${pointId}:${medicineId}` */
  products: Map<string, ShelfProduct[]>;
  batches: (Batch & { balance: number })[];
  balances: Map<string, number>;
  lastCounted: Map<string, Date>;
  outSince: Map<string, Date>;
}

export const shelfKey = (pointId: string, medicineId: string) => `${pointId}:${medicineId}`;

/** The stock of some medicines at every point of the hospital. Four round trips. */
export async function loadShelf(
  database: EmrDb,
  hospitalId: string,
  medicineIds: readonly string[],
): Promise<Shelf> {
  const ids = uniq(medicineIds);
  const empty: Shelf = {
    products: new Map(),
    batches: [],
    balances: new Map(),
    lastCounted: new Map(),
    outSince: new Map(),
  };
  if (!ids.length) return empty;
  const [products, batches, counts, outs] = await Promise.all([
    database
      .select({
        id: pharmacyProducts.id,
        name: pharmacyProducts.name,
        strength: pharmacyProducts.strength,
        issueUnit: pharmacyProducts.issueUnit,
        medicineId: pharmacyProducts.medicineId,
        pointId: pharmacyProductPoints.dispensingPointId,
      })
      .from(pharmacyProductPoints)
      .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacyProductPoints.productId))
      .where(
        and(
          eq(pharmacyProductPoints.hospitalId, hospitalId),
          eq(pharmacyProductPoints.active, true),
          eq(pharmacyProducts.active, true),
          inArray(pharmacyProducts.medicineId, ids),
        ),
      )
      .orderBy(asc(pharmacyProducts.name)),
    database
      .select({
        id: pharmacyBatches.id,
        pointId: sql<string>`${pharmacyBatches.dispensingPointId}`,
        productId: pharmacyBatches.productId,
        medicineId: pharmacyProducts.medicineId,
        batchNumber: pharmacyBatches.batchNumber,
        expiry: pharmacyBatches.expiry,
        expiryMonthOnly: pharmacyBatches.expiryMonthOnly,
        balance: sql<number>`coalesce((SELECT sum(m.quantity) FROM public.pharmacy_stock_movements m WHERE m.batch_id = ${pharmacyBatches.id}), 0)::int`,
      })
      .from(pharmacyBatches)
      .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacyBatches.productId))
      .where(
        and(
          eq(pharmacyBatches.hospitalId, hospitalId),
          inArray(pharmacyProducts.medicineId, ids),
          // SL-14 (Phase 2): a recalled batch is never offered or proposed.
          notRecalled(hospitalId, pharmacyBatches.id),
        ),
      ),
    database
      .select({
        pointId: sql<string>`${pharmacyBatches.dispensingPointId}`,
        medicineId: pharmacyProducts.medicineId,
        at: sql<Date>`max(${pharmacyCounts.countedAt})`.mapWith(pharmacyCounts.countedAt),
      })
      .from(pharmacyCountLines)
      .innerJoin(pharmacyCounts, eq(pharmacyCounts.id, pharmacyCountLines.countId))
      .innerJoin(pharmacyBatches, eq(pharmacyBatches.id, pharmacyCountLines.batchId))
      .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacyBatches.productId))
      .where(
        and(eq(pharmacyCounts.hospitalId, hospitalId), inArray(pharmacyProducts.medicineId, ids)),
      )
      .groupBy(pharmacyBatches.dispensingPointId, pharmacyProducts.medicineId),
    database
      .select({
        pointId: pharmacyStockouts.dispensingPointId,
        medicineId: pharmacyStockouts.medicineId,
        startedAt: pharmacyStockouts.startedAt,
      })
      .from(pharmacyStockouts)
      .where(
        and(
          eq(pharmacyStockouts.hospitalId, hospitalId),
          inArray(pharmacyStockouts.medicineId, ids),
          isNull(pharmacyStockouts.endedAt),
          isNotNull(pharmacyStockouts.startedAt),
        ),
      ),
  ]);
  const shelf = empty;
  for (const p of products) {
    const k = shelfKey(p.pointId, p.medicineId);
    shelf.products.set(k, [...(shelf.products.get(k) ?? []), p]);
  }
  shelf.batches = batches.map((b) => ({ ...b, balance: Number(b.balance) }));
  for (const b of shelf.batches) shelf.balances.set(b.id, b.balance);
  for (const c of counts) shelf.lastCounted.set(shelfKey(c.pointId, c.medicineId), c.at);
  for (const o of outs) shelf.outSince.set(shelfKey(o.pointId, o.medicineId), o.startedAt);
  return shelf;
}
