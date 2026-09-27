import type { Hue, StatusKey } from "./tones";
import type { CalendarEvent } from "./types";
import type { PillTone } from "@/components/ui/pill";
import type { LucideIcon } from "lucide-react";

import {
  DEFAULT_TIME_ZONE,
  localDateKey,
  localWeekdayAndMinutes,
} from "@/supabase/functions/_shared/slots";
import { HUE, kindTone, STATUS_TONE, statusKeyFor } from "./tones";

/**
 * Calendar date math + status helpers. Native Date + Intl only —
 * deliberately no date-fns / luxon so the bundle stays light and the
 * timezone semantics are explicit (EAT for display; UTC stored).
 *
 * "Day starts at 00:00 local" semantics: we use Date methods that
 * respect the user's locale + tz for *grid placement* (which day a
 * 22:30 EAT slot belongs to). Storage is UTC; rendering is local.
 */

export type CalendarView = "month" | "week" | "day" | "agenda";

/** Inclusive start, exclusive end. */
export interface DateRange {
  start: Date;
  end: Date;
}

export const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  pending_approval: "Awaiting approval",
  confirmed: "Confirmed",
  arrived: "Arrived",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Declined",
  no_show: "Missed",
  rescheduled: "Rescheduled",
};

export const SESSION_STATUS_LABEL: Record<string, string> = {
  published: "Published",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const AVAILABILITY_KIND_LABEL: Record<string, string> = {
  bookable: "Bookable",
  teaching: "Teaching",
  ward_round: "Ward round",
  admin: "Admin",
  leave: "Leave",
  unavailable: "Unavailable",
  custom: "Custom",
};

/**
 * Pill tone per availability kind, for the list rows and sheets that show a
 * kind as a Pill — read from the calendar's one colour map (tones.ts), so a
 * list and the grid cannot disagree. Nothing here is red, amber or green: a
 * doctor's day off is not a clinical signal.
 */
export const AVAILABILITY_KIND_TONES: Record<string, PillTone> = Object.fromEntries(
  Object.keys(AVAILABILITY_KIND_LABEL).map((k) => [k, kindTone(k).pill]),
);

/** Background-band fill per availability kind: a faint tint, or the hatch for time off. */
export const AVAILABILITY_CARD_CLASSES: Record<string, string> = Object.fromEntries(
  Object.keys(AVAILABILITY_KIND_LABEL).map((k) => [k, HUE[kindTone(k).hue].band]),
);

/** What a card says and how it is toned — one description shared by every view and the search. */
export interface EventDescription {
  /** The kind, as a word: "Appointment", "Clinic day", "Leave", … Carries "Urgent" for an urgent appointment. */
  kindLabel: string;
  pillTone: PillTone;
  /** The status word, when the kind has a status. */
  statusWord: string | null;
  title: string;
  subtitle: string | null;
  /** Monogram chip text: patient initials, or a clinic day's booked count. */
  monogram: string | null;
  /** Availability only: the background band's fill. Cards are white; colour lives in chips. */
  cardClasses: string;
  /** The kind's hue and icon (a clinic day or an availability block). Appointments are neutral. */
  hue: Hue;
  kindIcon: LucideIcon;
  /** Appointments only: which round status pill the card carries. */
  status: StatusKey | null;
  urgent: boolean;
  /** Cancelled / missed — the card recedes and the title is struck through. */
  struck: boolean;
  clickable: boolean;
}

export function describeEvent(ev: CalendarEvent): EventDescription {
  if (ev.kind === "appointment") {
    const status = statusKeyFor(ev.status, ev.priority);
    const urgent = ev.priority === "urgent";
    const kind = ev.type === "virtual" ? "Video visit" : "Appointment";
    return {
      kindLabel: urgent ? `Urgent ${kind.toLowerCase()}` : kind,
      pillTone: status === "urgent" ? "critical" : status === "pending" ? "pending" : "neutral",
      statusWord: STATUS_LABEL[ev.status] ?? ev.status,
      title: ev.patientName,
      subtitle: ev.reason.replace(/_/g, " "),
      monogram: initials(ev.patientName),
      cardClasses: "",
      hue: "neutral",
      kindIcon: kindTone("appointment").icon,
      status,
      urgent,
      struck: STATUS_TONE[status].struck,
      clickable: true,
    };
  }
  if (ev.kind === "session") {
    const live = ev.status === "published";
    const tone = kindTone("session");
    return {
      kindLabel: "Clinic day",
      pillTone: live ? tone.pill : "neutral",
      statusWord: live ? null : (SESSION_STATUS_LABEL[ev.status] ?? ev.status),
      title: ev.serviceLineName,
      subtitle: `${ev.bookedCount} of ${ev.capacity} places`,
      monogram: String(ev.bookedCount),
      cardClasses: "",
      hue: live ? tone.hue : "neutral",
      kindIcon: tone.icon,
      status: null,
      urgent: false,
      struck: ev.status === "cancelled",
      clickable: true,
    };
  }
  // A custom block IS its label; the kind word stays in the label pill's aria text.
  const kindLabel = AVAILABILITY_KIND_LABEL[ev.availabilityKind] ?? ev.availabilityKind;
  const tone = kindTone(ev.availabilityKind);
  return {
    kindLabel,
    pillTone: AVAILABILITY_KIND_TONES[ev.availabilityKind] ?? "neutral",
    statusWord: null,
    title: ev.availabilityKind === "custom" ? (ev.label ?? "Custom") : kindLabel,
    subtitle: ev.location,
    monogram: null,
    cardClasses: AVAILABILITY_CARD_CLASSES[ev.availabilityKind] ?? HUE.neutral.band,
    hue: tone.hue,
    kindIcon: tone.icon,
    status: null,
    urgent: false,
    struck: false,
    clickable: false,
  };
}

/**
 * "Amina Okello" → "AO". A bare code ("MRN-2026-00012", or "MS-…") is not a
 * name: its LAST four characters are what a desk reads out, so the chip
 * shows those rather than a meaningless "MR".
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const one = name.trim();
  return /[-\d]/.test(one) ? one.slice(-4).toUpperCase() : one.slice(0, 2).toUpperCase();
}

/**
 * Which rows a timeline card has room for, by its pixel height. The title
 * always shows; everything else earns its line. At 64 px/hour a 30-minute
 * appointment (32 px) reads as pill + title, an hour as pill + title +
 * time, a two-hour clinic as the whole card with its footer.
 */
export function cardRows(heightPx: number): {
  pill: boolean;
  title: true;
  time: boolean;
  subtitle: boolean;
  footer: boolean;
} {
  return {
    pill: heightPx >= 28,
    title: true,
    time: heightPx >= 56,
    subtitle: heightPx >= 80,
    footer: heightPx >= 112,
  };
}

/**
 * Side-by-side lanes for cards that overlap on the grid. Items are vertical
 * pixel extents (not times: two back-to-back 15-minute bookings both grow to
 * the 44px minimum and would collide). Returns, per input index, the card's
 * lane and the lane count of its overlap cluster, so a lone card keeps the
 * full column and only a real collision splits it.
 */
export function packLanes(
  items: ReadonlyArray<{ start: number; end: number }>,
): Array<{ lane: number; lanes: number }> {
  const out: Array<{ lane: number; lanes: number }> = items.map(() => ({ lane: 0, lanes: 1 }));
  const order = items
    .map((_, i) => i)
    .sort((a, b) => items[a]!.start - items[b]!.start || items[b]!.end - items[a]!.end);
  let cluster: number[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const i of cluster) out[i]!.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const i of order) {
    const { start, end } = items[i]!;
    if (start >= clusterEnd) {
      close();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else laneEnds[lane] = end;
    out[i]!.lane = lane;
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, end);
  }
  close();
  return out;
}

