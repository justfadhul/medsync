"use client";

import type { CancelSessionState, SessionDelayState } from "../actions";
import type { ClinicSessionRow } from "./clinic-sessions-section";
import { useActionState, useEffect, useState } from "react";

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
import { cancelSessionAction, setSessionDelayAction } from "../actions";

/**
 * What the desk can do to one clinic day (Gate E, ADR 0090): say it is
 * running late, or cancel it. The cancel is two steps on purpose — the
 * first submit is a dry run that answers "how many people this touches",
 * and only the second, with that number on screen, does it (PRD §3.2.6).
 */
export function SessionActions({
  session,
  onClose,
}: {
  session: ClinicSessionRow;
  onClose: () => void;
}) {
  const live = session.status === "published";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <SheetTitle>
          {session.serviceLineName} · {session.dateLabel}
        </SheetTitle>
        <SheetDescription>
          {session.timeLabel} · {session.clinicianName ?? "no clinician named"} ·{" "}
          {session.bookedCount} booked
        </SheetDescription>
      </SheetHeader>

      <SheetBody className="grid items-start gap-6 sm:grid-cols-2">
        {live ? <DelayForm session={session} /> : null}
        {live || session.status === "draft" ? (
          <CancelForm session={session} onDone={onClose} />
        ) : (
          <p className="text-muted-foreground text-body-s">
            This clinic day is {session.status}; nothing here applies to it.
          </p>
        )}
      </SheetBody>

      <SheetFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </SheetFooter>
    </div>
  );
}

function DelayForm({ session }: { session: ClinicSessionRow }) {
  const [state, formAction, pending] = useActionState<SessionDelayState, FormData>(
    setSessionDelayAction,
    {},
  );
  return (
    <form
      action={formAction}
      className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4"
    >
      <input type="hidden" name="session_id" value={session.id} />
      <div className="flex flex-col gap-1">
        <h3 className="text-foreground text-body-m font-medium">Running late</h3>
        <p className="text-muted-foreground text-body-s leading-relaxed">
          Moves every un-arrived patient&rsquo;s arrival window by the change. A message goes to
          them when the window moves by 30 minutes or more.
          {session.delayMinutes > 0 ? ` Currently ${session.delayMinutes} minutes late.` : ""}
        </p>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="delay-minutes" className="text-caption tracking-tight">
            Late by (minutes)
          </Label>
          <Input
            id="delay-minutes"
            name="delay_minutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={480}
            step={5}
            defaultValue={session.delayMinutes}
            required
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Set"}
        </Button>
      </div>
      {state.ok ? (
        <p className="text-brand-700 dark:text-brand-300 text-body-s" role="status">
          Saved. {state.notified ?? 0} {state.notified === 1 ? "patient" : "patients"} messaged.
        </p>
      ) : null}
      {state.error ? (
        <p
          role="alert"
          className="border-alert-border bg-alert-bg text-alert-fg text-body-s rounded-md border p-3"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function CancelForm({ session, onDone }: { session: ClinicSessionRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<CancelSessionState, FormData>(
    cancelSessionAction,
    {},
  );
  // Controlled: React resets an uncontrolled form after its action, which wiped the reason between the count
  // and the confirm, so the second press was blocked by `required`.
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const preview = state.preview;
  return (
    <form
      action={formAction}
      className="border-border bg-background/40 flex flex-col gap-3 rounded-md border p-4"
    >
      <input type="hidden" name="session_id" value={session.id} />
      <div className="flex flex-col gap-1">
        <h3 className="text-foreground text-body-m font-medium">Cancel this clinic day</h3>
        <p className="text-muted-foreground text-body-s leading-relaxed">
          Every booked patient is told by push and SMS, with the next {session.serviceLineName} day
          offered to them in one tap. Their places are released. This cannot be undone.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cancel-reason" className="text-caption tracking-tight">
          Why
        </Label>
        <Input
          id="cancel-reason"
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={10}
          required
          placeholder="At least 10 characters — recorded in the audit log"
        />
      </div>

      {preview ? (
        // The count, before anyone confirms. Amber: a scheduling event, not
        // an emergency. Text carries the state, not the colour.
        <div className="bg-status-caution-bg text-status-caution-fg ring-status-caution-fg/25 flex flex-col gap-2 rounded-md p-3 ring-1">
          <p className="text-body-s font-medium">
            {preview.affected === 0
              ? "Nobody is booked on this day."
              : `${preview.affected} ${preview.affected === 1 ? "patient holds" : "patients hold"} a place on this day.`}
          </p>
          <p className="text-body-s">
            {preview.nextSessionStartsAtIso
              ? `They will be offered ${NEXT_DAY.format(new Date(preview.nextSessionStartsAtIso))}.`
              : "No later day of this clinic is open yet — they will be asked to choose another day."}
          </p>
          <label className="text-body-s flex items-center gap-2">
            <input type="checkbox" name="confirm" className="accent-brand-600 size-4" required />
            <span>I have read the number above and want to cancel this day.</span>
          </label>
        </div>
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="border-alert-border bg-alert-bg text-alert-fg text-body-s rounded-md border p-3"
        >
          {state.error}
        </p>
      ) : null}

      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending
          ? preview
            ? "Cancelling…"
            : "Counting…"
          : preview
            ? `Cancel the day (${preview.affected} affected)`
            : "See who this affects"}
      </Button>
    </form>
  );
}

const NEXT_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Kampala",
  weekday: "long",
  day: "numeric",
  month: "long",
});
