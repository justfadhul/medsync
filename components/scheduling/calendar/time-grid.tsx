"use client";

import type { ArrowKey } from "./helpers";
import type { CalendarAvailability, CalendarEvent, OnEventClick } from "./types";
import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { KindChip } from "./chips";
import { EventCard } from "./event-card";
import {
  AVAILABILITY_KIND_LABEL,
  bandChipOffset,
  dayKey,
  describeEvent,
  eventDayKey,
  formatHourLabel,
  formatTime,
  isToday,
  minutesSinceMidnight,
  nextCardIndex,
  packLanes,
  sameDay,
} from "./helpers";

/**
 * Shared time-grid primitive for week + day views. Two layers per day:
 *
 *   A. Availability — background bands, full column width, no card: a faint
 *      tint of the kind (or a hatch for time off), with the kind chip in the
 *      first stretch of the band no card covers. A band carries no patient data.
 *   B. Clinic days and appointments — white cards on top (EventCard),
 *      packed into side-by-side lanes where they collide.
 *
 * The now line crosses every column in teal, with the time in the gutter;
 * the grid opens scrolled so now (or 07:00) sits one row from the top.
 * Hours run 07:00–19:00 and stretch to take in any event outside them —
 * a booking at 06:30 is drawn, never clipped away.
 *
 * Arrow keys move between cards: up/down within a day, left/right across.
 */

type ParsedEvent = CalendarEvent & { startsAt: Date; endsAt: Date };

/** The hour gutter: "EAT · UTC+3" stacked, and the now pill's "21:40". */
const GUTTER_PX = 56;
/** DEFAULT_TIME_ZONE (Africa/Kampala) keeps UTC+3 all year — no daylight saving. */
const ZONE_OFFSET = "UTC+3";
const MIN_CARD_PX = 44;
/** Cards sit 6px inside the column rules; bands 2px. */
const CARD_INSET_PX = 6;
const BAND_INSET_PX = 2;
/** A kind chip (20px) and its 4px of padding either side. */
const BAND_CHIP_PX = 28;

interface TimeGridProps {
  /** Day columns to render — each becomes one column. */
  days: Date[];
  events: ReadonlyArray<ParsedEvent>;
  onEventClick?: OnEventClick;
  /** The card whose detail is open — drawn selected. */
  selectedId?: string | null;
  /** Day view: the day whose header carries the selection ring. */
  selectedDay?: Date;
  /** Printed in the top-left cell. Rendering is in the browser's zone; the label names the hospital's. */
  timeZoneLabel: string;
  hourStart?: number;
  hourEnd?: number;
  /** px height per hour. 76 gives a 30-minute booking its 44px compact card with room. */
  pxPerHour?: number;
}

