import type { CriticalRef } from "./reference/critical";
import type { DiagnosticReport, ResultAcknowledgement } from "@/db/schema/emr";
import type { ClinicalObservation } from "@/db/schema/nurse-workspace";
import type { RefEntry } from "@/lib/resus/reference/ref";

import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { CRITICAL_REFS, REF_CRIT_TIMEFRAME, signedNumber } from "./reference/critical";

/**
 * Results engine (pure; PROMPT §6, D-EMR-06/07/08). Report status and its transitions, the
 * abnormal flag from the performing laboratory's own range, critical detection from signed
 * REF-CRIT entries only, acknowledgement per report version and critical escalation.
 *
 * Nothing here holds a clinical number: ranges come from the lab (per result), critical limits
 * and the escalation time frame from signed reference entries. Unsigned → no flag, no clock,
 * and the state says so rather than reading as "fine".
 */

/* ─── Report status ─────────────────────────────────────────────────── */

export type ReportStatus =
  | "preliminary"
  | "final"
  | "amended"
  | "corrected"
  | "cancelled"
  | "entered_in_error";

const NEXT_STATUS: Record<ReportStatus, readonly ReportStatus[]> = {
  preliminary: ["preliminary", "final", "cancelled", "entered_in_error"],
  final: ["amended", "corrected", "entered_in_error"],
  amended: ["amended", "corrected", "entered_in_error"],
  corrected: ["amended", "corrected", "entered_in_error"],
  cancelled: [],
  entered_in_error: [],
};

/** May a new report version with status `to` supersede one with `from` (null = first version)? */
export function canTransitionReport(from: ReportStatus | null, to: ReportStatus): boolean {
  if (from === null) return to === "preliminary" || to === "final";
  return NEXT_STATUS[from].includes(to);
}

export type ReportVersion = Pick<
  DiagnosticReport,
  "id" | "logicalId" | "version" | "status" | "recordedAt"
>;

/** The newest version of one report chain (highest version; recorded time breaks a tie). */
export function currentVersion<T extends Pick<ReportVersion, "version" | "recordedAt">>(
  chain: readonly T[],
): T | null {
  let best: T | null = null;
  for (const v of chain) {
    if (
      !best ||
      v.version > best.version ||
      (v.version === best.version && v.recordedAt.getTime() > best.recordedAt.getTime())
    )
      best = v;
  }
  return best;
}

export function isWithdrawn(status: string): status is "cancelled" | "entered_in_error" {
  return status === "cancelled" || status === "entered_in_error";
}

/* ─── Trust (D-EMR-08) ──────────────────────────────────────────────── */

export function resultTrust(
  r: Pick<DiagnosticReport, "entryMode" | "status" | "source" | "verifiedByUserId">,
): 3 | 4 {
  if (r.entryMode === "interface") return 4;
  if (r.source === "poc_staff") return 3;
  if (r.entryMode === "transcribed") return r.verifiedByUserId ? 4 : 3;
  return r.status === "preliminary" ? 3 : 4;
}

/* ─── Values: interpretable, flag, critical ─────────────────────────── */

export type ResultValue = Pick<
  ClinicalObservation,
  "conceptId" | "valueNum" | "valueComparator" | "valueUnit" | "valueCanonical" | "context"
>;

/** Uncatalogued results are displayed as typed and never interpreted (CFC C2). */
export function isInterpretable(conceptId: string | null, uncatalogued = false): boolean {
  return (
    !uncatalogued &&
    conceptId !== null &&
    conceptId !== "obs.uncatalogued" &&
    Object.hasOwn(CONCEPTS, conceptId)
  );
}

