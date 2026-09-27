import type { ChartContext } from "./parts";
import type { ChartPayload, ResultItem } from "@/lib/emr/chart";

import { Separator } from "@/components/ui/separator";
import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { formatters, withoutNameOnly } from "../format";
import { ResultValueText, StatusWord } from "../status-word";
import { ValuePopover } from "../value-popover";
import { LabFlag, Parts, SectionHeading, SubHeading, Time } from "./parts";

/**
 * Summary (PROMPT §5.2): active problems, allergies, current medicines; the last three encounters;
 * recent results, abnormal first; pending orders. Hairline separators, no cards inside cards.
 */
export function SummaryView({
  summary,
  ctx,
  headingId,
}: {
  summary: ChartPayload["summary"];
  ctx: ChartContext;
  headingId?: string;
}) {
  const fmt = formatters(ctx.timeZone);
  const { allergies } = summary;
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading id={headingId}>Summary</SectionHeading>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="flex flex-col gap-2">
          <SubHeading>Active problems</SubHeading>
          {summary.problems.length === 0 ? (
            <EmptyState
              action={
                ctx.links.desk ? { label: "Open the clerking desk", href: ctx.links.desk } : null
              }
            >
              No active problems recorded.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {summary.problems.map((p) => (
                <li key={p.id} className="text-body-s flex items-baseline justify-between gap-3">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {p.display}
                    {p.restricted ? <RestrictedMark /> : null}
                  </span>
                  {p.since ? (
                    <span className="text-muted-foreground font-mono tabular-nums">{p.since}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <SubHeading>Allergies</SubHeading>
          {allergies.state === "listed" ? (
            <ul className="flex flex-col gap-1.5">
              {allergies.items.map((a) => (
                <li key={a.id} className="text-body-s inline-flex flex-wrap items-center gap-2">
                  {withoutNameOnly(a.text)}
                  {a.byNameOnly ? <StatusWord tone="caution">by name only</StatusWord> : null}
                  {a.restricted ? <RestrictedMark /> : null}
                </li>
              ))}
            </ul>
          ) : allergies.tone === "neutral" ? (
            <p className="text-body-s">{allergies.text}</p>
          ) : (
            <EmptyState
              action={
                ctx.links.allergies
                  ? { label: "Record allergies", href: ctx.links.allergies }
                  : null
              }
            >
              <StatusWord tone={allergies.tone}>{allergies.text}</StatusWord>
            </EmptyState>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <SubHeading>Current medicines</SubHeading>
          {summary.medicines.length === 0 ? (
            <EmptyState
              action={
                ctx.links.desk ? { label: "Reconcile medicines", href: ctx.links.desk } : null
              }
            >
              No current medicines recorded.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {summary.medicines.map((m) => (
                <li key={m.id} className="text-body-s inline-flex flex-wrap items-center gap-2">
                  {m.display}
                  {m.restricted ? <RestrictedMark /> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <Separator />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-2">
          <SubHeading>Last three encounters</SubHeading>
          {summary.encounters.length === 0 ? (
            <EmptyState>No encounters at this hospital yet.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {summary.encounters.map((e) => (
                <li key={e.id} className="text-body-s flex flex-col gap-0.5">
                  <Parts text={e.title} className="text-foreground" />
                  <span className="text-muted-foreground inline-flex flex-wrap items-center gap-2">
                    <Parts text={e.detail} />
                    {e.restricted ? <RestrictedMark /> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <SubHeading>Recent results, abnormal first</SubHeading>
          {summary.results.length === 0 ? (
            <EmptyState
              action={ctx.links.order ? { label: "Order a test", href: ctx.links.order } : null}
            >
              No results on record.
            </EmptyState>
          ) : (
            <table className="text-body-s w-full">
              <caption className="sr-only">Recent results, abnormal first</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Test</th>
                  <th scope="col">Value</th>
                  <th scope="col">Laboratory flag</th>
                  <th scope="col" className="hidden sm:table-cell">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.results.map((r) => (
                  <ResultRow key={r.id} r={r} ctx={ctx} date={fmt.date(r.at)} />
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <Separator />
      <section className="flex flex-col gap-2">
        <SubHeading>Pending orders</SubHeading>
        {summary.pendingOrders.length === 0 ? (
          <EmptyState
            action={ctx.links.order ? { label: "Order a test", href: ctx.links.order } : null}
          >
            No pending orders.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.pendingOrders.map((o) => (
              <li
                key={o.id}
                className="text-body-s flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
              >
                <span className="inline-flex flex-wrap items-center gap-2">
                  {o.display}
                  {o.priority && o.priority !== "routine" ? (
                    <StatusWord>{o.priority === "urgent" ? "Urgent" : "Immediate"}</StatusWord>
                  ) : null}
                  {o.restricted ? <RestrictedMark /> : null}
                </span>
                <span className="inline-flex flex-wrap items-center gap-3">
                  <StatusWord tone={o.tone}>{o.status}</StatusWord>
                  <Time iso={o.at}>{fmt.dateTime(o.at)}</Time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ResultRow({ r, ctx, date }: { r: ResultItem; ctx: ChartContext; date: string }) {
  return (
    <tr className="border-border/60 border-b last:border-0">
      <td className="py-1.5 pr-3">
        <span className="inline-flex flex-wrap items-center gap-2">
          {r.display}
          {r.restricted ? <RestrictedMark /> : null}
        </span>
        {/* Phone: the date sits under the test name, so the value never wraps. */}
        <span className="block sm:hidden">
          <Time iso={r.at}>{date}</Time>
        </span>
      </td>
      <td className="py-1.5 pr-3 text-right whitespace-nowrap">
        <ValuePopover
          label={r.display}
          valueText={r.value}
          patient={ctx.patient}
          provenance={ctx.provenance[r.id]}
        >
          <ResultValueText critical={r.critical}>{r.value}</ResultValueText>
        </ValuePopover>
      </td>
      <td className="py-1.5 pr-3">
        <LabFlag text={r.flag} />
      </td>
      <td className="hidden py-1.5 text-right whitespace-nowrap sm:table-cell">
        <Time iso={r.at}>{date}</Time>
      </td>
    </tr>
  );
}
