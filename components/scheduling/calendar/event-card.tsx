"use client";

import type { CalendarEvent, OnEventClick } from "./types";
import type { CSSProperties } from "react";
import { ArrowUpRightIcon, ClockIcon } from "lucide-react";

import { PatientAvatar } from "@/components/medsync/patient-identity";
import { cn } from "@/lib/utils";
import { KindChip, StatusPill } from "./chips";
import { cardRows, describeEvent, formatDay, formatTime } from "./helpers";
import { HUE, STATUS_TONE, STATUS_WORD } from "./tones";

type ParsedEvent = CalendarEvent & { startsAt: Date; endsAt: Date };

/** Under this many minutes a booking draws as the one-line compact card. */
export const COMPACT_MINUTES = 50;

/**
 * One foreground card on the timeline — a clinic day or an appointment.
 * Availability is not a card: it is the band behind (time-grid.tsx).
 *
 * White card, colour only in the chip. Rows, top to bottom: the chip row
 * (the status pill for a booking, the kind chip for a clinic day), the
 * title, a muted meta line, the time, then a footer. `cardRows()` decides
 * which rows the height allows; the title and the time always show, and
 * the time is never truncated — on a narrow card it wraps at the dash, and
 * the chip row gives way to a status icon beside the title to make room.
 *
 * Under COMPACT_MINUTES the card is one line: icon, title, start time.
 *
 * The whole card is the button that opens the detail, so the ↗ in the
 * corner is its affordance, not a second control (a button inside a button
 * is invalid). What the card says about the patient is exactly what the
 * caller's event carries — the audited reveal (ADR 0095); nothing is added.
 */
