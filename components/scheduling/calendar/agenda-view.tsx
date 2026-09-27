"use client";

import type { CalendarEvent, OnEventClick } from "./types";

import { PatientAvatar } from "@/components/medsync/patient-identity";
import { cn } from "@/lib/utils";
import { KindChip, StatusPill } from "./chips";
import {
  dayKey,
  daysBetween,
  describeEvent,
  endOfWeek,
  eventDayKey,
  formatDay,
  formatTimeRange,
  isToday,
  startOfWeek,
} from "./helpers";
import { STATUS_WORD } from "./tones";

type ParsedEvent = CalendarEvent & { startsAt: Date; endsAt: Date };

/**
 * Chronological agenda for the week containing `cursor`. Compact;
 * groups by day; designed to read top-to-bottom for a quick scan.
 * Lists appointments and clinic days — every session-held booking too,
 * since a list is where twenty names for one clinic morning belong.
 * Availability blocks stay off it, as on the day's own column they are
 * background. A booking's row leads with the patient's photo or monogram
 * and prefers what they said is bothering them over the reason code
 * (ADR 0095).
 */
export function AgendaView({
  cursor,
  events,
  onEventClick,
  selectedId = null,
}: {
  cursor: Date;
  events: ReadonlyArray<ParsedEvent>;
  onEventClick?: OnEventClick;
  selectedId?: string | null;
}) {
  const days = daysBetween({ start: startOfWeek(cursor), end: endOfWeek(cursor) });
  const byDay = bucketByDay(events.filter((e) => e.kind !== "availability"));

  return (
    <div className="h-full overflow-y-auto" role="list" aria-label="Agenda">
      <ul className="divide-border/60 divide-y">
        {days.map((d) => {
          const dayEvents = byDay.get(dayKey(d)) ?? [];
          return (
            <li key={dayKey(d)} className="flex flex-col gap-1 px-3 py-2 sm:px-4">
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-[13px] font-semibold",
                    isToday(d) ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {formatDay(d)}
                </span>
                {isToday(d) ? (
                  <span className="text-primary-foreground rounded-full bg-teal-700 px-1.5 py-0.5 text-[11px] leading-none font-medium">
                    Today
                  </span>
                ) : null}
                <span className="text-muted-foreground ml-auto text-[11px] tabular-nums">
                  {dayEvents.length} {dayEvents.length === 1 ? "item" : "items"}
                </span>
              </div>

              {dayEvents.length === 0 ? (
                <p className="text-muted-foreground text-[13px]">Nothing scheduled.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {dayEvents.map((ev) => {
                    const desc = describeEvent(ev);
                    const subtitle = (ev.kind === "appointment" && ev.complaint) || desc.subtitle;
                    return (
                      <li key={ev.id}>
                        <button
                          type="button"
                          onClick={() => onEventClick?.(ev)}
                          aria-label={[
                            desc.kindLabel,
                            desc.statusWord,
                            desc.title,
                            subtitle,
                            formatTimeRange(ev.startsAt, ev.endsAt),
                          ]
                            .filter(Boolean)
                            .join(", ")}
                          aria-pressed={ev.id === selectedId}
                          className={cn(
                            "ease-expo-out focus-visible:shadow-focus flex w-full items-start gap-3 rounded-[10px] border px-3 py-2 text-left shadow-xs transition-[border-color,box-shadow] duration-150 focus-visible:outline-none",
                            ev.id === selectedId
                              ? "border-ring ring-ring shadow-card ring-[0.5px]"
                              : "border-border hover:border-gray-300",
                            desc.struck ? "bg-muted border-dashed" : "bg-card",
                          )}
                        >
                          <span className="text-foreground w-[6.5rem] shrink-0 text-[13px] tabular-nums">
                            {formatTimeRange(ev.startsAt, ev.endsAt)}
                          </span>
                          {ev.kind === "appointment" ? (
                            <PatientAvatar
                              size="sm"
                              name={ev.patientName}
                              photoUrl={ev.photoUrl ?? null}
                            />
                          ) : null}
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex min-w-0 items-center gap-1.5">
                              {desc.status ? (
                                <StatusPill status={desc.status}>
                                  {desc.status === "urgent" ? STATUS_WORD.urgent : desc.statusWord}
                                </StatusPill>
                              ) : (
                                <KindChip hue={desc.hue} icon={desc.kindIcon}>
                                  {desc.kindLabel}
                                </KindChip>
                              )}
                              {desc.status === "urgent" || (!desc.status && desc.statusWord) ? (
                                <span className="text-muted-foreground truncate text-[11px]">
                                  {desc.statusWord}
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={cn(
                                "text-foreground truncate text-[13px] font-semibold",
                                desc.struck && "text-muted-foreground line-through",
                              )}
                            >
                              {desc.title}
                            </span>
                            {subtitle ? (
                              <span className="text-muted-foreground truncate text-[11px]">
                                {subtitle}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function bucketByDay(events: ReadonlyArray<ParsedEvent>): Map<string, ParsedEvent[]> {
  const out = new Map<string, ParsedEvent[]>();
  for (const ev of events) {
    const k = eventDayKey(ev.startsAt);
    const list = out.get(k);
    if (list) list.push(ev);
    else out.set(k, [ev]);
  }
  for (const list of out.values()) list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return out;
}
