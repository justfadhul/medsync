"use client";

import type { DataTableColumn } from "@/components/ui/data-table";
import { useState } from "react";
import {
  BedIcon,
  CalendarIcon,
  ChevronUpIcon,
  ClockIcon,
  FlaskConicalIcon,
  InboxIcon,
  KanbanIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  PillIcon,
  ShieldIcon,
  StethoscopeIcon,
  TableIcon,
  UsersIcon,
} from "lucide-react";

import { Avatar } from "@/components/medsync/avatar";
import { CommandBar } from "@/components/medsync/command-bar";
import {
  SidebarGroupLabel,
  SidebarNavItem,
  SidebarSearch,
  SidebarWorkspace,
} from "@/components/medsync/sidebar-nav";
import { Tag } from "@/components/medsync/tag";
import { UnderlineTabs, ViewSwitcher } from "@/components/medsync/view-switcher";
import { DataTable, Pill } from "@/components/ui/data-table";

/** Segmented view switcher + underline tabs, live. */
export function ViewSwitcherDemo() {
  const [view, setView] = useState<"table" | "board" | "calendar">("table");
  const [tab, setTab] = useState<"overview" | "vitals" | "medication" | "notes">("overview");
  return (
    <div className="flex flex-col gap-5">
      <ViewSwitcher
        label="View"
        value={view}
        onChange={setView}
        options={[
          { value: "table", label: "Table", icon: <TableIcon aria-hidden /> },
          { value: "board", label: "Board", icon: <KanbanIcon aria-hidden /> },
          { value: "calendar", label: "Calendar", icon: <CalendarIcon aria-hidden /> },
        ]}
      />
      <UnderlineTabs
        label="Record"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "vitals", label: "Vitals", count: 24 },
          { value: "medication", label: "Medication", count: 5 },
          { value: "notes", label: "Notes" },
        ]}
      />
    </div>
  );
}

interface Row {
  mrn: string;
  initials: string;
  bed: string;
  glucose: number | null;
  status: "caution" | "stable" | "critical" | "pending";
  word: string;
  programme: { word: string; hue: "sky" | "grape" | "iris" };
  taken: string;
}

const ROWS: Row[] = [
  {
    mrn: "MRN-2026-00184",
    initials: "AN",
    bed: "4B-12",
    glucose: 14.2,
    status: "caution",
    word: "Borderline",
    programme: { word: "Diabetes clinic", hue: "sky" },
    taken: "06:12",
  },
  {
    mrn: "MRN-2026-00191",
    initials: "KT",
    bed: "4B-03",
    glucose: 6.1,
    status: "stable",
    word: "Stable",
    programme: { word: "Hypertension clinic", hue: "sky" },
    taken: "06:40",
  },
  {
    mrn: "MRN-2026-00203",
    initials: "OL",
    bed: "4B-07",
    glucose: 22.8,
    status: "critical",
    word: "Critical",
    programme: { word: "Insulin", hue: "grape" },
    taken: "07:05",
  },
  {
    mrn: "MRN-2026-00211",
    initials: "MA",
    bed: "4B-15",
    glucose: null,
    status: "pending",
    word: "Pending",
    programme: { word: "New referral", hue: "iris" },
    taken: "—",
  },
];

const COLUMNS: DataTableColumn<Row>[] = [
  {
    id: "patient",
    header: "Patient",
    cell: (r) => (
      <span className="inline-flex items-center gap-2 font-medium">
        <Avatar name={r.initials.split("").join(" ")} hue="sky" />
        <span className="font-mono tabular-nums">{r.mrn}</span>
      </span>
    ),
  },
  { id: "bed", header: "Bed", mono: true, cell: (r) => r.bed },
  {
    id: "glucose",
    header: "Glucose mmol/L",
    cell: (r) =>
      r.glucose === null ? (
        <span className="font-mono">—</span>
      ) : r.glucose > 10 ? (
        <span className="text-status-critical-fg-aa inline-flex items-center gap-1 font-mono font-bold tabular-nums">
          <ChevronUpIcon aria-hidden className="size-3 stroke-[2.25]" />
          {r.glucose}
          <span className="sr-only">(above target)</span>
        </span>
      ) : (
        <span className="font-mono tabular-nums">{r.glucose}</span>
      ),
  },
  { id: "status", header: "Status", cell: (r) => <Pill tone={r.status}>{r.word}</Pill> },
  {
    id: "programme",
    header: "Programme",
    cell: (r) => <Tag hue={r.programme.hue}>{r.programme.word}</Tag>,
  },
  {
    id: "taken",
    header: "Taken",
    mono: true,
    cell: (r) => <span className="text-muted-foreground">{r.taken}</span>,
  },
];

