/**
 * Lab reports and quality indicators (Lab Phase 3 §6.12, QI-1..QI-4; GATE A P13, E-LAB3-06). Pure.
 *
 * Computed from source rows at read time for a period [from, to) and one hospital; the as-of time is returned.
 * A zero denominator or no source rows is `no_data`, never 0 % (QI-2, Law 7). Breakdowns (by section, test, ward,
 * priority) are the same functions over a filtered set of rows. Downtime results carry their form times.
 */
import type { EqaRound } from "@/lib/lab/eqa";
import type { StockItem, StockTx } from "@/lib/lab/stock";

import { addDays, dayOf, daysOutOfStock } from "@/lib/lab/stock";
import { releasedTurnaround } from "@/lib/lab/turnaround";

export const INDICATORS = [
  { id: "workload", name: "Tests released", unit: "count", wgLeps: null },
  { id: "tat_p50", name: "Turnaround, median", unit: "min", wgLeps: null },
  { id: "tat_p90", name: "Turnaround, 90th percentile", unit: "min", wgLeps: null },
  { id: "late_pct", name: "Late reports", unit: "%", wgLeps: "Post-OutTime" },
  { id: "reject_pct", name: "Specimens rejected", unit: "%", wgLeps: null },
  { id: "misid_caught", name: "Wrong label caught at collection", unit: "count", wgLeps: null },
  {
    id: "crit_ack_in_time",
    name: "Criticals acknowledged in the signed time",
    unit: "%",
    wgLeps: "Post-InsCR",
  },
  {
    id: "corrected_pct",
    name: "Reports corrected after release",
    unit: "%",
    wgLeps: "Post-RectRep",
  },
  { id: "qc_reject_pct", name: "QC runs rejected", unit: "%", wgLeps: "Intra-UnIQC" },
  { id: "no_iqc", name: "Tests without IQC", unit: "%", wgLeps: "Intra-IQC" },
  { id: "eqa_unacc", name: "Unacceptable EQA results", unit: "count", wgLeps: "Intra-Unac" },
  { id: "no_eqa", name: "Tests without EQA", unit: "%", wgLeps: "Intra-EQA" },
  { id: "stockout_days", name: "Stock-out days", unit: "days", wgLeps: null },
  { id: "downtime_h", name: "Equipment downtime", unit: "h", wgLeps: null },
] as const;
export type IndicatorId = (typeof INDICATORS)[number]["id"];

export type IndicatorValue =
  | { kind: "no_data" }
  | {
      kind: "value";
      value: number;
      numerator: number;
      denominator: number | null;
      /** Per item or machine (stock-out days, downtime). */
      by?: Record<string, number>;
      /** crit_ack_in_time: median minutes to acknowledge. */
      medianMinutes?: number;
    };

export interface IndicatorInput {
  hospitalId: string;
  from: Date;
  to: Date;
  now: Date;
  timeZone: string;
  released: readonly {
    hospitalId: string;
    releasedAt: Date;
    receivedAt: Date | null;
    targetMinutes: number | null;
    amended: boolean;
  }[];
  specimens: readonly { hospitalId: string; receivedAt: Date; rejected: boolean }[];
  identityChecks: readonly { hospitalId: string; at: Date; mismatch: boolean }[];
  criticalAlerts: readonly {
    hospitalId: string;
    sentAt: Date;
    dueAt: Date | null;
    acknowledgedAt: Date | null;
  }[];
  qcRuns: readonly {
    hospitalId: string;
    runAt: Date;
    decision: "accepted" | "warning" | "rejected";
  }[];
  /** Orderable in-house tests, and those with a QC plan or kit rule in force. */
  inHouseTests: readonly string[];
  testsWithIqc: readonly string[];
  eqaRounds: readonly EqaRound[];
  /** From `eqaCoverage` (EA-5). */
  eqaCoverage: readonly { testCode: string; covered: "scheme" | "alternative" | "none" }[];
  stockItems: readonly StockItem[];
  stockTxs: readonly StockTx[];
  devices: readonly { hospitalId: string; id: string }[];
  breakdowns: readonly { hospitalId: string; deviceId: string; since: Date; backAt: Date | null }[];
}

export const NO_DATA = { kind: "no_data" } as const;
/** QI-2: a zero denominator is `no_data`, never 0 %. */
export const pct = (numerator: number, denominator: number): IndicatorValue =>
  denominator === 0
    ? NO_DATA
    : { kind: "value", value: (numerator / denominator) * 100, numerator, denominator };
/** QI-2: no source rows is `no_data`, never 0. */
export const count = (numerator: number, sourceRows: number): IndicatorValue =>
  sourceRows === 0 ? NO_DATA : { kind: "value", value: numerator, numerator, denominator: null };

