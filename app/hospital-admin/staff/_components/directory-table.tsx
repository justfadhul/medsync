"use client";

import type {
  DirectoryAffiliationRow,
  DirectoryDepartmentOption,
  DirectoryRoleOption,
} from "../page";
import type { DataTableColumn, PillTone } from "@/components/ui/data-table";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { UsersIcon } from "lucide-react";

import {
  DataTable,
  DataTableEmpty,
  DataTableToolbar,
  FilterChip,
  Pill,
} from "@/components/ui/data-table";
import { DirectoryDetailSheet } from "./directory-detail-sheet";

/**
 * Staff directory — every active, suspended, or deactivated affiliation
 * at THIS hospital, in one filterable table.
 *
 * Filter chips:
 *   - Status: active / suspended / deactivated (multi-select)
 *   - Department: pick one
 *
 * Council registration numbers are stored plaintext (operational
 * lookup) but rendered masked-until-expanded in the table — the
 * panel exposes them in full.
 */

// Workflow states are tags, never a patient's clinical colours (ADR 0162).
const STATUS_TONES: Record<string, PillTone> = {
  active: "active",
  approved: "active",
  suspended: "notice",
  deactivated: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  approved: "Active",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

const STATUS_FILTERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "active", label: "Active" },
  { id: "suspended", label: "Suspended" },
  { id: "deactivated", label: "Deactivated" },
];

interface DirectoryTableProps {
  rows: ReadonlyArray<DirectoryAffiliationRow>;
  selectedAffiliationId: string | null;
  allDepartments: ReadonlyArray<DirectoryDepartmentOption>;
  allRoles: ReadonlyArray<DirectoryRoleOption>;
}

export function DirectoryTable({
  rows,
  selectedAffiliationId,
  allDepartments,
  allRoles,
}: DirectoryTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set());
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      // Status filter — "active" chip matches both 'active' and 'approved'.
      if (statusFilters.size > 0) {
        const bucket = r.state === "approved" ? "active" : r.state;
        if (!statusFilters.has(bucket)) return false;
      }
      if (departmentFilter && r.departmentId !== departmentFilter) return false;
      if (query) {
        const q = query.trim().toLowerCase();
        const hay =
          `${r.fullName} ${r.email} ${r.roleName} ${r.departmentName} ${r.cadreName} ${r.registrationNumber}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilters, departmentFilter, query]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedAffiliationId) ?? null,
    [rows, selectedAffiliationId],
  );

  function openRow(row: DirectoryAffiliationRow): void {
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

  function toggleStatus(id: string): void {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const columns: ReadonlyArray<DataTableColumn<DirectoryAffiliationRow>> = [
    {
      id: "name",
      header: "Staff",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate font-medium">{row.fullName}</span>
          <span className="text-muted-foreground text-caption truncate font-mono">{row.email}</span>
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate">{row.roleName}</span>
          <span className="text-muted-foreground truncate text-[11.5px]">{row.cadreName}</span>
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
      id: "council",
      header: "Council #",
      mono: true,
      cell: (row) => (
        <MaskedReg registrationNumber={row.registrationNumber} councilName={row.councilName} />
      ),
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
      id: "status",
      header: "Status",
      cell: (row) => (
        <Pill tone={STATUS_TONES[row.state] ?? "neutral"}>
          {STATUS_LABEL[row.state] ?? row.state}
        </Pill>
      ),
    },
  ];

  if (rows.length === 0) {
    return (
      <div className="border-border bg-card flex items-center justify-center rounded-lg border py-16">
        <DataTableEmpty
          title="No staff on file yet"
          description="Approved staff land here. New affiliations live under Pending until you triage them."
        />
      </div>
    );
  }

  return (
    <>
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        <DataTable
          data={filtered}
          columns={columns}
          rowKey={(row) => row.id}
          onRowSelect={openRow}
          selectedRowId={selectedAffiliationId}
          caption="Hospital staff directory"
          toolbar={
            <DataTableToolbar count={filtered.length}>
              <UsersIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              <input
                type="search"
                placeholder="Search staff, role, council #…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search the staff directory"
                className="text-foreground placeholder:text-muted-foreground border-border focus-visible:ring-ring w-64 max-w-full rounded-md border bg-transparent px-2.5 py-1 text-[12.5px] outline-none focus-visible:ring-2"
              />
              <div className="ml-2 flex items-center gap-1.5">
                {STATUS_FILTERS.map((s) => (
                  <FilterChip
                    key={s.id}
                    active={statusFilters.has(s.id)}
                    onClick={() => toggleStatus(s.id)}
                  >
                    {s.label}
                  </FilterChip>
                ))}
              </div>
              <select
                aria-label="Filter by department"
                value={departmentFilter ?? ""}
                onChange={(e) => setDepartmentFilter(e.target.value || null)}
                className="border-border text-foreground focus-visible:ring-ring rounded-md border bg-transparent px-2 py-1 text-[12px] outline-none focus-visible:ring-2"
              >
                <option value="">All departments</option>
                {allDepartments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </DataTableToolbar>
          }
        />
      </div>

      <DirectoryDetailSheet
        item={selected}
        roleCatalog={allRoles}
        departmentCatalog={allDepartments}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      />
    </>
  );
}

/* ─── Masked council number ────────────────────────────────────────── */

function MaskedReg({
  registrationNumber,
  councilName,
}: {
  registrationNumber: string;
  councilName: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const masked =
    registrationNumber.length > 4
      ? `${registrationNumber.slice(0, 2)}••${registrationNumber.slice(-2)}`
      : "••••";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setRevealed((v) => !v);
      }}
      title={revealed ? "Click to hide" : `${councilName} · click to reveal`}
      className="text-muted-foreground hover:text-foreground inline-flex items-baseline gap-1 transition-colors"
    >
      <span className="font-mono tabular-nums">{revealed ? registrationNumber : masked}</span>
    </button>
  );
}
