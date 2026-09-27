"use client";

import type { CalendarEvent, OnEventClick } from "./types";

import { cn } from "@/lib/utils";
import {
  dayKey,
  daysBetween,
  endOfWeek,
  isToday,
  sameDay,
  startOfDay,
  startOfWeek,
} from "./helpers";
import { TimeGrid } from "./time-grid";

type ParsedEvent = CalendarEvent & { startsAt: Date; endsAt: Date };

/**
 * One day on the time grid. With `onDayPick` (the narrow fallback for the
 * week) a strip of the week's seven days sits above it, so the week is one
 * tap away rather than six presses of Next.
 */
export function DayView({
  cursor,
  events,
  onEventClick,
  selectedId,
  timeZoneLabel,
  onDayPick,
}: {
  cursor: Date;
  events: ReadonlyArray<ParsedEvent>;
  onEventClick?: OnEventClick;
  selectedId?: string | null;
  timeZoneLabel: string;
  onDayPick?: (day: Date) => void;
}) {
  const day = startOfDay(cursor);
  return (
    <div className="flex h-full min-w-0 flex-col">
      {onDayPick ? (
        <div
          role="group"
          aria-label="Days of this week"
          className="border-border grid shrink-0 grid-cols-7 border-b"
        >
          {daysBetween({ start: startOfWeek(cursor), end: endOfWeek(cursor) }).map((d) => {
            const picked = sameDay(d, day);
            const today = isToday(d);
            return (
              <button
                key={dayKey(d)}
                type="button"
                aria-pressed={picked}
                aria-label={d.toLocaleDateString(undefined, { dateStyle: "full" })}
                onClick={() => onDayPick(d)}
                className={cn(
                  "ease-expo-out flex min-h-11 flex-col items-center justify-center gap-0.5 border-b-2 text-[11px] transition-colors duration-150",
                  "focus-visible:shadow-focus focus-visible:outline-none",
                  picked
                    ? "border-primary text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                <span>{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-[13px] tabular-nums",
                    today && "text-primary-foreground bg-teal-700",
                  )}
                >
                  {d.getDate()}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <TimeGrid
          days={[day]}
          selectedDay={day}
          events={events}
          onEventClick={onEventClick}
          selectedId={selectedId}
          timeZoneLabel={timeZoneLabel}
        />
      </div>
    </div>
  );
}
