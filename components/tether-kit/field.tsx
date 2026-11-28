"use client";

import type { ChangeEvent, ComponentProps, ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { Input as BaseInput } from "@base-ui/react/input";
import { NumberField } from "@base-ui/react/number-field";
import { CircleAlertIcon, MinusIcon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { FIELD_CONTROL, FIELD_FRAME, FIELD_SIZE, ICON, STATE } from "./core";

/**
 * Set 2 · Typing. Behaviour: Base UI Field, Input and NumberField, so the label, hint and error are wired to the
 * control for assistive tech. The order is label, hint, error, control: the error comes before the field (as in
 * GOV.UK's design system), so a screen reader meets it first and a phone keyboard never covers it. An error says
 * what to fix with an icon and a word, in ink: never red, never colour alone. Mark the optional field, not the
 * required one.
 */
const FieldState = createContext({ invalid: false, disabled: false });

export function Field({
  label,
  hint,
  error,
  optional,
  disabled,
  className,
  children,
}: {
  /** What to enter, as a short noun phrase. Never a placeholder instead. */
  label: ReactNode;
  /** Format, range or why it is asked: "The 9 digits after +256". */
  hint?: ReactNode;
  /** What to fix, as a sentence: "Enter a weight between 2 and 250 kg". Marks the field invalid. */
  error?: string;
  /** Adds "(optional)" to the label. Fields are required unless marked. */
  optional?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const invalid = Boolean(error);
  return (
    <BaseField.Root
      invalid={invalid}
      disabled={disabled}
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
    >
      <FieldState.Provider value={{ invalid, disabled: Boolean(disabled) }}>
        <BaseField.Label className="text-pw-ink text-[0.9375rem] leading-[1.3] font-semibold in-data-[density=desk]:text-[0.8125rem]">
          {label}
          {optional ? <span className="text-pw-ink-2 font-medium"> (optional)</span> : null}
        </BaseField.Label>
        {hint ? (
          <BaseField.Description className="text-pw-ink-2 text-[0.875rem] leading-[1.4] in-data-[density=desk]:text-xs">
            {hint}
          </BaseField.Description>
        ) : null}
        {error ? (
          <BaseField.Error
            match
            className="text-pw-ink flex items-start gap-1.5 text-[0.875rem] leading-[1.4] font-semibold in-data-[density=desk]:text-xs"
          >
            <CircleAlertIcon {...ICON} strokeWidth={2.2} className="mt-px size-4 shrink-0" />
            <span>
              <span className="sr-only">Error: </span>
              {error}
            </span>
          </BaseField.Error>
        ) : null}
        {children}
      </FieldState.Provider>
    </BaseField.Root>
  );
}

/** The frame's state, from its Field and the control's own props. */
function useFrameState(disabled?: boolean, readOnly?: boolean) {
  const f = useContext(FieldState);
  return {
    "data-invalid": f.invalid || undefined,
    "data-disabled": f.disabled || disabled || undefined,
    "data-readonly": readOnly || undefined,
  };
}

const AFFIX =
  "text-pw-ink-2 bg-pw-surface-2 border-pw-line grid shrink-0 place-items-center px-3.5 text-[0.9375rem] font-semibold tabular-nums in-data-[density=desk]:px-3 in-data-[density=desk]:text-[0.8125rem]";

/** How long the expected answer is: a code or a count is short, a name is medium, an address is full. */
const WIDTH = { full: "", m: "max-w-[22rem]", s: "max-w-[12rem]" } as const;

export function Input({
  prefix,
  suffix,
  icon,
  width = "full",
  type = "text",
  className,
  disabled,
  readOnly,
  ...rest
}: Omit<ComponentProps<typeof BaseInput>, "className" | "prefix"> & {
  /** Fixed text before the value, e.g. "+256" or "UGX". Say it in the hint too: it is not read out. */
  prefix?: string;
  /** Fixed text after the value, e.g. "kg". */
  suffix?: string;
  /** A leading icon, for search only. */
  icon?: ReactNode;
  width?: keyof typeof WIDTH;
  className?: string;
}) {
  const [shown, setShown] = useState(false);
  const password = type === "password";
  return (
    <div
      {...useFrameState(disabled, readOnly)}
      className={cn(FIELD_FRAME, FIELD_SIZE, WIDTH[width], className)}
    >
      {icon ? (
        <span
          aria-hidden
          className="text-pw-ink-3 grid shrink-0 place-items-center pl-4 in-data-[density=desk]:pl-3 [&_svg]:size-5 in-data-[density=desk]:[&_svg]:size-4"
        >
          {icon}
        </span>
      ) : null}
      {prefix ? (
        <span aria-hidden className={cn(AFFIX, "border-r")}>
          {prefix}
        </span>
      ) : null}
      <BaseInput
        {...rest}
        type={password && shown ? "text" : type}
        disabled={disabled}
        readOnly={readOnly}
        className={cn(FIELD_CONTROL, icon && "pl-2 in-data-[density=desk]:pl-2")}
      />
      {suffix ? (
        <span aria-hidden className={cn(AFFIX, "border-l")}>
          {suffix}
        </span>
      ) : null}
      {password ? (
        <button
          type="button"
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}
          className={cn(
            "text-pw-accent-text relative shrink-0 px-4 text-[0.9375rem] font-semibold in-data-[density=desk]:px-3 in-data-[density=desk]:text-[0.8125rem]",
            "focus-visible:outline-pw-focus outline-none focus-visible:outline-2 focus-visible:-outline-offset-4",
            STATE,
          )}
        >
          {shown ? "Hide" : "Show"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Longer answers. It grows with what is typed (up to 60% of the screen), and with `maxLength` it counts: "24 of 280
 * characters", a description of the field. The count is spoken only near the limit (the last 20, or the last quarter
 * of a short limit) and only once typing has started, so a screen reader is not interrupted.
 */
export function Textarea({
  maxLength,
  rows = 3,
  className,
  disabled,
  readOnly,
  defaultValue,
  value,
  onChange,
  ...rest
}: Omit<ComponentProps<"textarea">, "className"> & { className?: string }) {
  const [typed, setTyped] = useState(String(defaultValue ?? "").length);
  const used = value != null ? String(value).length : typed;
  const left = maxLength != null ? maxLength - used : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div
        {...useFrameState(disabled, readOnly)}
        className={cn(
          FIELD_FRAME,
          "rounded-pw-field in-data-[density=desk]:rounded-[12px]",
          className,
        )}
      >
        <BaseField.Control
          render={<textarea rows={rows} />}
          {...(rest as object)}
          maxLength={maxLength}
          disabled={disabled}
          readOnly={readOnly}
          defaultValue={defaultValue as string | undefined}
          value={value as string | undefined}
          onChange={(e: { target: { value: string } }) => {
            setTyped(e.target.value.length);
            onChange?.(e as unknown as ChangeEvent<HTMLTextAreaElement>);
          }}
          className={cn(
            FIELD_CONTROL,
            "field-sizing-content max-h-[60vh] min-h-[5.75rem] resize-y py-3 text-[1.0625rem] leading-[1.5]",
            "in-data-[density=desk]:min-h-[4.5rem] in-data-[density=desk]:py-2 in-data-[density=desk]:text-sm",
          )}
        />
      </div>
      {maxLength != null ? (
        <>
          <BaseField.Description className="text-pw-ink-2 self-end text-[0.8125rem] tabular-nums in-data-[density=desk]:text-xs">
            {used} of {maxLength} characters
          </BaseField.Description>
          <span className="sr-only" aria-live="polite">
            {left != null && used > 0 && left <= Math.min(20, Math.ceil((maxLength ?? 0) / 4))
              ? left === 0
                ? "No characters left"
                : `${left} characters left`
              : ""}
          </span>
        </>
      ) : null}
    </div>
  );
}

const STEP = cn(
  "text-pw-ink relative grid w-12 shrink-0 place-items-center self-stretch outline-none",
  "in-data-[density=desk]:w-10 [&_svg]:size-5 in-data-[density=desk]:[&_svg]:size-4",
  "focus-visible:outline-pw-focus focus-visible:outline-2 focus-visible:-outline-offset-4",
  "data-[disabled]:text-pw-ink-4 data-[disabled]:cursor-not-allowed data-[disabled]:after:hidden",
  STATE,
);

/**
 * A number with a locked unit and − and + steppers (48 px for patients). The unit is part of the field, not typed.
 * Give the range in the Field's `hint` ("Between 30 and 45 °C"). Shift with an arrow key steps by ten.
 */
export function NumberInput({
  unit,
  lessLabel = "Less",
  moreLabel = "More",
  className,
  disabled,
  readOnly,
  ...rest
}: Omit<ComponentProps<typeof NumberField.Root>, "className" | "children"> & {
  /** The unit after the value: "kg", "°C", "mmHg". */
  unit?: string;
  /** Spoken names of the steppers. */
  lessLabel?: string;
  moreLabel?: string;
  className?: string;
}) {
  return (
    <NumberField.Root
      {...rest}
      disabled={disabled}
      readOnly={readOnly}
      largeStep={10}
      className={cn("min-w-0", className)}
    >
      <NumberField.Group
        {...useFrameState(disabled, readOnly)}
        className={cn(FIELD_FRAME, FIELD_SIZE, "max-w-[20rem]")}
      >
        {readOnly ? null : (
          <NumberField.Decrement
            aria-label={lessLabel}
            className={cn(STEP, "border-pw-line border-r")}
          >
            <MinusIcon {...ICON} />
          </NumberField.Decrement>
        )}
        <NumberField.Input
          className={cn(FIELD_CONTROL, "text-center font-semibold tabular-nums")}
        />
        {unit ? (
          <span aria-hidden className={cn(AFFIX, "border-l")}>
            {unit}
          </span>
        ) : null}
        {readOnly ? null : (
          <NumberField.Increment
            aria-label={moreLabel}
            className={cn(STEP, "border-pw-line border-l")}
          >
            <PlusIcon {...ICON} />
          </NumberField.Increment>
        )}
      </NumberField.Group>
    </NumberField.Root>
  );
}
