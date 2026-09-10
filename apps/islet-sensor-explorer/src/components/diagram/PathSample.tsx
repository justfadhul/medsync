import type { Path } from "@/content/sensor";

import { cn } from "@/lib/cn";
import { LINK_STROKE, pathClass } from "@/lib/graph";

export interface PathSampleProps {
  path: Path;
  className?: string;
}

/**
 * A short line in the colour of one signal path, drawn at the width the maps
 * draw a connector at, so the sample matches the picture.
 *
 * It is decorative on its own: the written label beside it is what carries the
 * meaning, so colour is never the only cue. Every legend, chip and filter uses
 * this one sample rather than drawing its own.
 */
export function PathSample({ path, className }: PathSampleProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 28 8"
      className={cn("h-2 w-7 shrink-0 self-center", className)}
    >
      <line
        x1="1"
        y1="4"
        x2="27"
        y2="4"
        className={pathClass(path).stroke}
        strokeWidth={LINK_STROKE}
        strokeLinecap="round"
      />
    </svg>
  );
}
