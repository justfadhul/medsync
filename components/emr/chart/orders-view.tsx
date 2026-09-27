import type { ChartContext } from "./parts";
import type { ChartPayload, OrderItem, TimelineItem } from "@/lib/emr/chart";

import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { formatters } from "../format";
import { StatusWord } from "../status-word";
import { SectionHeading, SubHeading, Time } from "./parts";

/**
 * Orders: open first (PROMPT §4 rule 5: nothing ordered disappears), then everything that closed,
 * with its words. Both lists come from the payload — open orders from the summary, the rest from
 * the timeline — so the view derives nothing.
 */
export function OrdersView({
  pending,
  timeline,
  ctx,
  headingId,
}: {
  pending: ChartPayload["summary"]["pendingOrders"];
  timeline: ChartPayload["timeline"];
  ctx: ChartContext;
  headingId?: string;
}) {
  const fmt = formatters(ctx.timeZone);
  const open = new Set(pending.map((o) => o.id));
  const closed = timeline.filter((t) => t.kind === "order" && !open.has(t.id));
  const order = ctx.links.order ? { label: "Order a test", href: ctx.links.order } : null;
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading id={headingId}>Orders</SectionHeading>
      <section className="flex flex-col gap-2">
        <SubHeading>Open</SubHeading>
        {pending.length === 0 ? (
          <EmptyState action={order}>No open orders.</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {pending.map((o) => (
              <OrderRow key={o.id} o={o} when={fmt.dateTime(o.at)} />
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <SubHeading>Resulted, acknowledged or cancelled</SubHeading>
        {closed.length === 0 ? (
          <EmptyState>None yet.</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {closed.map((t) => (
              <ClosedRow key={t.id} t={t} when={fmt.dateTime(t.at)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OrderRow({ o, when }: { o: OrderItem; when: string }) {
  return (
    <li className="border-border/60 text-body-s flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b py-2 last:border-0">
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-foreground">{o.display}</span>
        {o.priority && o.priority !== "routine" ? (
          <StatusWord>{o.priority === "urgent" ? "Urgent" : "Immediate"}</StatusWord>
        ) : null}
        {o.restricted ? <RestrictedMark /> : null}
      </span>
      <span className="inline-flex flex-wrap items-center gap-3">
        <StatusWord tone={o.tone}>{o.status}</StatusWord>
        <Time iso={o.at}>{when}</Time>
      </span>
    </li>
  );
}

function ClosedRow({ t, when }: { t: TimelineItem; when: string }) {
  return (
    <li className="border-border/60 text-body-s flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b py-2 last:border-0">
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-foreground">{t.title}</span>
        {t.restricted ? <RestrictedMark /> : null}
      </span>
      <span className="inline-flex flex-wrap items-center gap-3">
        <StatusWord>{t.detail}</StatusWord>
        <Time iso={t.at}>{when}</Time>
      </span>
    </li>
  );
}
