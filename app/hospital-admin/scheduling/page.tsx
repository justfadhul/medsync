import type {
  ClinicianOption,
  ClinicSessionRow,
  SessionTemplateRow,
} from "./_components/clinic-sessions-section";
import type { DepartmentPolicyOption } from "./_components/policy-form";
import type { CadreFeeRow, CadreOption, ServiceLineRow } from "./_components/service-lines-section";
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import {
  AlertCircleIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  MessageSquareIcon,
} from "lucide-react";

import { SectionRule } from "@/components/medsync/panel";
import { StatCard } from "@/components/medsync/stat-card";
import { db } from "@/db";
import { clinicSessions, sessionTemplates } from "@/db/schema/clinic-sessions";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { cadres } from "@/db/schema/reference-data";
import { departmentSchedulingPolicy } from "@/db/schema/scheduling";
import { serviceLineFees, serviceLines } from "@/db/schema/service-lines";
import { users } from "@/db/schema/users";
import { fetchPendingRequests } from "@/lib/hospital-admin/pending";
import { sentBreakdown } from "@/lib/hospital-admin/reports";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TIME_ZONE,
  localDateKey,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";
import { fetchStats } from "../_components/scheduling-overview-card";
import { ClinicSessionsSection } from "./_components/clinic-sessions-section";
import { PendingDialog } from "./_components/pending-dialog";
import { PolicyPanel } from "./_components/policy-panel";
import { ServiceLinesSection } from "./_components/service-lines-section";

/** The console shows what the materialiser produces: 14 days ahead. */
const SESSION_HORIZON_DAYS = 14;

const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Scheduling — hospital-admin surface.
 *
 * The aggregate tile, then the department booking-policy editor. Per-clinician
 * schedules stay in each clinician's own workspace (/clinician/schedule,
 * /clinician/availability) — admin sees structure and aggregates, not
 * individual encounters.
 *
 * Departments are read directly rather than through a lib/ helper because
 * this is the only surface that wants "every department, with its policy or
 * the absence of one"; a shared query would be an abstraction with one caller.
 */
/**
 * One screen, the reference dashboard's shape: a title with its rule and one
 * primary action, a strip of five small numbers, then panels in a grid that
 * crop their own content. Nothing here stacks a form under a table.
 */
