"use client";

import type { StepState } from "../_lib/rules";
import type { ComponentProps, ReactNode } from "react";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SETUP } from "@/content/onboarding";
import { CHECKLIST } from "@/content/onboarding-setup";
import { cn } from "@/lib/utils";

/*
 * The checklist's small form parts. Native controls (checkbox, radio, select), 44 px targets,
 * teal for focus and selection, amber + icon + words for errors (Law 9), ink ticks.
 */

export const fieldClass = cn(
  "border-input bg-card text-foreground block h-11 w-full min-w-0 rounded-md border px-3 text-base sm:text-body-s",
  "ease-expo-out outline-none transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none",
  "focus-visible:border-teal-500 focus-visible:shadow-[0_0_0_2px_rgba(20,184,166,0.4)]",
);

const labelClass = "text-body-s text-foreground font-medium";

/** DD MMM YYYY (Ugandan convention), fixed zone so server and browser agree. */
export const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kampala",
  });

export function FormStatus({ state, okText }: { state: StepState; okText?: string }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="text-body-s flex items-start gap-1.5 text-amber-800 dark:text-amber-300"
      >
        <TriangleAlertIcon aria-hidden className="mt-[3px] size-3.5 shrink-0" strokeWidth={2} />
        <span>{state.error}</span>
      </p>
    );
  }
  if (!state.ok) return null;
  return (
    <p role="status" className="text-body-s text-foreground flex items-center gap-1.5">
      <CheckIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
      <span>{okText ?? SETUP.saved}</span>
    </p>
  );
}

export function SaveButton({ pending, label = SETUP.save }: { pending: boolean; label?: string }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" variant="secondary" size="md" className="min-h-11" disabled={pending}>
        {pending ? CHECKLIST.saving : label}
      </Button>
    </div>
  );
}

type Choices = ReadonlyArray<{ code: string; label: string }>;

export function CheckGroup({
  legend,
  name,
  choices,
  checked,
}: {
  legend: string;
  name: string;
  choices: Choices;
  checked: ReadonlyArray<string>;
}) {
  const on = new Set(checked);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={cn(labelClass, "mb-1")}>{legend}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-4">
        {choices.map((c) => (
          <CheckRow key={c.code} name={name} value={c.code} defaultChecked={on.has(c.code)}>
            {c.label}
          </CheckRow>
        ))}
      </div>
    </fieldset>
  );
}

export function CheckRow({
  name,
  value,
  children,
  ...input
}: {
  name: string;
  value: string;
  children: ReactNode;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (on: boolean) => void;
}) {
  return (
    <label className="text-body-s text-foreground/90 flex min-h-11 cursor-pointer items-center gap-2.5">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={input.defaultChecked}
        checked={input.checked}
        onChange={input.onChange ? (e) => input.onChange?.(e.target.checked) : undefined}
        className="size-4 shrink-0 accent-teal-600"
      />
      <span>{children}</span>
    </label>
  );
}

export function SelectField({
  name,
  label,
  choices,
  value,
  onChange,
}: {
  name: string;
  label: string;
  choices: Choices;
  value: string | null;
  onChange?: (v: string) => void;
}) {
  const id = `setup-${name}`;
  const known = choices.some((c) => c.code === value) ? (value ?? "") : "";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        className={fieldClass}
        {...(onChange
          ? { value: known, onChange: (e) => onChange(e.target.value) }
          : { defaultValue: known })}
      >
        <option value="">{CHECKLIST.choose}</option>
        {choices.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextField({
  name,
  label,
  hint,
  className,
  ...input
}: {
  name: string;
  label: string;
  hint?: string;
  className?: string;
} & Omit<ComponentProps<"input">, "name" | "id" | "className">) {
  const id = `setup-${name}`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        className={fieldClass}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-body-s text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
