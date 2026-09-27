"use client";

import type { PrescribeAuthority } from "./prescribe-dialog";
import type {
  Avpu,
  DisabilityActionState,
  DisabilityFindingSet,
  GcsComponents,
} from "@/lib/resus/disability";
import type { DisabilityState } from "@/lib/resus/reference/disability-catalog";
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
  buildDisabilityActions,
  classifyDisability,
  disabilityProceedGuard,
  escalationFor,
  gcsTotal,
  gcsTrend,
  identifyNeuroSyndrome,
  isDisabilityArrest,
  isGcsFalling,
  latestDisabilityAssessment,
  mandatoryGlucoseMissing,
  triggeredActions,
} from "@/lib/resus/disability";
import {
  DISABILITY_FOCAL_SEIZURE,
  DISABILITY_METABOLIC,
  DISABILITY_PUPILS,
  DISABILITY_STATE_LABEL,
  DISABILITY_STATES,
  disabilityAction,
  NEURO_SYNDROME_LABEL,
  NEURO_SYNDROME_STRATEGY,
} from "@/lib/resus/reference/disability-catalog";
import { cn } from "@/lib/utils";
import {
  detectResusArrestAction,
  recordDisabilityFindings,
  setDisabilityActionState,
} from "../../actions";
import { PrescribeDialog } from "./prescribe-dialog";
import { ResusActionsHeading } from "./resus-actions-heading";

const PRESCRIBABLE = new Set(Object.keys(RECOMMENDATION_DRUG_MAP));

const STATE_TONE: Record<string, string> = {
  alert: "border-mint-300/70 bg-mint-50/60 text-mint-700 dark:bg-mint-950/25 dark:text-mint-200",
  mild_moderate_impairment:
    "border-amber-300/70 bg-amber-50/60 text-amber-800 dark:bg-amber-950/25 dark:text-amber-200",
  severe_impairment_coma:
    "border-orange-400/70 bg-orange-50/60 text-orange-700 ring-1 ring-orange-400/40 dark:bg-orange-950/25 dark:text-orange-200",
  active_seizure_status:
    "border-rose-500/80 bg-rose-50/70 text-rose-700 ring-1 ring-rose-500/40 motion-safe:animate-pulse dark:bg-rose-950/30 dark:text-rose-200",
  raised_icp_herniation:
    "border-rose-600 bg-rose-600 text-white ring-1 ring-rose-500/50 motion-safe:animate-pulse",
  unknown: "border-border bg-muted/30 text-muted-foreground",
};

const STATE_SHORT: Record<string, string> = {
  alert: "Alert",
  mild_moderate_impairment: "Mild–moderate impairment",
  severe_impairment_coma: "Severe / coma (GCS ≤8)",
  active_seizure_status: "Active seizure / status",
  raised_icp_herniation: "Raised ICP / herniation",
  unknown: "Not yet assessed",
};

const ACTION_STATE_STYLE: Record<
  DisabilityActionState,
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

const SETTABLE_STATES: DisabilityActionState[] = [
  "in_progress",
  "performed",
  "failed",
  "deferred",
  "not_indicated",
];

const AVPU_OPTIONS: { v: Avpu; label: string }[] = [
  { v: "A", label: "A — alert" },
  { v: "V", label: "V — voice" },
  { v: "P", label: "P — pain" },
  { v: "U", label: "U — unresp." },
];

