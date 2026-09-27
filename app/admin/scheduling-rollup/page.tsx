import type { Ratio, ReportDays, TenantAggregates } from "@/lib/hospital-admin/reports";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { BellRingIcon, CalendarClockIcon, GaugeIcon } from "lucide-react";

import { Pill } from "@/components/ui/pill";
import { db } from "@/db";
import { hospitals } from "@/db/schema/hospitals";
import { appointmentReminders, appointments } from "@/db/schema/scheduling";
import { getAuthState } from "@/lib/auth";
import {
  fetchTenantAggregates,
  MIN_RATE_SAMPLE,
  parseReportDays,
  REPORT_WINDOWS,
  reportWindow,
} from "@/lib/hospital-admin/reports";
import { logger } from "@/lib/logger";
import { STALE_GRACE_MINUTES } from "@/lib/notifications/sink";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TIME_ZONE,
  endOfLocalDay,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";

export const metadata: Metadata = {
  title: "Scheduling rollup · Superadmin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * Superadmin scheduling rollup — cross-tenant aggregates only.
 *
 * Same shape as /admin/staff-rollup: no individual rows, no PHI, no
 * new god-mode path. Any action against a specific appointment goes
 * through the existing Edge Functions (which already write
 * sa_audit_log when invoked by a superadmin).
 *
 * Surfaces:
 *   - Platform KPIs: total confirmed today, total pending platform-
 *     wide, total urgent today, no-shows in the last 7 days.
 *   - Reminder-dispatcher health (see below).
 *   - Per-hospital table: counts + an unanswered-request flag.
 *   - Booked access per hospital (Gate H, PRD §3.5): the facility reports'
 *     aggregates — fill, no-show, wait accuracy, demand, SMS spend — read
 *     through lib/hospital-admin/reports so this page owns no query of
 *     its own. Rates and counts per hospital, nothing finer.
 *   - Hospitals with no clinician availability declared get a soft
 *     warning row tint so the superadmin can spot tenants that
 *     onboarded but haven't set up scheduling yet.
 *
 * ── The aggregate-only boundary, and why it holds here too ──
 * Nothing on this page may be attributable to one patient. The
 * dispatcher panel is the first thing added since that was written
 * that touches a table whose rows are 1:1 with a patient contact, so:
 * every reminder number below is a COUNT or a MIN(timestamp) over the
 * whole platform, never a row, never joined to a patient, and the
 * failure list is grouped in SQL on `split_part(failure_reason, ':', 1)`
 * — the reason KEY only. That split is not cosmetic. Africa's Talking
 * echoes the request back in its error bodies, and
 * lib/notifications/africastalking.ts stores the provider's words
 * verbatim (`http_400: …`), so the tail of a failure_reason can carry
 * the recipient's phone number. The key is bounded, tenant-free, and
 * enough to act on; the verbatim text stays on the row, readable by
 * whoever owns that hospital's data.
 *
 * ── Why the dispatcher is watched from here ──
 * /api/cron/dispatch-reminders spends real money per message and fails
 * silently: a stopped cron and a working one look identical from every
 * other surface. Nothing else reads appointment_reminders.
 *
 * ── `failed` does not mean failed, and the counts below say so ──
 * planReminderDispatch (lib/notifications/sink.ts) writes state
 * `failed` for three DELIBERATE skips — `appointment_elapsed`, `stale`
 * and `superseded` — alongside genuine send errors. A raw failed count
 * is therefore dominated by correct behaviour and useless as an alert,
 * so this page classifies by `failure_reason` rather than by state, and
 * splits the skips three ways:
 *
 *   superseded          two leads for one appointment came due in the
 *                       same run; the nearer won. Always benign.
 *   queued past due     the row's scheduled_at predates its own
 *                       created_at — the lead had already elapsed when
 *                       the appointment was booked. ADR-0084 made the
 *                       same-day door primary, so every same-day
 *                       booking queues a 24h lead that is stale on
 *                       arrival. Routine, and a producer bug, not a
 *                       dispatch one (see the report).
 *   missed              the row was live and due, and the dispatcher
 *                       did not reach it before the grace window or
 *                       the appointment itself. THIS is the alert.
 *
 * Classifying on reason (not state) means these numbers stay correct
 * if sink.ts is later changed to write `cancelled` for the two skips
 * that are not failures — which is the recommendation, because the
 * miscount is in the column, not only in this view.
 */

/**
 * How soon a request that nobody has answered becomes a routing alarm.
 *
 * This replaces a 48h-since-creation threshold that ADR-0084 quietly
 * invalidated. Creation age stopped meaning anything useful once the
 * patient horizon was capped at 14 days and the same-day door became
 * primary: a request made 48h ago for a visit ten days out is normal,
 * while a request made six hours ago for tomorrow's clinic is already
 * failing and would never have tripped a 48h clock — the appointment
 * elapses before the alarm does. Measured against the appointment's own
 * start, the metric means what the old one was meant to mean: nobody
 * has answered, and the patient is about to find out the hard way.
 * Already-elapsed pending rows are included; they are the terminal case.
 */
const UNANSWERED_HORIZON_HOURS = 24;
const NO_SHOW_LOOKBACK_DAYS = 7;
const REMINDER_LOOKBACK_DAYS = 7;

/**
 * ponytail: mirrors the every-15-minutes cron entry in vercel.json rather
 * than reading it. Ceiling: change that schedule and this copy drifts.
 * Upgrade path: none worth building — the number appears once, here.
 */
const DISPATCH_INTERVAL_MINUTES = 15;

interface HospitalRow {
  hospitalId: string;
  hospitalName: string;
  hospitalLevel: string;
  todayBooked: number;
  pendingApproval: number;
  urgentToday: number;
  unansweredSoon: number;
  noShows7d: number;
}

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

export default async function SchedulingRollupPage({ searchParams }: PageProps) {
  const state = await getAuthState();
  if (!state.user) redirect("/sign-in?redirect=/admin/scheduling-rollup");

  const service = createServiceClient();
  const { data: rolesData } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", state.user.id);
  if (!rolesData?.some((r) => r.role === "superadmin")) redirect("/");

  const days = parseReportDays((await searchParams).days);
  const [{ perHospital, totals, errored }, dispatcher, access] = await Promise.all([
    fetchRollup(),
    fetchDispatcherHealth(),
    fetchAccess(days),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground text-overline inline-flex w-fit items-center gap-1.5 font-mono uppercase">
          <span aria-hidden className="bg-slate-icon ring-slate-edge size-1 rounded-full ring-2" />
          Platform · Scheduling rollup
        </span>
        <h1 className="font-display text-display-s text-foreground">Scheduling across hospitals</h1>
        <p className="text-muted-foreground text-body-s max-w-2xl leading-relaxed">
          Aggregate counts only — no individual appointments. Patient-level operations go through
          the per-hospital workspace.
        </p>
        <div className="bg-ink-300 h-px w-10" aria-hidden />
      </header>

      {errored ? (
        <section
          role="alert"
          className="text-body-s flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50/60 p-4 leading-relaxed text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-200"
        >
          <p className="font-medium">Partial data — one of the rollup queries failed.</p>
          <p className="text-amber-900/80 dark:text-amber-200/80">
            Numbers below are incomplete. Check the Vercel function logs for the underlying error.
          </p>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Platform totals">
        <Kpi label="Confirmed today" value={totals.todayBooked} />
        <Kpi
          label="Pending platform-wide"
          value={totals.pendingApproval}
          tone={totals.pendingApproval > 0 ? "actionable" : "neutral"}
        />
        <Kpi
          label="Urgent today"
          value={totals.urgentToday}
          tone={totals.urgentToday > 0 ? "critical" : "neutral"}
        />
        <Kpi
          label="No-shows (7d)"
          value={totals.noShows7d}
          tone={totals.noShows7d > 0 ? "warning" : "neutral"}
        />
      </section>

      <DispatcherPanel health={dispatcher} />

      <AccessPanel
        days={days}
        rows={perHospital.map((h) => ({
          hospitalId: h.hospitalId,
          hospitalName: h.hospitalName,
          access: access?.get(h.hospitalId) ?? null,
        }))}
        errored={access === null}
      />

      <section
        aria-labelledby="per-hospital-heading"
        className="border-border bg-card overflow-hidden rounded-lg border"
      >
        <header className="border-border flex items-center gap-2 border-b px-4 py-2.5 sm:px-6">
          <CalendarClockIcon className="text-muted-foreground size-3.5" aria-hidden />
          <h2 id="per-hospital-heading" className="text-foreground text-body-s font-medium">
            Per-hospital scheduling
          </h2>
          <span className="text-muted-foreground text-caption ml-auto font-mono tabular-nums">
            {perHospital.length} {perHospital.length === 1 ? "hospital" : "hospitals"}
          </span>
        </header>
        {perHospital.length === 0 ? (
          <p className="text-muted-foreground text-body-s p-8 text-center">No active hospitals.</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Per-hospital scheduling aggregates</caption>
            <thead>
              {/* The neutral ramp inverts too (gray-50 is #fafafa light,
                  #111 dark), so the `dark:bg-gray-900/40` this row used to
                  carry painted a near-white band across the dark header. */}
              <tr className="border-border border-b bg-gray-50">
                <Th>Hospital</Th>
                <Th align="right">Today</Th>
                <Th align="right">Pending</Th>
                <Th align="right">Urgent today</Th>
                <Th align="right">Unanswered ≤{UNANSWERED_HORIZON_HOURS}h</Th>
                <Th align="right">No-shows 7d</Th>
                <Th align="right" className="hidden sm:table-cell">
                  Triage
                </Th>
              </tr>
            </thead>
            <tbody>
              {perHospital.map((h) => (
                <tr
                  key={h.hospitalId}
                  className={cn(
                    "border-border hover:bg-muted/40 border-b transition-colors",
                    h.unansweredSoon > 0 && "bg-amber-50/40 dark:bg-amber-950/10",
                  )}
                >
                  <td className="px-4 py-2.5 sm:px-6">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-foreground text-body-s truncate font-medium">
                        {h.hospitalName}
                      </span>
                      <span className="text-muted-foreground text-caption truncate font-mono">
                        {h.hospitalLevel}
                      </span>
                    </div>
                  </td>
                  <td className="text-foreground text-body-s px-4 py-2.5 text-right font-mono tabular-nums sm:px-6">
                    {h.todayBooked}
                  </td>
                  <td className="px-4 py-2.5 text-right sm:px-6">
                    {h.pendingApproval > 0 ? (
                      <Pill tone="notice">{h.pendingApproval}</Pill>
                    ) : (
                      <span className="text-muted-foreground text-body-s font-mono tabular-nums">
                        0
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right sm:px-6">
                    {h.urgentToday > 0 ? (
                      <Pill tone="critical">{h.urgentToday}</Pill>
                    ) : (
                      <span className="text-muted-foreground text-body-s font-mono tabular-nums">
                        0
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right sm:px-6">
                    {h.unansweredSoon > 0 ? (
                      <Pill tone="notice">{h.unansweredSoon}</Pill>
                    ) : (
                      <span className="text-muted-foreground text-body-s font-mono tabular-nums">
                        —
                      </span>
                    )}
                  </td>
                  <td className="text-foreground text-body-s px-4 py-2.5 text-right font-mono tabular-nums sm:px-6">
                    {h.noShows7d}
                  </td>
                  <td className="hidden px-4 py-2.5 text-right sm:table-cell sm:px-6">
                    <Link
                      href="/admin"
                      className="text-muted-foreground hover:text-foreground text-caption focus-visible:ring-ring inline-flex min-h-11 items-center rounded transition-colors outline-none focus-visible:ring-2"
                    >
                      Approvals →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

interface Totals {
  todayBooked: number;
  pendingApproval: number;
  urgentToday: number;
  noShows7d: number;
}

async function fetchRollup(): Promise<{
  perHospital: HospitalRow[];
  totals: Totals;
  errored: boolean;
}> {
  let errored = false;
  let hospitalRows: Array<{ id: string; name: string; level: string }> = [];
  let aggRows: Array<{
    hospital_id: string;
    today_booked: number;
    pending_approval: number;
    urgent_today: number;
    unanswered_soon: number;
    no_shows_7d: number;
  }> = [];

  try {
    hospitalRows = await db
      .select({ id: hospitals.id, name: hospitals.name, level: hospitals.level })
      .from(hospitals)
      .where(inArray(hospitals.state, ["active", "provisioning"]));
  } catch (e) {
    errored = true;
    logger.error("admin.scheduling-rollup.hospitals_query_failed", { reason: String(e) });
  }

  try {
    const now = new Date();
    // Every hospital's today is EAT, not UTC's (03:00 EAT).
    const startOfToday = startOfLocalDay(now, DEFAULT_TIME_ZONE);
    const startOfTomorrow = endOfLocalDay(now, DEFAULT_TIME_ZONE);
    const sevenDaysAgo = new Date(now.getTime() - NO_SHOW_LOOKBACK_DAYS * 86_400_000);
    const answerDeadline = new Date(now.getTime() + UNANSWERED_HORIZON_HOURS * 3_600_000);

    // One pass per hospital_id with a CASE-summed query.
    const raw = await db
      .select({
        hospital_id: appointments.hospitalId,
        today_booked:
          sql<number>`SUM(CASE WHEN ${appointments.startsAt} >= ${startOfToday.toISOString()} AND ${appointments.startsAt} < ${startOfTomorrow.toISOString()} AND ${appointments.status} IN ('confirmed','arrived','in_progress') THEN 1 ELSE 0 END)`.as(
            "today_booked",
          ),
        pending_approval:
          sql<number>`SUM(CASE WHEN ${appointments.status} = 'pending_approval' THEN 1 ELSE 0 END)`.as(
            "pending_approval",
          ),
        urgent_today:
          sql<number>`SUM(CASE WHEN ${appointments.priority} = 'urgent' AND ${appointments.startsAt} >= ${startOfToday.toISOString()} AND ${appointments.startsAt} < ${startOfTomorrow.toISOString()} THEN 1 ELSE 0 END)`.as(
            "urgent_today",
          ),
        // Measured against the appointment, not against the request —
        // see UNANSWERED_HORIZON_HOURS.
        unanswered_soon:
          sql<number>`SUM(CASE WHEN ${appointments.status} = 'pending_approval' AND ${appointments.startsAt} < ${answerDeadline.toISOString()} THEN 1 ELSE 0 END)`.as(
            "unanswered_soon",
          ),
        no_shows_7d:
          sql<number>`SUM(CASE WHEN ${appointments.status} = 'no_show' AND ${appointments.startsAt} >= ${sevenDaysAgo.toISOString()} THEN 1 ELSE 0 END)`.as(
            "no_shows_7d",
          ),
      })
      .from(appointments)
      .groupBy(appointments.hospitalId);
    aggRows = raw.map((r) => ({
      hospital_id: r.hospital_id,
      today_booked: Number(r.today_booked) || 0,
      pending_approval: Number(r.pending_approval) || 0,
      urgent_today: Number(r.urgent_today) || 0,
      unanswered_soon: Number(r.unanswered_soon) || 0,
      no_shows_7d: Number(r.no_shows_7d) || 0,
    }));
  } catch (e) {
    errored = true;
    logger.error("admin.scheduling-rollup.aggregates_query_failed", { reason: String(e) });
  }

  const byHospital = new Map<string, HospitalRow>();
  for (const h of hospitalRows) {
    byHospital.set(h.id, {
      hospitalId: h.id,
      hospitalName: h.name,
      hospitalLevel: h.level,
      todayBooked: 0,
      pendingApproval: 0,
      urgentToday: 0,
      unansweredSoon: 0,
      noShows7d: 0,
    });
  }
  for (const a of aggRows) {
    const r = byHospital.get(a.hospital_id);
    if (!r) continue;
    r.todayBooked = a.today_booked;
    r.pendingApproval = a.pending_approval;
    r.urgentToday = a.urgent_today;
    r.unansweredSoon = a.unanswered_soon;
    r.noShows7d = a.no_shows_7d;
  }

  const perHospital = Array.from(byHospital.values()).sort((a, b) => {
    if (a.unansweredSoon !== b.unansweredSoon) return b.unansweredSoon - a.unansweredSoon;
    if (a.urgentToday !== b.urgentToday) return b.urgentToday - a.urgentToday;
    return a.hospitalName.localeCompare(b.hospitalName);
  });

  const totals: Totals = perHospital.reduce(
    (acc, h) => ({
      todayBooked: acc.todayBooked + h.todayBooked,
      pendingApproval: acc.pendingApproval + h.pendingApproval,
      urgentToday: acc.urgentToday + h.urgentToday,
      noShows7d: acc.noShows7d + h.noShows7d,
    }),
    { todayBooked: 0, pendingApproval: 0, urgentToday: 0, noShows7d: 0 },
  );

  return { perHospital, totals, errored };
}

/* ─── reminder dispatcher ──────────────────────────────────────────── */

interface DispatcherHealth {
  /** Live queue, all time — a reminder is queued until its lead comes due. */
  queued: number;
  due: number;
  /** Ages, not instants: the panel must stay pure (react-hooks/purity). */
  oldestDueAgeMinutes: number | null;
  lastSentAgeMinutes: number | null;
  sent: number;
  /** Genuine send/data errors only. See the file header. */
  failed: number;
  /** Due, live, and never reached. The alert. */
  missed: number;
  /** The lead had already elapsed when the row was written. Routine. */
  queuedPastDue: number;
  superseded: number;
  /** Reason KEYS only — never the provider's verbatim tail. */
  failureKeys: Array<{ key: string; value: number }>;
}

/** Reaped by the planner rather than attempted. Not send failures. */
const SKIP_REASONS = sql`('appointment_elapsed','stale','superseded')`;

/** The two skips that can also mean "the dispatcher did not run". */
const LATE_REASONS = sql`('appointment_elapsed','stale')`;

async function fetchDispatcherHealth(): Promise<DispatcherHealth | null> {
  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const windowStart = new Date(now.getTime() - REMINDER_LOOKBACK_DAYS * 86_400_000);
    const t = appointmentReminders;

    const [queueRows, windowRows, reasonRows] = await Promise.all([
      // Live queue. Hits appointment_reminders_dispatcher_idx.
      db
        .select({
          queued: sql<number>`SUM(CASE WHEN ${t.state} = 'queued' THEN 1 ELSE 0 END)`,
          due: sql<number>`SUM(CASE WHEN ${t.state} = 'queued' AND ${t.scheduledAt} <= ${nowIso} THEN 1 ELSE 0 END)`,
          oldestDue: sql<Date | null>`MIN(CASE WHEN ${t.state} = 'queued' AND ${t.scheduledAt} <= ${nowIso} THEN ${t.scheduledAt} END)`,
          lastSent: sql<Date | null>`MAX(${t.sentAt})`,
        })
        .from(t),
      // Outcomes in the window, classified by REASON not by state, so the
      // split survives sink.ts being corrected to write `cancelled` for
      // the deliberate skips.
      db
        .select({
          sent: sql<number>`SUM(CASE WHEN ${t.state} = 'sent' THEN 1 ELSE 0 END)`,
          failed: sql<number>`SUM(CASE WHEN ${t.state} = 'failed' AND (${t.failureReason} IS NULL OR ${t.failureReason} NOT IN ${SKIP_REASONS}) THEN 1 ELSE 0 END)`,
          missed: sql<number>`SUM(CASE WHEN ${t.failureReason} IN ${LATE_REASONS} AND ${t.scheduledAt} >= ${t.createdAt} THEN 1 ELSE 0 END)`,
          queuedPastDue: sql<number>`SUM(CASE WHEN ${t.failureReason} IN ${LATE_REASONS} AND ${t.scheduledAt} < ${t.createdAt} THEN 1 ELSE 0 END)`,
          superseded: sql<number>`SUM(CASE WHEN ${t.failureReason} = 'superseded' THEN 1 ELSE 0 END)`,
        })
        .from(t)
        .where(gte(t.updatedAt, windowStart)),
      // `split_part(…, ':', 1)` is the PHI boundary, not a nicety — the
      // provider's tail can echo the recipient's number. Grouping in SQL
      // means the verbatim text never leaves the database.
      db
        .select({
          key: sql<string>`COALESCE(NULLIF(split_part(${t.failureReason}, ':', 1), ''), 'unspecified')`.as(
            "reason_key",
          ),
          value: count(),
        })
        .from(t)
        .where(
          and(
            eq(t.state, "failed"),
            gte(t.updatedAt, windowStart),
            sql`(${t.failureReason} IS NULL OR ${t.failureReason} NOT IN ${SKIP_REASONS})`,
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`2 DESC`)
        .limit(8),
    ]);

    const q = queueRows[0];
    const w = windowRows[0];
    // Same `now` the queue predicate used, so the age and the count agree.
    const ageMinutes = (value: Date | null | undefined) =>
      value ? Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 60_000)) : null;
    return {
      queued: Number(q?.queued) || 0,
      due: Number(q?.due) || 0,
      oldestDueAgeMinutes: ageMinutes(q?.oldestDue),
      lastSentAgeMinutes: ageMinutes(q?.lastSent),
      sent: Number(w?.sent) || 0,
      failed: Number(w?.failed) || 0,
      missed: Number(w?.missed) || 0,
      queuedPastDue: Number(w?.queuedPastDue) || 0,
      superseded: Number(w?.superseded) || 0,
      failureKeys: reasonRows.map((r) => ({ key: r.key, value: Number(r.value) || 0 })),
    };
  } catch (e) {
    logger.error("admin.scheduling-rollup.dispatcher_query_failed", { reason: String(e) });
    return null;
  }
}

function DispatcherPanel({ health }: { health: DispatcherHealth | null }) {
  const dueAgeMin = health?.oldestDueAgeMinutes ?? null;

  // Amber, never red: a stalled cron is an operations failure, not a
  // clinical emergency, and the label carries the state on its own.
  const status =
    dueAgeMin === null
      ? {
          tone: "pending" as const,
          label: "Nothing due",
          detail: "No queued reminder has passed its send time.",
        }
      : dueAgeMin >= STALE_GRACE_MINUTES
        ? {
            tone: "caution" as const,
            label: "Dropping",
            detail: `The oldest due reminder is past the ${STALE_GRACE_MINUTES}-minute grace window, so the next run skips it as stale and nobody is reminded.`,
          }
        : dueAgeMin >= DISPATCH_INTERVAL_MINUTES * 2
          ? {
              tone: "caution" as const,
              label: "Behind",
              detail: `The oldest due reminder has outlived two ${DISPATCH_INTERVAL_MINUTES}-minute dispatch windows.`,
            }
          : {
              tone: "pending" as const,
              label: "Dispatching",
              detail: "The oldest due reminder is inside one dispatch window.",
            };

  return (
    <section
      aria-labelledby="dispatcher-heading"
      className="border-border bg-card overflow-hidden rounded-lg border"
    >
      <header className="border-border flex items-center gap-2 border-b px-4 py-2.5 sm:px-6">
        <BellRingIcon className="text-muted-foreground size-3.5" aria-hidden />
        <h2 id="dispatcher-heading" className="text-foreground text-body-s font-medium">
          Reminder dispatcher
        </h2>
        <span className="text-muted-foreground text-caption ml-auto font-mono">
          SMS · {REMINDER_LOOKBACK_DAYS}-day window
        </span>
      </header>

      {health === null ? (
        <p className="text-muted-foreground text-body-s p-8 text-center">
          Reminder counts unavailable — the query failed. Check the Vercel function logs.
        </p>
      ) : (
        <>
          <div className="bg-border grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Queued" value={health.queued} hint="live queue, incl. due" />
            <Metric label="Due now" value={health.due} hint="past send time" />
            <Metric
              label="Oldest due"
              value={dueAgeMin === null ? "—" : formatAge(dueAgeMin)}
              hint="waiting"
              tone={status.tone === "caution" ? "warning" : "neutral"}
            />
            <Metric label="Sent" value={health.sent} hint="claimed, no error back" />
            <Metric
              label="Send failures"
              value={health.failed}
              hint="provider or data errors"
              tone={health.failed > 0 ? "warning" : "neutral"}
            />
            <Metric
              label="Missed"
              value={health.missed}
              hint="due, never sent"
              tone={health.missed > 0 ? "warning" : "neutral"}
            />
          </div>

          <div className="border-border flex flex-col gap-3 border-t px-4 py-3 sm:px-6">
            <p className="text-body-s flex flex-wrap items-center gap-2">
              <Pill tone={status.tone}>{status.label}</Pill>
              <span className="text-muted-foreground">{status.detail}</span>
              <span className="text-muted-foreground">
                {health.lastSentAgeMinutes === null
                  ? "No send has ever been recorded."
                  : `Last send recorded ${formatAge(health.lastSentAgeMinutes)} ago.`}
              </span>
            </p>

            {health.failureKeys.length > 0 ? (
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Send-failure reason keys, last {REMINDER_LOOKBACK_DAYS} days
                </caption>
                <thead>
                  <tr className="border-border border-b">
                    <Th className="px-0 sm:px-0">Failure reason</Th>
                    <Th align="right" className="px-0 sm:px-0">
                      Count
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {health.failureKeys.map((f) => (
                    <tr key={f.key} className="border-border/60 border-b last:border-0">
                      <td className="text-foreground text-body-s py-1.5 font-mono">{f.key}</td>
                      <td className="text-foreground text-body-s py-1.5 text-right font-mono tabular-nums">
                        {f.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            <p className="text-muted-foreground text-caption leading-relaxed">
              Skipped, not failed, in the window: {health.superseded} superseded (two leads for one
              appointment came due together) and {health.queuedPastDue} queued already past due (the
              lead had elapsed before the booking was made — routine for same-day bookings). Both
              are written to the row as state <span className="font-mono">failed</span>, so the
              counts above are classified by failure reason instead. Reason keys only; the
              provider&apos;s full text stays on the row, which can carry the recipient&apos;s
              number.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

/** "12m" / "3h 04m" / "2d 06h". Minutes in, so the caller owns `now`. */
function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`;
}

/* ─── booked access (Gate H) ───────────────────────────────────────── */

/**
 * The same aggregates the facility sees on /hospital-admin/reports, every
 * tenant at once. The lib groups by hospital_id; a hospital with no row in
 * the window is absent from the map and rendered as dashes. PHI-free by
 * construction — the lib selects no name, code or phone at any grain, and
 * this page shows only the per-hospital grain.
 */
async function fetchAccess(days: ReportDays): Promise<Map<string, TenantAggregates> | null> {
  try {
    return await fetchTenantAggregates(reportWindow(days));
  } catch (e) {
    logger.error("admin.scheduling-rollup.access_query_failed", { reason: String(e) });
    return null;
  }
}

interface AccessRow {
  hospitalId: string;
  hospitalName: string;
  access: TenantAggregates | null;
}

function AccessPanel({
  days,
  rows,
  errored,
}: {
  days: ReportDays;
  rows: AccessRow[];
  errored: boolean;
}) {
  return (
    <section
      aria-labelledby="access-heading"
      className="border-border bg-card overflow-hidden rounded-lg border"
    >
      <header className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-2.5 sm:px-6">
        <GaugeIcon className="text-muted-foreground size-3.5" aria-hidden />
        <h2 id="access-heading" className="text-foreground text-body-s font-medium">
          Booked access
        </h2>
        <nav aria-label="Access window" className="ml-auto flex items-center gap-1">
          {REPORT_WINDOWS.map((d) => (
            <Link
              key={d}
              href={`/admin/scheduling-rollup?days=${d}`}
              aria-current={d === days ? "page" : undefined}
              className={cn(
                "text-caption focus-visible:ring-ring inline-flex min-h-11 items-center rounded px-2 font-mono transition-colors outline-none focus-visible:ring-2",
                d === days
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {d}d
            </Link>
          ))}
        </nav>
      </header>

      {errored ? (
        <p className="text-muted-foreground text-body-s p-8 text-center">
          Access aggregates unavailable — the query failed. Check the Vercel function logs.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-body-s p-8 text-center">No active hospitals.</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Booked-access aggregates per hospital, last {days} days
          </caption>
          <thead>
            <tr className="border-border border-b bg-gray-50">
              <Th>Hospital</Th>
              <Th align="right">Fill</Th>
              <Th align="right">No-show</Th>
              <Th align="right">Wait accuracy</Th>
              <Th align="right" className="hidden sm:table-cell">
                Requests / places
              </Th>
              <Th align="right" className="hidden sm:table-cell">
                SMS spend
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.hospitalId}
                className="border-border hover:bg-muted/40 border-b transition-colors"
              >
                <td className="text-foreground text-body-s px-4 py-2.5 font-medium sm:px-6">
                  {r.hospitalName}
                </td>
                <RateCell ratio={r.access?.fillRate} />
                <RateCell ratio={r.access?.noShowRate} />
                <RateCell ratio={r.access?.waitAccuracy} />
                <td className="text-foreground text-body-s hidden px-4 py-2.5 text-right font-mono tabular-nums sm:table-cell sm:px-6">
                  {r.access && r.access.placesPublished > 0
                    ? `${r.access.requests} / ${r.access.placesPublished}`
                    : "—"}
                </td>
                <td className="text-foreground text-body-s hidden px-4 py-2.5 text-right font-mono tabular-nums sm:table-cell sm:px-6">
                  {r.access && r.access.sms.messages > 0
                    ? `${r.access.sms.currency ?? "UGX"} ${r.access.sms.cost.toFixed(0)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-muted-foreground text-caption border-border border-t px-4 py-3 leading-relaxed sm:px-6">
        Same definitions as each hospital&apos;s own Reports page: fill = booked ÷ places on clinic
        days that have ended; no-show = marked no-show ÷ bookings still held when their time came;
        wait accuracy = booked arrivals called inside their promised window. A rate over fewer than{" "}
        {MIN_RATE_SAMPLE} is shown as too few. Counts and rates per hospital only — these describe a
        clinic&apos;s access, never a patient.
      </p>
    </section>
  );
}

/** "68%" over its "n of d" basis, or "too few" — never a percentage on a thin sample. */
function RateCell({ ratio }: { ratio: Ratio | undefined }) {
  return (
    <td className="px-4 py-2.5 text-right sm:px-6">
      {ratio === undefined ? (
        <span className="text-muted-foreground text-body-s font-mono tabular-nums">—</span>
      ) : (
        <span className="flex flex-col items-end leading-tight">
          <span className="text-foreground text-body-s font-mono tabular-nums">
            {ratio.share === null ? "too few" : `${Math.round(ratio.share * 100)}%`}
          </span>
          <span className="text-muted-foreground text-caption font-mono tabular-nums">
            {ratio.numerator} of {ratio.denominator}
          </span>
        </span>
      )}
    </td>
  );
}

/* ─── UI ───────────────────────────────────────────────────────────── */

type Tone = "actionable" | "critical" | "warning" | "neutral";

/**
 * The brand ramp INVERTS in dark mode (app/globals.css: --brand-700 is
 * #0f766e light, #99f6e4 dark), so the `dark:text-brand-300` this file
 * used to carry fought the flip and landed dark-on-dark. One class,
 * both themes. Red and amber are stock scales and do not invert, so
 * those keep their dark variant.
 */
const TONE_CLASS: Record<Tone, string> = {
  actionable: "text-brand-700",
  critical: "text-red-700 dark:text-red-300",
  warning: "text-amber-700 dark:text-amber-300",
  neutral: "text-foreground",
};

function Kpi({ label, value, tone = "neutral" }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-muted-foreground text-overline font-mono uppercase">{label}</span>
      <span className={cn("text-heading-l leading-none tabular-nums", TONE_CLASS[tone])}>
        {value}
      </span>
    </div>
  );
}

/** Compact cell for the dispatcher's hairline grid. */
function Metric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="bg-card flex flex-col gap-1 px-4 py-3 sm:px-6">
      <span className="text-muted-foreground text-overline font-mono uppercase">{label}</span>
      <span className={cn("text-heading-s font-mono leading-none tabular-nums", TONE_CLASS[tone])}>
        {value}
      </span>
      {hint ? <span className="text-muted-foreground text-caption">{hint}</span> : null}
    </div>
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
