/**
 * The clinic floor model (docs/clinic-floor/gate-a-proposal.md, ADRs 0491–0495) — PURE: no I/O, no clock of its
 * own. Folds today's visits and the append-only `clinic_floor_events` into one step per visit (CF11), the line
 * order (D-CF-02), re-checks due (the engine's band, D-CF-20), the waiting-room feed (D-CF-03) and the floor's
 * numbers (D-CF-18). It holds no triage rule: levels and re-check bands arrive from the engine's record.
 */
import type { RecheckBand } from "@/lib/triage/recommend";
import type { AcuityLevel } from "@/lib/triage/types";

import { RECHECK_DUE_MINUTES } from "@/lib/triage/recommend";

export const FLOOR_STEPS = ["triage", "line", "called", "with", "tests", "done"] as const;
export type FloorStep = (typeof FLOOR_STEPS)[number];

export const EVENT_KINDS = [
  "triaged",
  "rechecked",
  "call",
  "call_again",
  "here",
  "didnt_come",
  "doctor_status",
  "sent_for_tests",
  "finish",
  "running_late",
  "end_session",
  "moved",
  "user_switch",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type DoctorStatus = "in_room" | "break_10" | "break_15" | "break_30" | "away";
export type Outcome = "home" | "pharmacy_home" | "tests_back" | "admitted" | "referred";

export interface FloorEvent {
  intakeId: string | null;
  kind: EventKind;
  detail: string | null;
  doctorUserId: string | null;
  departmentId: string | null;
  room: string | null;
  at: number;
  /** Running late ("30 min"), handover note; never clinical. */
  note?: string | null;
}

/** A visit as the loader reads it (an open or today's `patient_intakes` row and its latest triage record). */
export interface FloorVisit {
  intakeId: string;
  /** Booking code: the only thing the waiting-room screen may show of a person. */
  code: string | null;
  departmentId: string | null;
  doctorUserId: string | null;
  /** Presence at the desk (check-in). */
  arrivedAt: number;
  /** The desk sent them to triage (otherwise straight to the clinic line). */
  needsTriage: boolean;
  /** The engine's level as assigned on the latest triage record; null when not triaged. */
  level: AcuityLevel | null;
  triagedAt: number | null;
  /** The engine's re-check band from that record (`recommend()`'s `monitor_interval`). */
  recheck: RecheckBand | null;
  /** Desk keyword hint (CF6): orders the triage worklist only, never a level. */
  deskFlag: boolean;
  /** Released results for this patient, epoch ms (lab workflow). */
  resultsReleasedAt: number[];
}

export interface FloorRow extends FloorVisit {
  step: FloorStep;
  /** When they entered the current step. */
  since: number;
  doctorUserId: string | null;
  room: string | null;
  calls: number;
  didntCome: number;
  /** Back from tests with a released result (D-CF-15). */
  resultsReady: boolean;
  outcome: Outcome | "didnt_wait" | null;
}

/** One step per visit (CF11): the visit's events folded in time order. */
export function projectVisit(v: FloorVisit, events: readonly FloorEvent[]): FloorRow {
  const row: FloorRow = {
    ...v,
    step: v.needsTriage && v.level == null ? "triage" : "line",
    since: v.arrivedAt,
    room: null,
    calls: 0,
    didntCome: 0,
    resultsReady: false,
    outcome: null,
  };
  if (v.level != null && v.triagedAt != null && row.step === "line") row.since = v.triagedAt;
  let testsAt: number | null = null;
  const mine = events.filter((e) => e.intakeId === v.intakeId).sort((a, b) => a.at - b.at);
  for (const e of mine) {
    if (row.step === "done") break;
    switch (e.kind) {
      case "call":
      case "call_again":
        row.step = "called";
        row.calls += 1;
        row.room = e.room ?? row.room;
        row.doctorUserId = e.doctorUserId ?? row.doctorUserId;
        if (e.kind === "call") row.since = e.at;
        break;
      case "here":
        row.step = "with";
        row.since = e.at;
        row.resultsReady = false;
        break;
      case "didnt_come":
        row.didntCome += 1;
        row.step = row.didntCome >= 2 ? "done" : "line";
        row.since = e.at;
        if (row.step === "done") row.outcome = "didnt_wait";
        break;
      case "sent_for_tests":
        row.step = "tests";
        row.since = e.at;
        testsAt = e.at;
        break;
      case "finish":
        row.step = "done";
        row.since = e.at;
        row.outcome = (e.detail as Outcome | null) ?? null;
        break;
      case "moved":
        row.step = "line";
        row.since = e.at;
        row.doctorUserId = e.doctorUserId;
        break;
      case "triaged":
      case "rechecked":
        if (row.step === "triage") {
          row.step = "line";
          row.since = e.at;
        }
        break;
      default:
        break;
    }
  }
  if (row.step === "tests" && testsAt != null) {
    const back = v.resultsReleasedAt.filter((t) => t >= testsAt!).sort((a, b) => a - b)[0];
    if (back != null) {
      row.step = "line";
      row.since = back;
      row.resultsReady = true;
    }
  }
  return row;
}

export function projectFloor(
  visits: readonly FloorVisit[],
  events: readonly FloorEvent[],
): FloorRow[] {
  return visits.map((v) => projectVisit(v, events));
}

/**
 * D-CF-02: most urgent engine level first, back from tests before the lowest levels (after L3), then by arrival.
 * Not triaged (straight from the desk) sits with L4. Didn't come once: the end of their group (D-CF-04).
 */
export function lineRank(r: FloorRow): number {
  if (r.resultsReady) return 3.5;
  return r.level ?? 4;
}

export function lineOrder(rows: readonly FloorRow[]): FloorRow[] {
  return rows
    .filter((r) => r.step === "line")
    .slice()
    .sort(
      (a, b) =>
        lineRank(a) - lineRank(b) ||
        Math.min(a.didntCome, 1) - Math.min(b.didntCome, 1) ||
        a.arrivedAt - b.arrivedAt,
    );
}

/** Triage worklist (CF6): desk-flagged first ("Look at first"), then arrival. The flag never touches a level. */
export function triageOrder(rows: readonly FloorRow[]): FloorRow[] {
  return rows
    .filter((r) => r.step === "triage")
    .slice()
    .sort((a, b) => Number(b.deskFlag) - Number(a.deskFlag) || a.arrivedAt - b.arrivedAt);
}

/** Re-check due time from the engine's band (D-CF-20); null when the band asks for none on this floor. */
export function recheckDueAt(r: FloorRow): number | null {
  if (r.recheck == null || r.triagedAt == null) return null;
  if (r.step !== "line" && r.step !== "called") return null;
  const min = RECHECK_DUE_MINUTES[r.recheck];
  return min == null ? null : r.triagedAt + min * 60_000;
}

/* ─── doctor status (D-CF-09) ─────────────────────────────────────────── */

export interface DoctorState {
  doctorUserId: string;
  status: DoctorStatus;
  room: string | null;
  /** End of a short break, epoch ms. Never shown to patients. */
  until: number | null;
}

const BREAK_MIN: Partial<Record<DoctorStatus, number>> = {
  break_10: 10,
  break_15: 15,
  break_30: 30,
};

export function doctorStates(events: readonly FloorEvent[]): Map<string, DoctorState> {
  const out = new Map<string, DoctorState>();
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.kind !== "doctor_status" || !e.doctorUserId) continue;
    const status = (e.detail ?? "in_room") as DoctorStatus;
    const mins = BREAK_MIN[status];
    out.set(e.doctorUserId, {
      doctorUserId: e.doctorUserId,
      status,
      room: e.room ?? out.get(e.doctorUserId)?.room ?? null,
      until: mins ? e.at + mins * 60_000 : null,
    });
  }
  return out;
}

