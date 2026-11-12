/**
 * "Sent today" (Gate E, ADR 0090; PRD §3.4 reports seed): what left the
 * dispatcher today, by kind and channel, and what the SMS cost — the number
 * a facility watches (PRD §1.5). Server-rendered, no state.
 *
 * Gate H: the same panel over any range. `range` names the period ("the last
 * 28 days") and `since` its start ("00:00 on 22 Aug"); both default to today,
 * so the scheduling page calls it unchanged and /hospital-admin/reports
 * passes its window.
 */
const KIND_LABEL: Record<string, string> = {
  booking_receipt: "Booking receipts",
  confirmation_request: "Confirmation requests",
  arrival_window: "Arrival windows",
  waitlist_offer: "Waitlist offers",
  session_cancelled: "Clinic day cancelled",
  window_shifted: "Window moved",
  unconfirmed_release: "Unconfirmed place released",
  visit_cancelled: "Visit cancelled by the clinic",
  reminder: "Reminders",
};

export function SentTodayPanel({
  rows,
  range = "today",
  since = "midnight",
}: {
  rows: ReadonlyArray<{
    kind: string;
    channel: string;
    count: number;
    cost: number;
    currency: string | null;
  }>;
  range?: string;
  since?: string;
}) {
  const smsCost = rows.filter((r) => r.channel === "sms").reduce((a, r) => a + r.cost, 0);
  const currency = rows.find((r) => r.currency)?.currency ?? "UGX";
  const total = rows.reduce((a, r) => a + r.count, 0);

  return (
    <section className="border-border bg-card flex flex-col rounded-lg border">
      <div className="flex flex-col gap-1 px-6 py-5">
        <h2 className="text-foreground text-heading-s">Sent {range}</h2>
        <p className="text-muted-foreground text-body-s max-w-xl leading-relaxed">
          Messages the dispatcher sent since {since}, East Africa Time. SMS spend is what the
          provider reported per message; push is free.
        </p>
      </div>
      <div className="border-border grid grid-cols-2 gap-4 border-t px-6 py-4 sm:grid-cols-3">
        <Stat label="Messages" value={String(total)} />
        <Stat label="SMS spend" value={`${currency} ${smsCost.toFixed(0)}`} />
        <Stat
          label="Push"
          value={String(rows.filter((r) => r.channel === "push").reduce((a, r) => a + r.count, 0))}
        />
      </div>
      {rows.length > 0 ? (
        <div className="border-border overflow-x-auto border-t">
          <table className="w-full text-left">
            <caption className="sr-only">Messages sent {range} by kind and channel</caption>
            <thead className="bg-muted text-muted-foreground text-[10px] font-semibold tracking-[0.04em] uppercase">
              <tr>
                <th className="px-6 py-2">Kind</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2 text-right">Sent</th>
                <th className="px-6 py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="text-body-s">
              {rows.map((r) => (
                <tr key={`${r.kind}:${r.channel}`} className="border-border border-t">
                  <td className="text-foreground px-6 py-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="text-muted-foreground px-3 py-2 font-mono">{r.channel}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{r.count}</td>
                  <td className="text-muted-foreground px-6 py-2 text-right font-mono tabular-nums">
                    {r.channel === "sms" ? `${r.currency ?? currency} ${r.cost.toFixed(0)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-overline uppercase">{label}</span>
      <span className="text-foreground text-heading-s font-mono tabular-nums">{value}</span>
    </div>
  );
}
