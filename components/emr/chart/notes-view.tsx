import type { ChartContext } from "./parts";
import type { NoteItem } from "@/lib/emr/chart";
import { CornerDownRightIcon } from "lucide-react";

import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { formatters, parts } from "../format";
import { StatusWord } from "../status-word";
import { SectionHeading, Time } from "./parts";

/**
 * Notes (gate-a E.2): signed notes newest first, addenda threaded under their parent (indented,
 * with a turn glyph — never a left bar). Entered in error stays visible: struck through, with its
 * reason in words. Awaiting co-signature is amber; the other record states are neutral.
 */
export function NotesView({
  notes,
  ctx,
  headingId,
}: {
  notes: readonly NoteItem[];
  ctx: ChartContext;
  headingId?: string;
}) {
  const fmt = formatters(ctx.timeZone);
  return (
    <div className="flex flex-col gap-4">
      <SectionHeading id={headingId}>Notes</SectionHeading>
      {notes.length === 0 ? (
        <EmptyState
          action={ctx.links.desk ? { label: "Open the clerking desk", href: ctx.links.desk } : null}
        >
          No signed notes yet. Notes appear here once signed.
        </EmptyState>
      ) : (
        <ul className="flex flex-col">
          {notes.map((n) => (
            <NoteRow key={n.id} n={n} fmt={fmt} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteRow({
  n,
  fmt,
  depth,
}: {
  n: NoteItem;
  fmt: ReturnType<typeof formatters>;
  depth: number;
}) {
  const main = n.struck ? "Entered in error" : (parts(n.statusText)[0] ?? n.statusText);
  return (
    <li className={depth === 0 ? "border-border/60 border-b py-3 last:border-0" : "pt-2"}>
      <div className="text-body-s flex flex-wrap items-center gap-x-4 gap-y-1">
        {depth > 0 ? (
          <CornerDownRightIcon aria-hidden className="text-muted-foreground size-3.5" />
        ) : null}
        <Time iso={n.at}>{fmt.dateTime(n.at)}</Time>
        <span className="text-foreground font-medium">
          {n.struck ? (
            <s className="decoration-1">
              <span className="sr-only">Entered in error: </span>
              {n.title}
            </s>
          ) : (
            n.title
          )}
        </span>
        <span className="text-muted-foreground">{n.author}</span>
        <StatusWord tone={n.status === "awaiting_cosign" ? "caution" : "neutral"}>
          {main}
        </StatusWord>
        {n.lateEntry ? <StatusWord>Late entry</StatusWord> : null}
        {n.restricted ? <RestrictedMark /> : null}
      </div>
      {n.eieReason ? (
        <p className="text-body-s text-muted-foreground mt-1">{`Reason: ${n.eieReason}`}</p>
      ) : null}
      {n.addenda.length > 0 ? (
        <ul className="pl-6" aria-label={`Addenda to ${n.title}`}>
          {n.addenda.map((a) => (
            <NoteRow key={a.id} n={a} fmt={fmt} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
