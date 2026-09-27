"use client";

import type { ProposeActionState } from "../../actions";
import { useActionState } from "react";
import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { proposeClinicalAction } from "../../actions";

interface Props {
  patientUserId: string;
  patientCode: string;
  /** Capability for this action+doctor — drives the framing. */
  requirement: "allowed" | "cosign_required" | "blocked";
  actionKind: "prescription_routine" | "prescription_controlled";
}

const ACTION_LABEL: Record<Props["actionKind"], string> = {
  prescription_routine: "Routine prescription",
  prescription_controlled: "Controlled-substance prescription",
};

export function ProposeForm({ patientUserId, patientCode, requirement, actionKind }: Props) {
  const [state, formAction] = useActionState<ProposeActionState, FormData>(
    proposeClinicalAction,
    {} as ProposeActionState,
  );

  if (requirement === "blocked") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-50/40 p-5 dark:border-amber-400/20 dark:bg-amber-950/15">
        <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-amber-900 dark:text-amber-200">
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          {ACTION_LABEL[actionKind]} is above your current scope
        </span>
        <p className="max-w-[56ch] text-[12.5px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
          Please ask your supervisor to author it. (Supervision is normal training — it isn&rsquo;t
          a failing.) Your supervisor is named on your overview page.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="patient_user_id" value={patientUserId} />
      <input type="hidden" name="action_kind" value={actionKind} />

      {requirement === "cosign_required" ? (
        <div className="border-border bg-muted text-foreground rounded-md border p-3">
          <p className="text-brand-900 dark:text-brand-200 text-[12.5px] leading-relaxed">
            This {ACTION_LABEL[actionKind].toLowerCase()} will go to your supervisor for review
            before it takes effect. You&rsquo;ll see the decision on your tasks list.
          </p>
        </div>
      ) : null}

      <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
        <h3 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          Proposed for {patientCode}
        </h3>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="drug_name" className="text-caption tracking-tight">
              Drug name
            </Label>
            <Input id="drug_name" name="drug_name" placeholder="e.g. Metformin" maxLength={120} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dose" className="text-caption tracking-tight">
              Dose
            </Label>
            <Input id="dose" name="dose" placeholder="e.g. 500 mg" maxLength={60} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="route" className="text-caption tracking-tight">
              Route
            </Label>
            <Input id="route" name="route" placeholder="oral / IV / IM" maxLength={40} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duration" className="text-caption tracking-tight">
              Duration
            </Label>
            <Input id="duration" name="duration" placeholder="e.g. 7 days BD" maxLength={60} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reason" className="text-caption tracking-tight">
            Clinical reason
          </Label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            required
            minLength={8}
            maxLength={500}
            placeholder="Brief clinical justification. Goes to the reviewer + the audit log."
            className="border-input bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-ring/50 focus-visible:border-ring text-body-s resize-none rounded-md border px-3 py-2 leading-relaxed shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
          />
        </div>
      </div>

      {state.error ? (
        <p className="text-destructive border-destructive/30 bg-destructive/5 scale-in rounded-md border px-3 py-2 text-[12px] leading-relaxed">
          {state.error}
        </p>
      ) : null}
      {state.ok && state.outcome === "queued_for_review" ? (
        <p className="scale-in border-border bg-muted text-foreground flex items-start gap-1.5 rounded-md border px-3 py-2 text-[12.5px] leading-relaxed">
          <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Queued for your supervisor&rsquo;s review. You&rsquo;ll see the decision on your tasks.
        </p>
      ) : null}
      {state.ok && state.outcome === "executed" ? (
        <p className="scale-in border-border bg-muted text-foreground flex items-start gap-1.5 rounded-md border px-3 py-2 text-[12.5px] leading-relaxed">
          <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Recorded. (Real prescribing engine ships with the clinical module.)
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="submit">
          {requirement === "cosign_required" ? "Send for supervisor review" : "Record prescription"}
        </Button>
      </div>
    </form>
  );
}
