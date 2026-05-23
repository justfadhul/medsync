"use client";

import type { ReactNode } from "react";
import { Field as FieldPrimitive } from "@base-ui/react/field";

import { cn } from "@/lib/utils";

/**
 * Shared form-field wrapper for the onboarding flows.
 *
 * Wraps base-ui `Field.Root` with label / description / error slots.
 * Pair with any control that accepts `name=` (Input, Combobox, Checkbox,
 * SegmentedControl, etc.) — the wrapper plumbs the field's invalid state
 * down via base-ui's data attributes so styling stays consistent.
 *
 * Why we expose `serverError` separately from base-ui's client-side
 * validity: Server Actions return Zod errors keyed by field name; those
 * errors arrive after submit and need to win over any stale client
 * validity. `serverError` forces the error message visible regardless of
 * the input's ValidityState.
 */
export interface FieldProps {
  name: string;
  label: ReactNode;
  /** Helper text shown under the label, before the control. */
  description?: ReactNode;
  /** Server-side error for this field — overrides client validity when set. */
  serverError?: string | null;
  /** Marks the label with an aria-correct asterisk and required affordance. */
  required?: boolean;
  /** Mirrors base-ui Field.Root disabled prop so descendants pick it up. */
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({
  name,
  label,
  description,
  serverError,
  required,
  disabled,
  className,
  children,
}: FieldProps) {
  return (
    <FieldPrimitive.Root
      name={name}
      disabled={disabled}
      invalid={serverError ? true : undefined}
      className={cn("group flex w-full flex-col gap-1.5", className)}
    >
      <FieldPrimitive.Label
        className={cn(
          "text-muted-foreground inline-flex items-center gap-1.5 text-[11px] leading-none font-medium tracking-[0.01em] select-none",
          "group-data-disabled:opacity-50",
        )}
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only">(required)</span> : null}
      </FieldPrimitive.Label>

      {description ? (
        <FieldPrimitive.Description className="text-muted-foreground text-[11.5px] leading-snug">
          {description}
        </FieldPrimitive.Description>
      ) : null}

      {children}

      {serverError ? (
        <FieldPrimitive.Error match className="text-destructive text-[11.5px] leading-snug">
          {serverError}
        </FieldPrimitive.Error>
      ) : (
        <FieldPrimitive.Error className="text-destructive text-[11.5px] leading-snug" />
      )}
    </FieldPrimitive.Root>
  );
}
