"use client";

import type { ActionResult } from "@/lib/emr/write/context";
import type {
  PharmacyItem,
  PharmacyLineRef,
  PharmacyNoticeItem,
  PharmacyQueryItem,
  PrescriberPharmacyView,
} from "@/lib/pharmacy/review/prescriber-read";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ClockIcon, XIcon } from "lucide-react";

import { StatusWord } from "@/components/emr/status-word";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Button } from "@/components/ui/button";
import {
  SheetBody,
  SheetClose,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PRESCRIBER_PHARMACY_COPY as COPY } from "@/content/pharmacy-prescriber";
import { PRESCRIBE_COPY } from "@/content/prescribing";
import {
  acknowledgeNotSupplied,
  answerQuery,
  confirmChangesMade,
  disputePhoneAnswer,
  recordQuerySeen,
} from "@/lib/emr/actions/pharmacy-queries";
import { cn } from "@/lib/utils";
import { DraftLabel, FOCUS, inputClass } from "./parts";

/**
 * The pharmacy on the doctor's plan step (Pharmacy Phase 1, 5.4, 5.14, Section 10; artboard 1.10).
 * Behind `pharmacyDispensingLiveFor`: with it off the payload carries no view and nothing renders.
 * The chip and the step-header count are words (amber only with its icon); the answer is a radio
 * group whose answers stack at 390 px, with Send answer in a sticky footer. No red, no green, no
 * left bars, nothing slides in. Delivery: CriticalLive on `user:<id>` refreshes the page on the
 * `pharmacy` event (15 s polling while unsubscribed, paused while hidden); a new query is said once,
 * politely.
 */

export interface PharmacyHandlers {
  /** Open the existing prescribing dialog to change this line (the basket entry names the line). */
  onChange: (item: PharmacyItem, line: PharmacyLineRef) => void;
  /** Lines whose change is waiting in the basket. */
  inBasket: ReadonlySet<string>;
  /** No problem to prescribe under: Change is absent. */
  canChange: boolean;
  /** After an answer is recorded (the one Prescribe reloads its own session; the page refreshes anyway). */
  onDone?: () => void;
}

const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
const isOpen = (i: PharmacyItem) =>
  i.kind === "not_supplied" || i.state === "open" || i.state === "not_sent";
const FAILED = "Not sent. Check the connection and try again.";

/** The items that show on a line: its own queries and notices, and a whole-prescription chip. */
export const itemsForLine = (view: PrescriberPharmacyView | null | undefined, lineId: string) =>
  view?.items.filter((i) => i.lines.some((l) => l.id === lineId)) ?? [];

/** X-5 beside the plan's status pill. */
export function PharmacyCount({ view }: { view: PrescriberPharmacyView | null | undefined }) {
  if (!view?.count) return null;
  return <StatusWord tone="neutral">{fill(COPY.count, { n: view.count })}</StatusWord>;
}

/** X-4: "Pharmacy query · waiting {n} min", ticking by the minute from the server's figure. */
export function PharmacyChip({ item }: { item: PharmacyQueryItem }) {
  const [extra, setExtra] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setExtra((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <StatusWord tone="caution" glyph={ClockIcon}>
      {fill(COPY.chip, { n: item.waitingMin + extra })}
    </StatusWord>
  );
}

/** Chips for one placed line (keyed so the minute count restarts from each fresh server read). */
export function PharmacyChips({
  view,
  lineId,
}: {
  view: PrescriberPharmacyView | null | undefined;
  lineId: string;
}) {
  return itemsForLine(view, lineId)
    .filter((i): i is PharmacyQueryItem => i.kind === "query" && isOpen(i))
    .map((i) => <PharmacyChip key={`${i.id}:${i.waitingMin}`} item={i} />);
}

/** Section 10: a new query is said once, politely; the first render only learns what is open. */
export function PharmacyAnnounce({ announce }: { announce: { id: string; text: string } | null }) {
  const [said, setSaid] = useState("");
  const heard = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (heard.current === null) {
      heard.current = new Set(announce ? [announce.id] : []);
      return;
    }
    if (!announce || heard.current.has(announce.id)) return;
    heard.current.add(announce.id);
    setSaid(announce.text);
  }, [announce]);
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {said}
    </p>
  );
}

