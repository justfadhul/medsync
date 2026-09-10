import type { Path } from "@/content/sensor";

import { PathSample } from "@/components/diagram/PathSample";
import { PATH_LABELS } from "@/content/sensor";
import { cn } from "@/lib/cn";

export interface PathChipProps {
  path: Path;
  className?: string;
}

/**
 * The signal path of one part, as a line sample and its written label. The text
 * stays gray-900 on the card so it reads at AA at every size; the path colour
 * lives in the line, where a 1.5px stroke only has to reach 3:1.
 */
export function PathChip({ path, className }: PathChipProps) {
  return (
    <span
      className={cn(
        "text-caption bg-card inline-flex items-center gap-1.5 rounded-xs border border-gray-200 px-2 py-0.5 text-gray-900",
        className,
      )}
    >
      <PathSample path={path} />
      {PATH_LABELS[path]}
    </span>
  );
}