export default async function SchedulingPage() {
  const scope = await requireHospitalAdminScope();

  // Left join: a department with no policy row is unrestricted (ADR 0084
  // §14), and that is a state the editor must be able to show and replace —
  // an inner join would hide exactly the departments that need configuring.
  const rows = await db
    .select({
      departmentId: hospitalDepartments.id,
      departmentName: hospitalDepartments.name,
      defaultSlotMinutes: departmentSchedulingPolicy.defaultSlotMinutes,
      defaultBufferMinutes: departmentSchedulingPolicy.defaultBufferMinutes,
      defaultAutoConfirm: departmentSchedulingPolicy.defaultAutoConfirm,
      bookableWeekdays: departmentSchedulingPolicy.bookableWeekdays,
      bookableStartMinutesLocal: departmentSchedulingPolicy.bookableStartMinutesLocal,
      bookableEndMinutesLocal: departmentSchedulingPolicy.bookableEndMinutesLocal,
      reminderLeadMinutes: departmentSchedulingPolicy.reminderLeadMinutes,
      allowVirtual: departmentSchedulingPolicy.allowVirtual,
      notes: departmentSchedulingPolicy.notes,
    })
    .from(hospitalDepartments)
    .leftJoin(
      departmentSchedulingPolicy,
      eq(departmentSchedulingPolicy.departmentId, hospitalDepartments.id),
    )
    .where(eq(hospitalDepartments.hospitalId, scope.hospitalId))
    .orderBy(asc(hospitalDepartments.name));

  const departments: DepartmentPolicyOption[] = rows.map((r) => ({
    departmentId: r.departmentId,
    departmentName: r.departmentName,
    // Every policy column is NOT NULL, so one null means the left join found
    // no row at all — not a half-set policy.
    policy:
      r.defaultSlotMinutes === null
        ? null
        : {
            defaultSlotMinutes: r.defaultSlotMinutes,
            defaultBufferMinutes: r.defaultBufferMinutes ?? 0,
            defaultAutoConfirm: r.defaultAutoConfirm ?? false,
            bookableWeekdays: r.bookableWeekdays ?? [],
            bookableStartMinutesLocal: r.bookableStartMinutesLocal ?? 480,
            bookableEndMinutesLocal: r.bookableEndMinutesLocal ?? 1020,
            reminderLeadMinutes: r.reminderLeadMinutes ?? [1440],
            allowVirtual: r.allowVirtual ?? false,
            notes: r.notes,
          },
  }));

  const [
    lines,
    templates,
    sessions,
    clinicians,
    unstaffedSoon,
    sentToday,
    clinicalCadres,
    fees,
    stats,
    pending,
  ] = await Promise.all([
    fetchServiceLines(scope.hospitalId),
    fetchTemplates(scope.hospitalId),
    fetchUpcomingSessions(scope.hospitalId),
    fetchClinicians(scope.hospitalId),
    fetchUnstaffedSessionsSoon(scope.hospitalId),
    // Today's slice of the reports lib's range query (Gate H): one SQL, two pages.
    sentBreakdown(startOfLocalDay(new Date(), DEFAULT_TIME_ZONE), new Date(), scope.hospitalId),
    fetchClinicalCadres(),
    fetchCadreFees(scope.hospitalId),
    fetchStats(scope.hospitalId),
    fetchPendingRequests(scope.hospitalId),
  ]);

  // The next 14 days as capacity: what was published, what is held.
  const published = sessions.filter((x) => x.status === "published");
  const places = published.reduce(
    (n, x) => n + Math.ceil(x.capacityBooked * x.overbookingFactor),
    0,
  );
  const booked = published.reduce((n, x) => n + x.bookedCount, 0);
  const unstaffed = published.filter((x) => !x.clinicianName).length;
  const smsToday = sentToday.filter((r) => r.channel === "sms");
  const sentCount = sentToday.reduce((n, r) => n + r.count, 0);
  const smsCost = smsToday.reduce((n, r) => n + r.cost, 0);

  return (
    // At xl the page is the viewport: four rows (title, strip, two rows of
    // panels) and every panel scrolls inside itself. Below xl it flows.
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 xl:grid xl:h-[calc(100svh-3.25rem)] xl:grid-rows-[auto_auto_minmax(0,1fr)_minmax(0,1fr)]">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground inline-flex w-fit items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
            <span
              aria-hidden
              className="bg-slate-icon ring-slate-edge size-1 rounded-full ring-2"
            />
            {scope.hospitalName} · Scheduling
          </span>
          <SectionRule title="Scheduling" />
        </div>

        {/* PRD §3.6: a published day starting within 12 hours with no clinician
          named. Amber — the day still runs, and the app hides it as bookable
          until someone is assigned; red is for emergencies alone. */}
        {unstaffedSoon.length > 0 ? (
          <section
            role="status"
            aria-labelledby="t12-heading"
            className="bg-status-caution-bg text-status-caution-fg ring-status-caution-fg/25 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl px-4 py-3 ring-1"
          >
            <h2 id="t12-heading" className="text-body-s font-medium">
              {unstaffedSoon.length === 1
                ? "1 clinic day starts within 12 hours with no clinician named"
                : `${unstaffedSoon.length} clinic days start within 12 hours with no clinician named`}
            </h2>
            <span className="text-body-s tabular-nums">
              {unstaffedSoon
                .map(
                  (u) =>
                    `${u.serviceLineName} · ${u.dateLabel} ${u.timeLabel}${u.bookedCount > 0 ? ` · ${u.bookedCount} booked` : ""}`,
                )
                .join("  ·  ")}
            </span>
            <span className="text-body-s">
              — assign a clinician under Next 14 days, or cancel the day.
            </span>
          </section>
        ) : null}
      </header>

      {/* The strip: five numbers, each with its basis, in the Operations hue
          (scheduling is an Operations domain, ADR 0162). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard
          domain="operations"
          label="Today"
          value={stats?.todayBooked ?? "—"}
          hint="confirmed bookings"
          icon={<CalendarCheckIcon className="size-4" aria-hidden />}
        />
        {/* The one card that opens: the rows behind the number. When the
            stats query failed, the list itself is the count. */}
        <PendingDialog rows={pending} value={stats?.pendingApproval ?? pending.length} />
        <StatCard
          domain="operations"
          label="Urgent today"
          value={stats?.urgentToday ?? "—"}
          hint="alert-triggered"
          icon={<AlertCircleIcon className="size-4" aria-hidden />}
        />
        <StatCard
          domain="operations"
          label="Places, next 14 days"
          value={places}
          hint={`${booked} held · ${published.length} clinic days`}
          icon={<CalendarDaysIcon className="size-4" aria-hidden />}
        />
        <StatCard
          domain="operations"
          label="Sent today"
          value={sentCount}
          hint={
            smsToday.length > 0
              ? `SMS ${smsToday[0]?.currency ?? "UGX"} ${smsCost.toFixed(0)}`
              : "no SMS yet"
          }
          icon={<MessageSquareIcon className="size-4" aria-hidden />}
        />
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-3">
        <ServiceLinesSection
          className="xl:col-span-2"
          lines={lines}
          departments={departments.map((d) => ({ id: d.departmentId, name: d.departmentName }))}
          cadres={clinicalCadres}
          fees={fees}
        />
        <CapacityCard
          places={places}
          booked={booked}
          days={published.length}
          unstaffed={unstaffed}
        />
      </div>

      {/* Two tables and a list: the tables carry a date, a name and a count
          per row and were cramped at a third each — they take the room, the
          policy list is the narrow column. */}
      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,4fr)]">
        <ClinicSessionsSection
          templates={templates}
          sessions={sessions}
          sessionLines={lines
            .filter((l) => l.active && l.capacityMode === "session")
            .map((l) => ({ id: l.id, name: l.name }))}
          clinicians={clinicians}
          todayYmd={localDateKey(new Date(), DEFAULT_TIME_ZONE)}
        />
        <PolicyPanel departments={departments} />
      </div>
    </div>
  );
}

