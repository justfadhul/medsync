"use client";

import type { PolicyFormState } from "../actions";
import { useActionState, useState } from "react";
import { CheckCircle2Icon, InfoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SheetBody,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { updateDepartmentPolicyAction } from "../actions";

/**
 * Department scheduling-policy editor.
 *
 * One department at a time, chosen from a plain select. Every field mirrors a
 * DB CHECK, and submit is blocked on anything the database would reject —
 * a form that posts a value Postgres refuses is a 500 where the operator was
 * owed a sentence.
 *
 * Two things this screen has to make legible, because neither is obvious from
 * the field names:
 *
 *   1. Saving a policy for a department that has none is a NARROWING.
 *      Absence of a row means no restriction (ADR 0084 §14) — walk-ins open,
 *      booking bounded only by each clinician's own availability. The first
 *      save closes the days and hours left unticked.
 *
 *   2. The reminder count is a per-booking message count, not a preference.
 */

/** ISO weekdays — 1 = Monday … 7 = Sunday, matching availability_blocks. */
export const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

export interface DepartmentPolicyOption {
  departmentId: string;
  departmentName: string;
  /** Null when this department has no policy row — i.e. is unrestricted. */
  policy: {
    defaultSlotMinutes: number;
    defaultBufferMinutes: number;
    defaultAutoConfirm: boolean;
    bookableWeekdays: number[];
    bookableStartMinutesLocal: number;
    bookableEndMinutesLocal: number;
    reminderLeadMinutes: number[];
    allowVirtual: boolean;
    notes: string | null;
  } | null;
}

interface Values {
  slot: number;
  buffer: number;
  autoConfirm: boolean;
  weekdays: number[];
  start: string;
  end: string;
  twoReminders: boolean;
  allowVirtual: boolean;
  notes: string;
}

/**
 * The shape shown when a department has no policy row. These are the column
 * defaults, so "save without changing anything" writes what the table would
 * have written — except the reminder plan, which migration 0052 moves to a
 * single 24h message.
 */
const UNSET: Omit<NonNullable<DepartmentPolicyOption["policy"]>, "notes"> = {
  defaultSlotMinutes: 15,
  defaultBufferMinutes: 0,
  defaultAutoConfirm: false,
  bookableWeekdays: [1, 2, 3, 4, 5],
  bookableStartMinutesLocal: 480,
  bookableEndMinutesLocal: 1020,
  reminderLeadMinutes: [1440],
  allowVirtual: false,
};

function toValues(option: DepartmentPolicyOption): Values {
  const p = option.policy ?? { ...UNSET, notes: null };
  return {
    slot: p.defaultSlotMinutes,
    buffer: p.defaultBufferMinutes,
    autoConfirm: p.defaultAutoConfirm,
    weekdays: [...p.bookableWeekdays].sort((a, b) => a - b),
    start: timeFromMinutes(p.bookableStartMinutesLocal),
    end: timeFromMinutes(p.bookableEndMinutesLocal),
    twoReminders: p.reminderLeadMinutes.length > 1,
    allowVirtual: p.allowVirtual,
    notes: p.notes ?? "",
  };
}

/** 480 → "08:00". Staff surface, so a clock numeral is read by someone
 *  fluent in the system's conventions (ADR 0084 §10 scopes the day-part rule
 *  to patient surfaces). */
export function timeFromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function minutesFromTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h > 23 || m > 59 ? null : h * 60 + m;
}

export const INPUT_CLASS =
  "border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]";

