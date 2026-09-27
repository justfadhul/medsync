"use client";

import type { ActionState } from "../actions";
import type { AvailabilityRow } from "../page";
import type { AvailabilityKind } from "@/db/schema/scheduling";
import type { ChangeEvent } from "react";
import { useActionState, useEffect, useState } from "react";
import { Trash2Icon } from "lucide-react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { HUE, kindTone } from "@/components/scheduling/calendar/tones";
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
import { cn } from "@/lib/utils";
import { cancelAvailabilityBlockAction, setAvailabilityBlockAction } from "../actions";

const KIND_OPTIONS: ReadonlyArray<{ value: AvailabilityKind; label: string; hint: string }> = [
  { value: "bookable", label: "Bookable", hint: "Patients can book this." },
  { value: "teaching", label: "Teaching", hint: "Recorded. Does not block booking." },
  { value: "ward_round", label: "Ward round", hint: "Recorded. Does not block booking." },
  { value: "admin", label: "Admin", hint: "Recorded. Does not block booking." },
  { value: "leave", label: "Leave", hint: "Subtracts from bookable time." },
  { value: "unavailable", label: "Unavailable", hint: "Subtracts from bookable time." },
  {
    value: "custom",
    label: "Custom",
    hint: "Your own name for it. Drawn on your calendar; does not stop a booking.",
  },
];

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

interface FormSheetProps {
  open: boolean;
  block: AvailabilityRow | null;
  onOpenChange: (open: boolean) => void;
}

export function AvailabilityFormSheet({ open, block, onOpenChange }: FormSheetProps) {
  return (
    <EditorDialog width="medium" open={open} onOpenChange={onOpenChange}>
      <div className="flex min-h-0 flex-1 flex-col">
        {open ? (
          <FormContent key={block?.id ?? "new"} block={block} onClose={() => onOpenChange(false)} />
        ) : null}
      </div>
    </EditorDialog>
  );
}

