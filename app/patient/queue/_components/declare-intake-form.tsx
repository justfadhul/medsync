"use client";

import type { DeclareIntakeState } from "../actions";
import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { declareIntakeAction } from "../actions";

export interface DepartmentOption {
  id: string;
  name: string;
  openNow: boolean;
  /** Why it is closed if `!openNow` — surfaced verbatim, never invented. */
  reason: string | null;
}

interface Props {
  departments: ReadonlyArray<DepartmentOption>;
  hospitalName: string;
  /** ADR 0098: the catalog report this place in line is for, if it came from one. */
  submissionId?: string | null;
}

/**
 * The one POST behind the same-day door (ADR 0084 §2): department, an optional
 * note, submit. The page has already surfaced the existing-intake and
 * existing-booking paths, so this handles the happy path and error recovery.
 *
 * **The department stops being a wait-shopping decision (§5).** No count is
 * rendered against any department, ever: "Cardiology · 34 in line" against
 * "General Medicine · 4 in line" prices a differential by wait, and choosing
 * between them is a clinical judgement the patient was never equipped to make.
 *
 * **What §5 actually asks for is a default we cannot yet resolve.** It wants
 * the hospital's general-outpatient / assessment department pre-selected, with
 * the rest behind a plain disclosure for returning patients who know their
 * clinic — mirroring the building, where everyone passes assessment first. No
 * such row exists at Mulago and no column marks one: `hospital_departments` is
 * (id, hospital_id, parent_id, name, slug), and the seed (migration 0005) is
 * Internal Medicine plus 13 sub-specialties. Guessing the default from the
 * NAME would be a heuristic deciding where a patient is sent, which is exactly
 * what §5 forbids.
 *
 * So the honest interim, in the ADR's own terms — ask only when the default
 * cannot be resolved:
 *
 *   - **One department open** → nothing to ask. It is named, not chosen, and
 *     travels in a hidden field. (This is Mulago today: the picker lists
 *     top-level departments only, and the seed has exactly one.)
 *   - **More than one** → we ask, as a flat unpriced list. Every count is
 *     gone, but the question itself survives until the default row lands.
 *
 * When a default arrives, the fixed branch below becomes its home and the list
 * moves behind the disclosure; the ask branch is what gets deleted.
 */
export function DeclareIntakeForm({ departments, hospitalName, submissionId = null }: Props) {
  const [state, action, pending] = useActionState<DeclareIntakeState, FormData>(
    declareIntakeAction,
    {},
  );

  const open = departments.filter((d) => d.openNow);

  // §11. Every department is inside a scheduling policy that has closed for
  // the evening, and the patient has already said they are coming today.
  // Handing them a calendar is under-triage by routing, so the primary exit is
  // the building and booking is a plain link under it.
  if (open.length === 0) {
    return (
      <section
        aria-labelledby="closed-heading"
        className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs"
      >
        <h2 id="closed-heading" className="text-heading-s">
          Go to the hospital.
        </h2>
        {/* The clause "the emergency entrance is open at all hours" belongs
            here only where someone has verified it for this hospital. Nothing
            in the database records that, so it is not written. */}
        <p className="text-foreground text-body-m">Reception can register you when you arrive.</p>
        <Link
          href="/patient/book"
          className="text-primary text-body-s duration-fast ease-expo-out -my-2 inline-flex min-h-11 w-fit items-center rounded-md underline-offset-4 transition-colors hover:underline"
        >
          Ask for a day — the clinic confirms
        </Link>
      </section>
    );
  }

  const only = open.length === 1 ? open[0] : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {submissionId ? (
        <input type="hidden" name="symptom_submission_id" value={submissionId} />
      ) : null}
      {only ? (
        <>
          <input type="hidden" name="receiving_department_id" value={only.id} />
          <div className="bg-card dark:shadow-card flex flex-col gap-1 rounded-xl p-4 shadow-xs">
            <span className="text-muted-foreground text-caption">Where you are going</span>
            <span className="text-foreground text-body-m font-medium">{only.name}</span>
            <span className="text-muted-foreground text-body-s">{hospitalName}</span>
          </div>
        </>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-heading-s mb-2">Which clinic were you told to go to?</legend>
          {/* A native radio, visible rather than sr-only: it is the control a
              patient recognises, and `required` then blocks the submit and
              focuses it without a line of JavaScript. */}
          {/* Tiles, not rows: fourteen clinics fit one screen. A closed clinic
              stays on the grid, disabled, with its reason — the patient told
              to go there has to see it is the clinic that is shut. */}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((d) => (
              <li key={d.id} className="min-w-0">
                <label
                  className={cn(
                    "tap bg-card dark:shadow-card flex min-h-12 items-center gap-2.5 rounded-lg px-3 py-2 shadow-xs",
                    d.openNow ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                    "has-[:checked]:bg-accent has-[:checked]:ring-brand-300 has-[:checked]:ring-1",
                    "has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                    "md:hover:brightness-[0.98] dark:md:hover:brightness-110",
                  )}
                >
                  <input
                    type="radio"
                    name="receiving_department_id"
                    value={d.id}
                    required
                    disabled={!d.openNow}
                    className="accent-brand-600 size-4 shrink-0"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-foreground text-body-s truncate font-medium">
                      {d.name}
                    </span>
                    {d.reason ? (
                      <span className="text-muted-foreground text-caption truncate">
                        {d.reason}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <div className="flex flex-col">
        <Label htmlFor="presenting_complaint">
          What brings you in?{" "}
          <span className="text-muted-foreground/70 font-normal">(optional)</span>
        </Label>
        <textarea
          id="presenting_complaint"
          name="presenting_complaint"
          rows={3}
          maxLength={500}
          placeholder="A short note helps the team prepare — e.g. follow-up for diabetes, persistent cough for 3 days."
          className="border-input bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-ring/50 focus-visible:border-ring text-body-s rounded-md border p-3 shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
        />
      </div>

      {/* The server's own message, verbatim. A 409 carries the row that blocked
          it, so the patient gets the way to it rather than a dead end. */}
      {state.error ? (
        <div className="flex flex-col gap-1">
          <p role="alert" className="text-destructive text-body-s ncd-reveal">
            {state.error}
          </p>
          {state.existing_appointment_id ? (
            <Link
              href="/patient/appointments"
              className="text-primary text-body-s duration-fast ease-expo-out -my-2 inline-flex min-h-11 w-fit items-center rounded-md underline-offset-4 transition-colors hover:underline"
            >
              See today&rsquo;s visit
            </Link>
          ) : null}
          {state.existing_intake_id ? (
            <Link
              href={`/patient/queue/${state.existing_intake_id}`}
              className="text-primary text-body-s duration-fast ease-expo-out -my-2 inline-flex min-h-11 w-fit items-center rounded-md underline-offset-4 transition-colors hover:underline"
            >
              See the place we saved
            </Link>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Save a place in line"}
      </Button>
    </form>
  );
}