/* ─── The strip and the capacity card ──────────────────────────────── */

/** The reference's "Room availability": one bar, four numbers, all from the published days. */
function CapacityCard({
  places,
  booked,
  days,
  unstaffed,
}: {
  places: number;
  booked: number;
  days: number;
  unstaffed: number;
}) {
  const free = Math.max(places - booked, 0);
  const pct = places > 0 ? Math.round((booked / places) * 100) : 0;
  return (
    <section className="border-border bg-card flex min-h-0 flex-col gap-4 rounded-lg border p-5 shadow-xs">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-foreground text-body-m font-medium">Capacity, next 14 days</h2>
        <span className="text-muted-foreground text-caption font-mono tabular-nums">
          {places > 0 ? `${pct}% held` : "nothing published"}
        </span>
      </header>
      <div
        role="img"
        aria-label={`${booked} of ${places} places held`}
        className="bg-muted flex h-9 w-full overflow-hidden rounded-lg"
      >
        {places > 0 ? (
          <>
            <div className="bg-brand-600 h-full" style={{ width: `${pct}%` }} />
            <div className="bg-brand-200 h-full flex-1" />
          </>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Legend swatch="bg-brand-600" label="Held" value={booked} />
        <Legend swatch="bg-brand-200" label="Free" value={free} />
        <Legend swatch="bg-muted-foreground/40" label="Clinic days" value={days} />
        <Legend swatch="bg-status-caution-fg" label="Unstaffed days" value={unstaffed} />
      </dl>
    </section>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("size-2.5 shrink-0 rounded-sm", swatch)} aria-hidden />
      <div className="flex flex-col">
        <dt className="text-muted-foreground text-caption">{label}</dt>
        <dd className="text-foreground text-body-m font-mono font-medium tabular-nums">{value}</dd>
      </div>
    </div>
  );
}

/* ─── Gate B reads ─────────────────────────────────────────────────── */

async function fetchServiceLines(hospitalId: string): Promise<ServiceLineRow[]> {
  const rows = await db
    .select({
      id: serviceLines.id,
      name: serviceLines.name,
      slug: serviceLines.slug,
      departmentId: serviceLines.departmentId,
      departmentName: hospitalDepartments.name,
      capacityMode: serviceLines.capacityMode,
      timeToCareDays: serviceLines.timeToCareDays,
      continuityDefault: serviceLines.continuityDefault,
      confidential: serviceLines.confidential,
      paymentPosture: serviceLines.paymentPosture,
      feeUgx: serviceLines.feeUgx,
      depositUgx: serviceLines.depositUgx,
      reasonCodes: serviceLines.reasonCodes,
      isDefault: serviceLines.isDefault,
      active: serviceLines.active,
    })
    .from(serviceLines)
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, serviceLines.departmentId))
    .where(eq(serviceLines.hospitalId, hospitalId))
    .orderBy(asc(serviceLines.name));
  return rows;
}

