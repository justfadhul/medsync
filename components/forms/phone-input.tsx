"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Uganda-only phone input.
 *
 * What ships to the server is always E.164: `+2567XXXXXXXX` (mobile)
 * or `+256X(...)` for landline subscribers — that's the canonical form
 * we encrypt + store. The visible input formats the trailing 9 digits
 * as `XXX XXX XXX` for readability while typing, and the +256 prefix
 * is fixed in a non-editable affordance to the left so users can't
 * confuse themselves with `0256`, `00256`, leading `0`, or international
 * prefixes from other countries.
 *
 * Mobile numbers in Uganda start with `7` after the country code; we
 * surface a soft hint when the first digit isn't 7 rather than blocking
 * typing (landlines are still valid for hospital admin / hospital
 * accounts).
 *
 * Per the kickoff §A.6, the surrounding action MUST encrypt the value
 * via `lib/encryption.ts` before writing to the DB — this component
 * just collects + canonicalises.
 */
export interface PhoneInputProps {
  name: string;
  /** Defaults to "" — pass a stored E.164 value to repopulate a draft. */
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  /** Receives the normalized E.164 value on every keystroke. */
  onValueChange?: (e164: string) => void;
  /** Forces mobile-only validation (rejects landline 1st-digit ≠ 7). */
  mobileOnly?: boolean;
}

const COUNTRY = "+256";

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Take whatever the user typed and reduce it to the 9-digit national
 * subscriber number (i.e. without the +256 prefix or leading 0).
 */
function toSubscriber(raw: string): string {
  let d = digitsOnly(raw);
  if (d.startsWith("256")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 9);
}

function formatSubscriber(subscriber: string): string {
  const parts: string[] = [];
  if (subscriber.length > 0) parts.push(subscriber.slice(0, 3));
  if (subscriber.length > 3) parts.push(subscriber.slice(3, 6));
  if (subscriber.length > 6) parts.push(subscriber.slice(6, 9));
  return parts.join(" ");
}

function subscriberFromDefault(value: string | undefined): string {
  if (!value) return "";
  return toSubscriber(value);
}

export function PhoneInput({
  name,
  defaultValue,
  placeholder = "7XX XXX XXX",
  required,
  disabled,
  invalid,
  id,
  className,
  onValueChange,
  mobileOnly,
}: PhoneInputProps) {
  const [subscriber, setSubscriber] = useState<string>(subscriberFromDefault(defaultValue));
  const e164 = subscriber.length > 0 ? `${COUNTRY}${subscriber}` : "";

  useEffect(() => {
    onValueChange?.(e164);
  }, [e164, onValueChange]);

  const looksLikeMobile = subscriber.length === 0 || subscriber.startsWith("7");
  const tooShort = subscriber.length > 0 && subscriber.length < 9;
  const showMobileHint = mobileOnly && !looksLikeMobile;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        className={cn(
          "border-input bg-card text-foreground flex w-full items-stretch overflow-hidden rounded-sm border",
          "ease-expo-out transition-all duration-150",
          "focus-within:border-teal-500 focus-within:shadow-[0_0_0_2px_rgba(20,184,166,0.15)]",
          "dark:focus-within:border-teal-400 dark:focus-within:shadow-[0_0_0_2px_rgba(45,212,191,0.2)]",
          invalid &&
            "border-destructive bg-alert-bg shadow-[0_0_0_2px_rgba(220,38,38,0.1)] dark:shadow-[0_0_0_2px_rgba(252,165,165,0.1)]",
          disabled && "bg-muted pointer-events-none cursor-not-allowed opacity-50",
        )}
      >
        <span
          aria-hidden="true"
          className="bg-muted text-muted-foreground border-border flex shrink-0 items-center justify-center border-r px-2.5 font-mono text-[13px]"
        >
          {COUNTRY}
        </span>
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={placeholder}
          value={formatSubscriber(subscriber)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          onChange={(e) => setSubscriber(toSubscriber(e.target.value))}
          className={cn(
            "min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[13px] tracking-[0.02em] outline-none",
            "placeholder:text-gray-400 dark:placeholder:text-gray-400",
          )}
        />
      </div>
      {/* The actual form payload — E.164. */}
      <input type="hidden" name={name} value={e164} />
      {showMobileHint ? (
        <span className="text-muted-foreground text-[11.5px] leading-snug">
          Mobile numbers in Uganda start with 7.
        </span>
      ) : tooShort ? (
        <span className="text-muted-foreground text-[11.5px] leading-snug">
          {9 - subscriber.length} more digit{9 - subscriber.length === 1 ? "" : "s"}…
        </span>
      ) : null}
    </div>
  );
}
