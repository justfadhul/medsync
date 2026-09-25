"use client";

import type { TriageSubmitState } from "../actions";
import type { RecDecisionRecord } from "./next-steps";
import type { VitalInterpretation, VitalTone } from "@/lib/triage/interpret";
import type { AcuityColour, AcuityLevel, Acvpu, TriageInput } from "@/lib/triage/types";
import type { TriageWorklistRow } from "@/lib/triage/worklist";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  InfoIcon,
  RotateCwIcon,
  ShieldIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ACUITY_TIERS } from "@/lib/triage/constants";
import { TRIAGE_DISCRIMINATORS } from "@/lib/triage/discriminators";
import { runTriage } from "@/lib/triage/engine";
import { interpretVitals } from "@/lib/triage/interpret";
import { cn } from "@/lib/utils";
import { submitTriageAction } from "../actions";
import { NextSteps } from "./next-steps";
import { RapidRedButton } from "./rapid-red-button";

/**
 * The full-page triage desk — dashboard-grade.
 *
 * The pure engine (lib/triage) runs LIVE in the browser as vitals are
 * entered, so the acuity + every vital's interpretation update visibly
 * before commit (kickoff §0.2). On submit the SAME function re-runs
 * authoritatively server-side under authority + audit (no drift).
 * Down-overrides are cadre-gated (R1).
 *
 * Layout (three co-visible zones, ADR 0043): a left rail (identity +
 * live acuity + rapid-Red + the live Next Steps), a centre Triage Form
 * (vitals + red-flags) + sticky assign bar, and a right rail holding the
 * live Score — so the loop (enter vital → score moves → next steps
 * update) needs no scrolling. Both rails scroll independently. Below lg,
 * a sticky live header keeps the acuity + score visible above the vitals.
 *
 * Visual language (an analytics-dashboard idiom): the verdict is the
 * hero; the vitals ARE the metric tiles (value = the number, NEWS2
 * contribution = a delta pill, band = the context sub-line); derived
 * "smart" metrics get first-class tiles; the worse-of is a segmented
 * distribution bar. COLOUR IS INFORMATION — a normal/measured-0 vital is
 * monochrome; colour appears only on deviation; a MISSING vital is a
 * dashed ghost ("—" / "Not recorded"), never a reassuring zero.
 */

const COLOUR_CLASS: Record<string, string> = {
  red: "bg-rose-600 text-white",
  orange: "bg-orange-500 text-white",
  yellow: "bg-amber-400 text-amber-950",
  green: "bg-mint-600 text-white",
  blue: "bg-slate-400 text-white",
};

/** Solid fill per acuity colour — for the segmented worse-of bar + dots. */
const SEG_FILL: Record<AcuityColour, string> = {
  red: "bg-rose-600",
  orange: "bg-orange-500",
  yellow: "bg-amber-400",
  green: "bg-mint-600",
  blue: "bg-slate-400",
};

/** Faint acuity-tinted ground — used ONLY on the verdict hero. */
const HERO_TINT: Record<AcuityColour, string> = {
  red: "border-rose-500/40 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-950/20",
  orange: "border-orange-400/40 bg-orange-50/60 dark:border-orange-500/30 dark:bg-orange-950/20",
  yellow: "border-amber-300/50 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-950/20",
  green: "border-mint-500/30 bg-mint-50/50 dark:border-mint-500/30 dark:bg-mint-950/20",
  blue: "border-slate-300/50 bg-slate-50/60 dark:border-slate-500/30 dark:bg-slate-950/20",
};

const TONE_CHIP: Record<VitalTone, string> = {
  normal: "text-muted-foreground",
  borderline: "text-amber-700 dark:text-amber-300",
  abnormal: "text-orange-700 dark:text-orange-300",
  critical: "text-rose-700 dark:text-rose-300",
  missing: "text-muted-foreground/60 italic",
  info: "text-muted-foreground",
};

/**
 * Tile warning treatment by tone — a deranged vital must JUMP OUT, via a
 * coloured BORDER + soft tinted ground + a ring that scale up with
 * severity (NO left-edge accent bar — user preference). Normal/info
 * tiles stay calm so the abnormal ones pop by contrast. Critical adds a
 * gentle pulse (reduced-motion disables it).
 */
const TILE_TONE: Record<VitalTone, string> = {
  normal: "border-border bg-card",
  info: "border-border bg-card",
  missing: "border-dashed border-border/70 bg-muted/20",
  borderline: "border-amber-300/70 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-950/20",
  abnormal:
    "border-orange-400/70 bg-orange-50/60 ring-1 ring-orange-400/30 dark:border-orange-500/50 dark:bg-orange-950/25",
  critical:
    "border-rose-500/80 bg-rose-50/70 ring-1 ring-rose-500/40 motion-safe:animate-pulse dark:border-rose-500/60 dark:bg-rose-950/30",
};

/** Big-number colour — the value itself warns on deviation, not just the sub-label. */
const VALUE_TONE: Record<VitalTone, string> = {
  normal: "text-foreground",
  info: "text-foreground",
  missing: "text-muted-foreground/40",
  borderline: "text-amber-700 dark:text-amber-300",
  abnormal: "text-orange-700 dark:text-orange-300",
  critical: "text-rose-700 dark:text-rose-300",
};

/** Delta-pill tint — only ever shown for a positive NEWS2 contribution. */
const PILL_TINT: Record<VitalTone, string> = {
  normal: "",
  borderline: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  abnormal: "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300",
  critical: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300",
  missing: "",
  info: "",
};

function riskWord(total: number): string {
  if (total >= 7) return "high · urgent";
  if (total >= 5) return "medium · escalate";
  return "low";
}

function riskTone(total: number): VitalTone {
  if (total >= 7) return "critical";
  if (total >= 5) return "abnormal";
  return "normal";
}