async function fetchTemplates(hospitalId: string): Promise<SessionTemplateRow[]> {
  const rows = await db
    .select({
      id: sessionTemplates.id,
      serviceLineId: sessionTemplates.serviceLineId,
      serviceLineName: serviceLines.name,
      clinicianUserId: sessionTemplates.clinicianUserId,
      clinicianName: users.fullName,
      venue: sessionTemplates.venue,
      weekday: sessionTemplates.weekday,
      startMinutesLocal: sessionTemplates.startMinutesLocal,
      durationMinutes: sessionTemplates.durationMinutes,
      capacityTotal: sessionTemplates.capacityTotal,
      capacityBooked: sessionTemplates.capacityBooked,
      interleaveBooked: sessionTemplates.interleaveBooked,
      interleaveWalkIn: sessionTemplates.interleaveWalkIn,
      overbookingFactor: sessionTemplates.overbookingFactor,
      validFrom: sessionTemplates.validFrom,
      validUntil: sessionTemplates.validUntil,
      active: sessionTemplates.active,
    })
    .from(sessionTemplates)
    .innerJoin(serviceLines, eq(serviceLines.id, sessionTemplates.serviceLineId))
    .leftJoin(users, eq(users.id, sessionTemplates.clinicianUserId))
    .where(eq(sessionTemplates.hospitalId, hospitalId))
    .orderBy(asc(sessionTemplates.weekday), asc(sessionTemplates.startMinutesLocal));
  // numeric(3,2) arrives as a string ("1.00"); the editor wants a number.
  return rows.map((r) => ({ ...r, overbookingFactor: Number(r.overbookingFactor) }));
}

async function fetchUpcomingSessions(hospitalId: string): Promise<ClinicSessionRow[]> {
  const from = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);
  const to = new Date(from.getTime() + SESSION_HORIZON_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: clinicSessions.id,
      startsAt: clinicSessions.startsAt,
      endsAt: clinicSessions.endsAt,
      serviceLineName: serviceLines.name,
      clinicianName: users.fullName,
      bookedCount: clinicSessions.bookedCount,
      capacityBooked: clinicSessions.capacityBooked,
      capacityTotal: clinicSessions.capacityTotal,
      overbookingFactor: clinicSessions.overbookingFactor,
      status: clinicSessions.status,
      delayMinutes: clinicSessions.delayMinutes,
    })
    .from(clinicSessions)
    .innerJoin(serviceLines, eq(serviceLines.id, clinicSessions.serviceLineId))
    .leftJoin(users, eq(users.id, clinicSessions.clinicianUserId))
    .where(
      and(
        eq(clinicSessions.hospitalId, hospitalId),
        gte(clinicSessions.startsAt, from),
        lt(clinicSessions.startsAt, to),
      ),
    )
    .orderBy(asc(clinicSessions.startsAt));
  return rows.map((r) => ({
    id: r.id,
    dateLabel: DAY_FMT.format(r.startsAt),
    timeLabel: `${TIME_FMT.format(r.startsAt)}–${TIME_FMT.format(r.endsAt)}`,
    serviceLineName: r.serviceLineName,
    clinicianName: r.clinicianName,
    bookedCount: r.bookedCount,
    capacityBooked: r.capacityBooked,
    capacityTotal: r.capacityTotal,
    overbookingFactor: Number(r.overbookingFactor),
    status: r.status,
    delayMinutes: r.delayMinutes,
  }));
}

