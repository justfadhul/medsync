"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Chroma's view switcher: a segmented control on an `ink-100` track whose
 * "on" option sits on `card` with `shadow-control`. Selection here is
 * structural, not an action — never teal.
 */
export function ViewSwitcher<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: ReactNode; icon?: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("bg-ink-100 inline-flex gap-0.5 rounded-md p-0.5", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "text-caption inline-flex h-[26px] items-center gap-1.5 rounded-sm px-2.5 font-medium transition-colors duration-100",
              "[&_svg]:size-[13px]",
              on ? "bg-card text-foreground shadow-control" : "text-ink-600 hover:text-foreground",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Underline tabs that split a record page; the on tab takes a 2px `foreground` underline. */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: ReadonlyArray<{ value: T; label: ReactNode; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("border-border flex gap-4 border-b", className)}
    >
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cn(
              "text-label -mb-px inline-flex items-center gap-1.5 border-b-2 px-0.5 pb-2.5",
              on
                ? "text-foreground border-foreground"
                : "text-ink-600 hover:text-foreground border-transparent",
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
