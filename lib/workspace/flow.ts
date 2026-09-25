/**
 * The patient flow projection (prompt §6) — PURE: no I/O, no clock, no locale
 * of its own. `lib/workspace/queries.ts` feeds it; the page renders what it
 * returns.
 *
 * One row per patient, one lane, one next step. It reconciles the visit (the
 * open intake), its triage records, the assignments — in this codebase an
 * assignment IS a `planned` encounter — open encounters, the resus v2 board's
 * episodes (its projection, not a second one) and recorded deaths.
 *
 * Nothing here closes anything (Law 3). A contradiction moves the patient to
 * Needs closing, or becomes a badge and an "Also open" item on their row, and
 * is named in `integrity`. The rule IDs FW-1…FW-11 are the prompt's; each has
 * tests in tests/workspace/flow.test.ts.
 */
import type { LaneId } from "./lanes";

import { hospitalClock } from "./clock";
import { LANES } from "./lanes";
import { ago } from "./words";

export { ago, COLOUR_WORD } from "./words";

export type Acuity = 1 | 2 | 3 | 4 | 5;

/* ─── input ─────────────────────────────────────────────────────────── */

export interface FlowIdentity {
  /** The audited reveal (fail closed): null → the MRN titles the row. */
  name: string | null;
  /** MRN, `patient_profiles.patient_code`. */
  code: string | null;
  ageYears: number | null;
  sex: string | null;
  /** An emergency arrival with no account yet: the desk's label. */
  unknownLabel: string | null;
}

/** The visit: an open `patient_intakes` row. */
export interface FlowIntake {
  id: string;
  patientId: string | null;
  status: "arrived" | "awaiting_triage" | "triaged";
  departmentId: string | null;
  appointmentId: string | null;
  /** Presence, not declaration (`coalesce(checked_in_at, arrived_at)`). */
  presentAtMs: number;
  complaint: string | null;
  entryType: string;
  isEmergency: boolean;
  unknownLabel: string | null;
}

export interface FlowTriage {
  id: string;
  intakeId: string | null;
  patientId: string | null;
  level: Acuity;
  atMs: number;
  byName: string | null;
  /** Step-0 life threat fast-tracked. */
  lifeThreat: boolean;
  /** The engine's first reason, for the panel ("RR 28 · SpO₂ 91% on air"). */
  why: string | null;
  /** Some resus episode was opened from this triage record (FW-5). */
  hasResus: boolean;
}

export interface FlowEncounter {
  id: string;
  patientId: string;
  clinicianId: string;
  clinicianName: string | null;
  departmentId: string | null;
  /** `planned` = an assignment waiting to be started. */
  state: "planned" | "in_progress" | "completed";
  triageRecordId: string | null;
  appointmentId: string | null;
  /** When it was assigned (planned) or opened. */
  createdAtMs: number;
  startedAtMs: number;
  endedAtMs: number | null;
  /** greatest(updated_at, latest documentation version). */
  lastActivityAtMs: number;
}

/** The resus v2 board's own section for the episode (lib/resus/board-v2.ts). */
export type ResusSection = "arrest" | "active" | "boarding" | "needs_closing" | "ended";

export interface FlowResus {
  id: string;
  patientId: string | null;
  section: ResusSection;
  /** "Survey", "Arrest", "Post-ROSC", "Boarding", "Resuscitation stopped", … */
  mode: string;
  trigger: string;
  startedAtMs: number;
  lastActivityAtMs: number;
  endedAtMs: number | null;
  arrestSinceMs: number | null;
  leader: string | null;
  /** "No activity 13 d 1 h" when the board counts it idle. */
  idleLabel: string | null;
  /** Ended episodes: "Died", "Stabilised", "Closed administratively", … */
  outcome: string | null;
  /** The worst survey step, for the board's StepChip. */
  worst: { step: string; visual: string } | null;
}

/** A recorded death: the resus record or an encounter disposition (D2 — read, not copied). */
export interface FlowDeath {
  patientId: string;
  atMs: number;
  source: "resus" | "encounter";
  sourceId: string;
  byName: string | null;
}

export interface FlowViewer {
  userId: string;
  departmentId: string;
  scope: "mine" | "department";
  /** May triage and assign (`triage_patient = allowed`, D8). */
  mayAssign: boolean;
}

