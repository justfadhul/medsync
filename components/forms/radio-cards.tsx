"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Vertically-stacked radio cards for decisions with weight — typically
 * 2–4 options where each needs an explanation, not just a label.
 *
 * Used for "kind of facility", "is this a referral hospital?",
 * "ownership model" — choices where the user benefits from seeing a
 * description and supporting detail before committing.
 *
 * Distinct from `<SegmentedControl />`:
 *   - SegmentedControl: short, mostly-equivalent options laid out as
 *     pills in a row. The label IS the explanation.
 *   - RadioCards: heavier, requires explanation, vertical, takes more
 *     visual weight on the page.
 */
export interface RadioCardOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  /** Optional small caption above the label (e.g. tag, recommendation). */
  caption?: ReactNode;
  /** Optional icon shown leading the card. */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface RadioCardsProps {
  name: string;
  options: ReadonlyArray<RadioCardOption>;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function RadioCards({
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  invalid,
  disabled,
  className,
  ariaLabel,
}: RadioCardsProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string | undefined>(defaultValue);
  const selected = isControlled ? value : internal;

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      className={cn("flex w-full flex-col gap-2", className)}
    >
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        const isDisabled = disabled || opt.disabled;
        return (
          <label
            key={opt.value}
            className={cn(
              "border-input bg-card text-foreground relative flex cursor-pointer gap-3 rounded-md border p-3.5",
              "ease-expo-out transition-all duration-150 select-none",
              "hover:border-teal-300 hover:bg-teal-50/40 dark:hover:bg-teal-50/10",
              "focus-within:border-teal-500 focus-within:shadow-[0_0_0_2px_rgba(20,184,166,0.15)]",
              "dark:focus-within:border-teal-400 dark:focus-within:shadow-[0_0_0_2px_rgba(45,212,191,0.2)]",
              isSelected && "border-teal-500 bg-teal-50/60 dark:border-teal-400 dark:bg-teal-50/15",
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
            {opt.icon ? (
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                  isSelected
                    ? "bg-teal-500 text-white dark:bg-teal-400 dark:text-gray-900"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {opt.icon}
              </span>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {opt.caption ? (
                <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
                  {opt.caption}
                </span>
              ) : null}
              <span className="text-foreground text-[13.5px] leading-tight font-medium">
                {opt.label}
              </span>
              {opt.description ? (
                <span className="text-muted-foreground text-[12px] leading-snug">
                  {opt.description}
                </span>
              ) : null}
            </div>
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                isSelected
                  ? "border-teal-500 bg-teal-500 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-gray-900"
                  : "border-border bg-card",
              )}
            >
              {isSelected ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
