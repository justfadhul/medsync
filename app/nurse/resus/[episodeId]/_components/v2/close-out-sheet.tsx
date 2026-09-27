"use client";

import type { CloseOutDraft } from "./close-out-model";
import { useState, useTransition } from "react";
import { CheckIcon } from "lucide-react";

import {
  adminCloseResusV2,
  cancelResusV2,
  closeResusV2,
  startBoardingV2,
} from "@/app/nurse/resus/_v2/actions-closeout";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { DestinationStep } from "./close-out-destination";
import { HandoverStep, SignStep } from "./close-out-handover";
import { latestDisposition } from "./close-out-model";
import { OutcomeStep } from "./close-out-outcome";
import { FailedEntries } from "./close-out-ui";
import { AMBER_NOTE, defaultReceiving, PRIMARY, SECONDARY } from "./close-out-words";
import { useDeskCtx } from "./desk-context";
import { initialDraft, useCloseOut } from "./use-close-out";

/**
 * Lane U6 — End resuscitation (prompt §5.12, GATE A §1). Four steps: outcome,
 * destination, handover, sign. It records and suggests; it never blocks a
 * clinical act — mid-arrest it asks how the arrest ended (a data prompt).
 * Opened in error → cancel with a reason; an idle episode (≥ 24 h) can be
 * closed administratively by an in-charge / consultant. On success the store
 * re-reads the record and the episode row (no page reload).
 */

