/**
 * Care mode's plan as a day, the week of medicines, and what Today's ladder reads (patient app v2 §5.6, M6;
 * MR3, MR13). Pure and shared: the phone uses it from Step 7, the web from Step 9.
 *
 * A plan item is what the care team wrote (0301 `care_plan_versions.items`): a key, a name, why, and the
 * clock times it falls at. It never carries an amount (MR3: the database refuses one); "as on your pharmacy
 * label" is the screen's words. Ticks are `dose_events`, written once per client key (S18); the newest tick
 * for a slot wins. Hospital time is Kampala, UTC+3 all year.
 */
import type { TodayState } from "./today-hero";

export interface CarePlanItem {
  key: string;
  name: string;
  why?: string | null;
  /** Medicines by default; a sugar or pressure check; a walk. */
  kind?: "dose" | "check" | "walk";
  /** "08:00", "20:00": Kampala clock times. */
  times: string[];
}

export interface DoseTick {
  medicineKey: string;
  dueAtIso: string;
  status: "taken" | "skipped" | "snoozed";
  recordedAtIso: string;
}

export type SlotState = "done" | "skipped" | "snoozed" | "due" | "later" | "missed";

export interface PlanSlot {
  /** `${itemKey}@${time}`: stable for a day. */
  key: string;
  itemKey: string;
  name: string;
  why: string | null;
  kind: "dose" | "check" | "walk";
  at: string;
  dueAtIso: string;
  state: SlotState;
}

/** Plan items as the care team wrote them; anything malformed is left out, never guessed (MR3). */
export function planItemsOf(raw: unknown): CarePlanItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((i) => {
    const o = i as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.name !== "string" || !Array.isArray(o.times))
      return [];
    const times = o.times.filter(
      (t): t is string => typeof t === "string" && /^\d{2}:\d{2}$/.test(t),
    );
    const kind = o.kind === "check" || o.kind === "walk" ? o.kind : "dose";
    return [
      { key: o.key, name: o.name, why: typeof o.why === "string" ? o.why : null, kind, times },
    ];
  });
}

const KAMPALA_MS = 3 * 3600_000;
/** A slot is "due" from 30 minutes before its time to 2 hours after; then "missed". */
const EARLY_MS = 30 * 60_000;
const LATE_MS = 2 * 3600_000;

/** "2026-11-16" for the Kampala day of an instant. */
export function kampalaDayKey(d: Date): string {
  return new Date(d.getTime() + KAMPALA_MS).toISOString().slice(0, 10);
}

/** The UTC instant of a Kampala clock time on a Kampala day. */
export function kampalaInstant(dayKey: string, hhmm: string): Date {
  return new Date(new Date(`${dayKey}T${hhmm}:00Z`).getTime() - KAMPALA_MS);
}

function latestTicks(ticks: DoseTick[]): Map<string, DoseTick> {
  const out = new Map<string, DoseTick>();
  for (const t of ticks) {
    const k = `${t.medicineKey}|${new Date(t.dueAtIso).toISOString()}`;
    const had = out.get(k);
    if (!had || had.recordedAtIso < t.recordedAtIso) out.set(k, t);
  }
  return out;
}

/** One Kampala day of the plan, in time order, each slot with its state at `now`. */
export function planDay(
  items: CarePlanItem[],
  ticks: DoseTick[],
  dayKey: string,
  now: Date,
): PlanSlot[] {
  const last = latestTicks(ticks);
  const slots: PlanSlot[] = [];
  for (const item of items) {
    for (const at of item.times) {
      const due = kampalaInstant(dayKey, at);
      const tick = last.get(`${item.key}|${due.toISOString()}`);
      const t = now.getTime() - due.getTime();
      const state: SlotState =
        tick?.status === "taken"
          ? "done"
          : tick?.status === "skipped"
            ? "skipped"
            : tick?.status === "snoozed" && t < LATE_MS
              ? "snoozed"
              : t < -EARLY_MS
                ? "later"
                : t <= LATE_MS
                  ? "due"
                  : "missed";
      slots.push({
        key: `${item.key}@${at}`,
        itemKey: item.key,
        name: item.name,
        why: item.why ?? null,
        kind: item.kind ?? "dose",
        at,
        dueAtIso: due.toISOString(),
        state,
      });
    }
  }
  return slots.sort((a, b) => a.at.localeCompare(b.at) || a.name.localeCompare(b.name));
}

export type WeekMark = "taken" | "some" | "missed" | "due" | "none";

/** The week of medicines as dots, oldest first, ending today: taken, some missed, missed, due (§5.6). */
export function medsWeek(
  items: CarePlanItem[],
  ticks: DoseTick[],
  now: Date,
): { dayKey: string; mark: WeekMark }[] {
  const doses = items.filter((i) => (i.kind ?? "dose") === "dose");
  const today = kampalaDayKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const dayKey = kampalaDayKey(new Date(now.getTime() - (6 - i) * 86_400_000));
    const slots = planDay(doses, ticks, dayKey, now);
    if (slots.length === 0) return { dayKey, mark: "none" as const };
    const taken = slots.filter((s) => s.state === "done").length;
    const open = slots.filter(
      (s) => s.state === "due" || s.state === "later" || s.state === "snoozed",
    ).length;
    const mark: WeekMark =
      taken === slots.length
        ? "taken"
        : dayKey === today && open > 0
          ? "due"
          : taken === 0
            ? "missed"
            : "some";
    return { dayKey, mark };
  });
}

export interface CareAlert {
  kind: NonNullable<TodayState["danger"]>["kind"];
  atIso: string;
  acknowledged: boolean;
}

export interface TeamAsk {
  id: string;
  from: string;
  atIso: string;
}

