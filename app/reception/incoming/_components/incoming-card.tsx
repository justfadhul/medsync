"use client";

import type { IncomingActionState } from "../actions";
import type { IncomingPreArrival } from "@/lib/emergency/queries";
import type { ReceptionPatientHit } from "@/lib/reception/queries";
import type { TransportMode } from "@/supabase/functions/_shared/pre-arrival";
import Link from "next/link";
import { useActionState, useEffect, useId, useState } from "react";
import { PhoneIcon } from "lucide-react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { SheetBody, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ETA_BAND_LABEL, TIER_WORD } from "@/supabase/functions/_shared/pre-arrival";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";

/**
 * One pre-alert on the Incoming board (PRD MS-PRD-SYM-001 §8.5; ADR 0098
 * ruling 7). THE ONE reception file that may draw red
 * (tests/design/red-reserved.test.ts): the "Incoming emergency" header and
 * the "Prepare isolation" banner, each a colour paired with its words.
 * Everything on the card is a word — the subject is a descriptor, never a
 * name; the callback number is decrypted server-side for the tel: link.
 */

export type IncomingAction = (
  prev: IncomingActionState,
  formData: FormData,
) => Promise<IncomingActionState>;

export interface IncomingCardActions {
  update: IncomingAction;
  arrived: IncomingAction;
  search: (query: string) => Promise<ReceptionPatientHit[]>;
}

const AUDIENCE_WORD: Record<string, string> = {
  adult: "Adult",
  pregnant: "Adult",
  child_u2m: "Child under 2 months",
  child_2m_5y: "Child 2 months to 5 years",
  child_5_12: "Child 5 to 12 years",
};
const TRANSPORT_WORD: Record<TransportMode, string> = {
  boda: "by boda",
  car: "by car",
  taxi: "by taxi",
  ambulance: "by ambulance",
  walking: "on foot",
};
const STATUS_WORD: Record<string, string> = {
  sent: "Sent",
  seen: "Seen",
  ready: "Ready",
  arrived: "Arrived",
  cancelled: "Cancelled",
  expired: "Expired",
  not_arriving: "Not arriving",
  hoax: "Hoax",
};

/** The hospital's clock, 24-hour — not the host's (UTC on Vercel). */
export function formatClock(d: Date | string): string {
  return new Date(d).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DEFAULT_TIME_ZONE,
  });
}

