import type { ExpectedArrival, ExpectedTodayRow } from "@/lib/reception/queries";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, ClockIcon, MapPinIcon } from "lucide-react";

import { SectionRule } from "@/components/medsync/panel";
import { PatientIdentityCard } from "@/components/medsync/patient-identity";
import { Pill } from "@/components/ui/pill";
import { listHospitalDepartments } from "@/lib/intake/queries";
import { appointmentBookedVia } from "@/lib/reception/booked-via";
import {
  fetchExpectedArrivals,
  fetchExpectedCountsByDay,
  fetchExpectedToday,
  fetchProvisional,
  fetchQueueForDay,
  fetchReconciliationCandidates,
} from "@/lib/reception/queries";
import { requireReceptionScope } from "@/lib/reception/scope";
import { DEFAULT_TIME_ZONE, localDateKey } from "@/supabase/functions/_shared/slots";
import { AutoRefresh } from "../_components/auto-refresh";
import { DayStrip, formatDayKey, weekOf } from "../_components/day-strip";
import { RouteControl } from "../_components/route-control";
import { NoShowButton } from "./_components/no-show-button";
import { QueuePanel } from "./_components/queue-panel";
import { ReconcilePanel } from "./_components/reconcile-panel";

export const metadata: Metadata = { title: "Expected · Reception · MedSync" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  pending_approval: "Awaiting approval",
  confirmed: "Confirmed",
  arrived: "Arrived",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
  rescheduled: "Rescheduled",
};

