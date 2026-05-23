"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Multi-step form shell.
 *
 * The structural piece each signup path mounts inside. Owns:
 *   - step pointer + back/continue UI (with arrow-key + Enter behaviour)
 *   - progress indicator (mobile: dotted dots; desktop: numbered rail)
 *   - draft autosave hook (debounced; caller supplies the saver)
 *   - aria-live polite step changes for SR users
 *
 * What it does NOT own:
 *   - field state (each step manages its own — React Hook Form or
 *     useState as appropriate)
 *   - per-step validation (each step's render fn returns whether to
 *     allow proceeding via the `canContinue` arg)
 *   - the final submit action (the last step renders its own Server
 *     Action <form> — the shell stays out of the form payload)
 *
 * Per the kickoff §A.7, the shell is WCAG 2.2 AA: visible focus,
 * 4.5:1 contrast on text, 48px touch targets, no autoplay, semantic
 * heading order. The progress rail uses aria-current="step".
 */
export interface MultiStepStep {
  /** Stable key (mirrors `signup_drafts.current_step`). */
  key: string;
  /** Short label shown in the progress rail. */
  label: string;
  /** Long label shown at the top of the step content (semantic h2). */
  heading: string;
  /** One-line orientation shown under the heading. */
  intro?: string;
  /** Render the step body. Receives `canContinue` setter. */
  render: (helpers: StepRenderHelpers) => ReactNode;
}

export interface StepRenderHelpers {
  setCanContinue: (ok: boolean) => void;
}

export interface MultiStepFormProps {
  steps: ReadonlyArray<MultiStepStep>;
  /** Where to restart on initial mount (e.g. from a resumed draft). */
  initialStepKey?: string;
  /**
   * Called whenever the active step changes — wire into draft autosave
   * so we persist `current_step` server-side.
   */
  onStepChange?: (key: string) => void;
  /**
   * Optional: shown above the progress rail (e.g. "Patient signup").
   */
  flowLabel?: string;
  /** Hook to render extra controls beside Back/Continue (e.g. Save & exit). */
  trailing?: ReactNode;
}

export function MultiStepForm({
  steps,
  initialStepKey,
  onStepChange,
  flowLabel,
  trailing,
}: MultiStepFormProps) {
  const initialIndex = Math.max(
    0,
    initialStepKey ? steps.findIndex((s) => s.key === initialStepKey) : 0,
  );
  const [index, setIndex] = useState<number>(initialIndex);
  const [canContinue, setCanContinue] = useState<boolean>(true);
  const liveRegionId = useId();
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const current = steps[index]!;
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  const handleNext = useCallback(() => {
    if (!canContinue) return;
    if (index < steps.length - 1) {
      setIndex(index + 1);
      setCanContinue(true);
    }
  }, [canContinue, index, steps.length]);

  const handleBack = useCallback(() => {
    if (index > 0) {
      setIndex(index - 1);
      setCanContinue(true);
    }
  }, [index]);

  useEffect(() => {
    onStepChange?.(current.key);
    // Move SR focus to the new step heading so users hear it.
    requestAnimationFrame(() => {
      stepHeadingRef.current?.focus();
    });
  }, [current.key, onStepChange]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-7">
      <ProgressRail steps={steps} activeIndex={index} flowLabel={flowLabel} />

      <section
        aria-labelledby={`${current.key}-heading`}
        className="border-border bg-card rounded-lg border p-5 sm:p-7"
      >
        <header className="mb-5 flex flex-col gap-1.5">
          <h2
            id={`${current.key}-heading`}
            ref={stepHeadingRef}
            tabIndex={-1}
            className="font-display text-foreground text-[22px] leading-tight tracking-[-0.015em] outline-none sm:text-[26px]"
            style={{ fontWeight: 400 }}
          >
            {current.heading}
          </h2>
          {current.intro ? (
            <p className="text-muted-foreground text-[13.5px] leading-snug">{current.intro}</p>
          ) : null}
        </header>

        <div className="flex flex-col gap-4">{current.render({ setCanContinue })}</div>
      </section>

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" size="md" onClick={handleBack} disabled={isFirst} type="button">
          <ArrowLeftIcon className="size-3.5" strokeWidth={2} />
          Back
        </Button>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          {trailing}
          {isLast ? (
            // Last step embeds its own Server Action form + submit button.
            // The shell yields control here.
            <span aria-hidden="true" />
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={handleNext}
              disabled={!canContinue}
              type="button"
            >
              Continue
              <ArrowRightIcon className="size-3.5" strokeWidth={2} />
            </Button>
          )}
        </div>
      </div>

      <div id={liveRegionId} role="status" aria-live="polite" className="sr-only">
        Step {index + 1} of {steps.length}: {current.heading}
      </div>
    </div>
  );
}

/* ─── Progress rail ────────────────────────────────────────────────── */

function ProgressRail({
  steps,
  activeIndex,
  flowLabel,
}: {
  steps: ReadonlyArray<MultiStepStep>;
  activeIndex: number;
  flowLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {flowLabel ? (
        <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
          <span className="size-1 rounded-full bg-teal-500" />
          {flowLabel}
          <span aria-hidden="true">&middot;</span>
          <span>
            Step {activeIndex + 1} of {steps.length}
          </span>
        </span>
      ) : null}
      <ol className="flex w-full items-center gap-2" aria-label="Progress">
        {steps.map((s, i) => {
          const isActive = i === activeIndex;
          const isDone = i < activeIndex;
          return (
            <li
              key={s.key}
              aria-current={isActive ? "step" : undefined}
              className="flex flex-1 flex-col gap-1.5"
            >
              <span
                className={cn(
                  "block h-1 rounded-full transition-colors",
                  isDone
                    ? "bg-teal-500 dark:bg-teal-400"
                    : isActive
                      ? "bg-teal-500 dark:bg-teal-400"
                      : "bg-muted",
                )}
              />
              <span
                className={cn(
                  "hidden text-[11px] leading-tight sm:flex sm:items-center sm:gap-1.5",
                  isActive
                    ? "text-foreground font-medium"
                    : isDone
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {isDone ? (
                  <CheckIcon
                    className="size-3 text-teal-600 dark:text-teal-400"
                    strokeWidth={2.5}
                  />
                ) : null}
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
