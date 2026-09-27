import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface SectionNumberProps extends HTMLAttributes<HTMLSpanElement> {
  n: number;
}

/**
 * The bracket number `[01]` that anchors the eye through a dense form. Neutral
 * ink under MedSync Chroma (ADR 0162): place hues belong to the hospital's
 * domains, and a step number is structure, not a place.
 */
export function SectionNumber({ n, className, ...props }: SectionNumberProps) {
  return (
    <span
      data-slot="section-number"
      className={cn(
        "bg-ink-50 text-ink-700 border-ink-200 inline-flex h-[22px] items-center justify-center rounded-xs border px-1.5",
        "font-mono text-[12px] leading-none font-semibold tabular-nums",
        className,
      )}
      {...props}
    >
      [{String(n).padStart(2, "0")}]
    </span>
  );
}