/** The RecordTable (DataTable) with pills, tags and mono numbers. Illustrative rows. */
export function RecordTableDemo() {
  const [selected, setSelected] = useState<string | null>(ROWS[0]?.mrn ?? null);
  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <DataTable
        caption="Ward 4B glucose — illustrative, no real patients"
        data={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.mrn}
        selectedRowId={selected}
        onRowSelect={(r) => setSelected(r.mrn)}
      />
    </div>
  );
}

/** A working ⌘K bar over the styleguide's own sections. */
export function CommandBarDemo() {
  return (
    <CommandBar
      entries={[
        {
          id: "c",
          label: "Colour",
          hint: "Ink, action, place, signal",
          href: "#colour",
          icon: LayoutDashboardIcon,
          group: "Navigate",
        },
        {
          id: "p",
          label: "Patients",
          hint: "Domain tiles",
          href: "#domains",
          icon: UsersIcon,
          group: "Navigate",
          domain: "patients",
        },
        {
          id: "w",
          label: "Wards",
          hint: "Operations",
          href: "#domains",
          icon: BedIcon,
          group: "Navigate",
          domain: "operations",
        },
        {
          id: "t",
          label: "Record table",
          hint: "Dense lists",
          href: "#records",
          icon: ClockIcon,
          group: "Actions",
          domain: "clinical",
          shortcut: "R",
        },
      ]}
      scopeLabel="Styleguide"
    />
  );
}

/** The workspace sidebar, composed from the shared pieces. */
export function SidebarDemo() {
  return (
    <nav
      aria-label="Sidebar example"
      className="bg-sidebar border-sidebar-border flex w-[248px] flex-col gap-0.5 rounded-lg border p-2"
    >
      <SidebarWorkspace name="Regional referral" sub="Doctor workspace" href="/styleguide" />
      <div className="mb-1.5">
        <SidebarSearch />
      </div>
      <SidebarNavItem href="/styleguide" exact label="Home" icon={LayoutGridIcon} />
      <SidebarNavItem href="/styleguide/inbox" label="Inbox" icon={InboxIcon} count={4} />
      <SidebarGroupLabel>Workspace</SidebarGroupLabel>
      <SidebarNavItem
        href="/styleguide/patients"
        label="Patients"
        icon={UsersIcon}
        domain="patients"
        count={1284}
      />
      <SidebarNavItem
        href="/styleguide/encounters"
        label="Encounters"
        icon={StethoscopeIcon}
        domain="clinical"
        count={37}
      />
      <SidebarNavItem
        href="/styleguide/pharmacy"
        label="Pharmacy"
        icon={PillIcon}
        domain="pharmacy"
      />
      <SidebarNavItem
        href="/styleguide/lab"
        label="Lab results"
        icon={FlaskConicalIcon}
        domain="pharmacy"
        count={12}
      />
      <SidebarNavItem
        href="/styleguide/wards"
        label="Wards"
        icon={BedIcon}
        domain="operations"
        count={2}
        countTone="caution"
        countLabel="2 wards unavailable"
      />
      <SidebarNavItem
        href="/styleguide/schedule"
        label="Schedule"
        icon={CalendarIcon}
        domain="operations"
      />
      <SidebarGroupLabel>Admin</SidebarGroupLabel>
      <SidebarNavItem
        href="/styleguide/staff"
        label="Staff & roles"
        icon={ShieldIcon}
        domain="admin"
      />
    </nav>
  );
}
