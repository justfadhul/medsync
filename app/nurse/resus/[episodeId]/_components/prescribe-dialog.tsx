"use client";

import type { Requirement } from "@/lib/doctor/capabilities";
import type { PrescriptionEdit, PrescriptionOption, SafetyFlag } from "@/lib/prescribing/engine";
import type { TimelineEvent } from "@/lib/resus/types";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangleIcon, InfoIcon, PencilIcon, ShieldAlertIcon, XIcon } from "lucide-react";

import {
  priorAdministrationsFromTimeline,
  recordedAllergiesFromTimeline,
} from "@/lib/prescribing/administration";
import { mergeAllergyLists } from "@/lib/prescribing/allergy-merge";
import {
  prescriptionRequiresOverride,
  resolvePrescriptionOptions,
  runSafetyChecks,
} from "@/lib/prescribing/engine";
import { cn } from "@/lib/utils";
import {
  loadPersistentAllergiesForEpisode,
  recordEmergencyAdministration,
  recordResusAllergies,
} from "../../actions";

/** This cadre's prescribing authority (cosign policy) for the two prescription
 *  kinds. In an emergency it NEVER hard-blocks — a non-prescriber administers
 *  under the resus protocol; the dialog flags it + the record attributes it. */
export interface PrescribeAuthority {
  routine: Requirement;
  controlled: Requirement;
}

const ROUTE_OPTIONS = [
  "iv",
  "io",
  "im",
  "sc",
  "oral",
  "inhaled",
  "nebulised",
  "pr",
  "buccal",
  "sublingual",
  "intranasal",
  "infusion",
  "ett",
] as const;

const SEVERITY_STYLE: Record<
  SafetyFlag["severity"],
  { token: string; icon: typeof InfoIcon; word: string }
> = {
  block: {
    token: "border-rose-500/70 bg-rose-50/70 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200",
    icon: ShieldAlertIcon,
    word: "Blocker",
  },
  warn: {
    token:
      "border-amber-400/70 bg-amber-50/70 text-amber-900 dark:bg-amber-950/25 dark:text-amber-200",
    icon: AlertTriangleIcon,
    word: "Check",
  },
  info: {
    token: "border-border bg-muted/40 text-muted-foreground",
    icon: InfoIcon,
    word: "Note",
  },
};

/** A field the prescriber can edit, with its current value, default, and setter. */
interface EditState {
  drugId: string;
  doseMg?: number;
  dose?: string;
  route?: string;
  concentration?: string;
  interval?: string;
  duration?: string;
  volume?: string;
  rate?: string;
  prn?: boolean;
  notes?: string;
}

/**
 * Bedside smart-prescribing dialog (GATE D + the editable-parameters addendum).
 * A resus recommendation resolves to pre-filled option(s); the clinician reviews
 * the dose/concentration + the safety flags → optionally EDITS the parameters
 * (dose/route/concentration/frequency/duration/volume/rate/PRN) → confirms. The
 * safety checks RE-RUN live on every edit (editing is NOT a bypass): an out-of-
 * range dose warns, far-out blocks (override + reason), egregiously-out needs a
 * typed confirmation — never a hard block in a time-critical resus. The
 * guideline default, the edited values, every edit + any override are recorded.
 */
