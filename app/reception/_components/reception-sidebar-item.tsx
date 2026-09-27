"use client";

import type { ReceptionIconKey } from "../_lib/features";
import type { Domain } from "@/lib/design/domains";
import type { LucideIcon } from "lucide-react";
import {
  CalendarPlusIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  RadioIcon,
  SearchIcon,
  UserPlusIcon,
} from "lucide-react";

import { CommandBar } from "@/components/medsync/command-bar";
import { SidebarNavItem } from "@/components/medsync/sidebar-nav";

const ICONS: Record<ReceptionIconKey, LucideIcon> = {
  overview: LayoutDashboardIcon,
  incoming: RadioIcon,
  expected: ClipboardListIcon,
  intake: UserPlusIcon,
  book: CalendarPlusIcon,
  find: SearchIcon,
  flow: ListChecksIcon,
};

/** Which part of the hospital each item belongs to (ADR 0162); none = neutral. */
const DOMAIN: Partial<Record<ReceptionIconKey, Domain>> = {
  incoming: "operations",
  expected: "operations",
  intake: "patients",
  book: "operations",
  find: "patients",
  flow: "operations",
};

interface Props {
  href: string;
  label: string;
  iconKey: ReceptionIconKey;
  exact?: boolean;
}

export function ReceptionSidebarItem({ href, label, iconKey, exact }: Props) {
  return (
    <SidebarNavItem
      href={href}
      label={label}
      icon={ICONS[iconKey]}
      domain={DOMAIN[iconKey]}
      exact={exact}
    />
  );
}

/** The workspace's ⌘K bar: every section, with the sidebar's icons and domains. */
export function ReceptionCommandBar({
  items,
}: {
  items: ReadonlyArray<{ href: string; label: string; hint?: string; iconKey: ReceptionIconKey }>;
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
