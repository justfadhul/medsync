"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { get, useFormContext, useWatch } from "react-hook-form";

import { KIT } from "@/content/onboarding";
import {
  emailSuggestion,
  formatUgPhone,
  normalizeUgPhone,
  UNDER_18,
} from "@/lib/onboarding/fields";
import { cn } from "@/lib/utils";
import { fieldId, inputClass, revealClass } from "./styles";

export { fieldId, inputClass, revealClass };

/*
 * Onboarding v2 form kit — field primitives (ADR 0119). Validation errors are amber + icon + words
 * (Law 9: red is the Emergency affordance only); required fields carry no mark, optional ones say
 * so. Inputs are 16 px on phones (no iOS zoom) and 44 px tall (touch). Scoped to v2: the shared
 * components/forms kit is untouched.
 */

export function useFieldError(name: string): string | undefined {
  const { formState } = useFormContext();
  const message = get(formState.errors, name)?.message as string | undefined;
  return message === UNDER_18 ? undefined : message; // the under-18 guard speaks for itself
}

/** id + aria wiring for one input: hint and error are announced with it. */
export function useFieldA11y(name: string, hasHint: boolean) {
  const error = useFieldError(name);
  const id = fieldId(name);
  const describedBy =
    [hasHint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined } as const;
}

export function FieldError({ name, id }: { name: string; id?: string }) {
  const message = useFieldError(name);
  if (!message) return null;
  return (
    <p
      id={id ?? `${fieldId(name)}-error`}
      className="text-body-s flex items-start gap-1.5 text-amber-800 dark:text-amber-300"
    >
      <TriangleAlertIcon aria-hidden className="mt-[3px] size-3.5 shrink-0" strokeWidth={2} />
      <span>{message}</span>
    </p>
  );
}

function Label({
  htmlFor,
  children,
  optional,
}: {
  htmlFor?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="text-body-s text-foreground font-medium">
      {children}
      {optional ? <span className="text-muted-foreground font-normal"> {KIT.optional}</span> : null}
    </label>
  );
}

export function Hint({ name, children }: { name: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={`${fieldId(name)}-hint`} className="text-body-s text-muted-foreground text-pretty">
      {children}
    </p>
  );
}

export interface FieldProps {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  optional?: boolean;
}

export function FieldShell({
  name,
  label,
  hint,
  optional,
  children,
}: FieldProps & { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-field={name}>
      <Label htmlFor={fieldId(name)} optional={optional}>
        {label}
      </Label>
      {children}
      <Hint name={name}>{hint}</Hint>
      <FieldError name={name} />
    </div>
  );
}

export function TextField({
  name,
  label,
  hint,
  optional,
  type = "text",
  autoComplete,
  inputMode,
  autoCapitalize,
  placeholder,
  mono,
  maxLength,
}: FieldProps & {
  type?: "text" | "email";
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric" | "tel";
  autoCapitalize?: "words" | "characters" | "none" | "sentences";
  placeholder?: string;
  mono?: boolean;
  maxLength?: number;
}) {
  const { register } = useFormContext();
  const a11y = useFieldA11y(name, !!hint);
  return (
    <FieldShell name={name} label={label} hint={hint} optional={optional}>
      <input
        {...register(name)}
        {...a11y}
        type={type}
        autoComplete={autoComplete ?? "off"}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        spellCheck={mono ? false : undefined}
        placeholder={placeholder}
        maxLength={maxLength}
        enterKeyHint="next"
        className={cn(inputClass, mono && "font-mono tracking-wide uppercase")}
      />
    </FieldShell>
  );
}

/** Mobile number as people write it — 0772…, 772…, +256… — shown as 772 123 456 after the prefix. */
export function PhoneField({ name, label, hint, optional }: FieldProps) {
  const { register, setValue } = useFormContext();
  const a11y = useFieldA11y(name, !!hint);
  const reg = register(name, {
    onBlur: (e: { target: { value: string } }) => {
      const e164 = normalizeUgPhone(e.target.value);
      if (e164) setValue(name, formatUgPhone(e164).replace(/^0/, ""), { shouldValidate: true });
    },
  });
  return (
    <FieldShell name={name} label={label} hint={hint} optional={optional}>
      <div className="flex min-w-0 sm:max-w-xs">
        <span
          aria-hidden
          className="border-input bg-muted text-muted-foreground text-body-m inline-flex h-11 items-center rounded-l-md border border-r-0 px-3 font-mono"
        >
          {KIT.phonePrefix}
        </span>
        <input
          {...reg}
          {...a11y}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="772 123 456"
          enterKeyHint="next"
          className={cn(inputClass, "rounded-l-none")}
        />
      </div>
    </FieldShell>
  );
}

export function EmailField({ name, label, hint, optional }: FieldProps) {
  const { register, setValue } = useFormContext();
  const a11y = useFieldA11y(name, !!hint);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const reg = register(name, {
    onBlur: (e: { target: { value: string } }) =>
      setSuggestion(emailSuggestion(e.target.value.trim())),
  });
  return (
    <FieldShell name={name} label={label} hint={hint} optional={optional}>
      <input
        {...reg}
        {...a11y}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="next"
        className={inputClass}
      />
      {suggestion ? (
        <p className="text-body-s text-muted-foreground" aria-live="polite">
          {KIT.emailDidYouMean} <span className="text-foreground font-medium">{suggestion}</span>?{" "}
          <button
            type="button"
            className="font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
            onClick={() => {
              setValue(name, suggestion, { shouldValidate: true });
              setSuggestion(null);
            }}
          >
            {KIT.emailUse}
          </button>
        </p>
      ) : null}
    </FieldShell>
  );
}

