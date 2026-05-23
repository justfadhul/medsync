"use client";

import type { ReactNode } from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Plain consent / opt-in checkbox.
 *
 * Built on base-ui `Checkbox.Root` which renders a styleable element
 * AND a hidden native input alongside — so the value submits with any
 * surrounding `<form>` without extra plumbing. When unchecked, the
 * hidden input is absent (matches native form behaviour); the server
 * should treat "field missing" as `false`.
 *
 * For consent capture against `consent_versions` use `<ConsentCheckbox/>`
 * instead — it carries version + body_sha256 so we can attribute the
 * specific text the user agreed to.
 */
export interface CheckboxProps {
  name: string;
  label: ReactNode;
  description?: ReactNode;
  /** When provided, this value is submitted when checked (default: "on"). */
  value?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

export function Checkbox({
  name,
  label,
  description,
  value = "on",
  defaultChecked,
  checked,
  onCheckedChange,
  required,
  disabled,
  invalid,
  className,
}: CheckboxProps) {
  return (
    <label
      className={cn(
        "border-input bg-card flex cursor-pointer items-start gap-3 rounded-md border p-3 text-[13px]",
        "ease-expo-out transition-all duration-150 select-none",
        "hover:border-teal-300",
        "focus-within:border-teal-500 focus-within:shadow-[0_0_0_2px_rgba(20,184,166,0.15)]",
        "dark:focus-within:border-teal-400 dark:focus-within:shadow-[0_0_0_2px_rgba(45,212,191,0.2)]",
        invalid && "border-destructive bg-alert-bg",
        disabled && "pointer-events-none cursor-not-allowed opacity-50",
        className,
      )}
    >
      <CheckboxPrimitive.Root
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange?.(Boolean(next))}
        required={required}
        disabled={disabled}
        className={cn(
          "border-input bg-card mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border",
          "data-[checked]:border-teal-500 data-[checked]:bg-teal-500 data-[checked]:text-white",
          "dark:data-[checked]:border-teal-400 dark:data-[checked]:bg-teal-400 dark:data-[checked]:text-gray-900",
          "ease-expo-out transition-all duration-150",
        )}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <CheckIcon className="size-3" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-foreground leading-tight font-medium">
          {label}
          {required ? (
            <span aria-hidden="true" className="text-destructive ml-1">
              *
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="text-muted-foreground text-[11.5px] leading-snug">{description}</span>
        ) : null}
      </div>
    </label>
  );
}