function FormContent({ block, onClose }: { block: AvailabilityRow | null; onClose: () => void }) {
  const isEdit = !!block;
  const [kind, setKind] = useState<AvailabilityKind>(block?.kind ?? "bookable");
  const [recurrence, setRecurrence] = useState<"none" | "weekly">(
    (block?.recurrence as "none" | "weekly" | undefined) ?? "none",
  );
  const [weekday, setWeekday] = useState<number>(
    block?.recurrenceWeekday ?? (new Date().getDay() || 7),
  );

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setAvailabilityBlockAction,
    {},
  );
  const [cancelState, cancelAction, cancelPending] = useActionState<ActionState, FormData>(
    cancelAvailabilityBlockAction,
    {},
  );
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    if (state.ok || cancelState.ok) onClose();
  }, [state.ok, cancelState.ok, onClose]);

  // datetime-local needs YYYY-MM-DDTHH:mm in LOCAL time (no offset).
  const defaultStarts = block
    ? toDatetimeLocal(new Date(block.startsAtIso))
    : toDatetimeLocal(roundToNextHour(new Date()));
  const defaultEnds = block
    ? toDatetimeLocal(new Date(block.endsAtIso))
    : toDatetimeLocal(addHours(roundToNextHour(new Date()), 1));

  const KindIcon = kindTone(kind).icon;

  return (
    <>
      <SheetHeader>
        {/* The chosen kind's icon tile, in the calendar's own tone for it (tones.ts). */}
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "ease-expo-out grid size-9 shrink-0 place-items-center rounded-[10px] border transition-colors duration-150",
              HUE[kindTone(kind).hue].chip,
            )}
          >
            <KindIcon className={cn("size-4", HUE[kindTone(kind).hue].icon)} />
          </span>
          <SheetTitle>{isEdit ? "Edit block" : "Add availability"}</SheetTitle>
        </div>
        <SheetDescription>
          {isEdit
            ? "Update the block, then save. Cancelling a bookable block with live appointments is refused — reschedule those first."
            : "Declare a time window. Bookable blocks become slots patients can book, and Leave or Unavailable subtracts from them. Teaching, ward rounds, admin and your own custom blocks are recorded but do not stop a booking."}
        </SheetDescription>
      </SheetHeader>

      <SheetBody>
        <form action={formAction} className="flex flex-col gap-5" id="availability-form">
          {isEdit ? <input type="hidden" name="block_id" value={block.id} /> : null}

          <div className="flex flex-col gap-2">
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-2">
              {KIND_OPTIONS.map((k) => (
                <label
                  key={k.value}
                  className={
                    "border-border hover:bg-muted/30 tap flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors " +
                    (kind === k.value
                      ? "select-flare border-brand-500/60 bg-brand-50/50 ring-brand-500/15 ring-1"
                      : "")
                  }
                >
                  <input
                    type="radio"
                    name="kind"
                    value={k.value}
                    checked={kind === k.value}
                    onChange={() => setKind(k.value)}
                    className="accent-brand-600 mt-0.5 size-4"
                  />
                  <div className="flex flex-col">
                    <span className="text-foreground text-body-s inline-flex items-center gap-1.5 font-medium">
                      <OptionIcon kind={k.value} />
                      {k.label}
                    </span>
                    <span className="text-muted-foreground text-caption leading-tight">
                      {k.hint}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* A custom block IS its name (0065 CHECK: custom ⇒ label). */}
          {kind === "custom" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="label">Name</Label>
              <Input
                id="label"
                name="label"
                required
                maxLength={40}
                placeholder="e.g. Clinic at Kiruddu"
                defaultValue={block?.label ?? ""}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="starts_at_local">Starts</Label>
              <input
                id="starts_at_local"
                name="starts_at_local"
                type="datetime-local"
                required
                defaultValue={defaultStarts}
                className="border-border text-foreground text-body-s focus-visible:ring-ring rounded-md border bg-transparent px-2.5 py-1.5 outline-none focus-visible:ring-2"
                onChange={syncIsoHidden("starts_at")}
              />
              <input type="hidden" name="starts_at" defaultValue={toIso(defaultStarts)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ends_at_local">Ends</Label>
              <input
                id="ends_at_local"
                name="ends_at_local"
                type="datetime-local"
                required
                defaultValue={defaultEnds}
                className="border-border text-foreground text-body-s focus-visible:ring-ring rounded-md border bg-transparent px-2.5 py-1.5 outline-none focus-visible:ring-2"
                onChange={syncIsoHidden("ends_at")}
              />
              <input type="hidden" name="ends_at" defaultValue={toIso(defaultEnds)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="availability-recurrence">Recurrence</Label>
            <div className="flex items-center gap-2">
              <select
                id="availability-recurrence"
                name="recurrence"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as "none" | "weekly")}
                className="border-border text-foreground text-body-s focus-visible:ring-ring rounded-md border bg-transparent px-2 py-1.5 outline-none focus-visible:ring-2"
              >
                <option value="none">One-off</option>
                <option value="weekly">Repeat weekly</option>
              </select>
              {recurrence === "weekly" ? (
                <select
                  aria-label="Weekday"
                  name="recurrence_weekday"
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                  className="border-border text-foreground text-body-s focus-visible:ring-ring rounded-md border bg-transparent px-2 py-1.5 outline-none focus-visible:ring-2"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      every {d.label}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="location">Location (optional)</Label>
            <Input
              id="location"
              name="location"
              placeholder="e.g. IM Clinic Room 3"
              defaultValue={block?.location ?? ""}
              maxLength={160}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="notes">Notes (optional)</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={block?.notes ?? ""}
              maxLength={1000}
              className="border-border text-foreground placeholder:text-muted-foreground text-body-s focus-visible:ring-ring min-h-16 resize-y rounded-md border bg-transparent px-2.5 py-1.5 outline-none focus-visible:ring-2"
              placeholder="Visible only to you + your admins."
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="reason">
              Reason <span className="text-muted-foreground font-normal">(≥ 8 chars, audited)</span>
            </Label>
            <Input
              id="reason"
              name="reason"
              required
              minLength={8}
              placeholder={
                isEdit
                  ? "e.g. Moving start time to align with new clinic."
                  : "e.g. Adding Friday IM clinic."
              }
              aria-invalid={!!state.error}
            />
            {state.error ? (
              <p role="alert" className="text-caption text-red-700 dark:text-red-300">
                {state.error}
              </p>
            ) : null}
          </div>
        </form>

        {isEdit && confirmingCancel ? (
          <form
            action={cancelAction}
            className="reveal-up mt-5 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-800/40 dark:bg-amber-950/20"
          >
            <input type="hidden" name="block_id" value={block.id} />
            <p className="text-body-s font-medium text-amber-900 dark:text-amber-200">
              Cancel this block?
            </p>
            <p className="text-caption leading-relaxed text-amber-900/80 dark:text-amber-100/80">
              Bookable blocks with live appointments can&apos;t be cancelled — reschedule those
              first. Every other kind (teaching, ward round, admin, leave, unavailable, custom)
              cancels unconditionally.
            </p>
            <Input
              name="reason"
              required
              minLength={8}
              autoFocus
              placeholder="Reason for cancelling (≥ 8 chars)"
              aria-invalid={!!cancelState.error}
            />
            {cancelState.error ? (
              <p role="alert" className="text-caption text-red-700 dark:text-red-300">
                {cancelState.error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingCancel(false)}
                disabled={cancelPending}
                className="min-h-11"
              >
                Keep block
              </Button>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={cancelPending}
                className="min-h-11"
              >
                {cancelPending ? "Cancelling…" : "Confirm cancel"}
              </Button>
            </div>
          </form>
        ) : null}
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
        {isEdit ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmingCancel(true)}
            disabled={confirmingCancel}
          >
            <Trash2Icon className="size-3.5" />
            Cancel block…
          </Button>
        ) : null}
        <Button type="submit" form="availability-form" variant="primary" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add block"}
        </Button>
      </SheetFooter>
    </>
  );
}

/* ─── helpers ─────────────────────────────────────────────────────── */

function toDatetimeLocal(d: Date): string {
  // YYYY-MM-DDTHH:mm in the browser's local timezone.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(local: string): string {
  // Treat local string as the user's local time → UTC ISO.
  return new Date(local).toISOString();
}

function roundToNextHour(d: Date): Date {
  const out = new Date(d);
  out.setMinutes(0, 0, 0);
  out.setHours(out.getHours() + 1);
  return out;
}

function addHours(d: Date, h: number): Date {
  const out = new Date(d);
  out.setHours(out.getHours() + h);
  return out;
}

/** Mirror the visible datetime-local input into a hidden ISO input. */
function syncIsoHidden(name: "starts_at" | "ends_at") {
  return (e: ChangeEvent<HTMLInputElement>) => {
    const form = e.currentTarget.form;
    if (!form) return;
    const hidden = form.querySelector(
      `input[type="hidden"][name="${name}"]`,
    ) as HTMLInputElement | null;
    if (hidden && e.currentTarget.value) {
      hidden.value = toIso(e.currentTarget.value);
    }
  };
}

function OptionIcon({ kind }: { kind: string }) {
  const tone = kindTone(kind);
  const Icon = tone.icon;
  return <Icon className={cn("size-3.5 shrink-0", HUE[tone.hue].icon)} aria-hidden />;
}
