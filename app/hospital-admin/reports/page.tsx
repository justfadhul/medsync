import type { LineRow, SessionRow } from "./_components/line-tables";
import type { Ratio } from "@/lib/hospital-admin/reports";
import type { Metadata } from "next";

import { PilotWeeksNote, PilotWeeksTable } from "@/components/scheduling/pilot-weeks";
import { fetchPilotWeeks, PILOT_WEEKS } from "@/lib/hospital-admin/pilot";
import {
  fetchHospitalReport,
  HELD_PAST_STATUSES,
  MIN_RATE_SAMPLE,
  parseReportDays,
  POSITIONS_HONOURED_THRESHOLD,
  REPORT_WINDOWS,
  reportWindow,
} from "@/lib/hospital-admin/reports";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { SegmentedLink } from "../_components/segmented-link";
import { SentTodayPanel } from "../scheduling/_components/sent-today-panel";
import { LabAggregates } from "./_components/lab-aggregates";
import { LineTable, SessionTable } from "./_components/line-tables";

export const metadata: Metadata = {
  title: "Reports · Hospital admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  day: "numeric",
  month: "short",
});
const DAY_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Reports — hospital-admin surface (Gate H, PRD §3.4).
 *
 * Six numbers, each printed with its window and its denominator, and a
 * sample floor (MIN_RATE_SAMPLE) under which a rate says "too few to report"
 * instead of a percentage. The one flag on the page — "positions not
 * honoured" — is the §3.6 detector and it judges a service line, never a
 * person. The ruling that makes this page safe to show is printed next to
 * the no-show figure, in words, because the number is easy to misread.
 *
 * The window comes from `?days=`; anything outside REPORT_WINDOWS falls back
 * to the default. Server-rendered, no state; the only interaction is the
 * window switch, which is three links.
 */
