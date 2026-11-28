import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { CheckIcon, ClockIcon, InfoIcon, SirenIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { FORCED_EDGE, ICON } from "./core";

/**
 * Tags (inventory row 2). `Tag` labels a thing: a place, a count, a category. It never carries health.
 * `StatusTag` is the only part that carries clinical state, and it always shows an icon and a word, so state
 * is never colour alone. Red, amber and green exist in the kit only here, in `tone="danger"` buttons and in
 * the danger dialog.
 */

// Minimum heights, so a long word wraps inside the pill instead of running out of its column: a tag never cuts
// a word, least of all a health word. Type in rem follows the reader's text size. The transparent edge shows
// in forced-colours mode.
const TAG_SIZE = cn(
  "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-[0.8125rem] font-semibold leading-[1.2]",
  "in-data-[density=desk]:min-h-6 in-data-[density=desk]:px-2.5 in-data-[density=desk]:py-0.5 in-data-[density=desk]:text-xs",
  "[&_svg]:size-3.5 [&_svg]:shrink-0 in-data-[density=desk]:[&_svg]:size-3",
  FORCED_EDGE,
);

export type TagTone = "plain" | "accent" | "navy" | "outline";
export type Area = "readings" | "medicines" | "visits" | "team" | "me";

const TAG_TONE: Record<TagTone, string> = {
  plain: "bg-pw-surface-3 text-pw-ink-2",
  accent: "bg-pw-accent-tint text-pw-accent-text",
  navy: "bg-pw-band text-pw-on-band",
  outline: "border-pw-line-strong bg-transparent text-pw-ink",
};

const AREA_DOT: Record<Area, string> = {
  readings: "bg-pw-area-readings",
  medicines: "bg-pw-area-medicines",
  visits: "bg-pw-area-visits",
  team: "bg-pw-area-team",
  me: "bg-pw-area-me",
};

/** A label. `area` adds the place dot: a dot only, never a fill behind the word. */
export function Tag({
  tone = "plain",
  area,
  className,
  children,
  ...rest
}: ComponentProps<"span"> & { tone?: TagTone; area?: Area }) {
  return (
    <span {...rest} className={cn(TAG_SIZE, TAG_TONE[tone], className)}>
      {area ? (
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", AREA_DOT[area])} />
      ) : null}
      {children}
    </span>
  );
}

export type StatusTone = "stable" | "caution" | "critical" | "pending" | "info";

const STATUS: Record<StatusTone, { cls: string; icon: LucideIcon }> = {
  stable: { cls: "bg-pw-stable-tint text-pw-stable-text", icon: CheckIcon },
  caution: { cls: "bg-pw-caution-tint text-pw-caution-text", icon: TriangleAlertIcon },
  critical: { cls: "bg-pw-critical-tint text-pw-critical-text", icon: SirenIcon },
  pending: { cls: "bg-pw-pending-tint text-pw-pending-text", icon: ClockIcon },
  info: { cls: "bg-pw-info-tint text-pw-info-text", icon: InfoIcon },
};

/**
 * Clinical or workflow state, always icon and word. `stable`, `caution` and `critical` are CSO-owned and mean
 * health ("In your range", "Above your target", "Danger"). Waiting, offline and loading are `pending` (grey).
 */
export function StatusTag({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  /** The word. Required: a status is never colour alone. */
  children: string;
  className?: string;
}) {
  const { cls, icon: Icon } = STATUS[tone];
  return (
    <span className={cn(TAG_SIZE, cls, className)}>
      <Icon {...ICON} strokeWidth={2.2} />
      {children}
    </span>
  );
}
