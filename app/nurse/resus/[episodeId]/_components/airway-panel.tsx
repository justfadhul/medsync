"use client";

import type { PrescribeAuthority } from "./prescribe-dialog";
import type { AirwayActionState, AirwayFindingSet } from "@/lib/resus/airway";
import type { AirwayPatency } from "@/lib/resus/reference/airway-catalog";
import type { ResusDoseId } from "@/lib/resus/reference/doses";
import type { TimelineEvent } from "@/lib/resus/types";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import {
  CheckIcon,
  CircleDotIcon,
  LoaderCircleIcon,
  MinusIcon,
  PauseIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { RECOMMENDATION_DRUG_MAP } from "@/lib/prescribing/reference/emergency-drug-catalog";
import {
  mostUrgentAction,
  orderResusActions,
  outstandingActionCount,
} from "@/lib/resus/action-order";
import {
  airwayProceedGuard,
  buildAirwayActions,
  classifyAirway,
  escalationFor,
  isArrestPattern,
  latestAirwayAssessment,
  triggeredActions,
} from "@/lib/resus/airway";
import {
  AIRWAY_DIFFICULTY,
  AIRWAY_FEEL,
  AIRWAY_LISTEN,
  AIRWAY_LOOK,
  AIRWAY_PATENCY,
  AIRWAY_PATENCY_LABEL,
  airwayAction,
} from "@/lib/resus/reference/airway-catalog";
import { getResusDose } from "@/lib/resus/reference/doses";
import { cn } from "@/lib/utils";
import { detectResusArrestAction, recordAirwayFindings, setAirwayActionState } from "../../actions";
import { PrescribeDialog } from "./prescribe-dialog";
import { ResusActionsHeading } from "./resus-actions-heading";

const PRESCRIBABLE = new Set(Object.keys(RECOMMENDATION_DRUG_MAP));

const STATE_TONE: Record<string, string> = {
  secure: "border-mint-300/70 bg-mint-50/60 text-mint-700 dark:bg-mint-950/25 dark:text-mint-200",
  threatened:
    "border-amber-300/70 bg-amber-50/60 text-amber-800 dark:bg-amber-950/25 dark:text-amber-200",
  partially_obstructed:
    "border-orange-400/70 bg-orange-50/60 text-orange-700 dark:bg-orange-950/25 dark:text-orange-200",
  completely_obstructed:
    "border-rose-500/80 bg-rose-50/70 text-rose-700 ring-1 ring-rose-500/40 motion-safe:animate-pulse dark:bg-rose-950/30 dark:text-rose-200",
  apnoeic_ventilate:
    "border-rose-500/80 bg-rose-50/70 text-rose-700 ring-1 ring-rose-500/40 motion-safe:animate-pulse dark:bg-rose-950/30 dark:text-rose-200",
  apnoeic_arrest: "border-rose-600 bg-rose-600 text-white motion-safe:animate-pulse",
  unknown: "border-border bg-muted/30 text-muted-foreground",
};

const STATE_LABEL: Record<string, string> = {
  secure: "Secure",
  threatened: "Threatened",
  partially_obstructed: "Partially obstructed",
  completely_obstructed: "Completely obstructed",
  apnoeic_ventilate: "Apnoea — ventilate",
  apnoeic_arrest: "Apnoeic — arrest",
  unknown: "Not yet assessed",
};

/**
 * Action-state colour identities (DESIGN-medsync "Resus state colour
 * system"). The CURRENT state shows as a filled coloured token (icon +
 * word); the others are quieter controls. Alarm scarcity — only `failed`
 * is red. `indicated` (amber) = the recommended next thing. Never colour
 * alone (every token carries an icon + word).
 */
const ACTION_STATE_STYLE: Record<
  AirwayActionState,
  { label: string; short: string; token: string; icon: LucideIcon }
> = {
  indicated: {
    label: "Indicated",
    short: "Indicated",
    token: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    icon: CircleDotIcon,
  },
  in_progress: {
    label: "In progress",
    short: "Doing",
    token:
      "bg-blue-100 text-blue-800 motion-safe:animate-pulse dark:bg-blue-900/40 dark:text-blue-200",
    icon: LoaderCircleIcon,
  },
  performed: {
    label: "Performed",
    short: "Done",
    token: "bg-mint-100 text-mint-800 dark:bg-mint-900/50 dark:text-mint-200",
    icon: CheckIcon,
  },
  failed: {
    label: "Failed",
    short: "Failed",
    token: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200",
    icon: TriangleAlertIcon,
  },
  deferred: {
    label: "Deferred",
    short: "Defer",
    token: "bg-muted text-muted-foreground",
    icon: PauseIcon,
  },
  not_indicated: {
    label: "Not indicated",
    short: "N/A",
    token: "border border-border text-muted-foreground/70",
    icon: MinusIcon,
  },
};

/** The states a clinician can SET (indicated is the default, not a target). */
const SETTABLE_STATES: AirwayActionState[] = [
  "in_progress",
  "performed",
  "failed",
  "deferred",
  "not_indicated",
];

export function AirwayPanel({
  episodeId,
  timeline,
  active,
  patientAgeYears,
  prescribeAuthority,
  onChanged,
}: {
  episodeId: string;
  timeline: TimelineEvent[];
  active: boolean;
  patientAgeYears: number | null;
  prescribeAuthority: PrescribeAuthority;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [prescribeFor, setPrescribeFor] = useState<{ code: string; label: string } | null>(null);

  // Working finding-set draft, seeded from the last recorded airway assessment.
  const seeded = useMemo(() => latestAirwayAssessment(timeline), [timeline]);
  const [patency, setPatency] = useState<AirwayPatency | null>(seeded?.patency ?? null);
  const [present, setPresent] = useState<string[]>(seeded?.present ?? []);
  const [difficulty, setDifficulty] = useState<string[]>(seeded?.difficulty ?? []);
  const [ctx, setCtx] = useState<AirwayFindingSet["context"]>(seeded?.context ?? {});

  const draft: AirwayFindingSet = { patency, present, difficulty, context: ctx };
  const state = classifyAirway(draft);
  const triggered = triggeredActions(draft);
  const arrest = isArrestPattern(draft);
  const guard = airwayProceedGuard(state);

  const recorded = useMemo(() => buildAirwayActions(timeline), [timeline]);
  const recordedByCode = useMemo(() => new Map(recorded.map((a) => [a.actionCode, a])), [recorded]);

  // Reassess nudge: an action recorded after the last finding-set.
  const reassessDue = useMemo(() => {
    const aEvents = timeline.filter((e) => e.step === "A");
    const lastFinding = aEvents
      .filter((e) => e.kind === "assessment")
      .reduce<string | null>((m, e) => (m === null || e.recordedAt > m ? e.recordedAt : m), null);
    const lastAction = aEvents
      .filter((e) => ["action", "drug", "procedure"].includes(e.kind))
      .reduce<string | null>((m, e) => (m === null || e.recordedAt > m ? e.recordedAt : m), null);
    return lastAction !== null && (lastFinding === null || lastAction > lastFinding);
  }, [timeline]);

  function toggle(list: string[], set: (v: string[]) => void, code: string) {
    set(list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);
  }

  function recordFindings() {
    if (!active) return;
    startTransition(async () => {
      await recordAirwayFindings({ episodeId, findingSet: draft });
      onChanged();
    });
  }

  function setActionState(code: string, s: AirwayActionState) {
    if (!active) return;
    startTransition(async () => {
      await setAirwayActionState({ episodeId, actionId: code, actionCode: code, state: s });
      onChanged();
    });
  }

  function declareArrest() {
    if (!active) return;
    startTransition(async () => {
      await detectResusArrestAction({
        episodeId,
        responsive: false,
        breathingNormally: false,
        centralPulse: false,
      });
      onChanged();
    });
  }

  // Merge: triggered (indicated) actions + any recorded action not currently triggered.
  // Merge triggered + recorded-only into ONE urgency-ordered board (shared
  // ordering — failed→top … performed/N-A→receded). Surfacing ≠ filtering.
  const triggeredCodes = new Set(triggered.map((t) => t.code));
  const boardItems = orderResusActions([
    ...triggered.map((t) => ({
      code: t.code,
      rationale: t.rationale,
      emergency: t.emergency,
      priority: t.priority,
      state: recordedByCode.get(t.code)?.state,
    })),
    ...recorded
      .filter((a) => !triggeredCodes.has(a.actionCode))
      .map((a) => ({
        code: a.actionCode,
        rationale: "",
        emergency: airwayAction(a.actionCode)?.emergency ?? false,
        priority: undefined,
        state: a.state,
      })),
  ]);
  const outstanding = outstandingActionCount(boardItems);
  const top = mostUrgentAction(boardItems);

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4">
      {/* Header + airway-state indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="bg-foreground/90 text-background text-body-m flex size-8 items-center justify-center rounded-lg font-mono font-semibold">
            A
          </span>
          <h2 className="text-foreground text-heading-s tracking-[-0.01em]">Airway</h2>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
            STATE_TONE[state ?? "unknown"],
          )}
        >
          {(state === "completely_obstructed" ||
            state === "apnoeic_ventilate" ||
            state === "apnoeic_arrest") && <span aria-hidden>▲</span>}
          {STATE_LABEL[state ?? "unknown"]}
        </span>
      </div>

      {/* Treat-before-proceeding / open-threat indicator */}
      <div
        className={cn(
          "rounded-lg border px-3 py-1.5 text-[11.5px]",
          guard.ok
            ? "border-mint-300/60 bg-mint-50/50 text-mint-700 dark:bg-mint-950/20 dark:text-mint-200"
            : "border-amber-300/70 bg-amber-50/60 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200",
        )}
      >
        {guard.ok ? "✓ Airway secure — safe to proceed to B." : `⚠ ${guard.warning}`}
      </div>

      {/* Arrest route — confirmed pulselessness only */}
      {arrest ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-600 bg-rose-600 px-3 py-2 text-white">
          <p className="text-[12.5px] font-bold">
            ⚠ Apnoea + no signs of life — cardiac arrest, not an airway problem.
          </p>
          <button
            type="button"
            disabled={!active || pending}
            onClick={declareArrest}
            className="tap shrink-0 rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-rose-700 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Start CPR → ALS
          </button>
        </div>
      ) : state === "apnoeic_ventilate" ? (
        <div className="rounded-lg border border-rose-500/80 bg-rose-50/70 px-3 py-2 text-rose-800 ring-1 ring-rose-500/30 dark:bg-rose-950/30 dark:text-rose-200">
          <p className="text-[12.5px] font-bold">
            ⚠ Apnoea WITH a pulse — open airway + ventilate (bag-mask). Confirm the pulse — if none,
            tick &ldquo;No signs of life&rdquo; → cardiac arrest.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
        {/* ── Findings capture ── */}
        <section className="flex flex-col gap-2.5">
          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
            Findings — patency
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {AIRWAY_PATENCY.map((p) => (
              <button
                key={p}
                type="button"
                disabled={!active}
                onClick={() => setPatency(patency === p ? null : p)}
                className={cn(
                  "tap rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition-colors disabled:opacity-50",
                  patency === p
                    ? "border-foreground/30 bg-foreground/90 text-background font-medium"
                    : "border-border bg-muted/30 text-foreground/80 hover:bg-muted/60",
                )}
              >
                {AIRWAY_PATENCY_LABEL[p]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <ContextToggle
              label="Trauma / C-spine"
              on={!!ctx.trauma}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, trauma: !ctx.trauma })}
            />
            <ContextToggle
              label="Allergen trigger"
              on={!!ctx.allergenTrigger}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, allergenTrigger: !ctx.allergenTrigger })}
            />
            <ContextToggle
              label="Gag / clenched jaw"
              on={!!ctx.gagPresent}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, gagPresent: !ctx.gagPresent })}
            />
            <ContextToggle
              label="No signs of life"
              danger
              on={!!ctx.noSignsOfLife}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, noSignsOfLife: !ctx.noSignsOfLife })}
            />
          </div>

          <FindingGroup
            title="Look"
            findings={AIRWAY_LOOK}
            present={present}
            disabled={!active}
            onToggle={(c) => toggle(present, setPresent, c)}
          />
          <FindingGroup
            title="Listen"
            findings={AIRWAY_LISTEN}
            present={present}
            disabled={!active}
            onToggle={(c) => toggle(present, setPresent, c)}
          />
          <FindingGroup
            title="Feel"
            findings={AIRWAY_FEEL}
            present={present}
            disabled={!active}
            onToggle={(c) => toggle(present, setPresent, c)}
          />

          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
            Difficulty screen (anticipate)
          </h3>
          <p className="text-muted-foreground/70 -mt-1 text-[10px] leading-snug">
            Anticipation prompts only — limited sensitivity (esp. Mallampati alone); not pass/fail
            gates.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {AIRWAY_DIFFICULTY.map((d) => (
              <button
                key={d.code}
                type="button"
                disabled={!active}
                title={d.expansion}
                onClick={() => toggle(difficulty, setDifficulty, d.code)}
                className={cn(
                  "tap text-caption rounded-lg border px-2 py-1 transition-colors disabled:opacity-50",
                  difficulty.includes(d.code)
                    ? "border-amber-400/70 bg-amber-50/60 text-amber-800 dark:bg-amber-950/25 dark:text-amber-200"
                    : "border-border bg-muted/30 text-foreground/70 hover:bg-muted/60",
                )}
              >
                {d.label.split(" — ")[0]}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!active || pending}
            onClick={recordFindings}
            className="tap bg-mint-600 hover:bg-mint-700 mt-1 self-start rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors disabled:opacity-50"
          >
            {reassessDue ? "↻ Re-record airway findings" : "Record airway findings"}
          </button>
        </section>

        {/* ── Triggered actions — a floating card that stays beside the
            findings as you scroll through what's being assessed (lg+). ── */}
        <section className="border-border bg-card/95 lg:ring-border/50 flex flex-col gap-2 rounded-lg border p-3 lg:sticky lg:top-30 lg:max-h-[calc(100svh-136px)] lg:overflow-y-auto lg:shadow-md lg:ring-1 lg:backdrop-blur">
          <ResusActionsHeading
            heading="Indicated actions — finding → why → do"
            outstanding={outstanding}
            topLabel={top ? (airwayAction(top.code)?.label ?? top.code) : null}
            topState={top ? (top.state ?? "indicated") : null}
          />
          {boardItems.length === 0 ? (
            <p className="text-muted-foreground/70 border-border/70 bg-muted/20 rounded-lg border border-dashed px-3 py-4 text-center text-[11.5px]">
              {arrest
                ? "Arrest pathway — start CPR."
                : "Record findings to see the matched actions appear here."}
            </p>
          ) : (
            boardItems.map((item) => (
              <ActionCard
                key={item.code}
                code={item.code}
                rationale={item.rationale}
                emergency={item.emergency}
                currentState={item.state}
                disabled={!active || pending}
                onSetState={setActionState}
                prescribable={PRESCRIBABLE.has(item.code)}
                onPrescribe={() =>
                  setPrescribeFor({
                    code: item.code,
                    label: airwayAction(item.code)?.label ?? item.code,
                  })
                }
              />
            ))
          )}
        </section>
      </div>

      {prescribeFor ? (
        <PrescribeDialog
          episodeId={episodeId}
          recCode={prescribeFor.code}
          recLabel={prescribeFor.label}
          patientAgeYears={patientAgeYears}
          prescribeAuthority={prescribeAuthority}
          timeline={timeline}
          onClose={() => setPrescribeFor(null)}
          onDone={onChanged}
        />
      ) : null}
    </div>
  );
}

