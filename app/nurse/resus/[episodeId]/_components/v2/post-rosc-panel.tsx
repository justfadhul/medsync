"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  HeartPulseIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { computeArrestState } from "@/lib/resus/als/engine";
import { levelInputFromRecord, suggestLevel } from "@/lib/resus/closeout/level-of-care";
import { ALS_REFS, ROSC_SUSTAINED_MS } from "@/lib/resus/reference/als-catalog";
import { LEVELS_OF_CARE, NO_SUGGESTION_TEXT } from "@/lib/resus/reference/levels-of-care";
import { PENDING_CSO } from "@/lib/resus/reference/ref";
import { arrestContextOf, clock, hhmm } from "./after-arrest-shared";
import { ArrestDetails } from "./arrest-details";
import { useDeskCtx } from "./desk-context";
import { PostRoscBundle } from "./post-rosc-bundle";
import { useReArrest } from "./post-rosc-rearrest";
import { useNow } from "./use-desk";

/**
 * PostRoscPanel — post-ROSC mode (prompt §5.10). Header: the ROSC clock and the
 * 20:00 sustain timer (ALS-ROSC-03), the arrest summary, and Re-arrest always one
 * tap (ALS-ROSC-07). Then the bundle (post-rosc-bundle.tsx) and the suggested
 * level of care with its reasons (CO-R*). No prognostic statement (PR-NEVER-01).
 */

/** The only ticking leaf: ROSC clock + sustain progress. */
function SustainTimer({
  roscAtMs,
  sustainedAtMs,
}: {
  roscAtMs: number;
  sustainedAtMs: number | null;
}) {
  const { store } = useDeskCtx();
  const now = useNow(store.nowMs, 1000);
  const since = Math.max(0, now - roscAtMs);
  const signed = ALS_REFS["ALS-ROSC-03"]?.status === "signed";
  const sustained = sustainedAtMs !== null && now >= sustainedAtMs;
  return (
    <>
      <span
        className="text-heading-m text-foreground font-mono tabular-nums"
        suppressHydrationWarning
      >
        {clock(since)}
      </span>
      {!signed ? (
        <span className="text-body-s text-muted-foreground">Sustained timer: {PENDING_CSO}</span>
      ) : sustained ? (
        <span className="text-body-s inline-flex items-center gap-1.5 font-medium text-teal-800">
          <CircleCheckIcon className="size-4" aria-hidden />
          Sustained ROSC
        </span>
      ) : (
        <span className="text-body-s text-muted-foreground inline-flex items-center gap-2">
          sustained at {clock(ROSC_SUSTAINED_MS)}
          {/* Computed from the clock at render: the server's value never matches the client's. */}
          <span
            suppressHydrationWarning
            role="progressbar"
            aria-label="Sustained-ROSC timer"
            aria-valuemin={0}
            aria-valuemax={ROSC_SUSTAINED_MS / 1000}
            aria-valuenow={Math.floor(since / 1000)}
            aria-valuetext={`${clock(since)} of ${clock(ROSC_SUSTAINED_MS)}`}
            className="bg-muted block h-1.5 w-24 overflow-hidden rounded-full"
          >
            <span
              suppressHydrationWarning
              className="block h-full origin-left bg-teal-500"
              style={{ transform: `scaleX(${Math.min(1, since / ROSC_SUSTAINED_MS)})` }}
            />
          </span>
        </span>
      )}
    </>
  );
}

