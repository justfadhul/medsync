import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The day picker for the dose timeline: a month label, two day steppers and
 * seven chips. Every one of them is a `<Link>` carrying `?d=YYYY-MM-DD`.
 *
 * There is no `"use client"` here and there is no state. The selected day is
 * already modelled by the URL, so a client day-picker would be a state
 * machine duplicating the address bar — and seven links in DOM order give
 * Tab traversal, Enter activation and middle-click for free, with no
 * `tabIndex` juggling and no keydown handler.
 *
 * The strip shows a window of seven days inside the reachable range. The
 * window ends on `maxIso` whenever the selected day is near enough, so
 * moving between recent days never makes the strip jump underfoot; only a
 * selection older than the window slides it.
 */

const DAYS = 7;

const MONTH_FMT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const NARROW_DAY_FMT = new Intl.DateTimeFormat("en-GB", { weekday: "narrow" });
const LONG_DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export interface DayStripProps {
  /** YYYY-MM-DD. Clamped to `[minIso, maxIso]` before anything is rendered. */
  selectedIso: string;
  /** The route the chips link back to, e.g. "/patient/track/doses". */
  basePath: string;
  minIso: string;
  maxIso: string;
  className?: string;
}

export function DayStrip({ selectedIso, basePath, minIso, maxIso, className }: DayStripProps) {
  const max = fromDayIso(maxIso) ?? startOfDay(new Date());
  const min = earlier(fromDayIso(minIso) ?? max, max);
  const selected = clampDay(fromDayIso(selectedIso) ?? max, min, max);

  // Prefer the window that ends on the newest reachable day; fall back to one
  // ending on the selection when the selection sits before it.
  const lastStart = addDays(max, -(DAYS - 1));
  const start = later(min, selected >= lastStart ? lastStart : addDays(selected, -(DAYS - 1)));

  const days: Date[] = [];
  for (let i = 0; i < DAYS; i += 1) {
    const day = addDays(start, i);
    if (day > max) break;
    days.push(day);
  }

  const todayIso = toDayIso(new Date());
  const prev = selected > min ? addDays(selected, -1) : null;
  const next = selected < max ? addDays(selected, 1) : null;

  return (
    <nav aria-label="Choose a day" className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <DayStep basePath={basePath} to={prev} direction="previous" />
        {/* Live, because client-side navigation swaps this heading in place
            and the month is the only thing the chips below don't say. */}
        <h2 aria-live="polite" className="text-foreground text-heading-s">
          {MONTH_FMT.format(selected)}
        </h2>
        <DayStep basePath={basePath} to={next} direction="next" />
      </div>

      <ul className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const iso = toDayIso(day);
          const isSelected = iso === toDayIso(selected);
          const isToday = iso === todayIso;

          return (
            <li key={iso}>
              <Link
                href={`${basePath}?d=${iso}`}
                scroll={false}
                aria-current={isSelected ? "date" : undefined}
                className={cn(
                  "tap flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg",
                  isSelected
                    ? // `select-flare` re-fires on the class change alone: the
                      // <li> keeps its key, so React swaps the class rather
                      // than the node, and the animation-name flip replays it.
                      "bg-primary text-primary-foreground select-flare"
                    : "bg-card text-muted-foreground dark:shadow-card shadow-xs",
                  isToday && !isSelected && "ring-brand-300 ring-1",
                )}
              >
                {/* Both halves are hidden from assistive tech so it reads
                    "Thursday 12 March" instead of "T 12".

                    Today prints the word in place of its weekday initial:
                    the ring alone was colour carrying state, and the ring
                    is the one thing a sighted user cannot read. The number
                    below still says which day this is, so nothing is lost
                    by spending the initial on it. */}
                <span aria-hidden className="text-caption whitespace-nowrap">
                  {isToday ? "Today" : NARROW_DAY_FMT.format(day)}
                </span>
                <span aria-hidden className="text-body-m tabular font-mono font-medium">
                  {pad2(day.getDate())}
                </span>
                <span className="sr-only">
                  {LONG_DAY_FMT.format(day)}
                  {isToday ? " — today" : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * One end of the stepper. A step that would leave the reachable range is a
 * disabled button rather than a link to nowhere — the range is eight days,
 * so a chevron that looked live but moved nothing would be the fake
 * affordance this workspace refuses.
 */
function DayStep({
  basePath,
  to,
  direction,
}: {
  basePath: string;
  to: Date | null;
  direction: "previous" | "next";
}) {
  const Icon = direction === "previous" ? ChevronLeftIcon : ChevronRightIcon;

  if (!to) {
    return (
      <Button
        variant="ghost"
        size="iconLg"
        disabled
        aria-label={direction === "previous" ? "No earlier day to show" : "No later day to show"}
      >
        <Icon strokeWidth={1.5} aria-hidden />
      </Button>
    );
  }

  // A `<Link>` wearing the button's classes, not `<Button render={<Link/>}>`:
  // base-ui's non-native path stamps `role="button"` over a navigation, and
  // leaving it native puts `type="button"` on an `<a>` and warns in dev.
  return (
    <Link
      href={`${basePath}?d=${toDayIso(to)}`}
      scroll={false}
      aria-label={`${direction === "previous" ? "Previous" : "Next"} day, ${LONG_DAY_FMT.format(to)}`}
      className={buttonVariants({ variant: "ghost", size: "iconLg" })}
    >
      <Icon strokeWidth={1.5} aria-hidden className="size-5" />
    </Link>
  );
}

/* ─── day arithmetic ─────────────────────────────────────────────── */
/* Exported so the page that owns `?d=` clamps with exactly the same
 * calendar the strip draws. `new Date("2026-03-12")` parses as UTC and
 * lands on the previous day west of Greenwich, so the ISO parse below is
 * deliberately manual and local. */

export function toDayIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local midnight of a "YYYY-MM-DD", or null if it isn't one. */
export function fromDayIso(iso: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const out = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Rejects "2026-02-31", which Date would silently roll into March.
  return Number.isNaN(out.getTime()) || out.getDate() !== Number(m[3]) ? null : out;
}

/** Host-local like `fromDayIso` above — the patient's calendar, not a
 * hospital's; `lib/patient/doses.ts` says why the cluster moves together. */
export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function clampDay(d: Date, min: Date, max: Date): Date {
  return later(min, earlier(d, max));
}

function earlier(a: Date, b: Date): Date {
  return a <= b ? a : b;
}

function later(a: Date, b: Date): Date {
  return a >= b ? a : b;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
