/**
 * The protocol chart engine's shapes (prescribing kit P4, F7). Pure data: what goes in (the version,
 * the chart's events, the patient's facts, the time) and what comes out (the derived chart). Buttons
 * carry an `Act` instead of a closure: the screen sends the act back, and the server derives the
 * chart again and accepts only an act the chart offers to that role (role gates, P2; blocking rules,
 * P6).
 */

/** Doctor, nurse, pharmacy: from the signed-in user's cadre, never a switch. */
export type Role = "dr" | "rn" | "ph";
export type InvState = "" | "ordered" | "done" | "na";

/** What a button, chip or field does. */
export type Act =
  | { t: "mark"; key: string }
  | { t: "give"; key: string; checks?: string[] }
  | { t: "set"; key: string; value: string }
  | { t: "toggle"; key: string; value: string }
  | { t: "inv"; key: string; to: InvState }
  | { t: "value"; key: string }
  | { t: "weight" }
  | { t: "iv" }
  | { t: "order"; keys: string[] }
  | { t: "send" }
  | { t: "end" }
  // Screen only: no write.
  | { t: "rx" }
  | { t: "screen"; to: "work" | "chart" }
  | { t: "proto"; id: string };

export interface Btn {
  word: string;
  act: Act;
  /** Who presses it; null: doctor or nurse. Pharmacy presses nothing. */
  who: Role | null;
  kind?: "main" | "link";
}

export type Lvl = "ok" | "abn" | "crit";
export interface Interp {
  lvl: Lvl;
  word: string;
  text: string;
  ref: string;
}

export interface Field {
  key: string;
  label: string;
  unit: string;
  value: string;
  /** "Entered on the chart" / "From results · lab, 07:40" / "Not on file" / "Ordered 07:40 · waiting". */
  source: string;
  flag: Interp | null;
  /** Who types it (the doctor on a step; the nurse for bedside values). */
  who: Role;
  order: Btn | null;
}

export interface Crit {
  text: string;
  val: string;
  ok: boolean;
  mark: "met" | "not" | "need";
}
export interface Row {
  k: string;
  v: string;
  cls?: "warn" | "okv" | "strong";
}
export interface Branch {
  range: string;
  text: string;
  /** This patient's branch. */
  on: boolean;
  /** Enough is known to choose. */
  known: boolean;
  stop?: boolean;
  tag?: string;
}
export interface Item {
  name: string;
  sub: string;
  word: string;
  lvl: "done" | "todo" | "alert" | "na";
  btns: Btn[];
}
export interface Chip {
  word: string;
  on: boolean;
  act: Act | null;
}
export interface Line {
  text: string;
  kind: "" | "ok" | "warn" | "alert";
}
export type StepStatus = "todo" | "needs" | "done";

export interface Step {
  /** Phase id + number ("imm1"); the rn card: "rn1". */
  key: string;
  n: number;
  head?: string;
  title: string;
  sub: string;
  status: StepStatus;
  brief: string;
  fields: Field[];
  crit: Crit[];
  rows: Row[];
  branchHead: string;
  branches: Branch[];
  items: Item[];
  chipHead: string;
  chips: Chip[];
  chipWho: Role | null;
  segLabel: string;
  segs: Chip[];
  segWho: Role | null;
  btns: Btn[];
  lines: Line[];
}

export interface Phase {
  id: string;
  title: string;
  win: string;
  from: number;
  /** Slot index the phase ends at; null: open-ended. */
  to: number | null;
  acts: Step[];
}

export type FlowSt = "done" | "needs" | "todo" | "later";
export type FlowItem =
  | { kind: "phase"; title: string; now: boolean }
  | { kind: "node"; key: string; title: string; sub: string; st: FlowSt }
  | {
      kind: "dec";
      key: string;
      q: string;
      brs: { label: string; sub: string; state: boolean | null }[];
      note: string;
      st: FlowSt;
    };

export interface Task {
  key: string;
  title: string;
  sub: string;
  at: number;
  when: string;
  lvl: "alert" | "todo" | "na";
  btns: Btn[];
}

export interface Stat {
  k: string;
  v: string;
  s: string;
  cls?: "warn" | "ok";
}
export interface Aim {
  word: string;
  ok: boolean;
  known: boolean;
}

export interface Panel {
  key: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  ticks: number[];
  thr: { v: number; label: string; lvl: "amb" | "grn" }[];
  points: { h: number; v: number; at: number; bad: boolean }[];
  /** A dashed target line: [slot, value] pairs. */
  target: [number, number][];
  status: string;
  stLvl: "ok" | "no" | "";
  latest: string;
}

