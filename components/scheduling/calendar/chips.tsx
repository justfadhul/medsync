import type { Hue, StatusKey } from "./tones";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { HUE, STATUS_TONE } from "./tones";

/**
 * The calendar's two markers. A kind chip is square (a kind of time); a
 * status pill is round (where a booking stands). Both carry an icon and a
 * word, so neither says anything by colour alone.
 */
export function KindChip({
  hue,
  icon: Icon,
  children,
  className,
}: {
  hue: Hue;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-[4px] border px-1.5 text-[11px] leading-none font-medium",
        HUE[hue].chip,
        className,
      )}
    >
      <Icon className={cn("size-3 shrink-0", HUE[hue].icon)} aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function StatusPill({
  status,
  children,
  className,
}: {
  status: StatusKey;
  children: ReactNode;
  className?: string;
}) {
  const tone = STATUS_TONE[status];
  const Icon = tone.icon;
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-full px-2 text-[11px] leading-none font-medium",
        tone.pill,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}
