import type { SensorStoryStep } from "@/content/sensor";

import { stepPanelId, stepTabId } from "@/components/sensor/step-ids";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export interface StepperProps {
  steps: SensorStoryStep[];
  /** The step showing now, counted from zero. */
  index: number;
  onSelect: (index: number) => void;
  /** Names the tablist for a screen reader, for example "Optical sensor steps". */
  label: string;
  /**
   * Prefix for the tab and panel ids. It must be free of spaces: aria-controls
   * and aria-labelledby take a space-separated list of ids, so an id with a
   * space in it points at nothing. Generate it with useId and pass the same
   * value to the panel.
   */
  idPrefix: string;
  className?: string;
}

/**
 * The four steps of a sensor story, as a tab list.
 *
 * Tabs rather than buttons because that is what this is: one panel at a time,
 * selected from a row of titles. The arrow keys move between them, Home and End
 * jump to the ends, and only the selected tab is in the tab order, which is the
 * pattern a screen reader expects of a tab list.
 */
export function Stepper({ steps, index, onSelect, label, idPrefix, className }: StepperProps) {
  const last = steps.length - 1;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number | undefined> = {
      ArrowRight: Math.min(index + 1, last),
      ArrowDown: Math.min(index + 1, last),
      ArrowLeft: Math.max(index - 1, 0),
      ArrowUp: Math.max(index - 1, 0),
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next);
    const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[next]?.focus();
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-2"
      >
        {steps.map((step, position) => {
          const selected = position === index;
          return (
            <button
              key={step.n}
              type="button"
              role="tab"
              id={stepTabId(idPrefix, step.n)}
              aria-selected={selected}
              aria-controls={stepPanelId(idPrefix, step.n)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(position)}
              className={cn(
                "tap ease-expo-out flex items-baseline gap-2 rounded-md border px-3 py-2 transition-colors duration-150",
                "text-body-s font-medium motion-reduce:transition-none",
                selected
                  ? "ring-ring/40 border-teal-600 bg-teal-50 text-teal-800 ring-2"
                  : "bg-card border-gray-200 text-gray-600 hover:border-teal-100 hover:bg-teal-50",
              )}
            >
              <span className="text-caption tabular font-mono">{step.n}</span>
              {step.title}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSelect(Math.max(index - 1, 0))}
          disabled={index === 0}
          aria-label="Previous step"
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSelect(Math.min(index + 1, last))}
          disabled={index === last}
          aria-label="Next step"
        >
          Next
        </Button>
        <p className="text-caption tabular ml-1 font-mono text-gray-500" role="status">
          Step {index + 1} of {steps.length}
        </p>
      </div>
    </div>
  );
}
