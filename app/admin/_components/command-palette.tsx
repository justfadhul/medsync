"use client";

import type { CommandEntry } from "@/components/medsync/command-bar";
import { useCallback, useMemo } from "react";
import {
  BoxesIcon,
  BuildingIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  GaugeIcon,
  KeyIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  UserCogIcon,
  UserIcon,
  UsersRoundIcon,
} from "lucide-react";

import { CommandBar } from "@/components/medsync/command-bar";

/**
 * Command palette — keyboard-first control room entry.
 *
 * GATE C extends GATE A with:
 *   - Entity search (hospitals + users) — passed in from the layout
 *     server-side; filtered client-side as the operator types.
 *   - Same "Sensitive actions" treatment for the Break-glass action.
 *
 * Rendered by the shared Chroma `CommandBar` (ADR 0162): ⌘K / Ctrl+K or
 * the sidebar's search row opens it; entities appear once the operator types.
 */

interface CommandNavItem {
  kind: "nav";
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: typeof ClipboardCheckIcon;
  group: "Navigate" | "Sensitive actions";
  superadminOnly?: boolean;
  sensitive?: boolean;
}

const NAV_ITEMS: ReadonlyArray<CommandNavItem> = [
  {
    kind: "nav",
    id: "nav-approvals",
    label: "Approvals",
    hint: "Triage queue — hospitals, staff, leads",
    href: "/admin",
    icon: ClipboardCheckIcon,
    group: "Navigate",
  },
  {
    kind: "nav",
    id: "nav-tenants",
    label: "Tenants",
    hint: "Hospitals + lifecycle",
    href: "/admin/tenants",
    icon: BoxesIcon,
    group: "Navigate",
    superadminOnly: true,
  },
  {
    kind: "nav",
    id: "nav-people",
    label: "People",
    hint: "Operators + clinicians",
    href: "/admin/people",
    icon: UserCogIcon,
    group: "Navigate",
    superadminOnly: true,
  },
  {
    kind: "nav",
    id: "nav-staff-rollup",
    label: "Staff rollup",
    hint: "Cross-tenant staff totals · stale-queue health",
    href: "/admin/staff-rollup",
    icon: UsersRoundIcon,
    group: "Navigate",
    superadminOnly: true,
  },
  {
    kind: "nav",
    id: "nav-scheduling-rollup",
    label: "Scheduling rollup",
    hint: "Cross-tenant scheduling · urgent · no-shows · stale-pending",
    href: "/admin/scheduling-rollup",
    icon: CalendarClockIcon,
    group: "Navigate",
    superadminOnly: true,
  },
  {
    kind: "nav",
    id: "nav-catalog",
    label: "Catalog",
    hint: "Reference data (read-only)",
    href: "/admin/catalog",
    icon: KeyIcon,
    group: "Navigate",
    superadminOnly: true,
  },
  {
    kind: "nav",
    id: "nav-audit",
    label: "Audit",
    hint: "Activity ledger — exportable",
    href: "/admin/audit",
    icon: ScrollTextIcon,
    group: "Navigate",
    superadminOnly: true,
  },
  {
    kind: "nav",
    id: "nav-health",
    label: "Health",
    hint: "Platform glance",
    href: "/admin/health",
    icon: GaugeIcon,
    group: "Navigate",
  },
  {
    kind: "nav",
    id: "act-break-glass",
    label: "Open break-glass…",
    hint: "Time-boxed PHI grant — notifies hospital admins, fully audited",
    href: "/admin/break-glass",
    icon: ShieldAlertIcon,
    group: "Sensitive actions",
    superadminOnly: true,
    sensitive: true,
  },
];

export interface PaletteHospitalProp {
  id: string;
  name: string;
  slug: string;
  state: string;
}

export interface PalettePersonProp {
  id: string;
  fullName: string;
  email: string;
}

export interface CommandPaletteRootProps {
  isSuperadmin: boolean;
  hospitals: ReadonlyArray<PaletteHospitalProp>;
  people: ReadonlyArray<PalettePersonProp>;
}

export function CommandPaletteRoot({ isSuperadmin, hospitals, people }: CommandPaletteRootProps) {
  const entries: CommandEntry[] = useMemo(
    () =>
      NAV_ITEMS.filter((item) => !item.superadminOnly || isSuperadmin).map((n) => ({
        id: n.id,
        label: n.label,
        hint: n.hint,
        href: n.href,
        icon: n.icon,
        group: n.group,
        domain: n.sensitive ? undefined : "admin",
      })),
    [isSuperadmin],
  );

  // Hospitals and people join the list only once the operator types.
  const loadEntities = useCallback(
    () =>
      Promise.resolve<CommandEntry[]>([
        ...hospitals.map((h) => ({
          id: `h-${h.id}`,
          label: h.name,
          hint: `${h.slug} · ${h.state}`,
          href: `/admin/tenants?focus=${encodeURIComponent(h.id)}`,
          icon: BuildingIcon,
          group: "Hospitals",
          domain: "admin" as const,
        })),
        ...people.map((p) => ({
          id: `p-${p.id}`,
          label: p.fullName,
          hint: p.email,
          href: `/admin/people?q=${encodeURIComponent(p.email)}`,
          icon: UserIcon,
          group: "People",
          domain: "admin" as const,
        })),
      ]),
    [hospitals, people],
  );

  return (
    <CommandBar
      entries={entries}
      groupOrder={["Navigate", "Sensitive actions", "Hospitals", "People"]}
      placeholder="Search sections, hospitals and people…"
      loadEntities={loadEntities}
    />
  );
}
