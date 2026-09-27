"use client";

import type { DoctorIconKey } from "../_lib/features";
import type { Domain } from "@/lib/design/domains";
import type { LucideIcon } from "lucide-react";
import {
  ActivityIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  ClipboardListIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  SirenIcon,
  StethoscopeIcon,
  UsersIcon,
} from "lucide-react";

import { CommandBar } from "@/components/medsync/command-bar";
import { SidebarNavItem } from "@/components/medsync/sidebar-nav";

const ICONS: Record<DoctorIconKey, LucideIcon> = {
  overview: LayoutDashboardIcon,
  patients: UsersIcon,
  alerts: ActivityIcon,
  care_team: ClipboardListIcon,
  schedule: CalendarClockIcon,
  encounters: StethoscopeIcon,
  tasks: CheckSquareIcon,
  supervisees: GraduationCapIcon,
  cosign_queue: ListChecksIcon,
  triage: HeartPulseIcon,
  resus: SirenIcon,
};

/** Which part of the hospital each item belongs to (ADR 0162); none = neutral. */
const DOMAIN: Partial<Record<DoctorIconKey, Domain>> = {
  patients: "patients",
  alerts: "clinical",
  care_team: "clinical",
  schedule: "operations",
  encounters: "clinical",
  supervisees: "clinical",
  cosign_queue: "clinical",
  triage: "clinical",
  // resus has no domain hue: it wears the clinical state colours.
};

interface Props {
  href: string;
  label: string;
  iconKey: DoctorIconKey;
  placeholder?: boolean;
  badgeCount?: number;
  /** Match active on exact href only (used for the index). */
  exact?: boolean;
}

export function DoctorSidebarItem({ href, label, iconKey, placeholder, badgeCount, exact }: Props) {
  return (
    <SidebarNavItem
      href={href}
      label={label}
      icon={ICONS[iconKey]}
      domain={DOMAIN[iconKey]}
      exact={exact}
      count={badgeCount}
      dimmed={placeholder}
      trailing={
        placeholder ? (
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.06em] uppercase">
            soon
          </span>
        ) : null
      }
    />
  );
}

/** The workspace's ⌘K bar: every section, with the sidebar's icons and domains. */
export function DoctorCommandBar({
  items,
}: {
  items: ReadonlyArray<{ href: string; label: string; hint?: string; iconKey: DoctorIconKey }>;
}) {
  return (
    <CommandBar
      entries={items.map((i) => ({
        id: i.href,
        label: i.label,
        hint: i.hint,
        href: i.href,
        icon: ICONS[i.iconKey],
        group: "Navigate",
        domain: DOMAIN[i.iconKey],
      }))}
    />
  );
}