export interface FlowSettings {
  /** D3: an open encounter with no activity this long needs closing (24 h). */
  encounterIdleMs: number;
  /** FW-5 / D9: the resus board's "Red / L1 — open a resus" lookback (24 h). */
  l1LookbackMs: number;
}

/** A CSO-signed wait target (Law 5). Only signed entries ever reach the engine. */
export interface SignedWaitTarget {
  id: string;
  level: Acuity;
  minutes: number;
}

export interface FlowInput {
  nowMs: number;
  /** Local midnight at the hospital, for "Done today". */
  dayStartMs: number;
  /** The hospital's clock for the words the engine writes ("Died 11:06"). */
  timeZone: string;
  viewer: FlowViewer;
  settings: FlowSettings;
  signedRefs: { waitTargets: SignedWaitTarget[] };
  patients: Record<string, FlowIdentity>;
  intakes: FlowIntake[];
  triages: FlowTriage[];
  encounters: FlowEncounter[];
  resus: FlowResus[];
  deaths: FlowDeath[];
}

/* ─── output ────────────────────────────────────────────────────────── */

export type ActionKind =
  | "open_desk"
  | "triage"
  | "retriage"
  | "take"
  | "assign"
  | "start"
  | "start_override"
  | "continue"
  | "open_resus"
  | "review"
  | "view"
  | "reassign"
  | "complete"
  | "retire"
  | "close_intake"
  | "close_resus";

export interface FlowAction {
  kind: ActionKind;
  label: string;
  intakeId?: string;
  encounterId?: string;
  triageRecordId?: string;
  episodeId?: string;
}

export type Tone = "neutral" | "amber";

export interface FlowBadge {
  text: string;
  tone: Tone;
}

export type ItemKind = "intake" | "assignment" | "encounter" | "resus";

export interface OpenItem {
  id: string;
  kind: ItemKind;
  /** "Intake", "Assignment · L4", "Encounter", "Resus". */
  label: string;
  detail: string;
  /** When the item began: arrival, assignment, opening. */
  sinceMs: number;
  tone: Tone;
  actions: FlowAction[];
}

export interface TimelineEntry {
  atMs: number;
  text: string;
}

export type IntegrityKind =
  | "deceased_open_items"
  | "duplicate_assignments"
  | "stale_l1"
  | "idle_encounter"
  | "idle_resus"
  | "intake_after_visit";

export interface IntegrityFlag {
  kind: IntegrityKind;
  patientKey: string;
  itemIds: string[];
}

export interface PatientFlowRow {
  /** `p:<patientId>`, or `i:<intakeId>` / `r:<episodeId>` for an unidentified patient. */
  key: string;
  patientId: string | null;
  identity: FlowIdentity;
  lane: LaneId;
  acuity: {
    level: Acuity | null;
    atMs: number | null;
    byName: string | null;
    why: string | null;
    /** An L1 older than the lookback with no resus (FW-5). */
    stale: boolean;
  };
  /** Why they are here: the complaint, or the resus trigger. */
  reason: string | null;
  stageDetail: string;
  /** Time in stage starts here (elapsed only — Law 5). */
  sinceMs: number;
  /** FW-10: amber only past a signed target; neutral otherwise. */
  waitTone: Tone;
  primary: FlowAction | null;
  /** The source item the primary acts on (null for Review: every item is under Also open). */
  primaryItemId: string | null;
  overflow: FlowAction[];
  badges: FlowBadge[];
  alsoOpen: OpenItem[];
  timeline: TimelineEntry[];
  deceased: { atMs: number; source: FlowDeath["source"] } | null;
  /** The episode behind a Resus row (the board's row fields). */
  resus: FlowResus | null;
  /** Whose item this is: shown in Department scope. */
  owner: { name: string | null; me: boolean } | null;
  /** Every open source item this row stands for (Law 3: nothing disappears). */
  itemIds: string[];
}

export interface FlowResult {
  rows: PatientFlowRow[];
  lanes: Record<LaneId, number>;
  integrity: IntegrityFlag[];
}

/* ─── words and clocks ──────────────────────────────────────────────── */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ─── the projection ────────────────────────────────────────────────── */

const RESUS_ORDER: Record<ResusSection, number> = {
  arrest: 0,
  active: 1,
  boarding: 2,
  needs_closing: 3,
  ended: 4,
};
const LANE_ORDER = new Map(LANES.map((l, i) => [l.id, i]));

interface Bucket {
  key: string;
  patientId: string | null;
  intakes: FlowIntake[];
  encounters: FlowEncounter[];
  resus: FlowResus[];
}

