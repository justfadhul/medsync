"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { completeEncounterAction } from "../actions";

/**
 * "End visit" (ADR 0101 R3) — on the queue rail's Now-seeing chips and in the
 * encounter page's top bar. Two steps, because the close cascades to the queue
 * row, the intake and the booking in one audited write and there is no undo:
 * a stray tap on a 44px target in a busy rail must not discharge anyone.
 *
 * Secondary, never red: ending a visit is routine, and red is kept for
 * emergencies. The refusal the server sends back (already completed, not your
 * encounter) is shown word for word — it is more precise than anything this
 * button could paraphrase it into.
 */
export function EndVisitButton({
  encounterId,
  patientLabel,
  className,
}: {
  encounterId: string;
  /** Names the patient to a screen reader, where the chip's layout does not. */
  patientLabel?: string;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function end() {
    setError(null);
    startTransition(async () => {
      const result = await completeEncounterAction(encounterId);
      if (!result.ok) {
        setError(result.error ?? "Couldn't end the visit.");
        setConfirming(false);
      }
    });
  }

  const who = patientLabel ? ` for ${patientLabel}` : "";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {confirming ? (
        <div role="group" aria-label={`Confirm ending the visit${who}`} className="flex gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11 px-3"
            disabled={pending}
            onClick={end}
          >
            {pending ? "Ending visit…" : "Confirm — end visit"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 px-3"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Keep open
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 w-fit px-3"
          aria-label={`End visit${who}`}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          End visit
        </Button>
      )}
      {error ? (
        <span role="alert" className="text-destructive ncd-reveal text-caption">
          {error}
        </span>
      ) : null}
    </div>
  );
}
