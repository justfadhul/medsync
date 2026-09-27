"use client";

import type { SegmentOption } from "./after-arrest-shared";
import type { AfterDeathTaskRow } from "./types";
import type { CareLevel, OutcomeCode } from "@/lib/resus/model";
import { useMemo, useState } from "react";
import { CheckIcon, CircleCheckIcon, CircleDashedIcon, LockIcon, MinusIcon } from "lucide-react";

import { recordAfterDeathTaskV2 } from "@/app/nurse/resus/_v2/actions-closeout";
import { CLOSEOUT_REFS, LEVELS_OF_CARE } from "@/lib/resus/reference/levels-of-care";
import {
  afterCloseWindow,
  clock,
  dateTime,
  isDecision,
  latest,
  Segments,
} from "./after-arrest-shared";
import { useDeskCtx } from "./desk-context";
import { useNow } from "./use-desk";

/**
 * After the resus: ClosedSummary (the outcome card of a concluded / cancelled
 * episode, read-only) and AfterDeathChecklist (CO-ADT-01..10; organ donation
 * CO-ADT-11 stays hidden — no hospital setting enables it yet). The checklist is
 * its own record (resus_after_death_tasks), editable until 24 h after close (D16).
 * Saved rows come from the store snapshot (loader + re-read on record changes);
 * this device's picks overlay them optimistically.
 */

type TaskState = AfterDeathTaskRow["state"];

const OUTCOME_LABEL: Record<OutcomeCode, string> = {
  stabilised: "Stabilised",
  rosc_sustained: "ROSC — sustained",
  rosc_not_sustained: "ROSC — not yet sustained",
  died_after_cpr: "Died after CPR",
  died_cpr_not_attempted: "Died — CPR not attempted",
  transferred_out: "Transferred out",
};

const DESTINATION_LABEL: Record<string, string> = {
  icu: "ICU",
  hdu: "HDU",
  ward: "Ward",
  theatre: "Theatre",
  cath_lab: "Cath lab",
  labour_ward: "Labour ward",
  transferred: "Transferred out",
  discharged: "Discharged after observation",
  mortuary: "Mortuary",
  deceased: "Deceased",
};

const MISMATCH_LABEL: Record<string, string> = {
  no_bed: "no bed",
  ceiling_of_care: "ceiling of care agreed",
  family_declined: "family declined",
  transfer_arranged: "transfer arranged",
  clinical_judgement: "clinical judgement",
};

const levelLabel = (l: unknown) =>
  typeof l === "string" && l in LEVELS_OF_CARE ? LEVELS_OF_CARE[l as CareLevel].label : null;

/** The outcome card for a concluded or cancelled episode (header first, record as fallback). */
export function ClosedSummary() {
  const { store, initial } = useDeskCtx();
  const ep = store.episode;
  const events = store.activeEvents;
  const found = useMemo(
    () => ({
      closure: latest(events, (e) => isDecision(e, "closure")),
      cancel: latest(events, (e) => isDecision(e, "cancel")),
      dispo: latest(events, (e) => isDecision(e, "disposition")),
      death: latest(events, (e) => e.kind === "death_confirmed"),
    }),
    [events],
  );
  if (ep.state === "active") return null;

  const { closure, cancel, dispo, death } = found;
  const cancelled = ep.state === "cancelled";
  const closureKind = ep.closureKind ?? (closure?.payload.closureKind as string | undefined);
  const administrative = closureKind === "administrative";
  const outcome = (ep.outcomeCode ?? closure?.payload.outcomeCode ?? null) as OutcomeCode | null;
  const endedIso = ep.endedAtIso ?? closure?.recordedAt ?? cancel?.recordedAt ?? null;
  const d = dispo?.payload ?? {};
  const destination = (d.destination as string | undefined) ?? ep.disposition;
  const unitId = (d.unitId as string | null | undefined) ?? ep.destinationUnitId;
  const unit = initial.careUnits.find((u) => u.id === unitId);
  const suggested = levelLabel(d.suggestedLevel ?? ep.suggestedLevel);
  const chosen = levelLabel(d.chosenLevel ?? ep.chosenLevel);
  const mismatch = typeof d.mismatch === "string" ? MISMATCH_LABEL[d.mismatch] : null;
  const deathIso =
    ep.deathConfirmedAtIso ?? (death?.payload.confirmedAtIso as string | undefined) ?? null;

  const title = cancelled
    ? "Cancelled — opened in error"
    : administrative
      ? "Closed administratively — excluded from clinical statistics"
      : outcome
        ? `Resus ended — ${OUTCOME_LABEL[outcome]}`
        : "Resus ended";
  const reason = cancelled
    ? (ep.cancelReason ?? (cancel?.payload.reason as string | undefined))
    : administrative
      ? (closure?.payload.reason as string | undefined)
      : undefined;

  return (
    <section
      data-testid="closed-summary"
      aria-labelledby="closed-summary-heading"
      className="border-border bg-card shadow-card space-y-2 rounded-lg border px-4 py-4 sm:px-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="closed-summary-heading" className="text-heading-s text-foreground">
          {title}
        </h2>
        <span className="text-caption bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-2 py-0.5">
          <LockIcon className="size-3" aria-hidden />
          Read-only record
        </span>
      </div>
      {reason ? <p className="text-body-s text-foreground">Reason: {reason}</p> : null}
      {destination && !cancelled ? (
        <p className="text-body-s text-foreground">
          Destination: {DESTINATION_LABEL[destination] ?? destination.replace(/_/g, " ")}
          {unit ? ` — ${unit.name}` : ""}
        </p>
      ) : null}
      {suggested || chosen ? (
        <p className="text-body-s text-foreground">
          Level of care: suggested {suggested ?? "none"} · chosen {chosen ?? "—"}
          {mismatch ? (
            <span className="text-muted-foreground">
              {" "}
              — below the suggestion: {mismatch}
              {typeof d.mismatchNote === "string" && d.mismatchNote ? ` (${d.mismatchNote})` : ""}
            </span>
          ) : null}
        </p>
      ) : null}
      {deathIso ? (
        <p className="text-body-s text-foreground">Death confirmed {dateTime(deathIso)}</p>
      ) : null}
      <p className="text-body-s text-muted-foreground font-mono tabular-nums">
        Started {dateTime(ep.startedAtIso)}
        {endedIso
          ? ` · ended ${dateTime(endedIso)} · ${clock(Date.parse(endedIso) - Date.parse(ep.startedAtIso))}`
          : ""}
      </p>
    </section>
  );
}

