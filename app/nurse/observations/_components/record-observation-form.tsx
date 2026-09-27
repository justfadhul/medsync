"use client";

import type { NurseActionState } from "../../actions";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { HeartPulseIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordObservationAction } from "../../actions";

const KINDS = [
  { value: "bp", label: "BP", inputs: 2, unit: "mmHg" },
  { value: "hr", label: "HR", inputs: 1, unit: "bpm" },
  { value: "temperature", label: "Temp", inputs: 1, unit: "°C" },
  { value: "rr", label: "RR", inputs: 1, unit: "bpm" },
  { value: "spo2", label: "SpO₂", inputs: 1, unit: "%" },
  { value: "glucose", label: "Glucose", inputs: 1, unit: "mmol/L" },
  { value: "pain", label: "Pain", inputs: 1, unit: "0-10" },
  { value: "weight", label: "Weight", inputs: 1, unit: "kg" },
  { value: "intake", label: "Intake", inputs: 1, unit: "ml" },
  { value: "output", label: "Output", inputs: 1, unit: "ml" },
  { value: "gcs", label: "GCS", inputs: 1, unit: "/15" },
  { value: "other", label: "Other", inputs: 1, unit: "" },
] as const;

type Kind = (typeof KINDS)[number]["value"];

export function RecordObservationForm({ patientUserId }: { patientUserId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<NurseActionState, FormData>(
    recordObservationAction,
    {},
  );
  const [kind, setKind] = useState<Kind>("bp");

  const meta = KINDS.find((k) => k.value === kind)!;

  if (state.ok) {
    return (
      <div className="border-border bg-card scale-in ring-brand-500/10 flex flex-col items-start gap-3 rounded-lg border p-5 ring-1">
        <span
          aria-hidden
          className="scale-in bg-iris-tint text-iris-icon inline-flex size-9 items-center justify-center rounded-full"
          style={{ animationDelay: "90ms" }}
        >
          <HeartPulseIcon className="size-4" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-foreground text-[14px] font-medium">Observation recorded</span>
          <span className="text-muted-foreground text-[12px]">
            It&rsquo;s now visible on the patient summary.
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
      <input type="hidden" name="observation_kind" value={kind} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          What are you recording?
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              aria-pressed={kind === k.value}
              className={
                kind === k.value
                  ? "tap select-flare bg-brand-600 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm"
                  : "tap border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-muted/40 rounded-full border px-3.5 py-1.5 text-[12px] transition-colors"
              }
            >
              {k.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label className="text-caption tracking-tight">Value</Label>
        <div className="flex items-center gap-2">
          <Input
            name="numeric_value_1"
            inputMode="decimal"
            placeholder={kind === "bp" ? "Systolic" : "Value"}
            className="text-body-m font-mono tabular-nums"
            required
          />
          {meta.inputs === 2 ? (
            <>
              <span className="text-muted-foreground font-mono">/</span>
              <Input
                name="numeric_value_2"
                inputMode="decimal"
                placeholder="Diastolic"
                className="text-body-m font-mono tabular-nums"
                required
              />
            </>
          ) : null}
          {meta.unit ? (
            <>
              {/* key re-pops the unit label when the vital changes */}
              <span key={kind} className="scale-in text-muted-foreground text-caption font-mono">
                {meta.unit}
              </span>
              <input type="hidden" name="unit" value={meta.unit} />
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="obs-notes" className="text-caption tracking-tight">
          Notes (optional)
        </Label>
        <textarea
          id="obs-notes"
          name="notes"
          rows={2}
          maxLength={2000}
          placeholder="e.g. taken sitting, post-meal, technique notes"
          className="border-input bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-ring/50 focus-visible:border-ring text-body-s resize-none rounded-md border px-3 py-2 leading-relaxed outline-none focus-visible:ring-[3px]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="obs-reason" className="text-caption tracking-tight">
          Audit note (≥ 8 chars)
        </Label>
        <Input
          id="obs-reason"
          name="reason"
          minLength={8}
          maxLength={200}
          defaultValue="Bedside observation."
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
        <Button type="submit" className="tap" disabled={pending}>
          {pending ? "Recording…" : "Record observation"}
        </Button>
      </div>
    </form>
  );
}
