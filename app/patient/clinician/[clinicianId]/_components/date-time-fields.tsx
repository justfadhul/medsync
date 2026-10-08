"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { formatTime } from "@/lib/patient/booking-format";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE, localDateKey } from "@/supabase/functions/_shared/slots";

/**
 * The reference's day strip: a pill per day with its number in a disc, the
 * weekday letter above — one week across, from today, scrolling sideways a
 * week at a time for the rest of the horizon. A month select above jumps to
 * a month and names the week on view; the arrows page for a mouse. The
 * chosen day is raised with the brand disc and a ▼ over it; a closed day is
 * dimmed. Under it, the day's open times as an even grid of soft badges,
 * four across. Same component, same name, on the phone.
 */
export function DateTimeFields({
  slotsByDate,
  day,
  slot,
  onDay,
  onSlot,
}: {
  slotsByDate: Record<string, ReadonlyArray<{ startsAtIso: string; endsAtIso: string }>>;
  day: string | null;
  slot: string | null;
  onDay: (day: string) => void;
  onSlot: (startsAtIso: string) => void;
}) {
  const today = localDateKey(new Date(), DEFAULT_TIME_ZONE);
  const open = useMemo(() => Object.keys(slotsByDate).sort(), [slotsByDate]);
  const cells = useMemo(() => weekRows(today, open[open.length - 1] ?? today), [today, open]);
  const months = useMemo(() => [...new Set(cells.map((k) => k.slice(0, 7)))], [cells]);
  const pages = cells.length / 7;
  const slots = day ? (slotsByDate[day] ?? []) : [];

  const strip = useRef<HTMLDivElement>(null);
  // The week on view; the month select follows it. It opens on the chosen
  // day's week.
  const [page, setPage] = useState(() => Math.max(0, Math.floor(cells.indexOf(day ?? "") / 7)));
  const month = cells[page * 7]!.slice(0, 7);
  useEffect(() => {
    const el = strip.current;
    if (el && page > 0) el.scrollLeft = page * (el.clientWidth + GAP);
    // Once, on mount: land on the chosen week without a scroll animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = (p: number) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: p * (el.clientWidth + GAP), behavior: "smooth" });
    setPage(p);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="relative">
          <span className="sr-only">Month</span>
          <select
            value={month}
            onChange={(e) =>
              goTo(Math.floor(cells.findIndex((k) => k.startsWith(e.target.value)) / 7))
            }
            className="text-body-m text-foreground hover:bg-muted focus-visible:ring-ring h-9 cursor-pointer rounded-lg bg-transparent pl-2 font-medium outline-none focus-visible:ring-2"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {MONTH_LONG.format(atNoon(`${m}-01`))}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Previous week"
            disabled={page === 0}
            onClick={() => goTo(page - 1)}
            className="hover:bg-muted focus-visible:ring-ring grid size-9 place-items-center rounded-lg outline-none focus-visible:ring-2 disabled:opacity-40"
          >
            <ChevronLeftIcon className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next week"
            disabled={page >= pages - 1}
            onClick={() => goTo(page + 1)}
            className="hover:bg-muted focus-visible:ring-ring grid size-9 place-items-center rounded-lg outline-none focus-visible:ring-2 disabled:opacity-40"
          >
            <ChevronRightIcon className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div
        ref={strip}
        role="radiogroup"
        aria-label="Day"
        onScroll={(e) => {
          const el = e.currentTarget;
          const p = Math.round(el.scrollLeft / (el.clientWidth + GAP));
          if (p !== page) setPage(p);
        }}
        className="-mx-1 grid snap-x snap-mandatory [scrollbar-width:none] auto-cols-[calc((100%-36px)/7)] grid-flow-col gap-x-1.5 overflow-x-auto px-1 pt-1 pb-3 [&::-webkit-scrollbar]:hidden"
      >
        {cells.map((key, i) => {
          const isOpen = key in slotsByDate;
          const chosen = key === day;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={!isOpen}
              aria-label={`${DAY_LONG.format(atNoon(key))}${key === today ? ", today" : ""}${isOpen ? "" : ", nothing open"}`}
              onClick={() => onDay(key)}
              className={cn(
                "group flex flex-col items-center gap-1 outline-none",
                i % 7 === 0 && "snap-start",
              )}
            >
              <span aria-hidden className="text-foreground h-3 text-[9px] leading-3">
                {chosen ? "▼" : ""}
              </span>
              <span aria-hidden className="text-caption text-muted-foreground font-medium">
                {WEEKDAY_LETTER.format(atNoon(key))}
              </span>
              <span
                className={cn(
                  "flex h-16 w-11 flex-col items-center rounded-full pt-1 transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  "group-focus-visible:ring-ring group-focus-visible:ring-2 group-focus-visible:ring-offset-2",
                  chosen
                    ? "bg-card ring-foreground/5 -translate-y-0.5 shadow-[0_10px_20px_-8px_rgb(0_0_0/0.3)] ring-1"
                    : isOpen
                      ? "bg-muted group-hover:bg-foreground/10"
                      : "bg-muted opacity-55",
                )}
              >
                <span
                  className={cn(
                    "text-body-s grid size-9 place-items-center rounded-full font-medium tabular-nums",
                    chosen
                      ? "bg-primary text-primary-foreground"
                      : isOpen
                        ? "bg-card text-foreground"
                        : "bg-border text-muted-foreground",
                  )}
                >
                  {Number(key.slice(8, 10))}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {day === null ? null : slots.length === 0 ? (
        <p className="text-body-s text-muted-foreground">Nothing open that day.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Time">
          {slots.map((s) => {
            const chosen = s.startsAtIso === slot;
            return (
              <button
                key={s.startsAtIso}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={`${formatTime(s.startsAtIso)} to ${formatTime(s.endsAtIso)}`}
                onClick={() => onSlot(s.startsAtIso)}
                className={cn(
                  "text-body-s focus-visible:ring-ring h-10 rounded-lg font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  chosen
                    ? "bg-foreground text-background"
                    : "bg-muted text-foreground hover:bg-foreground/10",
                )}
              >
                {formatTime(s.startsAtIso)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The column gap in px — `gap-x-1.5`; six of them come off the week's width. */
const GAP = 6;

const WEEKDAY_LETTER = new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });
const DAY_LONG = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function atNoon(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

/** Every day from `from` through `to`, padded to whole weeks of seven. */
function weekRows(from: string, to: string): string[] {
  const out: string[] = [];
  const t = atNoon(from);
  const end = atNoon(to < from ? from : to).getTime();
  while (t.getTime() <= end || out.length % 7 !== 0) {
    out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}
