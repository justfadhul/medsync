"use client";

import { useId, useState } from "react";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Mobile-first date picker.
 *
 * Deliberately a thin wrapper over `<input type="date">` — on mobile
 * Safari and Chrome that input opens the native date wheel, which is
 * the right UX on a phone (large hit targets, scroll wheels, no
 * date-math gymnastics). On desktop it falls back to the browser's
 * picker, which is also fine for our use cases (DOB, registration
 * date, expiry date — single dates, no ranges).
 *
 * We considered a custom calendar popover but: (i) the native control
 * already handles locale formatting and validation; (ii) WCAG date
 * pickers are notoriously hard to get right; (iii) Phase 1 doesn't
 * need date ranges. Revisit if/when we add a date-range need (e.g.
 * shift planning) — that's a different problem and warrants a real
 * popover calendar.
 *
 * What we add over the native input:
 *   - Min/max convenience: pass an absolute date OR a relative offset
 *     (e.g. `maxAge: 120` for DOB sanity).
 *   - Hidden ISO field — the visible input shows the browser's locale
 *     format but submission is always YYYY-MM-DD.
 */
export interface DatePickerProps {
  name: string;
  /** ISO date (YYYY-MM-DD) to pre-populate when resuming a draft. */
  defaultValue?: string;
  /** Earliest allowed date (ISO string). */
  min?: string;
  /** Latest allowed date (ISO string). */
  max?: string;
  /** Convenience: minimum age in years (e.g. 14 → max = today − 14y). */
  minAge?: number;
  /** Convenience: maximum age in years (e.g. 120 → min = today − 120y). */
  maxAge?: number;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
}

function todayMinusYearsIso(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export function DatePicker({
  name,
  defaultValue,
  min,
  max,
  minAge,
  maxAge,
  required,
  disabled,
  invalid,
  id,
  className,
}: DatePickerProps) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const [value, setValue] = useState<string>(defaultValue ?? "");

  const computedMax = max ?? (minAge !== undefined ? todayMinusYearsIso(minAge) : undefined);
  const computedMin = min ?? (maxAge !== undefined ? todayMinusYearsIso(maxAge) : undefined);

  return (
    <div
      className={cn(
        "border-input bg-card text-foreground flex w-full items-stretch overflow-hidden rounded-sm border",
        "ease-expo-out transition-all duration-150",
        "focus-within:border-teal-500 focus-within:shadow-[0_0_0_2px_rgba(20,184,166,0.15)]",
        "dark:focus-within:border-teal-400 dark:focus-within:shadow-[0_0_0_2px_rgba(45,212,191,0.2)]",
        invalid &&
          "border-destructive bg-alert-bg shadow-[0_0_0_2px_rgba(220,38,38,0.1)] dark:shadow-[0_0_0_2px_rgba(252,165,165,0.1)]",
        disabled && "bg-muted pointer-events-none cursor-not-allowed opacity-50",
        className,
      )}
    >
      <label
        htmlFor={inputId}
        className="text-muted-foreground bg-muted/40 border-border flex shrink-0 cursor-pointer items-center border-r px-2.5"
      >
        <CalendarIcon className="size-3.5" strokeWidth={2} />
      </label>
      <input
        id={inputId}
        type="date"
        name={name}
        value={value}
        min={computedMin}
        max={computedMax}
        required={required}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => setValue(e.target.value)}
        className={cn(
          "min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[13px] tabular-nums outline-none",
          "placeholder:text-gray-400 dark:placeholder:text-gray-400",
          // The native ::-webkit-calendar-picker-indicator is hidden because
          // we provide our own affordance (the calendar icon to the left).
          "[&::-webkit-calendar-picker-indicator]:opacity-0",
        )}
      />
    </div>
  );
}
