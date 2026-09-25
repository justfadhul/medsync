"use client";

import type { BoardV2Row } from "@/lib/resus/board-v2";
import type { FlowBadge, PatientFlowRow } from "@/lib/workspace/flow";
import type { LaneId } from "@/lib/workspace/lanes";

import { StepChip } from "@/app/nurse/resus/_components/board-v2-rows";
import { AMBER_CHIP } from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-words";
import { cn } from "@/lib/utils";
import { AcuityChip } from "./acuity-chip";
import { when } from "./clock";
import { Elapsed } from "./elapsed";
import { PatientLine } from "./patient-line";
import { OverflowMenu, PrimaryAction } from "./row-actions";

/** Time in stage, in the lane's own words (elapsed only — Law 5). */
const TIME_WORD: Record<LaneId, [string, string]> = {
  resus: ["T+", ""],
  triage: ["waiting", ""],
  unassigned: ["triaged", "ago"],
  waiting: ["waiting", ""],
  in_progress: ["active", "ago"],
  needs_closing: ["open", ""],
  done: ["", ""],
};

/**
 * A recorded death takes the acuity chip's place, as a neutral word (Law 6:
 * "Died" is a word, never red); the badge list then leaves it out, so the
 * fact is said once.
 */
export function splitDied(row: PatientFlowRow): { died: FlowBadge | null; badges: FlowBadge[] } {
  const died = row.deceased ? (row.badges.find((b) => b.text.startsWith("Died")) ?? null) : null;
  return { died, badges: died ? row.badges.filter((b) => b !== died) : row.badges };
}

export function DiedChip({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        "text-caption bg-muted text-foreground inline-flex h-6 w-22 shrink-0 items-center justify-center rounded-sm font-medium",
        className,
      )}
    >
      {text}
    </span>
  );
}

export function Badges({ badges, max = 2 }: { badges: FlowBadge[]; max?: number }) {
  const shown = badges.slice(0, max);
  const more = badges.length - shown.length;
  return (
    <>
      {shown.map((b) => (
        <span
          key={b.text}
          className={cn(
            "text-caption rounded-sm px-1.5 py-0.5",
            b.tone === "amber" ? AMBER_CHIP : "bg-muted text-foreground",
          )}
        >
          {b.text}
        </span>
      ))}
      {more > 0 ? <span className="text-caption text-muted-foreground">+{more} more</span> : null}
    </>
  );
}

export function TimeInStage({ row, serverNowIso }: { row: PatientFlowRow; serverNowIso: string }) {
  if (row.deceased) return null;
  if (row.lane === "done") {
    return (
      <span className="font-mono tabular-nums">
        ended {when(row.sinceMs, Date.parse(serverNowIso))}
      </span>
    );
  }
  const [before, after] = TIME_WORD[row.lane];
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 whitespace-nowrap",
        // FW-10: amber only past a CSO-signed target; with none signed it never is.
        row.waitTone === "amber" && cn(AMBER_CHIP, "rounded-sm px-1.5 py-0.5"),
      )}
    >
      {before}
      <Elapsed sinceMs={row.sinceMs} serverNowIso={serverNowIso} />
      {after}
    </span>
  );
}

/**
 * One patient, one row (FW-1): acuity · name · age sex · MRN / reason · stage
 * · badges · time in stage · the next step · ⋯. The row body opens the panel;
 * j/k move between rows (a roving tab stop: only the active row is in the tab
 * order, its body, next step and ⋯ in that order).
 */
export function WorkspaceRow({
  row,
  selected,
  active,
  serverNowIso,
  onSelect,
  onActivate,
}: {
  row: PatientFlowRow;
  selected: boolean;
  active: boolean;
  serverNowIso: string;
  onSelect: (key: string) => void;
  onActivate: (key: string) => void;
}) {
  const tab = active ? 0 : -1;
  const arrest = row.resus?.section === "arrest";
  const { died, badges } = splitDied(row);
  return (
    <li
      data-row={row.key}
      onFocusCapture={() => onActivate(row.key)}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 sm:flex-nowrap",
        "ease-expo-out transition-colors duration-150",
        selected
          ? "dark:bg-muted/50 border-gray-300 bg-gray-50"
          : "border-border bg-card dark:hover:bg-muted/40 hover:border-gray-300 hover:bg-gray-50",
      )}
    >
      <button
        type="button"
        data-row-body
        tabIndex={tab}
        aria-current={selected || undefined}
        onClick={() => onSelect(row.key)}
        // Phones: the patient takes the whole width and the next step sits under it (§5.3).
        className="focus-visible:shadow-focus flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none max-sm:basis-full sm:items-center"
      >
        {arrest ? (
          <span className="mt-2 size-2.5 shrink-0 rounded-full bg-rose-600 sm:mt-0">
            <span className="sr-only">Cardiac arrest in progress</span>
          </span>
        ) : null}
        {died ? (
          <DiedChip text={died.text} className="mt-0.5 sm:mt-0" />
        ) : (
          <AcuityChip level={row.acuity.level} className="mt-0.5 sm:mt-0" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <PatientLine identity={row.identity} />
          <span className="text-body-s text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
            {row.reason ? <span className="text-foreground">{row.reason}</span> : null}
            <span>{row.stageDetail}</span>
            {row.resus?.worst ? <StepChip worst={row.resus.worst as BoardV2Row["worst"]} /> : null}
            <Badges badges={badges} />
            <span className="text-caption sm:hidden">
              <TimeInStage row={row} serverNowIso={serverNowIso} />
            </span>
          </span>
        </span>
        <span className="text-caption text-muted-foreground hidden shrink-0 sm:inline">
          <TimeInStage row={row} serverNowIso={serverNowIso} />
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1 max-sm:ml-auto">
        <PrimaryAction row={row} tabIndex={tab} />
        <OverflowMenu row={row} tabIndex={tab} />
      </div>
    </li>
  );
}
