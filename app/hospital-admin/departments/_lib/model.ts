import type { DepartmentRow, HeadRow, PlaceRow } from "@/lib/services/data";
import type { LegacyPlan, OpenProblem } from "@/supabase/functions/_shared/services-hub";

import { DEPTS } from "@/content/hospital-admin/departments";
import { fill } from "@/content/lab-workspace-v2";

/*
 * The Departments page's shapes and small pure helpers (ADR 0520 phase 2), shared by the server page and the
 * client desk. Nothing here reads the database.
 */

/** One department's booking rules (`department_scheduling_policy`); absent = unrestricted (ADR 0084 §14). */
export interface BookingRules {
  slot: number;
  buffer: number;
  auto: boolean;
  /** ISO weekdays, 1 = Monday. */
  days: number[];
  /** Minutes past local midnight. */
  start: number;
  end: number;
  twoReminders: boolean;
  virtual: boolean;
  notes: string | null;
}

/** What the editor shows for a department with no rules: the table's column defaults (migration 0052's one reminder). */
export const UNSET_RULES: BookingRules = {
  slot: 15,
  buffer: 0,
  auto: false,
  days: [1, 2, 3, 4, 5],
  start: 480,
  end: 1020,
  twoReminders: false,
  virtual: false,
  notes: null,
};

/** One published weekly session of a clinic (`session_templates`), as Clinics & schedule's week plan holds it. */
export interface SessionLite {
  clinicId: string;
  /** ISO weekday, 1 = Monday. */
  weekday: number;
  start: number;
  end: number;
  slot: number;
}
/** A clinic's week, in the shape of the department's rules so one summary line serves both. */
export interface ClinicWeek {
  clinicId: string;
  name: string;
  rules: BookingRules;
}

/**
 * ADR 0526: days, hours and slot length are set once, on the clinic's week plan. The current clinics of a
 * department (its own id and its units') that have a week plan, each with the days it runs, its earliest start,
 * latest end and shortest slot. Empty = no clinic holds them, so the department's own rules are the only place.
 */
