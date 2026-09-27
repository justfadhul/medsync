"use client";

import type { PatientContextFlags } from "@/lib/resus/model";
import type { TimelineEvent } from "@/lib/resus/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";

import { setPatientContextV2 } from "@/app/nurse/resus/_v2/actions-survey";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EMPTY_CONTEXT } from "@/lib/resus/model";
import { febrileChildSuggested } from "@/lib/resus/survey/context";
import { cn } from "@/lib/utils";
import { latestAllergyCapture } from "./ample-drawer";
import { CHIP, OFF, ON, PregnancyControl } from "./context-bar-pregnancy";
import { useDeskCtx } from "./desk-context";
import { toOutcome } from "./use-desk";

/**
 * Resus Desk v2 — patient context, entered once (prompt §5.3, GATE A §4). Active
 * flags first, then the common ones, the rest behind "+N". Every toggle writes
 * a PATCH (only the keys it changed; `latestContext` folds them), so two
 * devices toggling different flags never erase each other. Febrile child is
 * only ever SUGGESTED (age < 16 + a fever-stage temperature), never set for you.
 */

type BoolFlag = Exclude<keyof PatientContextFlags, "pregnancy" | "gestationWeeks">;
export type ContextPatch = Partial<PatientContextFlags>;

const FLAGS: { key: BoolFlag; label: string; common?: boolean }[] = [
  { key: "allergenTrigger", label: "Allergen trigger", common: true },
  { key: "trauma", label: "Trauma", common: true },
  { key: "chestTrauma", label: "Chest trauma", common: true },
  { key: "headInjury", label: "Head injury / TBI", common: true },
  { key: "spinalInjury", label: "Spinal injury" },
  { key: "activeBleeding", label: "Active bleeding" },
  { key: "knownAsthma", label: "Known asthma" },
  { key: "copdRisk", label: "COPD / CO₂ retainer" },
  { key: "peSuspected", label: "Suspected PE" },
  { key: "opioidsSuspected", label: "Opioids suspected" },
  { key: "alcoholMalnourished", label: "Alcohol / malnourished" },
  { key: "feverMeningism", label: "Fever + meningism" },
  { key: "serotonergicOrNeuroleptic", label: "Serotonergic / neuroleptic" },
  { key: "environmentalExposure", label: "Environmental exposure" },
  { key: "febrileChild", label: "Febrile child" },
  { key: "bmiOver40", label: "BMI > 40" },
  { key: "renalDialysis", label: "Renal / dialysis" },
  { key: "localAnaestheticToxicity", label: "Local anaesthetic toxicity" },
];
const BY_KEY = new Map(FLAGS.map((f) => [f.key, f]));

/** The same label the server writes (optimistic twin). */
function contextLabel(f: PatientContextFlags): string {
  const on = Object.entries(f)
    .filter(([k, v]) => v === true && k in EMPTY_CONTEXT)
    .map(([k]) => k);
  if (f.pregnancy !== "none") on.push(`pregnancy ${f.pregnancy}`);
  return on.length ? `Context: ${on.join(", ")}` : "Context cleared";
}

/** Latest recorded temperature: vitals (site unknown) or E core temperature. */
function latestTemp(events: readonly TimelineEvent[]): number | null {
  let at = "";
  let t: number | null = null;
  for (const e of events) {
    const src =
      e.kind === "vital"
        ? (e.payload.snapshot as Record<string, unknown> | undefined)?.temperature
        : e.kind === "assessment" && e.step === "E"
          ? (e.payload.exposure as Record<string, unknown> | undefined)?.coreTempC
          : undefined;
    if (typeof src === "number" && Number.isFinite(src) && e.recordedAt >= at) {
      at = e.recordedAt;
      t = src;
    }
  }
  return t;
}

