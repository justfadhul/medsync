import type { Provenance } from "../provenance";
import type { IndexItem } from "../section-index";
import type { ChartLinks } from "./parts";
import type { ChartPayload } from "@/lib/emr/chart";
import type { ReactNode } from "react";

import { SafetyBarView } from "../safety-bar";
import { CountBadge } from "../section-index";
import { StatusWord } from "../status-word";
import { ChartShell } from "./chart-shell";
import { MedicinesView } from "./medicines-view";
import { NotesView } from "./notes-view";
import { OrdersView } from "./orders-view";
import { ProblemsAllergiesView } from "./problems-allergies-view";
import { ResultsView } from "./results-view";
import { SummaryView } from "./summary-view";
import { TimelineView } from "./timeline-view";

/**
 * The chart (gate-a E.2, PROMPT §5.2). PURE: it takes the precomputed payload (lib/emr/chart
 * buildChartPayload) and the provenance map, and renders the safety bar, the left section index
 * and a reading column. Server-only work (loading, the live subscription, the handover action)
 * arrives as slots, so the fixture harness renders every section without a database.
 */
export const CHART_SECTIONS = [
  { id: "summary", label: "Summary" },
  { id: "timeline", label: "Timeline" },
  { id: "results", label: "Results" },
  { id: "notes", label: "Notes" },
  { id: "orders", label: "Orders" },
  { id: "medicines", label: "Medicines" },
  { id: "problems", label: "Problems and allergies" },
] as const;
export type ChartSectionId = (typeof CHART_SECTIONS)[number]["id"];

export interface ChartViewProps {
  payload: ChartPayload;
  provenance?: Readonly<Record<string, Provenance>>;
  section?: ChartSectionId;
  timeZone?: string;
  links?: ChartLinks;
  /** A concluded resus episode's handover still waiting: the page passes the action button. */
  handoff?: ReactNode;
  /** The live island (subscription + offline words). */
  live?: ReactNode;
  /** This visit's orders with the actions the surface may take (the nurse's collection panel),
   *  shown under the Orders section; withheld with the other actions after a recorded death. */
  ordersPanel?: ReactNode;
}

export function ChartView({
  payload,
  provenance = {},
  section = "summary",
  timeZone,
  links: linksIn = {},
  handoff,
  live,
  ordersPanel,
}: ChartViewProps) {
  const bar = payload.safetyBar;
  // A recorded death removes the clinical actions (ordering, recording allergies) here as it does
  // in the safety bar; the desk stays reachable so the note can still be completed and signed.
  const links: ChartLinks = bar.actionsAllowed ? linksIn : { desk: linksIn.desk };
  const ctx = { patient: { name: bar.name, mrn: bar.mrn }, provenance, timeZone, links };
  const critical = bar.criticalUnacknowledged.length;
  const open = payload.summary.pendingOrders.length;
  const badge: Partial<Record<ChartSectionId, ReactNode>> = {
    results: critical ? (
      <span className="text-caption dark:text-status-caution-fg inline-flex items-center gap-0.5 font-medium text-amber-800">
        <span aria-hidden>▲ {critical}</span>
        <span className="sr-only">{bar.criticalText}</span>
      </span>
    ) : null,
    orders: <CountBadge count={open} words={`${open} open order${open === 1 ? "" : "s"}`} />,
  };
  const items: IndexItem[] = CHART_SECTIONS.map((s) => ({
    ...s,
    href: `#chart-${s.id}`,
    badge: badge[s.id],
  }));
  const h = (id: ChartSectionId) => `chart-${id}-heading`;
  const panels: Record<ChartSectionId, ReactNode> = {
    summary: <SummaryView summary={payload.summary} ctx={ctx} headingId={h("summary")} />,
    timeline: (
      <TimelineView items={payload.timeline} timeZone={timeZone} headingId={h("timeline")} />
    ),
    results: (
      <ResultsView
        flowsheet={payload.flowsheet}
        timeline={payload.timeline}
        ctx={ctx}
        headingId={h("results")}
        enteredInError={payload.enteredInError}
      />
    ),
    notes: <NotesView notes={payload.notes} ctx={ctx} headingId={h("notes")} />,
    orders: (
      <div className="flex flex-col gap-8">
        <OrdersView
          pending={payload.summary.pendingOrders}
          timeline={payload.timeline}
          ctx={ctx}
          headingId={h("orders")}
        />
        {bar.actionsAllowed ? ordersPanel : null}
      </div>
    ),
    medicines: (
      <MedicinesView
        medicines={payload.summary.medicines}
        ctx={ctx}
        headingId={h("medicines")}
        enteredInError={payload.enteredInError}
      />
    ),
    problems: (
      <ProblemsAllergiesView
        problems={payload.summary.problems}
        allergies={payload.summary.allergies}
        ctx={ctx}
        headingId={h("problems")}
        enteredInError={payload.enteredInError}
      />
    ),
  };

  return (
    <div data-slot="emr-chart" className="flex flex-col">
      <SafetyBarView
        bar={bar}
        links={{
          allergies: links.allergies,
          problems: "#chart-problems",
          results: "#chart-results",
        }}
      />
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-6 md:px-8">
        {live}
        {handoff ? (
          <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
            <StatusWord tone="caution">Resus handover waiting for this record</StatusWord>
            {handoff}
          </div>
        ) : null}
        <ChartShell items={items} panels={panels} initial={section} />
      </div>
    </div>
  );
}
