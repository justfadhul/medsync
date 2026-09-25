import type { Acuity } from "@/lib/workspace/flow";

import { cn } from "@/lib/utils";
import { COLOUR_WORD } from "@/lib/workspace/words";

/**
 * The workspace's one acuity chip: the level and its colour word ("L2
 * Orange"), never colour alone. L1 is the design system's critical pair — red
 * is a clinical signal here (Law 6); every other level keeps its triage colour
 * at chip strength. Untriaged reads "Not triaged" in a quiet outline.
 */
const TONE: Record<Acuity, string> = {
  1: "bg-status-critical-bg text-status-critical-fg",
  2: "bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200",
  3: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950/50 dark:text-yellow-200",
  4: "bg-status-stable-bg text-status-stable-fg",
  5: "bg-sky-100 text-sky-900 dark:bg-sky-950/60 dark:text-sky-200",
};

export function AcuityChip({ level, className }: { level: Acuity | null; className?: string }) {
  if (level === null) {
    return (
      <span
        className={cn(
          "text-caption border-border text-muted-foreground inline-flex h-6 w-22 shrink-0 items-center justify-center rounded-sm border border-dashed",
          className,
        )}
      >
        Not triaged
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-caption inline-flex h-6 w-22 shrink-0 items-center justify-center gap-1 rounded-sm font-mono tabular-nums",
        TONE[level],
        className,
      )}
    >
      <span className="font-semibold">L{level}</span>
      <span className="font-sans">{COLOUR_WORD[level]}</span>
    </span>
  );
}
