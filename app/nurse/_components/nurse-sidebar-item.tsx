"use client";

import type { NurseIconKey } from "../_lib/features";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

import { cn } from "@/lib/utils";

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

interface Props {
  href: string;
  label: string;
  iconKey: NurseIconKey;
  placeholder?: boolean;
  exact?: boolean;
}

export function NurseSidebarItem({ href, label, iconKey, placeholder, exact }: Props) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const Icon = ICONS[iconKey];

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group tap flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors",
        isActive
          ? "bg-plum-50 text-plum-800 ring-plum-600/10 font-medium ring-1 ring-inset"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        placeholder && !isActive && "opacity-70",
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
      {placeholder ? (
        <span className="text-muted-foreground/70 ml-auto font-mono text-[9px] tracking-[0.1em] uppercase">
          soon
        </span>
      ) : isActive ? (
        <span aria-hidden className="scale-in bg-plum-500/80 ml-auto size-1 rounded-full" />
      ) : null}
    </Link>
  );
}
