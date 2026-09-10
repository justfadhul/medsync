import { useId } from "react";

import { PathSample } from "@/components/diagram/PathSample";
import { PATH_LABELS, SAFETY } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { PATHS } from "@/lib/nodes";

export interface PathLegendProps {
  /** The name of the group of entries. Kept as a prop so a screen can retitle it. */
  label?: string;
  className?: string;
}

/**
 * The legend for the four signal paths. Every entry carries its written label
 * beside the line sample, so the colour is never the only cue, and the insulin
 * entry carries the safety line: only the red lines change insulin.
 *
 * The labels come from PATH_LABELS and the colours from PATH_COLOURS, read
 * through pathClass, so a colour or a wording is changed in the content file.
 */
export function PathLegend({ label = "Signal paths", className }: PathLegendProps) {
  // A fresh id per instance, so two legends on one screen stay distinct.
  const labelId = `${useId()}-path-legend`;

  return (
    <div className={cn("min-w-0", className)}>
      <p id={labelId} className="text-overline text-gray-500 uppercase">
        {label}
      </p>

      <ul
        aria-labelledby={labelId}
        className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-2"
      >
        {PATHS.map((path) => {
          const isInsulin = path === "insulin";

          return (
            <li key={path} className="flex items-baseline gap-2">
              <PathSample path={path} />
              <span className="text-body-s text-gray-900">
                <span className={cn(isInsulin && "font-medium")}>{PATH_LABELS[path]}</span>
                {isInsulin ? <span className="text-gray-600"> {SAFETY.onlyRedDoses}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
