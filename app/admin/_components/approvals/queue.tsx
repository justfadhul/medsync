"use client";

import type { ApprovalItem, ApprovalKind } from "./types";
import type { DataTableColumn, SortDirection } from "@/components/ui/data-table";
import { useCallback, useMemo, useState } from "react";
import { BuildingIcon, UserCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableEmpty,
  DataTableToolbar,
  FilterChip,
  Pill,
} from "@/components/ui/data-table";
import { HOSPITAL_REVIEW } from "@/content/onboarding-hospital";
import { ApprovalDetailSheet } from "./detail-sheet";

/**
 * The Approvals daily queue — unified table of staff affiliations +
 * hospital applications. Row click (or Enter on focus) opens a slide-
 * out detail panel with full evidence + Approve / Reject action footer.
 *
 * Keyboard flow (per craft spec):
 *   - Tab into the table → first row focused
 *   - ↑/↓ to move between rows
 *   - Enter to open the panel
 *   - Esc to close the panel (focus returns to the row)
 *   - Re-press ↓ to advance — triage without the mouse.
 */

interface QueueProps {
  items: ReadonlyArray<ApprovalItem>;
  /** Superadmin sees both queues; hospital_admin only sees staff. */
  canSeeHospitalQueue: boolean;
}

/** Hospital applications split in two (DOC-2): ready for review, or waiting for documents. */
type Filter = "all" | ApprovalKind | NonNullable<ApprovalItem["group"]>;

export function ApprovalsQueue({ items, canSeeHospitalQueue }: QueueProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<string | undefined>("age");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [selected, setSelected] = useState<ApprovalItem | null>(null);

  const staffCount = useMemo(() => items.filter((i) => i.kind === "staff").length, [items]);
  const readyCount = useMemo(() => items.filter((i) => i.group === "ready").length, [items]);
  const waitingCount = useMemo(
    () => items.filter((i) => i.group === "waiting_docs").length,
    [items],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.kind === filter || i.group === filter);
  }, [filter, items]);

  const sorted = useMemo(() => {
    if (!sortKey || sortDir === null) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "age") {
        cmp = new Date(a.createdAtIso).getTime() - new Date(b.createdAtIso).getTime();
      } else if (sortKey === "title") {
        cmp = a.title.localeCompare(b.title);
      } else if (sortKey === "kind") {
        cmp = a.kind.localeCompare(b.kind);
      } else if (sortKey === "subtitle") {
        cmp = a.subtitle.localeCompare(b.subtitle);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const onSortChange = useCallback((id: string, dir: SortDirection) => {
    setSortKey(id);
    setSortDir(dir);
  }, []);

  const columns: ReadonlyArray<DataTableColumn<ApprovalItem>> = useMemo(
    () => [
      {
        id: "kind",
        header: "Type",
        sortable: true,
        cell: (row) => (
          <span className="inline-flex items-center gap-1.5">
            {row.kind === "staff" ? (
              <UserCheckIcon className="text-muted-foreground size-3.5" aria-hidden />
            ) : (
              <BuildingIcon className="text-muted-foreground size-3.5" aria-hidden />
            )}
            <span className="capitalize">{row.kind}</span>
          </span>
        ),
        className: "w-[140px]",
      },
      {
        id: "title",
        header: "Subject",
        sortable: true,
        cell: (row) => <span className="text-foreground font-medium">{row.title}</span>,
      },
      {
        id: "subtitle",
        header: "Context",
        sortable: true,
        cell: (row) => <span className="text-muted-foreground">{row.subtitle}</span>,
        hideOnNarrow: true,
      },
      {
        id: "age",
        header: "Submitted",
        sortable: true,
        mono: true,
        cell: (row) => (
          <span className="text-muted-foreground">{formatRelative(row.createdAtIso)}</span>
        ),
        className: "w-[140px]",
      },
      {
        id: "status",
        header: "Status",
        cell: (row) =>
          row.approveBlocked ? (
            <Pill tone="neutral">{row.approveBlocked}</Pill>
          ) : row.group === "waiting_docs" ? (
            <Pill tone="neutral">{HOSPITAL_REVIEW.waitingDocs}</Pill>
          ) : (
            <Pill tone="notice">{row.group === "ready" ? HOSPITAL_REVIEW.ready : "Pending"}</Pill>
          ),
        className: "w-[180px]",
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col">
      {/* Page header */}
      <header className="border-border border-b px-4 py-6 sm:px-8 sm:py-8">
        <div className="stagger-children mx-auto flex w-full max-w-300 flex-col gap-1.5">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
            <span
              aria-hidden
              className="bg-slate-icon ring-slate-edge size-1 rounded-full ring-2"
            />
            Console · Daily queue
          </span>
          <h1 className="font-display text-display-s text-foreground">Approvals</h1>
          <p className="text-muted-foreground text-[13.5px]">
            {canSeeHospitalQueue
              ? "Triage pending staff affiliations and hospital applications. Open a row to see the evidence and act."
              : "Triage pending staff affiliations for hospitals you administer."}
          </p>
        </div>
      </header>

      {/* Table */}
      <div className="mx-auto w-full max-w-300 flex-1 px-4 sm:px-8">
        <div className="border-border bg-card reveal-up mt-6 overflow-hidden rounded-lg border shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_1px_3px_rgba(0,0,0,0.04)]">
          <DataTable
            caption="Pending approvals"
            data={sorted}
            columns={columns}
            rowKey={(row) => `${row.kind}-${row.id}`}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={onSortChange}
            onRowSelect={(row) => setSelected(row)}
            selectedRowId={selected ? `${selected.kind}-${selected.id}` : null}
            toolbar={
              <DataTableToolbar count={sorted.length}>
                <FilterChip
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                  count={items.length}
                >
                  All
                </FilterChip>
                <FilterChip
                  active={filter === "staff"}
                  onClick={() => setFilter("staff")}
                  count={staffCount}
                >
                  Staff
                </FilterChip>
                {canSeeHospitalQueue ? (
                  <>
                    <FilterChip
                      active={filter === "ready"}
                      onClick={() => setFilter("ready")}
                      count={readyCount}
                    >
                      {HOSPITAL_REVIEW.ready}
                    </FilterChip>
                    <FilterChip
                      active={filter === "waiting_docs"}
                      onClick={() => setFilter("waiting_docs")}
                      count={waitingCount}
                    >
                      {HOSPITAL_REVIEW.waitingDocs}
                    </FilterChip>
                  </>
                ) : null}
              </DataTableToolbar>
            }
            empty={
              <DataTableEmpty
                title={
                  filter === "all"
                    ? "Inbox zero."
                    : `No ${filter === "staff" ? "staff" : "hospital"} approvals here.`
                }
                description="When a new application or affiliation is submitted, it lands here."
                action={
                  filter !== "all" ? (
                    <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                      Show all queues
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </div>

        {/* Footer hint — keyboard nav discoverability */}
        <p className="text-muted-foreground mt-3 text-center font-mono text-[10.5px] tracking-wider">
          ↑↓ navigate · ↵ open · esc close
        </p>
      </div>

      {/* Detail panel */}
      <ApprovalDetailSheet item={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  );
}

/**
 * Compact relative time formatter for the "Submitted" column.
 * Examples: "just now", "12m ago", "3h ago", "5d ago", "12 Apr".
 * Deliberately not Intl.RelativeTimeFormat — that returns "5 days ago"
 * which is too long for a dense table cell.
 */
function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