/**
 * Where a band's kind chip goes: the first stretch of the band, from its
 * top, that no card covers — cards sit over bands, and a chip half under a
 * card reads as a fragment ("…able"). Null when cards cover the whole band.
 */
export function bandChipOffset(
  band: { top: number; height: number },
  cards: ReadonlyArray<{ top: number; height: number }>,
  chipPx: number,
): number | null {
  const sorted = [...cards].sort((a, b) => a.top - b.top);
  let y = band.top;
  for (const c of sorted) {
    if (c.top + c.height <= y) continue;
    if (c.top >= y + chipPx) break;
    y = c.top + c.height;
  }
  return y + chipPx <= band.top + band.height ? y - band.top : null;
}

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * Arrow-key travel between cards in a week: up and down walk the day's
 * cards by time, left and right jump to the nearest-in-time card of the
 * closest day that has one. Null when there is nowhere to go.
 */
export function nextCardIndex(
  cards: ReadonlyArray<{ col: number; top: number }>,
  from: number,
  key: ArrowKey,
): number | null {
  const cur = cards[from];
  if (!cur) return null;
  let best: number | null = null;
  let bestScore = Infinity;
  cards.forEach((c, i) => {
    if (i === from) return;
    let score: number;
    if (key === "ArrowDown" || key === "ArrowUp") {
      if (c.col !== cur.col) return;
      const d = key === "ArrowDown" ? c.top - cur.top : cur.top - c.top;
      if (d < 0 || (d === 0 && (key === "ArrowDown" ? i < from : i > from))) return;
      score = d;
    } else {
      const dc = key === "ArrowRight" ? c.col - cur.col : cur.col - c.col;
      if (dc <= 0) return;
      score = dc * 1e6 + Math.abs(c.top - cur.top);
    }
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Case-insensitive match on the words a card shows: title, patient name and code. */
export function eventMatches(ev: CalendarEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [describeEvent(ev).title];
  if (ev.kind === "appointment") hay.push(ev.patientName, ev.patientCode ?? "");
  return hay.some((h) => h.toLowerCase().includes(q));
}

/* ─── Date math ─────────────────────────────────────────────────── */

export function startOfDay(d: Date): Date {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfDay(d: Date): Date {
  const next = new Date(d);
  next.setHours(23, 59, 59, 999);
  return next;
}

/** Week starts on Monday — matches Ugandan + European conventions. */
export function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diff = (day + 6) % 7; // distance back to Monday
  const next = startOfDay(d);
  next.setDate(next.getDate() - diff);
  return next;
}

export function endOfWeek(d: Date): Date {
  const start = startOfWeek(d);
  const next = new Date(start);
  next.setDate(next.getDate() + 7);
  return next;
}

export function startOfMonth(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonth(d: Date): Date {
  return startOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

/** Inclusive grid covering a month: starts on Monday of the first week, ends Sunday of the last week. */
export function monthGridRange(d: Date): DateRange {
  return { start: startOfWeek(startOfMonth(d)), end: endOfWeek(endOfMonth(d)) };
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * A day cell's key — the browser-local calendar date the `days` array was
 * built from. Events are bucketed by `eventDayKey` (the hospital's date), so
 * the two agree on "Mon 14" whatever zone the laptop is set to.
 */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The hospital's date for an instant — where an event belongs. */
export function eventDayKey(instant: Date): string {
  return localDateKey(instant, DEFAULT_TIME_ZONE);
}

/** The hospital's date today. */
export function todayKey(): string {
  return localDateKey(new Date(), DEFAULT_TIME_ZONE);
}

export function isToday(d: Date): boolean {
  return dayKey(d) === todayKey();
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Days in [start, end). */
export function daysBetween(range: DateRange): Date[] {
  const out: Date[] = [];
  let cursor = startOfDay(range.start);
  const end = startOfDay(range.end);
  while (cursor < end) {
    out.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

/* ─── Formatters ────────────────────────────────────────────────── */

export function formatMonthYear(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const startLabel = weekStart.toLocaleDateString(undefined, {
    month: sameMonth ? "short" : "short",
    day: "numeric",
  });
  const endLabel = sameMonth
    ? end.toLocaleDateString(undefined, { day: "numeric" })
    : end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}, ${weekStart.getFullYear()}`;
}

export function formatDay(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** 24-hour, on the hospital's clock (DESIGN "Clinical data display"). */
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: DEFAULT_TIME_ZONE,
});

export function formatTime(d: Date): string {
  return TIME_FMT.format(d);
}

export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Minutes since midnight on the HOSPITAL's clock — where a card sits on the grid. */
export function minutesSinceMidnight(d: Date): number {
  return localWeekdayAndMinutes(d, DEFAULT_TIME_ZONE).minutesOfDay;
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
