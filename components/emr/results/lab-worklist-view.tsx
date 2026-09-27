import type { PatientIdentity } from "./model";
import type { ReactNode } from "react";

import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { formatters } from "../format";
import { PRIORITY_WORD } from "../orders/model";
import { StatusWord } from "../status-word";

/**
 * The laboratory worklist under EMR v1 (HARMONISATION §2 R3): events-lifecycle orders whose
 * specimen has reached the lab and whose result is not yet released — immediate and urgent first,
 * then oldest. Each row carries both identifiers with age and sex. The row's actions (receive,
 * reject, enter results) are passed in, so this view stays free of server calls.
 */
export type LabStage = "awaiting_receipt" | "received" | "preliminary";

export interface LabWorkItem {
  orderId: string;
  patientUserId: string;
  identity: PatientIdentity;
  test: string;
  priority: string | null;
  restricted: boolean;
  orderedAtIso: string;
  stage: LabStage;
  statusText: string;
  specimenId: string | null;
  reportId: string | null;
}

export function LabWorklistView({
  items,
  timeZone,
  actions,
}: {
  items: readonly LabWorkItem[];
  timeZone?: string;
  actions?: (item: LabWorkItem) => ReactNode;
}) {
  const f = formatters(timeZone);
  if (items.length === 0)
    return (
      <EmptyState>
        No specimens waiting. Collected specimens appear here as soon as they are labelled at the
        bedside.
      </EmptyState>
    );
  return (
    <ul className="divide-border border-border flex flex-col divide-y border-y">
      {items.map((i) => (
        <li key={i.orderId} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
          {/* basis-72: on a phone the actions wrap below the patient instead of squeezing the MRN. */}
          <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
            <p className="text-body-s flex flex-wrap gap-x-3">
              <span className="font-medium">{i.identity.name}</span>
              <span className="text-muted-foreground font-mono tabular-nums">{i.identity.mrn}</span>
              {i.identity.ageSex.split(" · ").map((p) => (
                <span key={p} className="text-muted-foreground">
                  {p}
                </span>
              ))}
            </p>
            <p className="text-body-s flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{i.test}</span>
              {i.priority && i.priority !== "routine" ? (
                <span>{PRIORITY_WORD[i.priority] ?? i.priority}</span>
              ) : null}
              {i.restricted ? <RestrictedMark /> : null}
              <StatusWord tone={i.stage === "preliminary" ? "caution" : "neutral"}>
                {i.statusText}
              </StatusWord>
              <span className="text-caption text-muted-foreground">
                Ordered <span className="font-mono tabular-nums">{f.dateTime(i.orderedAtIso)}</span>
              </span>
            </p>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions(i)}</div> : null}
        </li>
      ))}
    </ul>
  );
}
