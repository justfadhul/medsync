"use client";

import type { ReactNode } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Searchable single-select combobox, the workhorse of selection-over-typing.
 *
 * Built on base-ui Combobox — gives us virtualized lists, async filter,
 * keyboard a11y, and a hidden native input (via `name` on Root) so the
 * selected value submits with any surrounding `<form>` without extra
 * plumbing.
 *
 * Items can be a flat list or pre-grouped. For cascading flows
 * (district → subcounty, council → cadre) compose this with
 * `<CascadingCombobox />` rather than mutating items in-place.
 *
 * Item shape `{ value, label, searchText? }` lets you keep the visible
 * label compact while still searching against synonyms / abbreviations
 * (e.g. "MOH" matches "Ministry of Health"). When `searchText` is
 * omitted the filter runs against `label`.
 */
export interface ComboboxItem {
  value: string;
  label: string;
  /** Optional extra text to match against (synonyms, codes, abbreviations). */
  searchText?: string;
}

export interface ComboboxProps {
  name: string;
  items: ReadonlyArray<ComboboxItem>;
  placeholder?: string;
  emptyText?: string;
  /** Controlled value (string). Defaults to uncontrolled. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | null) => void;
  disabled?: boolean;
  /** Forces invalid styling — used when a parent passes a serverError. */
  invalid?: boolean;
  className?: string;
  /** Extra HTML id for screenreader association (label htmlFor). */
  id?: string;
  /** Renders a leading icon inside the input (defaults to search). */
  leadingIcon?: ReactNode;
}

export function Combobox({
  name,
  items,
  placeholder = "Search…",
  emptyText = "No matches.",
  value,
  defaultValue,
  onValueChange,
  disabled,
  invalid,
  className,
  id,
  leadingIcon,
}: ComboboxProps) {
  const filter = (item: ComboboxItem, query: string): boolean => {
    if (!query) return true;
    const q = query.toLowerCase();
    if (item.label.toLowerCase().includes(q)) return true;
    if (item.searchText && item.searchText.toLowerCase().includes(q)) return true;
    return false;
  };

  return (
    <ComboboxPrimitive.Root
      name={name}
      items={items}
      itemToStringLabel={(item) => (item as ComboboxItem).label}
      itemToStringValue={(item) => (item as ComboboxItem).value}
      isItemEqualToValue={(a, b) => (a as ComboboxItem).value === (b as ComboboxItem).value}
      value={value !== undefined ? (items.find((i) => i.value === value) ?? null) : undefined}
      defaultValue={
        defaultValue ? (items.find((i) => i.value === defaultValue) ?? null) : undefined
      }
      onValueChange={(next) => {
        const v = next ? (next as ComboboxItem).value : null;
        onValueChange?.(v);
      }}
      filter={filter as never}
      disabled={disabled}
      // Auto-highlight the first matching item so users who type "Kam"
      // and tab/Enter away commit a real selection — without this,
      // typing without clicking leaves the hidden form input empty
      // and the action sees the field as missing.
      autoHighlight
    >
      <ComboboxPrimitive.Trigger
        className={cn(
          "border-input bg-card text-foreground relative flex w-full items-center gap-2 rounded-sm border px-2.5 py-2",
          "ease-expo-out text-body-s text-left transition-all duration-150 outline-none",
          "focus-within:border-ring focus-within:shadow-[0_0_0_3px_var(--teal-tint),0_0_0_1px_var(--ring)]",
          "",
          "disabled:bg-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "data-[disabled]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
          invalid &&
            "border-destructive bg-alert-bg shadow-[0_0_0_2px_rgba(220,38,38,0.1)] dark:shadow-[0_0_0_2px_rgba(252,165,165,0.1)]",
          className,
        )}
      >
        <span className="text-muted-foreground pointer-events-none flex shrink-0 items-center">
          {leadingIcon ?? <SearchIcon className="size-3.5" strokeWidth={2} />}
        </span>
        <ComboboxPrimitive.Input
          id={id}
          placeholder={placeholder}
          className={cn(
            "text-body-s flex-1 bg-transparent outline-none",
            "placeholder:text-gray-400 dark:placeholder:text-gray-400",
          )}
        />
        <ComboboxPrimitive.Icon className="text-muted-foreground pointer-events-none flex shrink-0 items-center">
          <ChevronDownIcon className="size-3.5" strokeWidth={2} />
        </ComboboxPrimitive.Icon>
      </ComboboxPrimitive.Trigger>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner sideOffset={6} className="z-50">
          <ComboboxPrimitive.Popup
            className={cn(
              "border-border bg-popover text-popover-foreground max-h-[min(60svh,320px)] w-(--anchor-width) overflow-y-auto rounded-md border shadow-lg",
              "ease-expo-out origin-(--transform-origin) transition-all duration-150",
              "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0",
            )}
          >
            <ComboboxPrimitive.Empty className="text-muted-foreground px-3 py-2.5 text-[12.5px]">
              {emptyText}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List>
              {(item: ComboboxItem) => (
                <ComboboxPrimitive.Item
                  key={item.value}
                  value={item}
                  className={cn(
                    "text-body-s flex cursor-default items-center justify-between gap-3 px-3 py-2",
                    "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground outline-none",
                    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                  )}
                >
                  <span className="truncate">{item.label}</span>
                  <ComboboxPrimitive.ItemIndicator className="text-brand-600 dark:text-brand-400">
                    <CheckIcon className="size-3.5" strokeWidth={2.25} />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
