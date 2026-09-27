"use client";

import type { FeatureIconKey } from "../_lib/features";
import type { Domain } from "@/lib/design/domains";
import {
  BarChart3Icon,
  Building2Icon,
  CalendarClockIcon,
  DoorOpenIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";

import { SidebarNavItem } from "@/components/medsync/sidebar-nav";

/**
 * Sidebar row for the hospital-admin shell. Same architecture as the
 * superadmin's AdminSidebarItem (server passes primitives, this client
 * component resolves icons + the active state from pathname). Lives
 * in the hospital-admin tree so the icon map can stay scoped to this
 * workspace's vocabulary — no shared union that two unrelated shells
 * have to keep in sync.
 */

const ICONS: Record<FeatureIconKey, typeof LayoutDashboardIcon> = {
  overview: LayoutDashboardIcon,
  reports: BarChart3Icon,
  staff: UsersIcon,
  departments: Building2Icon,
  scheduling: CalendarClockIcon,
  intake: DoorOpenIcon,
  admins: ShieldCheckIcon,
  audit: ScrollTextIcon,
  profile: FileTextIcon,
};

/** Which part of the hospital each item belongs to (ADR 0162); none = neutral. */
const DOMAIN: Partial<Record<FeatureIconKey, Domain>> = {
  staff: "admin",
  departments: "operations",
  scheduling: "operations",
  intake: "operations",
  admins: "admin",
  audit: "admin",
  profile: "admin",
};

interface Props {
  href: string;
  label: string;
  iconKey: FeatureIconKey;
  /** Optional badge count (shown only when > 0). */
  badgeCount?: number;
  /** "caution" = something is wrong (amber, with its icon and words); default = waiting for you. */
  badgeTone?: "brand" | "caution";
  /** What the count means, for screen readers ("2 services unavailable"). */
  badgeLabel?: string;
}

export function HospitalSidebarItem({
  href,
  label,
  iconKey,
  badgeCount,
  badgeTone = "brand",
  badgeLabel,
  onNavigate,
}: Props & { onNavigate?: () => void }) {
  return (
    <SidebarNavItem
      href={href}
      label={label}
      icon={ICONS[iconKey]}
      domain={DOMAIN[iconKey]}
      exact={href === "/hospital-admin"}
      count={badgeCount}
      countLabel={badgeLabel}
      countTone={badgeTone === "caution" ? "caution" : "neutral"}
      onNavigate={onNavigate}
    />
  );
}
