"use client";

import type { ComponentProps, ReactNode } from "react";
import dynamic from "next/dynamic";
import { useEffect, useEffectEvent, useId, useState } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { ICON } from "./kit";

/** The interactive pieces of the patient kit (§5.4). Tokens only; inputs at 16 px or larger (L13). */

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pw-focus";

/** A choice chip. Four or fewer choices are chips (DESIGN-medsync rule 3). */
export function Chip({
  selected,
  className,
  ...rest
}: ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...rest}
      className={cn(
        "inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-[15px] leading-5 font-semibold",
        "transition-[scale,background-color] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none",
        FOCUS,
        selected
          ? "bg-pw-act text-pw-on-act"
          : "bg-pw-surface text-pw-ink ring-pw-line hover:bg-pw-surface-3 ring-1 ring-inset",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    />
  );
}

export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {children}
    </div>
  );
}

/** Segments ("Today / This week"): one choice of a few, as radios. The selected one takes lagoon. */
export function Segments<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("bg-pw-surface-3 inline-flex max-w-full rounded-full p-1", className)}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "relative inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full px-4 text-[15px] font-semibold",
            "has-[:focus-visible]:outline-pw-focus has-[:focus-visible]:outline-2",
            o.value === value
              ? "bg-pw-accent text-pw-on-accent"
              : "text-pw-ink-2 hover:text-pw-ink",
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  className,
  ...rest
}: ComponentProps<"input"> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  const describedBy =
    [hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-base leading-5 font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
        className={cn(
          "rounded-pw-field bg-pw-surface text-pw-ink ring-pw-line-strong placeholder:text-pw-ink-4 h-[52px] w-full min-w-0 px-4 text-[17px] ring-[1.5px] ring-inset",
          "focus:ring-pw-focus focus:ring-2 focus:outline-none",
          error && "ring-pw-ink ring-2",
        )}
      />
      {hint ? (
        <p id={`${id}-h`} className="text-pw-ink-2 text-[13px] leading-[18px] font-medium">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-e`}
          role="alert"
          className="text-pw-ink text-[13px] leading-[18px] font-semibold"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A large tabular number with − and +, a locked unit, and a focus halo (§5.4). */
export function NumberField({
  label,
  unit,
  value,
  onChange,
  step = 1,
  min,
  max,
  decimals = 0,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
}) {
  const id = useId();
  const bump = (d: number) => {
    const n = Number(value || 0) + d;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    onChange(clamped.toFixed(decimals));
  };
  const stepper = cn(
    "grid size-12 shrink-0 place-items-center rounded-full bg-pw-surface-3 text-pw-ink",
    FOCUS,
  );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-base leading-5 font-semibold">
        {label}
      </label>
      <div className="rounded-pw-field bg-pw-surface ring-pw-line-strong focus-within:ring-pw-focus focus-within:shadow-pw-accent flex items-center gap-2 p-2 ring-[1.5px] ring-inset focus-within:ring-2">
        <button
          type="button"
          className={stepper}
          onClick={() => bump(-step)}
          aria-label={`Less ${label}`}
        >
          <MinusIcon className="size-5" {...ICON} />
        </button>
        <input
          id={id}
          inputMode={decimals ? "decimal" : "numeric"}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          className="w-0 min-w-0 flex-1 bg-transparent text-center text-[30px] leading-8 font-semibold tracking-[-0.02em] tabular-nums focus:outline-none"
        />
        <span className="text-pw-ink-2 shrink-0 text-[15px] font-semibold">{unit}</span>
        <button
          type="button"
          className={stepper}
          onClick={() => bump(step)}
          aria-label={`More ${label}`}
        >
          <PlusIcon className="size-5" {...ICON} />
        </button>
      </div>
    </div>
  );
}

/** A 4 s toast with an optional Undo (§5.4). Grey, never red, amber or green (L4). */
export function Toast({
  message,
  onUndo,
  onClose,
  ms = 4000,
  className,
}: {
  message: string;
  onUndo?: () => void;
  onClose: () => void;
  /** How long it stays (the landing page's toasts leave after 2.4 s). */
  ms?: number;
  className?: string;
}) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const t = setTimeout(() => close(), ms);
    return () => clearTimeout(t);
  }, [message, ms]);
  return (
    <div
      role="status"
      className={cn(
        "bg-pw-band text-pw-on-band shadow-pw-float fixed inset-x-4 bottom-[112px] z-40 mx-auto flex max-w-md items-center gap-3 rounded-full px-5 py-3 text-[15px] font-semibold min-[761px]:bottom-8",
        className,
      )}
    >
      <span className="flex-1">{message}</span>
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          className={cn("text-pw-on-band-accent min-h-11 px-2", FOCUS)}
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  withHelp?: boolean;
  width?: "medium" | "wide";
  footer?: ReactNode;
  children: ReactNode;
}

// The dialog library (~38 kB) loads when a dialog first opens, not with every page (prompt §8 budgets).
const DialogImpl = dynamic(() => import("./dialog-impl"), { ssr: false });

/**
 * The patient dialog (W1, ADR 0161): centred and landscape over a dimmed ground, focus trapped and returned
 * (the shared EditorDialog, in ./dialog-impl). Mounted from its first opening on, so it can animate out.
 */
export function Dialog(props: DialogProps) {
  const [seen, setSeen] = useState(props.open);
  if (props.open && !seen) setSeen(true);
  return seen ? <DialogImpl {...props} /> : null;
}
