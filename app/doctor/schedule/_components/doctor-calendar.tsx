"use client";

import type { ScheduleAppointmentRow } from "@/app/clinician/schedule/_components/schedule-list";
import type { CalendarEvent, CalendarSession } from "@/components/scheduling/calendar/types";
import type { ReactNode } from "react";
import { useState } from "react";

import { AppointmentDetailSheet } from "@/app/clinician/schedule/_components/appointment-detail-sheet";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import { AvailabilityLegend } from "@/components/scheduling/calendar/availability-legend";
import { MedSyncCalendar } from "@/components/scheduling/calendar/calendar";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/data-table";
import {
  SheetBody,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";

/**
 * Doctor calendar wrapper — client-side glue between the reusable
 * MedSyncCalendar and the existing AppointmentDetailSheet from the
 * clinician schedule. Reuses the sheet's action wiring (confirm /
 * decline / cancel / no-show) without rebuilding it.
 *
 * The calendar's `onEventClick` fires for appointment and clinic-day
 * cards (availability blocks are passive background). An appointment
 * maps to ScheduleAppointmentRow and opens the sheet; a clinic day opens
 * a read-only dialog of the day's facts — the hospital admin owns the
 * rule and the day, so there is nothing here for the doctor to edit.
 *
 * `windowLabel` names the range the server actually fetched. The
 * calendar navigates freely but the events array does not follow, so
 * without it a week outside the window renders as a confidently empty
 * diary — a claim the database has not made. It is a page-load window,
 * not a booking horizon: nothing here caps how far ahead a clinician
 * may be booked (ADR 0084 §8 caps patient-held bookings only).
 *
 * ponytail: a label instead of a refetch. Ceiling is a doctor who works
 * a month out and has to reload to see it; upgrade path is wiring
 * MedSyncCalendar's `onRangeChange` to a `?from=` search param the page
 * already has the query to serve.
 */
export function DoctorCalendar({
  events,
  windowLabel,
  action,
}: {
  events: ReadonlyArray<CalendarEvent>;
  windowLabel: string;
  /** Seated at the calendar's control-bar end. */
  action?: ReactNode;
}) {
  const [selected, setSelected] = useState<ScheduleAppointmentRow | null>(null);
  const [session, setSession] = useState<CalendarSession | null>(null);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <MedSyncCalendar
        events={events}
        defaultView="week"
        action={action}
        selectedId={selected ? `a-${selected.id}` : (session?.id ?? null)}
        onEventClick={(ev) => {
          if (ev.kind === "session") {
            setSession(ev);
            return;
          }
          if (ev.kind !== "appointment") return;
          setSelected({
            id: ev.id.replace(/^a-/, ""),
            status: ev.status,
            priority: ev.priority,
            type: ev.type,
            reason: ev.reason,
            reasonNote: ev.reasonNote,
            startsAtIso: ev.startsAtIso,
            endsAtIso: ev.endsAtIso,
            patientName: ev.patientName,
            patientCode: ev.patientCode,
            photoUrl: ev.photoUrl,
            ageYears: ev.ageYears,
            sex: ev.sex,
            complaint: ev.complaint,
          });
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-muted-foreground text-caption">
          Showing {windowLabel}; dates outside it draw empty until a reload.
        </p>
        <AvailabilityLegend events={events} />
      </div>
      <AppointmentDetailSheet item={selected} onOpenChange={(open) => !open && setSelected(null)} />
      <ClinicDayDialog session={session} onClose={() => setSession(null)} />
    </div>
  );
}

const SESSION_STATUS_LABEL: Record<string, string> = {
  published: "Published",
  closed: "Closed",
  cancelled: "Cancelled",
};

const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function ClinicDayDialog({
  session,
  onClose,
}: {
  session: CalendarSession | null;
  onClose: () => void;
}) {
  return (
    <EditorDialog width="medium" open={!!session} onOpenChange={(open) => !open && onClose()}>
      {session ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <Pill tone="info">Clinic day</Pill>
              {session.status !== "published" ? (
                <Pill tone="neutral">{SESSION_STATUS_LABEL[session.status] ?? session.status}</Pill>
              ) : null}
            </div>
            <SheetTitle>{session.serviceLineName}</SheetTitle>
            <SheetDescription>{DAY_FMT.format(new Date(session.startsAtIso))}</SheetDescription>
          </SheetHeader>

          <SheetBody>
            <dl className="text-body-s grid grid-cols-[120px_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Time</dt>
              <dd className="text-foreground font-mono tabular-nums">
                {TIME_FMT.format(new Date(session.startsAtIso))} –{" "}
                {TIME_FMT.format(new Date(session.endsAtIso))} EAT
              </dd>
              <dt className="text-muted-foreground">Venue</dt>
              <dd className="text-foreground">{session.venue ?? "Not set"}</dd>
              <dt className="text-muted-foreground">Booked</dt>
              <dd className="text-foreground font-mono tabular-nums">
                {session.bookedCount} of {session.capacity} places
              </dd>
              <dt className="text-muted-foreground">Running late</dt>
              <dd className="text-foreground font-mono tabular-nums">
                {session.delayMinutes > 0 ? `${session.delayMinutes} min` : "On time"}
              </dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-foreground">
                {SESSION_STATUS_LABEL[session.status] ?? session.status}
              </dd>
            </dl>
            <p className="text-muted-foreground text-caption mt-4">
              The hospital admin edits clinic days under Scheduling.
            </p>
          </SheetBody>

          <SheetFooter>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </SheetFooter>
        </div>
      ) : null}
    </EditorDialog>
  );
}
