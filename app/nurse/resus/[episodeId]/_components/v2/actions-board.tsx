"use client";

import type { AbcdeLetter } from "@/lib/resus/types";

import { mostUrgentAction, outstandingActionCount } from "@/lib/resus/action-order";
import { ActionRow } from "./action-row";
import { useDeskCtx } from "./desk-context";

/**
 * Resus Desk v2 — a step's action board (prompt §5.5): the engine's merged,
 * already-ordered list (failed → indicated → in progress → deferred →
 * performed → N/A) with an "N outstanding" badge and a polite live region
 * that names the most urgent one. Surfacing ≠ filtering: every row shows.
 */
export function ActionsBoard({ step }: { step: AbcdeLetter }) {
  const { survey, store } = useDeskCtx();
  const actions = survey.actions[step];
  const outstanding = outstandingActionCount(actions);
  const top = mostUrgentAction(actions);
  const headingId = `actions-${step}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-heading-s text-foreground">
          Actions for {step} ({actions.length})
        </h3>
        {outstanding > 0 ? (
          <span className="text-caption rounded-sm bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            {outstanding} outstanding
          </span>
        ) : actions.length > 0 ? (
          <span className="text-caption text-muted-foreground">Nothing outstanding</span>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {top ? `Most urgent for ${step}: ${top.label}` : ""}
      </p>
      {actions.length === 0 ? (
        <p className="border-border text-body-s text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center">
          {/* Read-only: no prompt to record — nothing can be entered. */}
          {store.readOnly
            ? `No actions for ${step}.`
            : `Record ${step} findings to see the matched actions.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {actions.map((a) => (
            <ActionRow key={a.code} action={a} />
          ))}
        </ul>
      )}
    </section>
  );
}
