"use client";

import type { PrescribeAuthority } from "./prescribe-dialog";
import type { ExposureActionState, ExposureFindingSet } from "@/lib/resus/exposure";
import type { ExposureState } from "@/lib/resus/reference/exposure-catalog";
import type { TimelineEvent } from "@/lib/resus/types";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import {
  CheckIcon,
  CircleDotIcon,
  LoaderCircleIcon,
  MinusIcon,
  PauseIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { RECOMMENDATION_DRUG_MAP } from "@/lib/prescribing/reference/emergency-drug-catalog";
import {
  mostUrgentAction,
  orderResusActions,
  outstandingActionCount,
} from "@/lib/resus/action-order";
import {
  buildExposureActions,
  classifyExposure,
  escalationFor,
  exposureCycleGuard,
  identifyExposureDiagnosis,
  isExposureArrest,
  latestExposureAssessment,
  temperatureMissing,
  tempStage,
  triggeredActions,
} from "@/lib/resus/exposure";
import {
  EXPOSURE_DIAGNOSIS_LABEL,
  EXPOSURE_DIAGNOSIS_STRATEGY,
  EXPOSURE_INJURY,
  EXPOSURE_PATCHES,
  EXPOSURE_SKIN,
  EXPOSURE_STATE_LABEL,
  EXPOSURE_STATES,
  exposureAction,
  TEMP_STAGE_LABEL,
} from "@/lib/resus/reference/exposure-catalog";
import { cn } from "@/lib/utils";
import {
  detectResusArrestAction,
  recordExposureFindings,
  recordResusReturnToA,
  setExposureActionState,
} from "../../actions";
import { PrescribeDialog } from "./prescribe-dialog";
import { ResusActionsHeading } from "./resus-actions-heading";

const PRESCRIBABLE = new Set(Object.keys(RECOMMENDATION_DRUG_MAP));

const STATE_TONE: Record<string, string> = {
  no_new_critical_finding:
    "border-mint-300/70 bg-mint-50/60 text-mint-700 dark:bg-mint-950/25 dark:text-mint-200",
  significant_finding:
    "border-amber-300/70 bg-amber-50/60 text-amber-800 dark:bg-amber-950/25 dark:text-amber-200",
  temperature_extreme:
    "border-orange-400/70 bg-orange-50/60 text-orange-700 ring-1 ring-orange-400/40 dark:bg-orange-950/25 dark:text-orange-200",
  critical_finding:
    "border-rose-600 bg-rose-600 text-white ring-1 ring-rose-500/50 motion-safe:animate-pulse",
  unknown: "border-border bg-muted/30 text-muted-foreground",
};

const STATE_SHORT: Record<string, string> = {
  no_new_critical_finding: "No new critical finding",
  significant_finding: "Significant finding",
  temperature_extreme: "Temperature extreme",
  critical_finding: "Critical finding",
  unknown: "Not yet assessed",
};

const TEMP_TONE: Record<string, string> = {
  severe_hypothermia: "text-rose-700 dark:text-rose-300",
  moderate_hypothermia: "text-orange-700 dark:text-orange-300",
  mild_hypothermia: "text-amber-700 dark:text-amber-300",
  normal: "text-mint-700 dark:text-mint-300",
  fever: "text-amber-700 dark:text-amber-300",
  hyperthermia: "text-rose-700 dark:text-rose-300",
};

const ACTION_STATE_STYLE: Record<
  ExposureActionState,
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

const SETTABLE_STATES: ExposureActionState[] = [
  "in_progress",
  "performed",
  "failed",
  "deferred",
  "not_indicated",
];

export function ExposurePanel({
  episodeId,
  timeline,
  active,
  patientAgeYears,
  prescribeAuthority,
  onChanged,
  onReturnToA,
}: {
  episodeId: string;
  timeline: TimelineEvent[];
  active: boolean;
  patientAgeYears: number | null;
  prescribeAuthority: PrescribeAuthority;
  onChanged: () => void;
  onReturnToA: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [prescribeFor, setPrescribeFor] = useState<{ code: string; label: string } | null>(null);

  const seeded = useMemo(() => latestExposureAssessment(timeline), [timeline]);
  const [headline, setHeadline] = useState<ExposureState | null>(seeded?.state ?? null);
  const [present, setPresent] = useState<string[]>(seeded?.present ?? []);
  const [ctx, setCtx] = useState<ExposureFindingSet["context"]>(seeded?.context ?? {});
  const [temp, setTemp] = useState<string>(
    seeded?.coreTempC != null ? String(seeded.coreTempC) : "",
  );
  const [allergies, setAllergies] = useState<string>((seeded?.ample?.allergies ?? []).join(", "));
  const [meds, setMeds] = useState<string>(seeded?.ample?.medications ?? "");
  const [events, setEvents] = useState<string>(seeded?.ample?.events ?? "");

  const coreTempC = temp.trim() === "" || !Number.isFinite(Number(temp)) ? null : Number(temp);
  const ampleAllergies = allergies
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const draft: ExposureFindingSet = {
    state: headline,
    present,
    coreTempC,
    ample: {
      allergies: ampleAllergies,
      medications: meds || undefined,
      events: events || undefined,
    },
    context: ctx,
  };
  const state = classifyExposure(draft);
  const diagnosis = identifyExposureDiagnosis(draft);
  const triggered = triggeredActions(draft);
  const arrest = isExposureArrest(draft);
  const stage = tempStage(coreTempC);
  const guard = exposureCycleGuard(state, coreTempC);
  const tempMissing = temperatureMissing(draft);

  const recorded = useMemo(() => buildExposureActions(timeline), [timeline]);
  const recordedByCode = useMemo(() => new Map(recorded.map((a) => [a.actionCode, a])), [recorded]);

  function toggle(code: string) {
    setPresent((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  function recordFindings() {
    if (!active) return;
    startTransition(async () => {
      await recordExposureFindings({ episodeId, findingSet: draft });
      onChanged();
    });
  }

  function setActionState(code: string, s: ExposureActionState) {
    if (!active) return;
    startTransition(async () => {
      await setExposureActionState({ episodeId, actionId: code, actionCode: code, state: s });
      onChanged();
    });
  }

  function returnToA() {
    if (!active) return;
    startTransition(async () => {
      // Auto-record the current draft FIRST so nothing — especially AMPLE
      // allergies (which feed the prescribing allergy check) — is lost on cycle.
      await recordExposureFindings({ episodeId, findingSet: draft });
      await recordResusReturnToA({ episodeId });
      onChanged();
      onReturnToA();
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
        emergency: exposureAction(a.actionCode)?.emergency ?? false,
        priority: undefined,
        state: a.state,
      })),
  ]);
  const outstanding = outstandingActionCount(boardItems);
  const top = mostUrgentAction(boardItems);

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4">
      {/* Header + exposure-state indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="bg-foreground/90 text-background text-body-m flex size-8 items-center justify-center rounded-lg font-mono font-semibold">
            E
          </span>
          <h2 className="text-foreground text-heading-s tracking-[-0.01em]">Exposure</h2>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
            STATE_TONE[state ?? "unknown"],
          )}
        >
          {(state === "critical_finding" || state === "temperature_extreme") && (
            <span aria-hidden>▲</span>
          )}
          {STATE_SHORT[state ?? "unknown"]}
        </span>
      </div>

      {/* ⚠️ Measure-temperature — the pinned mandatory flag */}
      {tempMissing ? (
        <div className="rounded-lg border border-amber-400/70 bg-amber-50/60 px-3 py-2 dark:border-amber-500/40 dark:bg-amber-950/20">
          <p className="text-[12.5px] font-semibold text-amber-900 dark:text-amber-200">
            ⚠ Temperature not measured — check core temperature.
          </p>
          <p className="text-muted-foreground text-caption">
            Hypothermia/hyperthermia is missed otherwise; sepsis hides in an unexplained low temp
            (cold sepsis).
          </p>
        </div>
      ) : null}

      {/* Suspected diagnosis — the distinctive E reasoning */}
      {diagnosis && diagnosis !== "none" ? (
        <div className="rounded-lg border border-rose-400/50 bg-rose-50/40 px-3 py-2 dark:border-rose-500/30 dark:bg-rose-950/15">
          <p className="text-[12.5px] font-semibold text-rose-800 dark:text-rose-200">
            Suspected: {EXPOSURE_DIAGNOSIS_LABEL[diagnosis]}
          </p>
          <p className="text-muted-foreground text-caption">
            {EXPOSURE_DIAGNOSIS_STRATEGY[diagnosis]}
          </p>
        </div>
      ) : null}

      {/* Arrest route — no pulse (hypothermia modifier noted) */}
      {arrest ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-600 bg-rose-600 px-3 py-2 text-white">
          <p className="text-[12.5px] font-bold">
            ⚠ Unresponsive + no pulse — cardiac arrest
            {stage && stage.includes("hypothermia")
              ? " (cold → 'not dead until warm and dead')"
              : ""}
            .
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
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
        {/* ── Findings capture ── */}
        <section className="flex flex-col gap-2.5">
          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
            Exposure state
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {EXPOSURE_STATES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!active}
                onClick={() => setHeadline(headline === s ? null : s)}
                className={cn(
                  "tap rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition-colors disabled:opacity-50",
                  headline === s
                    ? "border-foreground/30 bg-foreground/90 text-background font-medium"
                    : "border-border bg-muted/30 text-foreground/80 hover:bg-muted/60",
                )}
              >
                {EXPOSURE_STATE_LABEL[s]}
              </button>
            ))}
          </div>

          {/* Temperature */}
          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
            Core temperature
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              disabled={!active}
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
              placeholder="°C"
              className="border-border bg-card text-foreground w-24 rounded-md border px-2 py-1 font-mono tabular-nums outline-none disabled:opacity-50"
            />
            {stage ? (
              <span className={cn("text-[11.5px] font-semibold", TEMP_TONE[stage])}>
                {TEMP_STAGE_LABEL[stage]}
              </span>
            ) : null}
          </div>

          {/* Context flags */}
          <div className="flex flex-wrap gap-1.5">
            <ContextToggle
              label="Trauma (log-roll)"
              on={!!ctx.trauma}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, trauma: !ctx.trauma })}
            />
            <ContextToggle
              label="Environmental exposure"
              on={!!ctx.exposureEnvironment}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, exposureEnvironment: !ctx.exposureEnvironment })}
            />
            <ContextToggle
              label="Serotonergic / neuroleptic"
              on={!!ctx.serotonergicOrNeuroleptic}
              disabled={!active}
              onClick={() =>
                setCtx({ ...ctx, serotonergicOrNeuroleptic: !ctx.serotonergicOrNeuroleptic })
              }
            />
            <ContextToggle
              label="Left exposed (re-cover!)"
              danger
              on={!!ctx.notRecovered}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, notRecovered: !ctx.notRecovered })}
            />
            <ContextToggle
              label="No pulse"
              danger
              on={!!ctx.noPulse}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, noPulse: !ctx.noPulse })}
            />
          </div>

          <FindingGroup
            title="Skin / rash"
            findings={EXPOSURE_SKIN}
            present={present}
            disabled={!active}
            onToggle={toggle}
          />
          <FindingGroup
            title="Bleeding / wounds / injury (log-roll the back)"
            findings={EXPOSURE_INJURY}
            present={present}
            disabled={!active}
            onToggle={toggle}
          />
          <FindingGroup
            title="Patches / lines"
            findings={EXPOSURE_PATCHES}
            present={present}
            disabled={!active}
            onToggle={toggle}
          />

          {/* AMPLE history */}
          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
            AMPLE history — allergies feed the prescribing check
          </h3>
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[10.5px]">Allergies (comma-separated)</span>
            <input
              value={allergies}
              disabled={!active}
              onChange={(e) => setAllergies(e.target.value)}
              placeholder="e.g. penicillin, peanut — or leave blank"
              className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[10.5px]">
              Medications (incl. patches / anticoagulants)
            </span>
            <input
              value={meds}
              disabled={!active}
              onChange={(e) => setMeds(e.target.value)}
              className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-[10.5px]">
              Events / environment (mechanism, timeline, toxins)
            </span>
            <input
              value={events}
              disabled={!active}
              onChange={(e) => setEvents(e.target.value)}
              className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none disabled:opacity-50"
            />
          </label>

          <button
            type="button"
            disabled={!active || pending}
            onClick={recordFindings}
            className="tap bg-mint-600 hover:bg-mint-700 mt-1 self-start rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors disabled:opacity-50"
          >
            {seeded ? "↻ Re-record exposure findings" : "Record exposure findings"}
          </button>
        </section>

        {/* ── Triggered actions (urgency order; drugs → prescribe tool) ── */}
        <section className="border-border bg-card/95 lg:ring-border/50 flex flex-col gap-2 rounded-lg border p-3 lg:sticky lg:top-30 lg:max-h-[calc(100svh-136px)] lg:overflow-y-auto lg:shadow-md lg:ring-1 lg:backdrop-blur">
          <ResusActionsHeading
            heading="Indicated actions — find → treat → cycle"
            outstanding={outstanding}
            topLabel={top ? (exposureAction(top.code)?.label ?? top.code) : null}
            topState={top ? (top.state ?? "indicated") : null}
          />
          {boardItems.length === 0 ? (
            <p className="text-muted-foreground/70 border-border/70 bg-muted/20 rounded-lg border border-dashed px-3 py-4 text-center text-[11.5px]">
              Arrest pathway — start CPR.
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
                    label: exposureAction(item.code)?.label ?? item.code,
                  })
                }
              />
            ))
          )}
        </section>
      </div>

      {/* The distinctive E element — close the loop: return to A and cycle */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5",
          guard.ok
            ? "border-mint-400/70 bg-mint-50/60 dark:border-mint-500/40 dark:bg-mint-950/25"
            : "border-amber-300/70 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-950/20",
        )}
      >
        <p
          className={cn(
            "text-[12px] font-medium",
            guard.ok ? "text-mint-800 dark:text-mint-200" : "text-amber-900 dark:text-amber-200",
          )}
        >
          {guard.ok ? "✓ " : "⚠ "}
          {guard.warning}
        </p>
        <button
          type="button"
          disabled={!active || pending}
          onClick={returnToA}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors disabled:opacity-50",
            guard.ok ? "bg-mint-600 hover:bg-mint-700" : "bg-amber-600 hover:bg-amber-700",
          )}
        >
          <RotateCcwIcon className="size-3.5" aria-hidden />
          {guard.ok ? "Return to A → reassess" : "Return to A anyway →"}
        </button>
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
  currentState?: ExposureActionState;
  disabled: boolean;
  onSetState: (code: string, s: ExposureActionState) => void;
  prescribable?: boolean;
  onPrescribe?: () => void;
}) {
  const action = exposureAction(code);
  const failed = currentState === "failed";
  const escalation = failed ? escalationFor(code) : null;
  const escAction = escalation ? exposureAction(escalation) : null;

  const effective: ExposureActionState = currentState ?? "indicated";
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
