"use client";

import type { CalendarEvent, OnEventClick } from "./types";
import type { CSSProperties } from "react";
import { ArrowUpRightIcon, ClockIcon } from "lucide-react";

import { PatientAvatar } from "@/components/medsync/patient-identity";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { cardRows, describeEvent, formatTimeRange } from "./helpers";

type ParsedEvent = CalendarEvent & { startsAt: Date; endsAt: Date };

/**
 * One timeline card. Rows, top to bottom: the label pill naming the kind
 * (and the status word beside it), the title, a muted subtitle, the time
 * with a clock, then a footer of monogram chip and the open-arrow. Which
 * rows show is `cardRows()`'s call, by height — a 15-minute slot is the
 * title alone. An appointment's chip is the patient's photo or monogram
 * (ADR 0095), and its subtitle is what they said is bothering them when
 * they said anything, else the reason code.
 *
 * Appointments and clinic days are buttons — the whole card opens the
 * detail, so the arrow at the corner is decoration, not a second control
 * (a button inside a button is invalid). Availability blocks are passive
 * background and stay a plain div with the same rows.
 */
export function EventCard({
  event,
  heightPx,
  onEventClick,
  style,
}: {
  event: ParsedEvent;
  heightPx: number;
  onEventClick?: OnEventClick;
  style: CSSProperties;
}) {
  const d = describeEvent(event);
  const rows = cardRows(heightPx);
  const timeRange = formatTimeRange(event.startsAt, event.endsAt);
  const subtitle = (event.kind === "appointment" && event.complaint) || d.subtitle;
  const classes = cn(
    "absolute inset-x-1 flex flex-col overflow-hidden rounded-lg border px-2 text-left",
    // Vertical room follows the rows: a pill-and-title card has 2px to spare.
    rows.footer ? "gap-0.5 py-2" : rows.time ? "gap-0.5 py-1" : "gap-0 py-0.5",
    d.cardClasses,
    d.clickable
      ? "ease-expo-out focus-visible:ring-ring z-10 shadow-xs transition-shadow duration-150 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none"
      : "pointer-events-none",
    d.urgent && "ring-1 ring-rose-500/70",
  );

  const body = (
    <>
      {rows.pill ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <Pill tone={d.pillTone} className="shrink-0 rounded-full px-1.5 py-0 text-[10px]">
            {d.kindLabel}
          </Pill>
          {d.statusWord ? (
            <span className="text-muted-foreground truncate text-[10.5px]">{d.statusWord}</span>
          ) : null}
        </span>
      ) : null}
      <span
        className={cn(
          "text-foreground text-body-s truncate font-medium",
          rows.time ? "leading-tight" : "leading-none",
          d.struck && "text-muted-foreground line-through",
        )}
      >
        {d.title}
      </span>
      {rows.subtitle && subtitle ? (
        <span className="text-muted-foreground truncate text-[11.5px] leading-tight">
          {subtitle}
        </span>
      ) : null}
      {rows.time ? (
        <span className="text-muted-foreground inline-flex items-center gap-1 font-mono text-[10.5px] leading-none tabular-nums">
          <ClockIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{timeRange}</span>
        </span>
      ) : null}
      {rows.footer && d.clickable ? (
        <span className="mt-auto flex items-center justify-between pt-1">
          {event.kind === "appointment" ? (
            <PatientAvatar size="xs" name={event.patientName} photoUrl={event.photoUrl ?? null} />
          ) : (
            <span
              aria-hidden
              className="bg-card text-foreground ring-border grid size-6 place-items-center rounded-full font-mono text-[10px] font-medium tabular-nums ring-1"
            >
              {d.monogram}
            </span>
          )}
          <span
            aria-hidden
            className="bg-card text-foreground ring-border grid size-6 place-items-center rounded-full ring-1"
          >
            <ArrowUpRightIcon className="size-3" />
          </span>
        </span>
      ) : null}
    </>
  );

  if (!d.clickable) {
    return (
      <div className={classes} style={style}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onEventClick?.(event)}
      aria-label={[d.kindLabel, d.statusWord, d.title, subtitle, timeRange]
        .filter(Boolean)
        .join(", ")}
      className={classes}
      style={style}
    >
      {body}
    </button>
  );
}