export function PolicyForm({
  departments,
  onClose,
}: {
  departments: ReadonlyArray<DepartmentPolicyOption>;
  /** Present when the form sits in a dialog: the footer's way out. */
  onClose?: () => void;
}) {
  const [state, formAction, pending] = useActionState<PolicyFormState, FormData>(
    updateDepartmentPolicyAction,
    {},
  );
  const [departmentId, setDepartmentId] = useState(departments[0]?.departmentId ?? "");
  const [values, setValues] = useState<Values>(() =>
    departments[0]
      ? toValues(departments[0])
      : toValues({ departmentId: "", departmentName: "", policy: null }),
  );

  const active = departments.find((d) => d.departmentId === departmentId);
  const isNew = !active?.policy;

  function selectDepartment(id: string) {
    const next = departments.find((d) => d.departmentId === id);
    if (!next) return;
    setDepartmentId(id);
    setValues(toValues(next));
  }

  const startMinutes = minutesFromTime(values.start);
  const endMinutes = minutesFromTime(values.end);

  // Every reason the database would refuse this row, checked here first.
  // `Number.isInteger` before the range test, not after: an emptied number
  // input gives NaN, and NaN fails every comparison — so `NaN < 5 || NaN > 240`
  // is false and a bare range check waves it through to a server-side 400.
  const errors: string[] = [];
  if (!Number.isInteger(values.slot) || values.slot < 5 || values.slot > 240)
    errors.push("Slot length must be a whole number of minutes, 5–240.");
  if (!Number.isInteger(values.buffer) || values.buffer < 0 || values.buffer > 60)
    errors.push("Turnaround must be a whole number of minutes, 0–60.");
  if (startMinutes === null || endMinutes === null)
    errors.push("Opening and closing times are required.");
  else if (endMinutes <= startMinutes) errors.push("Closing time must be after opening time.");
  if (values.weekdays.length === 0)
    errors.push(
      "Pick at least one day. A department with no bookable days takes no bookings and no app walk-ins.",
    );

  // The closed form of buildSlots' loop — `for (s = start; s + slot <= end;
  // s += slot + buffer)` — so the number shown is the number that will be
  // offered, not an approximation of it. A per-clinician ceiling: each
  // clinician's declared availability and own overrides narrow it further.
  const windowMinutes =
    startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : 0;
  const step = values.slot + values.buffer;
  const slotsPerDay =
    errors.length === 0 && windowMinutes >= values.slot
      ? Math.floor((windowMinutes - values.slot) / step) + 1
      : 0;

  if (departments.length === 0) {
    return (
      <section className="border-border bg-card flex flex-col gap-2 rounded-lg border p-6">
        <h2 className="text-foreground text-heading-s">No departments yet</h2>
        <p className="text-muted-foreground text-body-s leading-relaxed">
          Booking policy is set per department. Add a department to this hospital first, then come
          back and set its bookable hours.
        </p>
      </section>
    );
  }

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <SheetTitle>Department booking policy</SheetTitle>
        <SheetDescription>
          Slot length, hours and reminders per department. A clinician&rsquo;s own settings override
          the slot mechanics; the days and hours always apply.
        </SheetDescription>
      </SheetHeader>

      <SheetBody className="grid items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="department_id" className="text-caption tracking-tight">
            Department
          </Label>
          <select
            id="department_id"
            name="department_id"
            value={departmentId}
            onChange={(e) => selectDepartment(e.target.value)}
            className={INPUT_CLASS}
          >
            {departments.map((d) => (
              <option key={d.departmentId} value={d.departmentId}>
                {d.departmentName}
                {d.policy ? "" : " — no policy set"}
              </option>
            ))}
          </select>
        </div>

        {isNew ? (
          <p className="border-border bg-muted/50 text-muted-foreground text-body-s flex items-start gap-2 rounded-md border p-3 leading-relaxed lg:col-span-2">
            <InfoIcon className="text-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="text-foreground font-medium">No policy yet — unrestricted.</span>{" "}
              Saving narrows it: unticked days and hours stop accepting bookings.
            </span>
          </p>
        ) : null}

        {/* Slot mechanics */}
        <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
          <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Appointment length
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="default_slot_minutes" className="text-caption tracking-tight">
                Slot length (minutes)
              </Label>
              <Input
                id="default_slot_minutes"
                name="default_slot_minutes"
                type="number"
                inputMode="numeric"
                min={5}
                max={240}
                required
                value={values.slot}
                aria-invalid={values.slot < 5 || values.slot > 240}
                onChange={(e) => setValues((v) => ({ ...v, slot: Number(e.target.value) }))}
              />
              <span className="text-muted-foreground text-caption">5–240.</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="default_buffer_minutes" className="text-caption tracking-tight">
                Turnaround between patients (minutes)
              </Label>
              <Input
                id="default_buffer_minutes"
                name="default_buffer_minutes"
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                required
                value={values.buffer}
                aria-invalid={values.buffer < 0 || values.buffer > 60}
                onChange={(e) => setValues((v) => ({ ...v, buffer: Number(e.target.value) }))}
              />
              <span className="text-muted-foreground text-caption">0–60.</span>
            </div>
          </div>
          <p className="text-muted-foreground text-body-s leading-relaxed">
            At these settings a clinician working the full window is offered{" "}
            <span className="text-foreground font-mono tabular-nums">{slotsPerDay}</span>{" "}
            {slotsPerDay === 1 ? "slot" : "slots"} a day. That is the ceiling — each
            clinician&rsquo;s declared availability narrows it.
          </p>
        </fieldset>

        {/* Open days + hours */}
        <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
          <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Bookable days &amp; hours
          </legend>
          <div className="flex flex-col gap-1.5">
            <span
              id="weekday-label"
              className="text-caption text-foreground font-medium tracking-tight"
            >
              Days open
            </span>
            <div role="group" aria-labelledby="weekday-label" className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day) => {
                const checked = values.weekdays.includes(day.value);
                return (
                  <label
                    key={day.value}
                    className={[
                      "text-body-s ease-expo-out cursor-pointer rounded-md border px-3 py-2 transition-colors duration-150",
                      "focus-within:border-ring focus-within:shadow-[0_0_0_2px_rgba(132,118,231,0.18)]",
                      checked
                        ? "border-brand-300 bg-accent text-accent-foreground font-medium"
                        : "border-input bg-background text-muted-foreground hover:border-gray-300",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      name="bookable_weekdays"
                      value={day.value}
                      checked={checked}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          weekdays: e.target.checked
                            ? [...v.weekdays, day.value].sort((a, b) => a - b)
                            : v.weekdays.filter((w) => w !== day.value),
                        }))
                      }
                      className="sr-only"
                    />
                    {day.label}
                  </label>
                );
              })}
            </div>
            <span className="text-muted-foreground text-caption">
              Ticked days accept bookings and app walk-ins. Unticked days accept neither.
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bookable_start_local" className="text-caption tracking-tight">
                Opens (East Africa Time)
              </Label>
              <Input
                id="bookable_start_local"
                name="bookable_start_local"
                type="time"
                step={300}
                required
                value={values.start}
                onChange={(e) => setValues((v) => ({ ...v, start: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bookable_end_local" className="text-caption tracking-tight">
                Closes (East Africa Time)
              </Label>
              <Input
                id="bookable_end_local"
                name="bookable_end_local"
                type="time"
                step={300}
                required
                value={values.end}
                aria-invalid={
                  startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes
                }
                onChange={(e) => setValues((v) => ({ ...v, end: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-body-s leading-relaxed">
            A whole appointment has to fit inside the window, so the last slot offered is the last
            one that ends by closing time.
          </p>
        </fieldset>

        {/* Reminders — the spend lever */}
        <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
          <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Reminders
          </legend>
          <p className="text-muted-foreground text-body-s leading-relaxed">
            Every reminder is one message per booking. Reminders queue in-app today — nothing is
            billed until SMS goes live — but this setting is what will be billed, per appointment,
            for every booking this department takes.
          </p>
          <div className="flex flex-col gap-2">
            <label
              className={[
                "text-body-s ease-expo-out flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors duration-150",
                "focus-within:border-ring focus-within:shadow-[0_0_0_2px_rgba(132,118,231,0.18)]",
                values.twoReminders
                  ? "border-input bg-background hover:border-gray-300"
                  : "border-brand-300 bg-accent",
              ].join(" ")}
            >
              <input
                type="radio"
                name="reminder_plan"
                value="one"
                checked={!values.twoReminders}
                onChange={() => setValues((v) => ({ ...v, twoReminders: false }))}
                className="accent-brand-600 mt-0.5 size-4"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-foreground font-medium">
                  One reminder — 24 hours before{" "}
                  <span className="text-muted-foreground font-normal">(recommended)</span>
                </span>
                <span className="text-muted-foreground text-caption leading-relaxed">
                  One message per booking. The day-before message is the one that reaches a patient
                  while the decision to travel is still open.
                </span>
              </span>
            </label>
            <label
              className={[
                "text-body-s ease-expo-out flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors duration-150",
                "focus-within:border-ring focus-within:shadow-[0_0_0_2px_rgba(132,118,231,0.18)]",
                values.twoReminders
                  ? "border-brand-300 bg-accent"
                  : "border-input bg-background hover:border-gray-300",
              ].join(" ")}
            >
              <input
                type="radio"
                name="reminder_plan"
                value="two"
                checked={values.twoReminders}
                onChange={() => setValues((v) => ({ ...v, twoReminders: true }))}
                className="accent-brand-600 mt-0.5 size-4"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-foreground font-medium">
                  Two reminders — 24 hours and 1 hour before
                </span>
                <span className="text-muted-foreground text-caption leading-relaxed">
                  Two messages per booking — double the cost. The one-hour message arrives after
                  most patients have already travelled or already decided not to.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {/* Confirmation + virtual */}
        <fieldset className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4">
          <legend className="text-muted-foreground -ml-1 px-1 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Defaults
          </legend>
          <label className="text-body-s flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="default_auto_confirm"
              checked={values.autoConfirm}
              onChange={(e) => setValues((v) => ({ ...v, autoConfirm: e.target.checked }))}
              className="accent-brand-600 mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-foreground font-medium">Confirm requests automatically</span>
              <span className="text-muted-foreground text-caption leading-relaxed">
                Off means a clinician reviews every request before it becomes an appointment. A
                clinician who has set their own preference keeps it.
              </span>
            </span>
          </label>
          <label className="text-body-s flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="allow_virtual"
              checked={values.allowVirtual}
              onChange={(e) => setValues((v) => ({ ...v, allowVirtual: e.target.checked }))}
              className="accent-brand-600 mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-foreground font-medium">Allow virtual appointments</span>
              <span className="text-muted-foreground text-caption leading-relaxed">
                Patients may request a virtual visit with clinicians in this department.
              </span>
            </span>
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes" className="text-caption tracking-tight">
              Notes (optional)
            </Label>
            <Input
              id="notes"
              name="notes"
              maxLength={500}
              value={values.notes}
              placeholder="e.g. Friday clinic is teaching-only from 14:00"
              onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <Label htmlFor="reason" className="text-caption tracking-tight">
            Audit note
          </Label>
          <Input
            id="reason"
            name="reason"
            minLength={8}
            required
            placeholder="Why this change — at least 8 characters"
            defaultValue=""
          />
          <span className="text-muted-foreground text-caption">Goes to the audit log.</span>
        </div>

        {errors.length > 0 ? (
          <ul className="border-alert-border bg-alert-bg text-alert-fg text-body-s flex flex-col gap-1 rounded-md border p-3 lg:col-span-2">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}

        {state.error ? (
          <p
            role="alert"
            className="border-alert-border bg-alert-bg text-alert-fg text-body-s rounded-md border p-3 lg:col-span-2"
          >
            {state.error}
          </p>
        ) : null}

        {state.ok ? (
          <p
            role="status"
            className="border-border bg-status-stable-bg text-status-stable-fg text-body-s flex items-center gap-2 rounded-md border p-3 lg:col-span-2"
          >
            <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
            {state.created
              ? "Policy created — this department is now restricted to the days and hours above."
              : "Policy saved."}
          </p>
        ) : null}
      </SheetBody>

      <SheetFooter>
        {onClose ? (
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Close
          </Button>
        ) : null}
        <Button type="submit" disabled={pending || errors.length > 0}>
          {pending ? "Saving…" : isNew ? "Create policy" : "Save policy"}
        </Button>
      </SheetFooter>
    </form>
  );
}