/** Nearest-rank percentile of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

/** QI-1..QI-3: every indicator for one hospital over [from, to), with the as-of time. */
export function computeIndicators(i: IndicatorInput): {
  asOf: Date;
  values: Record<IndicatorId, IndicatorValue>;
} {
  const mine = <T extends { hospitalId: string }>(rows: readonly T[], at: (r: T) => Date) =>
    rows.filter((r) => r.hospitalId === i.hospitalId && at(r) >= i.from && at(r) < i.to);

  const released = mine(i.released, (r) => r.releasedAt);
  const tats = released
    .map((r) =>
      releasedTurnaround(
        r.receivedAt,
        r.releasedAt,
        r.targetMinutes ? { minutes: r.targetMinutes, source: "facility" } : null,
      ),
    )
    .filter((t) => t !== null);
  const withTarget = released.filter((r) => r.receivedAt && r.targetMinutes);
  const late = withTarget.filter(
    (r) =>
      releasedTurnaround(r.receivedAt, r.releasedAt, {
        minutes: r.targetMinutes!,
        source: "facility",
      })?.lateBy,
  ).length;
  const tat = (p: number): IndicatorValue => {
    if (tats.length === 0) return NO_DATA;
    const value = percentile(
      tats.map((t) => t.minutes),
      p,
    );
    return { kind: "value", value, numerator: value, denominator: tats.length };
  };

  const specimens = mine(i.specimens, (s) => s.receivedAt);
  const checks = mine(i.identityChecks, (c) => c.at);
  const alerts = mine(i.criticalAlerts, (a) => a.sentAt).filter((a) => a.dueAt);
  const acked = alerts.filter((a) => a.acknowledgedAt);
  const ackMinutes = acked.map((a) => (a.acknowledgedAt!.getTime() - a.sentAt.getTime()) / 60_000);
  const critAck = pct(acked.filter((a) => a.acknowledgedAt! <= a.dueAt!).length, alerts.length);
  const runs = mine(i.qcRuns, (r) => r.runAt);
  const fromDay = dayOf(i.from, i.timeZone);
  const toDay = dayOf(i.to, i.timeZone);
  const samples = i.eqaRounds
    .filter(
      (r) =>
        r.hospitalId === i.hospitalId && r.scoredOn && r.scoredOn >= fromDay && r.scoredOn < toDay,
    )
    .flatMap((r) => r.samples.filter((s) => s.score));

  const tracers = i.stockItems.filter((s) => s.hospitalId === i.hospitalId && s.hmisTracerCode);
  const stockout: Record<string, number> = {};
  for (const item of tracers)
    stockout[item.id] = daysOutOfStock(i.stockTxs, {
      hospitalId: i.hospitalId,
      itemId: item.id,
      fromDay,
      // Only days that have ended: the last of the period, or yesterday while the period runs.
      toDay: addDays(toDay < dayOf(i.now, i.timeZone) ? toDay : dayOf(i.now, i.timeZone), -1),
      timeZone: i.timeZone,
    }).length;
  const devices = i.devices.filter((d) => d.hospitalId === i.hospitalId);
  const downtime: Record<string, number> = Object.fromEntries(devices.map((d) => [d.id, 0]));
  for (const b of i.breakdowns) {
    if (b.hospitalId !== i.hospitalId || !(b.deviceId in downtime)) continue;
    const start = Math.max(b.since.getTime(), i.from.getTime());
    const end = Math.min((b.backAt ?? i.now).getTime(), i.to.getTime(), i.now.getTime());
    if (end > start) downtime[b.deviceId]! += (end - start) / 3_600_000;
  }
  const sum = (r: Record<string, number>) => Object.values(r).reduce((s, v) => s + v, 0);
  const noIqc = i.inHouseTests.filter((t) => !i.testsWithIqc.includes(t)).length;

  return {
    asOf: i.now,
    values: {
      workload: count(released.length, released.length),
      tat_p50: tat(50),
      tat_p90: tat(90),
      late_pct: pct(late, withTarget.length),
      reject_pct: pct(specimens.filter((s) => s.rejected).length, specimens.length),
      misid_caught: count(checks.filter((c) => c.mismatch).length, checks.length),
      crit_ack_in_time:
        critAck.kind === "value" && ackMinutes.length > 0
          ? { ...critAck, medianMinutes: percentile(ackMinutes, 50) }
          : critAck,
      corrected_pct: pct(released.filter((r) => r.amended).length, released.length),
      qc_reject_pct: pct(runs.filter((r) => r.decision === "rejected").length, runs.length),
      no_iqc: pct(noIqc, i.inHouseTests.length),
      eqa_unacc: count(samples.filter((s) => s.score === "unacceptable").length, samples.length),
      no_eqa: pct(i.eqaCoverage.filter((c) => c.covered === "none").length, i.eqaCoverage.length),
      stockout_days:
        tracers.length === 0
          ? NO_DATA
          : {
              kind: "value",
              value: sum(stockout),
              numerator: sum(stockout),
              denominator: null,
              by: stockout,
            },
      downtime_h:
        devices.length === 0
          ? NO_DATA
          : {
              kind: "value",
              value: sum(downtime),
              numerator: sum(downtime),
              denominator: null,
              by: downtime,
            },
    },
  };
}

/** QI-4: drill-down records go to lab roles only; hospital admin receives aggregates. */
export const drillDown = <T>(
  viewer: { labRole: boolean },
  records: readonly T[],
): readonly T[] | null => (viewer.labRole ? records : null);