export function DisabilityPanel({
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

  const seeded = useMemo(() => latestDisabilityAssessment(timeline), [timeline]);
  const [headline, setHeadline] = useState<DisabilityState | null>(seeded?.state ?? null);
  const [present, setPresent] = useState<string[]>(seeded?.present ?? []);
  const [ctx, setCtx] = useState<DisabilityFindingSet["context"]>(seeded?.context ?? {});
  const [gcs, setGcs] = useState<GcsComponents | null>(seeded?.gcs ?? null);
  const [avpu, setAvpu] = useState<Avpu | null>(seeded?.avpu ?? null);
  const [glucose, setGlucose] = useState<string>(
    seeded?.glucoseMmol != null ? String(seeded.glucoseMmol) : "",
  );

  const glucoseMmol =
    glucose.trim() === "" || !Number.isFinite(Number(glucose)) ? null : Number(glucose);
  const draft: DisabilityFindingSet = {
    state: headline,
    gcs,
    avpu,
    glucoseMmol,
    present,
    context: ctx,
  };
  const state = classifyDisability(draft);
  const syndrome = identifyNeuroSyndrome(draft);
  const triggered = triggeredActions(draft);
  const arrest = isDisabilityArrest(draft);
  const total = gcsTotal(gcs);
  const guard = disabilityProceedGuard(state, total);
  const glucoseMissing = mandatoryGlucoseMissing(draft);

  const trend = useMemo(() => gcsTrend(timeline), [timeline]);
  const falling = useMemo(() => isGcsFalling(timeline), [timeline]);

  const recorded = useMemo(() => buildDisabilityActions(timeline), [timeline]);
  const recordedByCode = useMemo(() => new Map(recorded.map((a) => [a.actionCode, a])), [recorded]);

  function toggle(code: string) {
    setPresent((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  function setGcsPart(part: keyof GcsComponents, value: number | boolean) {
    setGcs((prev) => {
      const base: GcsComponents = prev ?? { eye: 4, verbal: 5, motor: 6 };
      return { ...base, [part]: value };
    });
  }

  function recordFindings() {
    if (!active) return;
    startTransition(async () => {
      await recordDisabilityFindings({ episodeId, findingSet: draft });
      onChanged();
    });
  }

  function setActionState(code: string, s: DisabilityActionState) {
    if (!active) return;
    startTransition(async () => {
      await setDisabilityActionState({ episodeId, actionId: code, actionCode: code, state: s });
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
        emergency: disabilityAction(a.actionCode)?.emergency ?? false,
        priority: undefined,
        state: a.state,
      })),
  ]);
  const outstanding = outstandingActionCount(boardItems);
  const top = mostUrgentAction(boardItems);

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4">
      {/* Header + neuro-state indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="bg-foreground/90 text-background text-body-m flex size-8 items-center justify-center rounded-lg font-mono font-semibold">
            D
          </span>
          <h2 className="text-foreground text-heading-s tracking-[-0.01em]">Disability</h2>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
            STATE_TONE[state ?? "unknown"],
          )}
        >
          {(state === "severe_impairment_coma" ||
            state === "active_seizure_status" ||
            state === "raised_icp_herniation") && <span aria-hidden>▲</span>}
          {STATE_SHORT[state ?? "unknown"]}
        </span>
      </div>

      {/* ⚠️ DON'T EVER FORGET GLUCOSE — the pinned mandatory flag */}
      {glucoseMissing ? (
        <div className="rounded-lg border border-rose-500/70 bg-rose-50/70 px-3 py-2 dark:border-rose-500/40 dark:bg-rose-950/25">
          <p className="text-[12.5px] font-bold text-rose-800 dark:text-rose-200">
            ⚠ Glucose NOT checked — check capillary glucose NOW.
          </p>
          <p className="text-muted-foreground text-caption">
            Hypoglycaemia mimics stroke / sepsis / coma and is instantly reversible — the single
            most important D action.
          </p>
        </div>
      ) : null}

      {/* Suspected neuro-syndrome — the distinctive D element (cause drives strategy) */}
      {syndrome ? (
        <div className="rounded-lg border border-rose-400/50 bg-rose-50/40 px-3 py-2 dark:border-rose-500/30 dark:bg-rose-950/15">
          <p className="text-[12.5px] font-semibold text-rose-800 dark:text-rose-200">
            Suspected: {NEURO_SYNDROME_LABEL[syndrome]}
          </p>
          <p className="text-muted-foreground text-caption">{NEURO_SYNDROME_STRATEGY[syndrome]}</p>
        </div>
      ) : null}

      {/* GCS + serial trend (the D-distinctive monitoring) */}
      <div className="border-border bg-muted/20 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-muted-foreground/70 font-mono text-[10px] tracking-[0.14em] uppercase">
            GCS
          </span>
          <span className="text-foreground font-mono text-[20px] font-semibold tabular-nums">
            {total ?? "—"}
          </span>
          {gcs ? (
            <span className="text-muted-foreground text-caption font-mono tabular-nums">
              E{gcs.eye} V{gcs.intubated ? "T" : gcs.verbal} M{gcs.motor}
            </span>
          ) : null}
        </div>
        {trend.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-caption font-mono tabular-nums",
                falling ? "font-bold text-rose-700 dark:text-rose-300" : "text-muted-foreground",
              )}
            >
              {trend.map((t) => t.total).join(" → ")}
              {falling ? " ↓" : ""}
            </span>
            {falling ? (
              <span className="text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                falling → back to A
              </span>
            ) : null}
          </div>
        ) : null}
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
        {guard.ok ? "✓ Disability addressed — safe to proceed to E." : `⚠ ${guard.warning}`}
      </div>

      {/* Arrest route — no pulse */}
      {arrest ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-600 bg-rose-600 px-3 py-2 text-white">
          <p className="text-[12.5px] font-bold">⚠ Unresponsive + no pulse — cardiac arrest.</p>
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
            Findings — neuro-state
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {DISABILITY_STATES.map((s) => (
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
                {DISABILITY_STATE_LABEL[s]}
              </button>
            ))}
          </div>

          {/* AVPU */}
          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
            AVPU (rapid)
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {AVPU_OPTIONS.map((o) => (
              <button
                key={o.v}
                type="button"
                disabled={!active}
                onClick={() => setAvpu(avpu === o.v ? null : o.v)}
                className={cn(
                  "text-caption rounded-lg border px-2.5 py-1 transition-colors disabled:opacity-50",
                  avpu === o.v
                    ? "border-foreground/30 bg-foreground/85 text-background font-medium"
                    : "border-border bg-muted/30 text-foreground/70 hover:bg-muted/60",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* GCS components */}
          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
            GCS components
          </h3>
          <div className="flex flex-col gap-1.5">
            <GcsPicker
              label="Eye /4"
              max={4}
              value={gcs?.eye ?? null}
              disabled={!active}
              onPick={(n) => setGcsPart("eye", n)}
            />
            <GcsPicker
              label="Verbal /5"
              max={5}
              value={gcs?.intubated ? null : (gcs?.verbal ?? null)}
              disabled={!active || !!gcs?.intubated}
              onPick={(n) => setGcsPart("verbal", n)}
            />
            <GcsPicker
              label="Motor /6"
              max={6}
              value={gcs?.motor ?? null}
              disabled={!active}
              onPick={(n) => setGcsPart("motor", n)}
            />
            <label className="text-caption flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!active}
                checked={!!gcs?.intubated}
                onChange={(e) => setGcsPart("intubated", e.target.checked)}
              />
              <span className="text-muted-foreground">Intubated (verbal not testable — “T”)</span>
            </label>
          </div>

          {/* Glucose */}
          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
            Glucose — Don&apos;t Ever Forget Glucose
          </h3>
          <label className="flex items-center gap-2 text-[12px]">
            <span className="text-muted-foreground">Capillary glucose (mmol/L)</span>
            <input
              type="number"
              inputMode="decimal"
              disabled={!active}
              value={glucose}
              onChange={(e) => setGlucose(e.target.value)}
              placeholder="—"
              className="border-border bg-card text-foreground w-24 rounded-md border px-2 py-1 font-mono tabular-nums outline-none disabled:opacity-50"
            />
          </label>

          {/* Context flags */}
          <div className="flex flex-wrap gap-1.5">
            <ContextToggle
              label="Opioids suspected"
              on={!!ctx.opioidsSuspected}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, opioidsSuspected: !ctx.opioidsSuspected })}
            />
            <ContextToggle
              label="Low resp rate"
              on={!!ctx.lowRespRate}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, lowRespRate: !ctx.lowRespRate })}
            />
            <ContextToggle
              label="Pregnant / postpartum"
              on={!!ctx.pregnancyPostpartum}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, pregnancyPostpartum: !ctx.pregnancyPostpartum })}
            />
            <ContextToggle
              label="Head injury / TBI"
              on={!!ctx.headInjury}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, headInjury: !ctx.headInjury })}
            />
            <ContextToggle
              label="Alcohol / malnourished"
              on={!!ctx.alcoholMalnourished}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, alcoholMalnourished: !ctx.alcoholMalnourished })}
            />
            <ContextToggle
              label="Fever + meningism"
              on={!!ctx.feverMeningism}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, feverMeningism: !ctx.feverMeningism })}
            />
            <ContextToggle
              label="A/B/C abnormal"
              on={!!ctx.abcAbnormal}
              disabled={!active}
              onClick={() => setCtx({ ...ctx, abcAbnormal: !ctx.abcAbnormal })}
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
            title="Pupils"
            findings={DISABILITY_PUPILS}
            present={present}
            disabled={!active}
            onToggle={toggle}
          />
          <FindingGroup
            title="Focal / seizure / posture"
            findings={DISABILITY_FOCAL_SEIZURE}
            present={present}
            disabled={!active}
            onToggle={toggle}
          />
          <FindingGroup
            title="Glucose / raised-ICP signs"
            findings={DISABILITY_METABOLIC}
            present={present}
            disabled={!active}
            onToggle={toggle}
          />

          <button
            type="button"
            disabled={!active || pending}
            onClick={recordFindings}
            className="tap bg-mint-600 hover:bg-mint-700 mt-1 self-start rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors disabled:opacity-50"
          >
            {trend.length > 0
              ? "↻ Re-record disability findings (serial GCS)"
              : "Record disability findings"}
          </button>
        </section>

        {/* ── Triggered actions (urgency order; check-glucose pinned; drugs → tool) ── */}
        <section className="border-border bg-card/95 lg:ring-border/50 flex flex-col gap-2 rounded-lg border p-3 lg:sticky lg:top-30 lg:max-h-[calc(100svh-136px)] lg:overflow-y-auto lg:shadow-md lg:ring-1 lg:backdrop-blur">
          <ResusActionsHeading
            heading="Indicated actions — finding → cause → do"
            outstanding={outstanding}
            topLabel={top ? (disabilityAction(top.code)?.label ?? top.code) : null}
            topState={top ? (top.state ?? "indicated") : null}
          />
          {boardItems.length === 0 ? (
            <p className="text-muted-foreground/70 border-border/70 bg-muted/20 rounded-lg border border-dashed px-3 py-4 text-center text-[11.5px]">
              {arrest
                ? "Arrest pathway — start CPR."
                : "Record findings to see the matched actions appear here (glucose always)."}
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
                    label: disabilityAction(item.code)?.label ?? item.code,
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

function GcsPicker({
  label,
  max,
  value,
  disabled,
  onPick,
}: {
  label: string;
  max: number;
  value: number | null;
  disabled: boolean;
  onPick: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-20 shrink-0 text-[10.5px]">{label}</span>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onPick(n)}
            className={cn(
              "text-caption size-6 rounded-md border font-mono tabular-nums transition-colors disabled:opacity-40",
              value === n
                ? "border-foreground/30 bg-foreground/85 text-background font-semibold"
                : "border-border bg-muted/30 text-foreground/70 hover:bg-muted/60",
            )}
          >
            {n}
          </button>
        ))}
      </div>
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
  currentState?: DisabilityActionState;
  disabled: boolean;
  onSetState: (code: string, s: DisabilityActionState) => void;
  prescribable?: boolean;
  onPrescribe?: () => void;
}) {
  const action = disabilityAction(code);
  const failed = currentState === "failed";
  const escalation = failed ? escalationFor(code) : null;
  const escAction = escalation ? disabilityAction(escalation) : null;

  const effective: DisabilityActionState = currentState ?? "indicated";
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