function useCall(onDone?: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = async (act: () => Promise<ActionResult<unknown>>) => {
    setBusy(true);
    setError(null);
    const r = await act().catch(
      (): ActionResult<unknown> => ({
        ok: false,
        code: "conflict",
        error: FAILED,
      }),
    );
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone?.();
    router.refresh();
  };
  return { busy, error, call };
}

const newKey = () => `pharm-answer-${crypto.randomUUID()}`;

/** One query or notice, under its line or in the plan's "From the pharmacy". */
export function PharmacyItemBlock({
  item,
  view,
  canWrite,
  handlers,
  dialog = false,
}: {
  item: PharmacyItem;
  view: PrescriberPharmacyView;
  canWrite: boolean;
  handlers: PharmacyHandlers;
  /** The one Prescribe (prototype): the answer opens in a centred dialog, not inline. */
  dialog?: boolean;
}) {
  const headId = useId();
  const base = { surface: "doctor" as const, patientUserId: view.patientUserId };
  const needsSeen = item.kind === "query" && isOpen(item) && !item.seen;

  // RQ-8: rendering the query writes `seen` once for this recipient. Never shown as an answer.
  useEffect(() => {
    if (!needsSeen) return;
    void recordQuerySeen({
      surface: "doctor",
      patientUserId: view.patientUserId,
      queryId: item.id,
    }).catch(() => undefined);
  }, [needsSeen, item.id, view.patientUserId]);

  return (
    <div
      role="region"
      aria-labelledby={headId}
      className="border-border bg-muted/40 flex basis-full flex-col gap-2 rounded-md border p-3"
    >
      {item.kind === "query" ? (
        <QueryBlock
          item={item}
          view={view}
          canWrite={canWrite}
          handlers={handlers}
          headId={headId}
          base={base}
          dialog={dialog}
        />
      ) : (
        <NoticeBlock
          item={item}
          canWrite={canWrite}
          handlers={handlers}
          headId={headId}
          base={base}
        />
      )}
      {item.phone ? (
        <p className="text-body-s text-foreground">
          {`${COPY.callPharmacy}: `}
          <a href={`tel:${item.phone.replace(/\s/g, "")}`} className={cn("underline", FOCUS)}>
            {item.phone}
          </a>
        </p>
      ) : null}
    </div>
  );
}

type Base = { surface: "doctor"; patientUserId: string };

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="status" className="text-body-s text-foreground">
      {error}
    </p>
  ) : null;
}