export default async function ReportsPage({ searchParams }: PageProps) {
  const scope = await requireHospitalAdminScope();
  const params = await searchParams;
  const days = parseReportDays(params.days);
  const window = reportWindow(days);
  const [report, pilot] = await Promise.all([
    fetchHospitalReport(scope.hospitalId, window),
    fetchPilotWeeks(scope.hospitalId),
  ]);
  const pilotData = pilot.hospitals.get(scope.hospitalId);

  const since = `00:00 on ${DAY_FMT.format(window.from)}`;
  const range = `the last ${days} days`;
  const basis = (r: Ratio, unit: string) => `${r.numerator} of ${r.denominator} ${unit}`;

  const lineRows: LineRow[] = report.perLine.map((l) => ({
    id: l.serviceLineId,
    name: l.serviceLineName,
    fill: percent(l.fillRate),
    fillBasis: basis(l.fillRate, "places"),
    accuracy: percent(l.waitAccuracy),
    accuracyBasis: basis(l.waitAccuracy, "called"),
    positionsNotHonoured: l.positionsNotHonoured,
  }));
  const sessionRows: SessionRow[] = report.perSession.map((s) => ({
    id: s.sessionId,
    name: s.serviceLineName,
    when: DAY_TIME_FMT.format(s.startsAt),
    accuracy: percent(s.waitAccuracy),
    accuracyBasis: basis(s.waitAccuracy, "called"),
  }));
  const flagged = report.perLine.filter((l) => l.positionsNotHonoured);
  const smsCurrency = report.sms.currency ?? "UGX";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex w-fit items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-slate-icon ring-slate-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Reports
        </span>
        <h1 className="font-display text-display-s text-foreground">Reports</h1>
        <p className="text-muted-foreground max-w-2xl text-[13.5px] leading-relaxed">
          How this hospital&apos;s booked access is running. Every figure states the window it was
          measured over and what it was divided by; a rate with fewer than {MIN_RATE_SAMPLE} in the
          denominator is not printed.
        </p>
        <div className="bg-ink-300 h-px w-10" aria-hidden />
      </header>

      <nav aria-label="Report window" className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-body-s">Window</span>
        {REPORT_WINDOWS.map((d) => (
          <SegmentedLink key={d} href={`/hospital-admin/reports?days=${d}`} active={d === days}>
            {d} days
          </SegmentedLink>
        ))}
        <span className="text-muted-foreground text-caption ml-auto font-mono">
          since {since}, East Africa Time
        </span>
      </nav>

      {/* The ruling, in words (ADR 0094; PRD §3.3.4). Placed above the
          numbers so it is read before the no-show figure is. */}
      <section
        aria-labelledby="ruling-heading"
        className="border-border bg-muted/50 text-body-s flex flex-col gap-1 rounded-lg border p-4 leading-relaxed"
      >
        <h2 id="ruling-heading" className="text-foreground font-medium">
          These numbers describe the clinic&apos;s access, never a patient.
        </h2>
        <p className="text-muted-foreground">
          A no-show here is a place the clinic held that went unused — a signal about transport,
          reminders and the length of the wait, not about the person. Nothing on this page ranks,
          flags or colours a patient, and nothing in the booking path reads these figures. The one
          flag below judges the facility: whether the arrival window it promised was kept.
        </p>
      </section>

      <section aria-label="Access measures" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Metric
          label="Fill rate"
          value={percent(report.fillRate)}
          basis={`${basis(report.fillRate, "places")} on clinic days that have ended`}
          note="Places = capacity for bookings × overbooking factor, per day."
        />
        <Metric
          label="No-show rate"
          value={percent(report.noShowRate)}
          basis={`${basis(report.noShowRate, "held bookings")} whose day has ended`}
          note={`Held = still ${HELD_PAST_STATUSES.map((s) => s.replace("_", " ")).join(" / ")} when its day came; requests never answered and places given back are not counted. ${report.unmarked} of those are still "confirmed" — nobody marked them either way.`}
        />
        <Metric
          label="Wait accuracy"
          value={percent(report.waitAccuracy)}
          basis={`${basis(report.waitAccuracy, "called positions")} were called inside the promised window`}
          note="Booked arrivals only, and only those who arrived before their window closed."
        />
        <Metric
          label="Demand vs capacity"
          value={
            report.placesPublished > 0 ? `${report.requests} / ${report.placesPublished}` : "—"
          }
          basis={
            report.placesPublished > 0
              ? `${report.requests} bookings for the clinic days that started in the window, against the ${report.placesPublished} places those days published; ${report.waitlistJoined} joined a waitlist in the window`
              : `No clinic day started in the window, so there are no places to compare against; ${report.requests} session bookings and ${report.waitlistJoined} waitlist entries were made for it`
          }
          note={
            report.waitlistWaitingNow > 0
              ? `${report.waitlistWaitingNow} still waiting on a list right now — a list that never drains is the signal.`
              : "Nobody is waiting on a list right now."
          }
        />
        <Metric
          label="Refill load"
          value={String(report.refillVisits)}
          basis={`held bookings with reason "refill"${
            report.prescriptionsWritten === null
              ? ""
              : `; ${report.prescriptionsWritten} prescriptions written`
          }`}
          note={
            report.prescriptionsWritten === null
              ? "Prescriptions are not yet recorded at this hospital."
              : "Two counts side by side: a prescription hangs off an encounter, not a booking, so they are not joined."
          }
        />
        <Metric
          label="SMS spend"
          value={`${smsCurrency} ${report.sms.cost.toFixed(0)}`}
          basis={`${report.sms.messages} SMS sent`}
          note="Cost as the provider reported it per message — a message it did not price counts as 0. Push is free."
        />
      </section>

      <section
        aria-labelledby="pilot-heading"
        className="border-border bg-card flex flex-col rounded-lg border"
      >
        <div className="flex flex-col gap-1 px-6 py-5">
          <h2 id="pilot-heading" className="text-foreground text-heading-s">
            Week by week
          </h2>
          <p className="text-muted-foreground text-body-s max-w-xl leading-relaxed">
            The last {PILOT_WEEKS} weeks whatever the window above: bookings made and where they
            came in, no-shows, and how long booked patients waited — for the hospital, then each
            clinic line.
          </p>
        </div>
        <div className="border-border border-t">
          {pilotData ? (
            <PilotWeeksTable data={pilotData} />
          ) : (
            <p className="text-muted-foreground text-body-s p-8 text-center">
              No bookings or visits in the last {PILOT_WEEKS} weeks.
            </p>
          )}
        </div>
        <div className="border-border border-t px-6 py-3">
          <PilotWeeksNote />
        </div>
      </section>

      <section
        aria-labelledby="lines-heading"
        className="border-border bg-card flex flex-col rounded-lg border"
      >
        <div className="flex flex-col gap-1 px-6 py-5">
          <h2 id="lines-heading" className="text-foreground text-heading-s">
            By service line
          </h2>
          <p className="text-muted-foreground text-body-s max-w-xl leading-relaxed">
            {flagged.length === 0
              ? `No line is flagged. A line is flagged "positions not honoured" when fewer than ${Math.round(POSITIONS_HONOURED_THRESHOLD * 100)}% of at least ${MIN_RATE_SAMPLE} called positions were called inside the window the patient was told.`
              : `${flagged.length === 1 ? "1 line is" : `${flagged.length} lines are`} flagged "positions not honoured": fewer than ${Math.round(POSITIONS_HONOURED_THRESHOLD * 100)}% of called positions were called inside the window the patient was told. That is the facility's promise, and the fix is on the clinic floor — the day is running late, or positions are not being called in order.`}
          </p>
        </div>
        <div className="border-border border-t">
          <LineTable rows={lineRows} />
        </div>
      </section>

      <section
        aria-labelledby="sessions-heading"
        className="border-border bg-card flex flex-col rounded-lg border"
      >
        <div className="flex flex-col gap-1 px-6 py-5">
          <h2 id="sessions-heading" className="text-foreground text-heading-s">
            By clinic day
          </h2>
          <p className="text-muted-foreground text-body-s max-w-xl leading-relaxed">
            Called-in-window share for every clinic day in the window with at least one booked
            arrival called, worst first. A day with fewer than {MIN_RATE_SAMPLE} called is listed
            but not rated.
          </p>
        </div>
        <div className="border-border border-t">
          <SessionTable rows={sessionRows} />
        </div>
      </section>

      <SentTodayPanel rows={report.sent} range={range} since={since} />

      <LabAggregates scope={scope} from={window.from} to={window.to} />
    </div>
  );
}

/** "68%" or the honest alternative. Rounded to whole points; the basis line carries the exact counts. */
function percent(r: Ratio): string {
  return r.share === null ? "Too few to report" : `${Math.round(r.share * 100)}%`;
}

/**
 * One measure: the number, then the basis it was divided from, then a
 * sentence on what it leaves out. Neutral type throughout — a rate is not a
 * status, so it carries no tone.
 */
function Metric({
  label,
  value,
  basis,
  note,
}: {
  label: string;
  value: string;
  basis: string;
  note: string;
}) {
  return (
    <div className="border-border bg-card flex flex-col gap-1.5 rounded-lg border p-4">
      <span className="text-muted-foreground text-overline font-mono uppercase">{label}</span>
      <span
        className={cn(
          "text-foreground font-medium tabular-nums",
          value.length > 12 ? "text-body-m" : "text-heading-m leading-none",
        )}
      >
        {value}
      </span>
      <span className="text-foreground text-body-s">{basis}</span>
      <span className="text-muted-foreground text-caption leading-relaxed">{note}</span>
    </div>
  );
}
