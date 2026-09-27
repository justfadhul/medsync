"use client";

import type { CalendarView } from "./helpers";
import type { CalendarEvent, OnEventClick } from "./types";
import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AgendaView } from "./agenda-view";
import { DayView } from "./day-view";
import {
  addDays,
  addMonths,
  eventMatches,
  formatDay,
  formatMonthYear,
  formatWeekRange,
  startOfDay,
  startOfWeek,
} from "./helpers";
import { MonthView } from "./month-view";
import { CalendarViewSwitcher } from "./view-switcher";
import { WeekView } from "./week-view";

/**
 * MedSync calendar — the reusable presentation primitive for the
 * scheduling addendum. Pure client component (it owns view, cursor and
 * search state); server components fetch a window of events and pass
 * them in. Behaviour is unchanged from the PRD — this is presentation only.
 *
 * Defaults:
 *   - week view (the workhorse for clinicians)
 *   - week starts Monday (Uganda convention)
 *   - times in the user's locale; storage is UTC (events arrive as
 *     ISO strings and are parsed once)
 *   - a fixed height (60svh, at least 520px; 72svh capped at 760px on
 *     lg+) so the timeline scrolls inside it and the page flows around it
 *
 * Control bar: prev / Today / next and the range at left; at right the
 * view switcher, a search over what the cards say, and the caller's one
 * `action` (the doctor's Availability button sits there).
 *
 * Mobile: the responsive container hides the month view via
 * `allowedViews`; default becomes day on small screens.
 */
export function MedSyncCalendar({
  events,
  defaultView = "week",
  defaultDate,
  onEventClick,
  onRangeChange,
  action,
  timeZoneLabel = "EAT",
  className,
  mobile = false,
}: {
  events: ReadonlyArray<CalendarEvent>;
  defaultView?: CalendarView;
  defaultDate?: Date;
  onEventClick?: OnEventClick;
  /** Fired when the user nav's prev/next so the server can refetch a different window. */
  onRangeChange?: (cursor: Date, view: CalendarView) => void;
  /** The one action at the control bar's end — the reference's "+ Create" position. */
  action?: ReactNode;
  /**
   * The zone named in the timeline's top-left cell. The hospitals run on
   * East Africa Time (DEFAULT_TIME_ZONE); `Intl` names it by its offset,
   * which no clinician calls it.
   */
  timeZoneLabel?: string;
  className?: string;
  /** When true, hide the month view and default to day. */
  mobile?: boolean;
}) {
  const [view, setView] = useState<CalendarView>(
    mobile && defaultView === "month" ? "day" : defaultView,
  );
  const [cursor, setCursor] = useState<Date>(() => defaultDate ?? new Date());
  const [query, setQuery] = useState("");
  const searchId = useId();

  const allowedViews = mobile
    ? (["day", "week", "agenda"] as const)
    : (["day", "week", "month", "agenda"] as const);

  const parsedEvents = useMemo(
    () =>
      events.map((e) => ({
        ...e,
        startsAt: new Date(e.startsAtIso),
        endsAt: new Date(e.endsAtIso),
      })),
    [events],
  );
  const visibleEvents = useMemo(
    () => (query.trim() ? parsedEvents.filter((e) => eventMatches(e, query)) : parsedEvents),
    [parsedEvents, query],
  );

  function shift(delta: number) {
    const next =
      view === "month"
        ? addMonths(cursor, delta)
        : view === "week"
          ? addDays(cursor, delta * 7)
          : view === "day"
            ? addDays(cursor, delta)
            : addDays(cursor, delta * 7);
    setCursor(next);
    onRangeChange?.(next, view);
  }

  const headerLabel =
    view === "month"
      ? formatMonthYear(cursor)
      : view === "week"
        ? formatWeekRange(startOfWeek(cursor))
        : view === "day"
          ? formatDay(cursor)
          : formatWeekRange(startOfWeek(cursor));

  function goToday() {
    const today = startOfDay(new Date());
    setCursor(today);
    onRangeChange?.(today, view);
  }

  return (
    <section
      className={cn(
        "border-border bg-card flex h-[60svh] min-h-[520px] min-w-0 flex-col overflow-hidden rounded-lg border shadow-xs lg:h-[min(72svh,760px)]",
        className,
      )}
      aria-label="Calendar"
    >
      {/* ── Control bar ───────────────────────────────────────── */}
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => shift(-1)}
            aria-label="Previous"
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={goToday}>
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => shift(1)}
            aria-label="Next"
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          <h2 className="text-foreground text-body-m ml-1 font-medium tracking-[-0.005em]">
            {headerLabel}
          </h2>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CalendarViewSwitcher
            value={view}
            onChange={(v) => setView(v)}
            allowedViews={allowedViews}
          />
          <div className="flex items-center gap-1.5">
            <div className="relative w-44 sm:w-52">
              <SearchIcon
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                aria-hidden
              />
              <label htmlFor={searchId} className="sr-only">
                Search the calendar
              </label>
              <Input
                id={searchId}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search patient, code, title"
                className="min-h-11 rounded-md pl-8"
              />
            </div>
            {/* One element is both the visible count and the announcement; empty says nothing. */}
            <span
              aria-live="polite"
              className="text-muted-foreground font-mono text-[10.5px] tabular-nums"
            >
              {query.trim() ? `${visibleEvents.length} of ${parsedEvents.length} match` : ""}
            </span>
          </div>
          {action}
        </div>
      </header>

      {/* ── View region ───────────────────────────────────────── */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {view === "month" ? (
          <MonthView
            cursor={cursor}
            events={visibleEvents}
            onDayClick={(d) => {
              setCursor(d);
              setView("day");
            }}
            onEventClick={onEventClick}
          />
        ) : null}
        {view === "week" ? (
          <WeekView
            cursor={cursor}
            events={visibleEvents}
            onEventClick={onEventClick}
            timeZoneLabel={timeZoneLabel}
          />
        ) : null}
        {view === "day" ? (
          <DayView
            cursor={cursor}
            events={visibleEvents}
            onEventClick={onEventClick}
            timeZoneLabel={timeZoneLabel}
          />
        ) : null}
        {view === "agenda" ? (
          <AgendaView cursor={cursor} events={visibleEvents} onEventClick={onEventClick} />
        ) : null}
      </div>
    </section>
  );
}

/** Re-export for external callers. */
export type { CalendarEvent, OnEventClick } from "./types";
export type { CalendarView } from "./helpers";
