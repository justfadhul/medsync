"use client";

import type { NurseActionState } from "../../actions";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, PillIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { administerMedicationAction } from "../../actions";

const ROUTES = [
  { value: "oral", label: "Oral" },
  { value: "iv", label: "IV" },
  { value: "im", label: "IM" },
  { value: "sc", label: "SC" },
  { value: "topical", label: "Topical" },
  { value: "inhaled", label: "Inhaled" },
  { value: "pr", label: "PR" },
  { value: "other", label: "Other" },
] as const;

const STATES = [
  { value: "administered", label: "Administered" },
  { value: "withheld", label: "Withheld" },
  { value: "refused", label: "Patient refused" },
  { value: "wasted", label: "Wasted" },
] as const;

export function AdministerForm({
  patientUserId,
  isEnrolled,
}: {
  patientUserId: string;
  isEnrolled: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<NurseActionState, FormData>(
    administerMedicationAction,
    {},
  );
  const [isHighAlert, setIsHighAlert] = useState(false);
  const [recordState, setRecordState] = useState<
    "administered" | "withheld" | "refused" | "wasted"
  >("administered");
  const [confirmed, setConfirmed] = useState(false);

  if (state.ok) {
    return (
      <div
        className={
          state.queuedForReview
            ? "border-border bg-card scale-in flex flex-col items-start gap-3 rounded-lg border p-5 ring-1 ring-amber-500/15"
            : "border-border bg-card scale-in ring-brand-500/10 flex flex-col items-start gap-3 rounded-lg border p-5 ring-1"
        }
      >
        <span
          aria-hidden
          style={{ animationDelay: "90ms" }}
          className={
            state.queuedForReview
              ? "scale-in inline-flex size-9 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              : "scale-in bg-iris-tint text-iris-icon inline-flex size-9 items-center justify-center rounded-full"
          }
        >
          {state.queuedForReview ? (
            <AlertTriangleIcon className="size-4" />
          ) : (
            <CheckCircle2Icon className="size-4" />
          )}
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-foreground text-[14px] font-medium">
            {state.queuedForReview ? "Queued for senior co-sign" : "Administration recorded"}
          </span>
          <span className="text-muted-foreground max-w-[52ch] text-[12px] leading-relaxed">
            {state.queuedForReview
              ? "A high-alert administration as an enrolled nurse routes for senior review. The patient's MAR will update once a registered nurse or in-charge approves."
              : "It's now on the patient's MAR."}
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={() => router.push(`/nurse/patients/${patientUserId}`)}>
            Open patient
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.refresh()}>
            Record another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="patient_user_id" value={patientUserId} />
      <input type="hidden" name="state" value={recordState} />
      <input type="hidden" name="is_high_alert" value={isHighAlert ? "true" : "false"} />

      {/* Drug + dose */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="drug" className="text-caption tracking-tight">
            Drug
          </Label>
          <Input id="drug" name="drug_name" placeholder="e.g. Metformin" maxLength={240} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dose" className="text-caption tracking-tight">
            Dose
          </Label>
          <Input id="dose" name="dose" placeholder="e.g. 500 mg" maxLength={120} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route" className="text-caption tracking-tight">
            Route
          </Label>
          <select
            id="route"
            name="route"
            defaultValue="oral"
            required
            className="border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]"
          >
            {ROUTES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* State */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-caption tracking-tight">Outcome</Label>
        <div className="flex flex-wrap gap-1.5">
          {STATES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setRecordState(s.value)}
              aria-pressed={recordState === s.value}
              className={
                recordState === s.value
                  ? "tap select-flare bg-brand-600 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm"
                  : "tap border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-muted/40 rounded-full border px-3.5 py-1.5 text-[12px] transition-colors"
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {recordState !== "administered" ? (
        <div className="reveal-up flex flex-col gap-1.5">
          <Label htmlFor="withheld" className="text-caption tracking-tight">
            Reason (required)
          </Label>
          <Input id="withheld" name="withheld_reason" placeholder="Why?" maxLength={500} required />
        </div>
      ) : null}

      {/* High-alert */}
      <label className="tap flex cursor-pointer items-start gap-3 rounded-md border border-rose-500/30 bg-rose-50/40 px-3 py-2.5 transition-colors hover:bg-rose-50/70 dark:bg-rose-950/15 dark:hover:bg-rose-950/25">
        <input
          type="checkbox"
          checked={isHighAlert}
          onChange={(e) => setIsHighAlert(e.target.checked)}
          className="mt-0.5 size-4 accent-rose-600"
        />
        <span className="flex flex-1 flex-col">
          <span className="text-foreground text-body-s inline-flex items-center gap-1.5 font-medium">
            <AlertTriangleIcon className="size-3.5 text-rose-600" aria-hidden />
            High-alert medication
          </span>
          <span className="text-muted-foreground text-[11.5px] leading-relaxed">
            Insulin, opioids, anticoagulants, concentrated electrolytes, oxytocics, NMBs, chemo,
            paeds IV.
            {isEnrolled ? (
              <>
                {" "}
                As an enrolled nurse, this will{" "}
                <strong>route to a registered nurse / ward in-charge</strong> for co-sign before the
                MAR row lands.
              </>
            ) : (
              <> The patient&rsquo;s MAR records the high-alert flag.</>
            )}
          </span>
        </span>
      </label>

      {/* 5-rights confirmation */}
      <label
        className={
          confirmed
            ? "tap select-flare border-brand-500/40 bg-brand-50/40 dark:bg-brand-950/20 flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors"
            : "tap border-border bg-card hover:bg-muted/30 flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors"
        }
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="accent-brand-600 mt-0.5 size-4"
        />
        <span className="flex flex-1 flex-col">
          <span className="text-foreground text-body-s font-medium">
            I have confirmed the 5 rights
          </span>
          <span className="text-muted-foreground text-[11.5px]">
            Right patient · right drug · right dose · right route · right time.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mar-notes" className="text-caption tracking-tight">
          Notes (optional)
        </Label>
        <textarea
          id="mar-notes"
          name="notes"
          rows={2}
          maxLength={2000}
          className="border-input bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-ring/50 focus-visible:border-ring text-body-s resize-none rounded-md border px-3 py-2 leading-relaxed outline-none focus-visible:ring-[3px]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mar-reason" className="text-caption tracking-tight">
          Audit note (≥ 8 chars)
        </Label>
        <Input
          id="mar-reason"
          name="reason"
          minLength={8}
          maxLength={200}
          defaultValue="Bedside medication administration."
          required
        />
      </div>

      {state.error ? (
        <p className="text-destructive border-destructive/30 bg-destructive/5 scale-in rounded-md border px-3 py-2 text-[12px]">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" className="tap" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" className="tap" disabled={pending || !confirmed}>
          <PillIcon className="size-3.5" aria-hidden />
          {pending
            ? "Recording…"
            : recordState === "administered"
              ? "Record administration"
              : `Record ${recordState}`}
        </Button>
      </div>
    </form>
  );
}
