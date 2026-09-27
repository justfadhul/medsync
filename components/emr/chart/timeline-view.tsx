"use client";

import type { TimelineItem, TimelineKind } from "@/lib/emr/chart";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RestrictedMark } from "../chips";
import { EmptyState } from "../empty-state";
import { formatters, parts } from "../format";
import { SectionHeading, Time } from "./parts";

/**
 * Timeline (PROMPT §5.2): everything in reverse order, filtered by kind, paged by 50. The filter
 * chips are toggle buttons (`aria-pressed`); switching is instant. Paging moves focus to the list
 * so a keyboard user lands on the new page, not the button.
 */
export const TIMELINE_PAGE = 50;
const KINDS: { id: TimelineKind; label: string }[] = [
  { id: "encounter", label: "Encounters" },
  { id: "note", label: "Notes" },
  { id: "result", label: "Results" },
  { id: "order", label: "Orders" },
  { id: "procedure", label: "Procedures" },
  { id: "entered_in_error", label: "Entered in error" },
];
const KIND_WORD: Record<TimelineKind, string> = {
  encounter: "Encounter",
  note: "Note",
  result: "Result",
  order: "Order",
  procedure: "Procedure",
  entered_in_error: "Entered in error",
};

export function TimelineView({
  items,
  timeZone,
  headingId,
  initialKind = null,
  initialPage = 0,
}: {
  items: readonly TimelineItem[];
  timeZone?: string;
  headingId?: string;
  initialKind?: TimelineKind | null;
  initialPage?: number;
}) {
  const [kind, setKind] = useState<TimelineKind | null>(initialKind);
  const [page, setPage] = useState(initialPage);
  const fmt = formatters(timeZone);
  const shown = kind ? items.filter((i) => i.kind === kind) : items;
  const pages = Math.max(1, Math.ceil(shown.length / TIMELINE_PAGE));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * TIMELINE_PAGE, (current + 1) * TIMELINE_PAGE);
  const listId = `${headingId ?? "timeline"}-list`;
  const go = (p: number) => {
    setPage(p);
    document.getElementById(listId)?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading id={headingId}>Timeline</SectionHeading>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {[{ id: null, label: "All" }, ...KINDS].map((k) => (
          <button
            key={k.label}
            type="button"
            aria-pressed={kind === k.id}
            onClick={() => {
              setKind(k.id);
              setPage(0);
            }}
            className={cn(
              "text-body-s inline-flex min-h-11 items-center rounded-full border px-3 outline-none sm:min-h-8",
              "focus-visible:shadow-focus ease-expo-out transition-[transform,background-color,border-color,color] duration-100 active:scale-[0.97] motion-reduce:active:scale-100",
              kind === k.id
                ? "border-teal-600 bg-teal-50 text-teal-800"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
      {slice.length === 0 ? (
        <EmptyState>
          {kind
            ? `No ${KIND_WORD[kind].toLowerCase()} entries on record.`
            : "Nothing on record yet."}
        </EmptyState>
      ) : (
        <ol id={listId} tabIndex={-1} className="flex flex-col outline-none">
          {slice.map((t) => (
            <li
              key={`${t.kind}:${t.id}`}
              className="border-border/60 text-body-s grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 border-b py-2 last:border-0 sm:grid-cols-[9rem_6rem_1fr]"
            >
              <Time iso={t.at}>{fmt.dateTime(t.at)}</Time>
              <span className="text-muted-foreground">{KIND_WORD[t.kind]}</span>
              <span className="col-span-2 inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:col-span-1">
                {t.struck ? (
                  // Withdrawn, never vanished (Law 4): struck through; the reason is the detail.
                  <s className="text-muted-foreground decoration-1">
                    <span className="sr-only">Entered in error: </span>
                    {t.title}
                  </s>
                ) : (
                  <span className="text-foreground">
                    {parts(t.title).map((p, i) => (
                      <span key={i} className="mr-3 last:mr-0">
                        {p}
                      </span>
                    ))}
                  </span>
                )}
                {parts(t.detail).map((p, i) => (
                  <span key={i} className="text-muted-foreground">
                    {p}
                  </span>
                ))}
                {t.restricted ? <RestrictedMark /> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
      {pages > 1 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={current === 0}
            onClick={() => go(current - 1)}
          >
            Newer
          </Button>
          <span className="text-body-s text-muted-foreground tabular-nums" aria-live="polite">
            {`Page ${current + 1} of ${pages}`}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={current >= pages - 1}
            onClick={() => go(current + 1)}
          >
            Older
          </Button>
        </div>
      ) : null}
    </div>
  );
}
