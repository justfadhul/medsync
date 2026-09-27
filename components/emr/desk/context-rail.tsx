import type { formatters } from "../format";
import type { DeskPayload } from "./model";
import type { ReactNode } from "react";

import { Time } from "../chart/parts";
import { FactChip, RestrictedMark } from "../chips";
import { StatusWord } from "../status-word";

/**
 * The context rail (gate-a E.3, right column; a bottom sheet titled "Context" on a tablet). What
 * the record already knows, shown and never copied: triage (level in words, the complaint, the
 * discriminators that fired), the latest vital signs with their source, results, medicines and
 * problems. Vitals from triage carry "From triage": zero taps, projected from the triage record.
 */
function Block({ title, at, children }: { title: string; at?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-border flex flex-col gap-2 border-b pb-4 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-body-s text-foreground font-medium">{title}</h3>
        {at}
      </div>
      {children}
    </section>
  );
}

const None = ({ children }: { children: ReactNode }) => (
  <p className="text-body-s text-muted-foreground">{children}</p>
);

export function ContextRailView({
  p,
  fmt,
}: {
  p: DeskPayload;
  fmt: ReturnType<typeof formatters>;
}) {
  const c = p.context;
  return (
    <div className="flex flex-col gap-4" data-slot="desk-context">
      <Block
        title="Triage"
        at={c.triage ? <Time iso={c.triage.at}>{fmt.time(c.triage.at)}</Time> : undefined}
      >
        {c.triage ? (
          <>
            <p className="text-body-s text-foreground">
              <span className="font-mono tabular-nums">{`Level ${c.triage.level}`}</span>
              <span className="text-muted-foreground">{` ${c.triage.levelWord}`}</span>
            </p>
            {c.triage.complaint ? <p className="text-body-s">{c.triage.complaint}</p> : null}
            {c.triage.discriminators.length ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Triage findings">
                {c.triage.discriminators.map((d) => (
                  <li key={d}>
                    <FactChip label={d} source="Triage" />
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <None>No triage record for this visit.</None>
        )}
      </Block>

      <Block title="Vital signs">
        {c.vitals.length ? (
          <ul className="flex flex-col gap-1.5">
            {c.vitals.map((v) => (
              <li key={v.id} className="flex items-baseline justify-between gap-3">
                <span className="text-body-s text-muted-foreground">{v.label}</span>
                <span className="inline-flex items-baseline gap-1.5">
                  <span className="text-body-s text-foreground font-mono font-medium tabular-nums">
                    {v.value}
                  </span>
                  {v.unit ? (
                    <span className="text-caption text-muted-foreground">{v.unit}</span>
                  ) : null}
                  <span className="text-caption text-muted-foreground">
                    {v.fromTriage ? "Triage" : fmt.time(v.at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <None>No vital signs recorded.</None>
        )}
      </Block>

      <Block title="Results">
        {c.results.length || c.pendingOrders.length ? (
          <ul className="flex flex-col gap-1.5">
            {c.results.slice(0, 6).map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-body-s text-muted-foreground">{r.display}</span>
                <span className="text-body-s font-mono tabular-nums">
                  {r.value}
                  {r.flag ? (
                    <span className="text-caption text-muted-foreground">{` ${r.flag}`}</span>
                  ) : null}
                </span>
              </li>
            ))}
            {c.pendingOrders.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
              >
                <span className="text-body-s text-muted-foreground">{o.display}</span>
                <StatusWord tone={o.tone === "neutral" ? "neutral" : "caution"}>
                  {o.status}
                </StatusWord>
                {o.restricted ? <RestrictedMark /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <None>No results or pending orders.</None>
        )}
      </Block>

      <Block title="Medicines">
        {c.medicines.length ? (
          <ul className="flex flex-col gap-1">
            {c.medicines.map((m) => (
              <li key={m.id} className="text-body-s text-foreground">
                {m.display}
              </li>
            ))}
          </ul>
        ) : (
          <None>No current medicines on record.</None>
        )}
      </Block>

      <Block title="Problems">
        {c.problems.length ? (
          <ul className="flex flex-col gap-1">
            {c.problems.map((pr) => (
              <li key={pr.id} className="text-body-s text-foreground inline-flex gap-2">
                {pr.display}
                {pr.restricted ? <RestrictedMark /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <None>No active problems.</None>
        )}
      </Block>

      {p.suggestions.some((s) => s.state === "open") ? (
        <Block title="Suggested by triage">
          <p className="text-body-s text-muted-foreground">
            {`${p.suggestions.filter((s) => s.state === "open").length} waiting in the plan: accept or dismiss each.`}
          </p>
        </Block>
      ) : null}
    </div>
  );
}
