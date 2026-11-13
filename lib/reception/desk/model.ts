/**
 * The reception desk's pure rules (docs/reception/gate-a-proposal.md §2): no React, no I/O, time injected, so
 * Vitest pins every rule. Strings come from content/reception/desk.ts.
 */
import { fill } from "@/content/lab-workspace-v2";
import { DESK } from "@/content/reception/desk";

/* ─── types ─────────────────────────────────────────────────────────── */

export type Stage = "expected" | "here" | "nurse" | "doctor" | "done" | "notseen";
export const STAGES: Stage[] = ["expected", "here", "nurse", "doctor", "done", "notseen"];

export type Go =
  | { st: "route"; km: number; upd: number }
  | { st: "coming" }
  | { st: "here" }
  | { st: "none" };

export interface DeskClinic {
  id: string;
  name: string;
  short: string;
  /** a CSS colour token, e.g. `var(--iris-600)` — never a raw hex (RD12). */
  hue: string;
  /** days it runs, as the canvas pattern line ("Tue, Thu, Fri · mornings"). */
  pattern: string;
  fee: number;
}

export interface DeskSession {
  key: string; // `${date}|${clinicId}`
  id: string; // clinic id
  sessionId: string | null; // clinic_sessions.id, null in a fixture
  date: string; // yyyy-mm-dd, Africa/Kampala
  kind: "clinic" | "times";
  st: number; // start hour, decimal
  en: number;
  cap: number;
  booked: number;
  seen?: number;
  noShow?: number;
  docs: string[]; // empty = no doctor yet
  late: number; // minutes
  /** doctor's times only: slot "HH:MM" → patient name, or null when booked but the name is not loaded. */
  taken?: Record<string, string | null>;
}

export interface DeskRow {
  id: string;
  appointmentId: string | null;
  intakeId: string | null;
  clinic: string;
  name: string;
  sex: "F" | "M" | "?";
  age: number | null;
  pno: string;
  code: string;
  time: string; // arrival window "08:00–09:00" or slot "10:40"
  doc: string;
  stage: Stage;
  route?: "triage" | "clinic" | "emergency";
  arr?: string; // "08:12"
  flag?: "says" | "idc" | "emerg" | "queued";
  reason: string;
  ownWords: boolean;
  triageFirst?: boolean;
  fee: number;
  paid: boolean;
  payBy?: "cash" | "momo";
  payAt?: string;
  go: Go;
  photoUrl?: string | null; // only with consent (D-RD-02)
}

export interface PreAlert {
  id: string;
  name: string;
  who: string;
  what: string;
  km: number | null;
  eta: string;
  acknowledged: boolean;
}

/* ─── time ──────────────────────────────────────────────────────────── */

export const TZ = "Africa/Kampala";

