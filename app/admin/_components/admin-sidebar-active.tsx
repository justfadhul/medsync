"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BoxesIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  GaugeIcon,
  KeyIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  SirenIcon,
  UserCogIcon,
  UsersRoundIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

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
  "break-glass": ShieldAlertIcon,
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
  const pathname = usePathname();
  const isActive =
    href === "/admin"
      ? pathname === "/admin"
      : pathname === href || pathname.startsWith(`${href}/`);
  const Icon = ICONS[iconKey];

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group tap text-body-s flex items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors outline-none",
        "focus-visible:ring-brand-500/40 focus-visible:ring-2",
        isActive
          ? "bg-plum-50 text-plum-800 ring-plum-600/10 ring-1 ring-inset"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        sensitive &&
          !isActive &&
          "text-amber-700/90 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          isActive ? "text-plum-600" : "text-muted-foreground/80 group-hover:text-foreground",
          sensitive && !isActive && "text-amber-700 dark:text-amber-400",
        )}
        aria-hidden
      />
      <span className="flex-1 truncate font-medium">{label}</span>

      {badgeCount && badgeCount > 0 ? (
        <span
          aria-label={`${badgeCount} pending`}
          className={cn(
            "scale-in rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
            isActive
              ? "bg-brand-600 text-white"
              : "bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-200",
          )}
        >
          {badgeCount}
        </span>
      ) : null}
    </Link>
  );
}