export interface GridCell {
  t: string;
  flag: Interp | null;
  now: boolean;
  due: boolean;
}
export interface Grid {
  head: { t: string; now: boolean }[];
  rows: { key: string; label: string; cells: GridCell[] }[];
}

export interface FormField {
  key: string;
  label: string;
  unit: string;
  dflt: string;
  /** Not due this slot: may stay empty. */
  opt?: boolean;
}

export interface VitalTile {
  key: string;
  label: string;
  unit: string;
  value: string;
  word: string;
  flag: Interp | null;
  /** Up to 8 points: time, value, second value (diastolic). */
  series: { at: number; v: number; v2: number | null; lvl: Lvl | null }[];
  /** The normal range from the reference, when it has one. */
  band: [number, number] | null;
  delta: string;
  /** A parameter the doctor added (removable). */
  paramId: string | null;
}
export interface Vitals {
  tiles: VitalTile[];
  head: string[];
  rows: { at: number; cells: { t: string; flag: Interp | null }[] }[];
  /** Entry columns: the five base keys + one per added parameter. */
  inputs: { key: string; label: string; unit: string }[];
  last: number | null;
  due: number;
  overdue: boolean;
  suggest: { name: string; unit: string }[];
}

export interface MedLine {
  drug: string;
  qty: number;
  why: string;
}

export interface LogLine {
  at: number;
  text: string;
  eventId: string;
  role: Role;
  type: string;
}

export interface ChartView {
  protocolId: string;
  module: string;
  title: string;
  short: string;
  /** The source line; "· prototype values, need local sign-off" while unsigned (P12). */
  over: string;
  signed: boolean;
  slotMinutes: number;
  slotCount: number;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
  /** The slot index now (hour 3 of a 1-hour chart). */
  hNow: number;
  slotWord: string;
  nowWord: string;
  phase: { id: string; title: string; win: string };
  stats: Stat[];
  aims: Aim[];
  phases: Phase[];
  rn: { title: string; note: string; acts: Step[] };
  flow: FlowItem[];
  tasks: Task[];
  grid: Grid;
  panels: Panel[];
  form: FormField[];
  formReq: string[];
  nextSlot: number;
  nextDue: number;
  recHint: string;
  full: boolean;
  vitals: Vitals;
  meds: MedLine[];
  medsNote: string;
  phRows: Row[];
  log: LogLine[];
  notes: { at: number; who: Role; text: string; eventId: string }[];
  /** The order went to the pharmacy (a `send` event). */
  sentAt: number | null;
  /** A reason the chart cannot run (a seed missing its numbers). */
  blocked: string | null;
}

/* ─── In ─────────────────────────────────────────────────────────── */

export interface ChartEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  role: Role;
  at: number;
  reversesId: string | null;
}

export interface ChartVersion {
  protocolId: string;
  name: string;
  status: "draft" | "signed";
  source: string;
  slotMinutes: number;
  slotCount: number;
  /** The P3 quick rules (`QuickRules`): module, steps, supply, who. */
  rules: unknown;
  /** The module's named numbers. */
  seed: Record<string, unknown>;
}

export interface ResultValue {
  value: number;
  /** "lab" / "vitals" / "entered on the DKA chart". */
  source: string;
  at: number;
}

export interface ChartFacts {
  ageYears: number | null;
  sex: "female" | "male" | null;
  weightKg: number | null;
  weightFrom: string | null;
  pregnant: boolean | null;
  problems: string[];
  creatinine: number | null;
  egfr: number | null;
  /** Latest result on file, by chart key (k, na, cbg …). */
  results: Record<string, ResultValue>;
  /** Tests ordered and waiting, by chart key: when ordered. */
  pending: Record<string, number>;
  /** "18G, left forearm" for each line on record this visit. */
  ivLines: string[];
  ivTaskOpen: boolean;
}

export interface Slot {
  h: number;
  at: number;
  values: Record<string, string>;
  eventId: string;
}

export interface ChartState {
  start: number;
  ended: number | null;
  endReason: string | null;
  /** Choices and values typed on steps. */
  v: Record<string, string>;
  many: Record<string, string[]>;
  inv: Record<string, InvState>;
  /** The last time of each mark. */
  t: Record<string, number>;
  marks: Record<string, number[]>;
  gives: Record<string, number[]>;
  obs: Slot[];
  vit: { at: number; values: Record<string, string>; eventId: string }[];
  custom: { id: string; name: string; unit: string }[];
  notes: { at: number; who: Role; text: string; eventId: string }[];
  sentAt: number | null;
  events: ChartEvent[];
}