/**
 * What Today's ladder reads (`heroFor`). Danger: an alert from the last 24 hours the team has not yet
 * acknowledged. A team ask: the oldest unanswered request. Due now: the first slot due. Next: the first slot
 * later today. Nothing until: tomorrow's first slot.
 */
export function careTodayState(input: {
  items: CarePlanItem[];
  ticks: DoseTick[];
  alerts: CareAlert[];
  asks: TeamAsk[];
  visitToday: TodayState["visitToday"];
  now: Date;
}): TodayState {
  const { now } = input;
  const day = kampalaDayKey(now);
  const slots = planDay(input.items, input.ticks, day, now);
  const recent = input.alerts
    .filter((a) => !a.acknowledged && now.getTime() - new Date(a.atIso).getTime() < 24 * 3600_000)
    .sort((a, b) => b.atIso.localeCompare(a.atIso))[0];
  const ask = [...input.asks].sort((a, b) => a.atIso.localeCompare(b.atIso))[0];
  const due = slots.find((s) => s.state === "due" || s.state === "snoozed");
  const next = slots.find((s) => s.state === "later");
  const tomorrow = kampalaDayKey(new Date(now.getTime() + 86_400_000));
  const first = planDay(input.items, [], tomorrow, now)[0];
  return {
    danger: recent ? { kind: recent.kind, at: recent.atIso } : null,
    teamAsks: ask ? { id: ask.id, from: ask.from, at: ask.atIso } : null,
    dueNow:
      due && due.kind !== "walk"
        ? {
            kind: due.kind === "check" ? "check" : "dose",
            key: due.key,
            label: due.name,
            dueAt: due.at,
          }
        : null,
    visitToday: input.visitToday,
    nextItem: next ? { kind: next.kind, label: next.name, at: next.at } : null,
    nothingUntil: first ? `tomorrow ${first.at}` : null,
  };
}

/* ─── The reading card's last 10 days (§5.7), phone now, web at Step 9 ───────── */

export interface CardReading {
  at: string;
  input:
    | { kind: "bp"; top: number | null; bottom: number | null }
    | { kind: "sugar"; value: number | null; context: string }
    | { kind: "weight" | "pulse"; value: number | null };
}

export interface CardDay {
  /** "16 Nov" */
  date: string;
  dayKey: string;
  value: number | null;
  bottom?: number | null;
}

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * One value per Kampala day for the last 10 days, oldest first, with gaps where there was no reading (never
 * filled in), plus the value nearest a week before the latest, for "↓ 0.6 in a week". Sugar keeps only the
 * timing asked for (fasting by default), so a fasting card never mixes in an after-meal number.
 */
export function tenDays(
  readings: CardReading[],
  metric: "bp" | "sugar" | "weight",
  now: Date,
  sugarContext = "fasting",
): { days: CardDay[]; weekAgo: number | null } {
  return daysOf(readings, metric, now, 10, sugarContext);
}

/** The same, over `n` days (the Readings page draws 30). */
export function daysOf(
  readings: CardReading[],
  metric: "bp" | "sugar" | "weight",
  now: Date,
  n: number,
  sugarContext = "fasting",
): { days: CardDay[]; weekAgo: number | null } {
  const mine = readings
    .filter(
      (r) =>
        r.input.kind === metric &&
        (metric !== "sugar" || (r.input as { context: string }).context === sugarContext),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const byDay = new Map<string, CardReading>();
  for (const r of mine) {
    const k = kampalaDayKey(new Date(r.at));
    if (!byDay.has(k)) byDay.set(k, r);
  }
  const days: CardDay[] = Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getTime() - (n - 1 - i) * 86_400_000);
    const dayKey = kampalaDayKey(d);
    const r = byDay.get(dayKey);
    const [, m, dd] = dayKey.split("-");
    const date = `${Number(dd)} ${MONTHS_SHORT[Number(m) - 1]}`;
    if (!r) return { date, dayKey, value: null };
    if (r.input.kind === "bp") return { date, dayKey, value: r.input.top, bottom: r.input.bottom };
    return { date, dayKey, value: (r.input as { value: number | null }).value };
  });
  const latest = [...days].reverse().find((d) => d.value !== null);
  let weekAgo: number | null = null;
  if (latest) {
    const target = new Date(`${latest.dayKey}T00:00:00Z`).getTime() - 7 * 86_400_000;
    let best: { gap: number; v: number } | null = null;
    for (const r of mine) {
      const v = r.input.kind === "bp" ? r.input.top : (r.input as { value: number | null }).value;
      if (v === null) continue;
      const k = new Date(`${kampalaDayKey(new Date(r.at))}T00:00:00Z`).getTime();
      const gap = Math.abs(k - target);
      if (gap <= 2 * 86_400_000 && (!best || gap < best.gap)) best = { gap, v };
    }
    weekAgo = best?.v ?? null;
  }
  return { days, weekAgo };
}

/** The Readings page's stats over the days shown: the average, how many days were in target, the latest. */
export function readingStats(
  days: CardDay[],
  band: { lo: number; hi: number } | null,
): {
  average: number | null;
  averageBottom: number | null;
  inTarget: number | null;
  logged: number;
  latest: CardDay | null;
} {
  const logged = days.filter((d) => d.value !== null);
  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  const bottoms = logged.flatMap((d) => (typeof d.bottom === "number" ? [d.bottom] : []));
  return {
    average: avg(logged.map((d) => d.value as number)),
    averageBottom: bottoms.length ? Math.round(avg(bottoms)!) : null,
    inTarget: band
      ? logged.filter((d) => (d.value as number) >= band.lo && (d.value as number) <= band.hi)
          .length
      : null,
    logged: logged.length,
    latest: logged.at(-1) ?? null,
  };
}
