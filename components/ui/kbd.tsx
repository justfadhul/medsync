import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/** A keyboard hint (⌘K, Esc, ↵) — mono 11/500 on `ink-50` with a hairline edge. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "text-kbd text-ink-600 bg-ink-50 border-ink-200 inline-grid h-[18px] min-w-[18px] place-items-center rounded-xs border px-1 font-mono",
        "in-data-[slot=button]:border-white/20 in-data-[slot=button]:bg-white/15 in-data-[slot=button]:text-current",
        className,
      )}
      {...props}
    />
  );
}
