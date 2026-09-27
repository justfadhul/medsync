import type { ReactNode } from "react";
import { LockIcon, MinusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Inline chips for structured items (UI-BRIEF §3–4, gate-a E.4).
 *
 * FindingChip — three states, default "not asked". The accessible name says the value in words
 * ("Chills, present"), never the colour. Space and Enter cycle (a native button); the change is
 * instant — keyboard actions never animate — and a pointer press gets scale(0.97) for 100 ms.
 * Present is the selected teal state; absent is neutral with a minus mark and the word (a
 * pertinent negative, so never struck: strikethrough means entered in error); not asked is quiet.
 *
 * FactChip — a recorded value with its source mark ("Triage", "Lab"), each part its own span.
 */

export type FindingState = "not_asked" | "present" | "absent";
const ORDER: readonly FindingState[] = ["not_asked", "present", "absent"];
export const FINDING_WORD: Record<FindingState, string> = {
  not_asked: "not asked",
  present: "present",
  absent: "absent",
};
export const nextFindingState = (s: FindingState): FindingState =>
  ORDER[(ORDER.indexOf(s) + 1) % ORDER.length]!;

const PRESS =
  "transition-[transform,background-color,border-color,color] duration-100 ease-expo-out active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:shadow-focus outline-none";

export function FindingChip({
  label,
  state,
  onChange,
  disabled,
}: {
  label: string;
  state: FindingState;
  onChange?: (next: FindingState) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${label}, ${FINDING_WORD[state]}`}
      data-state={state}
      onClick={() => onChange?.(nextFindingState(state))}
      className={cn(
        "text-body-s inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 sm:min-h-8",
        PRESS,
        state === "present" && "border-teal-600 bg-teal-50 text-teal-800",
        state === "absent" && "border-gray-300 bg-gray-100 text-gray-700",
        state === "not_asked" && "border-border text-muted-foreground bg-transparent",
      )}
    >
      <span>{label}</span>
      <span aria-hidden className="text-caption inline-flex items-center gap-0.5">
        {state === "absent" ? <MinusIcon aria-hidden className="size-3" /> : null}
        {state === "present" ? "Present" : state === "absent" ? "Absent" : "Not asked"}
      </span>
    </button>
  );
}

export function FactChip({
  label,
  value,
  unit,
  source,
  restricted = false,
  className,
}: {
  label: ReactNode;
  value?: ReactNode;
  unit?: string | null;
  /** Where the value came from, in a word ("Triage", "Lab", "Patient-reported"). */
  source?: string | null;
  restricted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "border-border bg-background text-body-s inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border px-2 py-1",
        className,
      )}
    >
      <span className="text-foreground">{label}</span>
      {value !== undefined && value !== null ? (
        <span className="inline-flex items-baseline gap-1">
          <span className="font-mono font-medium tabular-nums">{value}</span>
          {unit ? <span className="text-caption text-muted-foreground">{unit}</span> : null}
        </span>
      ) : null}
      {source ? <span className="text-caption text-muted-foreground">{source}</span> : null}
      {restricted ? <RestrictedMark /> : null}
    </span>
  );
}

/** A lock and the word. It says restricted content is here; it reveals nothing. */
export function RestrictedMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("text-caption text-muted-foreground inline-flex items-center gap-1", className)}
    >
      <LockIcon aria-hidden className="size-3" />
      Restricted
    </span>
  );
}