const STEPS = ["Outcome", "Destination", "Handover", "Sign"] as const;
type StepNo = 1 | 2 | 3 | 4;
type CloseAction = "cancel" | "adminClose" | "board" | "end";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function CloseOutSheet({
  open,
  arrestEnding,
  onClose,
}: {
  open: boolean;
  arrestEnding: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent side="center" data-testid="close-out-sheet" widthClassName="max-w-[1080px]">
        {open ? <CloseOutFlow arrestEnding={arrestEnding} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function CloseOutFlow({ arrestEnding, onClose }: { arrestEnding: boolean; onClose: () => void }) {
  const d = useDeskCtx();
  const [step, setStep] = useState<StepNo>(1);
  const [draft, setDraft] = useState<CloseOutDraft>(() =>
    initialDraft(latestDisposition(d.store.activeEvents)),
  );
  const patch = (p: Partial<CloseOutDraft>) => setDraft((x) => ({ ...x, ...p }));
  // One idempotency key per action: a retry of the same action replays it; another
  // action never replays this one's result (a lost "boarding" is not "ended").
  const [ids] = useState<Record<CloseAction, string>>(() => ({
    cancel: crypto.randomUUID(),
    adminClose: crypto.randomUUID(),
    board: crypto.randomUUID(),
    end: crypto.randomUUID(),
  }));
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const { facts, outcome, died, cprOngoing, suggested, step1Ok, step2Ok } = useCloseOut(draft);
  const { suggestion, unit, chosen } = facts;
  const inArrest = facts.inArrest;

  const reachable: StepNo = !step1Ok ? 1 : !step2Ok ? 2 : 4;
  const failed = d.store.pending.filter((p) => p.status === "failed");
  const sending = d.store.pending.length - failed.length;
  const blocked = !d.store.online
    ? "Offline — nothing can be ended until the connection is back."
    : sending > 0
      ? `${plural(sending, "entry is", "entries are")} still sending — wait until they are recorded.`
      : failed.length > 0
        ? `${plural(failed.length, "entry was", "entries were")} not saved — retry or discard above.`
        : null;

  /** One write, awaited: errors stay on the sheet; success re-reads the episode. */
  const send = (done: string, call: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      setError(null);
      try {
        const r = await call();
        if (!r.ok) return setError(r.error);
        d.ui.toast({ message: done });
        void d.store.refresh({ full: true });
        onClose();
      } catch {
        // The call may have committed before the response was lost.
        setError("No response — it may have been recorded. Check the record before trying again.");
        await d.store.refresh({ full: true }).catch(() => undefined);
      }
    });

  const disposition = () => ({
    suggestedLevel: suggested,
    chosenLevel: chosen,
    destination: draft.destination!,
    unitId: unit?.id ?? null,
    mismatch: facts.mismatchNeeded ? draft.mismatch : null,
    mismatchNote: facts.mismatchNeeded ? draft.mismatchNote.trim() || null : null,
    ruleIds: died ? [] : suggestion.reasons.map((r) => r.ruleId),
    bed: draft.bed ?? null,
    bedAcceptedBy: draft.bed === "accepted" ? draft.bedAcceptedBy.trim() || null : null,
  });
  const base = (action: CloseAction) => ({
    episodeId: d.store.episode.id,
    clientEventId: ids[action],
    recordedAt: new Date(d.store.nowMs()).toISOString(),
  });
  const receivingUnit = draft.receivingUnit ?? defaultReceiving(unit?.name, draft.destination);

  const actions = {
    cancel: () =>
      send("Resus cancelled", () =>
        cancelResusV2({ ...base("cancel"), reason: draft.cancelReason.trim() }),
      ),
    adminClose: () =>
      send("Closed administratively", () =>
        adminCloseResusV2({ ...base("adminClose"), reason: draft.adminReason.trim() }),
      ),
    board: () =>
      send("Boarding — awaiting bed", () =>
        startBoardingV2({ ...base("board"), disposition: disposition() }),
      ),
    end: () =>
      send("Resus ended", () =>
        closeResusV2({
          ...base("end"),
          outcomeCode: outcome!,
          disposition: disposition(),
          sbar: {
            situation: draft.sbarEdits.situation ?? facts.sbar.situation,
            background: draft.sbarEdits.background ?? facts.sbar.background,
            assessment: draft.sbarEdits.assessment ?? facts.sbar.assessment,
            recommendation: draft.sbarEdits.recommendation ?? facts.sbar.recommendation,
          },
          receiving:
            receivingUnit.trim() || draft.receivingCadre.trim()
              ? { unit: receivingUnit.trim(), cadre: draft.receivingCadre.trim() }
              : null,
          escort: draft.escort.trim() || null,
          cprOngoing,
          // A death hands nothing off, so it proposes nothing.
          outstandingTests: died
            ? []
            : draft.tests.map((t) => ({ testId: t.testId, reason: t.reason.trim() || null })),
        }),
      ),
    closeSheet: onClose,
  };

  const stepProps = { draft, patch, facts };
  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle>End resuscitation</SheetTitle>
        <SheetDescription>
          {inArrest
            ? "An arrest is running — say how it ended. Nothing here blocks care."
            : arrestEnding
              ? "The arrest has ended — record the outcome, destination and handover."
              : "Outcome, destination and handover. The leader chooses; the desk suggests."}
        </SheetDescription>
      </SheetHeader>

      {/* Landscape: the steps on the left, the current step on the right. */}
      <SheetBody className="grid content-start gap-5 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-x-8">
        <nav aria-label="End resuscitation steps">
          <ol className="flex flex-wrap gap-1.5 md:sticky md:top-0 md:flex-col" aria-label="Steps">
            {STEPS.map((label, i) => {
              const n = (i + 1) as StepNo;
              const current = n === step;
              const done = n < step;
              return (
                <li key={label}>
                  <button
                    type="button"
                    disabled={n > reachable || busy}
                    aria-current={current ? "step" : undefined}
                    onClick={() => setStep(n)}
                    className={cn(
                      "tap text-caption focus-visible:shadow-focus inline-flex min-h-11 items-center gap-1.5 rounded-md border px-2.5 outline-none disabled:opacity-50 md:w-full md:justify-start md:px-3",
                      current
                        ? "border-teal-600 bg-teal-50 text-teal-800"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {done ? (
                      <CheckIcon aria-hidden className="size-3.5" />
                    ) : (
                      <span aria-hidden>{n}</span>
                    )}
                    {label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="flex min-w-0 flex-col gap-5">
          {failed.length > 0 ? (
            <FailedEntries entries={failed} onRetry={d.store.retry} onDiscard={d.store.discard} />
          ) : null}
          {step === 1 ? (
            <OutcomeStep {...stepProps} actions={actions} busy={busy} blocked={blocked} />
          ) : null}
          {step === 2 ? <DestinationStep {...stepProps} died={died} /> : null}
          {step === 3 ? (
            <HandoverStep {...stepProps} menu={died ? null : d.initial.testMenu} />
          ) : null}
          {step === 4 ? <SignStep {...stepProps} receivingUnit={receivingUnit} /> : null}
        </div>
      </SheetBody>

      <SheetFooter className="sm:items-center">
        <div className="text-body-s mr-auto min-w-0" aria-live="polite">
          {error || (blocked && step > 1) ? (
            <p
              role={error ? "alert" : undefined}
              className={cn("rounded-md px-3 py-2", AMBER_NOTE)}
            >
              {error ?? blocked}
            </p>
          ) : null}
        </div>
        {step > 1 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setStep((step - 1) as StepNo)}
            className={SECONDARY}
          >
            Back
          </button>
        ) : null}
        {step === 2 && draft.bed === "not_available" && facts.canBoard ? (
          <button
            type="button"
            disabled={!step2Ok || busy || !!blocked}
            onClick={actions.board}
            className={PRIMARY}
          >
            {busy ? "Recording…" : "Start boarding"}
          </button>
        ) : step < 4 ? (
          draft.outcome === "cancel" && step === 1 ? null : (
            <button
              type="button"
              disabled={(step === 1 ? !step1Ok : step === 2 ? !step2Ok : false) || busy}
              onClick={() => setStep((step + 1) as StepNo)}
              className={PRIMARY}
            >
              Next
            </button>
          )
        ) : (
          <button
            type="button"
            disabled={!step1Ok || !step2Ok || busy || !!blocked}
            onClick={actions.end}
            className={PRIMARY}
          >
            {busy ? "Recording…" : facts.boarding ? "Patient left resus — end" : "End resus"}
          </button>
        )}
      </SheetFooter>
    </>
  );
}
