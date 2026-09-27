"use client";

import type { AddMedState } from "../../actions";
import { useActionState, useEffect, useRef, useState } from "react";
import { PlusIcon } from "lucide-react";

import {
  ResponsiveSheetBody,
  ResponsiveSheetClose,
  ResponsiveSheetFooter,
} from "@/components/responsive/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMedicationAction } from "../../actions";

const PATTERNS = [
  { value: "once_daily", label: "Once a day" },
  { value: "twice_daily", label: "Twice a day" },
  { value: "thrice_daily", label: "Three times a day" },
  { value: "as_needed", label: "As needed" },
  { value: "custom", label: "Custom" },
] as const;

/** `AddMedSchema` rejects a seventh time, so the UI never offers one. */
export const MAX_DOSE_TIMES = 6;

/**
 * The times each pattern starts with — deliberately the same guesses
 * `DEFAULT_TIMES` in `lib/patient/doses.ts` makes when a medicine has none.
 * The difference is everything: here the patient sees them, changes them and
 * confirms them before they are written, so the timeline reports a schedule
 * instead of presuming one.
 */
const PATTERN_TIMES: Record<string, string[]> = {
  once_daily: ["08:00"],
  twice_daily: ["08:00", "20:00"],
  thrice_daily: ["08:00", "14:00", "20:00"],
  custom: ["08:00"],
  as_needed: [],
};

export interface DoseTimesFieldsProps {
  /** "HH:MM" entries; a blank entry is an input the patient has not filled. */
  times: string[];
  onChange: (next: string[]) => void;
  /** Unique per medication — two of these can be open on one page. */
  idPrefix: string;
  /**
   * The repeated form-field name to post under. Omitted when the value goes
   * to a server action as an array instead of through a form submit.
   */
  name?: string;
}

/**
 * Up to six native `<input type="time">`. Native beats a picker library here
 * by a distance: it is the control the patient's own phone already uses for
 * an alarm, it is keyboard- and screen-reader-complete, it enforces the
 * 24-hour shape the action parses, and it costs nothing to ship.
 *
 * There is no per-row delete button. Clearing an input is how a time is
 * removed — blanks are dropped on the way to the database — which keeps one
 * 44px target per time instead of two.
 */
export function DoseTimesFields({ times, onChange, idPrefix, name }: DoseTimesFieldsProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-caption font-medium">Times you take it</span>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {times.map((time, index) => (
          <Input
            // Position is the identity here: the list is short, ordered by the
            // patient's own entry, and re-keying on value would blur the input
            // out from under them mid-edit.
            key={`${idPrefix}-${index}`}
            id={`${idPrefix}-time-${index}`}
            type="time"
            name={name}
            value={time}
            aria-label={`Dose time ${index + 1}`}
            onChange={(event) => {
              onChange(times.map((value, i) => (i === index ? event.target.value : value)));
            }}
            className="tabular h-11 font-mono"
          />
        ))}
      </div>

      {times.length < MAX_DOSE_TIMES ? (
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 w-fit"
          onClick={() => onChange([...times, ""])}
        >
          <PlusIcon />
          Add a time
        </Button>
      ) : null}

      <p className="text-muted-foreground text-caption leading-relaxed">
        24-hour times, up to {MAX_DOSE_TIMES} a day. Clear a time to remove it.
      </p>
    </div>
  );
}

/**
 * Add a medication. Lives inside the page's `?add=1` sheet, so it owns the
 * sheet's body and footer — the submit control belongs to the same `<form>`
 * as the fields, and a footer button outside the form would not submit it.
 */
export function AddMedicationForm({ onAdded }: { onAdded?: () => void }) {
  const [state, formAction, pending] = useActionState<AddMedState, FormData>(
    addMedicationAction,
    {} as AddMedState,
  );
  const formRef = useRef<HTMLFormElement | null>(null);
  const [pattern, setPattern] = useState<string>("once_daily");
  const [times, setTimes] = useState<string[]>(PATTERN_TIMES.once_daily ?? []);

  // Only the DOM form is reset here. `pattern` and `times` need no reset:
  // `onAdded` closes the sheet, which unmounts this form, so the next open
  // starts from the defaults anyway.
  useEffect(() => {
    if (!state.ok) return;
    formRef.current?.reset();
    onAdded?.();
  }, [state.ok, onAdded]);

  // An as-needed medicine never gets a dose slot, so times would be a setting
  // with no effect. Hide the row rather than collect a value we ignore.
  const schedulable = pattern !== "as_needed";

  return (
    <form ref={formRef} action={formAction} className="flex min-h-0 flex-1 flex-col">
      <ResponsiveSheetBody className="flex flex-col gap-4">
        <div className="flex flex-col">
          <Label htmlFor="med-name">Name</Label>
          <Input id="med-name" name="name" placeholder="e.g. Metformin" maxLength={120} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <Label htmlFor="med-dose">Dose (optional)</Label>
            <Input id="med-dose" name="dose" placeholder="500 mg" maxLength={60} />
          </div>
          <div className="flex flex-col">
            <Label htmlFor="med-pattern">How often</Label>
            <select
              id="med-pattern"
              name="schedule_pattern"
              value={pattern}
              onChange={(event) => {
                const next = event.target.value;
                setPattern(next);
                setTimes(PATTERN_TIMES[next] ?? []);
              }}
              // `Input`'s recipe plus the system focus ring and the 44px floor
              // the time inputs and "Add a time" in this very form already keep.
              className="border-input bg-card text-foreground text-body-s focus-visible:border-ring focus-visible:shadow-focus ease-expo-out min-h-11 rounded-sm border px-2.5 py-2 transition-all duration-150 outline-none"
            >
              {PATTERNS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {schedulable ? (
          // `ncd-reveal` fades the fields in without animating the box, so the
          // instructions field below moves exactly once.
          <div className="ncd-reveal">
            <DoseTimesFields
              times={times}
              onChange={setTimes}
              idPrefix="med-new"
              name="schedule_times"
            />
          </div>
        ) : null}

        <div className="flex flex-col">
          <Label htmlFor="med-instructions">Instructions (optional)</Label>
          <Input
            id="med-instructions"
            name="instructions"
            placeholder="With food, in the morning…"
            maxLength={240}
          />
        </div>

        {state.error ? (
          <p role="alert" className="text-destructive ncd-reveal text-body-s leading-relaxed">
            {state.error}
          </p>
        ) : null}
      </ResponsiveSheetBody>

      <ResponsiveSheetFooter>
        <ResponsiveSheetClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </ResponsiveSheetClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add medication"}
        </Button>
      </ResponsiveSheetFooter>
    </form>
  );
}
