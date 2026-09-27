"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CalendarRangeIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Date-range picker — two native `input[type=date]` controls paired
 * with a preset row (Today / 7d / 30d / 90d / All time / Custom).
 *
 * Used heavily in the superadmin audit console where filtering by
 * "recent activity" or "last quarter" is the common case. Native
 * inputs give us mobile date wheels for free and avoid a custom
 * calendar popover (notoriously hard to get accessible right).
 *
 * Values:
 *   - from / to are ISO date strings (YYYY-MM-DD), inclusive.
 *   - "" on either side means open-ended (e.g. no upper bound).
 *   - The hidden form inputs (`<name>_from` / `<name>_to`) post
 *     these values so a surrounding <form> picks them up without
 *     extra plumbing.
 *
 * Submits as two hidden inputs so the action receives string dates
 * unambiguously regardless of the user's locale.
 */
export interface DateRangePickerProps {
  /** Prefix for the hidden form inputs (`<name>_from`, `<name>_to`). */
  name: string;
  defaultFrom?: string;
  defaultTo?: string;
  /** Earliest selectable date. Defaults to undefined (no cap). */
  min?: string;
  /** Latest selectable date. Defaults to today. */
  max?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  /** Receives the current `{ from, to }` ISO strings on every change. */
  onRangeChange?: (range: { from: string; to: string }) => void;
}

type PresetKey = "today" | "7d" | "30d" | "90d" | "all" | "custom";

interface Preset {
  key: PresetKey;
  label: string;
  /** Returns the [from, to] ISO date pair. */
  resolve: () => { from: string; to: string };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const PRESETS: ReadonlyArray<Preset> = [
  { key: "today", label: "Today", resolve: () => ({ from: todayIso(), to: todayIso() }) },
  { key: "7d", label: "Last 7d", resolve: () => ({ from: isoMinusDays(6), to: todayIso() }) },
  { key: "30d", label: "Last 30d", resolve: () => ({ from: isoMinusDays(29), to: todayIso() }) },
  { key: "90d", label: "Last 90d", resolve: () => ({ from: isoMinusDays(89), to: todayIso() }) },
  { key: "all", label: "All time", resolve: () => ({ from: "", to: "" }) },
];

export function DateRangePicker({
  name,
  defaultFrom,
  defaultTo,
  min,
  max,
  disabled,
  invalid,
  className,
  onRangeChange,
}: DateRangePickerProps) {
  const reactId = useId();
  const fromId = `${reactId}-from`;
  const toId = `${reactId}-to`;
  const [from, setFrom] = useState<string>(defaultFrom ?? "");
  const [to, setTo] = useState<string>(defaultTo ?? todayIso());

  const computedMax = max ?? todayIso();

  // Compute which preset (if any) matches the current range so the
  // active button gets highlighted. "custom" wins when nothing else
  // matches.
  const activePreset = useMemo<PresetKey>(() => {
    for (const p of PRESETS) {
      const r = p.resolve();
      if (r.from === from && r.to === to) return p.key;
    }
    return "custom";
  }, [from, to]);

  useEffect(() => {
    onRangeChange?.({ from, to });
  }, [from, to, onRangeChange]);

  const applyPreset = (preset: Preset) => {
    const r = preset.resolve();
    setFrom(r.from);
    setTo(r.to);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Preset row */}
      <div role="radiogroup" aria-label="Date range presets" className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const isActive = activePreset === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => applyPreset(p)}
              disabled={disabled}
              className={cn(
                "rounded-sm border px-2.5 py-1 text-[11.5px] tracking-[0.01em] transition-colors",
                "ease-expo-out duration-150",
                "disabled:pointer-events-none disabled:opacity-50",
                isActive
                  ? "border-brand-500 bg-brand-50/60 text-brand-900 dark:border-brand-400 dark:bg-brand-50/15 dark:text-brand-200"
                  : "border-input bg-card text-muted-foreground hover:text-foreground hover:border-brand-300",
              )}
            >
              {p.label}
            </button>
          );
        })}
        {activePreset === "custom" ? (
          <span
            aria-hidden
            className="text-muted-foreground inline-flex items-center px-2 font-mono text-[10px] tracking-[0.16em] uppercase"
          >
            Custom
          </span>
        ) : null}
      </div>

      {/* Two date inputs */}
      <div
        className={cn(
          "border-input bg-card text-foreground flex w-full items-stretch overflow-hidden rounded-sm border",
          "ease-expo-out transition-all duration-150",
          "focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--teal-tint),0_0_0_1px_var(--ring)]",
          "",
          invalid &&
            "border-destructive bg-alert-bg shadow-[0_0_0_2px_rgba(220,38,38,0.1)] dark:shadow-[0_0_0_2px_rgba(252,165,165,0.1)]",
          disabled && "bg-muted pointer-events-none cursor-not-allowed opacity-50",
        )}
      >
        <label
          htmlFor={fromId}
          className="text-muted-foreground bg-muted/40 border-border flex shrink-0 cursor-pointer items-center border-r px-2.5"
        >
          <CalendarRangeIcon className="size-3.5" strokeWidth={2} />
        </label>
        <input
          id={fromId}
          type="date"
          value={from}
          min={min}
          max={computedMax}
          disabled={disabled}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
          className="text-body-s min-w-0 flex-1 bg-transparent px-2.5 py-2 tabular-nums outline-none"
        />
        <span aria-hidden="true" className="text-muted-foreground flex shrink-0 items-center">
          —
        </span>
        <input
          id={toId}
          type="date"
          value={to}
          min={from || min}
          max={computedMax}
          disabled={disabled}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
          className="text-body-s min-w-0 flex-1 bg-transparent px-2.5 py-2 tabular-nums outline-none"
        />
      </div>

      <input type="hidden" name={`${name}_from`} value={from} />
      <input type="hidden" name={`${name}_to`} value={to} />
    </div>
  );
}
