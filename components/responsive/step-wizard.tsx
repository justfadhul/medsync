"use client";

import type { ReactNode } from "react";
import { ChevronLeftIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Multi-step form pattern for patient surfaces.
 *
 * On mobile this is the "one decision per screen" wizard from the
 * PRD — single column, back chevron, step indicator, bottom-anchored
 * primary CTA (use <BottomActionBar> for that). On desktop it shows
 * the same single-step-at-a-time view but with more breathing room
 * and the indicator more horizontally.
 *
 * State is owned by the parent (steps are URL-driven typically:
 * /book/reason, /book/clinician, etc., or controlled via React state)
 * — this primitive just renders the chrome.
 *
 * Slots:
 *   <StepWizardShell> wraps the whole experience and renders the
 *     header (back + step indicator) and a slot for the step body.
 *   <StepWizardBody>   the per-step content.
 *
 * Parents render their own primary CTA in a <BottomActionBar> so the
 * action stays thumb-reachable on phones.
 */

interface StepDescriptor {
  id: string;
  label: string;
}

export interface StepWizardShellProps {
  steps: ReadonlyArray<StepDescriptor>;
  currentStepIndex: number;
  /** Called when the user taps the back chevron. Show/hide it by
   * supplying `undefined` (e.g. on the first step). */
  onBack?: () => void;
  /** Title shown above the step body. Often the step label, but
   * parents can override for richer copy. */
  title: string;
  /** Optional subtitle / description under the title. */
  description?: string;
  children: ReactNode;
}

export function StepWizardShell({
  steps,
  currentStepIndex,
  onBack,
  title,
  description,
  children,
}: StepWizardShellProps) {
  return (
    <div className="flex w-full flex-1 flex-col">
      {/* `top-13`: the patient workspace keeps its 52px bar at every width,
          so that is the one sticky offset every surface under it shares. The
          inner column matches the body's so the two never mis-align. */}
      <header className="border-border/70 bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-13 z-10 flex flex-col gap-3 border-b px-4 pt-3 pb-4 supports-backdrop-filter:backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <div className="flex items-center gap-2">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center justify-center rounded-full p-1.5 transition-colors outline-none focus-visible:ring-2"
                aria-label="Back"
              >
                <ChevronLeftIcon className="size-5" aria-hidden />
              </button>
            ) : (
              <span className="size-8" aria-hidden />
            )}
            <StepIndicator steps={steps} currentStepIndex={currentStepIndex} />
          </div>
          <div className="flex flex-col gap-1 px-1">
            <h1 className="font-display text-display-s text-foreground">{title}</h1>
            {description ? (
              <p className="text-muted-foreground text-body-s max-w-xl leading-relaxed">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
        {children}
      </div>
    </div>
  );
}

function StepIndicator({
  steps,
  currentStepIndex,
}: {
  steps: ReadonlyArray<StepDescriptor>;
  currentStepIndex: number;
}) {
  return (
    <div
      role="list"
      aria-label={`Step ${currentStepIndex + 1} of ${steps.length}`}
      className="flex flex-1 items-center gap-1.5"
    >
      {steps.map((step, i) => {
        const done = i < currentStepIndex;
        const current = i === currentStepIndex;
        return (
          <div
            key={step.id}
            role="listitem"
            aria-current={current ? "step" : undefined}
            className="flex flex-1 items-center gap-1.5"
          >
            <span
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                done || current ? "bg-brand-500 dark:bg-brand-400" : "bg-muted",
              )}
            />
          </div>
        );
      })}
      <span
        aria-hidden
        className="text-muted-foreground hidden font-mono text-[10px] tabular-nums sm:inline"
      >
        {currentStepIndex + 1}/{steps.length}
      </span>
    </div>
  );
}
