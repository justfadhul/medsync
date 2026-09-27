import type { ChartContext } from "./parts";
import type { ChartPayload, EnteredInErrorItem } from "@/lib/emr/chart";

import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { StatusWord } from "../status-word";
import { EnteredInErrorList, SectionHeading } from "./parts";

/** Current medicines (active, on hold, intended). Reconciliation happens on the clerking desk. */
export function MedicinesView({
  medicines,
  ctx,
  headingId,
  enteredInError = [],
}: {
  medicines: ChartPayload["summary"]["medicines"];
  ctx: ChartContext;
  headingId?: string;
  enteredInError?: readonly EnteredInErrorItem[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeading id={headingId}>Medicines</SectionHeading>
      {medicines.length === 0 ? (
        <EmptyState
          action={ctx.links.desk ? { label: "Reconcile medicines", href: ctx.links.desk } : null}
        >
          No current medicines recorded. Confirm them at the next visit&rsquo;s reconciliation.
        </EmptyState>
      ) : (
        <ul className="flex flex-col">
          {medicines.map((m) => (
            <li
              key={m.id}
              className="border-border/60 text-body-s flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b py-2 last:border-0"
            >
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="text-foreground">{m.display}</span>
                {m.restricted ? <RestrictedMark /> : null}
              </span>
              <StatusWord>{m.status}</StatusWord>
            </li>
          ))}
        </ul>
      )}
      <EnteredInErrorList
        items={enteredInError.filter((i) => i.section === "medicines")}
        timeZone={ctx.timeZone}
      />
    </div>
  );
}
