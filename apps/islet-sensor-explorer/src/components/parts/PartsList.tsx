import type { Part } from "@/content/sensor";
import type { PathFilter } from "@/store/explorer";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useId, useRef } from "react";

import { PathSample } from "@/components/diagram/PathSample";
import { PartDetail } from "@/components/parts/PartDetail";
import { ZONE_GROUPS } from "@/components/parts/parts-data";
import { PATH_LABELS, SAFETY, ZONE_LABELS } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { ALL_NODES } from "@/lib/nodes";

/** Outlined, 1.5px stroke. It turns to point up when the row is open. */
function ChevronIcon({ className }: { className?: string }) {
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
      <path d="M6 9.5 12 15.5 18 9.5" />
    </svg>
  );
}

interface PartRowProps {
  part: Part;
  open: boolean;
  onToggle: () => void;
  onSelectPart: (id: number) => void;
}

function PartRow({ part, open, onToggle, onSelectPart }: PartRowProps) {
  const base = useId();
  const buttonId = `${base}-row`;
  const regionId = `${base}-detail`;
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes an open row from anywhere inside it, and puts the reader back
  // on the control that opened it.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key !== "Escape" && event.key !== "Esc") return;
    event.preventDefault();
    onToggle();
    buttonRef.current?.focus();
  };

  return (
    <li>
      <div className="bg-card rounded-lg border border-gray-200" onKeyDown={handleKeyDown}>
        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={onToggle}
          className="tap flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left"
        >
          <span className="text-caption tabular mt-0.5 shrink-0 rounded-xs border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700">
            {part.id}
          </span>

          <span className="min-w-0 flex-1">
            <span className="text-body-m block font-medium text-gray-900">{part.name}</span>
            <span className="text-caption mt-1 flex items-center gap-1.5 text-gray-600">
              <PathSample path={part.path} />
              {PATH_LABELS[part.path]}
            </span>
          </span>

          <ChevronIcon
            className={cn(
              "ease-expo-out mt-1 size-4 shrink-0 text-gray-500 transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>

        <div
          id={regionId}
          role="region"
          aria-labelledby={buttonId}
          hidden={!open}
          className="border-t border-gray-200 px-4 py-4"
        >
          <PartDetail part={part} onSelectPart={onSelectPart} />
        </div>
      </div>
    </li>
  );
}

export interface PartsListProps {
  selectedId: number | null;
  activePaths: PathFilter;
  onToggleNode: (id: number) => void;
  onSelectPart: (id: number) => void;
  className?: string;
}

/**
 * The map, written as a list, for the widths where a dense diagram cannot be
 * read. It carries the whole of the map and the whole of the panel: the same
 * zones, the same parts and, when a row is open, the same detail.
 *
 * The filter narrows this list rather than dimming it, because a dimmed row is
 * still a row a thumb can reach, and the count says what is missing.
 */
export function PartsList({
  selectedId,
  activePaths,
  onToggleNode,
  onSelectPart,
  className,
}: PartsListProps) {
  const headingBase = useId();
  const shown = ALL_NODES.filter((node) => activePaths[node.path]).length;
  const hidden = ALL_NODES.length - shown;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <p role="status" className="text-body-s text-gray-600">
        {hidden === 0
          ? "Every part is showing."
          : `${hidden} ${hidden === 1 ? "part is" : "parts are"} hidden by the filter.`}
      </p>

      {ZONE_GROUPS.map((group, index) => {
        const headingId = `${headingBase}-${index}`;
        const nodes = group.nodes.filter((node) => activePaths[node.path]);

        return (
          <section key={group.zone} aria-labelledby={headingId}>
            <h2 id={headingId} className="text-heading-s text-gray-900">
              {ZONE_LABELS[group.zone]}
            </h2>

            {group.zone === "outside" ? (
              <p className="text-body-s mt-1 text-gray-600">{SAFETY.noOutsideDosing}</p>
            ) : null}

            {nodes.length === 0 ? (
              <p className="text-body-s mt-3 text-gray-600">
                Every part in this zone is hidden by the filter.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {nodes.map((part) => (
                  <PartRow
                    key={part.id}
                    part={part}
                    open={part.id === selectedId}
                    onToggle={() => onToggleNode(part.id)}
                    onSelectPart={onSelectPart}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
