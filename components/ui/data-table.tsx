"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useRef } from "react";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * DataTable — the workhorse table for the admin workspace.
 *
 * MedSync Chroma's RecordTable (ADR 0162): a sticky 34px header on `muted`
 * in 12/500 `ink-600`, 38px rows (`row-table`) on `ink-150` hairlines with
 * column rules, hover `ink-25`, selected `accent`, mono + tabular-nums for
 * IDs and counts. The table scrolls inside its own frame.
 *
 * Interaction model:
 *   - Row click OR Enter on a focused row → onRowSelect
 *   - ↑/↓ navigate between rows (no auto-open; Enter opens)
 *   - Home / End jump to the first/last row
 *   - Sortable columns own toggle UI; sort state is controlled by
 *     the parent via `sortKey` + `sortDir` + `onSortChange`
 *
 * What's deliberately out of scope (per spec):
 *   - Pagination — admin queues are bounded (LIMIT 50–200);
 *     virtualisation later if a screen ever exceeds that.
 *   - Bulk selection — added in GATE C when applied to People /
 *     Audit. Destructive bulk actions go through four-eyes per spec,
 *     so the toolbar in those routes adds the selection chrome.
 */

export type SortDirection = "asc" | "desc" | null;

export interface DataTableColumn<TRow> {
  /** Stable key for header click + active-sort lookup. */
  id: string;
  /** Visible header text. */
  header: ReactNode;
  /** Cell renderer. Receives the full row. */
  cell: (row: TRow) => ReactNode;
  /** Monospace + tabular-nums — for IDs, counts, timestamps. */
  mono?: boolean;
  /** Show the sort affordance on this column. Parent owns the state. */
  sortable?: boolean;
  /** Optional cell-level className (e.g. column width, alignment). */
  className?: string;
  /** Optional header-level className (alignment etc.). */
  headerClassName?: string;
  /** Hide on narrow viewports — for noise-reducing columns. */
  hideOnNarrow?: boolean;
}

export interface DataTableProps<TRow> {
  data: ReadonlyArray<TRow>;
  columns: ReadonlyArray<DataTableColumn<TRow>>;
  /** Stable row key extractor (used for React key + aria refs). */
  rowKey: (row: TRow) => string;

  /** Currently sorted column id (controlled). */
  sortKey?: string;
  /** Sort direction (controlled). */
  sortDir?: SortDirection;
  /** Called when a sortable column header is clicked. */
  onSortChange?: (id: string, dir: SortDirection) => void;

  /** Row activation — click or Enter on focused row. */
  onRowSelect?: (row: TRow) => void;

  /** Optional currently-selected row id (visual highlight only). */
  selectedRowId?: string | null;

  /** Toolbar — typically counts + filter chips. */
  toolbar?: ReactNode;
  /** Empty-state node (overrides default). */
  empty?: ReactNode;

  /** ARIA caption for screen readers. */
  caption: string;

  className?: string;
  /**
   * Classes for the scrolling wrapper — a `max-h-*` crops a long table to a
   * panel and scrolls it under the sticky header instead of growing the page.
   */
  scrollClassName?: string;
}