function QueryBlock({
  item,
  view,
  canWrite,
  handlers,
  headId,
  base,
  dialog,
}: {
  item: PharmacyQueryItem;
  view: PrescriberPharmacyView;
  canWrite: boolean;
  handlers: PharmacyHandlers;
  headId: string;
  base: Base;
  dialog: boolean;
}) {
  const dispute = useCall(handlers.onDone);
  const [disputeKey] = useState(newKey);
  const [answering, setAnswering] = useState(false);
  const open = isOpen(item);
  return (
    <>
      <p id={headId} className="text-body-s text-foreground">
        {item.words}
      </p>
      {item.scope === "prescription" ? (
        <p className="text-caption text-muted-foreground">{COPY.wholePrescription}</p>
      ) : null}
      {item.patientWaiting && open ? (
        <p className="text-body-s text-foreground">{COPY.patientWaiting}</p>
      ) : null}
      {item.outcome ? <p className="text-caption text-muted-foreground">{item.outcome}</p> : null}
      {item.phoneAnswerAt ? (
        <p className="text-body-s text-foreground flex flex-wrap items-center gap-2">
          <span>
            {fill(COPY.phoneAnswer.replace(" Tell us.", ""), { time: item.phoneAnswerAt })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canWrite || dispute.busy}
            onClick={() =>
              void dispute.call(() =>
                disputePhoneAnswer({ ...base, queryId: item.id, clientKey: disputeKey }),
              )
            }
          >
            {COPY.tellUs}
          </Button>
        </p>
      ) : null}
      <ErrorLine error={dispute.error} />
      {open && canWrite && dialog ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => setAnswering(true)}
          >
            {PRESCRIBE_COPY.answerOpen}
          </Button>
          <EditorDialog open={answering} onOpenChange={setAnswering} width="medium">
            <SheetHeader className="pr-12">
              <SheetTitle className="text-heading-m font-sans">
                {PRESCRIBE_COPY.answerTitle}
              </SheetTitle>
              <SheetDescription>{PRESCRIBE_COPY.answerNote}</SheetDescription>
            </SheetHeader>
            <SheetBody className="flex flex-col gap-3">
              <blockquote className="bg-muted text-body-s text-foreground rounded-lg px-3.5 py-3">
                {item.words}
              </blockquote>
              <AnswerForm
                item={item}
                view={view}
                base={base}
                handlers={{
                  ...handlers,
                  onChange: (i, l) => {
                    setAnswering(false);
                    handlers.onChange(i, l);
                  },
                  onDone: () => {
                    setAnswering(false);
                    handlers.onDone?.();
                  },
                }}
              />
            </SheetBody>
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  className="absolute top-3 right-3 rounded-full"
                />
              }
            >
              <XIcon className="size-4" />
            </SheetClose>
          </EditorDialog>
        </>
      ) : open && canWrite ? (
        <AnswerForm item={item} view={view} handlers={handlers} base={base} />
      ) : null}
    </>
  );
}

type Choice = "keep" | "changed" | "stopped";

