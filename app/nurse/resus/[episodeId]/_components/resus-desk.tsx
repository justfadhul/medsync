"use client";

import type { PrescribeAuthority } from "./prescribe-dialog";
import type { VitalCellSkin } from "./v2/vitals-cells";
import type { ResusPatientView } from "@/lib/resus/board";
import type { StepStatus } from "@/lib/resus/engine";
import type { ResponderEntry, RosterEntry } from "@/lib/resus/record";
import type { LinkedAction } from "@/lib/resus/reference/abcde-catalog";
import type { ResusDoseId } from "@/lib/resus/reference/doses";
import type { AbcdeLetter, ResusEventKind, ResusRole, TimelineEvent } from "@/lib/resus/types";
import type { ClinicalDirection, VitalTrend } from "@/lib/resus/vital-trend";
import type { ResusVitalsView, VitalSnapshot } from "@/lib/resus/vitals";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeftIcon, RotateCcwIcon } from "lucide-react";

import { classifyAirway, latestAirwayAssessment } from "@/lib/resus/airway";
import {
  triggeredActions as breathingTriggeredActions,
  classifyBreathing,
  latestBreathingAssessment,
} from "@/lib/resus/breathing";
import {
  triggeredActions as circulationTriggeredActions,
  classifyCirculation,
  latestCirculationAssessment,
} from "@/lib/resus/circulation";
import {
  classifyDisability,
  triggeredActions as disabilityTriggeredActions,
  gcsTotal,
  isGcsFalling,
  latestDisabilityAssessment,
} from "@/lib/resus/disability";
import {
  deriveProgress,
  openLifeThreats,
  reassessPromptFor,
  recommendedNextStep,
  stepStatus,
} from "@/lib/resus/engine";
import {
  classifyExposure,
  triggeredActions as exposureTriggeredActions,
  latestExposureAssessment,
} from "@/lib/resus/exposure";
import {
  ABCDE_CATALOG,
  ANAPHYLAXIS_PROTOCOL,
  ARREST_SEAM,
} from "@/lib/resus/reference/abcde-catalog";
import { getResusDose } from "@/lib/resus/reference/doses";
import { ABCDE_LETTERS, RESUS_ROLES } from "@/lib/resus/types";
import { vitalBand, vitalTrend } from "@/lib/resus/vital-trend";
import { buildResusVitals, TREND_VITALS } from "@/lib/resus/vitals";
import { cn } from "@/lib/utils";
import {
  acknowledgeResusAlertAction,
  claimResusRoleAction,
  detectResusArrestAction,
  logResusEvent,
  logResusVitals,
} from "../../actions";
import { AirwayPanel } from "./airway-panel";
import { BreathingPanel } from "./breathing-panel";
import { CirculationPanel } from "./circulation-panel";
import { DisabilityPanel } from "./disability-panel";
import { ExposurePanel } from "./exposure-panel";
import { PrescribeDialog } from "./prescribe-dialog";
import { VitalCell } from "./v2/vitals-cells";

interface DeskEpisode {
  id: string;
  state: string;
  triggerKind: string;
  triggerReason: string | null;
  startedAtIso: string;
  arrestDetected: boolean;
  disposition: string | null;
}

interface DeskScope {
  userId: string;
  fullName: string | null;
  cadreCode: string;
  cadreName: string;
  hospitalName: string;
  departmentName: string;
  leaderRecommended: boolean;
  /** This cadre's prescribing authority (cosign policy) — surfaced in the
   *  prescribe dialog. In an emergency it never hard-blocks; it flags
   *  "administering under resus protocol" for a non-prescriber. */
  prescribeAuthority: PrescribeAuthority;
}

/**
 * The glanceable step-bar visual state (visual rework — DESIGN-medsync
 * "Resus state colour system"). Derived from the engine status (no engine
 * change); `open` splits into amber `threatened` vs red `active_threat`
 * only when a life-threat-now is present (alarm scarcity — red is precious).
 * State is conveyed by border + fill + ring + coloured letter chip + word
 * (never a left-edge accent; never colour alone).
 */
type StepVisual = "pending" | "clear" | "addressed" | "threatened" | "active_threat";

const STEP_TONE: Record<StepVisual, string> = {
  pending: "border-border bg-muted/30 text-muted-foreground",
  clear: "border-mint-300/70 bg-mint-50/60 text-mint-700 dark:bg-mint-950/25 dark:text-mint-200",
  addressed:
    "border-mint-600/60 bg-mint-600/10 text-mint-800 dark:bg-mint-900/30 dark:text-mint-200",
  threatened:
    "border-amber-300/80 bg-amber-50/70 text-amber-800 dark:bg-amber-950/25 dark:text-amber-200",
  active_threat: "border-rose-600 bg-rose-600 text-white ring-1 ring-rose-500/50",
};

const STEP_CHIP: Record<StepVisual, string> = {
  pending: "bg-muted text-muted-foreground",
  clear: "bg-mint-100 text-mint-700 dark:bg-mint-900/60 dark:text-mint-200",
  addressed: "bg-mint-700 text-white",
  threatened: "bg-amber-400 text-amber-950 dark:bg-amber-500/80 dark:text-amber-950",
  active_threat: "bg-white text-rose-700",
};

const STEP_WORD: Record<StepVisual, string> = {
  pending: "Pending",
  clear: "Clear",
  addressed: "Addressed",
  threatened: "Threatened",
  active_threat: "Active threat",
};

/** Engine status → visual state. `open` is amber `threatened` unless a
 * life-threat-now is present (then red `active_threat`). No engine change. */
