"use client";

import type { DataTableColumn } from "@/components/ui/data-table";

import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/pill";

/**
 * The per-line and per-session tables on /hospital-admin/reports. Rows come
 * from the page already formatted — this component owns column layout and
 * the DataTable's keyboard model, nothing else.
 *
 * "Positions not honoured" is the only flag on this surface and it names the
 * line — the facility's promise — never a patient. Amber, with the words:
 * a missed window is an operations problem, not an emergency.
 */

export interface LineRow {
  id: string;
  name: string;
  /** "68%" or "Too few to report". */
  fill: string;
  /** "34 of 50 places" — the basis printed beside the rate. */
  fillBasis: string;
  accuracy: string;
  accuracyBasis: string;
  positionsNotHonoured: boolean;
}

export interface SessionRow {
  id: string;
  name: string;
  when: string;
  accuracy: string;
  accuracyBasis: string;
}

const LINE_COLUMNS: ReadonlyArray<DataTableColumn<LineRow>> = [
  { id: "name", header: "Service line", cell: (r) => r.name },
  {
    id: "fill",
    header: "Fill rate",
    mono: true,
    className: "text-right",
    headerClassName: "text-right",
    cell: (r) => <Basis value={r.fill} basis={r.fillBasis} />,
  },
  {
    id: "accuracy",
    header: "Wait accuracy",
    mono: true,
    className: "text-right",
    headerClassName: "text-right",
    cell: (r) => <Basis value={r.accuracy} basis={r.accuracyBasis} />,
  },
  {
    id: "flag",
    header: "Windows",
    // Never hidden on a narrow screen: it is the one flag this page carries,
    // and the section's sentence counts it.
    cell: (r) =>
      r.positionsNotHonoured ? (
        <Pill tone="notice">Positions not honoured</Pill>
      ) : (
        <span className="text-muted-foreground text-caption">—</span>
      ),
  },
];

const SESSION_COLUMNS: ReadonlyArray<DataTableColumn<SessionRow>> = [
  { id: "name", header: "Clinic day", cell: (r) => r.name },
  { id: "when", header: "Date", mono: true, cell: (r) => r.when },
  {
    id: "accuracy",
    header: "Called in window",
    mono: true,
    className: "text-right",
    headerClassName: "text-right",
    cell: (r) => <Basis value={r.accuracy} basis={r.accuracyBasis} />,
  },
];

function Basis({ value, basis }: { value: string; basis: string }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="text-foreground tabular-nums">{value}</span>
      <span className="text-muted-foreground text-caption font-sans">{basis}</span>
    </span>
  );
}

export function LineTable({ rows }: { rows: ReadonlyArray<LineRow> }) {
  return (
    <DataTable
      data={rows}
      columns={LINE_COLUMNS}
      rowKey={(r) => r.id}
      caption="Fill rate and wait accuracy by service line"
      empty={
        <DataTableEmpty
          title="No clinic days in this window"
          description="Fill rate and wait accuracy need a published clinic day that has ended."
        />
      }
    />
  );
}

export function SessionTable({ rows }: { rows: ReadonlyArray<SessionRow> }) {
  return (
    <DataTable
      data={rows}
      columns={SESSION_COLUMNS}
      rowKey={(r) => r.id}
      caption="Called-in-window share by clinic day, worst first"
      empty={
        <DataTableEmpty
          title="No positions called yet"
          description="A clinic day appears here once the desk has called at least one booked arrival."
        />
      }
    />
  );
}
