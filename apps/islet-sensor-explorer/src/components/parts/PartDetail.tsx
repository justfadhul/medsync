import type { Part } from "@/content/sensor";
import type { ReactNode } from "react";

import { nodeTitle, relatedParts } from "@/components/parts/parts-data";
import { PathChip } from "@/components/parts/PathChip";
import { ZONE_LABELS } from "@/content/sensor";
import { cn } from "@/lib/cn";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-overline text-gray-500 uppercase">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

export interface PartDetailProps {
  part: Part;
  /** Selecting a neighbour, so the map can be walked from the written detail. */
  onSelectPart: (id: number) => void;
  className?: string;
}

/**
 * One part written out: where it lives, what it does, what it talks to, what it
 * says and the longer note. The same block serves the panel on a wide screen
 * and the expanded row in the stacked list on a narrow one.
 *
 * Every word comes from the content file. Only the field labels are written
 * here, because the content file holds the values and not their names.
 */
export function PartDetail({ part, onSelectPart, className }: PartDetailProps) {
  const neighbours = relatedParts(part);

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption tabular rounded-xs border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700">
          {part.id}
        </span>
        <span className="text-caption rounded-xs border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-700">
          {ZONE_LABELS[part.zone]}
        </span>
        <PathChip path={part.path} />
      </div>

      <dl className="flex flex-col gap-3">
        <Field label="Lives">
          <span className="text-body-s text-gray-900">{part.lives}</span>
        </Field>

        <Field label="Job">
          <span className="text-body-s text-gray-900">{part.job}</span>
        </Field>

        <Field label="Talks to">
          {neighbours.length === 0 ? (
            <span className="text-body-s text-gray-600">No other part.</span>
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {neighbours.map((other) => (
                <button
                  key={other.id}
                  type="button"
                  onClick={() => onSelectPart(other.id)}
                  aria-label={`Show ${nodeTitle(other)}`}
                  className="tap bg-card text-caption inline-flex items-center gap-1.5 rounded-sm border border-gray-200 px-2 py-1 text-left text-gray-900 hover:border-teal-100 hover:bg-teal-50"
                >
                  <span aria-hidden="true" className="tabular font-mono text-gray-500">
                    {other.id}
                  </span>
                  {other.name}
                </button>
              ))}
            </span>
          )}
        </Field>

        <Field label="Says">
          <span className="text-body-s text-gray-900">{`“${part.says}”`}</span>
        </Field>
      </dl>

      <p className="text-body-s text-gray-600">{part.more}</p>
    </div>
  );
}