function stepVisual(status: StepStatus, activeThreat: boolean): StepVisual {
  if (status === "open") return activeThreat ? "active_threat" : "threatened";
  if (status === "clear") return "clear";
  if (status === "addressed") return "addressed";
  return "pending";
}

function useElapsed(startIso: string): string {
  // Initialise from the prop (pure); the interval drives the live tick.
  // Date.now() is only ever called inside the interval callback — never
  // during render — so the component stays pure.
  const [now, setNow] = useState(() => new Date(startIso).getTime());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function clockOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
    d.getSeconds(),
  ).padStart(2, "0")}`;
}

export function ResusDesk({
  episode,
  patient,
  timeline,
  roster,
  responders,
  scope,
  basePath = "/nurse/resus",
}: {
  episode: DeskEpisode;
  patient: ResusPatientView;
  timeline: TimelineEvent[];
  roster: RosterEntry[];
  responders: ResponderEntry[];
  scope: DeskScope;
  /** Workspace base for the "Board" back-link (/nurse/resus or /doctor/resus). */
  basePath?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeStep, setActiveStep] = useState<AbcdeLetter>("A");
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const elapsed = useElapsed(episode.startedAtIso);
  const active = episode.state === "active";

  const progress = useMemo(
    () => deriveProgress(timeline.map((e) => ({ kind: e.kind, step: e.step, payload: e.payload }))),
    [timeline],
  );
  const open = openLifeThreats(progress);
  const nextStep = recommendedNextStep(progress);
  const vitals = useMemo(() => buildResusVitals(timeline), [timeline]);

  // Airway letter (A) escalates to red `active_threat` only on a genuine
  // life-threat-now (airway complete/apnoea, or arrest) — alarm scarcity.
  const aActiveThreat = useMemo(() => {
    if (episode.arrestDetected) return true;
    const last = latestAirwayAssessment(timeline);
    const s = last ? classifyAirway(last) : null;
    return s === "completely_obstructed" || s === "apnoeic_ventilate" || s === "apnoeic_arrest";
  }, [timeline, episode.arrestDetected]);

  // Breathing letter (B) escalates to red `active_threat` on a genuine
  // life-threat-now: peri-arrest / apnoea, or a p0 emergency action (tension
  // decompression, massive haemothorax, life-threatening asthma, anaphylaxis).
  const bActiveThreat = useMemo(() => {
    if (episode.arrestDetected) return true;
    const last = latestBreathingAssessment(timeline);
    if (!last) return false;
    const s = classifyBreathing(last);
    if (s === "peri_arrest" || s === "apnoeic") return true;
    return breathingTriggeredActions(last).some((t) => t.priority === 0 && t.emergency);
  }, [timeline, episode.arrestDetected]);

  // Circulation letter (C) escalates to red `active_threat` on a genuine
  // life-threat-now: peri-arrest/arrest/decompensated, or a p0 emergency action
  // (haemorrhage control, decompression, pericardiocentesis, blood/MHP).
  const cActiveThreat = useMemo(() => {
    if (episode.arrestDetected) return true;
    const last = latestCirculationAssessment(timeline);
    if (!last) return false;
    const s = classifyCirculation(last);
    if (s === "peri_arrest" || s === "arrest" || s === "decompensated_shock") return true;
    return circulationTriggeredActions(last).some((t) => t.priority === 0 && t.emergency);
  }, [timeline, episode.arrestDetected]);

  // life-threat-now for D: raised-ICP/herniation, active seizure/status, GCS≤8
  // (airway at risk), a falling GCS trend, or a p0 emergency action.
  const dActiveThreat = useMemo(() => {
    if (episode.arrestDetected) return true;
    const last = latestDisabilityAssessment(timeline);
    if (!last) return false;
    const s = classifyDisability(last);
    const total = gcsTotal(last.gcs);
    if (
      s === "raised_icp_herniation" ||
      s === "active_seizure_status" ||
      s === "severe_impairment_coma" ||
      (total != null && total <= 8)
    )
      return true;
    if (isGcsFalling(timeline)) return true;
    // Exclude the always-pinned check-glucose prompt — a missing glucose alone
    // is not a life-threat-now (alarm scarcity; the mandatory-glucose flag lives
    // in the panel, not the step-bar red).
    return disabilityTriggeredActions(last).some(
      (t) => t.priority <= 0 && t.emergency && t.code !== "d_check_glucose",
    );
  }, [timeline, episode.arrestDetected]);

  // life-threat-now for E: a critical finding (rash/haemorrhage/anaphylaxis/
  // limb-threat), a temperature extreme, or a p0 emergency action.
  const eActiveThreat = useMemo(() => {
    if (episode.arrestDetected) return true;
    const last = latestExposureAssessment(timeline);
    if (!last) return false;
    const s = classifyExposure(last);
    if (s === "critical_finding" || s === "temperature_extreme") return true;
    // Exclude the always-pinned measure-temperature prompt (alarm scarcity).
    return exposureTriggeredActions(last).some(
      (t) => t.priority <= 0 && t.emergency && t.code !== "e_measure_temp",
    );
  }, [timeline, episode.arrestDetected]);

  // Post-intervention reassessment nudge: an action-class event newer than
  // the last vital snapshot means vitals are due (reassess-after-intervention).
  const vitalsDue = useMemo(() => {
    const lastVital = vitals.lastAt;
    const lastAction = timeline
      .filter((e) => ["drug", "fluid", "procedure", "action"].includes(e.kind))
      .reduce<
        string | null
      >((acc, e) => (acc === null || e.recordedAt > acc ? e.recordedAt : acc), null);
    if (!lastAction) return false;
    return lastVital === null || lastAction > lastVital;
  }, [timeline, vitals.lastAt]);

  function log(
    kind: ResusEventKind,
    step: AbcdeLetter | "pre" | null,
    payload: Record<string, unknown>,
  ) {
    if (!active) return;
    setPendingLabel(String(payload.label ?? payload.item ?? kind));
    startTransition(async () => {
      // The legacy desk only logs v1 kinds; v2 kinds have their own actions.
      const v1Kind = kind as Parameters<typeof logResusEvent>[0]["kind"];
      await logResusEvent({ episodeId: episode.id, kind: v1Kind, step, payload });
      setPendingLabel(null);
      router.refresh();
    });
  }

  const patientName = patient.displayName ?? "Unidentified patient";

  return (
    <div className="bg-background flex min-h-svh flex-col">
      {/* ── Sticky command header ─────────────────────────────────── */}
      <header className="border-border glass sticky top-0 z-30 border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2.5 px-4 py-2.5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href={basePath}
                className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-[12px] transition-colors"
              >
                <ArrowLeftIcon className="size-3.5" aria-hidden /> Board
              </Link>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-flex shrink-0 items-center rounded-full bg-rose-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white"
                  >
                    RESUS
                  </span>
                  <h1 className="text-foreground text-body-m truncate font-semibold">
                    {patientName}
                  </h1>
                  {patient.ageYears != null ? (
                    <span className="text-muted-foreground/70 text-caption font-mono">
                      {patient.ageYears}y {patient.sex ?? ""}
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground truncate font-mono text-[10.5px]">
                  {episode.triggerReason ?? episode.triggerKind.replace(/_/g, " ")} ·{" "}
                  {scope.hospitalName} · {scope.departmentName}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="text-right">
                <p className="text-foreground text-heading-s flex items-center justify-end gap-1.5 font-mono leading-none font-semibold tabular-nums">
                  {active ? (
                    <span aria-hidden className="pulse-dot size-1.5 rounded-full bg-rose-500" />
                  ) : null}
                  {elapsed}
                </p>
                <p className="text-muted-foreground/70 font-mono text-[9px] tracking-[0.14em] uppercase">
                  elapsed
                </p>
              </div>
              {!active ? (
                <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.1em] uppercase">
                  {episode.state}
                  {episode.disposition ? ` · ${episode.disposition}` : ""}
                </span>
              ) : null}
            </div>
          </div>

          {/* Open-life-threats tracker + return to A */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground/70 hidden font-mono text-[9px] tracking-[0.14em] uppercase sm:inline">
              ABCDE
            </span>
            <div className="flex flex-1 items-center gap-1.5">
              {ABCDE_LETTERS.map((letter) => {
                const p = progress.find((x) => x.step === letter)!;
                const activeThreat =
                  letter === "A"
                    ? aActiveThreat
                    : letter === "B"
                      ? bActiveThreat
                      : letter === "C"
                        ? cActiveThreat
                        : letter === "D"
                          ? dActiveThreat
                          : letter === "E"
                            ? eActiveThreat
                            : false;
                const vis = stepVisual(stepStatus(p), activeThreat);
                const focused = activeStep === letter;
                return (
                  <button
                    key={letter}
                    type="button"
                    onClick={() => setActiveStep(letter)}
                    aria-current={focused ? "step" : undefined}
                    className={cn(
                      "tap flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12px] font-semibold transition-colors duration-300",
                      STEP_TONE[vis],
                      focused ? "ring-mint-500/70 ring-2 ring-offset-1" : "",
                      nextStep === letter && active && !focused
                        ? "outline-mint-400/60 outline-1 outline-offset-1 outline-dashed"
                        : "",
                    )}
                    aria-label={`${letter} — ${STEP_WORD[vis]}${focused ? " (current step)" : ""}`}
                    title={`${ABCDE_CATALOG[letter].title} — ${STEP_WORD[vis]}`}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "text-caption flex size-4.5 items-center justify-center rounded font-mono font-semibold",
                        STEP_CHIP[vis],
                      )}
                    >
                      {letter}
                    </span>
                    <span className="hidden font-normal md:inline">{STEP_WORD[vis]}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveStep("A");
                if (active)
                  log("decision", "pre", { label: "Returned to A (reassess from the top)" });
              }}
              className="tap inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-300/70 bg-rose-50/60 px-2.5 py-1.5 text-[12px] font-semibold text-rose-700 transition-colors hover:bg-rose-100/70 disabled:opacity-50 dark:bg-rose-950/25 dark:text-rose-200"
              disabled={!active}
            >
              <RotateCcwIcon className="size-3.5" aria-hidden /> Return to A
            </button>
            {active && !episode.arrestDetected ? (
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await detectResusArrestAction({
                      episodeId: episode.id,
                      responsive: false,
                      breathingNormally: false,
                      centralPulse: false,
                    });
                    router.refresh();
                  })
                }
                disabled={pending}
                className="tap inline-flex shrink-0 items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                title="Declare cardiac arrest — unresponsive + not breathing normally / no pulse"
              >
                ⚠ Arrest
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {episode.arrestDetected ? (
        <div className="border-b border-rose-500/70 bg-rose-600 px-4 py-2.5 text-white sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-0.5">
            <p className="text-[13.5px] font-bold">⚠ CARDIAC ARREST — {ARREST_SEAM.cprPrompt}</p>
            <p className="font-mono text-[10.5px] text-white/85">
              Routed to: {ARREST_SEAM.routeLabel}. {ARREST_SEAM.deferred}
            </p>
          </div>
        </div>
      ) : null}

      {/* ── Continuous monitoring band (GATE D) ─────────────────────── */}
      <VitalsBand
        vitals={vitals}
        due={vitalsDue && active}
        disabled={!active || pending}
        onSave={(snap) => {
          if (!active) return;
          setPendingLabel("Vitals");
          startTransition(async () => {
            await logResusVitals({ episodeId: episode.id, snapshot: snap });
            setPendingLabel(null);
            router.refresh();
          });
        }}
      />

      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── CENTRE: ABCDE step + anaphylaxis cross-cut ──────────── */}
        <div className="flex flex-col gap-4">
          {open.length > 0 ? (
            <div className="rounded-xl border border-rose-500/70 bg-rose-50/70 px-4 py-2.5 ring-1 ring-rose-500/30 dark:bg-rose-950/30">
              <p className="text-[12.5px] font-semibold text-rose-800 dark:text-rose-200">
                ▲ Open life-threat{open.length > 1 ? "s" : ""}: {open.join(", ")} — treat before
                proceeding.
              </p>
            </div>
          ) : null}

          <AnaphylaxisBar
            disabled={!active || pending}
            episodeId={episode.id}
            timeline={timeline}
            patientAgeYears={patient.ageYears ?? null}
            prescribeAuthority={scope.prescribeAuthority}
            onChanged={() => router.refresh()}
          />

          {activeStep === "A" ? (
            <AirwayPanel
              episodeId={episode.id}
              timeline={timeline}
              active={active}
              patientAgeYears={patient.ageYears ?? null}
              prescribeAuthority={scope.prescribeAuthority}
              onChanged={() => router.refresh()}
            />
          ) : activeStep === "B" ? (
            <BreathingPanel
              episodeId={episode.id}
              timeline={timeline}
              active={active}
              patientAgeYears={patient.ageYears ?? null}
              prescribeAuthority={scope.prescribeAuthority}
              onChanged={() => router.refresh()}
            />
          ) : activeStep === "C" ? (
            <CirculationPanel
              episodeId={episode.id}
              timeline={timeline}
              active={active}
              patientAgeYears={patient.ageYears ?? null}
              prescribeAuthority={scope.prescribeAuthority}
              onChanged={() => router.refresh()}
            />
          ) : activeStep === "D" ? (
            <DisabilityPanel
              episodeId={episode.id}
              timeline={timeline}
              active={active}
              patientAgeYears={patient.ageYears ?? null}
              prescribeAuthority={scope.prescribeAuthority}
              onChanged={() => router.refresh()}
            />
          ) : activeStep === "E" ? (
            <ExposurePanel
              episodeId={episode.id}
              timeline={timeline}
              active={active}
              patientAgeYears={patient.ageYears ?? null}
              prescribeAuthority={scope.prescribeAuthority}
              onChanged={() => router.refresh()}
              onReturnToA={() => setActiveStep("A")}
            />
          ) : (
            <StepPanel
              key={activeStep}
              step={activeStep}
              disabled={!active || pending}
              onLog={log}
            />
          )}
        </div>

        {/* ── RIGHT: team + the live immutable record ─────────────── */}
        <aside className="flex flex-col gap-3 lg:sticky lg:top-[112px] lg:max-h-[calc(100svh-128px)]">
          <TeamPanel
            episodeId={episode.id}
            roster={roster}
            responders={responders}
            scope={scope}
            disabled={!active || pending}
            onChange={() => router.refresh()}
          />
          <div className="flex items-baseline justify-between">
            <h2 className="text-foreground/80 text-[12px] font-medium">
              Resus record{" "}
              <span className="text-muted-foreground/70 font-mono text-[10px]">
                {timeline.length} entr{timeline.length === 1 ? "y" : "ies"} · append-only
              </span>
            </h2>
            {pending ? (
              <span className="text-muted-foreground/70 inline-flex items-center gap-1 font-mono text-[10px]">
                <span aria-hidden className="pulse-dot bg-mint-500 size-1 rounded-full" />
                saving…
              </span>
            ) : null}
          </div>
          <Timeline timeline={timeline} pendingLabel={pendingLabel} />
        </aside>
      </div>
    </div>
  );
}

/* ─── Continuous monitoring band ──────────────────────────────────── */
type VitalTone = "normal" | "borderline" | "abnormal" | "critical" | "missing";

const VITAL_TONE_CLASS: Record<VitalTone, string> = {
  normal: "border-border bg-card text-foreground",
  borderline:
    "border-amber-300/70 bg-amber-50/50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200",
  abnormal:
    "border-orange-400/70 bg-orange-50/60 text-orange-700 dark:bg-orange-950/25 dark:text-orange-200",
  critical:
    "border-rose-500/80 bg-rose-50/70 text-rose-700 ring-1 ring-rose-500/30 dark:bg-rose-950/30 dark:text-rose-200",
  missing: "border-dashed border-border/70 bg-muted/20 text-muted-foreground/50",
};

/** Display tone — the single shared classifier (lib/resus/vital-trend), the
 *  resus board's existing cutoffs relocated; cell tone + trend + graph agree. */
function vitalTone(key: string, v: number | null | undefined): VitalTone {
  return vitalBand(key, v);
}

/** The trend arrow/delta colour — by CLINICAL meaning for this vital (not raw
 *  direction). Never colour alone (always paired with the glyph + value). */
const TREND_DIR_CLASS: Record<ClinicalDirection, string> = {
  improving: "text-mint-700 dark:text-mint-300",
  deteriorating: "text-rose-700 dark:text-rose-300",
  neutral: "text-muted-foreground",
};

/** Trend-coloured CELL tones — deteriorating (rose) / improving (teal). */
const TREND_CELL_CLASS: Record<"deteriorating" | "improving", string> = {
  deteriorating:
    "border-rose-400/70 bg-rose-50/60 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/25 dark:text-rose-200",
  improving:
    "border-mint-300/70 bg-mint-50/60 text-mint-700 dark:border-mint-500/40 dark:bg-mint-950/25 dark:text-mint-200",
};

/**
 * The vitals CELL colour — coloured by the TREND (deteriorating → rose,
 * improving → teal), falling back to the band tone when the trend is neutral /
 * absent (so a stable value still shows its severity). A CRITICAL value is
 * sticky-red regardless of trend — a critical reading must always look critical
 * (an improving-but-still-critical SpO₂ must not look reassuringly green).
 */
function cellTrendClass(tone: VitalTone, trend: VitalTrend | null): string {
  if (tone === "critical") return VITAL_TONE_CLASS.critical;
  const dir = trend?.clinicalDirection;
  if (dir === "deteriorating") return TREND_CELL_CLASS.deteriorating;
  if (dir === "improving") return TREND_CELL_CLASS.improving;
  return VITAL_TONE_CLASS[tone];
}

/** The v1 skin for the shared vitals cell (v2/vitals-cells.tsx) — the v1 class
 *  strings, unchanged, so this band renders exactly as before the move. */
const LEGACY_VITAL_SKIN: VitalCellSkin = {
  cellBase: "flex flex-col rounded-lg border px-2 py-1",
  cellTone: cellTrendClass,
  label: "font-mono text-[9px] tracking-[0.1em] uppercase opacity-70",
  value: () => "text-body-m font-mono leading-none font-semibold tabular-nums",
  prev: "text-muted-foreground/60 font-mono text-[9px] tabular-nums",
  arrowDir: TREND_DIR_CLASS,
  popover:
    "border-border bg-popover scale-in z-50 w-56 origin-top-left rounded-lg border p-2 shadow-lg",
  graphNote: "text-muted-foreground/70 px-1 py-2 text-center text-[10.5px]",
  graphMeta: "text-muted-foreground/70 font-mono text-[9px]",
  graphFooter:
    "text-muted-foreground/80 flex items-center justify-between font-mono text-[9px] tabular-nums",
  dangerLine: "stroke-rose-500/40",
};

/** Series-backed derived metrics with a self-contained (SBP-independent) band
 *  that get the prev→current + trend-graph cell. Shock index shows 2 dp.
 *  (Pulse pressure + qSOFA are flag-toned chips — see below.) */
const DERIVED_TREND_TILES = [
  { key: "shockIndex", label: "Shock idx", unit: "", decimals: 2 },
  { key: "meanArterialPressure", label: "MAP", unit: "mmHg" },
] as const;

const CAPTURE_FIELDS = [
  { key: "hr", label: "HR", step: "1" },
  { key: "rr", label: "RR", step: "1" },
  { key: "spo2", label: "SpO₂", step: "1" },
  { key: "systolicBp", label: "SBP", step: "1" },
  { key: "diastolicBp", label: "DBP", step: "1" },
  { key: "temperature", label: "Temp", step: "0.1" },
  { key: "glucose", label: "Gluc", step: "0.1" },
  { key: "gcs", label: "GCS", step: "1" },
  { key: "etco2", label: "EtCO₂", step: "0.1" },
  { key: "urineOutput", label: "Urine", step: "1" },
] as const;

function VitalsBand({
  vitals,
  due,
  disabled,
  onSave,
}: {
  vitals: ResusVitalsView;
  due: boolean;
  disabled: boolean;
  onSave: (snap: VitalSnapshot) => void;
}) {
  const [capture, setCapture] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const tiles = TREND_VITALS;
  const d = vitals.derived;
  // Flag-toned chips (no continuous trend): pulse pressure (its "narrow" flag is
  // SBP-relative, not a fixed band) + qSOFA (a categorical 0–3 score).
  const flagChips: { label: string; value: string; tone: VitalTone }[] = [];
  if (d.pulsePressure != null)
    flagChips.push({
      label: "Pulse press",
      value: String(d.pulsePressure),
      tone: d.pulsePressureFlag === "narrow" ? "abnormal" : "normal",
    });
  if (d.qsofa)
    flagChips.push({
      label: "qSOFA",
      value: String(d.qsofa.score),
      tone: d.qsofa.score >= 2 ? "abnormal" : "normal",
    });

  function save() {
    const snap: VitalSnapshot = {};
    for (const f of CAPTURE_FIELDS) {
      const raw = form[f.key];
      if (raw != null && raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) (snap as Record<string, unknown>)[f.key] = n;
      }
    }
    if (form.consciousness)
      snap.consciousness = form.consciousness as VitalSnapshot["consciousness"];
    onSave(snap);
    setForm({});
    setCapture(false);
  }

  return (
    <div className="border-border bg-muted/20 border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-muted-foreground/70 hidden shrink-0 font-mono text-[9px] tracking-[0.14em] uppercase sm:inline">
            Vitals
          </span>
          {tiles.map((t) => {
            const series = vitals.series.find((s) => s.key === t.key);
            const points = series?.points ?? [];
            const value = vitals.latest[t.key] as number | null | undefined;
            const isBp = t.key === "systolicBp";
            const dbp = vitals.series.find((s) => s.key === "diastolicBp");
            return (
              <VitalCell
                key={t.key}
                skin={LEGACY_VITAL_SKIN}
                tile={t}
                value={value}
                tone={vitalTone(t.key, value)}
                trend={points.length ? vitalTrend(t.key, points) : null}
                points={points}
                secondary={isBp && dbp ? { label: "DBP", points: dbp.points } : null}
              />
            );
          })}
          {DERIVED_TREND_TILES.map((t) => {
            const series = vitals.series.find((s) => s.key === t.key);
            if (!series || series.points.length === 0) return null;
            const value = series.points[series.points.length - 1]!.value;
            return (
              <VitalCell
                key={t.key}
                skin={LEGACY_VITAL_SKIN}
                tile={t}
                value={value}
                tone={vitalTone(t.key, value)}
                trend={vitalTrend(t.key, series.points)}
                points={series.points}
                secondary={null}
                decimals={"decimals" in t ? t.decimals : undefined}
              />
            );
          })}
          {/* Flag-toned chips — pulse pressure (SBP-relative flag) + qSOFA. */}
          {flagChips.map((c) => (
            <div
              key={c.label}
              className={cn(
                "flex shrink-0 flex-col rounded-lg border px-2 py-1",
                VITAL_TONE_CLASS[c.tone],
              )}
            >
              <span className="font-mono text-[9px] tracking-[0.1em] uppercase opacity-70">
                {c.label}
              </span>
              <span className="text-body-m font-mono leading-none font-semibold tabular-nums">
                {c.value}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setCapture((c) => !c)}
            disabled={disabled}
            className={cn(
              "tap ml-auto shrink-0 self-stretch rounded-lg border px-3 text-[12px] font-medium transition-colors disabled:opacity-50",
              due
                ? "border-rose-400/70 bg-rose-50/60 text-rose-700 motion-safe:animate-pulse dark:bg-rose-950/25 dark:text-rose-200"
                : "border-border bg-card text-foreground/80 hover:bg-muted/50",
            )}
          >
            {due ? "↻ Re-check vitals" : capture ? "Close" : "Record vitals"}
          </button>
        </div>

        {capture ? (
          <div className="scale-in flex origin-top flex-wrap items-end gap-2 pt-1">
            {CAPTURE_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-0.5">
                <span className="text-muted-foreground/70 font-mono text-[9px] tracking-[0.1em] uppercase">
                  {f.label}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="border-border bg-card text-foreground text-body-s focus:border-ring focus:ring-mint-500/25 w-16 rounded-md border px-1.5 py-1 font-mono tabular-nums outline-none focus:ring-2"
                />
              </label>
            ))}
            <label className="flex flex-col gap-0.5">
              <span className="text-muted-foreground/70 font-mono text-[9px] tracking-[0.1em] uppercase">
                ACVPU
              </span>
              <select
                value={form.consciousness ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, consciousness: e.target.value }))}
                className="border-border bg-card text-foreground text-body-s w-16 rounded-md border px-1.5 py-1 font-mono outline-none"
              >
                <option value="">—</option>
                {["A", "C", "V", "P", "U"].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={save}
              disabled={disabled}
              className="tap bg-mint-600 hover:bg-mint-700 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors disabled:opacity-50"
            >
              Save vitals
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Anaphylaxis cross-cut (A/B/C/E) ─────────────────────────────── */
function AnaphylaxisBar({
  disabled,
  episodeId,
  timeline,
  patientAgeYears,
  prescribeAuthority,
  onChanged,
}: {
  disabled: boolean;
  episodeId: string;
  timeline: TimelineEvent[];
  patientAgeYears: number | null;
  prescribeAuthority: PrescribeAuthority;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [prescribeOpen, setPrescribeOpen] = useState(false);
  const dose = getResusDose(ANAPHYLAXIS_PROTOCOL.firstLineDoseId);
  return (
    <div className="border-border bg-card rounded-lg border">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2">
        <div className="min-w-0">
          <p className="text-foreground/80 text-[12px] font-medium">
            Anaphylaxis — first-line everywhere{" "}
            <span className="text-muted-foreground/70 font-mono text-[10px]">A · B · C · E</span>
          </p>
          <p className="text-muted-foreground/80 text-caption truncate">{dose.adultDose}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="tap text-muted-foreground hover:text-foreground rounded-md px-1.5 py-1 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors"
          >
            {open ? "Hide" : "Detail"}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPrescribeOpen(true)}
            className="tap inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
          >
            Prescribe / record
          </button>
        </div>
      </div>
      {open ? (
        <div className="border-border/60 text-muted-foreground flex flex-col gap-1.5 border-t px-3.5 py-2.5 text-[11.5px]">
          <p>{ANAPHYLAXIS_PROTOCOL.recognition}</p>
          <p>
            <span className="text-foreground/70 font-medium">Adjuncts:</span>{" "}
            {ANAPHYLAXIS_PROTOCOL.adjuncts.join(" · ")}
          </p>
          <p className="text-amber-700 dark:text-amber-300">
            {ANAPHYLAXIS_PROTOCOL.notRecommended}
          </p>
          <p>{ANAPHYLAXIS_PROTOCOL.refractory}</p>
          <p className="text-muted-foreground/60 font-mono text-[10px]">{dose.source}</p>
        </div>
      ) : null}

      {prescribeOpen ? (
        <PrescribeDialog
          episodeId={episodeId}
          recCode="anaphylaxis_im_adrenaline"
          recLabel="Anaphylaxis — IM adrenaline"
          patientAgeYears={patientAgeYears}
          prescribeAuthority={prescribeAuthority}
          timeline={timeline}
          onClose={() => setPrescribeOpen(false)}
          onDone={onChanged}
        />
      ) : null}
    </div>
  );
}

/* ─── One ABCDE step ──────────────────────────────────────────────── */
function StepPanel({
  step,
  disabled,
  onLog,
}: {
  step: AbcdeLetter;
  disabled: boolean;
  onLog: (k: ResusEventKind, s: AbcdeLetter, p: Record<string, unknown>) => void;
}) {
  // Mounted fresh per step (key={step} at the call site), so `reassessed`
  // resets naturally on step change — no reset-in-effect.
  const cat = ABCDE_CATALOG[step];
  const [reassessed, setReassessed] = useState(false);

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex items-center gap-2.5">
        <span className="bg-foreground/90 text-background text-body-m flex size-8 items-center justify-center rounded-lg font-mono font-semibold">
          {step}
        </span>
        <h2 className="text-foreground text-heading-s tracking-[-0.01em]">{cat.title}</h2>
      </div>

      {/* Assess */}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          Assess
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {cat.assess.map((item, i) => (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onLog("assessment", step, { label: item.split(" — ")[0], item })}
              className="tap border-border bg-muted/30 text-foreground/80 hover:bg-muted/60 rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition-colors disabled:opacity-50"
              title={item}
            >
              {item.length > 64 ? item.slice(0, 62) + "…" : item}
            </button>
          ))}
        </div>
      </section>

      {/* Danger signs */}
      <section className="flex flex-col gap-1.5">
        <h3 className="font-mono text-[10px] tracking-[0.14em] text-rose-600 uppercase dark:text-rose-300">
          Danger signs — tap to flag a life-threat
        </h3>
        <div className="flex flex-col gap-1.5">
          {cat.dangerSigns.map((sign, i) => (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onLog("assessment", step, { label: sign, item: sign, danger: true })}
              className="tap flex items-start gap-2 rounded-lg border border-rose-300/60 bg-rose-50/40 px-2.5 py-2 text-left text-[12px] text-rose-800 transition-colors hover:bg-rose-100/60 disabled:opacity-50 dark:border-rose-500/30 dark:bg-rose-950/20 dark:text-rose-200"
            >
              <span aria-hidden className="mt-px">
                ▲
              </span>
              <span className="flex-1">{sign}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Linked actions */}
      <section className="flex flex-col gap-1.5">
        <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          Actions — tap to log as performed
        </h3>
        <div className="flex flex-col gap-1.5">
          {cat.actions.map((a) => (
            <ActionRow key={a.id} action={a} step={step} disabled={disabled} onLog={onLog} />
          ))}
        </div>
      </section>

      {/* Reassess */}
      <section className="border-border/60 flex flex-col gap-1.5 border-t pt-3">
        <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          Reassess after every intervention
        </h3>
        <p className="text-muted-foreground text-[11.5px] leading-relaxed">
          {reassessPromptFor(step)}
        </p>
        <button
          type="button"
          disabled={disabled || reassessed}
          onClick={() => {
            onLog("reassessment", step, { label: `Reassessed ${step}` });
            setReassessed(true);
          }}
          className="tap border-border text-foreground/80 hover:bg-muted/50 self-start rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors disabled:opacity-50"
        >
          {reassessed ? "✓ Reassessment logged" : "Log reassessment"}
        </button>
      </section>
    </div>
  );
}

function ActionRow({
  action,
  step,
  disabled,
  onLog,
}: {
  action: LinkedAction;
  step: AbcdeLetter;
  disabled: boolean;
  onLog: (k: ResusEventKind, s: AbcdeLetter, p: Record<string, unknown>) => void;
}) {
  const [show, setShow] = useState(false);
  const dose = action.doseId ? getResusDose(action.doseId as ResusDoseId) : null;
  const kind: ResusEventKind = dose ? "drug" : "action";

  return (
    <div
      className={cn(
        "bg-card rounded-lg border",
        action.emergency ? "border-rose-400/60" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onLog(kind, step, {
              label: action.label,
              actionId: action.id,
              doseId: action.doseId ?? null,
              dose: dose?.adultDose ?? null,
              source: action.source,
            })
          }
          className="tap flex min-w-0 flex-1 items-center gap-2 rounded-md text-left disabled:opacity-50"
        >
          {action.emergency ? (
            <span aria-hidden className="text-rose-600">
              ▲
            </span>
          ) : null}
          <span className="text-foreground/90 truncate text-[12.5px] font-medium">
            {action.label}
          </span>
        </button>
        {dose || action.whenIndicated ? (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="tap text-muted-foreground hover:text-foreground shrink-0 rounded-md px-1.5 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors"
          >
            {show ? "−" : "i"}
          </button>
        ) : null}
      </div>
      {show ? (
        <div className="border-border/60 text-muted-foreground text-caption flex flex-col gap-1 border-t px-2.5 py-2">
          <p>
            <span className="text-foreground/60">When:</span> {action.whenIndicated}
          </p>
          {dose ? (
            <p>
              <span className="text-foreground/60">Dose:</span>{" "}
              {dose.adultDose ? (
                <span className="text-foreground/90 font-medium">{dose.adultDose}</span>
              ) : (
                <span className="italic">Category-level — clinician doses</span>
              )}
              {dose.timing ? ` · ${dose.timing}` : ""}
            </p>
          ) : null}
          <p className="text-muted-foreground/60 font-mono text-[10px]">{action.source}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Team: roles + who's responding ──────────────────────────────── */
const ROLE_LABEL: Record<ResusRole, string> = {
  leader: "Leader",
  airway: "Airway",
  circulation: "Circulation",
  scribe: "Scribe",
  runner: "Runner",
  cpr_provider: "CPR",
  family_liaison: "Family",
};

function TeamPanel({
  episodeId,
  roster,
  responders,
  scope,
  disabled,
  onChange,
}: {
  episodeId: string;
  roster: RosterEntry[];
  responders: ResponderEntry[];
  scope: DeskScope;
  disabled: boolean;
  onChange: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const byRole = new Map(roster.map((r) => [r.role, r]));
  const respondingCount = responders.filter((r) => r.responding).length;
  const me = responders.find((r) => r.userId === scope.userId);
  const iAmResponding = me?.responding ?? false;
  const meHasRole = roster.some((r) => r.userId === scope.userId);

  function claim(role: ResusRole) {
    startTransition(async () => {
      await claimResusRoleAction({ episodeId, role });
      onChange();
    });
  }

  return (
    <div className="border-border bg-card rounded-lg border p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-foreground/80 text-[12px] font-medium">Team</h2>
        <span className="text-muted-foreground/70 font-mono text-[10px]">
          {respondingCount}/{responders.length} responding
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {RESUS_ROLES.map((role) => {
          const holder = byRole.get(role);
          const isMine = holder?.userId === scope.userId;
          return (
            <div key={role} className="flex items-center gap-2 text-[11.5px]">
              <span className="text-muted-foreground/70 w-[68px] shrink-0 font-mono text-[10px] tracking-[0.06em] uppercase">
                {ROLE_LABEL[role]}
                {role === "leader" && !holder ? (
                  <span className="text-muted-foreground/40"> ★</span>
                ) : null}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  holder ? "text-foreground/85" : "text-muted-foreground/50",
                )}
              >
                {holder ? (isMine ? "You" : (holder.fullName ?? "Assigned")) : "—"}
              </span>
              {!isMine ? (
                <button
                  type="button"
                  disabled={disabled || pending}
                  onClick={() => claim(role)}
                  className="tap text-muted-foreground hover:text-foreground border-border shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors disabled:opacity-40"
                >
                  {holder ? "Take" : "Claim"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-muted-foreground/60 mt-2 text-[10px] leading-snug">
        {scope.leaderRecommended
          ? "★ Leader recommended for your cadre. Roles never block — claim what you're doing."
          : "★ Leader is usually a doctor / clinical officer. Roles never block — claim what you're doing."}
      </p>

      {me && !iAmResponding ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await acknowledgeResusAlertAction(episodeId);
              onChange();
            })
          }
          className="tap bg-mint-600 hover:bg-mint-700 mt-2 w-full rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors disabled:opacity-50"
        >
          {"I'm responding"}
        </button>
      ) : iAmResponding ? (
        <p className="text-caption text-mint-700 dark:text-mint-300 mt-2 text-center font-medium">
          {`✓ You're responding${meHasRole ? "" : " — claim a role above"}`}
        </p>
      ) : null}
    </div>
  );
}