interface PageProps {
  searchParams: Promise<{ date?: string; reconcile?: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReceptionExpectedPage({ searchParams }: PageProps) {
  const { date: dateParam, reconcile } = await searchParams;
  const scope = await requireReceptionScope();
  // Only the shape the strip emits; anything else is today. (V8 parses far
  // stranger strings into far stranger years.)
  const parsed =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? new Date(dateParam) : undefined;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  // One clock read: the rows' "time has passed" test and the day window agree.
  const now = new Date();
  const todayKey = localDateKey(now, DEFAULT_TIME_ZONE);
  const selectedKey = date ? localDateKey(date, DEFAULT_TIME_ZONE) : todayKey;
  const when = selectedKey === todayKey ? "today" : selectedKey < todayKey ? "past" : "future";
  const week = weekOf(date ?? now);
  // The panel is opened from a row, one provisional at a time — candidates
  // are a decrypt scan, not something to run for every row on every poll.
  const reconcileId = reconcile && UUID.test(reconcile) ? reconcile : null;

  const isToday = when === "today";
  const [rows, today, departments, provisional, candidates, weekCounts, queue] = await Promise.all([
    // Another day is a read-only record of its bookings; check-in and routing
    // are for today only (ha-check-in-patient would otherwise admit a
    // confirmed booking from any day).
    isToday
      ? Promise.resolve([])
      : fetchExpectedArrivals({
          hospitalId: scope.hospitalId,
          receptionUserId: scope.userId,
          date,
          limit: 200,
        }),
    // Today is one list in the order people booked, plus anyone who marked
    // themselves arrived and has not been sent on (ADR 0101).
    isToday
      ? fetchExpectedToday({
          hospitalId: scope.hospitalId,
          receptionUserId: scope.userId,
          limit: 200,
        })
      : Promise.resolve(null),
    isToday ? listHospitalDepartments(scope.hospitalId) : Promise.resolve([]),
    reconcileId
      ? fetchProvisional({ hospitalId: scope.hospitalId, provisionalPatientId: reconcileId })
      : Promise.resolve(null),
    reconcileId
      ? fetchReconciliationCandidates({
          hospitalId: scope.hospitalId,
          receptionUserId: scope.userId,
          provisionalPatientId: reconcileId,
        })
      : Promise.resolve([]),
    fetchExpectedCountsByDay({ hospitalId: scope.hospitalId, from: week.mondayStart, days: 7 }),
    // A future day has no intakes; the panel says so from the week's count.
    when === "future"
      ? Promise.resolve([])
      : fetchQueueForDay({ hospitalId: scope.hospitalId, date: date ?? now }),
  ]);
  const dayLabel = formatDayKey(selectedKey);
  const expectedOnDay = weekCounts.find((c) => c.dateKey === selectedKey)?.expected ?? 0;

  return (
    <div className="stagger-children mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8 lg:py-10">
      <Link
        href="/reception"
        className="text-muted-foreground hover:text-foreground text-body-s ease-expo-out group inline-flex w-fit items-center gap-1 transition-colors duration-150"
      >
        <ArrowLeftIcon
          className="ease-expo-out size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Front desk
      </Link>

      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground text-overline inline-flex items-center gap-1.5 font-mono uppercase">
          <span aria-hidden className="bg-brand-500 ring-brand-500/20 size-1 rounded-full ring-2" />
          {scope.hospitalName} · Expected arrivals
        </span>
        <h1 className="font-display text-foreground text-heading-l">Expected patients</h1>
        <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed">
          When a patient arrives, send them to <span className="font-medium">triage</span> or
          straight to the <span className="font-medium">clinic</span> — they join that
          department&rsquo;s queue. Triage is the default; an emergency is always triaged.
        </p>
        {/* Not while the panel is open: each refresh would re-run the
            candidate scan and write another audit row per name. */}
        {provisional ? null : <AutoRefresh />}
      </header>

      {provisional ? <ReconcilePanel provisional={provisional} candidates={candidates} /> : null}

      <DayStrip
        counts={weekCounts}
        selectedKey={selectedKey}
        todayKey={todayKey}
        prevKey={week.prevKey}
        nextKey={week.nextKey}
      />

      {/* The day's board beside its queue; below xl they stack. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionRule
            title={`Expected · ${dayLabel}`}
            action={
              <span className="text-muted-foreground text-caption font-mono tabular-nums">
                {today ? `${today.expected.length} expected` : `${rows.length} booked`}
              </span>
            }
          />

          {today ? (
            <ExpectedToday
              expected={today.expected}
              needsRouting={today.needsRouting}
              departments={departments}
              now={now}
              todayKey={todayKey}
            />
          ) : (
            <BookedDay rows={rows} now={now} dayLabel={dayLabel} />
          )}
        </div>

        <QueuePanel rows={queue} when={when} expected={expectedOnDay} />
      </div>

      <p className="text-muted-foreground/80 text-caption leading-relaxed">
        Reception sees operational + demographic data, never clinical content. Names and photos on
        this board are decrypted so you can match the person at the desk — each one is recorded
        against your account, as is every check-in.
      </p>
    </div>
  );
}

/**
 * Today at the desk (ADR 0101). First, anyone already here whom nobody has
 * sent on — they tapped "I have arrived" in the app. Then everyone still
 * coming, in the order they booked, each saying how they booked. That label
 * is words only: it never orders the list and never colours a row.
 */
function ExpectedToday({
  expected,
  needsRouting,
  departments,
  now,
  todayKey,
}: {
  expected: ReadonlyArray<ExpectedTodayRow>;
  needsRouting: ReadonlyArray<ExpectedArrival>;
  departments: ReadonlyArray<{ id: string; name: string }>;
  now: Date;
  todayKey: string;
}) {
  return (
    <>
      {needsRouting.length > 0 ? (
        <section aria-labelledby="here-heading" className="flex flex-col gap-2">
          <h2
            id="here-heading"
            className="text-muted-foreground text-overline inline-flex items-center gap-1.5 font-mono uppercase"
          >
            <MapPinIcon className="size-3.5" aria-hidden />
            Here — needs sending on ({needsRouting.length})
          </h2>
          <p className="text-muted-foreground text-caption leading-relaxed">
            They told the app they have arrived, and are in their clinic&rsquo;s line — but nobody
            has sent them on yet. Send each one to triage or to the clinic.
          </p>
          <ul className="divide-border/60 border-border bg-card divide-y overflow-hidden rounded-xl border">
            {needsRouting.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <PatientIdentityCard patient={r.identity} />
                  {/* Under the name (32px disc + gap), where the card's own lines sit. */}
                  <span className="text-muted-foreground text-caption pl-11 tabular-nums">
                    {[
                      r.departmentName,
                      r.clinicianName,
                      appointmentBookedVia(r.origin, r.channel),
                      `here since ${formatTime(r.hereSinceIso ?? r.startsAtIso)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <RouteControl
                  appointmentId={r.id}
                  departments={departments}
                  defaultDepartmentId={r.departmentId}
                  patientLabel={r.identity.displayName ?? r.patientCode ?? "this patient"}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {expected.length === 0 ? (
        <div className="border-border bg-card flex items-center gap-5 rounded-xl border p-6">
          <ClockIcon className="text-border size-10 shrink-0" aria-hidden />
          <p className="text-muted-foreground text-body-s">
            Nobody is still expected today. Bookings and same-day tickets from the app appear here
            as they come in.
          </p>
        </div>
      ) : (
        <div className="border-border bg-card overflow-x-auto rounded-xl border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Everyone expected today and not here yet, in the order they booked — earliest booking
              first, however they booked. Ask for the name: a code from the app may be on a phone at
              home.
            </caption>
            <thead className="border-border bg-muted/30 border-b">
              <tr className="text-muted-foreground text-overline font-mono uppercase">
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Patient
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  How booked
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Booked at
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Due
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  <span className="sr-only">Send on</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {expected.map((r) => (
                <tr
                  key={`${r.kind}-${r.id}`}
                  className="hover:bg-brand-50/40 ease-expo-out align-top transition-colors duration-150"
                >
                  <td className="min-w-64 px-4 py-2.5">
                    <div className="flex flex-col gap-1">
                      <PatientIdentityCard
                        patient={r.identity}
                        trailing={
                          r.kind === "booking" && !r.patientCode && r.provisional ? (
                            <Pill tone="pending">
                              {r.provisional.state === "rejected"
                                ? "Not matched · register"
                                : "Identity to confirm"}
                            </Pill>
                          ) : undefined
                        }
                      />
                      <span className="text-muted-foreground text-caption pl-11 tabular-nums">
                        {(r.kind === "booking"
                          ? [
                              r.bookingCode ? `booking ${r.bookingCode}` : null,
                              r.clinicianName,
                              r.departmentName,
                              r.type === "virtual" ? "virtual" : null,
                            ]
                          : [r.departmentName]
                        )
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </td>
                  <td className="text-foreground text-body-s px-4 py-2.5 whitespace-nowrap">
                    {r.bookedVia}
                  </td>
                  <td className="text-muted-foreground text-body-s px-4 py-2.5 font-mono whitespace-nowrap tabular-nums">
                    {formatBookedAt(r.bookedAtIso, todayKey)}
                  </td>
                  <td className="text-foreground text-body-s px-4 py-2.5 font-mono whitespace-nowrap tabular-nums">
                    {dueLabel(r)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <Pill tone="neutral">
                        {r.kind === "declared"
                          ? "Coming today"
                          : (STATUS_LABEL[r.status] ?? r.status)}
                      </Pill>
                      {r.kind === "booking" && (r.confirmedByPatient || r.priority === "urgent") ? (
                        <span className="text-muted-foreground text-caption">
                          {[
                            r.confirmedByPatient ? "Patient confirmed" : null,
                            r.priority === "urgent" ? "Urgent booking" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col items-end gap-2">
                      <ExpectedAction r={r} departments={departments} now={now} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * What the desk can do with a row. Only a confirmed booking (the one status
 * check-in accepts) or a declared ticket is sent on; a booking with no
 * confirmed patient yet asks who it is first (ha-check-in-patient refuses it,
 * 409), and one still waiting on approval says so.
 */
function ExpectedAction({
  r,
  departments,
  now,
}: {
  r: ExpectedTodayRow;
  departments: ReadonlyArray<{ id: string; name: string }>;
  now: Date;
}) {
  const label = r.identity.displayName ?? r.patientCode ?? "this patient";
  if (r.kind === "declared") {
    return (
      <RouteControl
        intakeId={r.id}
        departments={departments}
        defaultDepartmentId={r.departmentId}
        patientLabel={label}
      />
    );
  }
  if (r.patientCode === null && r.provisional) {
    return r.provisional.state === "unreconciled" ? (
      <Link
        href={`/reception/expected?reconcile=${r.provisional.id}`}
        className="text-foreground border-foreground/15 hover:border-foreground/30 hover:bg-muted/40 text-body-s ease-expo-out tap inline-flex min-h-11 items-center rounded-full border px-4 whitespace-nowrap transition-colors duration-150"
      >
        Confirm identity
      </Link>
    ) : (
      <span className="text-muted-foreground text-caption whitespace-nowrap">
        Register at the desk
      </span>
    );
  }
  if (r.status !== "confirmed") {
    return (
      <span className="text-muted-foreground text-caption whitespace-nowrap">
        Not confirmed yet
      </span>
    );
  }
  // A video visit has no door to send the patient through.
  if (r.type === "virtual") {
    return (
      <span className="text-muted-foreground text-caption whitespace-nowrap">Video visit</span>
    );
  }
  return (
    <>
      {new Date(r.startsAtIso) < now ? (
        <NoShowButton appointmentId={r.id} patientLabel={label} />
      ) : null}
      <RouteControl
        appointmentId={r.id}
        departments={departments}
        defaultDepartmentId={r.departmentId}
        patientLabel={label}
      />
    </>
  );
}

/** A clinic-day booking is due by its position and window; a slot by its time; a ticket any time today. */
function dueLabel(r: ExpectedTodayRow): string {
  if (r.kind === "declared") return "Today";
  if (r.positionNumber === null) return formatTime(r.startsAtIso);
  return r.arrivalWindowStartIso
    ? `No. ${r.positionNumber} · from ${formatTime(r.arrivalWindowStartIso)}`
    : `No. ${r.positionNumber}`;
}

/** A booking made today reads as a time; an older one needs its day too. */
function formatBookedAt(iso: string, todayKey: string): string {
  const d = new Date(iso);
  if (localDateKey(d, DEFAULT_TIME_ZONE) === todayKey) return formatTime(iso);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DEFAULT_TIME_ZONE,
  });
}

/**
 * Another day's bookings: the record, read-only. Check-in and routing are
 * today's; what a past day still offers is closing it — no-show for a
 * confirmed booking whose time passed, and confirming who a provisional
 * booking was for.
 */
function BookedDay({
  rows,
  now,
  dayLabel,
}: {
  rows: ReadonlyArray<ExpectedArrival>;
  now: Date;
  dayLabel: string;
}) {
  return rows.length === 0 ? (
    <div className="border-border bg-card flex items-center gap-5 rounded-xl border p-6">
      <svg viewBox="0 0 96 56" aria-hidden className="text-border h-12 w-auto shrink-0">
        <rect x="0" y="2" width="84" height="10" rx="4" fill="currentColor" opacity="0.5" />
        <rect x="0" y="20" width="64" height="10" rx="4" fill="currentColor" opacity="0.3" />
        <rect x="0" y="38" width="44" height="10" rx="4" fill="currentColor" opacity="0.15" />
        <circle cx="89" cy="43" r="5" className="text-brand-500/30" fill="currentColor" />
      </svg>
      <p className="text-muted-foreground text-body-s">
        No bookings for {dayLabel}. Booked patients appear here as appointments are confirmed.
      </p>
    </div>
  ) : (
    <div className="border-border bg-card overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Booked appointments, earliest first, each with its status. Check-in is for today only; a
          confirmed booking whose time has passed offers no-show.
        </caption>
        <thead className="border-border bg-muted/30 border-b">
          <tr className="text-muted-foreground text-overline font-mono uppercase">
            <th scope="col" className="px-4 py-2.5 font-normal">
              Time
            </th>
            <th scope="col" className="px-4 py-2.5 font-normal">
              Patient
            </th>
            <th scope="col" className="px-4 py-2.5 font-normal">
              <abbr title="Position in the clinic day" className="no-underline">
                Pos.
              </abbr>
            </th>
            <th scope="col" className="px-4 py-2.5 font-normal">
              Clinician · Department
            </th>
            <th scope="col" className="px-4 py-2.5 font-normal">
              Status
            </th>
            <th scope="col" className="px-4 py-2.5 font-normal">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-border/60 divide-y">
          {rows.map((r) => (
            <tr
              key={r.id}
              className="hover:bg-brand-50/40 ease-expo-out transition-colors duration-150"
            >
              <td className="text-foreground text-body-s px-4 py-2.5 font-mono tabular-nums">
                {formatTime(r.startsAtIso)}
              </td>
              <td className="min-w-64 px-4 py-2.5">
                {/* A booking with no patient record yet titles itself with
                        the declared name (the audited reveal); the pill says the state. */}
                <PatientIdentityCard
                  patient={r.identity}
                  trailing={
                    !r.patientCode && r.provisional ? (
                      <Pill tone="pending">
                        {r.provisional.state === "rejected"
                          ? "Not matched · register"
                          : "Identity to confirm"}
                      </Pill>
                    ) : undefined
                  }
                />
              </td>
              <td className="text-foreground text-body-s px-4 py-2.5 font-mono tabular-nums">
                {r.positionNumber ?? "—"}
              </td>
              <td className="text-foreground text-body-s px-4 py-2.5">
                {r.clinicianName ?? "—"}
                {r.departmentName ? (
                  <span className="text-muted-foreground"> · {r.departmentName}</span>
                ) : null}
                {r.type === "virtual" ? (
                  <span className="text-muted-foreground/80 text-overline ml-2 font-mono uppercase">
                    virtual
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2.5">
                {/* Neutral for every status. `stable` and `admitted` mean
                        vitals and a bed; an appointment status knows neither,
                        and the Check in / Checked in control beside it already
                        says whether this patient is in the building. */}
                <Pill tone="neutral">{r.seen ? "Seen" : (STATUS_LABEL[r.status] ?? r.status)}</Pill>
              </td>
              <td className="px-4 py-2.5 text-right">
                <div className="flex flex-wrap items-start justify-end gap-2">
                  {r.patientCode === null && r.provisional ? (
                    // Check-in is refused until the desk says who this is
                    // (ha-check-in-patient, 409). Offer the honest step.
                    r.provisional.state === "unreconciled" ? (
                      <Link
                        href={`/reception/expected?reconcile=${r.provisional.id}`}
                        className="text-foreground border-foreground/15 hover:border-foreground/30 hover:bg-muted/40 text-body-s ease-expo-out tap inline-flex min-h-11 items-center rounded-full border px-4 whitespace-nowrap transition-colors duration-150"
                      >
                        Confirm identity
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-caption whitespace-nowrap">
                        Register at the desk
                      </span>
                    )
                  ) : r.status === "confirmed" && new Date(r.startsAtIso) < now ? (
                    <NoShowButton
                      appointmentId={r.id}
                      patientLabel={r.patientCode ?? "this patient"}
                    />
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The hospital's clock, 24-hour — not the host's (UTC on Vercel). */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DEFAULT_TIME_ZONE,
  });
}
