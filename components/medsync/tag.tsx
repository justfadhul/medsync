import type { Hue } from "@/lib/design/domains";
import type { HTMLAttributes } from "react";

import { HUE } from "@/lib/design/domains";
import { cn } from "@/lib/utils";

export const TAG_BASE =
  "inline-flex h-[22px] w-fit shrink-0 items-center gap-1.5 rounded-sm border pr-2 pl-[7px] text-caption font-medium whitespace-nowrap";

export function tagClass(hue: Hue) {
  return cn(TAG_BASE, HUE[hue].tag);
}

/**
 * A user-defined label (a clinic, a programme, a payer): square corners, a
 * 7px dot and its word, in a cool place hue. Never a clinical state (that is
 * `StatusPill`), and never red, amber or green.
 */
export function Tag({
  hue = "slate",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { hue?: Hue }) {
  return (
    <span data-slot="tag" data-hue={hue} className={cn(tagClass(hue), className)} {...props}>
      <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", HUE[hue].dot)} />
      {children}
    </span>
  );
}