/* ─── Gate E: "Sent today" (PRD §3.4 reports seed) ─────────────────── */

/** The T-12h rule (PRD §3.6): published, within 12 hours, no clinician. */
const T12H_MS = 12 * 3_600_000;

async function fetchUnstaffedSessionsSoon(hospitalId: string) {
  const now = new Date();
  const rows = await db
    .select({
      id: clinicSessions.id,
      startsAt: clinicSessions.startsAt,
      endsAt: clinicSessions.endsAt,
      serviceLineName: serviceLines.name,
      bookedCount: clinicSessions.bookedCount,
    })
    .from(clinicSessions)
    .innerJoin(serviceLines, eq(serviceLines.id, clinicSessions.serviceLineId))
    .where(
      and(
        eq(clinicSessions.hospitalId, hospitalId),
        eq(clinicSessions.status, "published"),
        isNull(clinicSessions.clinicianUserId),
        gte(clinicSessions.startsAt, now),
        lt(clinicSessions.startsAt, new Date(now.getTime() + T12H_MS)),
      ),
    )
    .orderBy(asc(clinicSessions.startsAt));
  return rows.map((r) => ({
    id: r.id,
    serviceLineName: r.serviceLineName,
    dateLabel: DAY_FMT.format(r.startsAt),
    timeLabel: `${TIME_FMT.format(r.startsAt)}–${TIME_FMT.format(r.endsAt)}`,
    bookedCount: r.bookedCount,
  }));
}

/**
 * Who a session can be assigned to: active clinical staff at this hospital
 * — the same test `ha-upsert-session-template` applies to `clinician_user_id`.
 */
async function fetchClinicians(hospitalId: string): Promise<ClinicianOption[]> {
  const rows = await db
    .selectDistinct({ userId: users.id, fullName: users.fullName })
    .from(staffAffiliations)
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(
      and(
        eq(staffAffiliations.hospitalId, hospitalId),
        inArray(staffAffiliations.state, ["active", "approved"]),
        eq(cadres.isClinical, true),
      ),
    )
    .orderBy(asc(users.fullName));
  return rows;
}

/* ─── Gate G (ADR 0092): fees by cadre ─────────────────────────────── */

/** The clinical ladder a fee may attach to. */
async function fetchClinicalCadres(): Promise<CadreOption[]> {
  return db
    .select({ id: cadres.id, name: cadres.name })
    .from(cadres)
    .where(eq(cadres.isClinical, true))
    .orderBy(asc(cadres.name));
}

/** Every override at this hospital, keyed by line in the section. */
async function fetchCadreFees(hospitalId: string): Promise<CadreFeeRow[]> {
  return db
    .select({
      serviceLineId: serviceLineFees.serviceLineId,
      cadreId: serviceLineFees.cadreId,
      cadreName: cadres.name,
      feeUgx: serviceLineFees.feeUgx,
    })
    .from(serviceLineFees)
    .innerJoin(serviceLines, eq(serviceLines.id, serviceLineFees.serviceLineId))
    .innerJoin(cadres, eq(cadres.id, serviceLineFees.cadreId))
    .where(eq(serviceLines.hospitalId, hospitalId))
    .orderBy(asc(cadres.name));
}