/** Calls are blocked unless the doctor is In room (S13). No status yet counts as In room. */
export function canCall(state: DoctorState | undefined): boolean {
  return !state || state.status === "in_room";
}

/* ─── waiting-room screen (D-CF-03, ADR 0084) ─────────────────────────── */

/** The ONLY shape the screen receives: no name, phone, position, wait or count (S3). */
export interface ScreenItem {
  code: string;
  room: string | null;
  calledAt: number;
}
export interface ScreenFeed {
  now: ScreenItem[];
  recent: ScreenItem[];
  /** Rooms whose doctor is on a short break or called away. */
  paused: { room: string; status: "break" | "away" }[];
}

export function screenFeed(
  rows: readonly FloorRow[],
  doctors: ReadonlyMap<string, DoctorState>,
  recentMax = 4,
): ScreenFeed {
  const item = (r: FloorRow): ScreenItem => ({ code: r.code!, room: r.room, calledAt: r.since });
  const withCode = rows.filter((r) => r.code);
  const now = withCode.filter((r) => r.step === "called").sort((a, b) => b.since - a.since);
  const recent = withCode
    .filter((r) => r.step === "with" && r.calls > 0)
    .sort((a, b) => b.since - a.since)
    .slice(0, recentMax);
  const paused = [...doctors.values()]
    .filter((d) => d.status !== "in_room" && d.room)
    .map((d) => ({
      room: d.room!,
      status: d.status === "away" ? ("away" as const) : ("break" as const),
    }));
  return { now: now.map(item), recent: recent.map(item), paused };
}

