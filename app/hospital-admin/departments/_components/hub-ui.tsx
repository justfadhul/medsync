"use client";

import type { HubResult } from "../_lib/types";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangleIcon, ChevronRightIcon, XIcon } from "lucide-react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Button } from "@/components/ui/button";
import {
  SheetBody,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { runHubOp } from "../actions";

/*
 * The hub's small shared vocabulary. Colour law (Law 9): record states are NEUTRAL chips with words
 * (nothing is green); amber always carries an icon and a word; teal is the action; plum marks place
 * (the current tab) and nothing else here.
 */

export type RecordStatus = "live" | "not_live" | "planned" | "archived" | "available";

const STATUS_LABEL: Record<RecordStatus, string> = {
  live: "Live",
  not_live: "Not on MedSync yet",
  planned: "Planned",
  archived: "Archived",
  available: "Available",
};

export function StatusChip({ status, className }: { status: RecordStatus; className?: string }) {
  return (
    <span
      className={cn(
        "text-caption inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-medium whitespace-nowrap",
        status === "live" && "bg-foreground text-background",
        (status === "not_live" || status === "available") && "bg-gray-100 text-gray-700",
        status === "planned" && "border border-dashed border-gray-300 text-gray-600",
        status === "archived" && "bg-transparent text-gray-500 line-through decoration-gray-400",
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Amber = something is wrong or waiting. Always icon + word (never colour alone). */
export function Amber({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "bg-status-caution-bg dark:text-status-caution-fg text-caption inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-amber-800",
        className,
      )}
    >
      <AlertTriangleIcon className="size-3 shrink-0" aria-hidden />
      {children}
    </span>
  );
}

/** Runs one hub op; keeps the admin on the page and shows the Edge Function's words on failure. */
export function useHub() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(
    input: { op: string } & Record<string, unknown>,
    onOk?: (data: Record<string, unknown> | undefined) => void,
  ) {
    setError(null);
    start(async () => {
      const r = await runHubOp(input);
      if (!r.ok) return setError(r.error);
      onOk?.(r.data);
      router.refresh();
    });
  }
  function call(
    fn: () => Promise<HubResult>,
    onOk?: (data: Record<string, unknown> | undefined) => void,
  ) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      onOk?.(r.data);
      router.refresh();
    });
  }
  return { pending, error, setError, run, call };
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="dark:text-status-caution-fg text-body-s flex items-start gap-1.5 text-amber-800"
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {error}
    </p>
  );
}

/**
 * The one pop-up every row opens: a centred landscape card (the console's EditorDialog), never a
 * drawer from the edge (ADR 0161). `wide` seats two columns side by side (`PanelColumns`); the
 * default is the medium card for short forms. Reduced motion is the primitive's.
 */
export function HubPanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <EditorDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width={wide ? "wide" : "medium"}
    >
      <SheetHeader className="relative pr-14">
        <SheetTitle>{title}</SheetTitle>
        {description ? <SheetDescription>{description}</SheetDescription> : null}
        <SheetClose
          render={
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Close"
              className="absolute top-4 right-4"
            />
          }
        >
          <XIcon className="size-4" />
        </SheetClose>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-6">{children}</SheetBody>
      {footer ? <SheetFooter>{footer}</SheetFooter> : null}
    </EditorDialog>
  );
}

/** A wide panel's two stacks: side by side on a landscape screen, one after the other on a phone. */
export function PanelColumns({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2 lg:items-start">
      <div className="flex min-w-0 flex-col gap-6">{left}</div>
      <div className="flex min-w-0 flex-col gap-6">{right}</div>
    </div>
  );
}

/** A whole-row button: the one tap to the right panel (§4 rule 6). */
export function RowButton({
  onClick,
  children,
  label,
}: {
  onClick: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-100",
        "hover:bg-gray-50",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
      )}
    >
      {children}
      <ChevronRightIcon
        className="text-muted-foreground/60 group-hover:text-foreground size-4 shrink-0 transition-colors"
        aria-hidden
      />
    </button>
  );
}

/** A group heading inside a list: "CLINICAL ── 4". */
export function GroupHeading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="text-muted-foreground flex items-center gap-3 px-4 pt-5 pb-2 font-mono text-[10.5px] tracking-[0.14em] uppercase">
      {children}
      {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
      <span className="bg-border h-px flex-1" aria-hidden />
    </h2>
  );
}

export function Field({
  label,
  hint,
  children,
  group = false,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  /** A set of buttons (radiogroup) rather than one control: a <div>, so clicking the label clicks nothing. */
  group?: boolean;
}) {
  // One control inside → the wrapping <label> names it (68 fields, no ids to keep in step).
  const Tag = group ? "div" : "label";
  return (
    <Tag className="flex flex-col gap-1">
      <span className="text-muted-foreground text-caption mb-1 leading-none font-medium">
        {label}
      </span>
      {children}
      {hint ? <span className="text-muted-foreground text-caption">{hint}</span> : null}
    </Tag>
  );
}

export const inputClass = cn(
  "border-input bg-card text-foreground text-body-s w-full min-w-0 rounded-sm border px-2.5 py-2",
  "outline-none focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_var(--teal-tint),0_0_0_1px_var(--ring)]",
);

export function Select({
  value,
  onChange,
  options,
  id,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  id?: string;
  placeholder?: string;
  className?: string;
  /** Needed when the select is not inside a Field (filters, inline pickers). */
  "aria-label"?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass, className)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Yes / no as a two-option radio group — the pattern the forms use. */
export function YesNo({
  value,
  onChange,
  name,
  yes = "Yes",
  no = "No",
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  name: string;
  yes?: string;
  no?: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex gap-1.5">
      {[
        [true, yes],
        [false, no],
      ].map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v as boolean)}
          className={cn(
            "text-body-s rounded-sm border px-3 py-1.5 transition-colors duration-100",
            value === v
              ? "border-teal-700 bg-teal-50 text-teal-900"
              : "border-input hover:bg-muted text-foreground",
          )}
        >
          {label as string}
        </button>
      ))}
    </div>
  );
}

/**
 * Consequence first (§4 rule 7): what the change touches, a reason, then the button. The reason is
 * the audit row's.
 */
export function ConfirmBlock({
  consequence,
  verb,
  onConfirm,
  pending,
  minReason = 8,
  tone = "neutral",
}: {
  consequence: ReactNode;
  verb: string;
  onConfirm: (reason: string) => void;
  pending: boolean;
  minReason?: number;
  tone?: "neutral" | "caution";
}) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {verb}…
      </Button>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3",
        tone === "caution"
          ? "border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20"
          : "border-border bg-muted/40",
      )}
    >
      <div className="text-body-s text-foreground">{consequence}</div>
      <Field label="Why (kept in the audit log)">
        <input
          id="confirm-reason"
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="A few words"
          maxLength={280}
        />
      </Field>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || reason.trim().length < minReason}
          onClick={() => onConfirm(reason.trim())}
        >
          {pending ? "Saving…" : verb}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

/** "Occupancy arrives with the inpatient module." — the one honest line (Law 5, H10). */
export function HonestLine({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-body-s italic">{children}</p>;
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Kampala",
  });
export const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00+03:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Kampala",
  });
