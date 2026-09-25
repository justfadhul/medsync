import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface SectionNumberProps extends HTMLAttributes<HTMLSpanElement> {
  n: number;
}

export function SectionNumber({ n, className, ...props }: SectionNumberProps) {
  return (
    <span
      data-slot="section-number"
      className={cn(
        "inline-flex items-center justify-center px-2 py-0.5",
        "bg-plum-50 text-plum-700 border-plum-100 border",
        "text-body-s font-mono leading-none font-semibold tabular-nums",
        "rounded-xs",
        className,
      )}
      {...props}
    >
      [{String(n).padStart(2, "0")}]
    </span>
  );
}
