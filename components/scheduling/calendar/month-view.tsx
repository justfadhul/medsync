"use client";

import type { CalendarEvent, OnEventClick } from "./types";

import { cn } from "@/lib/utils";
import {
  dayKey,
  daysBetween,
  describeEvent,
  eventDayKey,
  formatTime,
  isSameMonth,
  isToday,
  monthGridRange,
  WEEKDAY_SHORT,
} from "./helpers";
import { HUE, STATUS_TONE } from "./tones";

type ParsedEvent = CalendarEvent & { startsAt: Date; endsAt: Date };

/**
 * Month grid. Each cell renders day number + up to 3 small event
 * pills (the kind as a word, then the title) + a "+N more" link if there
 * are extras. Click cell → caller switches to day view; click pill →
 * opens the detail sheet.
 */
export function MonthView({
  cursor,
  events,
  onDayClick,
  onEventClick,
}: {
  cursor: Date;
  events: ReadonlyArray<ParsedEvent>;
  onDayClick: (d: Date) => void;
  onEventClick?: OnEventClick;
}) {
  const range = monthGridRange(cursor);
  const days = daysBetween(range);
  const byDay = bucketByDay(events);

  return (
    <div className="flex h-full flex-col overflow-y-auto" role="grid" aria-label="Month view">
      {/* Weekday header */}
      <div className="border-border grid grid-cols-7 border-b">
        {WEEKDAY_SHORT.map((label) => (
          <div
            key={label}
            className="text-muted-foreground bg-muted px-2 py-2 text-left text-[13px] font-semibold"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid min-h-120 flex-1 auto-rows-fr grid-cols-7">
        {days.map((d) => {
          const dayEvents = byDay.get(dayKey(d)) ?? [];
          const inMonth = isSameMonth(d, cursor);
          const today = isToday(d);
          const visible = dayEvents.slice(0, 3);
          const extra = dayEvents.length - visible.length;
          return (
            <button
              key={dayKey(d)}
              type="button"
              role="gridcell"
              aria-label={d.toLocaleDateString(undefined, { dateStyle: "full" })}
              onClick={() => onDayClick(d)}
              className={cn(
                "border-border group hover:bg-muted/60 focus-visible:shadow-focus ease-expo-out flex flex-col items-stretch gap-1 border-t border-l p-1.5 text-left transition-colors duration-150 first:border-l-0 focus-visible:outline-none",
                !inMonth && "bg-muted/40",
                today && "bg-accent/40",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center self-start rounded-full text-[13px] tabular-nums",
                  today
                    ? "text-primary-foreground bg-teal-700 font-semibold"
                    : inMonth
                      ? "text-foreground"
                      : "text-muted-foreground/60",
                )}
              >
                {d.getDate()}
              </span>
              <ul className="flex flex-col gap-0.5">
                {visible.map((ev) => {
                  const desc = describeEvent(ev);
                  const Mark = desc.status ? STATUS_TONE[desc.status].icon : desc.kindIcon;
                  return (
                    <li key={ev.id}>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          if (desc.clickable) onEventClick?.(ev);
                        }}
                        title={[desc.kindLabel, desc.statusWord, desc.title]
                          .filter(Boolean)
                          .join(" · ")}
                        className={cn(
                          "border-border flex min-w-0 cursor-pointer items-center gap-1 rounded-[6px] border px-1 py-0.5 text-[11px]",
                          desc.struck ? "bg-muted border-dashed" : "bg-card",
                        )}
                      >
                        <Mark
                          className={cn(
                            "size-3 shrink-0",
                            desc.status ? STATUS_TONE[desc.status].mark : HUE[desc.hue].icon,
                          )}
                          aria-hidden
                        />
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {formatTime(ev.startsAt)}
                        </span>
                        <span
                          className={cn(
                            "text-foreground truncate font-medium",
                            desc.struck && "line-through",
                          )}
                        >
                          {desc.status === "urgent" ? "Urgent · " : ""}
                          {desc.title}
                        </span>
                      </span>
                    </li>
                  );
                })}
                {extra > 0 ? (
                  <li className="text-muted-foreground px-1 text-[11px] tabular-nums">
                    +{extra} more
                  </li>
                ) : null}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function bucketByDay(events: ReadonlyArray<ParsedEvent>): Map<string, ParsedEvent[]> {
  const out = new Map<string, ParsedEvent[]>();
  const drawnSessions = new Set(
    events.filter((e) => e.kind === "session").map((e) => e.id.replace(/^s-/, "")),
  );
  for (const ev of events) {
    // Availability is the grid's background, not a pill that crowds bookings out of a cell.
    if (ev.kind === "availability") continue;
    // A session-held booking is one of the clinic day's places; the day's pill stands for it while drawn.
    if (ev.kind === "appointment" && ev.sessionId && drawnSessions.has(ev.sessionId)) continue;
    const k = eventDayKey(ev.startsAt);
    const list = out.get(k);
    if (list) list.push(ev);
    else out.set(k, [ev]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }
  return out;
}