interface Ctx {
  input: FlowInput;
  triageById: Map<string, FlowTriage>;
  /** Newest first. */
  triagesByIntake: Map<string, FlowTriage[]>;
  deathByPatient: Map<string, FlowDeath>;
  when: (ms: number) => string;
  sameDay: (a: number, b: number) => boolean;
}

export function computeFlow(input: FlowInput): FlowResult {
  const clock = hospitalClock(input.timeZone);
  const triagesByIntake = new Map<string, FlowTriage[]>();
  for (const t of [...input.triages].sort((a, b) => b.atMs - a.atMs || a.id.localeCompare(b.id))) {
    if (!t.intakeId) continue;
    const list = triagesByIntake.get(t.intakeId) ?? [];
    list.push(t);
    triagesByIntake.set(t.intakeId, list);
  }
  const deathByPatient = new Map<string, FlowDeath>();
  for (const d of input.deaths) {
    const prev = deathByPatient.get(d.patientId);
    if (!prev || d.atMs > prev.atMs) deathByPatient.set(d.patientId, d);
  }
  const ctx: Ctx = {
    input,
    triageById: new Map(input.triages.map((t) => [t.id, t])),
    triagesByIntake,
    deathByPatient,
    when: (ms) => clock.when(ms, input.nowMs),
    sameDay: clock.sameDay,
  };

  const rows: PatientFlowRow[] = [];
  const integrity: IntegrityFlag[] = [];
  for (const bucket of buckets(input)) {
    const built = buildRow(bucket, ctx);
    if (!built) continue;
    rows.push(built.row);
    integrity.push(...built.flags);
  }
  rows.sort(compareRows);

  const lanes = Object.fromEntries(LANES.map((l) => [l.id, 0])) as Record<LaneId, number>;
  for (const r of rows) lanes[r.lane]++;
  return { rows, lanes, integrity };
}