function riskBarFill(total: number): string {
  if (total >= 7) return "bg-rose-500";
  if (total >= 5) return "bg-orange-500";
  if (total >= 1) return "bg-amber-400";
  return "bg-mint-600";
}

interface VitalsState {
  respiratoryRate: string;
  spo2: string;
  oxygen: "air" | "oxygen";
  systolicBp: string;
  diastolicBp: string;
  pulse: string;
  consciousness: Acvpu;
  temperature: string;
  bloodGlucose: string;
}

const EMPTY_VITALS: VitalsState = {
  respiratoryRate: "",
  spo2: "",
  oxygen: "air",
  systolicBp: "",
  diastolicBp: "",
  pulse: "",
  consciousness: "A",
  temperature: "",
  bloodGlucose: "",
};

function num(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Strip the engine's " · NEWS +n" suffix — the delta pill already carries it. */
function subLabel(label: string): string {
  return label.replace(/\s·\sNEWS\s\+\d/, "");
}

/**
 * The full-page triage desk (/nurse/triage/[intakeId]). Same engine state
 * machine as before; composed as a 3-region page per the wireframe —
 * a triage-local rail (identity + live acuity + rapid-Red), the center
 * Triage Form + Next Steps seam + sticky assign bar, and a sticky right
 * Scores column (the live read-out). On submit it returns to the worklist.
 */
export function TriageDesk({
  row,
  mayDownTriage,
  basePath = "/nurse/triage",
  resusBase = "/nurse/resus",
  openResusOnArrest = false,
  onSubmitted,
  backLabel = "Back to worklist",
}: {
  row: TriageWorklistRow;
  mayDownTriage: boolean;
  /** Workspace base for the back-to-worklist nav (/nurse/triage or /doctor/triage). */
  basePath?: string;
  /** Workspace base the rapid-Red arrest jump lands in (/nurse/resus or /doctor/resus). */
  resusBase?: string;
  /** Resus Desk v2 S0: the server page passes `resusDeskV2()` — never read here (client). */
  openResusOnArrest?: boolean;
  /**
   * The doctor workspace's sheet shows the result and the next step in place;
   * without it the desk returns to the worklist, as before.
   */
  onSubmitted?: (state: TriageSubmitState) => void;
  /** The back link's words: the doctor workspace's sheet goes "Back to board". */
  backLabel?: string;
}) {
  const router = useRouter();
  const onClose = useCallback(() => router.push(basePath), [router, basePath]);
  const isMale = row.sex?.toLowerCase().startsWith("m") ?? false;
  const [vitals, setVitals] = useState<VitalsState>(EMPTY_VITALS);
  // A male patient can never be pregnant — pin the context so the
  // engine + payload never carry a stray pregnancy state.
  const [pregnancy, setPregnancy] = useState<TriageInput["context"]["pregnancy"]>("not_pregnant");
  const effectivePregnancy = isMale ? "not_pregnant" : pregnancy;
  // Reproductive-age female is auto-seeded from sex + age (drives the
  // unknown-pregnancy flag); the clinician can still toggle it.
  const autoReproFemale =
    (row.sex?.toLowerCase().startsWith("f") ?? false) &&
    row.ageYears != null &&
    row.ageYears >= 12 &&
    row.ageYears <= 50;
  const [reproFemale, setReproFemale] = useState(autoReproFemale);
  const [scale2, setScale2] = useState(false);
  const [discriminators, setDiscriminators] = useState<Set<string>>(new Set());
  const [assigned, setAssigned] = useState<AcuityLevel | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [recDecisions, setRecDecisions] = useState<RecDecisionRecord[]>([]);

  const [state, formAction, pending] = useActionState<TriageSubmitState, FormData>(
    submitTriageAction,
    {},
  );
  useEffect(() => {
    if (!state.ok) return;
    if (onSubmitted) onSubmitted(state);
    else onClose();
  }, [state, onClose, onSubmitted]);

  const liveVitals = useMemo(
    () => ({
      respiratoryRate: num(vitals.respiratoryRate),
      spo2: num(vitals.spo2),
      oxygen: vitals.oxygen,
      systolicBp: num(vitals.systolicBp),
      diastolicBp: num(vitals.diastolicBp),
      pulse: num(vitals.pulse),
      consciousness: vitals.consciousness,
      temperature: num(vitals.temperature),
      bloodGlucose: num(vitals.bloodGlucose),
    }),
    [vitals],
  );

  const result = useMemo(() => {
    const input: TriageInput = {
      context: {
        ageYears: row.ageYears,
        pregnancy: effectivePregnancy,
        reproductiveAgeFemale: isMale ? false : reproFemale,
        spo2Scale2Enabled: scale2,
      },
      vitals: liveVitals,
      presentDiscriminators: [...discriminators],
      adjustments: { priorLevel: (row.priorLevel as AcuityLevel | null) ?? null },
    };
    return runTriage(input);
  }, [
    liveVitals,
    row.ageYears,
    row.priorLevel,
    effectivePregnancy,
    isMale,
    reproFemale,
    scale2,
    discriminators,
  ]);

  const interp = useMemo(() => interpretVitals(liveVitals, result), [liveVitals, result]);

  const computed = result.level;
  const effectiveAssigned = assigned ?? computed;
  const direction =
    effectiveAssigned < computed ? "up" : effectiveAssigned > computed ? "down" : "none";
  const downBlocked = direction === "down" && !mayDownTriage;
  const needsReason = direction === "down";

  const tier = ACUITY_TIERS.find((t) => t.level === computed)!;
  const scopedDiscriminators = TRIAGE_DISCRIMINATORS.filter(
    (d) =>
      d.source === "manual" && (d.appliesTo === "all" || d.appliesTo === ruleToPop(result.ruleset)),
  );
  const firedCount = scopedDiscriminators.filter((d) => discriminators.has(d.code)).length;

  // Completeness journey (ESI v5 mandatory HR/RR/SpO₂). A quiet,
  // ever-present affordance so "provisional because X, Y missing" is
  // obvious without hunting. Reads the engine's own missing list — no
  // new clinical logic.
  const PARAM_SHORT: Record<string, string> = {
    respiratory_rate: "RR",
    pulse: "HR",
    spo2: "SpO₂",
  };
  const missingMandatory = result.missingRequiredVitals.map((p) => PARAM_SHORT[p] ?? p);
  const vitalsHint =
    missingMandatory.length > 0
      ? `provisional — need ${missingMandatory.join(", ")}`
      : "complete · updates live";

  const name = row.displayName ?? row.patientUnknownLabel ?? "Unidentified patient";
  const metaBits = [
    row.patientCode,
    row.ageYears != null ? `${row.ageYears}y` : "age unknown",
    row.sex ?? null,
  ].filter(Boolean);

  const payload = JSON.stringify({
    intake_id: row.intakeId,
    patient_user_id: row.patientUserId,
    age_years: row.ageYears,
    pregnancy: effectivePregnancy,
    reproductive_age_female: isMale ? false : reproFemale,
    spo2_scale2_enabled: scale2,
    vitals: liveVitals,
    present_discriminators: [...discriminators],
    prior_level: row.priorLevel ?? null,
    assigned_level: effectiveAssigned,
    override_reason: overrideReason.trim() || undefined,
    recommendation_decisions: recDecisions.length > 0 ? recDecisions : undefined,
  });

  const derived = result.derived;

  // ── Identity (rail) ─────────────────────────────────────────────
  const identity = (
    <div className="flex flex-col gap-1">
      {row.priorLevel != null ? (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[9.5px] font-semibold tracking-wide text-amber-700 uppercase dark:bg-amber-950/30 dark:text-amber-300">
          <RotateCwIcon className="size-2.5" aria-hidden />
          Re-triage · was L{row.priorLevel}
        </span>
      ) : (
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          {row.entryTypeName}
        </span>
      )}
      <h1 className="font-display text-foreground text-[20px] leading-tight font-medium tracking-[-0.01em]">
        {name}
      </h1>
      <span className="text-muted-foreground text-caption font-mono tabular-nums">
        {metaBits.join(" · ")}
      </span>
    </div>
  );

  // ── Compact live acuity (rail mirror of the verdict) ────────────
  const compactAcuity = (
    <div className={cn("flex flex-col gap-1.5 rounded-xl border p-3", HERO_TINT[tier.colour])}>
      <span className="text-muted-foreground font-mono text-[9px] tracking-[0.14em] uppercase">
        Live acuity
      </span>
      <div className="flex items-center gap-2">
        <span
          // Re-keyed per level so the live badge pops as the acuity moves.
          key={tier.level}
          className={cn(
            "scale-in inline-flex items-center rounded-lg px-2.5 py-1 text-[14px] font-semibold tabular-nums",
            COLOUR_CLASS[tier.colour],
          )}
        >
          L{tier.level} · {tier.colour.toUpperCase()}
        </span>
        {result.provisional ? (
          <span className="scale-in inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold tracking-wide text-amber-700 uppercase dark:bg-amber-950/30 dark:text-amber-300">
            provisional
          </span>
        ) : null}
      </div>
      <span className="text-foreground/80 text-caption font-medium">
        {result.disposition} · target {tier.targetMinutes}m
      </span>
      {result.news2 ? (
        <div className="bg-muted/50 h-1 w-full overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full motion-safe:transition-[width,background-color] motion-safe:duration-500",
              riskBarFill(result.news2.total),
            )}
            style={{ width: `${Math.min(100, (result.news2.total / 20) * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );

  // ── Triage Form (center inputs) ─────────────────────────────────
  const triageForm = (
    <div className="border-border bg-card flex flex-col gap-3.5 rounded-2xl border p-4">
      {result.lifeThreat ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-50/60 px-4 py-3 dark:bg-rose-950/20">
          <p className="text-[12.5px] font-semibold text-rose-700 dark:text-rose-300">
            Immediate life threat — Level 1, resuscitate now.
          </p>
          <p className="text-[11.5px] text-rose-700/80 dark:text-rose-300/80">
            {result.lifeThreatReasons.join("; ")}
          </p>
        </div>
      ) : null}

      {/* Patient */}
      <Section title="Patient">
        <div className="grid grid-cols-2 gap-2">
          <ReadTile
            label="Age"
            value={row.ageYears != null ? `${row.ageYears}` : "—"}
            unit={row.ageYears != null ? "years" : "confirm age"}
          />
          {isMale ? (
            <ReadTile label="Pregnancy" value="N/A" unit="not applicable (male)" />
          ) : (
            <PillSelectTile
              label="Pregnancy"
              value={pregnancy}
              display={
                {
                  not_pregnant: "Not pregnant",
                  pregnant: "Pregnant",
                  postpartum_6wk: "≤6wk postpartum",
                  unknown: "Unknown",
                }[pregnancy]
              }
              onChange={(v) => setPregnancy(v as typeof pregnancy)}
              options={[
                ["not_pregnant", "Not pregnant"],
                ["pregnant", "Pregnant"],
                ["postpartum_6wk", "≤6wk postpartum"],
                ["unknown", "Unknown"],
              ]}
            />
          )}
        </div>
        {!isMale && pregnancy === "unknown" ? (
          <Check checked={reproFemale} onChange={setReproFemale}>
            Female of reproductive age (flags confirm-pregnancy)
          </Check>
        ) : null}
      </Section>

      {/* Vitals */}
      <Section
        title="Vital signs"
        hint={vitalsHint}
        control={
          <PillToggle
            active={scale2}
            onClick={() => setScale2(!scale2)}
            on="Scale 2"
            off="Scale 1"
          />
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <VitalTile
            label="Resp. rate"
            unit="/min"
            v={vitals.respiratoryRate}
            set={(x) => setVitals({ ...vitals, respiratoryRate: x })}
            i={interp.respiratoryRate}
          />
          <VitalTile
            label="SpO₂"
            unit="%"
            v={vitals.spo2}
            set={(x) => setVitals({ ...vitals, spo2: x })}
            i={interp.spo2}
          />
          <VitalTile
            label="Pulse"
            unit="/min"
            v={vitals.pulse}
            set={(x) => setVitals({ ...vitals, pulse: x })}
            i={interp.pulse}
          />
          <VitalTile
            label="Systolic BP"
            unit="mmHg"
            v={vitals.systolicBp}
            set={(x) => setVitals({ ...vitals, systolicBp: x })}
            i={interp.systolicBp}
          />
          <VitalTile
            label="Diastolic BP"
            unit="mmHg"
            v={vitals.diastolicBp}
            set={(x) => setVitals({ ...vitals, diastolicBp: x })}
            i={interp.diastolicBp}
          />
          <VitalTile
            label="Temp"
            unit="°C"
            v={vitals.temperature}
            set={(x) => setVitals({ ...vitals, temperature: x })}
            i={interp.temperature}
          />
          <VitalTile
            label="Glucose"
            unit="mmol/L"
            v={vitals.bloodGlucose}
            set={(x) => setVitals({ ...vitals, bloodGlucose: x })}
            i={interp.bloodGlucose}
          />
          <SelectTile
            label="Air / O₂"
            value={vitals.oxygen}
            display={vitals.oxygen === "oxygen" ? "On O₂" : "Room air"}
            onChange={(v) => setVitals({ ...vitals, oxygen: v as "air" | "oxygen" })}
            options={[
              ["air", "Room air"],
              ["oxygen", "On O₂"],
            ]}
            i={interp.oxygen}
          />
          <SelectTile
            label="Consciousness"
            value={vitals.consciousness}
            display={
              { A: "Alert", C: "Confusion", V: "Voice", P: "Pain", U: "Unresp." }[
                vitals.consciousness
              ]
            }
            onChange={(v) => setVitals({ ...vitals, consciousness: v as Acvpu })}
            options={[
              ["A", "Alert"],
              ["C", "New confusion"],
              ["V", "Voice"],
              ["P", "Pain"],
              ["U", "Unresponsive"],
            ]}
            i={interp.consciousness}
          />
        </div>
      </Section>

      {/* Red-flags */}
      <Section title="Red-flags" hint={`${firedCount} of ${scopedDiscriminators.length} fired`}>
        {scopedDiscriminators.length === 0 ? (
          <div className="border-border text-muted-foreground flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center">
            <span className="bg-muted/50 flex size-8 items-center justify-center rounded-full">
              <ShieldIcon className="size-4" aria-hidden />
            </span>
            <span className="text-[12px]">No red-flags apply to this population.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {scopedDiscriminators.map((d) => {
              const fired = discriminators.has(d.code);
              return (
                <label
                  key={d.code}
                  className={cn(
                    "tap flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-[12px] transition-colors",
                    fired
                      ? "border-rose-500/60 bg-rose-50/70 dark:border-rose-500/50 dark:bg-rose-950/25"
                      : "border-border hover:border-border hover:bg-muted/40",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={fired}
                    onChange={(e) => {
                      const next = new Set(discriminators);
                      if (e.target.checked) next.add(d.code);
                      else next.delete(d.code);
                      setDiscriminators(next);
                    }}
                    className="mt-0.5 size-3.5 accent-rose-600"
                  />
                  <span className="flex-1">
                    <span className={cn(fired && "font-medium text-rose-800 dark:text-rose-200")}>
                      {d.label}
                    </span>{" "}
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-1.5 py-px font-mono text-[9.5px] font-semibold tabular-nums",
                        fired ? "bg-rose-600 text-white" : "text-muted-foreground bg-muted/60",
                      )}
                    >
                      L{d.minAcuity}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );

  // ── Scores (right read-out column) ──────────────────────────────
  const scores = (
    <div className="flex flex-col gap-3">
      {/* Acuity decision hero */}
      <div className={cn("rounded-2xl border p-4", HERO_TINT[tier.colour])}>
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
            Final acuity
          </span>
          <div className="flex items-end gap-2.5">
            <span
              // Re-keyed per level so the verdict pops when the engine moves it.
              key={tier.level}
              className="text-foreground scale-in inline-block origin-bottom-left font-mono text-[32px] leading-[0.85] font-semibold tabular-nums"
            >
              L{tier.level}
            </span>
            <span
              className={cn(
                "text-overline mb-1 inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold tracking-wide uppercase",
                COLOUR_CLASS[tier.colour],
              )}
            >
              {tier.colour}
            </span>
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            <span className="text-foreground text-[12.5px] font-semibold">
              {result.disposition} · target {tier.targetMinutes}m
            </span>
            <span className="text-muted-foreground/80 text-caption">
              {result.news2
                ? `driver: NEWS2 ${result.news2.total}`
                : (result.firedDiscriminators[0]?.label ?? "clinical assessment")}
            </span>
            {result.provisional ? (
              <span className="text-muted-foreground/70 text-[10.5px] italic">
                provisional — pending vitals
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Score: NEWS2 KPI + derived metrics */}
      <Section title="Score" hint={result.news2 ? "NEWS2 + physiology" : "physiology"}>
        <div className="flex flex-col gap-2.5">
          {result.news2 ? (
            <div className="border-border bg-card flex flex-col gap-1.5 rounded-2xl border px-4 pt-3.5 pb-3.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
                  NEWS2 total
                </span>
                {result.news2.hasSingleParameterThree ? (
                  <span className="scale-in inline-flex items-center rounded-full bg-rose-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-rose-700 uppercase dark:bg-rose-950/30 dark:text-rose-300">
                    single +3 · red score
                  </span>
                ) : null}
              </div>
              <div className="flex items-end gap-2">
                <span className="text-foreground -ml-0.5 font-mono text-[30px] leading-[0.85] font-semibold tabular-nums">
                  {result.news2.total}
                </span>
                <span
                  className={cn(
                    "mb-1 inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide",
                    result.news2.total >= 5
                      ? PILL_TINT[riskTone(result.news2.total)]
                      : "text-muted-foreground",
                  )}
                >
                  {riskWord(result.news2.total)}
                </span>
              </div>
              <div className="bg-muted/50 mt-0.5 h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full motion-safe:transition-[width,background-color] motion-safe:duration-500",
                    riskBarFill(result.news2.total),
                  )}
                  style={{ width: `${Math.min(100, (result.news2.total / 20) * 100)}%` }}
                />
              </div>
              <span className="text-muted-foreground/70 text-[10.5px]">
                {result.news2.provisional
                  ? "provisional — gaps shown, never scored 0"
                  : "of 20 aggregate"}
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <DerivedTile
              label="Shock index"
              value={derived.shockIndex != null ? derived.shockIndex.toFixed(2) : null}
              sub="HR / SBP · watch > 0.90"
              tone={
                derived.shockIndexFlag === "shock"
                  ? "critical"
                  : derived.shockIndexFlag === "occult_shock"
                    ? "abnormal"
                    : "normal"
              }
            />
            <DerivedTile
              label="qSOFA"
              value={derived.qsofa ? `${derived.qsofa.score}` : null}
              unit="/3"
              sub={
                derived.qsofa
                  ? [
                      derived.qsofa.respiratoryRatePoint ? "RR≥22" : null,
                      derived.qsofa.hypotensionPoint ? "SBP≤100" : null,
                      derived.qsofa.alteredMentationPoint ? "altered" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "no points"
                  : "needs RR / SBP / ACVPU"
              }
              tone={derived.qsofa && derived.qsofa.score >= 2 ? "critical" : "normal"}
            />
            <DerivedTile
              label="MAP"
              value={
                derived.meanArterialPressure != null
                  ? derived.meanArterialPressure.toFixed(0)
                  : null
              }
              unit="mmHg"
              sub="perfusion · low < 65"
              tone={
                derived.meanArterialPressure != null && derived.meanArterialPressure < 65
                  ? "abnormal"
                  : "normal"
              }
            />
          </div>
        </div>
      </Section>

      {/* Worse-of distribution */}
      <WorseOf result={result} finalTier={tier} />
    </div>
  );

  // ── Next Steps seam (placeholder for the recommendations layer) ──
  const nextSteps = (
    <NextSteps result={result} assignedLevel={effectiveAssigned} onChange={setRecDecisions} />
  );

  // ── Assign / submit action bar ──────────────────────────────────
  const actionBar = (
    <div className="border-border glass sticky bottom-0 z-10 flex flex-col gap-3 rounded-2xl border p-4 shadow-lg shadow-black/3">
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
          Assign acuity
        </span>
        <div className="flex gap-1.5">
          {ACUITY_TIERS.map((t) => {
            const isDown = t.level > computed;
            const blocked = isDown && !mayDownTriage;
            const selected = effectiveAssigned === t.level;
            return (
              <button
                key={t.level}
                type="button"
                disabled={blocked}
                onClick={() => setAssigned(t.level)}
                title={blocked ? "Only a doctor / clinical officer may assign a lower acuity" : ""}
                className={cn(
                  "tap relative flex-1 rounded-md py-2 text-[12px] font-semibold transition-colors",
                  selected
                    ? COLOUR_CLASS[t.colour]
                    : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/40 border",
                  blocked && "cursor-not-allowed opacity-40",
                )}
              >
                {/* One-shot confirmation flare — mounts with the selection, so
                    the button node (and keyboard focus) stays stable. */}
                {selected ? (
                  <span
                    aria-hidden
                    className="select-flare pointer-events-none absolute inset-0 rounded-md"
                  />
                ) : null}
                L{t.level}
              </button>
            );
          })}
        </div>
        <p
          className={cn(
            "text-caption",
            direction === "none"
              ? "text-muted-foreground"
              : direction === "up"
                ? "text-orange-700 dark:text-orange-300"
                : "text-rose-700 dark:text-rose-300",
          )}
        >
          {direction === "none"
            ? "Confirming the computed level."
            : direction === "up"
              ? "Escalating above the computed level."
              : `Down-triage — a reason is required${downBlocked ? " (your cadre cannot down-triage)" : ""}.`}
        </p>
      </div>

      {needsReason ? (
        <textarea
          value={overrideReason}
          onChange={(e) => setOverrideReason(e.target.value)}
          rows={2}
          minLength={8}
          placeholder="Why is a lower acuity clinically appropriate? (audited)"
          className="border-input bg-background focus-visible:ring-ring/50 text-body-s rounded-md border p-2 outline-none focus-visible:ring-[3px]"
        />
      ) : null}

      {state.error ? <p className="text-destructive text-[12px]">{state.error}</p> : null}

      <form action={formAction} className="flex items-center justify-end gap-2">
        <input type="hidden" name="payload" value={payload} />
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending} className="tap">
          Cancel
        </Button>
        <Button
          type="submit"
          className="tap"
          disabled={pending || downBlocked || (needsReason && overrideReason.trim().length < 8)}
        >
          {pending
            ? "Saving…"
            : row.priorLevel != null
              ? `Re-assign L${effectiveAssigned}`
              : `Assign L${effectiveAssigned}`}
        </Button>
      </form>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-4 sm:px-6">
      {/* Back nav */}
      <Link
        href={basePath}
        className="text-muted-foreground hover:text-foreground group mb-4 inline-flex items-center gap-1.5 text-[12px] transition-colors"
      >
        <ArrowLeftIcon
          className="size-3.5 transition-transform group-hover:-translate-x-0.5"
          aria-hidden
        />
        {backLabel}
      </Link>

      {/* a11y: announce the live level/disposition as vitals change so a
          screen-reader user follows the loop without seeing the rail. */}
      <p className="sr-only" aria-live="polite" role="status">
        {`Acuity level ${tier.level}, ${tier.colour}, ${result.disposition}${result.provisional ? ", provisional" : ""}.`}
      </p>

      {/* Mobile/narrow (<lg): a STICKY LIVE HEADER so acuity + the score
          stay visible above the vitals — the loop survives without
          scrolling away from the result. Hidden once the right rail
          appears (lg+). */}
      <div className="glass border-border sticky top-0 z-20 -mx-4 mb-3 border-b px-4 py-2 sm:-mx-6 sm:px-6 lg:hidden">
        {compactAcuity}
      </div>

      {/* THREE ZONES (lg+): left context+next-steps · centre assessment ·
          right score. The left rail holds identity + live acuity + Resus
          + the live Next Steps (below the acuity anchor); the right rail
          is the live score. Both rails are sticky and scroll
          independently, so the core loop (enter vital → score moves →
          next steps update) needs no page scroll. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)_19rem] xl:grid-cols-[19rem_minmax(0,1fr)_21rem]">
        {/* LEFT — patient & context + Next Steps */}
        <aside className="flex flex-col gap-3 lg:sticky lg:top-[68px] lg:max-h-[calc(100vh-84px)] lg:self-start lg:overflow-y-auto">
          {identity}
          {/* The persistent live-acuity anchor (the sticky header already
              shows it below lg, so only render it in the rail at lg+). */}
          <div className="hidden lg:block">{compactAcuity}</div>
          <RapidRedButton
            intakeId={row.intakeId}
            patientUserId={row.patientUserId}
            patientLabel={name}
            openResusOnArrest={openResusOnArrest}
            resusBase={resusBase}
          />
          {/* Next Steps — beside the acuity/Resus, live (lg+). */}
          <div className="hidden lg:block">{nextSteps}</div>
        </aside>

        {/* CENTRE — the assessment (vitals + red-flags) + assign */}
        <div className="flex min-w-0 flex-col gap-4">
          {triageForm}
          {/* Below lg the score + next steps stack here, in the live loop
              order (score first, then guidance); at lg+ they live in the
              rails instead. */}
          <div className="flex flex-col gap-4 lg:hidden">
            {scores}
            {nextSteps}
          </div>
          {actionBar}
        </div>

        {/* RIGHT — live intelligence: the score (lg+). */}
        <aside className="hidden lg:sticky lg:top-[68px] lg:block lg:max-h-[calc(100vh-84px)] lg:self-start lg:overflow-y-auto">
          {scores}
        </aside>
      </div>
    </div>
  );
}

/* ─── worse-of distribution (segmented bar + legend) ──────────── */

function WorseOf({
  result,
  finalTier,
}: {
  result: ReturnType<typeof runTriage>;
  finalTier: (typeof ACUITY_TIERS)[number];
}) {
  const lanes = [
    {
      key: "score",
      label: "NEWS2",
      acuity: result.scoreAcuity,
      note: result.news2 ? `total ${result.news2.total}` : null,
    },
    {
      key: "flag",
      label: "Red-flag",
      acuity: result.discriminatorAcuity,
      note: result.firedDiscriminators[0]?.label ?? null,
    },
    {
      key: "esi",
      label: "ESI-v5",
      acuity: result.esiV5Acuity,
      note: result.incompleteVitals ? "incomplete vitals" : (result.dangerVitals[0] ?? null),
    },
  ] as const;
  // The winning lane is the most-acute fired track, computed independently
  // of result.level — so it still lights up when trend escalation or a
  // baseline temper moved the final level off every track.
  const winner = lanes.reduce<number | null>(
    (best, l) => (l.acuity != null && (best == null || l.acuity < best) ? l.acuity : best),
    null,
  );

  return (
    <Section title="Worse-of" hint="most acute lane wins">
      {/* Segmented distribution bar */}
      <div className="flex h-2.5 w-full gap-1 overflow-hidden rounded-full">
        {lanes.map((l) => {
          const laneTier =
            l.acuity != null ? ACUITY_TIERS.find((t) => t.level === l.acuity) : undefined;
          const isWinner = l.acuity != null && l.acuity === winner;
          return (
            <div
              key={l.key}
              className={cn(
                "h-full flex-1 rounded-full transition-[background-color,opacity] duration-300",
                laneTier ? SEG_FILL[laneTier.colour] : "bg-muted",
                laneTier && !isWinner && "opacity-30",
              )}
            />
          );
        })}
      </div>

      {/* Legend — one lane per row (no cramped 3-up truncation): a dot +
          label on the left, the lane's acuity chip on the right, the
          winner marked, and any note on its own muted sub-line. */}
      <div className="mt-3 flex flex-col gap-1">
        {lanes.map((l) => {
          const fired = l.acuity != null;
          const laneTier = fired ? ACUITY_TIERS.find((t) => t.level === l.acuity) : undefined;
          const isWinner = fired && l.acuity === winner;
          return (
            <div
              key={l.key}
              title={
                l.key === "esi" && result.dangerVitals.length
                  ? result.dangerVitals.join(" · ")
                  : undefined
              }
              className={cn(
                "flex flex-col gap-0.5 rounded-md px-1.5 py-1",
                isWinner && "bg-muted/40",
                !fired && "opacity-45",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    laneTier ? SEG_FILL[laneTier.colour] : "bg-muted-foreground/40",
                  )}
                />
                <span className="text-foreground/80 flex-1 text-[11.5px]">{l.label}</span>
                {isWinner ? (
                  <span className="text-muted-foreground/70 font-mono text-[8.5px] tracking-[0.1em] uppercase">
                    wins
                  </span>
                ) : null}
                <span
                  className={cn(
                    "inline-flex min-w-[26px] justify-center rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums",
                    fired && laneTier
                      ? COLOUR_CLASS[laneTier.colour]
                      : "text-muted-foreground/60 bg-muted/50",
                  )}
                >
                  {fired ? `L${l.acuity}` : "—"}
                </span>
              </div>
              {l.note ? (
                <span className="text-muted-foreground/70 line-clamp-1 pl-3.5 text-[10px]">
                  {l.note}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Equation — null-safe operands → the true final level. */}
      <div className="border-border/60 mt-3 flex items-center justify-between gap-3 border-t pt-2.5">
        <p className="text-muted-foreground font-mono text-[10.5px] tabular-nums">
          worse-of({result.scoreAcuity ?? "—"}, {result.discriminatorAcuity ?? "—"},{" "}
          {result.esiV5Acuity ?? "—"})
        </p>
        <span
          className={cn(
            "text-caption inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold tabular-nums",
            COLOUR_CLASS[finalTier.colour],
          )}
        >
          → L{finalTier.level}
        </span>
      </div>

      {/* Details — full engine reasoning, structured for readability:
          the NEWS2 per-parameter lines (engine-indented) nest as
          sub-rows; discriminator / worse-of lines get a marker. */}
      <details className="group mt-3">
        <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 font-mono text-[10px] tracking-[0.14em] uppercase">
          <ChevronRightIcon
            className="size-3 transition-transform group-open:rotate-90"
            aria-hidden
          />
          Details · why this level
        </summary>
        <div className="border-border/60 bg-muted/20 mt-2 flex flex-col gap-1.5 rounded-xl border p-3">
          {result.reasoning.map((line, i) => (
            <ReasoningLine key={i} line={line} />
          ))}
        </div>
      </details>

      {/* Non-blocking clinician flags */}
      {result.flags.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1">
          {result.flags.map((f, i) => (
            <p key={i} className="text-[11.5px] text-amber-700 dark:text-amber-300">
              ⚑ {f}
            </p>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

/**
 * One line of the engine's reasoning, rendered structurally:
 *  - engine-indented lines (NEWS2 per-parameter contributions) → a
 *    nested, dimmer sub-row with a hairline rail;
 *  - discriminator / worse-of / "raised"/"trend" lines → a marker dot;
 *  - everything else → a plain row. Pure formatting of an opaque string.
 */
function ReasoningLine({ line }: { line: string }) {
  const indented = /^\s{2,}/.test(line);
  const text = line.trim();
  if (indented) {
    return (
      <div className="border-border/50 ml-1.5 flex items-start gap-2 border-l pl-3">
        <span className="text-muted-foreground/80 font-mono text-[10.5px] leading-relaxed">
          {text}
        </span>
      </div>
    );
  }
  const isDecision =
    /^(worse-of|discriminator|raised|trend|baseline|esi v5|news2|meows|paediatric|cushing|modified shock|shock index|qsofa|glucose)/i.test(
      text,
    );
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden
        className={cn(
          "mt-[5px] size-1.5 shrink-0 rounded-full",
          isDecision ? "bg-mint-500/70" : "bg-border",
        )}
      />
      <span className="text-foreground/85 text-[11.5px] leading-relaxed">{text}</span>
    </div>
  );
}

/* ─── presentational primitives ───────────────────────────────── */

function ruleToPop(ruleset: string): "adult" | "paediatric" | "obstetric" {
  if (ruleset === "paediatric_pews") return "paediatric";
  if (ruleset === "obstetric_meows") return "obstetric";
  return "adult";
}

/** ⓘ-headed section, reference-style, with optional hint + control. */
function Section({
  title,
  hint,
  control,
  children,
}: {
  title: string;
  hint?: string;
  control?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-foreground/80 flex items-center gap-1 text-[12px] font-medium">
          {title}
          <InfoIcon className="text-muted-foreground/50 size-3" aria-hidden />
        </h3>
        <div className="flex items-center gap-2">
          {hint ? (
            <span className="text-muted-foreground/70 font-mono text-[10px] tracking-wide">
              {hint}
            </span>
          ) : null}
          {control}
        </div>
      </div>
      {children}
    </section>
  );
}

/** The shared tile shell — calm when normal, loudly tinted (coloured
 *  border + ground + ring) when the tone deviates, so a warning is
 *  unmistakable. No left-edge accent bar (user preference). */
function tileShell(tone: VitalTone, extra?: string): string {
  return cn(
    "relative flex min-h-[68px] flex-col gap-0.5 rounded-xl border px-3 pt-2 pb-2 transition-colors duration-150",
    TILE_TONE[tone],
    extra,
  );
}

function TileLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
      {children}
    </span>
  );
}

/** A delta pill — shown only for a positive NEWS2 contribution. */
function DeltaPill({ i, mod }: { i: VitalInterpretation; mod?: boolean }) {
  if (i.points == null || i.points <= 0) return null;
  return (
    <span
      className={cn(
        "scale-in inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
        PILL_TINT[i.tone],
      )}
    >
      +{i.points}
      {mod ? <span className="opacity-70">mod</span> : null}
    </span>
  );
}

/** An editable vital metric tile. */
function VitalTile({
  label,
  unit,
  v,
  set,
  i,
}: {
  label: string;
  unit: string;
  v: string;
  set: (x: string) => void;
  i: VitalInterpretation;
}) {
  return (
    <div
      className={cn(
        tileShell(i.tone),
        "focus-within:border-mint-500 focus-within:ring-mint-500/20 dark:focus-within:border-mint-400 focus-within:ring-2",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <TileLabel>{label}</TileLabel>
        <DeltaPill i={i} />
      </div>
      <div className="flex items-baseline gap-1">
        <input
          inputMode="decimal"
          value={v}
          onChange={(e) => set(e.target.value)}
          placeholder="—"
          aria-label={label}
          className={cn(
            "placeholder:text-muted-foreground/40 text-heading-m -ml-0.5 w-full min-w-0 bg-transparent font-mono leading-none font-semibold tracking-[-0.02em] tabular-nums outline-none",
            VALUE_TONE[i.tone],
          )}
        />
        <span className="text-muted-foreground/70 shrink-0 font-mono text-[10px]">{unit}</span>
      </div>
      <span className={cn("line-clamp-1 text-[10.5px] font-medium", TONE_CHIP[i.tone])}>
        {toneGlyph(i.tone)}
        {subLabel(i.label)}
      </span>
    </div>
  );
}

/** A leading warning glyph for a deviating tone (none when normal). */
function toneGlyph(tone: VitalTone): string {
  if (tone === "critical") return "▲ ";
  if (tone === "abnormal") return "▲ ";
  if (tone === "borderline") return "△ ";
  return "";
}

/** A select-backed tile (oxygen / consciousness) — same skin, chevron pill. */
function SelectTile({
  label,
  value,
  display,
  onChange,
  options,
  i,
}: {
  label: string;
  value: string;
  display: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
  i: VitalInterpretation;
}) {
  const isMod = label.startsWith("Air");
  return (
    <div
      className={cn(
        tileShell(i.tone),
        "focus-within:border-mint-500 dark:focus-within:border-mint-400",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <TileLabel>{label}</TileLabel>
        <DeltaPill i={i} mod={isMod} />
      </div>
      <div className="relative flex items-center">
        <span className="text-foreground font-mono text-[16px] leading-none font-semibold">
          {display}
        </span>
        <ChevronDownIcon className="text-muted-foreground/50 ml-1 size-3.5" aria-hidden />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {options.map(([val, lbl]) => (
            <option key={val} value={val}>
              {lbl}
            </option>
          ))}
        </select>
      </div>
      <span className={cn("text-caption line-clamp-1", TONE_CHIP[i.tone])}>
        {subLabel(i.label)}
      </span>
    </div>
  );
}

/** A read-only derived-metric tile (shock index / qSOFA / MAP). */
function DerivedTile({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: string | null;
  unit?: string;
  sub: string;
  tone: VitalTone;
}) {
  const missing = value == null;
  const t: VitalTone = missing ? "missing" : tone;
  return (
    <div className={tileShell(t)}>
      <div className="flex items-start justify-between gap-2">
        <TileLabel>{label}</TileLabel>
      </div>
      {missing ? (
        <span className="text-muted-foreground/60 text-body-m font-mono italic">Not recorded</span>
      ) : (
        <div className="flex items-baseline gap-1">
          <span className="text-foreground text-heading-s font-mono leading-none font-semibold tabular-nums">
            {value}
          </span>
          {unit ? (
            <span className="text-muted-foreground/70 shrink-0 font-mono text-[10px]">{unit}</span>
          ) : null}
        </div>
      )}
      <span className={cn("text-caption line-clamp-1", TONE_CHIP[t])}>{sub}</span>
    </div>
  );
}

/** A read-only info tile (age, pregnancy-N/A). */
function ReadTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className={tileShell("normal")}>
      <TileLabel>{label}</TileLabel>
      <div className="flex items-baseline gap-1">
        <span className="text-foreground text-heading-s font-mono leading-none font-semibold tabular-nums">
          {value}
        </span>
      </div>
      {unit ? <span className="text-muted-foreground/70 text-caption">{unit}</span> : null}
    </div>
  );
}

/** A select-backed tile styled as a pill control (pregnancy). */
function PillSelectTile({
  label,
  value,
  display,
  onChange,
  options,
}: {
  label: string;
  value: string;
  display: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div
      className={cn(
        tileShell("normal"),
        "focus-within:border-mint-500 dark:focus-within:border-mint-400",
      )}
    >
      <TileLabel>{label}</TileLabel>
      <div className="relative flex items-center">
        <span className="text-foreground text-heading-s font-mono leading-none font-semibold">
          {display}
        </span>
        <ChevronDownIcon className="text-muted-foreground/50 ml-1 size-3.5" aria-hidden />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {options.map(([val, lbl]) => (
            <option key={val} value={val}>
              {lbl}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Pill toggle control (SpO₂ scale). */
function PillToggle({
  active,
  onClick,
  on,
  off,
}: {
  active: boolean;
  onClick: () => void;
  on: string;
  off: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-wide transition-colors",
        active
          ? "border-mint-500/50 bg-mint-50 text-mint-700 dark:bg-mint-950/30 dark:text-mint-300"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
      title="SpO₂ Scale 2 — confirmed hypercapnic / COPD target 88–92%"
    >
      {active ? on : off}
      <ChevronDownIcon className="size-3" aria-hidden />
    </button>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-2 text-[12px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-mint-600 mt-0.5 size-3.5"
      />
      <span className="text-foreground/90">{children}</span>
    </label>
  );
}
