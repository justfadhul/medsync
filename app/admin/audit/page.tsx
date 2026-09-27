import type { AuditRow as AuditTableRow } from "../_components/audit/types";
import type { AuditFiltersState } from "./_components/filters";
import type { Metadata } from "next";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { db } from "@/db";
import { saAuditLog } from "@/db/schema/sa-audit-log";
import { users } from "@/db/schema/users";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AuditTable } from "../_components/audit/table";
import { AuditExportButton } from "./_components/export-button";
import { AuditFilters } from "./_components/filters";

export const metadata: Metadata = {
  title: "Audit · Superadmin · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface SearchParams {
  from?: string;
  to?: string;
  actor?: string;
  action?: string;
  target?: string;
}

const PAGE_LIMIT = 200;

/**
 * Audit console. Server runs the filtered query (URL-driven), then
 * hands rows to the client AuditTable + slide-out row detail.
 *
 * URL params drive the filter so the console URL is shareable and
 * the back button works.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const service = createServiceClient();
  const { data: rolesData } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  const isSuperadmin = !!rolesData?.some((r) => r.role === "superadmin");
  if (!isSuperadmin) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <h1 className="text-foreground text-xl">Superadmin only.</h1>
      </div>
    );
  }

  const wheres = [];
  if (sp.from) wheres.push(gte(saAuditLog.timestamp, new Date(`${sp.from}T00:00:00Z`)));
  if (sp.to) wheres.push(lt(saAuditLog.timestamp, new Date(`${sp.to}T23:59:59.999Z`)));
  if (sp.actor && /^[0-9a-f-]{36}$/i.test(sp.actor)) {
    wheres.push(eq(saAuditLog.actorId, sp.actor));
  }
  if (sp.action) wheres.push(eq(saAuditLog.action, sp.action));
  if (sp.target) wheres.push(eq(saAuditLog.targetKind, sp.target));

  const rows = await db
    .select()
    .from(saAuditLog)
    .where(wheres.length === 0 ? undefined : wheres.length === 1 ? wheres[0] : and(...wheres))
    .orderBy(desc(saAuditLog.timestamp))
    .limit(PAGE_LIMIT);

  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const actorRows =
    actorIds.length > 0
      ? await db
          .select({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
          })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];
  const actorById = new Map(actorRows.map((u) => [u.id, u]));

  const initialFilters: AuditFiltersState = {
    from: sp.from ?? "",
    to: sp.to ?? "",
    actor: sp.actor ?? "",
    action: sp.action ?? "",
    target: sp.target ?? "",
  };

  const tableRows: AuditTableRow[] = rows.map((r) => {
    const actor = actorById.get(r.actorId);
    return {
      id: String(r.id),
      timestampIso: r.timestamp.toISOString(),
      action: r.action,
      targetKind: r.targetKind,
      targetId: r.targetId,
      reason: r.reason,
      actorId: r.actorId,
      actorEmail: actor?.email ?? null,
      actorFullName: actor?.fullName ?? null,
      requestId: r.requestId ?? null,
      ipAddress: r.ipAddress ?? null,
      userAgent: r.userAgent ?? null,
    };
  });

  return (
    <div className="flex flex-col">
      <header className="border-border border-b px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-300 flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
                <span
                  aria-hidden
                  className="bg-slate-icon ring-slate-edge size-1 rounded-full ring-2"
                />
                Console · Immutable ledger
              </span>
              <h1 className="font-display text-display-s text-foreground">Audit console</h1>
              <p className="text-muted-foreground text-[13.5px]">
                Every superadmin action is recorded. Break-glass and four-eyes events are
                highlighted. Export is itself an audited action.
              </p>
            </div>
            <AuditExportButton currentFilters={initialFilters} />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-300 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-4">
          <AuditFilters initial={initialFilters} />
        </div>

        <AuditTable rows={tableRows} cappedAt={PAGE_LIMIT} />
      </div>
    </div>
  );
}
