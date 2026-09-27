"use client";

import type { PatientIdentity } from "@/components/medsync/patient-identity";
import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangleIcon, ClockIcon, PlayIcon, PlusIcon, UserPlusIcon } from "lucide-react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Panel } from "@/components/medsync/panel";
import { PatientIdentityCard } from "@/components/medsync/patient-identity";
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
import { recordWalkinAction, startEncounterAction } from "../actions";
import { EndVisitButton } from "./end-visit";

export interface QueueRow {
  id: string;
  kind: string;
  state: string;
  arrivedAtIso: string;
  sequenceNumber: number;
  priorityLabel: string | null;
  patientCode: string | null;
  identity: PatientIdentity;
  appointmentId: string | null;
  encounterId: string | null;
  notes: string | null;
}

const KIND_LABEL: Record<string, string> = {
  scheduled_arrival: "Scheduled",
  walk_in: "Walk-in",
  urgent_walk_in: "Urgent walk-in",
};

/**
 * Day-view queue rail. Renders the department's same-day queue
 * entries (waiting + being_seen). The doctor can:
 *   - Call a waiting patient → starts an encounter (ha-start-encounter). A
 *     walk-in has no booking; the function starts it from the queue row.
 *   - End the visit of a patient being seen (ha-complete-encounter)
 *   - Record a new walk-in (ha-record-walkin)
 *
 * The rail is NOT behind ENCOUNTER_ENGINE_LIVE — calling and ending a visit
 * are scheduling acts on the minimal encounter row ha-start-encounter writes.
 * Only the "Open" link to the documentation surface waits for the flag,
 * because that page renders nothing useful until the engine is live.
 */