/* ─── floor numbers (D-CF-18): computed, never typed ─────────────────── */

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Shown only after this many completions today (D-CF-18). */
export const MEDIAN_MIN_SAMPLES = 3;

export interface FloorMetrics {
  count: Record<FloorStep, number>;
  /** Longest time in each step now, ms. */
  longest: Record<FloorStep, number>;
  /** The step with the longest wait among the live steps (relative only, CF5). */
  slowest: FloorStep | null;
  /** ms; null until MEDIAN_MIN_SAMPLES triages today. */
  medianTriage: number | null;
  /** ms; null until MEDIAN_MIN_SAMPLES visits finished today. */
  medianVisit: number | null;
  /** waiting for triage × median triage time, ms; null while the median is hidden. */
  clearTriageIn: number | null;
}

export function floorMetrics(
  rows: readonly FloorRow[],
  events: readonly FloorEvent[],
  now: number,
): FloorMetrics {
  const count = Object.fromEntries(FLOOR_STEPS.map((s) => [s, 0])) as Record<FloorStep, number>;
  const longest = Object.fromEntries(FLOOR_STEPS.map((s) => [s, 0])) as Record<FloorStep, number>;
  for (const r of rows) {
    count[r.step] += 1;
    if (r.step !== "done") longest[r.step] = Math.max(longest[r.step], now - r.since);
  }
  const live = FLOOR_STEPS.filter((s) => s !== "done" && count[s] > 0);
  const slowest = live.length ? live.reduce((a, b) => (longest[b] > longest[a] ? b : a)) : null;

  const triageDur = rows
    .filter((r) => r.needsTriage && r.triagedAt != null)
    .map((r) => r.triagedAt! - r.arrivedAt);
  const hereAt = new Map<string, number>();
  const visitDur: number[] = [];
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (!e.intakeId) continue;
    if (e.kind === "here") hereAt.set(e.intakeId, e.at);
    if (e.kind === "finish" && hereAt.has(e.intakeId))
      visitDur.push(e.at - hereAt.get(e.intakeId)!);
  }
  const medianTriage = triageDur.length >= MEDIAN_MIN_SAMPLES ? median(triageDur) : null;
  const medianVisit = visitDur.length >= MEDIAN_MIN_SAMPLES ? median(visitDur) : null;
  return {
    count,
    longest,
    slowest,
    medianTriage,
    medianVisit,
    clearTriageIn: medianTriage == null ? null : count.triage * medianTriage,
  };
}
