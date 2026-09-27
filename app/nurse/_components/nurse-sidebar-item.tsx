"use client";

import type { NurseIconKey } from "../_lib/features";
import type { Domain } from "@/lib/design/domains";
import type { LucideIcon } from "lucide-react";
import {
  ActivityIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  ClipboardPenIcon,
  ClipboardPlusIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  PillIcon,
  RadioIcon,
  ScrollTextIcon,
  SirenIcon,
  UsersIcon,
} from "lucide-react";

import { CommandBar } from "@/components/medsync/command-bar";
import { SidebarNavItem } from "@/components/medsync/sidebar-nav";

const ICONS: Record<NurseIconKey, LucideIcon> = {
  overview: LayoutDashboardIcon,
  incoming: RadioIcon,
  triage: ClipboardPlusIcon,
  resus: SirenIcon,
  patients: UsersIcon,
  observations: HeartPulseIcon,
  mar: PillIcon,
  alerts: ActivityIcon,
  schedule: CalendarClockIcon,
  tasks: CheckSquareIcon,
  handover: ScrollTextIcon,
  assignment_board: ClipboardPenIcon,
  supervisees: GraduationCapIcon,
  cosign_queue: ListChecksIcon,
};

/** Which part of the hospital each item belongs to (ADR 0162); none = neutral. */
const DOMAIN: Partial<Record<NurseIconKey, Domain>> = {
  incoming: "operations",
  triage: "clinical",
  patients: "patients",
  observations: "clinical",
  mar: "pharmacy",
  alerts: "clinical",
  schedule: "operations",
  handover: "clinical",
  assignment_board: "operations",
  supervisees: "clinical",
  cosign_queue: "clinical",
  // resus has no domain hue: it wears the clinical state colours.
};

interface Props {
  href: string;
  label: string;
  iconKey: NurseIconKey;
  placeholder?: boolean;
  exact?: boolean;
}

export function NurseSidebarItem({ href, label, iconKey, placeholder, exact }: Props) {
  return (
    <SidebarNavItem
      href={href}
      label={label}
      icon={ICONS[iconKey]}
      domain={DOMAIN[iconKey]}
      exact={exact}
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
export function NurseCommandBar({
  items,
}: {
  items: ReadonlyArray<{ href: string; label: string; hint?: string; iconKey: NurseIconKey }>;
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
