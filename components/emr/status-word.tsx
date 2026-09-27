import type { ReactNode } from "react";
import { CircleIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The EMR's status words (UI-BRIEF §2). Every state is an icon AND a word, never colour alone.
 *
 *  - neutral: record states — draft, signed, completed, died, entered in error;
 *  - caution (amber): awaiting, overdue, unsigned, offline, not recorded, unable to assess;
 *  - critical: ONLY a critical result value, and only when the payload says so (a signed
 *    REF-CRIT entry; none is signed today). This file is the one place in components/emr allowed
 *    to name the critical token (tests/design/red-reserved.test.ts holds that).
 */
export type StatusTone = "neutral" | "caution" | "critical";

const TONE: Record<StatusTone, string> = {
  neutral: "bg-gray-100 text-gray-700",
  // The token pair (#D97706 on #FEF3C7) is 2.8:1 in light, below AA at caption size; amber-800
  // keeps the hue at 7:1. Dark keeps the token (#FCD34D on #451A03 passes).
  caution: "bg-status-caution-bg text-amber-800 dark:text-status-caution-fg",
  // #DC2626 on #FEE2E2 is 3.9:1 at caption size; red-700 keeps the alarm at 5.4:1 in light.
  critical: "bg-status-critical-bg text-red-700 dark:text-status-critical-fg",
};
const ICON = {
  neutral: CircleIcon,
  caution: TriangleAlertIcon,
  critical: OctagonAlertIcon,
} as const;

export function StatusWord({
  tone = "neutral",
  icon = tone !== "neutral",
  className,
  children,
}: {
  tone?: StatusTone;
  /** Neutral words need no glyph; caution and critical always carry one. */
  icon?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const Icon = ICON[tone];
  return (
    <span
      data-tone={tone}
      className={cn(
        "text-caption inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium",
        TONE[tone],
        className,
      )}
    >
      {icon ? <Icon aria-hidden className="size-3 shrink-0" /> : null}
      {children}
    </span>
  );
}

/**
 * A result value in the critical style (DESIGN: red, bold, mono) with the word beside it. Only
 * rendered when the payload's `critical` is true — the caller passes the boolean, never a guess.
 */
export function ResultValueText({
  critical,
  children,
  className,
}: {
  critical: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!critical)
    return <span className={cn("font-mono font-medium tabular-nums", className)}>{children}</span>;
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span className="text-status-critical-fg font-mono font-bold tabular-nums">{children}</span>
      <StatusWord tone="critical">Critical</StatusWord>
    </span>
  );
}
