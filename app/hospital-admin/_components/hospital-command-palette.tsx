"use client";

import type { CommandEntry } from "@/components/medsync/command-bar";
import type { Domain } from "@/lib/design/domains";
import type { LucideIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  AlertTriangleIcon,
  BedIcon,
  Building2Icon,
  CalendarClockIcon,
  CalendarPlusIcon,
  FileTextIcon,
  FlaskConicalIcon,
  LayoutDashboardIcon,
  PrinterIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react";

import { CommandBar } from "@/components/medsync/command-bar";
import { hubPaletteEntries } from "../departments/palette-actions";
import { useHospitalScope } from "./scope-provider";

/**
 * ⌘K palette — hospital-admin variant.
 *
 * Nav-only for now (the contract for entity/action search is documented
 * in /docs/hospital-admin-integration-contract.md and will be wired by
 * each feature prompt as it lands). What's already in place:
 *
 *   - Global ⌘K / Ctrl+K binding to open / close.
 *   - Scope marker in the modal header — the operator can never forget
 *     which hospital the palette is acting on.
 *   - Reusable group treatment ("Navigate") with the same Combobox
 *     primitives the superadmin palette uses, so feature prompts can
 *     copy the registration shape.
 *
 * Important: this palette is **scoped** — entries route only to surfaces
 * within /hospital-admin. It must NEVER expose cross-tenant entities
 * (other hospitals, other hospitals' staff). Feature prompts that
 * register entity search MUST pre-scope their fetchers to the current
 * hospital_id from useHospitalScope().
 */

type NavEntry = CommandEntry;

/**
 * Departments & services actions (§5.11). Each routes to the hub's own screen — the palette never
 * performs the action itself, so every safeguard stays with the surface that owns it.
 */
const HUB_ACTIONS: ReadonlyArray<NavEntry> = [
  {
    id: "act-add-clinic",
    group: "Actions",
    label: "Add a clinic",
    hint: "Departments & services · Clinics",
    href: "/hospital-admin/departments/clinics?add=1",
    icon: CalendarPlusIcon,
    domain: "operations",
  },
  {
    id: "act-report",
    group: "Actions",
    label: "Report a problem",
    hint: "Something unavailable — a test, a ward, equipment",
    href: "/hospital-admin/departments/availability?report=1",
    icon: AlertTriangleIcon,
    domain: "operations",
  },
  {
    id: "act-print",
    group: "Actions",
    label: "Print clinic timetable",
    hint: "One A4 landscape page per week",
    href: "/hospital-admin/departments/clinics?view=timetable&print=1",
    icon: PrinterIcon,
    domain: "operations",
  },
  {
    id: "act-head",
    group: "Actions",
    label: "Assign a head of department",
    hint: "Choose the department, then its head",
    href: "/hospital-admin/departments?assign=head",
    icon: UserCheckIcon,
    domain: "operations",
  },
];

const GROUP_ICONS: Record<string, LucideIcon> = {
  Departments: Building2Icon,
  Wards: BedIcon,
  Clinics: StethoscopeIcon,
  Tests: FlaskConicalIcon,
};
const GROUP_ORDER = ["Navigate", "Actions", "Departments", "Wards", "Clinics", "Tests"];

interface HospitalCommandPaletteProps {
  /** Pre-built nav entries from the shell (mirror of FEATURE_AREAS). */
  navEntries: ReadonlyArray<{
    id: string;
    label: string;
    hint: string;
    href: string;
    iconKey: string;
  }>;
}

const PALETTE_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboardIcon,
  staff: UsersIcon,
  departments: Building2Icon,
  scheduling: CalendarClockIcon,
  admins: ShieldCheckIcon,
  audit: ScrollTextIcon,
  profile: FileTextIcon,
};

/** Matches the sidebar's domains (hospital-sidebar-item.tsx). */
const PALETTE_DOMAIN: Record<string, Domain> = {
  staff: "admin",
  departments: "operations",
  scheduling: "operations",
  intake: "operations",
  admins: "admin",
  audit: "admin",
  profile: "admin",
};

export function HospitalCommandPalette({ navEntries }: HospitalCommandPaletteProps) {
  const scope = useHospitalScope();

  const entries: ReadonlyArray<NavEntry> = useMemo(
    () => [
      ...navEntries.map((e) => ({
        id: e.id,
        label: e.label,
        hint: e.hint,
        href: e.href,
        icon: PALETTE_ICONS[e.iconKey] ?? LayoutDashboardIcon,
        group: "Navigate",
        domain: PALETTE_DOMAIN[e.iconKey],
      })),
      ...HUB_ACTIONS,
    ],
    [navEntries],
  );

  // Departments, wards, clinics and tests load once, pre-scoped on the server.
  const loadEntities = useCallback(
    () =>
      hubPaletteEntries().then((rows) =>
        rows.map((r) => ({
          ...r,
          icon: GROUP_ICONS[r.group] ?? LayoutDashboardIcon,
          domain: "operations" as const,
        })),
      ),
    [],
  );

  return (
    <CommandBar
      entries={entries}
      groupOrder={GROUP_ORDER}
      scopeLabel={scope.hospitalName}
      placeholder="Jump to a section, department, ward, clinic or test…"
      loadEntities={loadEntities}
    />
  );
}
