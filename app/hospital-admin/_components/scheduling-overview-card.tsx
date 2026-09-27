import Link from "next/link";
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { ArrowRightIcon, CalendarClockIcon } from "lucide-react";

import { db } from "@/db";
import { appointments } from "@/db/schema/scheduling";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TIME_ZONE,
  endOfLocalDay,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";

/**
 * Scheduling summary tile for the hospital-admin Overview surface.
 *
 * Mirrors the StaffOverviewCard pattern: self-contained server
 * component, fetches its own aggregates, drops into a KPI grid or
 * renders standalone on the placeholder overview page.
 *
 * All counts are scoped to THIS hospital. No PHI.
 *
 * Reminder-dispatcher health is deliberately NOT here. One cron and one
 * SMS account serve every tenant, a hospital admin can neither read the
 * cross-tenant queue nor fix it, and appointment_reminders carries no
 * hospital_id. It lives on /admin/scheduling-rollup instead.
 */

export interface SchedulingOverviewCardProps {
  hospitalId: string;
  variant?: "card" | "panel";
  className?: string;
}

export interface SchedulingStats {
  todayBooked: number;
  pendingApproval: number;
  urgentToday: number;
  noShows7d: number;
}

const NO_SHOW_LOOKBACK_DAYS = 7;

export async function fetchStats(hospitalId: string): Promise<SchedulingStats | null> {
  try {
    const now = new Date();
    // The hospital's today, not UTC's (03:00 EAT).
    const startOfToday = startOfLocalDay(now, DEFAULT_TIME_ZONE);
    const startOfTomorrow = endOfLocalDay(now, DEFAULT_TIME_ZONE);
    const sevenDaysAgo = new Date(now.getTime() - NO_SHOW_LOOKBACK_DAYS * 86_400_000);

    const [todayCounts, pendingRow, noShowRow] = await Promise.all([
      // Aggregated counts for today, split by priority.
      db
        .select({
          priority: appointments.priority,
          value: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.hospitalId, hospitalId),
            inArray(appointments.status, ["confirmed", "arrived", "in_progress"]),
            gte(appointments.startsAt, startOfToday),
            lt(appointments.startsAt, startOfTomorrow),
          ),
        )
        .groupBy(appointments.priority),
      db
        .select({ value: count() })
        .from(appointments)
        .where(
          and(eq(appointments.hospitalId, hospitalId), eq(appointments.status, "pending_approval")),
        ),
      db
        .select({ value: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.hospitalId, hospitalId),
            eq(appointments.status, "no_show"),
            gte(appointments.startsAt, sevenDaysAgo),
          ),
        ),
    ]);

    const byPriority = Object.fromEntries(todayCounts.map((r) => [r.priority, r.value])) as Record<
      string,
      number
    >;
    const todayBooked = (byPriority["routine"] ?? 0) + (byPriority["urgent"] ?? 0);
    const urgentToday = byPriority["urgent"] ?? 0;

    return {
      todayBooked,
      pendingApproval: pendingRow[0]?.value ?? 0,
      urgentToday,
      noShows7d: noShowRow[0]?.value ?? 0,
    };
  } catch {
    // Null, never zeroes: a failed query rendering "0 urgent today" is a
    // number the database never proved, and it reads as an all-clear.
    return null;
  }
}

export async function SchedulingOverviewCard({
  hospitalId,
  variant = "card",
  className,
}: SchedulingOverviewCardProps) {
  const stats = await fetchStats(hospitalId);
  const isPanel = variant === "panel";

  return (
    <section
      className={cn(
        "border-border bg-card flex flex-col gap-4 rounded-lg border",
        isPanel ? "p-6" : "p-5",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-foreground text-body-m inline-flex items-center gap-2 font-medium">
          <CalendarClockIcon className="text-brand-600 size-4" aria-hidden />
          {isPanel ? "Today" : "Scheduling"}
        </h2>
        {isPanel ? null : (
          <Link
            href="/hospital-admin/scheduling"
            className="text-muted-foreground hover:text-foreground text-caption focus-visible:ring-ring group inline-flex min-h-11 items-center gap-1 rounded transition-colors outline-none focus-visible:ring-2"
          >
            View
            <ArrowRightIcon
              className="size-3 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        )}
      </header>

      {stats === null ? (
        <p role="alert" className="text-muted-foreground text-body-s">
          Scheduling counts unavailable — the query failed. Nothing here should be read as zero.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Today" value={stats.todayBooked} tone="neutral" hint="confirmed bookings" />
          <Stat
            label="Pending"
            value={stats.pendingApproval}
            tone={stats.pendingApproval > 0 ? "actionable" : "neutral"}
            hint="awaiting clinician"
          />
          <Stat
            label="Urgent today"
            value={stats.urgentToday}
            tone={stats.urgentToday > 0 ? "critical" : "neutral"}
            hint="alert-triggered"
          />
          <Stat
            label="No-shows (7d)"
            value={stats.noShows7d}
            tone={stats.noShows7d > 0 ? "warning" : "neutral"}
            hint="signal only"
          />
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "actionable" | "ok" | "critical" | "warning" | "neutral";
  hint?: string;
}) {
  // The brand ramp INVERTS in dark mode (app/globals.css: --brand-700 is
  // #0f766e light, #99f6e4 dark), so the `dark:text-brand-300` this file
  // carried fought the flip and landed dark-on-dark. Red, emerald and
  // amber are stock scales and do not invert, so those keep theirs.
  const cls =
    tone === "actionable"
      ? "text-brand-700"
      : tone === "ok"
        ? "text-emerald-700 dark:text-emerald-300"
        : tone === "critical"
          ? "text-red-700 dark:text-red-300"
          : tone === "warning"
            ? "text-amber-700 dark:text-amber-300"
            : "text-foreground";
  return (
    <div className="border-border/60 hover:border-border rounded-md border p-3 transition-colors">
      <span className="text-muted-foreground text-overline font-mono uppercase">{label}</span>
      <div className={cn("text-heading-l mt-1 font-mono leading-none tabular-nums", cls)}>
        {value}
      </div>
      {hint ? <span className="text-muted-foreground text-caption">{hint}</span> : null}
    </div>
  );
}
