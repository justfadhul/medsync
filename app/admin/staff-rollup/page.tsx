import type { PillTone } from "@/components/ui/data-table";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { inArray, sql } from "drizzle-orm";
import { ArrowRightIcon, UsersIcon } from "lucide-react";

import { Pill } from "@/components/ui/data-table";
import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitals } from "@/db/schema/hospitals";
import { getAuthState } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Staff rollup · Superadmin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Superadmin staff rollup — cross-tenant aggregates only.
 *
 * No individual-person rows here. The superadmin can already act on
 * any pending staff affiliation from the existing Approvals queue
 * (which surfaces all tenants' pending items); this page is the
 * operational health view above that — what's the backlog look like
 * platform-wide, which hospitals are sitting on stale queues?
 *
 * Boundary integrity (per kickoff §4):
 *   - aggregate-only: counts, longest-pending-days, per-hospital
 *     totals. No names, no council numbers, no PHI.
 *   - no new god-mode path: any action against a specific affiliation
 *     happens through the existing approve / reject / suspend / etc.
 *     Edge Functions, which already write sa_audit_log when a
 *     superadmin invokes them.
 *
 * Stale threshold: 14 days (matches the Pending queue's amber/red
 * aging chip thresholds so the cues are consistent).
 */

const STALE_DAYS_THRESHOLD = 14;
const ACTIVE_STATES = ["active", "approved"] as const;
const VISIBLE_AFFILIATION_STATES = [
  ...ACTIVE_STATES,
  "pending_approval",
  "suspended",
  "deactivated",
] as const;

export default async function StaffRollupPage() {
  const state = await getAuthState();

  // Guard: superadmin-only. The /admin layout already enforces this,
  // but the page re-checks because a future role expansion shouldn't
  // accidentally widen access to platform-wide aggregates.
  if (!state.user) redirect("/sign-in?redirect=/admin/staff-rollup");
  const service = createServiceClient();
  const { data: rolesData } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", state.user.id);
  const isSuperadmin = !!rolesData?.some((r) => r.role === "superadmin");
  if (!isSuperadmin) redirect("/");

  const { perHospital, totals, errored } = await fetchRollup();
  const staleHospitals = perHospital.filter((h) => h.oldestPendingDays >= STALE_DAYS_THRESHOLD);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex w-fit items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-slate-icon ring-slate-edge size-1 rounded-full ring-2" />
          Platform · Staff rollup
        </span>
        <h1 className="font-display text-display-s text-foreground">Staff across hospitals</h1>
        <p className="text-muted-foreground max-w-2xl text-[13.5px] leading-relaxed">
          Aggregate counts only — no individual names or council numbers. To act on a specific
          pending affiliation, use the{" "}
          <Link href="/admin" className="text-foreground underline-offset-2 hover:underline">
            Approvals queue
          </Link>
          .
        </p>
        <div className="bg-ink-300 h-px w-10" aria-hidden />
      </header>

      {errored ? (
        <section
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50/60 p-4 text-[12.5px] leading-relaxed text-red-900 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-200"
        >
          <p className="font-medium">One of the rollup queries failed.</p>
          <p className="text-red-900/80 dark:text-red-200/80">
            The numbers below are partial. Check the function logs (Vercel dashboard → Logs → this
            route) for the underlying error.
          </p>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Active staff" value={totals.active} />
        <KpiCard
          label="Pending approval"
          value={totals.pending}
          tone={totals.pending > 0 ? "actionable" : "neutral"}
        />
        <KpiCard
          label="Suspended"
          value={totals.suspended}
          tone={totals.suspended > 0 ? "warning" : "neutral"}
        />
        <KpiCard
          label="Hospitals with stale queue"
          value={staleHospitals.length}
          tone={staleHospitals.length > 0 ? "critical" : "neutral"}
          hint={`≥ ${STALE_DAYS_THRESHOLD} days pending`}
        />
      </section>

      {staleHospitals.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-800/40 dark:bg-amber-950/20">
          <h2 className="text-body-s inline-flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-amber-500 ring-2 ring-amber-500/20"
            />
            Stale-queue health signal
          </h2>
          <p className="text-[12.5px] leading-relaxed text-amber-900/80 dark:text-amber-100/80">
            {staleHospitals.length}{" "}
            {staleHospitals.length === 1 ? "hospital has" : "hospitals have"} pending staff
            affiliations sitting ≥ {STALE_DAYS_THRESHOLD} days. Routine triage is the hospital
            admin&apos;s job; reach out before stepping in.
          </p>
          <ul className="flex flex-col gap-1.5 pt-1 pl-1">
            {staleHospitals.map((h) => (
              <li
                key={h.hospitalId}
                className="text-body-s flex items-baseline gap-2 text-amber-900 dark:text-amber-100"
              >
                <span className="font-medium">{h.hospitalName}</span>
                <span className="text-caption font-mono text-amber-700 tabular-nums dark:text-amber-300">
                  {h.pending} pending · oldest {h.oldestPendingDays}d
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border-border bg-card overflow-hidden rounded-lg border">
        <header className="border-border flex items-center gap-2 border-b px-4 py-2.5 sm:px-6">
          <UsersIcon className="text-muted-foreground size-3.5" aria-hidden />
          <span className="text-foreground text-body-s font-medium">Per-hospital totals</span>
          <span className="text-muted-foreground text-caption ml-auto font-mono tabular-nums">
            {perHospital.length} {perHospital.length === 1 ? "hospital" : "hospitals"}
          </span>
        </header>
        {perHospital.length === 0 ? (
          <p className="text-muted-foreground text-body-s p-8 text-center">
            No hospitals on platform yet.
          </p>
        ) : (
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Per-hospital staff aggregates</caption>
            <thead>
              <tr className="border-border border-b bg-gray-50">
                <Th>Hospital</Th>
                <Th align="right">Active</Th>
                <Th align="right">Pending</Th>
                <Th align="right">Suspended</Th>
                <Th align="right">Oldest pending</Th>
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
                    h.oldestPendingDays >= STALE_DAYS_THRESHOLD &&
                      "bg-amber-50/40 dark:bg-amber-950/10",
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
                    {h.active}
                  </td>
                  <td className="px-4 py-2.5 text-right sm:px-6">
                    {h.pending > 0 ? (
                      <Pill tone="notice">{h.pending}</Pill>
                    ) : (
                      <span className="text-muted-foreground font-mono text-[12.5px] tabular-nums">
                        0
                      </span>
                    )}
                  </td>
                  <td className="text-foreground text-body-s px-4 py-2.5 text-right font-mono tabular-nums sm:px-6">
                    {h.suspended || ""}
                    {h.suspended === 0 ? <span className="text-muted-foreground">0</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-right sm:px-6">
                    {h.oldestPendingDays > 0 ? (
                      <Pill tone={agingTone(h.oldestPendingDays)}>{h.oldestPendingDays}d</Pill>
                    ) : (
                      <span className="text-muted-foreground font-mono text-[12.5px] tabular-nums">
                        —
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 text-right sm:table-cell sm:px-6">
                    <Link
                      href={`/admin?focus=hospital:${h.hospitalId}`}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11.5px] transition-colors"
                    >
                      Approvals
                      <ArrowRightIcon className="size-3" aria-hidden />
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

/* ─── Data ─────────────────────────────────────────────────────────── */

interface HospitalRollupRow {
  hospitalId: string;
  hospitalName: string;
  hospitalLevel: string;
  active: number;
  pending: number;
  suspended: number;
  /** Days since the oldest pending row in this hospital, 0 if none pending. */
  oldestPendingDays: number;
}

interface Totals {
  active: number;
  pending: number;
  suspended: number;
}

async function fetchRollup(): Promise<{
  perHospital: HospitalRollupRow[];
  totals: Totals;
  errored: boolean;
}> {
  let breakdown: Array<{
    hospitalId: string;
    state: string;
    count: unknown;
    oldest: unknown;
  }> = [];
  let hospitalRows: Array<{
    id: string;
    name: string;
    level: string;
    state: string;
  }> = [];
  let errored = false;

  try {
    // One pass over staff_affiliations grouped by hospital_id + state.
    breakdown = await db
      .select({
        hospitalId: staffAffiliations.hospitalId,
        state: staffAffiliations.state,
        count: sql<number>`count(*)`.as("count"),
        oldest: sql<unknown>`min(${staffAffiliations.createdAt})`.as("oldest"),
      })
      .from(staffAffiliations)
      .where(inArray(staffAffiliations.state, [...VISIBLE_AFFILIATION_STATES]))
      .groupBy(staffAffiliations.hospitalId, staffAffiliations.state);
  } catch (e) {
    errored = true;
    logger.error("admin.staff-rollup.breakdown_query_failed", { reason: String(e) });
  }

  try {
    // Hospital roster (so we list zero-staff hospitals too — silence
    // is a signal worth showing).
    hospitalRows = await db
      .select({
        id: hospitals.id,
        name: hospitals.name,
        level: hospitals.level,
        state: hospitals.state,
      })
      .from(hospitals)
      .where(inArray(hospitals.state, ["active", "provisioning"]));
  } catch (e) {
    errored = true;
    logger.error("admin.staff-rollup.hospitals_query_failed", { reason: String(e) });
  }

  const byHospital = new Map<string, HospitalRollupRow>();
  for (const h of hospitalRows) {
    byHospital.set(h.id, {
      hospitalId: h.id,
      hospitalName: h.name,
      hospitalLevel: h.level,
      active: 0,
      pending: 0,
      suspended: 0,
      oldestPendingDays: 0,
    });
  }

  const nowMs = Date.now();
  for (const row of breakdown) {
    const bucket = byHospital.get(row.hospitalId);
    if (!bucket) continue;
    const c = Number(row.count);
    if (row.state === "active" || row.state === "approved") bucket.active += c;
    else if (row.state === "pending_approval") {
      bucket.pending += c;
      // Defensive coerce: postgres-js may return aggregate timestamps
      // as a string (not a Date) when wrapped in `sql<...>`. new Date()
      // accepts both Date and ISO string and turns null/undefined into
      // an Invalid Date whose getTime() is NaN — guarded below.
      const oldestMs = row.oldest ? new Date(row.oldest as string | Date).getTime() : NaN;
      if (!Number.isNaN(oldestMs)) {
        const days = Math.floor((nowMs - oldestMs) / 86_400_000);
        if (days > bucket.oldestPendingDays) bucket.oldestPendingDays = days;
      }
    } else if (row.state === "suspended") bucket.suspended += c;
  }

  const perHospital = Array.from(byHospital.values()).sort((a, b) => {
    // Stale + non-zero pending first, then by name.
    if (a.oldestPendingDays !== b.oldestPendingDays)
      return b.oldestPendingDays - a.oldestPendingDays;
    if (a.pending !== b.pending) return b.pending - a.pending;
    return a.hospitalName.localeCompare(b.hospitalName);
  });

  const totals: Totals = perHospital.reduce(
    (acc, h) => ({
      active: acc.active + h.active,
      pending: acc.pending + h.pending,
      suspended: acc.suspended + h.suspended,
    }),
    { active: 0, pending: 0, suspended: 0 },
  );

  return { perHospital, totals, errored };
}

/* ─── UI primitives ────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: number;
  tone?: "actionable" | "ok" | "warning" | "critical" | "neutral";
  hint?: string;
}) {
  const toneClass =
    tone === "actionable"
      ? "text-brand-700"
      : tone === "ok"
        ? "text-emerald-700 dark:text-emerald-300"
        : tone === "warning"
          ? "text-amber-700 dark:text-amber-300"
          : tone === "critical"
            ? "text-red-700 dark:text-red-300"
            : "text-foreground";
  return (
    <div className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-muted-foreground font-mono text-[10.5px] tracking-[0.12em] uppercase">
        {label}
      </span>
      <span className={cn("text-heading-l leading-none tabular-nums", toneClass)}>{value}</span>
      {hint ? (
        <span className="text-muted-foreground text-caption leading-tight">{hint}</span>
      ) : null}
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
        "text-muted-foreground px-4 py-2.5 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase sm:px-6",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

function agingTone(days: number): PillTone {
  if (days >= STALE_DAYS_THRESHOLD) return "critical";
  if (days >= 7) return "caution";
  if (days >= 3) return "pending";
  return "neutral";
}
