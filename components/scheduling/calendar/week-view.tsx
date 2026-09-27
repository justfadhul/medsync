"use client";

import type { CalendarEvent, OnEventClick } from "./types";

import { daysBetween, endOfWeek, startOfWeek } from "./helpers";
import { TimeGrid } from "./time-grid";

type ParsedEvent = CalendarEvent & { startsAt: Date; endsAt: Date };

export function WeekView({
  cursor,
  events,
  onEventClick,
  selectedId,
  timeZoneLabel,
}: {
  cursor: Date;
  events: ReadonlyArray<ParsedEvent>;
  onEventClick?: OnEventClick;
  selectedId?: string | null;
  timeZoneLabel: string;
}) {
  const days = daysBetween({ start: startOfWeek(cursor), end: endOfWeek(cursor) });
  return (
    <TimeGrid
      days={days}
      events={events}
      onEventClick={onEventClick}
      selectedId={selectedId}
      timeZoneLabel={timeZoneLabel}
    />
  );
}
