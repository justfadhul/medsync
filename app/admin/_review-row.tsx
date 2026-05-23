"use client";

import type { ReviewState } from "./actions";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * One review row for the admin queues (GATE F).
 *
 * Renders the target row's summary plus a collapsible reason input and
 * Approve / Reject buttons. The same component is used for both
 * staff_affiliations and hospital_applications — pass the right
 * approve/reject action and the row's id.
 *
 * Why a single component for both queues: the review surface is
 * functionally identical (id + reason; outcome flipped in the action).
 * Splitting into two would just duplicate the layout + reason input.
 */
export interface ReviewRowProps {
  id: string;
  title: string;
  meta: ReadonlyArray<{ label: string; value: string }>;
  approveAction: (state: ReviewState, formData: FormData) => Promise<ReviewState>;
  rejectAction: (state: ReviewState, formData: FormData) => Promise<ReviewState>;
}

export function ReviewRow({ id, title, meta, approveAction, rejectAction }: ReviewRowProps) {
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [approveState, approve, approving] = useActionState<ReviewState, FormData>(
    approveAction,
    {},
  );
  const [rejectState, reject, rejecting] = useActionState<ReviewState, FormData>(rejectAction, {});

  const error = mode === "approve" ? approveState.error : rejectState.error;
  const ok = (mode === "approve" && approveState.ok) || (mode === "reject" && rejectState.ok);
  const isPending = approving || rejecting;

  if (ok) {
    return (
      <article className="border-border bg-card flex items-center justify-between rounded-md border p-4 opacity-70">
        <span className="text-foreground text-[13px]">
          {title} ·{" "}
          <span
            className={mode === "approve" ? "text-teal-600 dark:text-teal-400" : "text-destructive"}
          >
            {mode === "approve" ? "approved" : "rejected"}
          </span>
        </span>
      </article>
    );
  }

  return (
    <article className="border-border bg-card flex flex-col gap-3 rounded-md border p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-foreground text-[14px] font-medium">{title}</h3>
      </header>
      <dl className="grid grid-cols-1 gap-1.5 text-[12.5px] sm:grid-cols-2">
        {meta.map((m) => (
          <div key={m.label} className="flex gap-2">
            <dt className="text-muted-foreground">{m.label}:</dt>
            <dd className="text-foreground/85 truncate">{m.value}</dd>
          </div>
        ))}
      </dl>

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" size="sm" onClick={() => setMode("approve")}>
            Approve
          </Button>
          <Button type="button" variant="alert" size="sm" onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      ) : (
        <form action={mode === "approve" ? approve : reject} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={id} />
          <label
            htmlFor={`reason-${id}-${mode}`}
            className="text-muted-foreground text-[11px] font-medium tracking-[0.01em]"
          >
            {mode === "approve"
              ? "Reason for approval (visible in audit log; ≥ 8 chars)"
              : "Reason for rejection (shown to the applicant; ≥ 8 chars)"}
          </label>
          <Input
            id={`reason-${id}-${mode}`}
            name="reason"
            placeholder={
              mode === "approve"
                ? "e.g. licence verified with UMDPC"
                : "e.g. registration number not found"
            }
            minLength={8}
            required
            aria-invalid={!!error || undefined}
          />
          {error ? <p className="text-destructive text-[11.5px]">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={mode === "approve" ? "primary" : "alert"}
              size="sm"
              disabled={isPending}
            >
              {isPending
                ? "Submitting…"
                : mode === "approve"
                  ? "Confirm approval"
                  : "Confirm rejection"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </article>
  );
}

/* Surface cn so static analysis doesn't strip the dependency in
 * environments that hoist imports aggressively. Used implicitly by
 * other admin pieces. */
void cn;
