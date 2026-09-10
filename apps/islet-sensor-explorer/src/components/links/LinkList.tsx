import { useEffect, useRef } from "react";

import { FIELD_LABELS, linkKey, nodeLabel } from "@/components/links/labels";
import { Badge } from "@/components/ui/Badge";
import { LINKS, PATH_LABELS } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { pathClass } from "@/lib/graph";
import { PATHS } from "@/lib/nodes";

export interface LinkListProps {
  /** The links of the cadence step that is showing. */
  activeKeys: Set<string>;
  /** The first link of the step, which is the row that is scrolled to. */
  leadKey: string | null;
  /** Changes on every step, so the same row can be scrolled to twice. */
  stepIndex: number;
  reduced: boolean;
  headingId: string;
  className?: string;
}

/**
 * The map, stacked. Below the large breakpoint the picture is replaced by this
 * list: all eighteen links, grouped by signal path, each row carrying from, to,
 * what, how and how often with a written label in front of every field.
 *
 * It is complete, not a summary, and the step that is playing is marked in
 * words as well as by its border.
 */
export function LinkList({
  activeKeys,
  leadKey,
  stepIndex,
  reduced,
  headingId,
  className,
}: LinkListProps) {
  const rows = useRef(new Map<string, HTMLLIElement>());
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!leadKey) return;
    const row = rows.current.get(leadKey);
    // offsetParent is null while the list is the hidden half of the layout, so
    // stepping never scrolls the page when the map is the thing on screen.
    if (!row || row.offsetParent === null) return;
    row.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [leadKey, reduced, stepIndex]);

  return (
    <section aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <h2 id={headingId} className="text-heading-s text-gray-900">
        Every link
      </h2>

      <div className="mt-4 flex flex-col gap-6">
        {PATHS.map((path) => {
          const inPath = LINKS.filter((link) => link.path === path);
          if (inPath.length === 0) return null;
          const groupId = `${headingId}-${path}`;

          return (
            <div key={path}>
              <h3 id={groupId} className="text-overline text-gray-500 uppercase">
                {PATH_LABELS[path]}
              </h3>

              <ul aria-labelledby={groupId} className="mt-2 flex flex-col gap-2">
                {inPath.map((link) => {
                  const key = linkKey(link);
                  const isActive = activeKeys.has(key);

                  return (
                    <li
                      key={key}
                      ref={(element) => {
                        if (element) rows.current.set(key, element);
                        else rows.current.delete(key);
                      }}
                      className={cn(
                        "ease-expo-out rounded-lg border p-4 transition-colors duration-150 motion-reduce:transition-none",
                        // A teal fill would push the path label to teal-800.
                        // The card surface keeps every label on its own rule,
                        // and the written badge carries the state either way.
                        isActive
                          ? "ring-ring/40 bg-card border-teal-600 ring-2"
                          : "border-gray-200 bg-gray-50",
                      )}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-body-s font-medium text-gray-900">
                          {nodeLabel(link.from)} to {nodeLabel(link.to)}
                        </p>
                        {isActive ? <Badge label="Current step" tone="teal" /> : null}
                      </div>

                      <p className={cn("text-caption mt-1", pathClass(link.path).text)}>
                        {PATH_LABELS[link.path]} path
                      </p>

                      <dl className="text-body-s mt-2 flex flex-col gap-1.5">
                        <div>
                          <dt className="text-caption text-gray-500 uppercase">
                            {FIELD_LABELS.what}
                          </dt>
                          <dd className="text-gray-900">{link.what}</dd>
                        </div>
                        <div>
                          <dt className="text-caption text-gray-500 uppercase">
                            {FIELD_LABELS.how}
                          </dt>
                          <dd className="text-gray-900">{link.how}</dd>
                        </div>
                        <div>
                          <dt className="text-caption text-gray-500 uppercase">
                            {FIELD_LABELS.cadence}
                          </dt>
                          <dd className="text-gray-900">{link.cadence}</dd>
                        </div>
                      </dl>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
