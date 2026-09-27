"use client";

import type { formatters } from "../format";
import type { DeskNoteRow } from "./model";
import type { SignValidation } from "@/lib/emr/note-rules";
import { useState } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChoiceChips, PRESS } from "../orders/choice-chips";
import { StatusWord } from "../status-word";
import { EIE_REASONS } from "./model";

/**
 * Signing, co-signing, addenda and entered in error (gate-a E.11). The required count sits beside
 * Sign, so what is missing is seen before pressing; a missing required item keeps Sign disabled
 * and says what to add; warnings never block. An intern is told the note will await a senior's
 * co-signature and that orders are not held. Signed records keep their state in words.
 */

export function SignBarView({
  validation,
  required,
  canSign,
  signing,
  complete,
  onSign,
  onComplete,
  phone,
}: {
  validation: SignValidation;
  required: { met: number; of: number };
  /** A draft exists and the viewer may sign it. */
  canSign: boolean;
  signing?: boolean;
  /** The visit is open: Complete visit is offered. */
  complete: boolean;
  onSign?: () => void;
  onComplete?: () => void;
  /** Phone: previous / next section around Sign. */
  phone?: { onPrev?: () => void; onNext?: () => void; label: string };
}) {
  const ready = validation.missing.length === 0;
  return (
    <div
      data-slot="desk-actions"
      className="bg-background border-border flex flex-wrap items-center gap-x-2 gap-y-2 border-t px-4 py-3 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] md:sticky md:bottom-0 md:gap-x-4"
    >
      {phone ? (
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Previous section"
          onClick={phone.onPrev}
          disabled={!phone.onPrev}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
      ) : null}
      {canSign ? (
        <Button
          className={cn("min-h-11", PRESS)}
          onClick={onSign}
          disabled={!ready || signing}
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          Sign note
          <kbd className="text-caption hidden font-mono md:inline">Ctrl ↵</kbd>
        </Button>
      ) : null}
      {canSign ? (
        <span className="inline-flex items-center gap-1.5 max-md:order-first" aria-live="polite">
          {ready ? (
            <span className="text-caption text-muted-foreground inline-flex items-center gap-1">
              <CheckIcon aria-hidden className="size-3" />
              {`Required ${required.met}/${required.of}`}
            </span>
          ) : (
            <StatusWord tone="caution">{`Required ${required.met}/${required.of}`}</StatusWord>
          )}
        </span>
      ) : null}
      {phone ? (
        <>
          <span className="text-caption text-muted-foreground ml-auto max-md:order-first md:hidden">
            {phone.label}
          </span>
          {/* Phone: the status line above, the buttons on their own row (fits 320 px). */}
          <span aria-hidden className="h-0 basis-full max-md:order-first md:hidden" />
        </>
      ) : null}
      <span className="flex-1" />
      {complete ? (
        <Button variant="secondary" className={cn("min-h-11", PRESS)} onClick={onComplete}>
          Complete visit
        </Button>
      ) : null}
      {phone ? (
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Next section"
          onClick={phone.onNext}
          disabled={!phone.onNext}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

/** The sign confirmation's body: required, warnings, what commits, the co-sign notice. */
export function SignCheckView({
  validation,
  requiredMessages,
  committed,
  mustCosign,
}: {
  validation: SignValidation;
  /** Every required rule's message, in template order. */
  requiredMessages: { id: string; message: string }[];
  committed: string | null;
  mustCosign: boolean;
}) {
  const missing = new Set(validation.missing.map((m) => m.id));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-body-s text-foreground font-medium">Required</h3>
        <ul className="flex flex-col gap-1.5">
          {requiredMessages.map((r) =>
            missing.has(r.id) ? (
              <li key={r.id}>
                <StatusWord tone="caution">{r.message}</StatusWord>
              </li>
            ) : (
              <li key={r.id} className="text-body-s text-foreground inline-flex items-center gap-2">
                <CheckIcon aria-hidden className="size-3.5 text-teal-700" />
                <span>
                  {r.message}
                  <span className="sr-only"> Done.</span>
                </span>
              </li>
            ),
          )}
        </ul>
      </div>
      {validation.warnings.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-body-s text-foreground font-medium">Warnings — you can still sign</h3>
          <ul className="flex flex-col gap-1.5">
            {validation.warnings.map((w) => (
              <li key={w.id}>
                <StatusWord tone="caution">{w.message}</StatusWord>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {committed ? (
        <p className="text-body-s text-muted-foreground">{`Committed with this note: ${committed}.`}</p>
      ) : null}
      {mustCosign ? (
        <p className="text-body-s text-foreground">
          This note will await co-signature by a senior. Your orders are not held.
        </p>
      ) : null}
    </div>
  );
}

/* ─── Signed notes of this visit ──────────────────────────────────── */

export interface NoteHandlers {
  onCosign?: (noteId: string, withAddendum?: { text: string; reason: string }) => void;
  onAddendum?: (noteId: string, text: string, reason: string) => void;
  onEnteredInError?: (noteId: string, reasonCode: string | null, reasonText: string) => void;
}

type Form = { noteId: string; kind: "addendum" | "cosign_addendum" | "eie" } | null;

export function NoteRowsView({
  notes,
  fmt,
  on,
  busy,
  editable = true,
}: {
  notes: readonly DeskNoteRow[];
  fmt: ReturnType<typeof formatters>;
  on?: NoteHandlers;
  busy?: string | null;
  /** Actions shown (they are also refused server-side when not allowed). */
  editable?: boolean;
}) {
  const [form, setForm] = useState<Form>(null);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const reset = () => {
    setForm(null);
    setText("");
    setReason("");
    setCode(null);
  };
  if (notes.length === 0) return null;
  return (
    <ul className="divide-border flex flex-col divide-y" aria-label="Signed notes this visit">
      {notes.map((n) => {
        const open = form?.noteId === n.id ? form.kind : null;
        const struck = n.status === "entered_in_error";
        return (
          <li key={n.id} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className={cn("text-body-s text-foreground font-medium", struck && "line-through")}
              >
                {n.title}
              </span>
              <span className="text-body-s text-muted-foreground">{n.author}</span>
              <time
                className="text-caption text-muted-foreground font-mono tabular-nums"
                dateTime={n.at}
              >
                {fmt.dateTime(n.at)}
              </time>
              <StatusWord tone={n.tone === "neutral" ? "neutral" : "caution"}>
                {struck && n.eieReason ? `Entered in error — ${n.eieReason}` : n.statusText}
              </StatusWord>
              {n.lateEntry ? <StatusWord tone="neutral">Late entry</StatusWord> : null}
            </div>
            {n.addenda.length ? (
              <ul className="flex flex-col gap-1 pl-4">
                {n.addenda.map((a) => (
                  <li key={a.id} className="text-caption text-muted-foreground">
                    {`Addendum — ${a.author}, ${fmt.dateTime(a.at)}`}
                  </li>
                ))}
              </ul>
            ) : null}
            {editable && !struck ? (
              <div className="flex flex-wrap gap-2">
                {n.canCosign ? (
                  <>
                    <Button
                      size="sm"
                      className={PRESS}
                      disabled={busy === `cosign:${n.id}`}
                      onClick={() => on?.onCosign?.(n.id)}
                    >
                      Co-sign
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setForm({ noteId: n.id, kind: "cosign_addendum" })}
                    >
                      Add addendum and co-sign
                    </Button>
                  </>
                ) : null}
                {!n.canCosign ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm({ noteId: n.id, kind: "addendum" })}
                  >
                    Add addendum
                  </Button>
                ) : null}
                {n.canMarkError ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm({ noteId: n.id, kind: "eie" })}
                  >
                    Entered in error…
                  </Button>
                ) : null}
              </div>
            ) : null}
            {open === "addendum" || open === "cosign_addendum" ? (
              <form
                className="flex max-w-[68ch] flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (open === "cosign_addendum") on?.onCosign?.(n.id, { text, reason });
                  else on?.onAddendum?.(n.id, text, reason);
                  reset();
                }}
              >
                <label htmlFor={`addendum-${n.id}`} className="text-caption text-muted-foreground">
                  Addendum
                </label>
                <textarea
                  id={`addendum-${n.id}`}
                  value={text}
                  rows={3}
                  onChange={(e) => setText(e.target.value)}
                  className="border-input bg-card text-body-m focus-visible:shadow-focus rounded-sm border px-3 py-2 leading-relaxed outline-none"
                />
                <label
                  htmlFor={`addendum-reason-${n.id}`}
                  className="text-caption text-muted-foreground"
                >
                  Why it is added
                </label>
                <Input
                  id={`addendum-reason-${n.id}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={!text.trim() || !reason.trim()}>
                    {open === "cosign_addendum" ? "Add addendum and co-sign" : "Add addendum"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={reset}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
            {open === "eie" ? (
              <form
                className="flex max-w-[68ch] flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  on?.onEnteredInError?.(n.id, code, reason);
                  reset();
                }}
              >
                <ChoiceChips
                  name={`eie-${n.id}`}
                  label="Why the note is entered in error"
                  options={EIE_REASONS.map((r) => ({ value: r.code, label: r.label }))}
                  value={code}
                  onChange={setCode}
                />
                <label htmlFor={`eie-text-${n.id}`} className="text-caption text-muted-foreground">
                  Details (the note stays visible, struck through, with this reason)
                </label>
                <Input
                  id={`eie-text-${n.id}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    disabled={!code || (code === "other" && !reason.trim())}
                  >
                    Mark entered in error
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={reset}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
