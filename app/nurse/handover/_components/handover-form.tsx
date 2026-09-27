"use client";

import type { NurseActionState } from "../../actions";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { ScrollTextIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitHandoverAction } from "../../actions";

interface WardOption {
  id: string;
  name: string;
}

const SHIFTS = [
  { value: "day", label: "Day" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
  { value: "custom", label: "Custom" },
] as const;

export function HandoverForm({ wards }: { wards: ReadonlyArray<WardOption> }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<NurseActionState, FormData>(
    submitHandoverAction,
    {},
  );

  if (state.ok) {
    return (
      <div className="border-border bg-card scale-in ring-brand-500/10 flex flex-col items-start gap-3 rounded-lg border p-5 ring-1">
        <span
          aria-hidden
          className="scale-in bg-iris-tint text-iris-icon inline-flex size-9 items-center justify-center rounded-full"
          style={{ animationDelay: "90ms" }}
        >
          <ScrollTextIcon className="size-4" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-foreground text-[14px] font-medium">Handover submitted</span>
          <span className="text-muted-foreground text-[12px]">
            The next shift can read it in the handover list.
          </span>
        </div>
        <Button type="button" onClick={() => router.refresh()}>
          Done
        </Button>
      </div>
    );
  }

  if (wards.length === 0) {
    return (
      <div className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4">
        <p className="text-foreground text-body-s font-medium">No wards set up yet</p>
        <p className="text-muted-foreground text-[12px]">
          A handover is per-ward. Your hospital admin sets up wards under{" "}
          <span className="font-mono">Departments</span> — once a ward exists you can submit.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ward" className="text-caption tracking-tight">
            Ward
          </Label>
          <select
            id="ward"
            name="ward_id"
            required
            defaultValue={wards[0]?.id ?? ""}
            className="border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]"
          >
            {wards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shift" className="text-caption tracking-tight">
            Shift
          </Label>
          <select
            id="shift"
            name="shift_label"
            defaultValue="day"
            className="border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]"
          >
            {SHIFTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="summary" className="text-caption tracking-tight">
          What does the next shift need to know?
        </Label>
        <textarea
          id="summary"
          name="summary"
          rows={6}
          required
          minLength={8}
          maxLength={8000}
          placeholder="Patients of concern, pending tasks, dressings due, awaiting results, family notifications…"
          className="border-input bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-ring/50 focus-visible:border-ring text-body-s resize-none rounded-md border px-3 py-2 leading-relaxed outline-none focus-visible:ring-[3px]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ho-reason" className="text-caption tracking-tight">
          Audit note (≥ 8 chars)
        </Label>
        <Input
          id="ho-reason"
          name="reason"
          minLength={8}
          maxLength={200}
          defaultValue="End-of-shift handover."
          required
        />
      </div>

      {state.error ? (
        <p className="text-destructive border-destructive/30 bg-destructive/5 scale-in rounded-md border px-3 py-2 text-[12px]">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end">
        <Button type="submit" className="tap" disabled={pending}>
          {pending ? "Submitting…" : "Submit handover"}
        </Button>
      </div>
    </form>
  );
}
