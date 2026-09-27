"use client";

import type { LabWorkItem } from "./lab-worklist-view";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { receiveSpecimen, rejectSpecimen } from "@/lib/emr/actions/orders";
import { ChoiceChips } from "../orders/choice-chips";
import { StatusWord } from "../status-word";

/**
 * A worklist row's actions at the bench: receive the specimen, enter results once received, or
 * reject it with a reason — which returns the order to "To collect" on the ward with the reason
 * showing (lib/emr/orders.ts). Rejection asks for the reason before it writes.
 */
export function SpecimenActions({
  item,
  reasons,
}: {
  item: LabWorkItem;
  /** Rejection reasons as codes and words (lib/emr/orders.ts REJECTION_REASON_TEXT). */
  reasons: readonly { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, said: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      setRejecting(false);
      setMessage({ ok: true, text: said });
      router.refresh();
    });
  if (!item.specimenId) return null;
  const base = {
    surface: "lab" as const,
    patientUserId: item.patientUserId,
    specimenId: item.specimenId,
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {item.stage === "awaiting_receipt" ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => receiveSpecimen({ ...base, clientKey: crypto.randomUUID() }),
                "Specimen received.",
              )
            }
            className="min-h-11 sm:min-h-8"
          >
            Receive specimen
          </Button>
        ) : (
          <Link
            href={`/lab/results/${item.orderId}`}
            className={buttonVariants({ className: "min-h-11 sm:min-h-8" })}
          >
            {item.stage === "preliminary" ? "Check and release" : "Enter results"}
          </Link>
        )}
        <Button
          type="button"
          variant="ghost"
          aria-expanded={rejecting}
          disabled={pending}
          onClick={() => setRejecting((v) => !v)}
          className="min-h-11 sm:min-h-8"
        >
          Reject specimen
        </Button>
      </div>
      {rejecting ? (
        <div className="flex flex-col items-end gap-2">
          <ChoiceChips
            name={`reject-${item.orderId}`}
            label={`Why is the ${item.test} specimen rejected?`}
            options={reasons}
            value={reason}
            onChange={setReason}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !reason}
            onClick={() =>
              act(
                () =>
                  rejectSpecimen({
                    ...base,
                    reasonCode: reason,
                    clientKey: crypto.randomUUID(),
                  }),
                "Specimen rejected; the ward sees the reason.",
              )
            }
            className="min-h-11 sm:min-h-8"
          >
            Reject and ask for a recollection
          </Button>
        </div>
      ) : null}
      <span role="status" aria-live="polite" className="text-body-s">
        {message ? (
          message.ok ? (
            message.text
          ) : (
            <StatusWord tone="caution">{message.text}</StatusWord>
          )
        ) : null}
      </span>
    </div>
  );
}
