import type { ExpectedDayCounts } from "@/lib/reception/queries";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DEFAULT_TIME_ZONE,
  localDateKey,
  localWeekdayAndMinutes,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";

const DAY_MS = 86_400_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The hospital-local Mon→Sun week containing `anchor`, as date keys, plus the neighbours' Mondays. */
export function weekOf(anchor: Date): {
  mondayStart: Date;
  keys: string[];
  prevKey: string;
  nextKey: string;
} {
  const { isoWeekday } = localWeekdayAndMinutes(anchor, DEFAULT_TIME_ZONE);
  const mondayStart = startOfLocalDay(
    new Date(anchor.getTime() - (isoWeekday - 1) * DAY_MS),
    DEFAULT_TIME_ZONE,
  );
  // Noon of each day: a key that cannot straddle a boundary.
  const keyAt = (days: number) =>
    localDateKey(new Date(mondayStart.getTime() + days * DAY_MS + DAY_MS / 2), DEFAULT_TIME_ZONE);
  return {
    mondayStart,
    keys: Array.from({ length: 7 }, (_, i) => keyAt(i)),
    prevKey: keyAt(-7),
    nextKey: keyAt(7),
  };
}

/** "Tue 22 Sep" from "2026-09-22" — no locale, no host zone. */
export function formatDayKey(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  return `${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTH[m - 1]}`;
}

function countWords(c: ExpectedDayCounts, future: boolean): string[] {
  const words: string[] = [];
  if (c.expected) words.push(`${c.expected} expected`);
  if (future) return words;
  if (c.arrived) words.push(`${c.arrived} arrived`);
  if (c.noShow) words.push(`${c.noShow} no-show`);
  if (c.declared) words.push(`${c.declared} declared`);
  return words;
}

/**
 * A week of days in the calendar's day-header idiom: weekday, the number in
 * a disc (today filled), and under it the day's counts as words. Each cell
 * is a link to that day's board — the strip is navigation, not a chart.
 */
export function DayStrip({
  counts,
  selectedKey,
  todayKey,
  prevKey,
  nextKey,
}: {
  counts: ReadonlyArray<ExpectedDayCounts>;
  selectedKey: string;
  todayKey: string;
  prevKey: string;
  nextKey: string;
}) {
  const first = counts[0]?.dateKey;
  const last = counts[counts.length - 1]?.dateKey;
  return (
    <nav
      aria-label="Expected arrivals by day"
      className="border-border bg-card dark:shadow-card flex flex-col rounded-lg border shadow-xs"
    >
      <div className="border-border flex min-h-11 items-center justify-between gap-2 border-b px-2">
        <Link
          href={`/reception/expected?date=${prevKey}`}
          aria-label="Previous week"
          className="text-muted-foreground hover:text-foreground hover:bg-muted/40 ease-expo-out inline-flex size-11 items-center justify-center rounded-md transition-colors duration-150"
        >
          <ChevronLeftIcon className="size-4" aria-hidden />
        </Link>
        <span className="text-muted-foreground text-caption font-mono tabular-nums">
          {first && last ? `${formatDayKey(first)} – ${formatDayKey(last)}` : null}
        </span>
        <div className="flex items-center gap-1">
          {selectedKey !== todayKey ? (
            <Link
              href={`/reception/expected?date=${todayKey}`}
              className="text-brand-700 hover:bg-brand-50 dark:text-brand-300 text-caption ease-expo-out inline-flex min-h-11 items-center rounded-md px-3 font-medium transition-colors duration-150"
            >
              Today
            </Link>
          ) : null}
          <Link
            href={`/reception/expected?date=${nextKey}`}
            aria-label="Next week"
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 ease-expo-out inline-flex size-11 items-center justify-center rounded-md transition-colors duration-150"
          >
            <ChevronRightIcon className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <ul className="grid grid-cols-7">
        {counts.map((c) => {
          const isToday = c.dateKey === todayKey;
          const isSelected = c.dateKey === selectedKey;
          const words = countWords(c, c.dateKey > todayKey);
          return (
            <li key={c.dateKey} className="border-border/60 min-w-0 border-l first:border-l-0">
              <Link
                href={`/reception/expected?date=${c.dateKey}`}
                aria-current={isSelected ? "date" : undefined}
                aria-label={`${formatDayKey(c.dateKey)}${isToday ? ", today" : ""}: ${
                  words.length ? words.join(", ") : "nothing expected"
                }`}
                className={cn(
                  "hover:bg-ink-25 ease-expo-out flex min-h-11 flex-col items-center gap-1 px-1 py-2.5 transition-colors duration-150",
                  isSelected && "bg-muted/30",
                )}
              >
                <span className="text-muted-foreground font-mono text-[9.5px] tracking-[0.14em] uppercase">
                  {formatDayKey(c.dateKey).slice(0, 3)}
                </span>
                <span
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full font-mono text-[13px] tabular-nums",
                    isToday ? "bg-brand-600 text-white" : "text-foreground",
                    isSelected && "ring-brand-600 ring-offset-card ring-1 ring-offset-1",
                  )}
                >
                  {Number(c.dateKey.slice(-2))}
                </span>
                <span className="text-muted-foreground text-caption flex min-h-4 flex-col items-center text-center leading-snug font-normal">
                  {words.length ? (
                    words.map((w) => <span key={w}>{w}</span>)
                  ) : (
                    <span aria-hidden className="text-muted-foreground/50">
                      —
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
