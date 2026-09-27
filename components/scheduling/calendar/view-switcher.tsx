"use client";

import type { CalendarView } from "./helpers";
import { CalendarDaysIcon, ColumnsIcon, GridIcon, ListIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Underline tabs for the four calendar views, icon and word. They sit on the
 * control bar's bottom rule; the active tab's teal underline covers it.
 */

const VIEWS: ReadonlyArray<{ key: CalendarView; label: string; icon: typeof CalendarDaysIcon }> = [
  { key: "day", label: "Day", icon: GridIcon },
  { key: "week", label: "Week", icon: ColumnsIcon },
  { key: "month", label: "Month", icon: CalendarDaysIcon },
  { key: "agenda", label: "Agenda", icon: ListIcon },
];

export function CalendarViewSwitcher({
  value,
  onChange,
  allowedViews,
}: {
  value: CalendarView;
  onChange: (next: CalendarView) => void;
  /** Optional whitelist (e.g. hide month on narrow screens). Defaults to all four. */
  allowedViews?: ReadonlyArray<CalendarView>;
}) {
  const items = allowedViews ? VIEWS.filter((v) => allowedViews.includes(v.key)) : VIEWS;

  return (
    <div role="tablist" aria-label="Calendar view" className="-mb-px flex items-stretch gap-1">
      {items.map((v) => {
        const Icon = v.icon;
        const isActive = v.key === value;
        return (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={v.label}
            onClick={() => onChange(v.key)}
            className={cn(
              "ease-expo-out relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium transition-colors duration-150",
              "focus-visible:shadow-focus rounded-t-md focus-visible:outline-none",
              isActive
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{v.label}</span>
          </button>
        );
      })}
    </div>
  );
}
