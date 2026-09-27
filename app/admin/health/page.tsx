import type { Metadata } from "next";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { ArrowUpRightIcon, ShieldAlertIcon } from "lucide-react";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalApplications } from "@/db/schema/hospital-applications";
import { hospitals } from "@/db/schema/hospitals";
import { saAuditLog } from "@/db/schema/sa-audit-log";
import { saBreakGlassGrants } from "@/db/schema/sa-break-glass-grants";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Health · Superadmin · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Platform health — glanceable strip answering "is the platform okay
 * right now?" Aggregate / operational only; no patient-level data.
 * Tiles are linked: clicking a number jumps to the surface where you
 * can act on it.
 *
 * Full dashboards, Sentry trends, SMS analytics, auto-alerting all
 * deferred per kickoff Area 6.
 */
export default async function HealthPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const service = createServiceClient();
  const { data: rolesData } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  if (!rolesData || rolesData.length === 0) {
    return <div className="mx-auto max-w-2xl px-5 py-12">Admin only.</div>;
  }

  const [[hospitalCounts], pendingAppRows, pendingStaffRows, [auditCounts], activeBreakGlassRows] =
    await Promise.all([
      db
        .select({
          active: sql<number>`count(*) FILTER (WHERE ${hospitals.state} = 'active')::int`,
          pending: sql<number>`count(*) FILTER (WHERE ${hospitals.state} <> 'active')::int`,
        })
        .from(hospitals),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(hospitalApplications)
        .where(eq(hospitalApplications.state, "pending_approval")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(staffAffiliations)
        .where(eq(staffAffiliations.state, "pending_approval")),
      db
        .select({
          last24h: sql<number>`count(*) FILTER (WHERE ${saAuditLog.timestamp} > now() - interval '24 hours')::int`,
          breakGlass: sql<number>`count(*) FILTER (WHERE ${saAuditLog.action} = 'break_glass_open' AND ${saAuditLog.timestamp} > now() - interval '7 days')::int`,
        })
        .from(saAuditLog),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(saBreakGlassGrants)
        .where(
          sql`${saBreakGlassGrants.revokedAt} IS NULL AND ${saBreakGlassGrants.expiresAt} > now()`,
        ),
    ]);

  const tiles: HealthTileData[] = [
    {
      label: "Active tenants",
      value: hospitalCounts?.active ?? 0,
      hint: `${hospitalCounts?.pending ?? 0} not yet active`,
      href: "/admin/tenants",
    },
    {
      label: "Hospital apps pending",
      value: pendingAppRows[0]?.count ?? 0,
      hint: "in your approvals queue",
      href: "/admin?focus=hospital",
    },
    {
      label: "Staff approvals pending",
      value: pendingStaffRows[0]?.count ?? 0,
      hint: "across all hospitals",
      href: "/admin?focus=staff",
    },
    {
      label: "Audit events · 24h",
      value: auditCounts?.last24h ?? 0,
      hint: "all sa_audit_log writes",
      href: `/admin/audit?from=${dateOffset(-1)}`,
    },
    {
      label: "Break-glass · 7d",
      value: auditCounts?.breakGlass ?? 0,
      hint: `${activeBreakGlassRows[0]?.count ?? 0} grants live now`,
      href: "/admin/break-glass",
      sensitive: (auditCounts?.breakGlass ?? 0) > 0 || (activeBreakGlassRows[0]?.count ?? 0) > 0,
    },
  ];

  return (
    <div className="flex flex-col">
      <header className="border-border border-b px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-1">
          <h1 className="font-display text-display-s text-foreground">Platform health</h1>
          <p className="text-muted-foreground text-[13.5px]">
            Aggregate, operational only. Patient-level data never appears here. Sentry counts, SMS-
            delivery analytics, trend charts and auto-alerting ship in a later gate.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <section
          aria-label="Platform health overview"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {tiles.map((t) => (
            <HealthTile key={t.label} {...t} />
          ))}
        </section>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */

interface HealthTileData {
  label: string;
  value: number;
  hint: string;
  href: string;
  sensitive?: boolean;
}

function HealthTile({ label, value, hint, href, sensitive }: HealthTileData) {
  return (
    <Link
      href={href}
      className={cn(
        "group border-border bg-card relative flex flex-col gap-2 rounded-lg border p-5 transition-all outline-none",
        "shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_1px_3px_rgba(0,0,0,0.04)]",
        "hover:border-foreground/15 hover:shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.05)]",
        "focus-visible:ring-ring focus-visible:ring-2",
        sensitive &&
          "border-amber-400/60 bg-amber-50/40 ring-1 ring-amber-500/15 ring-inset dark:border-amber-500/40 dark:bg-amber-950/15",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-muted-foreground font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
          {label}
        </span>
        {sensitive ? (
          <ShieldAlertIcon className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />
        ) : null}
      </div>
      <span className="text-foreground text-display-s leading-none tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      <span className="text-muted-foreground text-[11.5px] leading-relaxed">{hint}</span>
      <ArrowUpRightIcon
        className="text-muted-foreground/40 absolute top-3 right-3 size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </Link>
  );
}

/** ISO YYYY-MM-DD for today + offsetDays. */
function dateOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
