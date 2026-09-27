"use client";

import type { BreakGlassState } from "../actions";
import type { ComboboxItem } from "@/components/forms";
import { useActionState, useState } from "react";

import { Combobox, Field, SegmentedControl } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { openBreakGlassAction } from "../actions";

const CATEGORY_OPTIONS = [
  { value: "emergency", label: "Emergency" },
  { value: "regulator_request", label: "Regulator request" },
  { value: "safety_review", label: "Safety review" },
  { value: "research_per_pdc", label: "Research (PDC approved)" },
  { value: "other", label: "Other" },
];

const MINUTES_OPTIONS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "60 min" },
];

export function OpenBreakGlassForm({ patients }: { patients: ReadonlyArray<ComboboxItem> }) {
  const [state, action, pending] = useActionState<BreakGlassState, FormData>(
    openBreakGlassAction,
    {},
  );
  const [patientId, setPatientId] = useState<string | null>(null);

  return (
    <form
      action={action}
      className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-foreground text-[16px] font-medium tracking-tight">Open a new grant</h2>
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          Time-boxed · audited · notified
        </span>
      </header>

      <Field name="patient_id" label="Patient" required>
        <Combobox
          name="patient_id"
          items={patients}
          placeholder="Pick a patient (by code)…"
          onValueChange={(v) => setPatientId(v)}
        />
      </Field>

      <Field name="category" label="Category" required>
        <SegmentedControl
          name="category"
          ariaLabel="Category"
          defaultValue="emergency"
          options={CATEGORY_OPTIONS}
        />
      </Field>

      <Field
        name="purpose"
        label="Purpose (≥ 16 chars — be specific; this opens PHI)"
        description="The purpose is recorded as the audit reason and shown to the affected hospital admin."
        required
      >
        <textarea
          name="purpose"
          minLength={16}
          required
          rows={3}
          placeholder="e.g. PDPO follow-up on case MS-2026-00184; confirm dispensing chain for amlodipine refills"
          className="border-input bg-card text-body-s focus-visible:border-ring w-full rounded-sm border px-2.5 py-2 leading-snug outline-none focus-visible:shadow-[0_0_0_3px_var(--teal-tint),0_0_0_1px_var(--ring)]"
        />
      </Field>

      <Field name="minutes" label="Grant duration" required>
        <SegmentedControl
          name="minutes"
          ariaLabel="Duration"
          defaultValue="15"
          options={MINUTES_OPTIONS}
        />
      </Field>

      {state.error ? (
        <p
          role="alert"
          className="text-destructive border-destructive bg-alert-bg rounded-sm border px-3 py-2 text-[12.5px]"
        >
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="border-brand-500/40 bg-brand-50/40 text-brand-800 dark:text-brand-200 rounded-sm border px-3 py-2 text-[12.5px]">
          Grant opened. Audit + notification recorded. Grant id: {state.grantId}
        </p>
      ) : null}

      <div>
        <Button type="submit" variant="primary" size="md" disabled={pending || !patientId}>
          {pending ? "Opening…" : "Open break-glass grant"}
        </Button>
      </div>
    </form>
  );
}
