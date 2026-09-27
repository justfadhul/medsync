"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Single-select segmented control — short, mutually-exclusive lists
 * (≤ ~5 items) where typing makes no sense.
 *
 * Examples from the onboarding flows:
 *   - sex_at_birth: male | female | intersex | prefer_not_say
 *   - facility_level: HC II | HC III | HC IV | hospital | national
 *   - shift: day | night | both
 *
 * Built directly with native radio inputs (no base-ui dependency)
 * because the styling needs are simple and the visual is a row of
 * pill buttons, not a list. Each option submits via the radio's
 * native form behaviour, and arrow-key navigation comes for free
 * via the `radiogroup` role.
 */
export interface SegmentedOption {
  value: string;
  label: ReactNode;
  /** Optional supporting line shown below the label. */
  description?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  name: string;
  options: ReadonlyArray<SegmentedOption>;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Stack as a single column on small screens (default: true). */
  stackOnMobile?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function SegmentedControl({
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  stackOnMobile = true,
  invalid,
  disabled,
  className,
  ariaLabel,
}: SegmentedControlProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string | undefined>(defaultValue);
  const selected = isControlled ? value : internal;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      className={cn(
        "flex w-full gap-1.5",
        stackOnMobile ? "flex-col sm:flex-row sm:flex-wrap" : "flex-row flex-wrap",
        className,
      )}
    >
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        const isDisabled = disabled || opt.disabled;
        return (
          <label
            key={opt.value}
            className={cn(
              "border-input bg-card text-foreground text-body-s flex-1 cursor-pointer rounded-sm border px-3 py-2",
              "ease-expo-out transition-all duration-150 select-none",
              "hover:border-brand-300 hover:bg-ink-25",
              "focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--teal-tint),0_0_0_1px_var(--ring)]",
              "",
              isSelected &&
                "border-brand-500 bg-brand-50/60 dark:border-brand-400 dark:bg-brand-50/15",
              invalid && !isSelected && "border-destructive bg-alert-bg",
              isDisabled && "pointer-events-none cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={isSelected}
              disabled={isDisabled}
              onChange={(e) => {
                if (!isControlled) setInternal(e.target.value);
                onValueChange?.(e.target.value);
              }}
              className="sr-only"
            />
            <span className="block font-medium">{opt.label}</span>
            {opt.description ? (
              <span className="text-muted-foreground mt-0.5 block text-[11.5px] leading-snug">
                {opt.description}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
