"use client";

import type { CalendarView } from "./helpers";
import type { CalendarEvent, OnEventClick } from "./types";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
 * Control bar: prev / Today / next and the range at left; at right a
 * search over what the cards say (⌘F / Ctrl+F focuses it) and the caller's
 * `action` (the doctor's Availability and Set availability). Under it, the
 * view tabs as underlines on the bar's rule.
 *
 * Under 1024px the week falls back to one day with a strip of the week's
 * days above it; `mobile` also hides the month view.
 */
export function MedSyncCalendar({
  events,
  defaultView = "week",
  defaultDate,
  onEventClick,
  onRangeChange,
  action,
  selectedId = null,
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
  /** The control bar's buttons at its end — one secondary, one primary at most. */
  action?: ReactNode;
  /** The event whose detail is open, drawn selected on the grid. */
  selectedId?: string | null;
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
  const searchRef = useRef<HTMLInputElement>(null);
  const findKey = useSyncExternalStore(noSubscribe, platformFindKey, () => null);

  // Seven columns need about 1024px; under it the week reads as a day with a strip of the week's days.
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const shownView: CalendarView = narrow && view === "week" ? "day" : view;

  const allowedViews = mobile
    ? (["day", "week", "agenda"] as const)
    : (["day", "week", "month", "agenda"] as const);

  // ⌘F / Ctrl+F finds in the calendar, as the hint in the search box says.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      shownView === "month"
        ? addMonths(cursor, delta)
        : shownView === "day"
          ? addDays(cursor, delta)
          : addDays(cursor, delta * 7);
    setCursor(next);
    onRangeChange?.(next, shownView);
  }

  const headerLabel =
    shownView === "month"
      ? formatMonthYear(cursor)
      : shownView === "day"
        ? formatDay(cursor)
        : formatWeekRange(startOfWeek(cursor));

  function goToday() {
    const today = startOfDay(new Date());
    setCursor(today);
    onRangeChange?.(today, shownView);
  }

  return (
    <section
      className={cn(
        "border-border bg-card flex h-[60svh] min-h-[520px] min-w-0 flex-col overflow-hidden rounded-lg border shadow-xs lg:h-[min(72svh,760px)]",
        className,
      )}
      aria-label="Calendar"
    >
      {/* ── Control bar: range and actions, then the view tabs on the rule ── */}
      <header className="border-border flex flex-col gap-1 border-b px-3 pt-2.5 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => shift(-1)}
              aria-label="Previous"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button type="button" variant="secondary" className="min-h-11" onClick={goToday}>
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
            <h2 className="text-foreground text-heading-s ml-2 truncate font-medium">
              {headerLabel}
            </h2>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative w-52 sm:w-64">
              <SearchIcon
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                aria-hidden
              />
              <label htmlFor={searchId} className="sr-only">
                Search the calendar
              </label>
              <Input
                ref={searchRef}
                id={searchId}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search patient, code, title"
                className={cn("min-h-11 rounded-md pl-8", findKey && "pr-14")}
              />
              {findKey ? (
                <kbd
                  aria-hidden
                  className="border-border text-muted-foreground bg-muted pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1.5 py-0.5 font-sans text-[11px] leading-none"
                >
                  {findKey}
                </kbd>
              ) : null}
            </div>
            {action}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-2">
          <CalendarViewSwitcher
            value={shownView}
            onChange={(v) => setView(v)}
            allowedViews={narrow ? allowedViews.filter((v) => v !== "week") : allowedViews}
          />
          {/* One element is both the visible count and the announcement; empty says nothing. */}
          <span aria-live="polite" className="text-muted-foreground pb-2 text-[11px] tabular-nums">
            {query.trim() ? `${visibleEvents.length} of ${parsedEvents.length} match` : ""}
          </span>
        </div>
      </header>

      {/* ── View region ───────────────────────────────────────── */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {shownView === "month" ? (
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
        {shownView === "week" ? (
          <WeekView
            cursor={cursor}
            events={visibleEvents}
            onEventClick={onEventClick}
            selectedId={selectedId}
            timeZoneLabel={timeZoneLabel}
          />
        ) : null}
        {shownView === "day" ? (
          <DayView
            cursor={cursor}
            events={visibleEvents}
            onEventClick={onEventClick}
            selectedId={selectedId}
            timeZoneLabel={timeZoneLabel}
            onDayPick={narrow ? setCursor : undefined}
          />
        ) : null}
        {shownView === "agenda" ? (
          <AgendaView
            cursor={cursor}
            events={visibleEvents}
            onEventClick={onEventClick}
            selectedId={selectedId}
          />
        ) : null}
      </div>
    </section>
  );
}

const NARROW_QUERY = "(max-width: 1023px)";
function subscribeNarrow(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function isNarrow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}
function noSubscribe(): () => void {
  return () => {};
}
function platformFindKey(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘F" : "Ctrl F";
}

/** Re-export for external callers. */
export type { CalendarEvent, OnEventClick } from "./types";
export type { CalendarView } from "./helpers";