/* ─── The live immutable record ───────────────────────────────────── */
const KIND_GLYPH: Partial<Record<ResusEventKind, string>> = {
  drug: "💉",
  fluid: "💧",
  procedure: "✚",
  vital: "♥",
  assessment: "◔",
  reassessment: "↻",
  decision: "◆",
  action: "▸",
  arrest_detected: "⚠",
  cpr_started: "⚠",
  mobilisation: "📣",
  role_change: "⇄",
  handover: "⇉",
  note: "✎",
};

function Timeline({
  timeline,
  pendingLabel,
}: {
  timeline: TimelineEvent[];
  pendingLabel: string | null;
}) {
  // Newest first for the live view.
  const ordered = [...timeline].reverse();
  return (
    <ol className="border-border/60 bg-muted/20 flex flex-1 flex-col gap-px overflow-y-auto rounded-xl border p-1.5">
      {pendingLabel ? (
        <li className="scale-in flex origin-top items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] opacity-60">
          <span className="font-mono text-[10px]">··:··</span>
          <span className="text-foreground/80 flex-1">{pendingLabel}</span>
        </li>
      ) : null}
      {ordered.length === 0 && !pendingLabel ? (
        <li className="text-muted-foreground/70 px-2 py-6 text-center text-[11.5px]">
          No entries yet. Tapping an assessment, danger sign, or action logs it here.
        </li>
      ) : null}
      {ordered.map((e, i) => {
        const label = String(e.payload.label ?? e.payload.item ?? e.kind);
        const danger = e.payload.danger === true;
        // Subtle state tint so the running record is scannable by state
        // (failed → faint rose, performed → faint teal) — tint, don't shout.
        const evState = e.payload.state;
        const tint =
          danger || evState === "failed"
            ? "bg-rose-50/60 dark:bg-rose-950/20"
            : evState === "performed"
              ? "bg-mint-50/50 dark:bg-mint-950/20"
              : evState === "in_progress"
                ? "bg-blue-50/40 dark:bg-blue-950/15"
                : "";
        return (
          <li
            key={e.id}
            className={cn(
              "flex items-start gap-2 rounded-lg px-2 py-1.5 text-[11.5px]",
              // Only the newest entry pops on mount — arriving log lines are
              // felt without re-animating the rest of the record.
              i === 0 && "scale-in origin-top",
              tint,
            )}
          >
            <span className="text-muted-foreground/70 mt-px shrink-0 font-mono text-[10px] tabular-nums">
              {clockOf(e.recordedAt)}
            </span>
            <span aria-hidden className="shrink-0">
              {KIND_GLYPH[e.kind] ?? "•"}
            </span>
            <span className="min-w-0 flex-1">
              {e.step && e.step !== "pre" && e.step !== "arrest" ? (
                <span className="text-muted-foreground/70 mr-1 font-mono text-[9.5px]">
                  [{e.step}]
                </span>
              ) : null}
              <span
                className={cn(
                  danger ? "font-medium text-rose-800 dark:text-rose-200" : "text-foreground/80",
                )}
              >
                {label}
              </span>
              {e.payload.dose ? (
                <span className="text-muted-foreground/70"> — {String(e.payload.dose)}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