/** Wall-clock parts in Kampala for an instant. */
export function kampala(now: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const y = +p.year!,
    m = +p.month!,
    d = +p.day!,
    hh = +p.hour!,
    mm = +p.minute!,
    ss = +p.second!;
  return { y, m, d, hh, mm, ss, key: `${p.year}-${p.month}-${p.day}`, hour: hh + mm / 60 };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DSHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const monthName = (m0: number) => MONTH[m0]!;

export const parseKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
export const keyOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (k: string, n: number) => {
  const d = parseKey(k);
  d.setUTCDate(d.getUTCDate() + n);
  return keyOf(d);
};
export const dayDiff = (k: string, today: string) =>
  Math.round((parseKey(k).getTime() - parseKey(today).getTime()) / 86_400_000);
/** "Fri 13 Nov" */
export const fmtDay = (k: string) => {
  const d = parseKey(k);
  return `${DSHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
export const hhmm = (h: number) => {
  const hr = Math.floor(h),
    m = Math.round((h - hr) * 60);
  return `${String(hr).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
/** Monday-first weekday index, 0..6 */
export const isoDow = (k: string) => (parseKey(k).getUTCDay() + 6) % 7;

/* ─── age (S13, RD8) ────────────────────────────────────────────────── */

export type AgeMode = "year" | "date" | "age";
export interface AgeInput {
  mode: AgeMode;
  yob?: string;
  dd?: string;
  mm?: string;
  yy?: string;
  ag?: string;
}
export interface AgeResult {
  ok: boolean;
  err: boolean;
  txt: string;
  age?: number;
  yob?: number;
  exact?: boolean;
  /** "about 36" or "36" */
  show?: string;
  /** the full date, when known (yyyy-mm-dd) */
  dob?: string;
}

export function ageOf(o: AgeInput, today: { y: number; m: number; d: number }): AgeResult {
  const A = DESK.age;
  const bad = (txt: string): AgeResult => ({ ok: false, err: true, txt });
  const fin = (
    age: number,
    txt: string,
    yob: number,
    exact: boolean,
    show: string,
    dob?: string,
  ): AgeResult => {
    if (age > 120) return bad(A.over120);
    if (age < 18) return bad(A.under18);
    return { ok: true, err: false, age, txt, yob, exact, show, dob };
  };
  const T = today;
  if (o.mode === "date") {
    if (!o.dd && !o.mm && !o.yy) return { ok: false, err: false, txt: A.dateHint };
    const d = parseInt(o.dd ?? "", 10),
      m = parseInt(o.mm ?? "", 10),
      y = parseInt(o.yy ?? "", 10);
    if (isNaN(d) || isNaN(m) || isNaN(y) || String(o.yy).length < 4)
      return { ok: false, err: false, txt: A.dateKeep };
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (m < 1 || m > 12 || d < 1 || d > dim) return bad(A.dateBad);
    if (y > T.y || (y === T.y && (m > T.m || (m === T.m && d > T.d)))) return bad(A.dateFuture);
    const age = T.y - y - (T.m < m || (T.m === m && T.d < d) ? 1 : 0);
    let months = ((T.m - m + 12) % 12) - (T.d < d ? 1 : 0);
    if (months < 0) months += 12;
    const bday = T.m === m && T.d === d ? " · birthday today" : "";
    const txt = `${fill(A.exactly, { age })}${months ? ` years, ${months} ${months === 1 ? "month" : "months"}` : " years"}${bday} · born ${d} ${MON[m - 1]} ${y}`;
    const dob = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return fin(age, txt, y, true, String(age), dob);
  }
  if (o.mode === "age") {
    if (!o.ag) return { ok: false, err: false, txt: A.ageHint };
    const a = parseInt(o.ag, 10);
    if (isNaN(a) || !/^\d+$/.test(o.ag.trim())) return bad(A.ageNumber);
    return fin(
      a,
      `${fill(A.ageIs, { age: a })} as they said it · born about ${T.y - a} · flagged to confirm`,
      T.y - a,
      false,
      `about ${a}`,
    );
  }
  if (!o.yob) return { ok: false, err: false, txt: A.live };
  const yy = parseInt(o.yob, 10);
  if (isNaN(yy) || String(o.yob).length < 4) return { ok: false, err: false, txt: A.yearHint };
  if (yy > T.y) return bad(A.yearFuture);
  const hi = T.y - yy,
    lo = hi - 1;
  if (hi < 18) return bad(A.under18);
  if (lo < 18) return bad(fill(A.maybe17, { year: yy }));
  return fin(
    hi,
    `About ${hi} (${lo} if their birthday is still to come). Add the full date for the exact age.`,
    yy,
    false,
    `about ${hi}`,
  );
}

/* ─── check in by code ──────────────────────────────────────────────── */

/** What the six boxes show: letters and digits only, upper case, at most 6. */
export const codeInput = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
/** Characters a booking code never uses (D-RD-10). */
export const codeHasBadChar = (code: string) => /[0O1IL]/.test(code);
/** "K7M42Q" → "K7M 42Q", read 3 + 3. */
export const codeSpoken = (code: string) =>
  code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

/* ─── rows ──────────────────────────────────────────────────────────── */

export const initials = (name: string) => {
  const p = name.replace(/^(Dr\.|Midwife|Physio|Nutritionist) /, "").split(" ");
  return ((p[0] ?? "")[0] ?? "") + ((p[1] ?? "")[0] ?? "");
};

export const whoOf = (r: Pick<DeskRow, "sex" | "age">) =>
  r.sex === "?" ? "Not yet known" : `${r.sex === "F" ? "Female" : "Male"} · ${r.age ?? ""}`;

/** On the way (D-RD-03: "about N km"; privacy hides the distance). */
export function goText(
  go: Go,
  privacy: boolean,
): { t: string; s: string; route: boolean; none: boolean } {
  const W = DESK.row.onTheWay;
  if (go.st === "route") {
    if (privacy)
      return { t: DESK.arrivals.filters.onTheWay, s: W.hidden, route: true, none: false };
    const km = go.km < 1 ? Math.round(go.km * 10) / 10 : Math.round(go.km);
    return {
      t: go.km < 1 ? fill(W.near, { km }) : `about ${km} km`,
      s: `Live · ${go.upd} min ago`,
      route: true,
      none: false,
    };
  }
  if (go.st === "coming") return { t: W.said, s: W.noLive, route: false, none: false };
  if (go.st === "here") return { t: W.here, s: "", route: false, none: false };
  return { t: W.none, s: W.noReply, route: false, none: true };
}

export type QuickFilter = "" | "route" | "unpaid" | "triage";
export const QUICK: Record<Exclude<QuickFilter, "">, (r: DeskRow) => boolean> = {
  route: (r) => r.go.st === "route",
  unpaid: (r) => r.fee > 0 && !r.paid,
  triage: (r) => !!r.triageFirst,
};

const goRank = (r: DeskRow) => (r.go.st === "route" ? r.go.km : r.go.st === "coming" ? 1000 : 2000);

/** Search: booking code, patient number, phone digits or name; spaces ignored. */
export function matchRow(r: DeskRow, q: string, phone?: string) {
  const qq = q.trim().toLowerCase().replace(/\s+/g, "");
  if (!qq) return false;
  return (
    r.code.toLowerCase().includes(qq) ||
    r.pno.toLowerCase().replace("-", "").includes(qq.replace("-", "")) ||
    (!!phone && phone.replace(/\s/g, "").includes(qq)) ||
    r.name.toLowerCase().replace(/\s/g, "").includes(qq)
  );
}

export interface ArrivalsView {
  shown: DeskRow[];
  groups: { key: string; label: string; rows: DeskRow[] }[];
  counts: Record<Stage, number>;
}

/** The Arrivals table: stage tab, clinic chip, quick filter, sort, grouping by arrival window. */
export function arrivals(
  rows: DeskRow[],
  o: {
    on: Record<string, boolean>;
    tab: Stage;
    clinic: string;
    qf: QuickFilter;
    sort: "time" | "near";
    q: string;
  },
): ArrivalsView {
  const live = rows.filter((r) => o.on[r.clinic] || r.clinic === "em");
  const counts = Object.fromEntries(
    STAGES.map((st) => [
      st,
      live.filter((r) => r.stage === st && (!o.clinic || r.clinic === o.clinic)).length,
    ]),
  ) as Record<Stage, number>;
  const searching = !!o.q.trim();
  const base = searching
    ? rows.filter((r) => matchRow(r, o.q))
    : live.filter((r) => r.stage === o.tab && (!o.clinic || r.clinic === o.clinic));
  const near = o.sort === "near" && !searching && o.tab === "expected";
  const useQf = !searching && o.tab === "expected" && o.qf;
  const shown = (useQf ? base.filter(QUICK[o.qf as Exclude<QuickFilter, "">]) : base)
    .slice()
    .sort((a, b) =>
      near
        ? goRank(a) - goRank(b) || a.name.localeCompare(b.name)
        : a.time.localeCompare(b.time) || a.name.localeCompare(b.name),
    );
  const map = new Map<string, DeskRow[]>();
  const expView = !searching && o.tab === "expected";
  const stageLabel = DESK.arrivals.tabs;
  const label: Record<Stage, string> = {
    expected: stageLabel.expected,
    here: "Arrived, waiting",
    nurse: stageLabel.nurse,
    doctor: stageLabel.doctor,
    done: stageLabel.done,
    notseen: stageLabel.notSeen,
  };
  for (const r of shown) {
    const k = searching
      ? "Matches"
      : near
        ? r.go.st === "route"
          ? "1On the way, nearest first"
          : r.go.st === "coming"
            ? "2Said they are coming"
            : "3Not heard from yet"
        : expView
          ? r.time
          : r.stage;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const groups = [...map.keys()].sort().map((k) => ({
    key: k,
    label: near ? k.slice(1) : expView ? `Arriving ${k}` : searching ? k : label[k as Stage],
    rows: map.get(k)!,
  }));
  return { shown, groups, counts };
}

/** Straight to clinic only for refill, results or follow-up (RD4). */
export const clinicRouteAllowed = (reason: string) => /refill|result|follow/i.test(reason);

/* ─── calendar ──────────────────────────────────────────────────────── */

export type Tone = "done" | "run" | "next" | "fut" | "sel";
/** Colour by order, never by topic: past navy, running cascade, next highlight, future plain. */
export function tone(
  se: Pick<DeskSession, "date" | "st" | "en">,
  today: string,
  nowHour: number,
  sel = false,
): Tone {
  if (sel) return "sel";
  const df = dayDiff(se.date, today);
  if (df < 0) return "done";
  if (df > 0) return "fut";
  if (se.en <= nowHour) return "done";
  if (se.st <= nowHour) return "run";
  return "next";
}

export interface MonthSummary {
  bookedAhead: number;
  seen: number;
  noShows: number;
  busiest: { date: string; booked: number } | null;
  attention: { date: string; clinic: string; what: "noDoctor" | "full" | "late" }[];
}

/** Month totals and Needs attention (S19, S20): no doctor, full, running late — nothing else. */
export function monthSummary(sessions: DeskSession[], today: string): MonthSummary {
  let bookedAhead = 0,
    seen = 0,
    noShows = 0;
  const perDay = new Map<string, number>();
  const attention: MonthSummary["attention"] = [];
  for (const s of sessions) {
    const df = dayDiff(s.date, today);
    if (df >= 0) {
      bookedAhead += s.booked;
      perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.booked);
    } else {
      seen += s.seen ?? 0;
      noShows += s.noShow ?? 0;
    }
    if (df < 0) continue;
    if (s.docs.length === 0) attention.push({ date: s.date, clinic: s.id, what: "noDoctor" });
    else if (s.booked >= s.cap) attention.push({ date: s.date, clinic: s.id, what: "full" });
    else if (s.late > 0) attention.push({ date: s.date, clinic: s.id, what: "late" });
  }
  let busiest: MonthSummary["busiest"] = null;
  for (const [date, booked] of perDay)
    if (dayDiff(date, today) > 0 && (!busiest || booked > busiest.booked))
      busiest = { date, booked };
  attention.sort((a, b) => a.date.localeCompare(b.date) || a.clinic.localeCompare(b.clinic));
  return { bookedAhead, seen, noShows, busiest, attention };
}

/* ─── shortcuts (S5) ────────────────────────────────────────────────── */

export type DeskKey =
  | "search"
  | "code"
  | "book"
  | "walk"
  | "emergency"
  | "privacy"
  | "view1"
  | "view2"
  | "view3"
  | "view4"
  | "rail"
  | "keys"
  | "escape";

/** One key press → one desk action, or null. Off while typing or with a modifier; in a dialog only `?` and Esc. */
export function shortcut(
  e: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    target?: EventTarget | null;
  },
  dialogOpen: boolean,
): DeskKey | null {
  if (e.key === "Escape") return "escape";
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const typing =
    !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? "") || !!t.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (dialogOpen && e.key !== "?") return null;
  const map: Record<string, DeskKey> = {
    "/": "search",
    c: "code",
    b: "book",
    w: "walk",
    e: "emergency",
    h: "privacy",
    "1": "view1",
    "2": "view2",
    "3": "view3",
    "4": "view4",
    "[": "rail",
    "?": "keys",
  };
  return map[e.key.length === 1 ? e.key.toLowerCase() : e.key] ?? null;
}
