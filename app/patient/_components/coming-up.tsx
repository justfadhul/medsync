import type { AppointmentRow, LiveIntakeToday } from "@/lib/patient/appointments";
import Link from "next/link";
import { StethoscopeIcon } from "lucide-react";

import { ArrivedButton } from "@/app/patient/appointments/_components/arrived-button";
import { OneTapAction } from "@/app/patient/appointments/_components/one-tap-action";
import { confirmAttendanceAction } from "@/app/patient/appointments/actions";
import {
  canArrive,
  confirmationPending,
  INTAKE_TITLE,
  STATUS_LABEL,
} from "@/lib/patient/appointments";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TIME_ZONE,
  localDateKey,
  localWeekdayAndMinutes,
} from "@/supabase/functions/_shared/slots";
import { SectionHead } from "./section-head";

const CHIP = "bg-muted text-foreground rounded-full px-2.5 py-1";

/** `fetchAppointments` substitutes this when `users.fullName` is null. */
const CLINICIAN_FALLBACK = "Your clinician";

/**
 * ADR 0084 §10: a day and a day-part, never a clock numeral, pinned to the
 * clinic's zone — a UTC host would print the wrong DAY for a visit before
 * 03:00 EAT. Local noon splits the sessions, as on /patient/book.
 */
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function sessionOf(at: Date): string {
  return localWeekdayAndMinutes(at, DEFAULT_TIME_ZONE).minutesOfDay < 12 * 60
    ? "Morning session"
    : "Afternoon session";
}

/**
 * What is in motion, one thing at most (brief gap 5): today's same-day
 * ticket outranks the next visit, the way the phone's "Coming up" orders
 * them. The ticket is said in the queue page's words and is never a position
 * or an "ahead of you" count — that number is the ticket page's alone, and
 * only once the patient is in the building (ADR 0084 §6).
 *
 * Rendered twice by home — in the main column on phones, in the right column
 * when wide — because it sits between the symptoms and the doors on a phone
 * but heads the context column on a desktop, and no single source position
 * gives both without reordering focus away from reading order. `id` keeps
 * the two headings distinct; the hidden copy is `display: none`, so neither
 * a screen reader nor the tab order meets it.
 */
export function ComingUp({
  id,
  ticket,
  visit,
  now,
  className,
}: {
  id: string;
  ticket: LiveIntakeToday | null;
  visit: AppointmentRow | null;
  now: Date;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("flex-col gap-3", className)}>
      <SectionHead
        id={id}
        title="Coming up"
        linkHref="/patient/appointments"
        linkLabel="See your visits"
      />
      {ticket ? (
        <Link
          href={`/patient/queue/${ticket.id}`}
          className="tap bg-card border-border md:hover:bg-muted flex flex-col gap-1 rounded-lg border p-4"
        >
          <span className="text-foreground text-body-m font-medium">
            {INTAKE_TITLE[ticket.status] ?? "You are already in today's line."}
          </span>
          {ticket.departmentName ? (
            <span className="text-muted-foreground text-body-s">{ticket.departmentName}</span>
          ) : null}
          <span className="text-body-s text-teal-700">Open this for the latest.</span>
        </Link>
      ) : visit ? (
        <VisitCard visit={visit} now={now} />
      ) : (
        <p className="text-muted-foreground text-body-s">
          Nothing yet. A visit you have asked for shows up here.
        </p>
      )}
    </section>
  );
}

function VisitCard({ visit, now }: { visit: AppointmentRow; now: Date }) {
  const at = new Date(visit.startsAtIso);
  const dated = !Number.isNaN(at.getTime());
  const where = [visit.departmentName, visit.hospitalName].filter(Boolean).join(" · ");
  const arrivable = canArrive(visit, localDateKey(now, DEFAULT_TIME_ZONE));

  return (
    <div className="bg-card border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        {/* Plum: who this is (ADR 0097). Initials off the "Your clinician"
            fallback would be initials of a placeholder, so that gets a glyph. */}
        <span
          aria-hidden
          data-place
          className="text-body-s grid size-11 shrink-0 place-items-center rounded-full bg-sky-100 font-mono font-medium text-sky-800"
        >
          {visit.clinicianName === CLINICIAN_FALLBACK ? (
            <StethoscopeIcon className="size-5" strokeWidth={1.5} />
          ) : (
            initials(visit.clinicianName)
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-foreground text-body-m truncate font-medium">{visit.clinicianName}</p>
          {where ? <p className="text-muted-foreground text-body-s truncate">{where}</p> : null}
        </div>
      </div>

      {/* The old hero's three chips, as words on neutral: a status tone
          would paint "arrived" teal, and teal here only means press. */}
      <ul className="text-body-s flex flex-wrap items-center gap-2">
        <li className={CHIP}>{STATUS_LABEL[visit.status] ?? visit.status}</li>
        {dated ? (
          <>
            <li className={cn(CHIP, "font-mono tabular-nums")}>{DATE_FMT.format(at)}</li>
            <li className={CHIP}>{sessionOf(at)}</li>
          </>
        ) : null}
      </ul>

      {/* The visits list's own two verbs, same gates: arriving on the day,
          else the T-24h confirmation. Never both. */}
      {arrivable ? (
        <ArrivedButton appointmentId={visit.id} />
      ) : confirmationPending(visit, now) ? (
        <OneTapAction
          action={confirmAttendanceAction}
          fields={{ appointment_id: visit.id }}
          label="Confirm I'm coming"
          pendingLabel="Confirming…"
          doneLabel="Confirmed — see you there"
          hint="Tells the clinic to expect you. Nothing changes if you don't."
        />
      ) : null}
    </div>
  );
}

/** First letters of the first two words — "Sarah Nakato" → "SN". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