export function PrescribeDialog({
  episodeId,
  recCode,
  recLabel,
  patientAgeYears,
  prescribeAuthority,
  timeline,
  onClose,
  onDone,
  reasons,
}: {
  episodeId: string;
  recCode: string;
  recLabel: string;
  /** Why a one-tap entry was not logged (the fast path's block) — amber, never red. */
  reasons?: string[];
  patientAgeYears: number | null;
  prescribeAuthority: PrescribeAuthority;
  timeline: TimelineEvent[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [weightKg, setWeightKg] = useState<string>("");
  const [selected, setSelected] = useState(0);
  const [overrideReason, setOverrideReason] = useState("");
  const [witness, setWitness] = useState("");
  const [allergyDraft, setAllergyDraft] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [ed, setEd] = useState<EditState>({ drugId: "" });
  const [typedConfirm, setTypedConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The record's allergies (every hospital under EMR v1) — guarded server side, so empty until
  // the engine is live. A failed load is SAID, never silently replaced by an empty list; the
  // server re-runs the allergy check on confirm whatever this dialog shows.
  const [persistent, setPersistent] = useState<{ allergies: string[]; recorded: boolean }>({
    allergies: [],
    recorded: false,
  });
  const [allergyLoadFailed, setAllergyLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    loadPersistentAllergiesForEpisode(episodeId)
      .then((a) => {
        if (active) setPersistent(a);
      })
      .catch(() => {
        if (active) setAllergyLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [episodeId]);

  const allergies = useMemo(
    () => mergeAllergyLists(recordedAllergiesFromTimeline(timeline), persistent.allergies),
    [timeline, persistent],
  );
  const priors = useMemo(() => priorAdministrationsFromTimeline(timeline), [timeline]);
  const allergyKnown = useMemo(
    () =>
      persistent.recorded ||
      timeline.some((e) => (e.payload as { allergyCapture?: unknown }).allergyCapture),
    [timeline, persistent],
  );

  const patient = useMemo(
    () => ({
      ageYears: patientAgeYears,
      weightKg: weightKg ? Number(weightKg) : null,
      allergies,
      conditions: [] as string[],
    }),
    [patientAgeYears, weightKg, allergies],
  );

  const options: PrescriptionOption[] = useMemo(
    () => resolvePrescriptionOptions(recCode, patient, priors),
    [recCode, patient, priors],
  );

  if (options.length === 0) return null;
  const opt = options[Math.min(selected, options.length - 1)]!;
  const drug = opt.drug;
  const isEd = ed.drugId === drug.id; // edits belong to the selected drug only

  // Effective (edited-or-default) values.
  const defDoseMg = drug.unitDoseMg ?? null;
  const defDose = drug.adult?.dose ?? (drug.recordOnly ? "operator-dosed (record-only)" : "—");
  const defConc = drug.adult?.concentration ?? null;
  const defRoute = drug.adult?.route[0] ?? null;
  const defInterval = drug.adult?.interval ?? null;
  // A numeric mg dose field is shown for drugs with a single unitDoseMg AND for
  // fixed-regimen drugs carrying a doseRangeMg (so an edited mg reaches the
  // engine's range guard — without it the dose stays free text and is unchecked).
  const doseRange = drug.doseRangeMg ?? null;
  const numericDose = defDoseMg != null || doseRange != null;

  const effDoseMg = isEd && ed.doseMg != null ? ed.doseMg : defDoseMg;
  const effRoute = (isEd && ed.route) || defRoute;
  const effConc = (isEd && ed.concentration != null ? ed.concentration : defConc) || null;
  const effInterval = (isEd && ed.interval != null ? ed.interval : defInterval) || null;
  // The recorded dose string: an entered mg renders "<mg> mg"; otherwise the
  // drug's free-text default (range drugs default to free text until a mg is typed).
  const effDose = effDoseMg != null ? `${effDoseMg} mg` : (isEd && ed.dose) || defDose;

  // Live safety re-check against the EDITED values (editing ≠ bypass).
  const edit: PrescriptionEdit | undefined = isEd
    ? {
        doseMg: ed.doseMg != null && ed.doseMg !== defDoseMg ? ed.doseMg : undefined,
        route: ed.route && ed.route !== defRoute ? ed.route : undefined,
        concentration:
          ed.concentration != null && ed.concentration !== defConc ? ed.concentration : undefined,
      }
    : undefined;
  // Live re-check (pure + cheap) — recomputed every render so edits re-run the
  // checks immediately. Plain const (after the early return) to keep hook order.
  const liveFlags = runSafetyChecks({ drug, patient, priorAdministrations: priors, edit });

  const authReq = drug.controlled ? prescribeAuthority.controlled : prescribeAuthority.routine;
  const authorityFlag: SafetyFlag | null =
    authReq === "blocked"
      ? {
          code: "controlled",
          severity: "warn",
          message:
            "You are not an authorised prescriber for this drug — recording as administered under the resus protocol. A prescriber should authorise / witness.",
          overrideable: true,
        }
      : authReq === "cosign_required"
        ? {
            code: "controlled",
            severity: "info",
            message:
              "This prescription needs a prescriber co-sign — record the prescriber as witness.",
            overrideable: true,
          }
        : null;
  const displayFlags = authorityFlag ? [...liveFlags, authorityFlag] : liveFlags;

  const blockFlags = liveFlags.filter((f) => f.severity === "block");
  const needsOverride = prescriptionRequiresOverride(liveFlags);
  const egregious = liveFlags.some((f) => f.egregious);
  const needsWitness = drug.controlled;
  const typedOk =
    !egregious ||
    (effDoseMg != null && typedConfirm.trim() !== "" && Number(typedConfirm) === effDoseMg);
  const canConfirm =
    !pending &&
    typedOk &&
    (!needsOverride || overrideReason.trim().length >= 3) &&
    (!needsWitness || witness.trim().length >= 2);

  // Build the field-level edit log (edited → default) for the record.
  function buildEdits(): { field: string; from: string; to: string }[] {
    if (!isEd) return [];
    const out: { field: string; from: string; to: string }[] = [];
    if (defDoseMg != null && ed.doseMg != null && ed.doseMg !== defDoseMg)
      out.push({ field: "dose", from: `${defDoseMg} mg`, to: `${ed.doseMg} mg` });
    // Range drug (no single default mg): a typed mg is itself a deviation from the
    // free-text guideline default — log it from the default dose string.
    if (defDoseMg == null && doseRange != null && ed.doseMg != null)
      out.push({ field: "dose", from: defDose, to: `${ed.doseMg} mg` });
    if (defDoseMg == null && doseRange == null && ed.dose && ed.dose !== defDose)
      out.push({ field: "dose", from: defDose, to: ed.dose });
    if (ed.route && ed.route !== defRoute)
      out.push({ field: "route", from: defRoute ?? "—", to: ed.route });
    if (ed.concentration != null && ed.concentration !== (defConc ?? ""))
      out.push({ field: "concentration", from: defConc ?? "—", to: ed.concentration });
    if (ed.interval != null && ed.interval !== (defInterval ?? ""))
      out.push({ field: "interval", from: defInterval ?? "—", to: ed.interval });
    if (ed.duration) out.push({ field: "duration", from: "—", to: ed.duration });
    if (ed.volume) out.push({ field: "volume", from: "—", to: ed.volume });
    if (ed.rate) out.push({ field: "rate", from: "—", to: ed.rate });
    if (ed.prn) out.push({ field: "prn", from: "scheduled", to: "PRN" });
    if (ed.notes) out.push({ field: "notes", from: "—", to: ed.notes });
    return out;
  }

  function setField<K extends keyof EditState>(field: K, value: EditState[K]) {
    setEd((prev) => {
      const base = prev.drugId === drug.id ? prev : { drugId: drug.id };
      return { ...base, drugId: drug.id, [field]: value };
    });
  }

  function captureAllergies(nkda: boolean) {
    startTransition(async () => {
      const substances = nkda
        ? []
        : allergyDraft
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      await recordResusAllergies({ episodeId, substances, nkda });
      setAllergyDraft("");
      onDone();
    });
  }

  function confirm() {
    if (!canConfirm) return;
    const edits = buildEdits();
    startTransition(async () => {
      const res = await recordEmergencyAdministration({
        episodeId,
        drugId: drug.id,
        route: effRoute ?? undefined,
        amountMg: effDoseMg ?? undefined,
        dose: effDose,
        concentration: effConc ?? undefined,
        interval: effInterval ?? undefined,
        duration: isEd ? ed.duration : undefined,
        volume: isEd ? ed.volume : undefined,
        rate: isEd ? ed.rate : undefined,
        prn: isEd ? ed.prn : undefined,
        notes: isEd ? ed.notes : undefined,
        edits,
        witnessName: needsWitness ? witness.trim() : undefined,
        overrideReason: needsOverride ? overrideReason.trim() : undefined,
        overriddenFlags: needsOverride ? blockFlags.map((f) => f.code) : undefined,
      });
      if ("error" in res) {
        setError(res.error ?? "Failed to record — please retry.");
      } else {
        onDone();
        onClose();
      }
    });
  }

  const fieldEdited = (field: keyof EditState) => isEd && ed[field] != null && ed[field] !== "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Prescribe — ${recLabel}`}
    >
      <div className="border-border bg-card scale-in flex max-h-[92svh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="text-muted-foreground/70 font-mono text-[10px] tracking-[0.14em] uppercase">
              Prescribe / record
            </p>
            <h2 className="text-foreground text-body-m truncate font-semibold">{recLabel}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded-md p-1"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
          {reasons && reasons.length > 0 ? (
            <p className="text-body-s rounded-md border border-amber-400/70 bg-amber-50/70 px-3 py-2 text-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
              <span className="font-medium">One tap was not logged:</span> {reasons.join(" · ")}
            </p>
          ) : null}
          {/* Option picker (e.g. hydrocortisone IV vs prednisolone PO) */}
          {options.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {options.map((o, i) => (
                <button
                  key={o.drug.id}
                  type="button"
                  onClick={() => {
                    setSelected(i);
                    setTypedConfirm("");
                  }}
                  className={cn(
                    "tap rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors",
                    i === selected
                      ? "border-foreground/30 bg-foreground/90 text-background font-medium"
                      : "border-border bg-muted/30 text-foreground/80 hover:bg-muted/60",
                  )}
                >
                  {o.drug.name}
                </button>
              ))}
            </div>
          ) : null}

          {/* The resolved drug — effective dose/concentration (edited shown vs default) */}
          <div className="border-border bg-muted/20 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-foreground text-[14px] font-semibold">{drug.name}</p>
              {drug.adult ? (
                <button
                  type="button"
                  onClick={() => setAdjusting((a) => !a)}
                  className="tap text-muted-foreground hover:text-foreground border-border inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px]"
                >
                  <PencilIcon className="size-3" aria-hidden />
                  {adjusting ? "Done" : "Adjust"}
                </button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-caption">
              {drug.drugClass} · T-{drug.tier.replace(/_/g, " ")}
            </p>
            {drug.adult ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                <dt className="text-muted-foreground/70">Dose</dt>
                <dd className="text-foreground font-mono font-semibold tabular-nums">
                  {effDose}
                  {(fieldEdited("doseMg") || fieldEdited("dose")) && (
                    <span className="text-muted-foreground/60 ml-1.5 font-sans text-[10.5px] font-normal line-through">
                      {defDose}
                    </span>
                  )}
                </dd>
                <dt className="text-muted-foreground/70">Concentration</dt>
                <dd className="text-foreground font-mono tabular-nums">{effConc ?? "—"}</dd>
                <dt className="text-muted-foreground/70">Route</dt>
                <dd className="text-foreground font-mono uppercase">
                  {effRoute ?? "—"}
                  {fieldEdited("route") && defRoute ? (
                    <span className="text-muted-foreground/60 ml-1.5 lowercase line-through">
                      {defRoute}
                    </span>
                  ) : null}
                </dd>
                <dt className="text-muted-foreground/70">Interval</dt>
                <dd className="text-foreground/90">{effInterval ?? "—"}</dd>
                <dt className="text-muted-foreground/70">Max</dt>
                <dd className="text-foreground/90">{drug.adult.max}</dd>
              </dl>
            ) : (
              <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
                {drug.recordOnly
                  ? "Record-only — the skilled operator doses; record what was given."
                  : "Category-level — the clinician doses (no fixed surface dose)."}
              </p>
            )}
            <p className="text-muted-foreground/60 mt-2 font-mono text-[10px]">{drug.source}</p>
          </div>

          {/* Adjust parameters — safety checks re-run live on every edit */}
          {adjusting && drug.adult ? (
            <div className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3">
              <p className="text-muted-foreground/70 font-mono text-[10px] tracking-[0.14em] uppercase">
                Adjust parameters — safety re-checks live
              </p>
              <div className="grid grid-cols-2 gap-2">
                {numericDose ? (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-[10.5px]">
                      Dose (mg)
                      {doseRange ? (
                        <span className="text-muted-foreground/60">
                          {" "}
                          · usual{" "}
                          {doseRange.low === doseRange.high
                            ? doseRange.low
                            : `${doseRange.low}–${doseRange.high}`}
                        </span>
                      ) : null}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={effDoseMg ?? ""}
                      placeholder={
                        doseRange
                          ? doseRange.low === doseRange.high
                            ? String(doseRange.low)
                            : `${doseRange.low}–${doseRange.high}`
                          : undefined
                      }
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setField(
                          "doseMg",
                          e.target.value === "" || !Number.isFinite(n) ? undefined : n,
                        );
                      }}
                      className="border-border bg-card text-foreground rounded-md border px-2 py-1 font-mono text-[12.5px] tabular-nums outline-none"
                    />
                  </label>
                ) : (
                  <label className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-[10.5px]">Dose</span>
                    <input
                      value={effDose === defDose ? (ed.dose ?? "") : effDose}
                      placeholder={defDose}
                      onChange={(e) => setField("dose", e.target.value)}
                      className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12.5px] outline-none"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10.5px]">Route</span>
                  <select
                    value={effRoute ?? ""}
                    onChange={(e) => setField("route", e.target.value)}
                    className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12.5px] uppercase outline-none"
                  >
                    {ROUTE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10.5px]">Concentration</span>
                  <input
                    value={effConc ?? ""}
                    onChange={(e) => setField("concentration", e.target.value)}
                    className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10.5px]">Frequency / interval</span>
                  <input
                    value={effInterval ?? ""}
                    onChange={(e) => setField("interval", e.target.value)}
                    className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10.5px]">Duration / course</span>
                  <input
                    value={ed.duration ?? ""}
                    onChange={(e) => setField("duration", e.target.value)}
                    className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10.5px]">Volume</span>
                  <input
                    value={ed.volume ?? ""}
                    onChange={(e) => setField("volume", e.target.value)}
                    className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10.5px]">Rate</span>
                  <input
                    value={ed.rate ?? ""}
                    onChange={(e) => setField("rate", e.target.value)}
                    className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none"
                  />
                </label>
                <label className="col-span-2 flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={ed.prn ?? false}
                    onChange={(e) => setField("prn", e.target.checked)}
                  />
                  <span className="text-muted-foreground">
                    PRN (as required) instead of scheduled
                  </span>
                </label>
                <label className="col-span-2 flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10.5px]">Notes</span>
                  <input
                    value={ed.notes ?? ""}
                    onChange={(e) => setField("notes", e.target.value)}
                    className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {/* Allergy gate — must be surfaced before confirm */}
          {allergyLoadFailed ? (
            <p
              role="alert"
              className="bg-status-caution-bg text-status-caution-fg flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium"
            >
              <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden />
              Allergies could not be loaded — check before giving
            </p>
          ) : null}
          {!allergyKnown ? (
            <div className="rounded-xl border border-amber-400/70 bg-amber-50/60 p-3 dark:bg-amber-950/20">
              <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">
                Allergies not yet recorded — check before giving.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input
                  value={allergyDraft}
                  onChange={(e) => setAllergyDraft(e.target.value)}
                  placeholder="e.g. penicillin, peanut"
                  className="border-border bg-card text-foreground min-w-0 flex-1 rounded-md border px-2 py-1 text-[12px] outline-none"
                />
                <button
                  type="button"
                  disabled={pending || !allergyDraft.trim()}
                  onClick={() => captureAllergies(false)}
                  className="tap bg-mint-600 rounded-md px-2 py-1 text-[11.5px] font-semibold text-white disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => captureAllergies(true)}
                  className="tap border-border rounded-md border px-2 py-1 text-[11.5px] disabled:opacity-50"
                >
                  No known allergies
                </button>
              </div>
            </div>
          ) : allergies.length > 0 ? (
            <p className="text-[11.5px] text-rose-700 dark:text-rose-300">
              ⚠ Recorded allergies: {allergies.join(", ")}
            </p>
          ) : (
            <p className="text-muted-foreground text-[11.5px]">✓ NKDA recorded</p>
          )}

          {/* Paediatric weight capture */}
          {patientAgeYears != null && patientAgeYears < 16 ? (
            <label className="flex items-center gap-2 text-[12px]">
              <span className="text-muted-foreground">Weight (kg) — paediatric</span>
              <input
                type="number"
                inputMode="decimal"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                className="border-border bg-card text-foreground w-20 rounded-md border px-2 py-1 font-mono tabular-nums outline-none"
              />
            </label>
          ) : null}

          {/* Safety flags (re-computed live against edits) */}
          {displayFlags.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {displayFlags.map((f, i) => {
                const s = SEVERITY_STYLE[f.severity];
                const Icon = s.icon;
                return (
                  <div
                    key={`${f.code}-${i}`}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-2.5 py-1.5",
                      s.token,
                    )}
                  >
                    <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <p className="text-[11.5px] leading-snug">
                      <span className="font-semibold">{s.word}:</span> {f.message}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Typed confirmation for an egregiously out-of-range edited dose */}
          {egregious && effDoseMg != null ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] font-semibold text-rose-700 dark:text-rose-300">
                Dangerously out of range — type the dose ({effDoseMg}) to confirm you intend it
              </span>
              <input
                value={typedConfirm}
                onChange={(e) => setTypedConfirm(e.target.value)}
                inputMode="decimal"
                className="border-border bg-card text-foreground w-32 rounded-md border px-2 py-1 font-mono tabular-nums outline-none"
                placeholder={String(effDoseMg)}
              />
            </label>
          ) : null}

          {/* Override reason (required if a blocker) */}
          {needsOverride ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] font-semibold text-rose-700 dark:text-rose-300">
                Override reason (recorded + audited) — required
              </span>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={2}
                className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none"
                placeholder="Clinical justification to proceed despite the blocker"
              />
            </label>
          ) : null}

          {/* Witness (required for controlled drugs) */}
          {needsWitness ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] font-semibold">
                Controlled drug — witness name/ID (required)
              </span>
              <input
                value={witness}
                onChange={(e) => setWitness(e.target.value)}
                className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-[12px] outline-none"
                placeholder="Witnessing clinician"
              />
            </label>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-border flex items-center justify-between gap-2 border-t px-4 py-3">
          {error ? (
            <p className="text-[10.5px] font-medium text-rose-700 dark:text-rose-300">⚠ {error}</p>
          ) : (
            <p className="text-muted-foreground/70 text-[10.5px]">
              Records as administered (grab-and-give) on the resus timeline.
            </p>
          )}
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="tap border-border text-foreground/80 rounded-lg border px-3 py-1.5 text-[12.5px]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={confirm}
              className={cn(
                "tap rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors disabled:opacity-50",
                needsOverride ? "bg-rose-600 hover:bg-rose-700" : "bg-mint-600 hover:bg-mint-700",
              )}
            >
              {needsOverride ? "Override + record" : "Confirm + record"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