export function subjectWords(s: IncomingPreArrival["subject"]): string {
  return [
    AUDIENCE_WORD[s.audience] ?? s.audience,
    s.ageBand,
    s.sex && s.sex !== "unknown" ? s.sex : null,
    s.pregnant ? "pregnant" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function IncomingCard({
  row,
  escalatedMinutes,
  departments,
  actions,
  queueHref,
}: {
  row: IncomingPreArrival;
  /** Minutes unacknowledged once past BOARD_ESCALATION_MS; null below it or once seen. */
  escalatedMinutes: number | null;
  departments: ReadonlyArray<{ id: string; name: string }>;
  actions: IncomingCardActions;
  /** Where "awaiting triage" continues for this role. */
  queueHref: string;
}) {
  const emergency = row.tier === "E";
  const escalated = escalatedMinutes !== null;
  const headingId = useId();

  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "border-border bg-card flex flex-col overflow-hidden rounded-lg border",
        // Red only for a genuine emergency; an urgent/routine card escalates in words and a neutral ring.
        escalated &&
          (row.tier === "E" ? "ring-status-critical-fg ring-2" : "ring-foreground ring-2"),
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5",
          emergency ? "bg-status-critical-bg text-status-critical-fg" : "bg-muted text-foreground",
        )}
      >
        <h3 id={headingId} className="text-body-m font-medium">
          {emergency ? "Incoming emergency" : `Incoming · ${TIER_WORD[row.tier]}`}
        </h3>
        <span className="text-body-s font-mono tabular-nums">
          ETA {ETA_BAND_LABEL[row.etaBand]} · {TRANSPORT_WORD[row.transportMode]}
        </span>
        {escalated ? (
          <span role="status" className="text-body-s ml-auto font-medium">
            Unacknowledged {escalatedMinutes} min
          </span>
        ) : null}
      </header>

      {row.isolation ? (
        <p
          role="alert"
          className="bg-status-critical-bg text-status-critical-fg border-border text-body-s border-t px-4 py-2 font-medium"
        >
          Prepare isolation — fever with bleeding
        </p>
      ) : null}

      <div className="flex flex-col gap-3 px-4 py-3">
        <p className="text-foreground text-body-m">{subjectWords(row.subject)}</p>

        {row.redFlags.length > 0 ? (
          <ul aria-label="Danger signs" className="flex flex-col gap-1">
            {row.redFlags.map((f) => (
              <li key={f.key} className="text-body-s">
                <span className="text-foreground">{f.lay}</span>
                {f.clinical ? <span className="text-muted-foreground"> — {f.clinical}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-body-s">Reporter was not sure what is wrong.</p>
        )}

        <dl className="text-body-s grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {row.lastKnownWellAt ? (
            <>
              <dt className="text-muted-foreground">Last normal</dt>
              <dd className="font-mono tabular-nums">{formatClock(row.lastKnownWellAt)}</dd>
            </>
          ) : null}
          {row.onsetAt ? (
            <>
              <dt className="text-muted-foreground">Started</dt>
              <dd className="font-mono tabular-nums">{formatClock(row.onsetAt)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Sent</dt>
          <dd className="font-mono tabular-nums">{formatClock(row.createdAt)}</dd>
          <dt className="text-muted-foreground">Callback</dt>
          <dd>
            {row.callbackPhone ? (
              <a
                href={`tel:${row.callbackPhone}`}
                className="text-foreground inline-flex items-center gap-1 font-mono underline-offset-4 hover:underline"
              >
                <PhoneIcon className="size-3.5" aria-hidden />
                {row.callbackPhone}
              </a>
            ) : (
              <span className="text-muted-foreground">No number given</span>
            )}
          </dd>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={row.verified ? "stable" : "caution"}>
            {row.verified ? "Verified reporter" : "Unverified reporter"}
          </Pill>
          <Pill tone={row.status === "sent" ? "pending" : "neutral"}>
            {STATUS_WORD[row.status] ?? row.status}
            {row.acknowledgedAt ? ` · seen ${formatClock(row.acknowledgedAt)}` : ""}
            {row.readyAt ? ` · ready ${formatClock(row.readyAt)}` : ""}
            {row.arrivedAt ? ` · says they are here (${formatClock(row.arrivedAt)})` : ""}
          </Pill>
        </div>
      </div>

      <footer className="border-border bg-muted/30 flex flex-wrap items-center gap-2 border-t px-4 py-3">
        {row.status === "sent" ? (
          <StatusForm id={row.id} status="seen" label="Acknowledge" action={actions.update} />
        ) : null}
        {row.status !== "ready" ? (
          <StatusForm id={row.id} status="ready" label="Ready" action={actions.update} />
        ) : null}
        {row.callbackPhone ? (
          <a
            href={`tel:${row.callbackPhone}`}
            className="text-foreground border-foreground/15 hover:border-foreground/30 hover:bg-muted/40 text-body-s ease-expo-out tap inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 transition-colors duration-150"
          >
            <PhoneIcon className="size-3.5" aria-hidden />
            Call
          </a>
        ) : null}
        <ArrivedButton
          row={row}
          departments={departments}
          actions={actions}
          queueHref={queueHref}
        />
        <span className="ml-auto flex items-center gap-2">
          <CloseButton
            id={row.id}
            status="not_arriving"
            label="Not arriving"
            action={actions.update}
          />
          <CloseButton id={row.id} status="hoax" label="Hoax" action={actions.update} />
        </span>
      </footer>
    </article>
  );
}

/** Acknowledge / Ready: one tap, the function's default reason. */
function StatusForm({
  id,
  status,
  label,
  action,
}: {
  id: string;
  status: "seen" | "ready";
  label: string;
  action: IncomingAction;
}) {
  const [state, formAction, pending] = useActionState<IncomingActionState, FormData>(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="pre_arrival_id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button
        type="submit"
        variant={status === "seen" ? "primary" : "secondary"}
        size="sm"
        className="tap min-h-11 px-4"
        disabled={pending}
      >
        {pending ? "Saving…" : label}
      </Button>
      {state.error ? (
        <span role="alert" className="text-destructive text-caption font-mono">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/** Not arriving / Hoax: a confirm dialog with the audited reason (≥ 8 chars). */
function CloseButton({
  id,
  status,
  label,
  action,
}: {
  id: string;
  status: "not_arriving" | "hoax";
  label: string;
  action: IncomingAction;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<IncomingActionState, FormData>(action, {});
  // On success the row leaves the board on revalidation and this card unmounts; until then, closed.
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="tap min-h-11"
        onClick={() => setOpen(true)}
      >
        {label}…
      </Button>
      <Dialog open={open && !state.ok} onOpenChange={setOpen}>
        <DialogContent>
          <form action={formAction} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Close as {label.toLowerCase()}</DialogTitle>
              <DialogDescription>
                {status === "hoax"
                  ? "A hoax counts against the reporter's device and phone; repeated hoaxes drop them to call-only for 24 hours. Calling is never blocked."
                  : "The pre-alert closes and leaves the board. The reporter's status screen says the hospital closed it."}
              </DialogDescription>
            </DialogHeader>
            <input type="hidden" name="pre_arrival_id" value={id} />
            <input type="hidden" name="status" value={status} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`reason-${status}-${id}`}>
                Reason (at least 8 characters, audited)
              </Label>
              <Input
                id={`reason-${status}-${id}`}
                name="reason"
                required
                minLength={8}
                maxLength={500}
                aria-invalid={!!state.error}
              />
            </div>
            {state.error ? (
              <p role="alert" className="text-destructive text-caption font-mono">
                {state.error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Keep
              </Button>
              <Button type="submit" variant="secondary" disabled={pending}>
                {pending ? "Recording…" : `Mark ${label.toLowerCase()}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Arrived: who walked in (a code search — hits carry no name by design — or
 * an "Unknown patient" label), which department receives them, the audit
 * note. ha-pre-arrival-arrived registers the intake through the desk's own
 * intake service, or links today's live intake when the patient already has one.
 */
function ArrivedButton({
  row,
  departments,
  actions,
  queueHref,
}: {
  row: IncomingPreArrival;
  departments: ReadonlyArray<{ id: string; name: string }>;
  actions: IncomingCardActions;
  queueHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ReceptionPatientHit | null>(null);
  const [state, formAction, pending] = useActionState<IncomingActionState, FormData>(
    actions.arrived,
    {},
  );

  if (state.ok) {
    return (
      <span role="status" className="text-body-s inline-flex items-center gap-2">
        {state.linked ? "Linked to today's intake" : "Intake created — awaiting triage"} · listed
        under Today, closed
        <Link href={queueHref} className="text-foreground underline underline-offset-4">
          Open the queue
        </Link>
      </span>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="tap min-h-11 px-4"
        onClick={() => setOpen(true)}
      >
        Arrived…
      </Button>
      <EditorDialog open={open} onOpenChange={setOpen} width="medium">
        <form action={formAction} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>Arrived — register the intake</SheetTitle>
            <p className="text-muted-foreground text-body-s">
              {subjectWords(row.subject)} · ETA was {ETA_BAND_LABEL[row.etaBand]}. Pick the patient
              by code, or leave them unknown and say who is at the door.
            </p>
          </SheetHeader>
          <SheetBody className="grid items-start gap-5 lg:grid-cols-2">
            <input type="hidden" name="pre_arrival_id" value={row.id} />
            <div className="flex flex-col gap-3">
              {picked ? (
                <div className="border-border bg-background flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <input type="hidden" name="patient_user_id" value={picked.patientUserId} />
                  <span className="text-body-s font-mono">{picked.patientCode}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <CodeSearch search={actions.search} onPick={setPicked} />
              )}
              {picked ? null : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`unknown-${row.id}`}>
                    Unknown patient — describe who arrived
                  </Label>
                  <Input
                    id={`unknown-${row.id}`}
                    name="patient_unknown_label"
                    maxLength={240}
                    placeholder="e.g. adult male brought by boda"
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`dept-${row.id}`}>Receiving department</Label>
                <select
                  id={`dept-${row.id}`}
                  name="receiving_department_id"
                  defaultValue=""
                  className="border-input bg-background text-body-s h-11 rounded-md border px-3"
                >
                  <option value="">Casualty (default)</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`note-${row.id}`}>Audit note (at least 8 characters)</Label>
                <Input
                  id={`note-${row.id}`}
                  name="reason"
                  required
                  minLength={8}
                  maxLength={500}
                  defaultValue="Pre-alerted patient arrived at the front door."
                />
              </div>
            </div>
          </SheetBody>
          <SheetFooter className="items-center">
            {state.error ? (
              <p role="alert" className="text-destructive text-caption mr-auto font-mono">
                {state.error}
              </p>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Registering…" : "Mark arrived"}
            </Button>
          </SheetFooter>
        </form>
      </EditorDialog>
    </>
  );
}

/** Code-prefix search, debounced 250 ms; the front door's pattern, in miniature. */
function CodeSearch({
  search,
  onPick,
}: {
  search: (query: string) => Promise<ReceptionPatientHit[]>;
  onPick: (hit: ReceptionPatientHit) => void;
}) {
  const [query, setQuery] = useState("");
  // Keyed by the query it answers, so a pending search never shows as "no
  // such code" and a new query never shows the old hits.
  const [answer, setAnswer] = useState<{ q: string; hits: ReceptionPatientHit[] } | null>(null);
  const id = useId();
  const q = query.trim();
  const hits = answer?.q === q ? answer.hits : null;

  useEffect(() => {
    if (q.length < 3) return;
    let live = true;
    const t = setTimeout(() => {
      search(q)
        .then((rows) => live && setAnswer({ q, hits: rows }))
        .catch(() => live && setAnswer({ q, hits: [] }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, search]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Patient code</Label>
        <Input
          id={id}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="First 3+ characters of the code"
          autoComplete="off"
          className="font-mono"
        />
      </div>
      {q.length >= 3 && hits ? (
        hits.length === 0 ? (
          <p role="status" className="text-muted-foreground text-caption">
            No patient code starts with “{q}”.
          </p>
        ) : (
          <ul
            aria-label="Matching patients"
            className="divide-border/60 border-border bg-background max-h-60 divide-y overflow-y-auto rounded-lg border"
          >
            {hits.map((h) => (
              <li key={h.patientUserId}>
                <button
                  type="button"
                  onClick={() => onPick(h)}
                  className="hover:bg-muted/40 text-body-s flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span className="font-mono">{h.patientCode}</span>
                  <span className="text-muted-foreground text-caption">
                    {[h.sex, h.primaryHospitalName].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
