import type { Path } from "@/content/sensor";
import type { PathFilter } from "@/store/explorer";
import { useId } from "react";

import { PathSample } from "@/components/diagram/PathSample";
import { Button } from "@/components/ui/Button";
import { PATH_LABELS } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { PATHS } from "@/lib/nodes";

/** Outlined, 1.5px stroke, and the cue that a chip is on without using colour. */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

export interface PartsToolbarProps {
  activePaths: PathFilter;
  onTogglePath: (path: Path) => void;
  onShowAll: () => void;
  className?: string;
}

/**
 * Four toggle chips, one per signal path, and a reset. Turning a chip off dims
 * the parts on that path rather than removing them, so the map never jumps.
 *
 * Each chip carries a tick when it is on, so the state is never held in colour
 * alone, and aria-pressed carries the same fact to a screen reader.
 */
export function PartsToolbar({
  activePaths,
  onTogglePath,
  onShowAll,
  className,
}: PartsToolbarProps) {
  const labelId = `${useId()}-path-filter`;
  const allOn = PATHS.every((path) => activePaths[path]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p id={labelId} className="text-overline text-gray-500 uppercase">
        Filter by signal path
      </p>

      <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-2">
        {PATHS.map((path) => {
          const on = activePaths[path];
          return (
            <button
              key={path}
              type="button"
              aria-pressed={on}
              onClick={() => onTogglePath(path)}
              className={cn(
                "tap text-caption inline-flex items-center gap-2 rounded-sm border px-2.5 py-1.25",
                on
                  ? "border-gray-300 bg-gray-50 text-gray-900"
                  : "bg-card border-gray-200 text-gray-600",
              )}
            >
              <PathSample path={path} />
              {PATH_LABELS[path]}
              <CheckIcon className={cn("size-3.5 shrink-0", on ? "opacity-100" : "opacity-0")} />
            </button>
          );
        })}

        <Button variant="ghost" size="sm" onClick={onShowAll} disabled={allOn}>
          Show all
        </Button>
      </div>
    </div>
  );
}