export type LabInterpretation = "L" | "H" | "LL" | "HH" | "N" | "A";
const LAB_INTERPRETATIONS: readonly string[] = ["L", "H", "LL", "HH", "N", "A"];
export interface LabRange {
  low: number | null;
  high: number | null;
  unit: string;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const finite = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
const toNumber = (x: string | number | null): number | null =>
  x === null || (typeof x === "string" && x.trim() === "") ? null : finite(Number(x));

/** The lab's range and flag from `context`. A `medsync` range is ignored: MedSync never
 *  supplies a range (emr-clinical-reference §7.3). */
export function readLabContext(context: unknown): {
  labInterpretation: LabInterpretation | null;
  referenceRange: LabRange | null;
} {
  const c = isRecord(context) ? context : {};
  const li = c.labInterpretation;
  const labInterpretation =
    typeof li === "string" && LAB_INTERPRETATIONS.includes(li) ? (li as LabInterpretation) : null;
  const rr = c.referenceRange;
  let referenceRange: LabRange | null = null;
  if (isRecord(rr) && rr.source === "lab" && typeof rr.unit === "string") {
    const low = finite(rr.low);
    const high = finite(rr.high);
    const wellFormed =
      (low !== null || high !== null) && (low === null || high === null || low <= high);
    if (wellFormed) referenceRange = { low, high, unit: rr.unit };
  }
  return { labInterpretation, referenceRange };
}

/** The set a reported value stands for: "<0.5" is every x below 0.5, never 0.5 itself. */
interface Interval {
  lo: number;
  loOpen: boolean;
  hi: number;
  hiOpen: boolean;
}
function toInterval(v: number, comparator: string | null): Interval | null {
  switch (comparator) {
    case null:
      return { lo: v, loOpen: false, hi: v, hiOpen: false };
    case "<":
      return { lo: -Infinity, loOpen: true, hi: v, hiOpen: true };
    case "<=":
      return { lo: -Infinity, loOpen: true, hi: v, hiOpen: false };
    case ">":
      return { lo: v, loOpen: true, hi: Infinity, hiOpen: true };
    case ">=":
      return { lo: v, loOpen: false, hi: Infinity, hiOpen: true };
    default:
      return null;
  }
}
type Op = "<" | "<=" | ">" | ">=";
/** Does every value in `i` satisfy `x op t`? */
function all(i: Interval, op: Op, t: number): boolean {
  if (op === "<") return i.hi < t || (i.hi === t && i.hiOpen);
  if (op === "<=") return i.hi <= t;
  if (op === ">") return i.lo > t || (i.lo === t && i.loOpen);
  return i.lo >= t;
}
/** Does some value in `i` satisfy `x op t`? */
function some(i: Interval, op: Op, t: number): boolean {
  if (op === "<") return i.lo < t;
  if (op === "<=") return i.lo < t || (i.lo === t && !i.loOpen);
  if (op === ">") return i.hi > t;
  return i.hi > t || (i.hi === t && !i.hiOpen);
}

export type FlagBasis =
  | "lab_interpretation"
  | "lab_range"
  | "indeterminate"
  | "no_range"
  | "unit_mismatch"
  | "not_numeric"
  | "not_interpretable";
export interface LabFlagResult {
  flag: LabInterpretation | null;
  basis: FlagBasis;
  /** Shown as text beside the value; never a colour on its own. */
  text: string | null;
}

const INTERPRETATION_TEXT: Record<LabInterpretation, string> = {
  L: "low",
  H: "high",
  LL: "critical (low)",
  HH: "critical (high)",
  N: "normal",
  A: "abnormal",
};
const RANGE_TEXT: Record<"L" | "H" | "N", string> = {
  L: "Low (laboratory range)",
  H: "High (laboratory range)",
  N: "Within laboratory range",
};

const fromInterpretation = (li: LabInterpretation): LabFlagResult => ({
  flag: li,
  basis: "lab_interpretation",
  text: `Lab flag: ${INTERPRETATION_TEXT[li]}`,
});
const noFlag = (basis: FlagBasis): LabFlagResult => ({ flag: null, basis, text: null });

/** The abnormal flag: the lab's own interpretation wins; otherwise the lab's own range; with no
 *  range there is no flag. */
export function labFlag(value: ResultValue): LabFlagResult {
  const { labInterpretation, referenceRange } = readLabContext(value.context);
  if (labInterpretation) return fromInterpretation(labInterpretation);
  if (!referenceRange) return noFlag("no_range");
  const n = toNumber(value.valueNum);
  const i = n === null ? null : toInterval(n, value.valueComparator);
  if (!i) return noFlag("not_numeric");
  if (value.valueUnit !== referenceRange.unit) return noFlag("unit_mismatch");
  const { low, high } = referenceRange;
  if (low !== null && all(i, "<", low))
    return { flag: "L", basis: "lab_range", text: RANGE_TEXT.L };
  if (high !== null && all(i, ">", high))
    return { flag: "H", basis: "lab_range", text: RANGE_TEXT.H };
  if ((low === null || all(i, ">=", low)) && (high === null || all(i, "<=", high)))
    return { flag: "N", basis: "lab_range", text: RANGE_TEXT.N };
  return noFlag("indeterminate");
}

export type CriticalBasis =
  | "critical"
  | "not_critical"
  /** A comparator value ("<2.0") straddles a signed limit: it may be critical. */
  | "indeterminate"
  | "no_signed_entry"
  | "not_numeric"
  | "not_interpretable";
export interface CriticalResult {
  isCritical: boolean;
  ruleId: string | null;
  basis: CriticalBasis;
}

/** Critical ONLY from a signed REF-CRIT entry, compared in the concept's canonical unit. */
export function detectCritical(
  value: ResultValue,
  refs: readonly CriticalRef[] = CRITICAL_REFS,
): CriticalResult {
  const no = (basis: CriticalBasis, ruleId: string | null = null): CriticalResult => ({
    isCritical: false,
    ruleId,
    basis,
  });
  if (!isInterpretable(value.conceptId)) return no("not_interpretable");
  const signed = refs.flatMap((r) => {
    const t = r.conceptId === value.conceptId ? signedNumber(r) : null;
    return t === null ? [] : [{ r, t }];
  });
  if (signed.length === 0) return no("no_signed_entry");
  const n = toNumber(value.valueCanonical);
  const i = n === null ? null : toInterval(n, value.valueComparator);
  if (!i) return no("not_numeric");
  let maybe: string | null = null;
  for (const { r, t } of signed) {
    if (all(i, r.operator, t)) return { isCritical: true, ruleId: r.id, basis: "critical" };
    if (some(i, r.operator, t)) maybe ??= r.id;
  }
  return maybe ? no("indeterminate", maybe) : no("not_critical");
}

export interface ResultInterpretation {
  interpretable: boolean;
  flag: LabFlagResult;
  critical: CriticalResult;
}

/** One value, ready to display. An uncatalogued value keeps only the lab's own flag text. */
export function interpretResult(
  value: ResultValue,
  opts: { uncatalogued?: boolean; criticalRefs?: readonly CriticalRef[] } = {},
): ResultInterpretation {
  if (!isInterpretable(value.conceptId, opts.uncatalogued)) {
    const { labInterpretation } = readLabContext(value.context);
    return {
      interpretable: false,
      flag: labInterpretation ? fromInterpretation(labInterpretation) : noFlag("not_interpretable"),
      critical: { isCritical: false, ruleId: null, basis: "not_interpretable" },
    };
  }
  return {
    interpretable: true,
    flag: labFlag(value),
    critical: detectCritical(value, opts.criticalRefs),
  };
}

/* ─── Acknowledgement (D-EMR-07) ────────────────────────────────────── */

export type AckAction = "seen" | "acted" | "forwarded";
const ACK_ACTIONS: readonly string[] = ["seen", "acted", "forwarded"];

export type Ack = Pick<
  ResultAcknowledgement,
  "reportId" | "action" | "acknowledgedByUserId" | "forwardedToUserId" | "recordedAt"
>;

export type AckState =
  /** Preliminary, not acknowledged: not yet in Results to review. */
  | { kind: "not_released" }
  | { kind: "withdrawn"; status: "cancelled" | "entered_in_error" }
  | { kind: "needs_review" }
  /** A later version (amended, corrected) of a report already acknowledged. */
  | { kind: "needs_re_ack"; previousAction: AckAction }
  /** Handed to a colleague: still open work (theirs), and a critical clock keeps running. */
  | { kind: "forwarded"; toUserId: string | null; byUserId: string; at: Date }
  | {
      kind: "acknowledged";
      action: AckAction;
      byUserId: string;
      at: Date;
      forwardedToUserId: string | null;
    };

function latestAck(acks: readonly Ack[], reportIds: ReadonlySet<string>): Ack | null {
  let best: Ack | null = null;
  for (const a of acks) {
    if (!reportIds.has(a.reportId) || !ACK_ACTIONS.includes(a.action)) continue;
    if (!best || a.recordedAt.getTime() >= best.recordedAt.getTime()) best = a;
  }
  return best;
}

/** Acknowledgement is per version: an ack of an earlier version never covers the current one. */
export function ackState(chain: readonly ReportVersion[], acks: readonly Ack[]): AckState {
  const current = currentVersion(chain);
  if (!current) throw new Error("ackState: empty report chain");
  if (isWithdrawn(current.status)) return { kind: "withdrawn", status: current.status };
  const mine = latestAck(acks, new Set([current.id]));
  // A forward hands the result over; only seen or acted closes it.
  if (mine?.action === "forwarded")
    return {
      kind: "forwarded",
      toUserId: mine.forwardedToUserId,
      byUserId: mine.acknowledgedByUserId,
      at: mine.recordedAt,
    };
  if (mine)
    return {
      kind: "acknowledged",
      action: mine.action as AckAction,
      byUserId: mine.acknowledgedByUserId,
      at: mine.recordedAt,
      forwardedToUserId: mine.forwardedToUserId,
    };
  if (current.status === "preliminary") return { kind: "not_released" };
  const earlier = latestAck(
    acks,
    new Set(chain.filter((v) => v.id !== current.id).map((v) => v.id)),
  );
  return earlier
    ? { kind: "needs_re_ack", previousAction: earlier.action as AckAction }
    : { kind: "needs_review" };
}

/* ─── Critical escalation (D-EMR-06) ────────────────────────────────── */

export type EscalationState =
  | { kind: "not_applicable" }
  | { kind: "acknowledged" }
  /** REF-CRIT-TIMEFRAME is unsigned: there is no clock, and this is never read as "fine". */
  | { kind: "timeframe_not_signed" }
  | { kind: "within_timeframe"; dueAt: Date }
  | { kind: "escalate"; to: "in_charge"; dueAt: Date };

/** The clock runs from the current version becoming available (its recorded time). */
export function escalationState(input: {
  isCritical: boolean;
  chain: readonly ReportVersion[];
  acks: readonly Ack[];
  now: Date;
  timeframe?: RefEntry;
}): EscalationState {
  if (!input.isCritical) return { kind: "not_applicable" };
  const ack = ackState(input.chain, input.acks);
  if (ack.kind === "withdrawn") return { kind: "not_applicable" };
  if (ack.kind === "acknowledged") return { kind: "acknowledged" };
  const tf = input.timeframe ?? REF_CRIT_TIMEFRAME;
  const minutes = tf.unit === "min" ? signedNumber(tf) : null;
  if (minutes === null || minutes < 0) return { kind: "timeframe_not_signed" };
  const current = currentVersion(input.chain)!;
  const dueAt = new Date(current.recordedAt.getTime() + minutes * 60_000);
  return input.now.getTime() >= dueAt.getTime()
    ? { kind: "escalate", to: "in_charge", dueAt }
    : { kind: "within_timeframe", dueAt };
}
