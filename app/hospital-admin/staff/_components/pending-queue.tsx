"use client";

import type { PendingAffiliationRow } from "../page";
import type { DataTableColumn } from "@/components/ui/data-table";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ClipboardCheckIcon } from "lucide-react";

import { DataTable, DataTableEmpty, Pill } from "@/components/ui/data-table";
import { PendingDetailSheet } from "./pending-detail-sheet";

/**
 * Pending-approval queue — the daily triage surface.
 *
 * Dense table, keyboard-operable, deep-linkable per row via ?aff=…
 * (drives the slide-out). Aging chip surfaces the "this has been
 * sitting too long" cue without dedicating a column — the column for
 * "submitted" carries it as a tone.
 *
 * The Sheet handles its own state but is driven by ?aff= so a fresh
 * navigation (revalidatePath after an approve) drops the operator
 * back to the queue with the panel closed.
 */

interface PendingQueueProps {
  rows: ReadonlyArray<PendingAffiliationRow>;
  /** From ?aff=… — opens the panel for that row when present. */
  selectedAffiliationId: string | null;
}

export function PendingQueue({ rows, selectedAffiliationId }: PendingQueueProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedAffiliationId) ?? null,
    [rows, selectedAffiliationId],
  );

  function openRow(row: PendingAffiliationRow): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set("aff", row.id);
    router.push(`/hospital-admin/staff?${params.toString()}`, { scroll: false });
  }

  function closeSheet(): void {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("aff");
    const qs = params.toString();
    router.push(qs ? `/hospital-admin/staff?${qs}` : `/hospital-admin/staff`, { scroll: false });
  }

  const columns: ReadonlyArray<DataTableColumn<PendingAffiliationRow>> = [
    {
      id: "name",
      header: "Applicant",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate font-medium">{row.fullName}</span>
          <span className="text-muted-foreground text-caption truncate font-mono">{row.email}</span>
        </div>
      ),
    },
    {
      id: "role",
      header: "Claimed role",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate">{row.roleName}</span>
          <span className="text-muted-foreground truncate text-[11.5px]">
            {row.cadreName}
            {row.cadreGradeName ? ` · ${row.cadreGradeName}` : ""}
          </span>
        </div>
      ),
    },
    {
      id: "department",
      header: "Department",
      cell: (row) => <span className="text-foreground truncate">{row.departmentName}</span>,
      hideOnNarrow: true,
    },
    {
      id: "employment",
      header: "Employment",
      cell: (row) => (
        <span className="text-muted-foreground capitalize">
          {row.employmentType.replace(/_/g, " ")}
        </span>
      ),
      hideOnNarrow: true,
    },
    {
      id: "submitted",
      header: "Submitted",
      mono: true,
      cell: (row) => <AgingChip days={row.daysSinceSubmission} />,
    },
    {
      id: "flag",
      header: "",
      cell: (row) =>
        row.reviewNote ? (
          <Pill tone="notice">Info requested</Pill>
        ) : (
          <span className="text-muted-foreground text-caption">—</span>
        ),
    },
  ];

  if (rows.length === 0) {
    return (
      <div className="border-border bg-card flex items-center justify-center rounded-lg border py-16">
        <DataTableEmpty
          title="Nothing pending"
          description="Every applicant has been triaged. New affiliations land here as they submit."
        />
      </div>
    );
  }

  return (
    <>
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        <div className="border-border flex items-center gap-2 border-b px-4 py-2.5 sm:px-6">
          <ClipboardCheckIcon className="text-muted-foreground size-3.5" aria-hidden />
          <span className="text-foreground text-body-s font-medium">Pending triage</span>
          <span className="text-muted-foreground text-caption ml-auto font-mono tabular-nums">
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </span>
        </div>
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(row) => row.id}
          onRowSelect={openRow}
          selectedRowId={selectedAffiliationId}
          caption="Pending staff affiliations"
        />
      </div>

      <PendingDetailSheet
        item={selected}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      />
    </>
  );
}

/* ─── Aging chip ─────────────────────────────────────────────────────
 *
 * Honest relative time with a tone that escalates: green-ish under 3
 * days, neutral under 7, amber at a week, red past two weeks. The
 * thresholds match the superadmin's stale-queue health signal so the
 * cues stay consistent across views.
 */

function AgingChip({ days }: { days: number }) {
  const tone = days >= 14 ? "critical" : days >= 7 ? "caution" : days >= 3 ? "pending" : "neutral";
  const label =
    days <= 0
      ? "today"
      : days === 1
        ? "1 day"
        : days < 30
          ? `${days} days`
          : `${Math.round(days / 7)} wk`;
  return <Pill tone={tone}>{label}</Pill>;
}
