"use client";

import type { Domain } from "@/lib/design/domains";
import {
  BoxesIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  GaugeIcon,
  KeyIcon,
  MessageSquareTextIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  SirenIcon,
  UserCogIcon,
  UsersRoundIcon,
} from "lucide-react";

import { SidebarNavItem } from "@/components/medsync/sidebar-nav";

/**
 * A single nav row in the sidebar — fully client because it reads
 * pathname for the active state, and because the icon components
 * (lucide-react) can't be serialised from server → client.
 *
 * The parent shell stays server-rendered and passes only primitives:
 * href, label, an `iconKey` string, and optional flags. The icon map
 * lives here so the actual component references never cross the
 * boundary.
 */

export type SidebarIconKey =
  | "approvals"
  | "tenants"
  | "people"
  | "staff-rollup"
  | "scheduling-rollup"
  | "catalog"
  | "audit"
  | "health"
  | "feedback"
  | "emergency"
  | "break-glass";

const ICONS: Record<SidebarIconKey, typeof ClipboardCheckIcon> = {
  approvals: ClipboardCheckIcon,
  tenants: BoxesIcon,
  people: UserCogIcon,
  "staff-rollup": UsersRoundIcon,
  "scheduling-rollup": CalendarClockIcon,
  catalog: KeyIcon,
  emergency: SirenIcon,
  audit: ScrollTextIcon,
  health: GaugeIcon,
  feedback: MessageSquareTextIcon,
  "break-glass": ShieldAlertIcon,
};

/** Which part of the hospital each item belongs to (ADR 0162); none = neutral. */
const DOMAIN: Partial<Record<SidebarIconKey, Domain>> = {
  approvals: "admin",
  tenants: "admin",
  people: "admin",
  "staff-rollup": "admin",
  "scheduling-rollup": "operations",
  catalog: "clinical",
  audit: "admin",
  health: "admin",
  feedback: "admin",
  // emergency and break-glass stay neutral: they are safety surfaces, not places.
};

interface Props {
  href: string;
  label: string;
  iconKey: SidebarIconKey;
  /** Marks the item as a sensitive surface — distinct chip + colour. */
  sensitive?: boolean;
  /** Optional badge count (shown only when > 0). */
  badgeCount?: number;
}

export function AdminSidebarItem({ href, label, iconKey, sensitive, badgeCount }: Props) {
  return (
    <SidebarNavItem
      href={href}
      label={label}
      icon={ICONS[iconKey]}
      domain={DOMAIN[iconKey]}
      exact={href === "/admin"}
      count={badgeCount}
      trailing={
        sensitive ? (
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.06em] uppercase">
            sensitive
          </span>
        ) : null
      }
    />
  );
}