/** FW-1: every source grouped by patient; an unidentified arrival is its own patient. */
function buckets(input: FlowInput): Bucket[] {
  const map = new Map<string, Bucket>();
  const get = (key: string, patientId: string | null) => {
    let b = map.get(key);
    if (!b) map.set(key, (b = { key, patientId, intakes: [], encounters: [], resus: [] }));
    return b;
  };
  for (const i of input.intakes)
    get(i.patientId ? `p:${i.patientId}` : `i:${i.id}`, i.patientId).intakes.push(i);
  for (const e of input.encounters) get(`p:${e.patientId}`, e.patientId).encounters.push(e);
  for (const r of input.resus)
    get(r.patientId ? `p:${r.patientId}` : `r:${r.id}`, r.patientId).resus.push(r);
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

type IntakeState = "awaiting" | "unassigned" | "assigned" | "after_visit";

function buildRow(b: Bucket, ctx: Ctx): { row: PatientFlowRow; flags: IntegrityFlag[] } | null {
  const { input, when } = ctx;
  const { viewer, nowMs, settings } = input;
  const flags: IntegrityFlag[] = [];
  const flag = (kind: IntegrityKind, itemIds: string[]) =>
    flags.push({ kind, patientKey: b.key, itemIds });

  // FW-11: Mine never takes another clinician's items; Department adds the department's.
  const mine = (e: FlowEncounter) => e.clinicianId === viewer.userId;
  const inScope = (e: FlowEncounter) =>
    mine(e) || (viewer.scope === "department" && e.departmentId === viewer.departmentId);

  /** The visit an encounter answers: its triage's intake, its booking's, or the one present when it opened. */
  const intakeOf = (e: FlowEncounter): FlowIntake | null => {
    const t = e.triageRecordId ? ctx.triageById.get(e.triageRecordId) : undefined;
    if (t?.intakeId) return b.intakes.find((i) => i.id === t.intakeId) ?? null;
    if (e.appointmentId) return b.intakes.find((i) => i.appointmentId === e.appointmentId) ?? null;
    if (!e.triageRecordId && e.state !== "planned") {
      // Called from the queue rail before any triage link (ADR 0101 R3): that day's visit.
      return (
        b.intakes.find(
          (i) => i.presentAtMs <= e.startedAtMs && ctx.sameDay(i.presentAtMs, e.startedAtMs),
        ) ?? null
      );
    }
    return null;
  };
  const latestTriage = (i: FlowIntake | null) =>
    i ? (ctx.triagesByIntake.get(i.id)?.[0] ?? null) : null;
  /** FW-3: current acuity is the latest triage of the visit — never an older record. */
  const acuityOf = (e: FlowEncounter): FlowTriage | null =>
    latestTriage(intakeOf(e)) ??
    (e.triageRecordId ? (ctx.triageById.get(e.triageRecordId) ?? null) : null);
  /** FW-5: an L1 past the board's lookback with no resus episode. */
  const staleL1 = (t: FlowTriage | null) =>
    !!t && t.level === 1 && !t.hasResus && nowMs - t.atMs > settings.l1LookbackMs;
  const freshL1 = (t: FlowTriage | null) =>
    !!t && t.level === 1 && !t.hasResus && nowMs - t.atMs <= settings.l1LookbackMs;

  const open = b.encounters.filter((e) => e.state !== "completed");
  const planned = open.filter((e) => e.state === "planned");
  const idle = (e: FlowEncounter) => nowMs - e.lastActivityAtMs >= settings.encounterIdleMs;

  // Which open encounter answers each visit (the newest), and which visits already ended.
  const coveredBy = new Map<string, FlowEncounter>();
  for (const e of open) {
    const i = intakeOf(e);
    const prev = i ? coveredBy.get(i.id) : undefined;
    if (i && (!prev || e.createdAtMs > prev.createdAtMs)) coveredBy.set(i.id, e);
  }
  const ended = new Set(
    b.encounters
      .filter((e) => e.state === "completed")
      .map((e) => intakeOf(e)?.id)
      .filter((id): id is string => !!id),
  );
  const stateOf = (i: FlowIntake): IntakeState =>
    coveredBy.has(i.id)
      ? "assigned"
      : ended.has(i.id)
        ? "after_visit"
        : i.status !== "triaged"
          ? "awaiting"
          : "unassigned";

  const death = b.patientId ? (ctx.deathByPatient.get(b.patientId) ?? null) : null;
  const liveResus = b.resus
    .filter((r) => r.section === "arrest" || r.section === "active" || r.section === "boarding")
    .sort(
      (x, y) => RESUS_ORDER[x.section] - RESUS_ORDER[y.section] || y.startedAtMs - x.startedAtMs,
    );
  const idleResus = b.resus.filter((r) => r.section === "needs_closing");

  // FW-4: the newest assignment wins; the rest are superseded.
  const plannedByAge = [...planned].sort((x, y) => y.createdAtMs - x.createdAtMs);
  const superseded = new Set(plannedByAge.slice(1).map((e) => e.id));
  if (planned.length > 1)
    flag(
      "duplicate_assignments",
      plannedByAge.map((e) => e.id),
    );

  /* Visible open items (Law 3 + FW-11). */
  const intakeItems = b.intakes
    .map((i) => ({ i, s: stateOf(i) }))
    .filter(({ s }) => s !== "assigned")
    .filter(({ s }) => s === "awaiting" || viewer.mayAssign);
  const visibleEncounters = open.filter(inScope);
  const covered = b.intakes
    .filter((i) => {
      const e = coveredBy.get(i.id);
      return e !== undefined && inScope(e);
    })
    .map((i) => i.id);
  const itemIds = [
    ...intakeItems.map(({ i }) => i.id),
    ...visibleEncounters.map((e) => e.id),
    ...liveResus.map((r) => r.id),
    ...idleResus.map((r) => r.id),
    ...covered,
  ];
  const openCount =
    intakeItems.length + visibleEncounters.length + liveResus.length + idleResus.length;
  const doneToday = b.encounters
    .filter((e) => e.state === "completed" && inScope(e) && (e.endedAtMs ?? 0) >= input.dayStartMs)
    .sort((x, y) => (y.endedAtMs ?? 0) - (x.endedAtMs ?? 0));
  if (openCount === 0 && doneToday.length === 0) return null;

  for (const e of visibleEncounters)
    if (e.state === "in_progress" && idle(e)) flag("idle_encounter", [e.id]);
  for (const r of idleResus) flag("idle_resus", [r.id]);
  for (const { i, s } of intakeItems) if (s === "after_visit") flag("intake_after_visit", [i.id]);

  /* Live candidates, in FW-2 order. */
  const myRunning = visibleEncounters
    .filter((e) => e.state === "in_progress" && !idle(e))
    .sort((x, y) => y.lastActivityAtMs - x.lastActivityAtMs);
  const myPlanned = visibleEncounters
    .filter((e) => e.state === "planned" && !superseded.has(e.id))
    .sort((x, y) => y.createdAtMs - x.createdAtMs);
  const awaiting = intakeItems
    .filter(({ s }) => s === "awaiting")
    .map(({ i }) => i)
    .sort((x, y) => x.presentAtMs - y.presentAtMs);
  const unassigned = intakeItems
    .filter(({ s }) => s === "unassigned")
    .map(({ i }) => i)
    .sort(
      (x, y) =>
        (latestTriage(x)?.level ?? 9) - (latestTriage(y)?.level ?? 9) ||
        x.presentAtMs - y.presentAtMs,
    );
  const waitingCandidate = myPlanned.find((e) => !staleL1(acuityOf(e))) ?? null;
  const unassignedCandidate = unassigned.find((i) => !staleL1(latestTriage(i))) ?? null;
  const staleCandidate =
    myPlanned.find((e) => staleL1(acuityOf(e))) ??
    unassigned.find((i) => staleL1(latestTriage(i))) ??
    null;
  const staleTriage = staleCandidate
    ? "state" in staleCandidate
      ? acuityOf(staleCandidate)
      : latestTriage(staleCandidate)
    : null;
  if (staleCandidate) flag("stale_l1", [staleCandidate.id]);

  const identity: FlowIdentity = (b.patientId ? input.patients[b.patientId] : undefined) ?? {
    name: null,
    code: null,
    ageYears: null,
    sex: null,
    // No account (an emergency arrival), or an account whose profile could not be read: still a label.
    unknownLabel: b.patientId
      ? "Patient record unavailable"
      : (b.intakes[0]?.unknownLabel ?? "Unidentified patient"),
  };

  let lane: LaneId;
  let primaryId: string | null = null;
  let primary: FlowAction | null = null;
  let overflow: FlowAction[] = [];
  let stageDetail = "";
  let sinceMs = nowMs;
  let acuityTriage: FlowTriage | null = null;
  let stale = false;
  let reason: string | null = null;
  let resusRow: FlowResus | null = null;
  let owner: PatientFlowRow["owner"] = null;

  const review: FlowAction = { kind: "review", label: "Review" };
  const oldestSince = () =>
    Math.min(
      ...intakeItems.map(({ i }) => i.presentAtMs),
      ...visibleEncounters.map((e) => e.createdAtMs),
      ...idleResus.map((r) => r.startedAtMs),
      ...liveResus.map((r) => r.startedAtMs),
      nowMs,
    );
  const visitReason = () => b.intakes.map((i) => i.complaint).find((c): c is string => !!c) ?? null;

  if (death && openCount > 0) {
    // FW-7: a recorded death sends every open item to Needs closing; nothing to triage or start.
    lane = "needs_closing";
    primary = review;
    // The death is said once, by its badge; the stage says what is left to do.
    stageDetail = `${plural(openCount, "open item")} to close`;
    sinceMs = death.atMs;
    reason = visitReason();
    flag("deceased_open_items", itemIds);
    const startable = myPlanned[0] ?? plannedByAge.find((e) => mine(e)) ?? null;
    const triaged = unassigned[0] ?? null;
    if (startable && acuityOf(startable)) {
      overflow = [
        {
          kind: "start_override",
          label: "Start encounter…",
          encounterId: startable.id,
          triageRecordId: startable.triageRecordId ?? acuityOf(startable)!.id,
        },
      ];
    } else if (triaged && latestTriage(triaged)) {
      overflow = [
        {
          kind: "start_override",
          label: "Start encounter…",
          intakeId: triaged.id,
          triageRecordId: latestTriage(triaged)!.id,
        },
      ];
    }
  } else if (liveResus.length > 0) {
    // FW-8: resus supersedes triage — no Triage primary; a pending triage is a badge.
    const r = liveResus[0]!;
    lane = "resus";
    primaryId = r.id;
    primary = { kind: "open_desk", label: "Open desk", episodeId: r.id };
    stageDetail = `${r.mode}${r.leader ? ` · Leader ${r.leader}` : ""}`;
    sinceMs = r.startedAtMs;
    acuityTriage = b.intakes.map((i) => latestTriage(i)).find(Boolean) ?? null;
    reason = r.trigger;
    resusRow = r;
  } else if (myRunning.length > 0) {
    const e = myRunning[0]!;
    lane = "in_progress";
    primaryId = e.id;
    primary = mine(e) ? { kind: "continue", label: "Continue", encounterId: e.id } : null;
    stageDetail = mine(e) ? "Clerking" : `Clerking · ${e.clinicianName ?? "another doctor"}`;
    sinceMs = e.lastActivityAtMs;
    acuityTriage = acuityOf(e);
    reason = intakeOf(e)?.complaint ?? visitReason();
    owner = { name: e.clinicianName, me: mine(e) };
  } else if (waitingCandidate) {
    const e = waitingCandidate;
    const t = acuityOf(e);
    const visit = intakeOf(e);
    lane = "waiting";
    primaryId = e.id;
    acuityTriage = t;
    stageDetail = mine(e)
      ? "Assigned to you"
      : `Assigned to ${e.clinicianName ?? "another doctor"}`;
    sinceMs = e.createdAtMs;
    reason = visit?.complaint ?? visitReason();
    owner = { name: e.clinicianName, me: mine(e) };
    if (mine(e)) {
      const start: FlowAction = {
        kind: "start",
        label: "Start",
        encounterId: e.id,
        triageRecordId: e.triageRecordId ?? t?.id,
      };
      const reassign: FlowAction = { kind: "reassign", label: "Reassign…", encounterId: e.id };
      const retriage: FlowAction[] =
        visit && viewer.mayAssign
          ? [{ kind: "retriage", label: "Re-triage", intakeId: visit.id }]
          : [];
      if (freshL1(t)) {
        primary = openResus(visit, t);
        overflow = [start, reassign, ...retriage];
      } else {
        primary = start;
        overflow = [reassign, ...retriage];
      }
    }
  } else if (awaiting.length > 0) {
    const i = awaiting[0]!;
    lane = "triage";
    primaryId = i.id;
    primary = viewer.mayAssign ? { kind: "triage", label: "Triage", intakeId: i.id } : null;
    stageDetail = `${i.entryType}${i.isEmergency ? " · emergency" : ""}`;
    sinceMs = i.presentAtMs;
    reason = i.complaint;
  } else if (unassignedCandidate) {
    const i = unassignedCandidate;
    const t = latestTriage(i);
    lane = "unassigned";
    primaryId = i.id;
    acuityTriage = t;
    stageDetail = "Not assigned";
    sinceMs = t?.atMs ?? i.presentAtMs;
    reason = i.complaint;
    const take: FlowAction = { kind: "take", label: "Take", intakeId: i.id, triageRecordId: t?.id };
    const assign: FlowAction = { kind: "assign", label: "Assign to…", intakeId: i.id };
    const retriage: FlowAction = { kind: "retriage", label: "Re-triage", intakeId: i.id };
    if (freshL1(t)) {
      primary = openResus(i, t);
      overflow = [take, assign, retriage];
    } else {
      primary = take;
      overflow = [assign, retriage];
    }
  } else if (openCount > 0) {
    // Only superseded, idle, stale or contradictory items are left.
    lane = "needs_closing";
    primary = review;
    sinceMs = oldestSince();
    reason = visitReason();
    if (staleCandidate) {
      acuityTriage = staleTriage;
      stale = true;
      // The age is the badge ("L1 · 3 d old"); the stage says what to do about it.
      stageDetail = "Re-triage or close";
    } else {
      stageDetail = `${plural(openCount, "open item")} to close`;
    }
  } else {
    const e = doneToday[0]!;
    lane = "done";
    primaryId = e.id;
    primary = { kind: "view", label: "View", encounterId: e.id };
    stageDetail = "Visit ended";
    sinceMs = e.endedAtMs ?? e.startedAtMs;
    acuityTriage = acuityOf(e);
    reason = intakeOf(e)?.complaint ?? null;
    owner = { name: e.clinicianName, me: mine(e) };
  }

  const deceased = death !== null && lane === "needs_closing";

  /* Also open: every visible open item that is not the row's primary item. */
  const alsoOpen: OpenItem[] = [];
  for (const { i, s } of intakeItems) {
    if (i.id === primaryId) continue;
    const t = latestTriage(i);
    alsoOpen.push({
      id: i.id,
      kind: "intake",
      label: "Intake",
      detail:
        s === "awaiting"
          ? `Awaiting triage · ${i.entryType}`
          : s === "after_visit"
            ? "Still open after the visit ended"
            : `Triaged L${t?.level ?? "?"} · not assigned`,
      sinceMs: i.presentAtMs,
      tone: deceased || s === "after_visit" || staleL1(t) ? "amber" : "neutral",
      actions:
        deceased || s === "after_visit"
          ? [{ kind: "close_intake", label: "Close intake…", intakeId: i.id }]
          : s === "awaiting"
            ? viewer.mayAssign
              ? [{ kind: "triage", label: "Triage", intakeId: i.id }]
              : []
            : [
                { kind: "take", label: "Take", intakeId: i.id, triageRecordId: t?.id },
                { kind: "close_intake", label: "Close intake…", intakeId: i.id },
              ],
    });
  }
  for (const e of visibleEncounters) {
    if (e.id === primaryId) continue;
    const t = acuityOf(e);
    if (e.state === "planned") {
      const stalePlanned = superseded.has(e.id) || staleL1(t);
      alsoOpen.push({
        id: e.id,
        kind: "assignment",
        label: `Assignment${t ? ` · L${t.level}` : ""}`,
        detail: mine(e) ? "Assigned to you" : `Assigned to ${e.clinicianName ?? "another doctor"}`,
        sinceMs: e.createdAtMs,
        tone: deceased || stalePlanned ? "amber" : "neutral",
        actions: !mine(e)
          ? []
          : deceased
            ? [{ kind: "retire", label: "Retire…", encounterId: e.id }]
            : [
                {
                  kind: "start",
                  label: "Start",
                  encounterId: e.id,
                  triageRecordId: e.triageRecordId ?? t?.id,
                },
                { kind: "retire", label: "Retire…", encounterId: e.id },
              ],
      });
    } else {
      const quiet = idle(e);
      alsoOpen.push({
        id: e.id,
        kind: "encounter",
        label: "Encounter",
        detail: quiet
          ? `No activity ${ago(nowMs - e.lastActivityAtMs)}`
          : mine(e)
            ? "Clerking"
            : `Clerking · ${e.clinicianName ?? "another doctor"}`,
        sinceMs: e.createdAtMs,
        tone: quiet || deceased ? "amber" : "neutral",
        actions: mine(e)
          ? [
              { kind: "continue", label: "Continue", encounterId: e.id },
              { kind: "complete", label: "End visit", encounterId: e.id },
            ]
          : [],
      });
    }
  }
  for (const r of [...liveResus, ...idleResus]) {
    if (r.id === primaryId) continue;
    const quiet = r.section === "needs_closing";
    alsoOpen.push({
      id: r.id,
      kind: "resus",
      label: "Resus",
      detail: r.idleLabel ?? r.mode,
      sinceMs: r.startedAtMs,
      tone: quiet || deceased ? "amber" : "neutral",
      actions: [
        { kind: "open_desk", label: "Open desk", episodeId: r.id },
        ...(quiet ? [{ kind: "close_resus" as const, label: "Close…", episodeId: r.id }] : []),
      ],
    });
  }
  alsoOpen.sort((x, y) => x.sinceMs - y.sinceMs || x.id.localeCompare(y.id));

  /* Badges: say each fact once. */
  const badges: FlowBadge[] = [];
  if (death) badges.push({ text: `Died ${when(death.atMs)}`, tone: "neutral" });
  if (staleTriage && !deceased) {
    badges.push({
      text: `L1 · ${Math.floor((nowMs - staleTriage.atMs) / DAY)} d old`,
      tone: "amber",
    });
  }
  if (planned.length > 1) badges.push({ text: `${planned.length} assignments`, tone: "amber" });
  const quietEncounters = visibleEncounters.filter(
    (e) => e.state === "in_progress" && idle(e) && e.id !== primaryId,
  ).length;
  if (quietEncounters > 0)
    badges.push({ text: plural(quietEncounters, "old encounter"), tone: "amber" });
  if (idleResus.length > 0) {
    badges.push({ text: plural(idleResus.length, "idle resus", "idle resus"), tone: "amber" });
  }
  if (lane === "resus" && awaiting.length > 0)
    badges.push({ text: "Awaiting triage", tone: "neutral" });
  if (intakeItems.some(({ s }) => s === "after_visit")) {
    badges.push({ text: "Intake still open", tone: "amber" });
  }

  /* FW-10: a wait turns amber only past a CSO-signed target for that acuity. */
  let waitTone: Tone = "neutral";
  if ((lane === "waiting" || lane === "unassigned" || lane === "triage") && acuityTriage) {
    const target = input.signedRefs.waitTargets.find((w) => w.level === acuityTriage!.level);
    if (target && nowMs - sinceMs > target.minutes * MIN) waitTone = "amber";
  }

  const row: PatientFlowRow = {
    key: b.key,
    patientId: b.patientId,
    identity,
    lane,
    acuity: {
      level: deceased ? null : (acuityTriage?.level ?? null),
      atMs: deceased ? null : (acuityTriage?.atMs ?? null),
      byName: deceased ? null : (acuityTriage?.byName ?? null),
      why: deceased ? null : (acuityTriage?.why ?? null),
      stale,
    },
    reason,
    stageDetail,
    sinceMs,
    waitTone,
    primary,
    primaryItemId: primaryId,
    overflow,
    badges,
    alsoOpen,
    timeline: timeline(b, ctx),
    deceased: death && deceased ? { atMs: death.atMs, source: death.source } : null,
    resus: resusRow,
    owner,
    itemIds,
  };
  return { row, flags };
}

function openResus(visit: FlowIntake | null, t: FlowTriage | null): FlowAction {
  return { kind: "open_resus", label: "Open resus", intakeId: visit?.id, triageRecordId: t?.id };
}

/** The panel's "Today": arrival → triage → assignment → encounter → resus → disposition. */
function timeline(b: Bucket, ctx: Ctx): TimelineEntry[] {
  const { viewer } = ctx.input;
  const out: TimelineEntry[] = [];
  const intakeIds = new Set(b.intakes.map((i) => i.id));
  for (const i of b.intakes) out.push({ atMs: i.presentAtMs, text: `Arrived · ${i.entryType}` });
  const triages = new Map<string, FlowTriage>();
  for (const t of ctx.input.triages) {
    if ((t.intakeId && intakeIds.has(t.intakeId)) || (b.patientId && t.patientId === b.patientId)) {
      triages.set(t.id, t);
    }
  }
  for (const t of triages.values()) {
    out.push({ atMs: t.atMs, text: `Triaged L${t.level}${t.byName ? ` · ${t.byName}` : ""}` });
  }
  for (const e of b.encounters) {
    const who = e.clinicianId === viewer.userId ? "you" : (e.clinicianName ?? "another doctor");
    if (e.state === "planned" || e.startedAtMs - e.createdAtMs > MIN) {
      out.push({ atMs: e.createdAtMs, text: `Assigned to ${who}` });
    }
    if (e.state !== "planned") out.push({ atMs: e.startedAtMs, text: `Encounter opened · ${who}` });
    if (e.endedAtMs !== null) out.push({ atMs: e.endedAtMs, text: "Visit ended" });
  }
  for (const r of b.resus) {
    // The board carries only the end of an ended episode, so no invented opening time.
    if (r.section !== "ended")
      out.push({ atMs: r.startedAtMs, text: `Resus opened · ${r.trigger}` });
    if (r.endedAtMs !== null)
      out.push({ atMs: r.endedAtMs, text: `Resus ended · ${r.outcome ?? "closed"}` });
  }
  const death = b.patientId ? ctx.deathByPatient.get(b.patientId) : undefined;
  if (death) {
    out.push({
      atMs: death.atMs,
      text: `Death recorded${death.byName ? ` · ${death.byName}` : ""} (${death.source})`,
    });
  }
  return out.sort((x, y) => x.atMs - y.atMs || x.text.localeCompare(y.text));
}

/** FW-9: lane order; inside a lane acuity L1→L5 (untriaged last), then longest in stage. */
function compareRows(a: PatientFlowRow, b: PatientFlowRow): number {
  const lane = (LANE_ORDER.get(a.lane) ?? 0) - (LANE_ORDER.get(b.lane) ?? 0);
  if (lane) return lane;
  if (a.lane === "resus" && a.resus && b.resus) {
    return (
      RESUS_ORDER[a.resus.section] - RESUS_ORDER[b.resus.section] ||
      b.resus.startedAtMs - a.resus.startedAtMs ||
      a.key.localeCompare(b.key)
    );
  }
  if (a.lane === "done") return b.sinceMs - a.sinceMs || a.key.localeCompare(b.key);
  if (a.lane === "needs_closing") {
    const dead = Number(!!b.deceased) - Number(!!a.deceased);
    if (dead) return dead;
  }
  return (
    (a.acuity.level ?? 9) - (b.acuity.level ?? 9) ||
    a.sinceMs - b.sinceMs ||
    a.key.localeCompare(b.key)
  );
}