export function QueueRail({
  entries,
  encounterEngineLive = false,
}: {
  entries: ReadonlyArray<QueueRow>;
  encounterEngineLive?: boolean;
}) {
  const waiting = entries.filter((e) => e.state === "waiting");
  const beingSeen = entries.filter((e) => e.state === "being_seen");

  return (
    // Capped at the calendar's height beside it; the queue scrolls inside.
    <Panel
      title="Today's queue"
      count={entries.length}
      action={<RecordWalkinButton />}
      className="max-h-[max(60svh,520px)] lg:max-h-[min(72svh,760px)]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {/* Being seen */}
        {beingSeen.length > 0 ? (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-muted-foreground text-overline font-mono uppercase">Now seeing</h3>
            <ul className="stagger-children flex flex-col gap-1">
              {beingSeen.map((e) => (
                <li key={e.id}>
                  <QueueChip
                    row={e}
                    variant="being_seen"
                    encounterEngineLive={encounterEngineLive}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Waiting */}
        <section className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-overline font-mono uppercase">
            Waiting · {waiting.length}
          </h3>
          {waiting.length === 0 ? (
            <p className="border-border text-muted-foreground text-body-s rounded-[10px] border border-dashed px-3 py-3">
              No one waiting right now.
            </p>
          ) : (
            <ul className="stagger-children flex flex-col gap-1">
              {waiting.map((e) => (
                <li key={e.id}>
                  <QueueChip row={e} variant="waiting" encounterEngineLive={encounterEngineLive} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Panel>
  );
}

function QueueChip({
  row,
  variant,
  encounterEngineLive,
}: {
  row: QueueRow;
  variant: "waiting" | "being_seen";
  encounterEngineLive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isUrgent = row.kind === "urgent_walk_in";
  const patientLabel = row.identity.displayName ?? row.patientCode ?? "patient";

  function call() {
    setError(null);
    startTransition(async () => {
      const result = await startEncounterAction({
        appointmentId: row.appointmentId ?? undefined,
        queueEntryId: row.appointmentId ? undefined : row.id,
        reason: "Called from queue rail.",
      });
      if (!result.ok) setError(result.error ?? "Couldn't start encounter.");
    });
  }

  return (
    <div
      className={cn(
        "border-border flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors duration-200",
        variant === "being_seen" && "border-blue-500/40 bg-blue-50/40 dark:bg-blue-950/15",
        isUrgent && variant === "waiting" && "border-rose-500/40 bg-rose-50/40 dark:bg-rose-950/15",
        !isUrgent && variant === "waiting" && "hover:bg-ink-25 hover:border-gray-300",
      )}
    >
      <span aria-hidden className="text-muted-foreground text-caption font-mono tabular-nums">
        #{row.sequenceNumber}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <PatientIdentityCard
          patient={row.identity}
          trailing={
            isUrgent ? (
              // The rose tint is never the only carrier of "urgent" — the
              // KIND_LABEL line below spells out "Urgent walk-in" in text.
              <AlertTriangleIcon className="size-3 text-rose-600 dark:text-rose-400" aria-hidden />
            ) : null
          }
        />
        <span className="text-muted-foreground text-caption inline-flex items-center gap-1 font-mono tabular-nums">
          <ClockIcon className="size-2.5" aria-hidden />
          {formatRelative(row.arrivedAtIso)} · {KIND_LABEL[row.kind] ?? row.kind}
        </span>
        {/* The rail orders by acuity before arrival, so the acuity is stated.
            An unexplained reorder is the queue equivalent of colour-alone:
            the doctor sees a patient jump #4 → top with nothing saying why.
            `#{sequenceNumber}` stays the arrival ticket the desk issued. */}
        {row.priorityLabel ? (
          <span className="text-foreground/80 text-caption font-medium">{row.priorityLabel}</span>
        ) : null}
        {row.notes ? (
          <span className="text-muted-foreground/90 text-caption italic">{row.notes}</span>
        ) : null}
        {error ? (
          <span role="alert" className="text-destructive ncd-reveal text-caption">
            {error}
          </span>
        ) : null}
        {/* Only a called row carries the encounter to end — a being_seen row
            from before ADR 0101 may not, and then there is nothing to close. */}
        {variant === "being_seen" && row.encounterId ? (
          <div className="mt-1 flex flex-wrap items-start gap-1.5">
            <EndVisitButton encounterId={row.encounterId} patientLabel={patientLabel} />
            {encounterEngineLive ? (
              <Link
                href={`/doctor/encounters/${row.encounterId}`}
                className="text-foreground hover:bg-muted text-caption inline-flex min-h-11 items-center rounded-sm px-3 font-medium transition-colors"
                aria-label={`Open the encounter for ${patientLabel}`}
              >
                Open
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
      {variant === "waiting" ? (
        // iconSm is 28px — min-h-11/min-w-11 grows only the hit area to the
        // 44px floor; the ghost chrome stays as light as the rail needs.
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          className="min-h-11 min-w-11"
          disabled={pending}
          onClick={call}
          aria-label={`Call ${patientLabel} and start the encounter`}
        >
          <PlayIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function RecordWalkinButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <UserPlusIcon className="size-3.5" aria-hidden />
        Walk-in
      </Button>
      <EditorDialog width="medium" open={open} onOpenChange={setOpen}>
        <div className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>Record a walk-in</SheetTitle>
            <SheetDescription>
              Add a patient who arrived without an appointment to today&rsquo;s queue. Audited.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <RecordWalkinForm onSuccess={() => setOpen(false)} />
          </SheetBody>
        </div>
      </EditorDialog>
    </>
  );
}

function RecordWalkinForm({ onSuccess }: { onSuccess: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [urgent, setUrgent] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    formData.set("urgent", urgent ? "true" : "false");
    startTransition(async () => {
      const result = await recordWalkinAction({}, formData);
      if (!result.ok) {
        setError(result.error ?? "Couldn't record walk-in.");
        return;
      }
      onSuccess();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="patient_user_id" className="text-caption tracking-tight">
          Patient ID (UUID)
        </Label>
        <Input
          id="patient_user_id"
          name="patient_user_id"
          placeholder="A patient picker lands in a polish pass."
          required
          className="text-body-s font-mono"
        />
        <p className="text-muted-foreground text-caption leading-relaxed">
          Paste the patient&rsquo;s UUID for now — the picker ships with the patient-directory
          polish pass.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="walkin-notes" className="text-caption tracking-tight">
          Notes (optional)
        </Label>
        <Input
          id="walkin-notes"
          name="notes"
          placeholder="Anything the next clinician should see at a glance."
          maxLength={500}
        />
      </div>

      <label className="border-border bg-card tap hover:bg-muted/20 flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors">
        <input
          type="checkbox"
          checked={urgent}
          onChange={(e) => setUrgent(e.target.checked)}
          className="mt-0.5 size-4 accent-rose-600"
        />
        <span className="flex flex-1 flex-col">
          <span className="text-foreground text-body-s font-medium">Mark as urgent</span>
          {/* ha-record-walkin assigns sequence_number = (today's count + 1)
              and never sets priority_order, so an urgent walk-in is
              LABELLED, not moved: the rail's acuity key is null for it and
              it sorts by arrival among the other un-triaged entries. Saying
              otherwise would let a doctor assume a re-order the database
              never made. Setting priority_order there is a product call. */}
          <span className="text-muted-foreground text-caption">
            Labels the entry &ldquo;Urgent walk-in&rdquo; for whoever calls next. It keeps its
            arrival position among un-triaged patients — marking it urgent does not move it up.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="walkin-reason" className="text-caption tracking-tight">
          Reason (audited · ≥ 8 chars)
        </Label>
        <Input
          id="walkin-reason"
          name="reason"
          minLength={8}
          maxLength={200}
          defaultValue="Walk-in at reception."
          required
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="text-destructive border-destructive/30 bg-destructive/5 ncd-reveal text-body-s rounded-md border px-3 py-2 leading-relaxed"
        >
          {error}
        </p>
      ) : null}

      <SheetFooter className="px-0">
        <Button type="submit" disabled={pending}>
          {pending ? (
            "Recording…"
          ) : (
            <>
              <PlusIcon className="size-3.5" aria-hidden />
              Record walk-in
            </>
          )}
        </Button>
      </SheetFooter>
    </form>
  );
}

function formatRelative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  return `${diffH}h`;
}