/** CO-ADT-01..10 in catalog order (CO-ADT-11 organ donation: hidden unless enabled). */
const TASKS = CLOSEOUT_REFS.filter((r) => r.id.startsWith("CO-ADT-") && r.id !== "CO-ADT-11");

const TASK_STATES: SegmentOption<TaskState>[] = [
  { value: "done", label: "Done", icon: CheckIcon, on: "bg-teal-50 text-teal-800" },
  {
    value: "not_applicable",
    label: "Not applicable",
    icon: MinusIcon,
    on: "bg-muted text-foreground",
  },
  { value: "pending", label: "Pending", icon: CircleDashedIcon, on: "bg-muted text-foreground" },
];

/** Latest row per task wins. */
function seed(rows: readonly AfterDeathTaskRow[]): Record<string, TaskState> {
  const out: Record<string, TaskState> = {};
  for (const r of [...rows].sort((a, b) => a.recordedAtIso.localeCompare(b.recordedAtIso)))
    out[r.taskId] = r.state;
  return out;
}

export function AfterDeathChecklist() {
  const { store, ui } = useDeskCtx();
  const now = useNow(store.nowMs, 60_000);
  const saved = useMemo(() => seed(store.afterDeathTasks), [store.afterDeathTasks]);
  const [mine, setStates] = useState<Record<string, TaskState>>({});
  // R6: once the record holds a task's state, drop the local override, so another
  // device's later change shows through (adjusted during render, not in an effect).
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setStates((s) => Object.fromEntries(Object.entries(s).filter(([k, v]) => saved[k] !== v)));
  }
  const states = { ...saved, ...mine };
  const { editable, untilMs } = afterCloseWindow(store.episode, now);
  const done = TASKS.filter((t) => states[t.id] === "done" || states[t.id] === "not_applicable");

  const pick = async (taskId: string, state: TaskState) => {
    const prev = mine[taskId];
    setStates((s) => ({ ...s, [taskId]: state }));
    const r = await recordAfterDeathTaskV2({ episodeId: store.episode.id, taskId, state }).catch(
      () => ({ ok: false as const, error: "No connection — not saved. Try again." }),
    );
    if (!r.ok) {
      setStates((s) => {
        const next = { ...s };
        if (prev) next[taskId] = prev;
        else delete next[taskId];
        return next;
      });
      ui.toast({ message: r.error, tone: "error" });
    }
  };

  return (
    <section
      data-testid="after-death"
      aria-labelledby="after-death-heading"
      className="border-border bg-card shadow-card rounded-lg border"
    >
      <header className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3 sm:px-6">
        <h2 id="after-death-heading" className="text-heading-s text-foreground">
          After-death tasks
        </h2>
        <p className="text-caption text-muted-foreground inline-flex items-center gap-1.5">
          {editable ? (
            <>
              <CircleCheckIcon className="size-3.5" aria-hidden />
              {done.length} of {TASKS.length} complete
              {untilMs !== null ? ` · editable until ${dateTime(untilMs)}` : ""}
            </>
          ) : (
            <>
              <LockIcon className="size-3.5" aria-hidden />
              Read-only — 24 h after close
            </>
          )}
        </p>
      </header>
      <ul className="divide-border divide-y px-4 sm:px-6">
        {TASKS.map((t) => (
          <li
            key={t.id}
            data-action-row
            className="grid gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
          >
            <p className="text-body-s text-foreground">{t.status === "signed" ? t.text : t.id}</p>
            <Segments
              value={states[t.id] ?? "pending"}
              options={TASK_STATES}
              label={t.text.slice(0, 60)}
              disabled={!editable}
              onPick={(s) => void pick(t.id, s)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
