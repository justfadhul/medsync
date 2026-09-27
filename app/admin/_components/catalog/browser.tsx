"use client";

import type { DataTableColumn } from "@/components/ui/data-table";
import { useMemo, useState } from "react";

import { DataTable, DataTableEmpty, DataTableToolbar } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

/**
 * Catalog browser — segmented sections + a dense DataTable for the
 * selected one. Read-only by design (per kickoff Area 4): role →
 * permission edits are the quietest catastrophic risk in the system
 * and never surface as a UI affordance without the four-eyes safeguard.
 */

export interface CatalogEntry {
  id: string;
  name: string;
  /** Stable code (councils/cadres/roles/specialties); regions/districts may lack one. */
  code?: string;
}

export interface CatalogSection {
  /** URL-safe slug used for the segmented control's stable key. */
  key: string;
  label: string;
  entries: ReadonlyArray<CatalogEntry>;
}

interface BrowserProps {
  sections: ReadonlyArray<CatalogSection>;
}

export function CatalogBrowser({ sections }: BrowserProps) {
  const [active, setActive] = useState<string>(sections[0]?.key ?? "");
  const [query, setQuery] = useState("");

  const current = sections.find((s) => s.key === active) ?? sections[0];

  const filtered = useMemo(() => {
    if (!current) return [];
    const q = query.trim().toLowerCase();
    if (!q) return current.entries;
    return current.entries.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.code ?? "").toLowerCase().includes(q),
    );
  }, [current, query]);

  const columns: ReadonlyArray<DataTableColumn<CatalogEntry>> = useMemo(
    () => [
      {
        id: "name",
        header: "Name",
        cell: (row) => <span className="text-foreground">{row.name}</span>,
      },
      {
        id: "code",
        header: "Code",
        mono: true,
        cell: (row) => <span className="text-muted-foreground">{row.code ?? "—"}</span>,
        className: "w-[180px]",
      },
      {
        id: "id",
        header: "ID",
        mono: true,
        cell: (row) => (
          <span className="text-muted-foreground/70 text-caption">{row.id.slice(0, 8)}…</span>
        ),
        className: "w-[120px]",
        hideOnNarrow: true,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col">
      {/* Segmented control — section switcher */}
      <div
        role="tablist"
        aria-label="Catalog section"
        className="border-border bg-card overflow-x-auto rounded-lg border shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_1px_3px_rgba(0,0,0,0.04)]"
      >
        <div className="flex items-center gap-px p-1">
          {sections.map((s) => (
            <button
              key={s.key}
              role="tab"
              type="button"
              aria-selected={s.key === active}
              tabIndex={s.key === active ? 0 : -1}
              onClick={() => {
                setActive(s.key);
                setQuery("");
              }}
              className={cn(
                "text-body-s shrink-0 rounded-md px-3 py-1.5 font-medium transition-colors outline-none",
                "focus-visible:ring-ring focus-visible:ring-2",
                s.key === active
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="inline-flex items-baseline gap-2">
                <span>{s.label}</span>
                <span
                  className={cn(
                    "font-mono text-[10.5px] tabular-nums",
                    s.key === active
                      ? "text-brand-700/80 dark:text-brand-300/80"
                      : "text-muted-foreground/70",
                  )}
                >
                  {s.entries.length}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Search + table */}
      <div className="border-border bg-card mt-4 overflow-hidden rounded-lg border shadow-[0_0_0_1px_rgba(0,0,0,0.02),0_1px_3px_rgba(0,0,0,0.04)]">
        <DataTable
          caption={current?.label ?? "Catalog"}
          data={filtered}
          columns={columns}
          rowKey={(row) => row.id}
          toolbar={
            <DataTableToolbar count={filtered.length}>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${current?.label.toLowerCase() ?? "rows"}…`}
                className="border-input bg-background focus-visible:border-ring min-w-[200px] rounded-md border px-2.5 py-1 text-[12px] outline-none"
              />
            </DataTableToolbar>
          }
          empty={
            <DataTableEmpty
              title={query ? "No matches." : "Empty section."}
              description={
                query
                  ? "Try a different name or code fragment."
                  : "This catalog section has no rows in the current seed."
              }
            />
          }
        />
      </div>
    </div>
  );
}