function ContextToggle({
  label,
  on,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "tap text-caption rounded-full border px-2.5 py-1 transition-colors disabled:opacity-50",
        on
          ? danger
            ? "border-rose-500/70 bg-rose-50/70 text-rose-700 dark:bg-rose-950/30 dark:text-rose-200"
            : "border-foreground/30 bg-foreground/85 text-background"
          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
      )}
    >
      {on ? "✓ " : ""}
      {label}
    </button>
  );
}

function FindingGroup({
  title,
  findings,
  present,
  disabled,
  onToggle,
}: {
  title: string;
  findings: { code: string; label: string; meaning: string }[];
  present: string[];
  disabled: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
        {title}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {findings.map((f) => {
          const on = present.includes(f.code);
          return (
            <button
              key={f.code}
              type="button"
              disabled={disabled}
              title={f.meaning}
              onClick={() => onToggle(f.code)}
              className={cn(
                "tap text-caption rounded-lg border px-2 py-1 transition-colors disabled:opacity-50",
                // Findings describe — keep them CALMER than actions: a selected
                // finding uses the brand teal selected-state; urgency is carried
                // by the airway-STATE indicator, not the individual chips.
                on
                  ? "border-mint-400/70 bg-mint-50/70 text-mint-800 dark:border-mint-500/40 dark:bg-mint-950/25 dark:text-mint-200"
                  : "border-border bg-muted/30 text-foreground/70 hover:bg-muted/60",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActionCard({
  code,
  rationale,
  emergency,
  currentState,
  disabled,
  onSetState,
  prescribable,
  onPrescribe,
}: {
  code: string;
  rationale: string;
  emergency: boolean;
  currentState?: AirwayActionState;
  disabled: boolean;
  onSetState: (code: string, s: AirwayActionState) => void;
  prescribable?: boolean;
  onPrescribe?: () => void;
}) {
  const action = airwayAction(code);
  const dose = action?.doseId ? getResusDose(action.doseId as ResusDoseId) : null;
  const failed = currentState === "failed";
  const escalation = failed ? escalationFor(code) : null;
  const escAction = escalation ? airwayAction(escalation) : null;

  // The active state drives the filled token + a subtle full-card tint
  // (never a left-edge accent). `indicated` is the default until recorded.
  const effective: AirwayActionState = currentState ?? "indicated";
  const style = ACTION_STATE_STYLE[effective];
  const StateIcon = style.icon;
  const cardTint =
    currentState === "failed"
      ? "border-rose-400/60 bg-rose-50/40 dark:bg-rose-950/15"
      : currentState === "in_progress"
        ? "border-blue-300/60 bg-blue-50/40 dark:bg-blue-950/15"
        : currentState === "performed"
          ? "border-mint-300/60 bg-mint-50/30 dark:bg-mint-950/15"
          : currentState === "deferred" || currentState === "not_indicated"
            ? "border-border"
            : emergency
              ? "border-rose-400/60"
              : "border-amber-300/55 bg-amber-50/25 dark:border-amber-500/30 dark:bg-amber-950/10";

  return (
    <div
      className={cn(
        "bg-card rounded-lg border px-2.5 py-2",
        cardTint,
        currentState === "performed" ? "opacity-75" : "",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground/90 flex items-center gap-1.5 text-[12.5px] font-medium">
            {emergency ? (
              <span aria-hidden className="text-rose-600">
                ▲
              </span>
            ) : null}
            <span>{action?.label ?? code}</span>
            <span className="text-muted-foreground/60 font-mono text-[9px] tracking-[0.1em] uppercase">
              T{action?.tier}
            </span>
          </p>
          {rationale ? <p className="text-muted-foreground text-[10.5px]">{rationale}</p> : null}
          {dose ? (
            <p className="text-muted-foreground/80 text-[10.5px]">
              {dose.adultDose ? (
                <span className="text-foreground/80 font-medium">{dose.adultDose}</span>
              ) : (
                <span className="italic">Category-level — clinician doses</span>
              )}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold",
            style.token,
          )}
        >
          <StateIcon className="size-3" aria-hidden />
          {style.label}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {SETTABLE_STATES.map((s) => {
          const sStyle = ACTION_STATE_STYLE[s];
          const SIcon = sStyle.icon;
          const isCurrent = currentState === s;
          return (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onSetState(code, s)}
              aria-pressed={isCurrent}
              className={cn(
                "tap inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors disabled:opacity-40",
                isCurrent
                  ? cn(sStyle.token, "ring-foreground/15 border-transparent font-semibold ring-1")
                  : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              <SIcon className="size-3" aria-hidden />
              {sStyle.short}
            </button>
          );
        })}
        {prescribable && onPrescribe ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onPrescribe}
            className="tap bg-mint-600 hover:bg-mint-700 ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold text-white transition-colors disabled:opacity-40"
          >
            Prescribe / record
          </button>
        ) : null}
      </div>

      {failed && escAction ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-rose-400/50 bg-rose-50/50 px-2 py-1 dark:bg-rose-950/20">
          <span className="text-[10.5px] font-medium text-rose-700 dark:text-rose-200">
            Failed → escalate: {escAction.label}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSetState(escAction.code, "in_progress")}
            className="tap shrink-0 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
            title={`Start ${escAction.label}`}
          >
            Escalate
          </button>
        </div>
      ) : null}
    </div>
  );
}
