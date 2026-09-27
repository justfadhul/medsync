import type { AdminRoute } from "@/lib/prescribing/reference/emergency-drug-catalog";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { StatusWord } from "../status-word";

/**
 * The visit's prescriptions on the clerking desk and the printout's lines (PROMPT Phase 7). PURE,
 * and free of the formulary on purpose: the prescribe sheet (sheet.tsx) carries it and loads only
 * when opened, keeping the clerking route inside its JS budget.
 */

export const ROUTE_WORD: Record<AdminRoute, string> = {
  oral: "By mouth",
  iv: "IV",
  im: "IM",
  sc: "Subcutaneous",
  inhaled: "Inhaled",
  nebulised: "Nebulised",
  infusion: "IV infusion",
  pr: "Rectal",
  buccal: "Buccal",
  sublingual: "Sublingual",
  intranasal: "Intranasal",
  io: "Intraosseous",
  ett: "Endotracheal",
};

export interface PrescriptionItem {
  id: string;
  drugName: string;
  dose: string;
  route: string;
  frequency: string | null;
  duration: string | null;
  quantity: string | null;
  instructions: string | null;
  awaitingCosign: boolean;
  /** The senior returned it (or the request closed unapproved): not a valid prescription. */
  cosignWithheld: boolean;
  restricted: boolean;
}

export const routeWord = (r: string) => ROUTE_WORD[r as AdminRoute] ?? r;

export function PrescriptionsView({
  identity,
  items,
  printHref,
  onPrescribe,
}: {
  identity: { name: string; mrn: string };
  items: readonly PrescriptionItem[];
  printHref: string;
  onPrescribe?: () => void;
}) {
  return (
    <section aria-labelledby="encounter-prescriptions" className="flex flex-col gap-3 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="encounter-prescriptions" className="text-heading-s font-medium">
          Prescriptions
          <span className="sr-only">
            {" "}
            for {identity.name}, {identity.mrn}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {items.length ? (
            <Link
              href={printHref}
              className="text-body-s tap inline-flex min-h-11 items-center font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
            >
              Print prescription
            </Link>
          ) : null}
          {onPrescribe ? (
            <Button type="button" onClick={onPrescribe} className="min-h-11 sm:min-h-9">
              Prescribe
            </Button>
          ) : null}
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState>Nothing prescribed in this visit.</EmptyState>
      ) : (
        <ul className="divide-border border-border flex flex-col divide-y border-y">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
                <span className="text-body-s flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{i.drugName}</span>
                  {i.restricted ? <RestrictedMark /> : null}
                </span>
                <PrescriptionLine item={i} className="text-caption text-muted-foreground" />
              </div>
              {i.awaitingCosign ? (
                <StatusWord tone="caution">Awaiting senior co-sign</StatusWord>
              ) : null}
              {i.cosignWithheld ? (
                <StatusWord tone="caution">Not co-signed by a senior — not valid</StatusWord>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Dose, route, how often, how long, how much: separate spans, as written. */
export function PrescriptionLine({
  item,
  className,
}: {
  item: Pick<PrescriptionItem, "dose" | "route" | "frequency" | "duration" | "quantity">;
  className?: string;
}) {
  return (
    <span className={cn("flex flex-wrap gap-x-3", className)}>
      <span className="font-mono tabular-nums">{item.dose}</span>
      <span>{routeWord(item.route)}</span>
      {item.frequency ? <span>{item.frequency}</span> : null}
      {item.duration ? <span>{item.duration}</span> : null}
      {item.quantity ? <span>Supply: {item.quantity}</span> : null}
    </span>
  );
}
