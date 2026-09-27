"use client";

import type { ChartContext } from "./parts";
import type { ChartPayload, EnteredInErrorItem, FlowCell, FlowRow } from "@/lib/emr/chart";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { dayLabel, formatters } from "../format";
import { Sparkline } from "../sparkline";
import { ResultValueText, StatusWord } from "../status-word";
import { ValuePopover } from "../value-popover";
import { EnteredInErrorList, LabFlag, SectionHeading, SubHeading, Time } from "./parts";

/**
 * Results (gate-a E.2): a flowsheet, concepts down and dates across. Values are right-aligned
 * Geist Mono with tabular numerals; the laboratory's own flag is text; the critical style appears
 * only when the payload marks a cell critical (a signed definition). Every value opens its
 * provenance. The newest dates show first; the rest are one tap away. The trend is an inline
 * sparkline whose table alternative is the row itself (and a screen-reader table).
 */
export const FLOWSHEET_DATES = 8;

/** The cell text without the row's own unit (it heads the row); a different unit stays. */
const bare = (value: string, unit: string | null) =>
  unit && value.endsWith(` ${unit}`) ? value.slice(0, -unit.length - 1) : value;

const ACK_CAUTION = new Set(["Needs review", "Needs re ack"]);
const ACK_WORD: Record<string, string> = {
  "Needs review": "Awaiting acknowledgement",
  "Needs re ack": "Amended — acknowledge again",
  "Not released": "Preliminary",
};

export function ResultsView({
  flowsheet,
  timeline,
  ctx,
  headingId,
  showAllDates = false,
  enteredInError = [],
}: {
  flowsheet: ChartPayload["flowsheet"];
  timeline: ChartPayload["timeline"];
  ctx: ChartContext;
  headingId?: string;
  showAllDates?: boolean;
  enteredInError?: readonly EnteredInErrorItem[];
}) {
  const [all, setAll] = useState(showAllDates);
  const fmt = formatters(ctx.timeZone);
  const dates = all ? flowsheet.dates : flowsheet.dates.slice(-FLOWSHEET_DATES);
  const hidden = flowsheet.dates.length - dates.length;
  const reports = timeline.filter((t) => t.kind === "result");
  const order = ctx.links.order ? { label: "Order a test", href: ctx.links.order } : null;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        id={headingId}
        right={
          flowsheet.dates.length > FLOWSHEET_DATES ? (
            <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
              {all
                ? `Show the latest ${FLOWSHEET_DATES} dates`
                : `Show all ${flowsheet.dates.length} dates`}
            </Button>
          ) : null
        }
      >
        Results
      </SectionHeading>
      {flowsheet.rows.length === 0 ? (
        <EmptyState action={order}>No results on record.</EmptyState>
      ) : (
        // rtl on the scroller only: a narrow screen opens at the newest dates (the right end), the
        // table itself reads ltr. `relative` keeps the sr-only cells inside the scroller. Columns
        // snap to the sticky test column's edge (snap-end is the left edge in an rtl scroller), so
        // no value rests half-hidden under it: "8.1" must never read as "1".
        <div className="relative -mx-4 snap-x snap-mandatory overflow-x-auto px-4 [direction:rtl] md:mx-0 md:px-0">
          <table className="text-body-s w-full border-separate border-spacing-0 [direction:ltr]">
            <caption className="sr-only">
              {`Results flowsheet: tests down, dates across, oldest to newest${hidden ? `; ${hidden} earlier dates not shown` : ""}`}
            </caption>
            <thead>
              <tr className="text-caption text-muted-foreground">
                <th
                  scope="col"
                  className="bg-background sticky left-0 z-10 w-36 min-w-36 py-2 pr-4 text-left font-medium"
                >
                  Test
                </th>
                <th scope="col" className="snap-end scroll-ml-36 py-2 pr-4 text-left font-medium">
                  Unit
                </th>
                {dates.map((d) => {
                  const l = dayLabel(d);
                  return (
                    <th
                      key={d}
                      scope="col"
                      className="snap-end scroll-ml-36 py-2 pr-4 text-right font-medium whitespace-nowrap"
                    >
                      <span className="font-mono tabular-nums">{l.day}</span>
                      <span className="sr-only"> {l.year}</span>
                    </th>
                  );
                })}
                <th scope="col" className="snap-end scroll-ml-36 py-2 text-left font-medium">
                  Trend
                </th>
              </tr>
            </thead>
            <tbody>
              {flowsheet.rows.map((r) => (
                <FlowsheetRow key={r.conceptId} row={r} dates={dates} ctx={ctx} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="flex flex-col gap-2">
        <SubHeading>Reports</SubHeading>
        {reports.length === 0 ? (
          <EmptyState action={order}>No laboratory reports yet.</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {reports.map((t) => (
              <li
                key={t.id}
                className="border-border/60 text-body-s flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b py-2 last:border-0"
              >
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="text-foreground">{t.title}</span>
                  {t.restricted ? <RestrictedMark /> : null}
                </span>
                <span className="inline-flex flex-wrap items-center gap-3">
                  <StatusWord tone={ACK_CAUTION.has(t.detail) ? "caution" : "neutral"}>
                    {ACK_WORD[t.detail] ?? t.detail}
                  </StatusWord>
                  <Time iso={t.at}>{fmt.dateTime(t.at)}</Time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <EnteredInErrorList
        items={enteredInError.filter((i) => i.section === "results")}
        timeZone={ctx.timeZone}
      />
    </div>
  );
}

function FlowsheetRow({
  row,
  dates,
  ctx,
}: {
  row: FlowRow;
  dates: readonly string[];
  ctx: ChartContext;
}) {
  const byDate = new Map<string, FlowCell[]>();
  for (const c of row.cells) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c]);
  return (
    <tr className="align-top">
      <th
        scope="row"
        className="bg-background border-border/60 sticky left-0 z-10 w-36 min-w-36 border-t py-2 pr-4 text-left font-normal"
      >
        <span className="text-foreground">{row.display}</span>
      </th>
      <td className="border-border/60 text-muted-foreground text-caption border-t py-2 pr-4 whitespace-nowrap">
        {row.unit ?? "—"}
      </td>
      {dates.map((d) => {
        const cells = byDate.get(d) ?? [];
        return (
          <td key={d} className="border-border/60 border-t py-2 pr-4 text-right whitespace-nowrap">
            {cells.length === 0 ? (
              <span className="text-muted-foreground" aria-label="No value">
                —
              </span>
            ) : (
              <span className="flex flex-col items-end gap-0.5">
                {cells.map((c) => (
                  <span key={c.id} className="inline-flex items-baseline justify-end gap-1.5">
                    <ValuePopover
                      label={row.display}
                      valueText={c.value}
                      patient={ctx.patient}
                      provenance={ctx.provenance[c.id]}
                    >
                      <ResultValueText critical={c.critical}>
                        {bare(c.value, row.unit)}
                      </ResultValueText>
                    </ValuePopover>
                    <LabFlag text={c.flag} />
                    {c.restricted ? <RestrictedMark /> : null}
                  </span>
                ))}
              </span>
            )}
          </td>
        );
      })}
      <td className="border-border/60 border-t py-2">
        <Sparkline
          series={row.series}
          label={row.display}
          unit={row.unit}
          timeZone={ctx.timeZone}
        />
      </td>
    </tr>
  );
}