export function ContextBar() {
  const { store, ui, flags, ageYears, allergiesRecorded } = useDeskCtx();
  const readOnly = store.readOnly;
  const events = store.activeEvents;
  const temp = useMemo(() => latestTemp(events), [events]);
  const capture = useMemo(() => latestAllergyCapture(events), [events]);
  const feverHint = !readOnly && !flags.febrileChild && febrileChildSuggested(ageYears, temp);

  const write = (patch: ContextPatch) => {
    const next = { ...flags, ...patch };
    // `patch` is what the server merges onto its latest context; `flags` is the full set as seen here.
    const input = { episodeId: store.episode.id, flags: next, patch };
    store.submit({
      label: "Patient context",
      optimistic: () => [
        {
          kind: "context",
          step: "pre",
          payload: { flags: next, patch, label: contextLabel(next) },
        },
      ],
      run: async ({ clientEventId, recordedAt }) =>
        toOutcome(await setPatientContextV2({ ...input, clientEventId, recordedAt })),
    });
  };
  const flip = (k: BoolFlag) => write({ [k]: !flags[k] });

  // Active first — but never re-sorted under the finger or keyboard focus: the
  // order is held while the bar is in use and new flags are appended.
  const live = [
    ...FLAGS.filter((f) => flags[f.key]),
    ...FLAGS.filter((f) => !flags[f.key] && (f.common || (f.key === "febrileChild" && feverHint))),
  ].map((f) => f.key);
  const [held, setHeld] = useState<BoolFlag[] | null>(null);
  const order = held ? [...held, ...live.filter((k) => !held.includes(k))] : live;
  const visible = order.map((k) => BY_KEY.get(k)!);
  const hold = () => setHeld((h) => h ?? live);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!held) return;
    // A tap anywhere else (touch has no pointerleave while hovering) re-sorts.
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setHeld(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [held]);

  const menu = FLAGS.filter((f) => !f.common);
  const hiddenCount = menu.filter((f) => !visible.includes(f)).length;

  return (
    <section
      ref={ref}
      aria-label="Patient context"
      onPointerDown={hold}
      onFocus={hold}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHeld(null);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(null);
      }}
      className="border-border bg-card flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
    >
      <span className="text-overline text-muted-foreground mr-1 uppercase">Context</span>
      {visible.map((f) => (
        <button
          key={f.key}
          type="button"
          aria-pressed={flags[f.key]}
          disabled={readOnly}
          onClick={() => flip(f.key)}
          className={cn(CHIP, flags[f.key] ? ON : OFF)}
        >
          {flags[f.key] ? <CheckIcon className="size-3.5" aria-hidden /> : null}
          {f.label}
          {f.key === "febrileChild" && feverHint ? (
            <span className="text-caption text-amber-700 dark:text-amber-300">· suggested</span>
          ) : null}
        </button>
      ))}

      <PregnancyControl flags={flags} readOnly={readOnly} write={write} />

      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={readOnly}
          render={
            <button
              type="button"
              aria-label={`More context flags (${hiddenCount} more)`}
              className={cn(CHIP, OFF, "font-mono")}
            />
          }
        >
          +{hiddenCount}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          {menu.map((f) => (
            <DropdownMenuCheckboxItem
              key={f.key}
              checked={flags[f.key]}
              onCheckedChange={() => flip(f.key)}
              className="text-body-s min-h-11 px-3"
            >
              {f.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Read-only: no "not recorded" nudge — nothing can be entered. */}
      {readOnly && !allergiesRecorded ? null : (
        <button
          type="button"
          onClick={ui.openAmple}
          className={cn(
            CHIP,
            "ml-auto max-w-full py-1.5 text-left",
            allergiesRecorded
              ? OFF
              : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
          )}
        >
          {allergiesRecorded ? null : <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />}
          {/* An allergy list wraps; it never truncates. */}
          <span className="min-w-0">
            {!allergiesRecorded
              ? "Allergies not recorded"
              : capture?.nkda
                ? "Allergies: none known (NKDA)"
                : capture && capture.substances.length > 0
                  ? `Allergies: ${capture.substances.join(", ")}`
                  : "Allergies recorded"}
          </span>
        </button>
      )}
    </section>
  );
}
