"use client";

import type { ReceptionIconKey } from "../_lib/features";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarPlusIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  RadioIcon,
  SearchIcon,
  UserPlusIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ICONS: Record<ReceptionIconKey, LucideIcon> = {
  overview: LayoutDashboardIcon,
  incoming: RadioIcon,
  expected: ClipboardListIcon,
  intake: UserPlusIcon,
  book: CalendarPlusIcon,
  find: SearchIcon,
  flow: ListChecksIcon,
};

interface Props {
  href: string;
  label: string;
  iconKey: ReceptionIconKey;
  exact?: boolean;
}

export function ReceptionSidebarItem({ href, label, iconKey, exact }: Props) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const Icon = ICONS[iconKey];

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group tap ease-expo-out text-body-s flex items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors duration-150",
        isActive
          ? "bg-plum-50 text-plum-800 ring-plum-600/10 font-medium ring-1 ring-inset"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 transition-colors duration-150",
          isActive ? "text-plum-600" : "text-muted-foreground/80 group-hover:text-foreground",
        )}
      />
      <span className="truncate">{label}</span>
      {isActive ? (
        <span aria-hidden className="bg-plum-500/80 ml-auto size-1 rounded-full" />
      ) : null}
    </Link>
  );
}
