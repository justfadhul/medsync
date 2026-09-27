import type { Ack, AckAction, AckState, ReportStatus, ReportVersion } from "./results";
import type {
  EncounterOrderEvent,
  Specimen,
  SpecimenEvent,
  TestCatalogueEntry,
} from "@/db/schema/emr";
import type { encounterOrders } from "@/db/schema/encounter";

import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { ackState, currentVersion } from "./results";

/**
 * Orders engine (pure; PROMPT §6, §5.8). An events-lifecycle order's status is DERIVED — never
 * stored — from its order events, specimens, specimen events, report versions and
 * acknowledgements. Legacy orders map from their status column.
 *
 * Invariant (property-tested): nothing ordered disappears. Every order derives to acknowledged,
 * cancelled with a reason, or a visibly open state. An event that does not fit (a cancel with no
 * reason, a resume without a hold) is not applied and is listed in `anomalies`, so the order
 * stays open rather than silently closing.
 */

type OrderRow = typeof encounterOrders.$inferSelect;
export type OrderInput = Pick<OrderRow, "id" | "lifecycle" | "status" | "kind">;
export type OrderEventInput = Pick<
  EncounterOrderEvent,
  "orderId" | "kind" | "reasonCode" | "reasonCiphertext" | "recordedAt"
>;
export type SpecimenInput = Pick<Specimen, "id" | "orderId" | "recordedAt">;
export type SpecimenEventInput = Pick<
  SpecimenEvent,
  "specimenId" | "kind" | "reasonCode" | "recordedAt"
>;
export type ReportInput = ReportVersion & { orderId: string | null };

export interface OrderRecords {
  events?: readonly OrderEventInput[];
  specimens?: readonly SpecimenInput[];
  specimenEvents?: readonly SpecimenEventInput[];
  reports?: readonly ReportInput[];
  acks?: readonly Ack[];
}

/** The reason is a code and/or encrypted text; the engine never decrypts. */
export interface OrderReason {
  code: string | null;
  hasText: boolean;
}
export interface SpecimenRejection {
  specimenId: string;
  reasonCode: string;
  at: Date;
}

export type OrderStatus =
  | { state: "proposed" }
  /** Placed and not yet collected. Lab orders read "To collect", with the last rejection if any. */
  | { state: "active"; rejection: SpecimenRejection | null }
  | { state: "on_hold"; reason: OrderReason }
  | { state: "collected"; specimenId: string | null }
  | { state: "in_progress"; specimenId: string }
  | {
      state: "resulted";
      reportId: string | null;
      reportStatus: ReportStatus | "legacy";
      review: "not_released" | "needs_review" | "needs_re_ack" | "forwarded" | "legacy";
    }
  | { state: "acknowledged"; reportId: string; action: AckAction }
  /** `reason` is null only for a legacy row, which never recorded one. */
  | { state: "cancelled"; via: "cancelled" | "dismissed" | "legacy"; reason: OrderReason | null };

export type OrderState = OrderStatus["state"];

export interface OrderDerivation {
  orderId: string;
  status: OrderStatus;
  /** Still needs someone: everything except acknowledged and cancelled. */
  open: boolean;
  anomalies: string[];
}

const time = (d: Date) => d.getTime();
/** Stable sort by recorded time: equal times keep their input order. */
const byRecorded = <T extends { recordedAt: Date }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => time(a.recordedAt) - time(b.recordedAt));
const latestBy = <T extends { recordedAt: Date }>(xs: readonly T[]): T | undefined =>
  byRecorded(xs).at(-1);

const LEGACY: Record<string, OrderStatus> = {
  ordered: { state: "active", rejection: null },
  collected: { state: "collected", specimenId: null },
  resulted: { state: "resulted", reportId: null, reportStatus: "legacy", review: "legacy" },
  cancelled: { state: "cancelled", via: "legacy", reason: null },
};

type Phase = "none" | "proposed" | "placed" | "on_hold" | "dismissed" | "cancelled";
/** Which order-event kinds each phase accepts, and where they lead. */
const PHASE_NEXT: Record<Phase, Partial<Record<string, Phase>>> = {
  none: { proposed: "proposed", placed: "placed", cancelled: "cancelled" },
  proposed: { placed: "placed", dismissed: "dismissed", cancelled: "cancelled" },
  placed: { on_hold: "on_hold", cancelled: "cancelled" },
  on_hold: { resumed: "placed", cancelled: "cancelled" },
  dismissed: {},
  cancelled: {},
};
const NEEDS_REASON = new Set(["dismissed", "cancelled", "on_hold"]);

const done = (orderId: string, status: OrderStatus, anomalies: string[]): OrderDerivation => ({
  orderId,
  status,
  open: status.state !== "acknowledged" && status.state !== "cancelled",
  anomalies,
});

