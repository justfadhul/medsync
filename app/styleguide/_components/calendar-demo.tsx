"use client";

import type { CalendarEvent } from "@/components/scheduling/calendar/types";
import { useMemo } from "react";

import { AvailabilityLegend } from "@/components/scheduling/calendar/availability-legend";
import { MedSyncCalendar } from "@/components/scheduling/calendar/calendar";

/**
 * Fictional sample events for the styleguide. Kept deliberately
 * illustrative — never real clinical data. Generated on mount so
 * "today" anchors to the viewer's clock — the one place the host's
 * (browser's) zone is genuinely the right one: no hospital owns this day.
 */
export function CalendarDemo() {
  const events = useMemo<CalendarEvent[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    function at(dayOffset: number, hour: number, minute: number): Date {
      const d = new Date(today);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hour, minute, 0, 0);
      return d;
    }

    function appt(
      id: string,
      start: Date,
      durationMin: number,
      status: string,
      patientName: string,
      reason: string,
      priority: "routine" | "urgent" = "routine",
    ): CalendarEvent {
      const end = new Date(start.getTime() + durationMin * 60_000);
      return {
        id,
        kind: "appointment",
        startsAtIso: start.toISOString(),
        endsAtIso: end.toISOString(),
        status,
        priority,
        type: "in_person",
        reason,
        reasonNote: null,
        patientName,
        patientCode: null,
        clinicianName: "Dr Demo",
        departmentName: "Internal Medicine",
      };
    }

    function block(
      id: string,
      start: Date,
      end: Date,
      kind: string,
      label: string | null = null,
    ): CalendarEvent {
      return {
        id,
        kind: "availability",
        startsAtIso: start.toISOString(),
        endsAtIso: end.toISOString(),
        availabilityKind: kind,
        recurrence: "none",
        location: null,
        label,
      };
    }

    return [
      // Today
      block("b1", at(0, 7, 0), at(0, 8, 0), "ward_round"),
      appt("a1", at(0, 9, 0), 30, "confirmed", "MRN-2026-00012", "Routine review"),
      appt("a2", at(0, 10, 0), 45, "arrived", "MRN-2026-00134", "Follow-up"),
      appt("a3", at(0, 11, 30), 30, "pending_approval", "MRN-2026-00457", "New concern"),
      appt("a4", at(0, 14, 0), 20, "confirmed", "MRN-2026-00088", "Urgent review", "urgent"),
      block("b2", at(0, 16, 0), at(0, 17, 0), "teaching"),
      // A clinic day from a weekly rule (Gate B), as the doctor's calendar draws it.
      {
        id: "s1",
        kind: "session",
        startsAtIso: at(2, 9, 0).toISOString(),
        endsAtIso: at(2, 12, 0).toISOString(),
        serviceLineName: "Diabetes clinic",
        venue: "OPD Room 4",
        bookedCount: 12,
        capacity: 20,
        status: "published",
        delayMinutes: 0,
      },

      // Tomorrow
      block("b4", at(1, 8, 0), at(1, 9, 0), "bookable"),
      appt("a5", at(1, 9, 30), 30, "confirmed", "MRN-2026-00211", "Refill"),
      appt("a6", at(1, 11, 0), 30, "confirmed", "MRN-2026-00322", "Routine"),
      block("b3", at(1, 13, 0), at(1, 14, 0), "admin"),
      appt("a7", at(1, 15, 0), 60, "confirmed", "MRN-2026-00133", "Long consult"),
      // ADR 0095: a custom block is its own name; all seven tints on one demo.
      block("b5", at(1, 16, 30), at(1, 18, 0), "custom", "Clinic at Kiruddu"),

      // Day after
      appt("a8", at(2, 10, 0), 30, "completed", "MRN-2026-00077", "Routine"),
      appt("a9", at(2, 12, 0), 30, "no_show", "MRN-2026-00432", "Follow-up"),
      block("b6", at(2, 14, 0), at(2, 15, 0), "unavailable"),

      // +3 days
      block("b7", at(3, 8, 0), at(3, 17, 0), "leave"),

      // -2 days
      appt("a10", at(-2, 9, 0), 30, "completed", "MRN-2026-00501", "Routine"),

      // +5 days
      appt("a11", at(5, 9, 30), 30, "confirmed", "MRN-2026-00604", "Refill"),
    ];
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <MedSyncCalendar events={events} defaultView="week" />
      <AvailabilityLegend events={events} />
      <p className="text-muted-foreground max-w-prose text-[11.5px] italic">
        Sample data only — illustrative, never real clinical content. Status colours follow{" "}
        <code className="font-mono">DESIGN-medsync.md</code> semantic tokens; red is reserved for
        the urgent ring.
      </p>
    </div>
  );
}