export function DataTable<TRow>({
  data,
  columns,
  rowKey,
  sortKey,
  sortDir,
  onSortChange,
  onRowSelect,
  selectedRowId,
  toolbar,
  scrollClassName,
  empty,
  caption,
  className,
}: DataTableProps<TRow>) {
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const handleHeaderClick = useCallback(
    (col: DataTableColumn<TRow>) => {
      if (!col.sortable || !onSortChange) return;
      // Three-state cycle: null → asc → desc → null
      let next: SortDirection;
      if (sortKey !== col.id) next = "asc";
      else if (sortDir === "asc") next = "desc";
      else if (sortDir === "desc") next = null;
      else next = "asc";
      onSortChange(col.id, next);
    },
    [onSortChange, sortDir, sortKey],
  );

  const handleRowKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableRowElement>, row: TRow) => {
      if (!tbodyRef.current) return;
      const rows = Array.from(
        tbodyRef.current.querySelectorAll<HTMLTableRowElement>('tr[data-row="true"]'),
      );
      const current = rows.indexOf(e.currentTarget);

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          rows[Math.min(rows.length - 1, current + 1)]?.focus();
          break;
        case "ArrowUp":
          e.preventDefault();
          rows[Math.max(0, current - 1)]?.focus();
          break;
        case "Home":
          e.preventDefault();
          rows[0]?.focus();
          break;
        case "End":
          e.preventDefault();
          rows[rows.length - 1]?.focus();
          break;
        case "Enter":
        case " ":
          if (onRowSelect) {
            e.preventDefault();
            onRowSelect(row);
          }
          break;
      }
    },
    [onRowSelect],
  );

  return (
    <div className={cn("flex flex-col", className)}>
      {toolbar ? (
        <div className="border-border border-b">
          <div className="px-3 py-2.5">{toolbar}</div>
        </div>
      ) : null}

      <div className={cn("relative overflow-auto", scrollClassName)}>
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>

          {/* Sticky header — 34px on `muted`, 12/500 ink-600 (DESIGN-medsync.md
              § RecordTable). */}
          <thead>
            <tr className="bg-muted sticky top-0 z-10">
              {columns.map((col) => {
                const isSorted = sortKey === col.id && sortDir !== null;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={
                      sortKey === col.id
                        ? sortDir === "asc"
                          ? "ascending"
                          : sortDir === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    className={cn(
                      "text-ink-600 text-caption border-border [&+&]:border-l-ink-150 h-[34px] border-b px-3 font-medium whitespace-nowrap [&+&]:border-l",
                      col.hideOnNarrow && "hidden md:table-cell",
                      col.headerClassName,
                    )}
                  >
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => handleHeaderClick(col)}
                        className={cn(
                          "group inline-flex items-center gap-1 transition-colors outline-none",
                          "focus-visible:text-foreground hover:text-foreground",
                          isSorted && "text-foreground",
                        )}
                      >
                        <span>{col.header}</span>
                        {isSorted ? (
                          sortDir === "asc" ? (
                            <ArrowUpIcon className="size-3" aria-hidden />
                          ) : (
                            <ArrowDownIcon className="size-3" aria-hidden />
                          )
                        ) : (
                          <ArrowUpDownIcon
                            className="size-3 opacity-30 group-hover:opacity-70"
                            aria-hidden
                          />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody ref={tbodyRef}>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-muted-foreground text-body-s px-4 py-16 text-center"
                >
                  {empty ?? "Nothing to show."}
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const key = rowKey(row);
                const isSelected = selectedRowId === key;
                return (
                  <tr
                    key={key}
                    data-row="true"
                    data-selected={isSelected || undefined}
                    // A row is a tab stop only when selecting it does something;
                    // a read-only table's rows are content, not controls.
                    tabIndex={onRowSelect ? 0 : undefined}
                    onClick={onRowSelect ? () => onRowSelect(row) : undefined}
                    onKeyDown={onRowSelect ? (e) => handleRowKeyDown(e, row) : undefined}
                    className={cn(
                      "border-ink-150 border-b transition-colors duration-100 outline-none last:border-b-0",
                      "hover:bg-ink-25 focus-visible:bg-ink-25",
                      "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset",
                      isSelected && "bg-accent hover:bg-accent",
                      onRowSelect && "cursor-pointer",
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={cn(
                          "text-foreground text-body-s [&+&]:border-l-ink-150 h-[38px] px-3 py-1.5 align-middle [&+&]:border-l",
                          col.mono && "font-mono tabular-nums",
                          col.hideOnNarrow && "hidden md:table-cell",
                          col.className,
                        )}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * `Pill` moved to `components/ui/pill.tsx` — a `<span>` with a class map does
 * not need this module's `"use client"`, and Server Components that show a
 * status were pulling the whole sortable table into their bundle to get it.
 * Re-exported here so every existing `from "@/components/ui/data-table"`
 * importer keeps working unchanged; new call sites should import from
 * `@/components/ui/pill` directly.
 */
export { Pill, type PillProps, type PillTone } from "./pill";

/**
 * DataTableEmpty — default empty-state component, slotted into the
 * `empty` prop. Spec: "empty states that explain rather than dead-end."
 */
export interface DataTableEmptyProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function DataTableEmpty({ title, description, action }: DataTableEmptyProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <p className="text-foreground text-heading-s">{title}</p>
      {description ? (
        <p className="text-muted-foreground text-body-s max-w-md">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * DataTableToolbar — header bar slot. Use for filter chips + count.
 * Just lays out children with a sensible default density.
 */
export interface DataTableToolbarProps {
  /** Plain count rendered on the right. */
  count?: number;
  /** Filter chips, search input, etc. */
  children?: ReactNode;
}

export function DataTableToolbar({ count, children }: DataTableToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-1 items-center gap-2 overflow-x-auto">{children}</div>
      {typeof count === "number" ? (
        <span className="text-muted-foreground text-caption shrink-0 font-mono tabular-nums">
          {count} {count === 1 ? "row" : "rows"}
        </span>
      ) : null}
    </div>
  );
}

/**
 * FilterChip — a single toggleable filter. Click to toggle on/off.
 * Used inside DataTableToolbar.
 */
export interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}

export function FilterChip({ active, onClick, children, count }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "text-caption inline-flex h-[26px] items-center gap-1.5 rounded-sm border px-2 font-medium transition-colors duration-100 outline-none",
        "focus-visible:shadow-focus",
        active
          ? "bg-teal-tint text-teal-text border-teal-edge"
          : "bg-card text-ink-600 border-ink-300 shadow-control hover:bg-ink-50 hover:text-foreground",
      )}
    >
      <span>{children}</span>
      {typeof count === "number" ? (
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            active ? "text-teal-text" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
