import type { EncounterOrderRow, PatientIdentity } from "./model";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { formatters } from "../format";
import { StatusWord } from "../status-word";
import { PRIORITY_WORD } from "./model";

/**
 * The encounter's orders (PROMPT §5.8, Law: every order closes its loop). Each row says its state
 * in words: "To collect", "Rejected: haemolysed — recollect" (amber), "Result available — awaiting
 * acknowledgement" (amber)… and offers the one next step this surface can take: collect the
 * specimen, print its label, or transcribe a paper or imaging report. Nothing ordered disappears.
 */
export function EncounterOrdersView({
  identity,
  orders,
  timeZone,
  labelHref,
  onOrder,
  onCollect,
  onTranscribe,
}: {
  identity: PatientIdentity;
  orders: readonly EncounterOrderRow[];
  timeZone?: string;
  /** The label route for a specimen. */
  labelHref?: (specimenId: string) => string;
  onOrder?: () => void;
  onCollect?: (orderId: string) => void;
  onTranscribe?: (orderId: string) => void;
}) {
  const f = formatters(timeZone);
  return (
    <section aria-labelledby="encounter-orders" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="encounter-orders" className="text-heading-s font-medium">
          Orders
          <span className="sr-only">
            {" "}
            for {identity.name}, {identity.mrn}
          </span>
        </h2>
        {onOrder ? (
          <Button type="button" onClick={onOrder} className="min-h-11 sm:min-h-9">
            Order a test
          </Button>
        ) : null}
      </div>
      {orders.length === 0 ? (
        <EmptyState>No tests ordered in this visit.</EmptyState>
      ) : (
        <ul className="divide-border border-border flex flex-col divide-y border-y">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
                <span className="text-body-s flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{o.display}</span>
                  {o.priority && o.priority !== "routine" ? (
                    <span>{PRIORITY_WORD[o.priority] ?? o.priority}</span>
                  ) : null}
                  {o.restricted ? <RestrictedMark /> : null}
                </span>
                <span className="text-caption text-muted-foreground flex flex-wrap gap-x-3">
                  <span className="font-mono tabular-nums">{f.dateTime(o.orderedAtIso)}</span>
                  {o.requesterName ? <span>{o.requesterName}</span> : null}
                </span>
              </div>
              <StatusWord tone={o.caution ? "caution" : "neutral"}>{o.statusText}</StatusWord>
              <div className="flex flex-wrap items-center gap-2">
                {o.collect && onCollect ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onCollect(o.id)}
                    className="min-h-11 sm:min-h-8"
                  >
                    Collect specimen
                  </Button>
                ) : null}
                {o.specimenId && labelHref && !o.collect ? (
                  <Link
                    href={labelHref(o.specimenId)}
                    className="text-body-s tap inline-flex min-h-11 items-center font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
                  >
                    Print label
                  </Link>
                ) : null}
                {o.canTranscribe && onTranscribe ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onTranscribe(o.id)}
                    className="min-h-11 sm:min-h-8"
                  >
                    {o.kind === "lab" ? "Enter paper result" : "Enter report"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