export function TimeGrid({
  days,
  events,
  onEventClick,
  selectedId = null,
  selectedDay,
  timeZoneLabel,
  hourStart: minHourStart = 7,
  hourEnd: minHourEnd = 19,
  pxPerHour = 76,
}: TimeGridProps) {
  const now = useNow();
  const columns = `${GUTTER_PX}px repeat(${days.length}, minmax(0,1fr))`;

  const dayKeys = days.map(dayKey);
  // A session-held booking sits exactly under its clinic-day card, and the
  // card stands for it — but only while the card is actually drawn (a search
  // that matched the patient and not the clinic must still show the patient).
  const drawnSessions = new Set(
    events.filter((e) => e.kind === "session").map((e) => e.id.replace(/^s-/, "")),
  );
  const eventsByDay = new Map<string, ParsedEvent[]>();
  for (const ev of events) {
    if (ev.kind === "appointment" && ev.sessionId && drawnSessions.has(ev.sessionId)) continue;
    const k = eventDayKey(ev.startsAt);
    if (!dayKeys.includes(k)) continue;
    const list = eventsByDay.get(k);
    if (list) list.push(ev);
    else eventsByDay.set(k, [ev]);
  }

  // Stretch the hours to what this range holds, so nothing falls off the grid.
  let hourStart = minHourStart;
  let hourEnd = minHourEnd;
  for (const list of eventsByDay.values()) {
    for (const ev of list) {
      hourStart = Math.min(hourStart, Math.floor(minutesSinceMidnight(ev.startsAt) / 60));
      const endMin =
        eventDayKey(ev.endsAt) === eventDayKey(ev.startsAt)
          ? minutesSinceMidnight(ev.endsAt)
          : 24 * 60;
      hourEnd = Math.max(hourEnd, Math.ceil(endMin / 60));
    }
  }
  const totalHours = Math.max(1, hourEnd - hourStart);
  const totalHeight = totalHours * pxPerHour;

  /** Top and height in px, clamped to the grid; null when nothing is left to draw. */
  function place(ev: ParsedEvent, minPx: number): { top: number; height: number } | null {
    const startMin = Math.max(minutesSinceMidnight(ev.startsAt), hourStart * 60);
    const endMin = Math.min(
      eventDayKey(ev.endsAt) === eventDayKey(ev.startsAt)
        ? minutesSinceMidnight(ev.endsAt)
        : 24 * 60,
      hourEnd * 60,
    );
    if (endMin <= startMin) return null;
    const top = ((startMin - hourStart * 60) / 60) * pxPerHour;
    return {
      top,
      height: Math.min(Math.max(minPx, ((endMin - startMin) / 60) * pxPerHour), totalHeight - top),
    };
  }

  const todayIndex = days.findIndex(isToday);
  const nowOffset = now ? minutesSinceMidnight(now) - hourStart * 60 : -1;
  const nowY = (nowOffset / 60) * pxPerHour;
  const showNow = now !== null && todayIndex >= 0 && nowOffset >= 0 && nowOffset <= totalHours * 60;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledOnce = useRef(false);
  useEffect(() => {
    // Open with now one row from the top — or 07:00 on a week without today.
    // Once, on the first render that knows the time (the server pass does not).
    const el = scrollRef.current;
    if (!el || scrolledOnce.current || now === null) return;
    scrolledOnce.current = true;
    const target = showNow ? nowY : (minHourStart - hourStart) * pxPerHour;
    el.scrollTop = Math.max(0, target - pxPerHour);
  }, [now, showNow, nowY, minHourStart, hourStart, pxPerHour]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const current = (e.target as HTMLElement).closest<HTMLElement>("[data-cal-card]");
    if (!current) return;
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-cal-card]")];
    const next = nextCardIndex(
      cards.map((c) => ({ col: Number(c.dataset.col), top: Number(c.dataset.top) })),
      cards.indexOf(current),
      e.key as ArrowKey,
    );
    if (next === null) return;
    e.preventDefault();
    cards[next]?.focus();
  }

  return (
    <div
      role="region"
      aria-label={days.length > 1 ? "Week timeline" : "Day timeline"}
      className="flex h-full min-w-0 flex-col overflow-hidden"
    >
      {/* Day header row — a quiet band with a rule per column. */}
      <div
        className="border-border bg-muted grid border-b"
        style={{ gridTemplateColumns: columns }}
      >
        <div className="text-muted-foreground flex flex-col items-end justify-end pr-2 pb-2 text-[11px] leading-[14px] tabular-nums">
          <span className="font-medium">{timeZoneLabel}</span>
          <span>{ZONE_OFFSET}</span>
        </div>
        {days.map((d) => {
          const today = isToday(d);
          const selected = selectedDay ? sameDay(d, selectedDay) && !today : false;
          return (
            <div
              key={dayKey(d)}
              className={cn(
                "border-border relative flex min-w-0 items-center gap-1.5 border-l px-3 py-2.5",
                today && "bg-accent ring-ring ring-[1.5px] ring-inset",
                selected && "ring-border ring-1 ring-inset",
              )}
            >
              <span className="text-foreground truncate text-[13px] font-semibold">
                {d.toLocaleDateString(undefined, { weekday: days.length > 1 ? "short" : "long" })}
              </span>
              <span
                className={cn(
                  "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full text-[13px] tabular-nums",
                  today
                    ? "text-primary-foreground bg-teal-700 font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {d.getDate()}
              </span>
              {today ? <span className="sr-only">, today</span> : null}
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onKeyDown}>
        <div
          className="relative grid"
          style={{ gridTemplateColumns: columns, height: `${totalHeight}px` }}
        >
          {/* Time gutter — the label sits just under its hour rule. */}
          <div className="relative">
            {Array.from({ length: totalHours }).map((_, i) => (
              <div
                key={i}
                className="text-muted-foreground absolute right-2 text-[11px] leading-none tabular-nums"
                style={{ top: `${i * pxPerHour + 4}px` }}
              >
                {formatHourLabel(hourStart + i)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d, col) => {
            const dayEvents = eventsByDay.get(dayKey(d)) ?? [];
            const bands = dayEvents.flatMap((ev) => {
              if (ev.kind !== "availability") return [];
              const at = place(ev, 0);
              return at ? [{ ev, ...at }] : [];
            });
            const cards = dayEvents.flatMap((ev) => {
              if (ev.kind === "availability") return [];
              const at = place(ev, MIN_CARD_PX);
              return at ? [{ ev, ...at }] : [];
            });
            const bandLanes = packLanes(
              bands.map((b) => ({ start: b.top, end: b.top + b.height })),
            );
            const cardLanes = packLanes(
              cards.map((c) => ({ start: c.top, end: c.top + c.height })),
            );
            return (
              <div
                key={dayKey(d)}
                className={cn(
                  "border-border relative min-w-0 border-l",
                  isToday(d) && "bg-accent/40",
                )}
              >
                {/* Hour rules, and a dashed half-hour between them */}
                {Array.from({ length: totalHours }).map((_, i) => (
                  <div key={i}>
                    <div
                      className="border-border absolute inset-x-0 border-t"
                      style={{ top: `${i * pxPerHour}px` }}
                    />
                    <div
                      className="border-gray-150 absolute inset-x-0 border-t border-dashed"
                      style={{ top: `${i * pxPerHour + pxPerHour / 2}px` }}
                    />
                  </div>
                ))}

                {/* Layer A: availability bands */}
                {bands.map(({ ev, top, height }, i) => {
                  const { lane, lanes } = bandLanes[i]!;
                  return (
                    <AvailabilityBand
                      key={ev.id}
                      event={ev as ParsedEvent & CalendarAvailability}
                      chipOffset={bandChipOffset({ top, height }, cards, BAND_CHIP_PX)}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(${BAND_INSET_PX}px + (100% - ${BAND_INSET_PX * 2}px) * ${lane / lanes})`,
                        width: `calc((100% - ${BAND_INSET_PX * 2}px) / ${lanes})`,
                      }}
                    />
                  );
                })}

                {/* Layer B: clinic days and appointments */}
                {cards.map(({ ev, top, height }, i) => {
                  const { lane, lanes } = cardLanes[i]!;
                  const gap = lanes > 1 ? 2 : 0;
                  return (
                    <EventCard
                      key={ev.id}
                      event={ev}
                      heightPx={height}
                      col={col}
                      top={top}
                      selected={ev.id === selectedId}
                      onEventClick={onEventClick}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(${CARD_INSET_PX}px + (100% - ${CARD_INSET_PX * 2}px) * ${lane / lanes})`,
                        width: `calc((100% - ${CARD_INSET_PX * 2}px) / ${lanes} - ${gap}px)`,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* Now: a teal line over every column, a dot at today, the time in the gutter. Never red. */}
          {showNow ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-20"
              style={{ top: `${nowY}px` }}
              aria-hidden
            >
              <div
                className="bg-primary absolute right-0 h-[1.5px] -translate-y-1/2"
                style={{ left: GUTTER_PX }}
              />
              <div
                className="bg-primary absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `calc(${GUTTER_PX}px + (100% - ${GUTTER_PX}px) * ${todayIndex / days.length})`,
                }}
              />
              <span
                className="absolute top-0 flex -translate-y-1/2 justify-end pr-1"
                style={{ left: 0, width: GUTTER_PX }}
              >
                <span className="text-primary-foreground rounded-full bg-teal-700 px-1.5 py-0.5 text-[11px] leading-none font-medium tabular-nums">
                  {now ? formatTime(now) : ""}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Layer A. Not a control — availability is the doctor's declared time, not
 * something to open — so it is a labelled region of the grid, and the chip
 * carries the kind and the hours for a screen reader and as a tooltip.
 */
function AvailabilityBand({
  event,
  chipOffset,
  style,
}: {
  event: ParsedEvent & CalendarAvailability;
  /** Where in the band the chip is clear of every card; null when cards cover it all. */
  chipOffset: number | null;
  style: CSSProperties;
}) {
  const d = describeEvent(event);
  const hours = `${formatTime(event.startsAt)}–${formatTime(event.endsAt)}`;
  const kindWord = AVAILABILITY_KIND_LABEL[event.availabilityKind] ?? d.kindLabel;
  const word = event.availabilityKind === "custom" ? d.title : kindWord;
  const tip = `${word} · ${hours}`;
  return (
    <div className={cn("absolute", d.cardClasses)} style={style}>
      {/* A band the cards cover leaves no chip to see; its words stay for a screen reader. */}
      <div
        className={cn("absolute inset-x-0 p-1", chipOffset === null && "sr-only")}
        style={{ top: chipOffset ?? 0 }}
      >
        <span title={tip} className="inline-flex max-w-full">
          <KindChip hue={d.hue} icon={d.kindIcon}>
            {word}
            <span className="sr-only">
              {event.availabilityKind === "custom" ? ` (${kindWord})` : ""}, {hours}
            </span>
          </KindChip>
        </span>
      </div>
    </div>
  );
}

function useNow(): Date | null {
  // Null on the server pass and the first client render: the now-line is a
  // client fact, and seeding it on both sides gives two different HTML trees.
  // `useSyncExternalStore` is React's sanctioned way to read a browser-only
  // value with a server fallback, with no setState inside an effect.
  const tick = useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
  return tick === null ? null : new Date(tick * 60_000);
}

/** Wakes subscribers once a minute; the store value is the minute itself. */
function subscribeMinute(onChange: () => void): () => void {
  const t = setInterval(onChange, 60_000);
  return () => clearInterval(t);
}
