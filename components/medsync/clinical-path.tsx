import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface ClinicalPathProps extends HTMLAttributes<HTMLElement> {
  /** Path segments rendered between the separator. */
  segments: string[];
  /** Visual separator between segments. */
  separator?: "→" | "⋮" | "·" | "/";
}

export function ClinicalPath({
  segments,
  separator = "→",
  className,
  ...props
}: ClinicalPathProps) {
  return (
    <nav
      data-slot="clinical-path"
      aria-label="Path"
      className={cn(
        "text-ink-600 text-mono-s [&>span:last-child]:text-foreground inline-flex items-center gap-1.5 font-mono leading-none",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="text-muted-foreground">
        /
      </span>
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`} className="inline-flex items-center gap-1.5">
          <span>{segment}</span>
          {index < segments.length - 1 ? (
            <span aria-hidden className="text-muted-foreground">
              {separator}
            </span>
          ) : null}
        </span>
      ))}
    </nav>
  );
}