function AnswerForm({
  item,
  view,
  handlers,
  base,
}: {
  item: PharmacyQueryItem;
  view: PrescriberPharmacyView;
  handlers: PharmacyHandlers;
  base: Base;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [key] = useState(newKey);
  const [doneKey] = useState(newKey);
  const send = useCall(handlers.onDone);
  const reasonId = useId();
  const textId = useId();
  const whole = item.scope === "prescription";
  const standing = item.lines.filter((l) => l.standing);
  const reasons =
    choice === "keep" ? view.keepReasons : choice === "stopped" ? view.stopReasons : [];
  const waiting = item.lines.some((l) => handlers.inBasket.has(l.id));
  const options: { id: Choice; label: string; disabled?: boolean }[] = [
    { id: "keep", label: COPY.keep, disabled: !view.keepReasons.length },
    ...(handlers.canChange ? [{ id: "changed" as const, label: COPY.change }] : []),
    { id: "stopped", label: whole ? COPY.stopAll : COPY.stop },
  ];
  const ready =
    choice === "changed"
      ? !whole && !waiting && !!standing[0]
      : !!choice && !!reason && (reason !== "other" || text.trim().length >= 3);

  const submit = () => {
    if (!choice) return;
    if (choice === "changed") {
      if (standing[0]) handlers.onChange(item, standing[0]);
      return;
    }
    void send.call(() =>
      answerQuery({
        ...base,
        queryId: item.id,
        clientKey: key,
        answer: choice,
        reasonCode: reason,
        ...(text.trim() ? { note: text.trim() } : {}),
      }),
    );
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-label text-foreground mb-1">{COPY.yourAnswer}</legend>
      <div className="flex flex-col gap-1.5">
        {options.map((o) => (
          <label
            key={o.id}
            className={cn(
              "border-border bg-card text-body-s flex min-h-11 items-center gap-2 rounded-sm border px-3",
              o.disabled && "opacity-50",
              choice === o.id && "border-teal-600",
            )}
          >
            <input
              type="radio"
              name={`answer-${item.id}`}
              value={o.id}
              checked={choice === o.id}
              disabled={o.disabled}
              onChange={() => {
                setChoice(o.id);
                setReason("");
              }}
              className="accent-teal-600"
            />
            {o.label}
          </label>
        ))}
      </div>
      {!view.keepReasons.length ? (
        <p className="text-caption text-muted-foreground">{COPY.keepUnsigned}</p>
      ) : null}
      {choice === "changed" && whole ? (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted-foreground">{COPY.changeWhole}</p>
          <ul className="flex flex-col gap-1.5">
            {item.lines.map((l) => (
              <li key={l.id} className="text-body-s flex flex-wrap items-center gap-2">
                <span className="text-foreground">
                  {l.changed ? <span className="sr-only">Replaced: </span> : null}
                  {l.changed ? <s>{l.words}</s> : l.words}
                </span>
                {l.standing && !l.changed ? (
                  handlers.inBasket.has(l.id) ? (
                    <span className="text-caption text-muted-foreground">{COPY.inBasket}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handlers.onChange(item, l)}
                    >
                      {COPY.changeLine}
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
          <Button
            className="self-start"
            disabled={send.busy || !item.lines.some((l) => l.changed)}
            onClick={() =>
              void send.call(() =>
                confirmChangesMade({ ...base, queryId: item.id, clientKey: doneKey }),
              )
            }
          >
            {COPY.changesMade}
          </Button>
        </div>
      ) : null}
      {choice === "changed" && !whole && waiting ? (
        <p className="text-caption text-muted-foreground">{COPY.inBasket}</p>
      ) : null}
      {reasons.length ? (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={reasonId}
            className="text-caption text-muted-foreground flex items-center gap-2"
          >
            {COPY.reason}
            {choice === "keep" && !view.keepSigned ? (
              <DraftLabel>{COPY.keepDraft}</DraftLabel>
            ) : null}
          </label>
          <select
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={cn(inputClass, "pointer-coarse:min-h-11")}
          >
            <option value="" disabled>
              {COPY.reason}
            </option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.words}
              </option>
            ))}
          </select>
          {reason === "other" ? (
            <>
              <label htmlFor={textId} className="text-caption text-muted-foreground">
                {COPY.reasonText}
              </label>
              <input
                id={textId}
                value={text}
                maxLength={1000}
                onChange={(e) => setText(e.target.value)}
                className={cn(inputClass, "pointer-coarse:min-h-11")}
              />
            </>
          ) : null}
        </div>
      ) : null}
      <ErrorLine error={send.error} />
      {choice === "changed" && whole ? null : (
        // 5.14: one-handed at 390 px, Send answer sits in a sticky footer.
        <div className="bg-card border-border flex justify-end max-sm:sticky max-sm:bottom-0 max-sm:-mx-3 max-sm:border-t max-sm:px-3 max-sm:py-2">
          <Button className="max-sm:w-full" disabled={!ready || send.busy} onClick={submit}>
            {COPY.send}
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function NoticeBlock({
  item,
  canWrite,
  handlers,
  headId,
  base,
}: {
  item: PharmacyNoticeItem;
  canWrite: boolean;
  handlers: PharmacyHandlers;
  headId: string;
  base: Base;
}) {
  const leave = useCall(handlers.onDone);
  const line = item.lines.find((l) => l.standing);
  const waiting = item.lines.some((l) => handlers.inBasket.has(l.id));
  return (
    <>
      <p id={headId} className="text-body-s text-foreground">
        {item.words}
      </p>
      {waiting ? <p className="text-caption text-muted-foreground">{COPY.inBasket}</p> : null}
      {canWrite && !waiting ? (
        <div className="flex flex-wrap gap-2 max-sm:flex-col">
          {handlers.canChange && line ? (
            <Button size="sm" variant="secondary" onClick={() => handlers.onChange(item, line)}>
              {COPY.chooseAlternative}
            </Button>
          ) : null}
          {item.canAcknowledge ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={leave.busy}
              onClick={() =>
                void leave.call(() => acknowledgeNotSupplied({ ...base, lineEventId: item.id }))
              }
            >
              {COPY.leaveIt}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ErrorLine error={leave.error} />
    </>
  );
}
