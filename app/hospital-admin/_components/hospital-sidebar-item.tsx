"use client";

import type { FeatureIconKey } from "../_lib/features";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

import { cn } from "@/lib/utils";

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

interface Props {
  href: string;
  label: string;
  iconKey: FeatureIconKey;
  /** Optional badge count (shown only when > 0). */
  badgeCount?: number;
}

export function HospitalSidebarItem({ href, label, iconKey, badgeCount }: Props) {
  const pathname = usePathname();
  // Index route ("/hospital-admin") matches exactly; nested routes
  // match prefix-with-slash so /staff doesn't accidentally light up
  // /staff-something later.
  const isActive =
    href === "/hospital-admin"
      ? pathname === "/hospital-admin"
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
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          isActive ? "text-plum-600" : "text-muted-foreground/80 group-hover:text-foreground",
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