function RoscHeader() {
  const d = useDeskCtx();
  const { store } = d;
  const reArrest = useReArrest();
  const events = store.activeEvents;
  // Counts and timestamps only — they change with events, not with the clock.
  const arrest = useMemo(
    () => computeArrestState(events, store.nowMs(), arrestContextOf(d, events)),
    [d, events, store],
  );
  const shocks = arrest.shocks.count;
  return (
    <header className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-6">
      <h2
        id="post-rosc-heading"
        className="text-heading-s inline-flex items-center gap-2 rounded-md bg-teal-50 px-2.5 py-1 text-teal-800"
      >
        <HeartPulseIcon className="size-5" aria-hidden />
        ROSC
      </h2>
      {arrest.rosc.atMs !== null ? (
        <SustainTimer roscAtMs={arrest.rosc.atMs} sustainedAtMs={arrest.rosc.sustainedAtMs} />
      ) : null}
      {arrest.arrestAtMs !== null && arrest.arrestSeq > 0 ? (
        <p className="text-body-s text-muted-foreground">
          Arrest #{arrest.arrestSeq} · declared {hhmm(arrest.arrestAtMs)} · {shocks}{" "}
          {shocks === 1 ? "shock" : "shocks"} · adrenaline ×{arrest.adrenaline.doses}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <ArrestDetails arrestSeq={arrest.arrestSeq} />
        <Button
          variant="emergency"
          size="lg"
          className="tap min-h-12"
          disabled={store.readOnly}
          onClick={reArrest}
        >
          <TriangleAlertIcon className="size-5" aria-hidden />
          Re-arrest
        </Button>
      </div>
    </header>
  );
}

/** Suggested level of care (CO-R1..R16) — the reasons open on tap. The leader chooses at close-out. */
function LevelHint() {
  const { store, initial, ageYears } = useDeskCtx();
  const events = store.activeEvents;
  const s = useMemo(
    () => suggestLevel(levelInputFromRecord(events, { ageYears }), initial.careUnits),
    [events, ageYears, initial.careUnits],
  );
  const top = s.level ? s.reasons.find((r) => r.level === s.level) : undefined;
  return (
    <details className="group min-w-0 flex-1">
      <summary className="text-body-s focus-visible:shadow-focus flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md outline-none [&::-webkit-details-marker]:hidden">
        <span className="text-muted-foreground shrink-0">Suggested level:</span>
        <span className="text-foreground shrink-0 font-medium">
          {s.level ? LEVELS_OF_CARE[s.level].label : NO_SUGGESTION_TEXT}
        </span>
        {top ? <span className="text-muted-foreground truncate">· {top.text}</span> : null}
        <ChevronDownIcon
          className="text-muted-foreground ease-expo-out size-4 shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="text-body-s space-y-2 pt-1 pb-2">
        {s.reasons.length === 0 ? (
          <p className="text-muted-foreground">
            No rule matches the record yet — the leader chooses.
          </p>
        ) : (
          <ul className="space-y-1">
            {s.reasons.map((r) => (
              <li key={r.ruleId}>
                <span className="text-muted-foreground font-mono">{r.ruleId}</span> {r.text}{" "}
                <span className="text-caption text-muted-foreground">({r.source})</span>
              </li>
            ))}
          </ul>
        )}
        {s.extraDestinations.map((x) => (
          <p key={x.ruleId}>
            <span className="text-muted-foreground">Also consider:</span> {x.reason}
          </p>
        ))}
        {s.level ? (
          <p className="text-muted-foreground">
            {initial.careUnits.length === 0
              ? "No care units declared for this hospital yet — name the destination at close-out."
              : s.qualifyingUnits.length > 0
                ? `Units here with the capabilities: ${s.qualifyingUnits.map((u) => u.name).join(", ")}`
                : "No unit here declares all the capabilities needed."}
          </p>
        ) : null}
      </div>
    </details>
  );
}

export function PostRoscPanel() {
  const { ui } = useDeskCtx();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      data-testid="post-rosc-panel"
      aria-labelledby="post-rosc-heading"
      className="border-border bg-card shadow-card rounded-lg border"
    >
      <RoscHeader />
      <div id="post-rosc-bundle">{collapsed ? null : <PostRoscBundle />}</div>
      <footer className="border-border flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-start sm:px-6">
        <LevelHint />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button
            variant="secondary"
            size="lg"
            aria-expanded={!collapsed}
            aria-controls="post-rosc-bundle"
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              // Continue survey: the bundle folds away — land on the survey step, not <body>.
              if (next)
                requestAnimationFrame(() =>
                  document.getElementById("survey-step-heading")?.focus(),
                );
            }}
          >
            {collapsed ? "Show post-ROSC bundle" : "Continue survey (post-ROSC)"}
          </Button>
          <Button size="lg" onClick={() => ui.openCloseOut()}>
            End resus
            <ArrowRightIcon className="size-4" aria-hidden />
            destination…
          </Button>
        </div>
      </footer>
    </section>
  );
}