export function deriveOrderStatus(order: OrderInput, records: OrderRecords = {}): OrderDerivation {
  const anomalies: string[] = [];

  if (order.lifecycle !== "events") {
    const legacy = LEGACY[order.status];
    if (!legacy) anomalies.push(`unknown legacy status '${order.status}', shown as active`);
    return done(order.id, legacy ?? LEGACY.ordered!, anomalies);
  }

  // 1. The order-event phase, walked in recorded-time order.
  let phase: Phase = "none";
  let reason: OrderReason = { code: null, hasText: false };
  for (const e of byRecorded((records.events ?? []).filter((e) => e.orderId === order.id))) {
    const next: Phase | undefined = PHASE_NEXT[phase][e.kind];
    const r = { code: e.reasonCode, hasText: e.reasonCiphertext !== null };
    if (!next) {
      anomalies.push(`'${e.kind}' ignored while ${phase}`);
      continue;
    }
    if (NEEDS_REASON.has(e.kind) && r.code === null && !r.hasText) {
      anomalies.push(`'${e.kind}' without a reason ignored`);
      continue;
    }
    phase = next;
    reason = r;
  }

  // 2. A live report outranks everything: a result is never hidden, even after a cancel.
  const reports = (records.reports ?? []).filter((r) => r.orderId === order.id);
  const chains = new Map<string, ReportInput[]>();
  for (const r of reports) chains.set(r.logicalId, [...(chains.get(r.logicalId) ?? []), r]);
  const live: { chain: ReportInput[]; ack: AckState }[] = [];
  for (const chain of chains.values()) {
    const ack = ackState(chain, records.acks ?? []);
    if (ack.kind !== "withdrawn") live.push({ chain, ack });
  }
  if (live.length > 0) {
    if (phase === "cancelled" || phase === "dismissed")
      anomalies.push(`result present on a ${phase} order; the result is shown`);
    // The least-advanced chain decides: one unacknowledged result keeps the order open.
    const RANK = {
      needs_re_ack: 0,
      needs_review: 1,
      forwarded: 1,
      not_released: 2,
      acknowledged: 3,
    } as const;
    live.sort(
      (a, b) =>
        RANK[a.ack.kind as keyof typeof RANK] - RANK[b.ack.kind as keyof typeof RANK] ||
        time(currentVersion(b.chain)!.recordedAt) - time(currentVersion(a.chain)!.recordedAt),
    );
    const { chain, ack } = live[0]!;
    const cur = currentVersion(chain)!;
    if (ack.kind === "acknowledged")
      return done(
        order.id,
        { state: "acknowledged", reportId: cur.id, action: ack.action },
        anomalies,
      );
    return done(
      order.id,
      {
        state: "resulted",
        reportId: cur.id,
        reportStatus: cur.status as ReportStatus,
        review: ack.kind as "not_released" | "needs_review" | "needs_re_ack" | "forwarded",
      },
      anomalies,
    );
  }

  if (phase === "cancelled" || phase === "dismissed")
    return done(order.id, { state: "cancelled", via: phase, reason }, anomalies);
  if (phase === "on_hold") return done(order.id, { state: "on_hold", reason }, anomalies);

  // 3. The specimen: the newest collection and its newest event.
  const specimen = latestBy((records.specimens ?? []).filter((s) => s.orderId === order.id));
  if (specimen) {
    const ev = latestBy((records.specimenEvents ?? []).filter((e) => e.specimenId === specimen.id));
    if (!ev) return done(order.id, { state: "collected", specimenId: specimen.id }, anomalies);
    if (ev.kind === "received")
      return done(order.id, { state: "in_progress", specimenId: specimen.id }, anomalies);
    const rejection = {
      specimenId: specimen.id,
      reasonCode: ev.reasonCode ?? "unknown",
      at: ev.recordedAt,
    };
    return done(order.id, { state: "active", rejection }, anomalies);
  }

  if (phase === "proposed") return done(order.id, { state: "proposed" }, anomalies);
  // Placed, or an order row with no events yet: it exists, so it is open.
  return done(order.id, { state: "active", rejection: null }, anomalies);
}

/* ─── Display text ──────────────────────────────────────────────────── */

export const REJECTION_REASON_TEXT: Record<string, string> = {
  haemolysed: "haemolysed",
  clotted: "clotted",
  insufficient: "insufficient",
  unlabelled_or_mislabelled: "unlabelled or mislabelled",
  wrong_container: "wrong container",
  delayed: "delayed",
};

/** Words for the status chip. Every state has text; colour is never the only signal. */
export function orderStatusText(status: OrderStatus, kind: string): string {
  switch (status.state) {
    case "proposed":
      return "Suggested — not yet accepted";
    case "active":
      if (status.rejection)
        return `Rejected: ${REJECTION_REASON_TEXT[status.rejection.reasonCode] ?? status.rejection.reasonCode} — recollect`;
      return kind === "lab" || kind === "bloods" ? "To collect" : "Ordered";
    case "on_hold":
      return "On hold";
    case "collected":
      return "Collected";
    case "in_progress":
      return "Received by the laboratory";
    case "resulted":
      if (status.review === "needs_re_ack") return "Amended — acknowledge again";
      if (status.review === "not_released") return "Preliminary result";
      if (status.review === "legacy") return "Resulted";
      if (status.review === "forwarded") return "Forwarded — awaiting acknowledgement";
      return "Result available — awaiting acknowledgement";
    case "acknowledged":
      return `Acknowledged (${status.action})`;
    case "cancelled":
      if (status.via === "dismissed") return "Suggestion dismissed";
      return status.via === "legacy" ? "Cancelled (reason not recorded)" : "Cancelled";
  }
}

/* ─── Fasting chip ──────────────────────────────────────────────────── */

const needsFasting = (conceptId: string): boolean =>
  Object.hasOwn(CONCEPTS, conceptId) &&
  (CONCEPTS[conceptId as keyof typeof CONCEPTS].contextRequired as readonly string[]).includes(
    "fastingState",
  );

/** Collection asks for the fasting chip when the test (or the order's copy of it) requires
 *  fasting, or any component concept needs `fastingState` as context. */
export function needsFastingChip(
  order: { fastingRequired: boolean | null },
  test: Pick<TestCatalogueEntry, "fastingRequired" | "components"> | null,
): boolean {
  return (
    order.fastingRequired === true ||
    test?.fastingRequired === true ||
    (test?.components ?? []).some(needsFasting)
  );
}
