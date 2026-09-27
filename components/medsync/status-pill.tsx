import type { HTMLAttributes, ReactNode } from "react";
import {
  BedIcon,
  CheckIcon,
  CircleDotIcon,
  ClockIcon,
  LogOutIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type ClinicalStatus =
  | "stable"
  | "critical"
  | "caution"
  | "admitted"
  | "discharged"
  | "pending";

/**
 * Critical and caution text use the AA pair (`-fg-aa`, 5.9:1 and 7.1:1 at
 * 12px), adopted with Chroma (ADR 0162); the fills are the carried MedSync
 * status tokens, owned by the Clinical Safety Officer.
 */
const STATUS: Record<ClinicalStatus, { cls: string; icon: ReactNode; word: string }> = {
  stable: { cls: "bg-status-stable-bg text-status-stable-fg", icon: <CheckIcon />, word: "Stable" },
  caution: {
    cls: "bg-status-caution-bg text-status-caution-fg-aa",
    icon: <CircleDotIcon />,
    word: "Caution",
  },
  critical: {
    cls: "bg-status-critical-bg text-status-critical-fg-aa",
    icon: <TriangleAlertIcon />,
    word: "Critical",
  },
  admitted: {
    cls: "bg-status-admitted-bg text-status-admitted-fg",
    icon: <BedIcon />,
    word: "Admitted",
  },
  discharged: {
    cls: "bg-status-discharged-bg text-status-discharged-fg",
    icon: <LogOutIcon />,
    word: "Discharged",
  },
  pending: {
    cls: "bg-status-pending-bg text-status-pending-fg",
    icon: <ClockIcon />,
    word: "Pending",
  },
};

export const STATUS_PILL_BASE =
  "inline-flex h-[22px] w-fit shrink-0 items-center gap-1 rounded-full pr-2 pl-1.5 text-caption font-semibold whitespace-nowrap [&_svg]:size-[13px] [&_svg]:shrink-0 [&_svg]:stroke-2";

export function statusPillClass(status: ClinicalStatus) {
  return cn(STATUS_PILL_BASE, STATUS[status].cls);
}

interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  status: ClinicalStatus;
  /** Replace the state's fixed icon (e.g. a lock for a sensitive record). */
  icon?: ReactNode;
}

/**
 * The clinical state chip: round, with a fixed icon and its word — never a
 * dot, never colour alone. A tag is square with a dot; a status is round with
 * an icon, so the two never rely on hue to be told apart.
 */
export function StatusPill({ status, icon, className, children, ...props }: StatusPillProps) {
  const s = STATUS[status];
  return (
    <span
      data-slot="status-pill"
      data-status={status}
      className={cn(statusPillClass(status), className)}
      {...props}
    >
      <span aria-hidden className="contents">
        {icon ?? s.icon}
      </span>
      {children ?? s.word}
    </span>
  );
}
