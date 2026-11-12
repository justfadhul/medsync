import type { Median, PilotHospital, PilotWeek } from "@/lib/hospital-admin/pilot";

import { MIN_RATE_SAMPLE } from "@/lib/hospital-admin/reports";
import { cn } from "@/lib/utils";

/**
 * The pilot numbers for one hospital, week by week (newest first), with its
 * clinic lines under each week when it runs more than one. Server-rendered
 * from lib/hospital-admin/pilot — counts and medians only, nothing per patient.
 * Shared by /admin/scheduling-rollup and /hospital-admin/reports.
 */

const WEEK_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const isEmpty = (w: PilotWeek) =>
  w.booked.total === 0 && w.held === 0 && w.unmarked === 0 && w.checkInVsBooked.n === 0;

export function PilotWeeksTable({ data }: { data: PilotHospital }) {
  const showLines = data.lines.length > 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Pilot numbers by week, newest first</caption>
        <thead>
          <tr className="border-border border-b">
            <Th>Week</Th>
            <Th align="right">Booked</Th>
            <Th align="right" className="hidden md:table-cell">
              Web
            </Th>
            <Th align="right" className="hidden md:table-cell">
              App
            </Th>
            <Th align="right" className="hidden md:table-cell">
              Desk
            </Th>
            <Th align="right" className="hidden md:table-cell">
              USSD
            </Th>
            <Th align="right">No-shows</Th>
            <Th align="right">Check-in vs time given</Th>
            <Th align="right">Check-in → seen</Th>
          </tr>
        </thead>
        {data.weeks.map((w, i) => (
          <tbody key={w.week} className="border-border border-b last:border-0">
            <Row
              label={
                i === 0 ? "This week" : `w/c ${WEEK_FMT.format(new Date(`${w.week}T00:00:00Z`))}`
              }
              week={w}
            />
            {showLines
              ? data.lines.map((l) => {
                  const lw = l.weeks[i];
                  return lw && !isEmpty(lw) ? (
                    <Row
                      key={l.lineId ?? "none"}
                      label={l.lineName ?? "Not on a clinic day"}
                      week={lw}
                      sub
                    />
                  ) : null;
                })
              : null}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Row({ label, week: w, sub }: { label: string; week: PilotWeek; sub?: boolean }) {
  return (
    <tr className={cn(sub && "text-muted-foreground")}>
      <td className={cn("text-body-s px-4 py-2 sm:px-6", sub ? "pl-8 sm:pl-10" : "font-medium")}>
        {label}
      </td>
      <Num value={w.booked.total} />
      {(["web", "app", "desk", "ussd"] as const).map((ch) => (
        <Num key={ch} value={w.booked[ch]} className="hidden md:table-cell" />
      ))}
      <Cell
        value={w.held > 0 ? `${w.noShow} of ${w.held}` : "—"}
        basis={
          w.held === 0
            ? null
            : [
                w.noShowShare === null ? "too few for a %" : `${Math.round(w.noShowShare * 100)}%`,
                w.unmarked > 0 ? `${w.unmarked} unmarked` : null,
              ]
                .filter(Boolean)
                .join(" · ")
        }
      />
      <Cell value={vsGiven(w.checkInVsBooked)} basis={count(w.checkInVsBooked, "checked in")} />
      <Cell value={wait(w.checkInToSeen)} basis={count(w.checkInToSeen, "seen")} />
    </tr>
  );
}

/** Signed: after or before the time the patient was given. */
function vsGiven(m: Median): string {
  if (m.median === null) return "—";
  const v = Math.round(m.median);
  return v === 0 ? "on time" : v > 0 ? `${v} min after` : `${-v} min before`;
}

function wait(m: Median): string {
  return m.median === null ? "—" : `${Math.round(m.median)} min`;
}

function count(m: Median, word: string): string | null {
  return m.n > 0 ? `median of ${m.n} ${word}` : null;
}

function Num({ value, className }: { value: number; className?: string }) {
  return (
    <td
      className={cn(
        "text-body-s px-4 py-2 text-right font-mono tabular-nums sm:px-6",
        value === 0 && "text-muted-foreground",
        className,
      )}
    >
      {value}
    </td>
  );
}

function Cell({ value, basis }: { value: string; basis: string | null }) {
  return (
    <td className="px-4 py-2 text-right sm:px-6">
      <span className="flex flex-col items-end leading-tight">
        <span className="text-body-s font-mono whitespace-nowrap tabular-nums">{value}</span>
        {basis ? (
          <span className="text-muted-foreground text-caption font-mono whitespace-nowrap tabular-nums">
            {basis}
          </span>
        ) : null}
      </span>
    </td>
  );
}

function Th({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "text-muted-foreground text-overline px-4 py-2.5 font-mono uppercase sm:px-6",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

/** What each column means — printed under the table on both pages. */
export function PilotWeeksNote() {
  return (
    <p className="text-muted-foreground text-caption leading-relaxed">
      Booked = bookings made that week, by where they came in (web, phone app, the desk, USSD); a
      moved booking is not counted twice. No-shows = visits that week marked no-show, of those still
      held when their time came; a % needs {MIN_RATE_SAMPLE} visits, and &quot;unmarked&quot; ones
      nobody marked either way. Check-in vs time given = when the desk checked a booked patient in,
      against the time they were given (median; &quot;before&quot; means early). Check-in → seen =
      from check-in to the clinician calling them in (median). Walk-ins are not in these numbers.
      Counts and minutes per clinic only — never a patient.
    </p>
  );
}
