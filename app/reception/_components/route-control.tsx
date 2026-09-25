"use client";

import type { ReceptionActionState } from "../actions";
import { useActionState, useState } from "react";
import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { checkInDeclaredIntakeAction, checkInPatientAction } from "../actions";

/**
 * Where an arrival goes (ADR 0101): a department, then a door — triage (the
 * default, so the primary button) or straight to the clinic's queue. Which
 * door is an administrative choice, never an acuity call; the Edge Function
 * still triages any emergency entry whatever is pressed.
 *
 * One control for every arrival the desk meets: a declared ticket
 * (`intakeId`), a booking checked in at the counter, or a patient who marked
 * themselves arrived (`appointmentId`). Lives at the workspace root because
 * both Expected and Find use it.
 */
export function RouteControl({
  appointmentId,
  intakeId,
  departments,
  defaultDepartmentId,
  patientLabel,
}: {
  departments: ReadonlyArray<{ id: string; name: string }>;
  /** The declared or booked department — the default, and what triage falls back to. */
  defaultDepartmentId: string | null;
  /** Name or code of the person this control sends — part of each button's
   * accessible name, so a screen reader hears which row has focus. */
  patientLabel: string;
} & ({ appointmentId: string; intakeId?: never } | { intakeId: string; appointmentId?: never })) {
  const [state, formAction, pending] = useActionState<ReceptionActionState, FormData>(
    intakeId ? checkInDeclaredIntakeAction : checkInPatientAction,
    {},
  );
  // Which button was pressed, so only that one says "Sending…".
  const [pressed, setPressed] = useState<"triage" | "clinic">("triage");

  if (state.ok) {
    return (
      <span
        role="status"
        className="bg-brand-50 text-brand-700 ring-brand-200/70 text-caption inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium ring-1"
      >
        <CheckIcon className="size-3" aria-hidden />
        {state.route === "clinic" ? "Sent to clinic" : "Sent to triage"}
      </span>
    );
  }

  const selectId = `route-dept-${intakeId ?? appointmentId}`;
  return (
    <form action={formAction} className="flex flex-col items-stretch gap-1.5">
      {intakeId ? (
        <input type="hidden" name="intake_id" value={intakeId} />
      ) : (
        <input type="hidden" name="appointment_id" value={appointmentId} />
      )}
      <label htmlFor={selectId} className="sr-only">
        Department for {patientLabel}
      </label>
      <select
        id={selectId}
        name="department_id"
        defaultValue={defaultDepartmentId ?? ""}
        className="border-input bg-background text-body-s h-11 min-w-44 rounded-md border px-3"
      >
        {/* Only offered when nothing was declared: a department once chosen
            is the clinic's door, and "none" would queue them nowhere. */}
        {defaultDepartmentId ? null : <option value="">Triage decides the department</option>}
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="submit"
          name="route"
          value="triage"
          size="sm"
          className="tap min-h-11 px-4"
          disabled={pending}
          onClick={() => setPressed("triage")}
          aria-label={`Send to triage: ${patientLabel}`}
        >
          {pending && pressed === "triage" ? "Sending…" : "Send to triage"}
        </Button>
        <Button
          type="submit"
          name="route"
          value="clinic"
          variant="secondary"
          size="sm"
          className="tap min-h-11 px-4"
          disabled={pending}
          onClick={() => setPressed("clinic")}
          aria-label={`Send to clinic: ${patientLabel}`}
        >
          {pending && pressed === "clinic" ? "Sending…" : "Send to clinic"}
        </Button>
      </div>
      {state.error ? (
        <span role="alert" className="text-destructive text-caption font-mono">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