export function clinicWeeks(
  departmentIds: readonly string[],
  clinics: readonly ClinicLite[],
  sessions: readonly SessionLite[],
): ClinicWeek[] {
  return clinics
    .filter((c) => departmentIds.includes(c.departmentId) && c.status !== "archived")
    .flatMap((c): ClinicWeek[] => {
      const xs = sessions.filter((x) => x.clinicId === c.id);
      if (!xs.length) return [];
      return [
        {
          clinicId: c.id,
          name: c.name,
          rules: {
            ...UNSET_RULES,
            days: [...new Set(xs.map((x) => x.weekday))].sort((a, b) => a - b),
            start: Math.min(...xs.map((x) => x.start)),
            end: Math.max(...xs.map((x) => x.end)),
            slot: Math.min(...xs.map((x) => x.slot)),
          },
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

type Window = Pick<BookingRules, "days" | "start" | "end">;
const ANY_TIME: Window = { days: [1, 2, 3, 4, 5, 6, 7], start: 0, end: 1440 };

/** A stored department window that is tighter than "any day, any hour". */
export const isNarrowed = (r: Window) => r.days.length < 7 || r.start > 0 || r.end < 1440;

/**
 * The days and hours to store for a department. Where its clinics hold them, the department stores "any day, any
 * hour", never a second copy that could disagree with the week plan.
 */
export const windowToSave = (v: Window, clinicLed: boolean): Window =>
  clinicLed ? { ...ANY_TIME } : { days: v.days, start: v.start, end: v.end };

/** How people come to a department: through a clinic's bookings, for tests, for medicines, or not at all. */
export type BookedAs = "clinic" | "tests" | "medicines" | "none";

/**
 * ADR 0527: only a department that sees patients in clinics has clinic booking rules. The laboratory is priced
 * and timed test by test, the pharmacy medicine by medicine, and the other support and office departments take
 * no bookings. A department that really runs a clinic keeps its rules, whatever its kind.
 */
export function bookedAs(
  dept: { kind: string; catalogueCode: string | null },
  hasClinics: boolean,
): BookedAs {
  if (dept.kind === "clinical" || hasClinics) return "clinic";
  if (dept.catalogueCode === "LABORATORY") return "tests";
  if (dept.catalogueCode === "PHARMACY") return "medicines";
  return "none";
}

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** 480 → "08:00". */
export const hm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "Mon–Fri · 08:00–17:00 · 15 min": the three facts a desk asks about. */
export function rulesSummary(r: BookingRules | null | undefined): string {
  if (!r) return DEPTS.detail.unrestricted;
  const days = [...r.days].sort((a, b) => a - b);
  const run = days.length > 1 && days[days.length - 1]! - days[0]! === days.length - 1;
  const dayTxt =
    days.length === 0
      ? DEPTS.rules.noDaysTxt
      : days.length === 7
        ? DEPTS.rules.every
        : run
          ? `${DAY_SHORT[days[0]! - 1]}–${DAY_SHORT[days[days.length - 1]! - 1]}`
          : days.map((d) => DAY_SHORT[d - 1]).join(" ");
  return fill(DEPTS.rules.summary, {
    days: dayTxt,
    from: hm(r.start),
    to: hm(r.end),
    slot: r.slot,
  });
}

/** "1 clinic" / "3 clinics". */
export const plural = (pair: readonly [string, string], n: number) =>
  fill(n === 1 ? pair[0] : pair[1], { n });

export type ClinicLite = {
  id: string;
  name: string;
  departmentId: string;
  unitId: string | null;
  status: string;
};
export type WardLite = {
  id: string;
  name: string;
  departmentId: string | null;
  bedCount: number;
  closed: boolean;
  archived: boolean;
};
export type Person = { userId: string; name: string; departmentId: string; cadre: string | null };
export type Counts = Record<
  "staff" | "wards" | "clinics" | "bookedSessions",
  Record<string, number>
>;

export interface FirstRun {
  preset: {
    levelLabel: string;
    version: string;
    section: string;
    source: string;
    add: { kind: string; code: string; label: string }[];
    skip: number;
  } | null;
  legacy: "offered" | "declined" | "accepted" | "none";
  legacyPlan: LegacyPlan | null;
}

export interface ClosedWard {
  id: string;
  name: string;
  departmentId: string | null;
  reason: string | null;
  since: string;
  back: string | null;
}
export interface ClosureNow {
  id: string;
  scope: string;
  departmentId: string | null;
  startsOn: string;
  endsOn: string;
  reason: string;
}
export interface HistoryRow {
  problemId: string;
  kind: string;
  label: string;
  state: string;
  reason: string | null;
  since: string;
  resolvedAt: string;
  days: number;
}
export type SubjectKind =
  | "department"
  | "ward"
  | "clinic"
  | "test"
  | "lab_section"
  | "imaging"
  | "capability";
export type Subjects = Record<SubjectKind, { ref: string; label: string }[]>;

export interface DepartmentsData {
  departments: DepartmentRow[];
  heads: { current: HeadRow[]; history: HeadRow[] };
  counts: Counts;
  pool: Person[];
  places: PlaceRow[];
  clinics: ClinicLite[];
  wards: WardLite[];
  /** Pharmacy units that are dispensing points → what each serves (ADR 0236). */
  points: Record<string, string>;
  goLive: boolean;
  pharmacyDemo: boolean;
  /** DUTY_ROTA is on here (ADR 0534): each department links to its rota. */
  rotaLive: boolean;
  rules: Record<string, BookingRules>;
  /** Every current clinic's published weekly sessions: where days, hours and slot length are set (ADR 0526). */
  sessions: SessionLite[];
  firstRun: FirstRun;
  problems: OpenProblem[];
  closedWards: ClosedWard[];
  closures: ClosureNow[];
  history: HistoryRow[];
  subjects: Subjects;
  opdHours: Record<string, { from: string; to: string }[]> | null;
  holidays: { date: string; name: string; provisional: boolean; source: string }[];
}

export type View = "cards" | "unavailable" | "hours";

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kampala",
  });
export const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00+03:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Kampala",
  });

/** A department's own id and its units' ids: what its clinics, wards and staff hang off. */
export const idsOf = (d: DepartmentRow, all: readonly DepartmentRow[]) => [
  d.id,
  ...all.filter((u) => u.parentId === d.id).map((u) => u.id),
];

/** Two letters for a department's tile: "Internal Medicine" → "IM". */
export const abbr = (name: string) =>
  name
    .replace(/ and | of | & /gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