export function PasswordField({ name, label, hint }: FieldProps) {
  const { register } = useFormContext();
  const a11y = useFieldA11y(name, !!hint);
  const [shown, setShown] = useState(false);
  return (
    <FieldShell name={name} label={label} hint={hint}>
      <div className="relative min-w-0">
        <input
          {...register(name)}
          {...a11y}
          type={shown ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="next"
          className={cn(inputClass, "pr-16")}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-controls={fieldId(name)}
          className="text-body-s text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 min-w-14 rounded-r-md px-3 font-medium"
        >
          {shown ? KIT.hidePassword : KIT.showPassword}
        </button>
      </div>
    </FieldShell>
  );
}

export interface Choice {
  value: string;
  label: string;
}

/** A radio group drawn as buttons. Selected = teal (a state), never plum (a place). */
export function ChoiceField({
  name,
  label,
  options,
  hint,
}: FieldProps & { options: readonly Choice[] }) {
  const { register } = useFormContext();
  const error = useFieldError(name);
  const id = fieldId(name);
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      data-field={name}
      aria-describedby={
        [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined
      }
    >
      <legend className="text-body-s text-foreground mb-1.5 font-medium">{label}</legend>
      <div id={id} tabIndex={-1} className="flex flex-wrap gap-2 outline-none">
        {options.map((o) => (
          <label key={o.value} className="relative">
            <input {...register(name)} type="radio" value={o.value} className="peer sr-only" />
            <span
              className={cn(
                "text-body-m tap inline-flex min-h-11 cursor-pointer items-center rounded-md border px-4 select-none",
                "border-input text-foreground bg-background hover:border-gray-300",
                "peer-checked:border-teal-600 peer-checked:bg-teal-50 peer-checked:text-teal-900 dark:peer-checked:bg-teal-950/40 dark:peer-checked:text-teal-100",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-teal-500 peer-focus-visible:ring-offset-2",
                error && "border-amber-600",
              )}
            >
              {o.label}
            </span>
          </label>
        ))}
      </div>
      <Hint name={name}>{hint}</Hint>
      <FieldError name={name} />
    </fieldset>
  );
}

/** Native select for short, fixed lists — the platform's own picker on a phone. */
export function SelectField({
  name,
  label,
  hint,
  optional,
  options,
  placeholder = "Choose…",
}: FieldProps & { options: readonly Choice[]; placeholder?: string }) {
  const { register } = useFormContext();
  const a11y = useFieldA11y(name, !!hint);
  return (
    <FieldShell name={name} label={label} hint={hint} optional={optional}>
      <select {...register(name)} {...a11y} defaultValue="" className={cn(inputClass, "pr-8")}>
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** Day / Month / Year — three number boxes; no calendar to scroll back decades (O2). */
export function MemorableDateInput({
  prefix,
  label,
  hint,
}: {
  prefix: string;
  label: ReactNode;
  hint?: ReactNode;
}) {
  const { register } = useFormContext();
  const names = [`${prefix}Day`, `${prefix}Month`, `${prefix}Year`] as const;
  const errors = [useFieldError(names[0]), useFieldError(names[1]), useFieldError(names[2])];
  const firstError = names.find((_, i) => errors[i]);
  const boxes = [
    { name: names[0], label: KIT.dob.day, width: "w-16", max: 2, auto: "bday-day" },
    { name: names[1], label: KIT.dob.month, width: "w-16", max: 2, auto: "bday-month" },
    { name: names[2], label: KIT.dob.year, width: "w-24", max: 4, auto: "bday-year" },
  ];
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      data-field={names[0]}
      aria-describedby={
        [hint && `${fieldId(names[0])}-hint`, firstError && `${fieldId(firstError)}-error`]
          .filter(Boolean)
          .join(" ") || undefined
      }
    >
      <legend className="text-body-s text-foreground mb-1.5 font-medium">{label}</legend>
      <div className="flex gap-3">
        {boxes.map((b, i) => (
          <div key={b.name} className="flex flex-col gap-1">
            <label htmlFor={fieldId(b.name)} className="text-body-s text-muted-foreground">
              {b.label}
            </label>
            <input
              {...register(b.name)}
              id={fieldId(b.name)}
              aria-invalid={errors[i] ? true : undefined}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={b.auto}
              maxLength={b.max}
              enterKeyHint="next"
              className={cn(inputClass, b.width, "text-center tabular-nums")}
            />
          </div>
        ))}
      </div>
      <Hint name={names[0]}>{hint}</Hint>
      {firstError ? <FieldError name={firstError} /> : null}
    </fieldset>
  );
}

/** Watches one field — small helper so forms stay declarative. */
export function useFieldValue<T = string>(name: string): T {
  return useWatch({ name }) as T;
}