export function EventCard({
  event,
  heightPx,
  col,
  top,
  selected = false,
  onEventClick,
  style,
}: {
  event: ParsedEvent;
  heightPx: number;
  /** Day-column index and pixel top, for arrow-key travel (nextCardIndex). */
  col: number;
  top: number;
  selected?: boolean;
  onEventClick?: OnEventClick;
  style: CSSProperties;
}) {
  const d = describeEvent(event);
  const minutes = (event.endsAt.getTime() - event.startsAt.getTime()) / 60_000;
  const compact = minutes < COMPACT_MINUTES;
  const rows = cardRows(heightPx);
  // A clinic day's footer is two rows (capacity, then the open button), so it needs more room.
  const showFooter = rows.footer && (event.kind !== "session" || heightPx >= 128);
  const start = formatTime(event.startsAt);
  const end = formatTime(event.endsAt);

  const meta =
    event.kind === "appointment"
      ? [event.complaint || d.subtitle, event.type === "virtual" ? "Video visit" : null]
          .filter(Boolean)
          .join(" · ")
      : event.kind === "session"
        ? [event.venue, event.delayMinutes > 0 ? `Running ${event.delayMinutes} min late` : null]
            .filter(Boolean)
            .join(" · ") || d.subtitle
        : d.subtitle;

  // The marker that stands in for the chip where the chip does not fit.
  const MarkIcon = d.status ? STATUS_TONE[d.status].icon : d.kindIcon;
  const markClass = d.status ? STATUS_TONE[d.status].mark : HUE[d.hue].icon;
  const chipWord = d.status === "urgent" ? STATUS_WORD.urgent : (d.statusWord ?? d.kindLabel);

  const label = [
    d.kindLabel,
    d.statusWord,
    d.title,
    meta,
    `${formatDay(event.startsAt)}, ${start} to ${end}`,
  ]
    .filter(Boolean)
    .join(", ");

  const title = (
    <span
      className={cn(
        "text-foreground min-w-0 truncate text-[13px] leading-4 font-semibold",
        d.struck && "text-muted-foreground line-through",
      )}
    >
      {d.title}
    </span>
  );

  return (
    <button
      type="button"
      data-cal-card=""
      data-col={col}
      data-top={top}
      onClick={() => onEventClick?.(event)}
      aria-label={label}
      title={label}
      aria-pressed={selected}
      className={cn(
        "group/card @container absolute z-10 flex min-h-11 flex-col overflow-hidden rounded-[10px] border text-left",
        "ease-expo-out transition-[border-color,box-shadow,translate] duration-150",
        "focus-visible:shadow-focus focus-visible:outline-none",
        selected
          ? "border-ring ring-ring shadow-card ring-[0.5px]"
          : "border-border shadow-xs hover:border-gray-300 motion-safe:hover:-translate-y-px",
        // A struck booking stays, receded by a muted fill and a dashed edge — not by
        // opacity, which would take its text under 4.5:1.
        d.struck ? "bg-muted border-dashed" : "bg-card",
        compact ? "justify-center px-2" : "gap-0.5 px-2.5 pt-1.5 pb-1",
      )}
      style={style}
    >
      {compact ? (
        // One line where it fits; on a narrow lane the time drops under the title rather than truncating.
        <span className="flex min-w-0 flex-col @min-[7.5rem]:flex-row @min-[7.5rem]:items-center @min-[7.5rem]:gap-1.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <MarkIcon className={cn("size-3 shrink-0", markClass)} aria-hidden />
            {title}
          </span>
          <span className="text-muted-foreground shrink-0 text-[11px] leading-[14px] tabular-nums @min-[7.5rem]:ml-auto">
            {start}
          </span>
        </span>
      ) : (
        <>
          {rows.pill ? (
            <span className="flex min-w-0 items-center gap-1.5 @max-[5.5rem]:hidden">
              {d.status ? (
                <StatusPill status={d.status}>{chipWord}</StatusPill>
              ) : (
                <KindChip hue={d.hue} icon={d.kindIcon}>
                  {d.kindLabel}
                </KindChip>
              )}
              {d.status === "urgent" || (!d.status && d.statusWord) ? (
                <span className="text-muted-foreground truncate text-[11px]">{d.statusWord}</span>
              ) : null}
            </span>
          ) : null}
          <span className="flex min-w-0 items-center gap-1">
            <MarkIcon
              className={cn("hidden size-3 shrink-0 @max-[5.5rem]:block", markClass)}
              aria-hidden
            />
            {title}
          </span>
          {rows.subtitle && meta ? (
            <span className="text-muted-foreground line-clamp-2 text-[11px] leading-[14px]">
              {meta}
            </span>
          ) : null}
          <span className="text-muted-foreground flex flex-wrap items-center text-[11px] leading-[14px] tabular-nums">
            <ClockIcon className="mr-1 size-3 shrink-0 @max-[5.5rem]:hidden" aria-hidden />
            <span className="whitespace-nowrap">{start}</span>
            <span className="whitespace-nowrap">–{end}</span>
          </span>
          {showFooter ? (
            <span className="mt-auto flex flex-col gap-1.5 pt-1 pb-0.5">
              {event.kind === "session" ? (
                // Capacity on its own row so the meter keeps its length in a narrow column.
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="bg-gray-150 h-1 min-w-0 flex-1 overflow-hidden rounded-full">
                    <span
                      className={cn("block h-full rounded-full", HUE[d.hue].meter)}
                      style={{
                        width: `${Math.min(100, (event.bookedCount / Math.max(1, event.capacity)) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                    {event.bookedCount} / {event.capacity}
                  </span>
                </span>
              ) : null}
              <span className="flex items-center justify-between gap-2">
                {event.kind === "appointment" ? (
                  <PatientAvatar
                    size="xs"
                    name={event.patientName}
                    photoUrl={event.photoUrl ?? null}
                  />
                ) : (
                  <span />
                )}
                <span
                  aria-hidden
                  className={cn(
                    "ease-expo-out grid size-6 shrink-0 place-items-center rounded-full ring-1 transition-colors duration-150",
                    selected
                      ? "bg-primary text-primary-foreground ring-primary"
                      : "bg-card text-foreground ring-border group-hover/card:ring-gray-300",
                  )}
                >
                  <ArrowUpRightIcon className="size-3" />
                </span>
              </span>
            </span>
          ) : null}
        </>
      )}
    </button>
  );
}
