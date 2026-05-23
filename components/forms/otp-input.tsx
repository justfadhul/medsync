"use client";

import { OTPFieldPreview as OTPFieldPrimitive } from "@base-ui/react/otp-field";

import { cn } from "@/lib/utils";

/**
 * Numeric one-time-code input (6 slots by default).
 *
 * Used for MFA challenges and for the SMS code in the patient signup
 * flow (kickoff §C). Built on base-ui OTPField — handles paste,
 * autofill (`one-time-code`), per-slot focus motion, and submits a
 * single value with the field's `name`.
 *
 * Defaults are tuned for our use:
 *   - 6 numeric digits
 *   - inputMode=numeric so iOS opens the digit keypad
 *   - autoComplete="one-time-code" so iOS prompts SMS autofill
 *
 * Keep this generic — the surrounding step decides what to do with
 * the value (verify with Supabase Auth, validate against a code we
 * issued, etc.). The component just collects.
 */
export interface OtpInputProps {
  name: string;
  /** Number of digit slots. Default 6 — matches Supabase TOTP / our SMS codes. */
  length?: number;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  /** Fires when all slots are filled (use to enable a "Verify" button). */
  onComplete?: (value: string) => void;
  /** Submit the surrounding form once all slots fill. */
  autoSubmit?: boolean;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
}

export function OtpInput({
  name,
  length = 6,
  defaultValue,
  value,
  onValueChange,
  onComplete,
  autoSubmit,
  required,
  disabled,
  invalid,
  id,
  className,
}: OtpInputProps) {
  return (
    <OTPFieldPrimitive.Root
      id={id}
      name={name}
      length={length}
      defaultValue={defaultValue}
      value={value}
      onValueChange={(v) => onValueChange?.(v)}
      onValueComplete={(v) => onComplete?.(v)}
      autoSubmit={autoSubmit}
      required={required}
      disabled={disabled}
      validationType="numeric"
      autoComplete="one-time-code"
      className={cn("flex items-center gap-1.5 sm:gap-2", className)}
    >
      {Array.from({ length }).map((_, i) => (
        <OTPFieldPrimitive.Input
          key={i}
          aria-invalid={invalid || undefined}
          className={cn(
            "border-input bg-card text-foreground size-11 rounded-sm border text-center text-[18px] font-medium tabular-nums",
            "ease-expo-out transition-all duration-150 outline-none",
            "focus-visible:border-teal-500 focus-visible:shadow-[0_0_0_2px_rgba(20,184,166,0.15)]",
            "dark:focus-visible:border-teal-400 dark:focus-visible:shadow-[0_0_0_2px_rgba(45,212,191,0.2)]",
            "data-filled:border-teal-500 data-filled:bg-teal-50/40 dark:data-filled:border-teal-400 dark:data-filled:bg-teal-50/10",
            "disabled:bg-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
            invalid && "border-destructive bg-alert-bg shadow-[0_0_0_2px_rgba(220,38,38,0.1)]",
          )}
        />
      ))}
    </OTPFieldPrimitive.Root>
  );
}
