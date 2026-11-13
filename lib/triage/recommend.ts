import type { AcuityLevel, TriageResult } from "./types";

/**
 * Triage recommendations — SUGGESTIONS, NOT ORDERS (GATE A, CSO-approved
 * defaults 2026-06-01). A pure, deterministic mapping from a triage
 * finding → general, guideline-derived suggested next actions across
 * seven categories. It invents nothing: every suggestion cites the
 * guideline + threshold it derives from; if a finding has no traceable
 * basis, no suggestion is produced.
 *
 * HARD RULES (clinical-safety):
 *   - Category-level ONLY. No drug doses, fluid volumes, or definitive
 *     treatment. A unit test (recommend.test.ts) rejects dose/volume
 *     tokens in any suggestion string.
 *   - Nothing auto-executes. Each suggestion carries seam = 'live'
 *     (a built surface exists — urgent appointment / care-team notify)
 *     or 'pending_intent' (recorded for the future workflow build).
 *   - Bias to over-escalation; never under.
 *   - Recompute on override: pass the clinician's assignedLevel so the
 *     suggestions follow the final call, not the superseded computed one.
 *
 * docs/triage-recommendations-gate-a.md is the signed mapping this
 * implements; ADR 0041 records it as a clinical-safety artifact.
 */

export type RecommendationCategory =
  | "disposition"
  | "immediate_measure"
  | "monitoring"
  | "escalation"
  | "pathway_flag"
  | "onward_routing"
  | "investigation";

export type RecommendationSeam = "live" | "pending_intent";
export type RecommendationConfidence = "high" | "medium" | "needs_cso_input";

export interface Recommendation {
  /** Stable machine code, e.g. "disp_resus", "pathway_sepsis". */
  code: string;
  category: RecommendationCategory;
  /** The category-level human string shown (NO doses/volumes/agents). */
  suggestion: string;
  /** Why — surfaced to the clinician. */
  rationale: string;
  /** Guideline + threshold it derives from. */
  source: string;
  seam: RecommendationSeam;
  confidence: RecommendationConfidence;
  /**
   * Only on `monitor_interval`: the band the sentence above already names, typed (GATE A D-CF-20, a
   * projection of the same branches, no rule change). The clinic floor reads it for the re-check list.
   */
  recheck?: RecheckBand;
}

/** The monitoring bands `monitoringRec` already chooses between, by name. */
export type RecheckBand = "continuous" | "hourly" | "4-6h" | "12h" | "short";

/**
 * When a re-check falls due on an outpatient floor, in minutes after the last check (GATE A D-CF-20): the
 * bands that say "at minimum hourly". Longer bands outlast a clinic visit and are not listed.
 */
export const RECHECK_DUE_MINUTES: Partial<Record<RecheckBand, number>> = {
  continuous: 60,
  hourly: 60,
};

const CAT_ORDER: RecommendationCategory[] = [
  "disposition",
  "pathway_flag",
  "escalation",
  "immediate_measure",
  "monitoring",
  "investigation",
  "onward_routing",
];

/**
 * Build the suggested next actions for a triage finding.
 *
 * @param result        the deterministic engine output
 * @param assignedLevel the clinician's final level (defaults to computed);
 *                      pass the override so suggestions recompute to match.
 */
export function recommend(result: TriageResult, assignedLevel?: AcuityLevel): Recommendation[] {
  const level = assignedLevel ?? result.level;
  const recs: Recommendation[] = [];
  const fired = new Set(result.firedDiscriminators.map((d) => d.code));
  const ruleset = result.ruleset;
  const isObstetric = ruleset === "obstetric_meows";
  const isPaediatric = ruleset === "paediatric_pews";
  const provisionalPop = isObstetric || isPaediatric;

  /* ── 1. Disposition (mapped from the FINAL level) ─────────────── */
  const DISPO: Record<AcuityLevel, { suggestion: string; rationale: string }> = {
    1: {
      suggestion: "Place in the resuscitation area now — highest-acuity bed, team present.",
      rationale: "Level 1 needs immediate life-saving intervention; no waiting room.",
    },
    2: {
      suggestion: "Place in the high-acuity / monitored area for time-critical review.",
      rationale: "Level 2 is high-risk for deterioration; needs a monitored space within ~10 min.",
    },
    3: {
      suggestion: "Place in the standard assessment area for prompt clinician review.",
      rationale: "Urgent but stable; needs timely assessment, not a monitored resus bed.",
    },
    4: {
      suggestion: "Stream to standard / fast-track (ambulatory) care.",
      rationale: "Less-urgent and fully assessed; safe for the fast-track stream.",
    },
    5: {
      suggestion: "Stream to fast-track or the virtual / primary-care pathway.",
      rationale: "Non-urgent with complete vitals and no red flags.",
    },
  };
  // The down-disposition gate (CSO-signed): never suggest a reassuring
  // L4/L5 stream on incomplete/provisional data — hold at standard.
  const downGateBlocked =
    level >= 4 && (result.incompleteVitals || result.provisional || fired.size > 0);
  const dispoLevel: AcuityLevel = downGateBlocked ? 3 : level;
  recs.push({
    code: `disp_l${dispoLevel}`,
    category: "disposition",
    suggestion: downGateBlocked
      ? `Hold at the standard assessment area — do not down-stream on incomplete/flagged data. ${DISPO[3].suggestion}`
      : DISPO[dispoLevel].suggestion,
    rationale: downGateBlocked
      ? "A reassuring stream may not be issued while vitals are incomplete or a red-flag fired (ESI v5 + bias-up)."
      : DISPO[dispoLevel].rationale,
    source:
      "5-tier acuity model (research doc §1); ESI v5 disposition (ENA 2023); SATS target times.",
    seam: level <= 2 ? "live" : "pending_intent",
    confidence: provisionalPop ? "needs_cso_input" : "high",
  });

  /* ── 2. Pathway flags (named, flag-only) ──────────────────────── */
  const sepsisInfection = fired.has("sepsis_suspicion");
  const qsofaPositive = (result.derived.qsofa?.score ?? 0) >= 2;
  const news2High = (result.news2?.total ?? 0) >= 5;
  if (sepsisInfection && (qsofaPositive || news2High)) {
    recs.push({
      code: "pathway_sepsis",
      category: "pathway_flag",
      suggestion: "Criteria suggest the SEPSIS pathway — consider activating (clinician decision).",
      rationale:
        "Infection + physiological derangement is time-critical; early recognition saves lives.",
      source: "Sepsis-3 (qSOFA≥2) + SSC 2021 (NEWS2≥5 as the preferred screen).",
      seam: "pending_intent",
      confidence: "high",
    });
  } else if (qsofaPositive) {
    recs.push({
      code: "screen_sepsis",
      category: "pathway_flag",
      suggestion:
        "qSOFA positive — consider an infection source; if suspected, the sepsis pathway applies.",
      rationale:
        "qSOFA≥2 is a poor-prognosis marker but not a sepsis diagnosis on its own (Sepsis-3).",
      source: "Sepsis-3 (qSOFA is an overlay, not a screen); SSC 2021.",
      seam: "pending_intent",
      confidence: "high",
    });
  }
  if (result.derived.glucoseFlag === "hyperglycaemia_dka_screen") {
    recs.push({
      code: "screen_dka",
      category: "pathway_flag",
      suggestion:
        "Glucose > 15 — check ketones and acid-base; if positive, the DKA pathway applies.",
      rationale: "Hyperglycaemia alone is not DKA; ketones + acidosis are needed to confirm.",
      source: "JBDS DKA criteria (glucose >11 + ketones + acidosis).",
      seam: "pending_intent",
      confidence: "high",
    });
  }
  if (fired.has("focal_neuro_deficit")) {
    recs.push({
      code: "pathway_stroke",
      category: "pathway_flag",
      suggestion:
        "Suspected stroke — consider the STROKE pathway; record time of onset / last-known-well and check glucose.",
      rationale:
        "Time-critical: thrombolysis/thrombectomy windows depend on onset; glucose excludes a mimic.",
      source: "AHA/ASA acute stroke guidelines (onset-time gated reperfusion).",
      seam: "pending_intent",
      confidence: "high",
    });
  }
  if (fired.has("exsanguinating_haemorrhage") || fired.has("obstetric_heavy_pv_bleeding")) {
    recs.push({
      code: "pathway_major_haemorrhage",
      category: "pathway_flag",
      suggestion:
        "Consider the MAJOR-HAEMORRHAGE pathway — flag for immediate clinician activation.",
      rationale:
        "Uncontrolled haemorrhage is an immediate life threat; delay to product raises mortality.",
      source: "Major Haemorrhage Protocol principles; research doc §9 Step 0.",
      seam: "pending_intent",
      confidence: "high",
    });
  }
  if (
    isObstetric &&
    (fired.has("obstetric_severe_htn") || fired.has("obstetric_preeclampsia_triad"))
  ) {
    recs.push({
      code: "pathway_preeclampsia",
      category: "pathway_flag",
      suggestion:
        "Obstetric red-flag — consider the PRE-ECLAMPSIA / ECLAMPSIA pathway; obstetric review.",
      rationale:
        "Severe-range BP or the symptom triad in pregnancy carries stroke + eclampsia risk.",
      source: "ACOG / NICE NG133 (severe-range BP ≥160/110 = obstetric emergency).",
      seam: "pending_intent",
      confidence: "needs_cso_input",
    });
  }

  /* ── 3. Escalation (cadre-agnostic; who to summon) ────────────── */
  if (result.lifeThreat || level === 1) {
    recs.push({
      code: "escalate_resus_team",
      category: "escalation",
      suggestion: "Summon the resuscitation team + the most senior clinician now (airway-capable).",
      rationale:
        "A life threat needs a senior, airway-capable responder at the bedside in minutes.",
      source: "RCP NEWS2 2017 (high band → critical-care/airway response); ESI v5 Level 1.",
      seam: "live",
      confidence: "high",
    });
  } else if (level === 2) {
    recs.push({
      code: "escalate_senior_urgent",
      category: "escalation",
      suggestion: isObstetric
        ? "Urgent escalation to the obstetric team / senior midwife."
        : "Urgent escalation to the senior decision-maker / critical-care-capable responder.",
      rationale: "Level 2 is high-risk for decompensation and must be seen rapidly by a senior.",
      source: "RCP NEWS2 2017 (≥7 emergency response); ESI v5 Level 2; SATS Orange <10 min.",
      seam: "live",
      confidence: provisionalPop ? "needs_cso_input" : "high",
    });
  } else if ((result.news2?.total ?? 0) >= 5 || result.news2?.hasSingleParameterThree) {
    recs.push({
      code: "escalate_urgent_review",
      category: "escalation",
      suggestion: "Urgent review by a clinician competent in acute illness.",
      rationale:
        "NEWS2 5–6, or a single parameter scoring 3, mandates urgent review regardless of a reassuring total.",
      source: "RCP NEWS2 2017 (medium risk / single red score → urgent review).",
      seam: "pending_intent",
      confidence: "high",
    });
  }

  /* ── 4. Immediate general measures (category-level, no doses) ─── */
  if (
    result.dangerVitals.some((d) => d.startsWith("SpO")) ||
    (result.news2 && spo2Critical(result))
  ) {
    recs.push({
      code: "measure_oxygen",
      category: "immediate_measure",
      suggestion:
        "Give supplemental oxygen titrated to the target saturation; optimise positioning.",
      rationale:
        "Correcting hypoxaemia is a time-critical reversible measure while the cause is worked up.",
      source:
        "BTS emergency oxygen (target 94–98%, or 88–92% if hypercapnic risk); ESI v5 danger-zone SpO₂<92.",
      seam: "pending_intent",
      confidence: "high",
    });
  }
  if (result.derived.glucoseFlag === "hypoglycaemia") {
    recs.push({
      code: "measure_glucose_correction",
      category: "immediate_measure",
      suggestion:
        "Correct hypoglycaemia — oral glucose if alert and able to swallow; otherwise airway-safe positioning and escalate for parenteral correction.",
      rationale:
        "Hypoglycaemia mimics stroke / altered mentation and is instantly reversible; gate the route on swallow safety.",
      source: "Research doc §6/§11 (glucose <3.0 = immediate); ADA hypoglycaemia first-line.",
      seam: "pending_intent",
      confidence: "high",
    });
  }
  if (
    level <= 2 ||
    result.derived.shockIndexFlag === "shock" ||
    result.derived.shockIndexFlag === "occult_shock"
  ) {
    recs.push({
      code: "measure_access_bloods",
      category: "immediate_measure",
      suggestion:
        "Establish IV access and send baseline bloods as a high-acuity preparedness step.",
      rationale:
        "High-acuity patients predictably need access; preparing early avoids delay if treatment follows.",
      source: "ESI v5 high-acuity resourcing; SSC early-access sequencing in suspected sepsis.",
      seam: "pending_intent",
      confidence: "high",
    });
  }
  if (isObstetric) {
    recs.push({
      code: "measure_obstetric_position",
      category: "immediate_measure",
      suggestion:
        "Use left-lateral positioning (or manual left uterine displacement) for the unwell pregnant patient.",
      rationale:
        "From ~20 weeks, supine position causes aortocaval compression that cuts cardiac output.",
      source: "Research doc §8; aortocaval-compression physiology (AHA maternal resuscitation).",
      seam: "pending_intent",
      confidence: "medium",
    });
  }
  if (result.incompleteVitals) {
    recs.push({
      code: "measure_complete_vitals",
      category: "immediate_measure",
      suggestion: `Obtain the missing mandatory vitals now (${result.missingRequiredVitals.join(", ") || "HR / RR / SpO₂"}) before any reassuring disposition.`,
      rationale:
        "ESI v5 forbids a reassuring level without HR/RR/SpO₂; completing them may unmask a danger-zone reading.",
      source: "ESI v5 mandatory vitals (ENA 2023).",
      seam: "pending_intent",
      confidence: "high",
    });
  }

  /* ── 5. Monitoring frequency (NEWS2-banded; suggested timer) ──── */
  recs.push(monitoringRec(result, level, provisionalPop));

  /* ── 6. Investigations to consider (category-level) ───────────── */
  if (fired.has("cardiac_chest_pain")) {
    recs.push({
      code: "invx_ecg",
      category: "investigation",
      suggestion: "Consider a 12-lead ECG (and serial cardiac biomarkers) for suspected ACS.",
      rationale: "An early ECG distinguishes STEMI (immediate reperfusion) from other chest pain.",
      source: "NICE CG95 / 2021 AHA-ACC chest pain (ECG within ~10 min of arrival).",
      seam: "pending_intent",
      confidence: "high",
    });
  }
  if (alteredMentation(result) || fired.has("focal_neuro_deficit")) {
    recs.push({
      code: "invx_glucose",
      category: "investigation",
      suggestion:
        "Consider an immediate bedside capillary glucose (altered mentation / stroke mimic).",
      rationale:
        "Glucose extremes are an instantly reversible, easily missed cause of altered consciousness or focal deficit.",
      source: "Acute-stroke / ACVPU assessment (measure glucose to exclude a mimic).",
      seam: "pending_intent",
      confidence: "high",
    });
  }
  if (sepsisInfection && (qsofaPositive || news2High)) {
    recs.push({
      code: "invx_sepsis",
      category: "investigation",
      suggestion:
        "Consider a serum/venous lactate and blood cultures (before any antimicrobial decision).",
      rationale:
        "Lactate stratifies severity; cultures-before-antibiotics preserves diagnostic yield.",
      source: "SSC Hour-1 bundle (measure lactate + cultures) — measure components only.",
      seam: "pending_intent",
      confidence: "high",
    });
  }

  /* ── 7. Onward routing (department + live seams) ──────────────── */
  if (level <= 2) {
    recs.push({
      code: "route_alert_team",
      category: "onward_routing",
      suggestion:
        "Notify the receiving department's clinical team (in-app alert fires automatically) AND hand over in person — the alert is a broadcast, not a guaranteed senior page.",
      rationale:
        "A high-acuity disposition is only safe if the receiving area is actually alerted and a senior acknowledges.",
      source: "MedSync care-team notification (ALERT_LEVELS 1–2); RCP NEWS2 escalation principle.",
      seam: "live",
      confidence: "high",
    });
  }
  if (isObstetric) {
    recs.push({
      code: "route_obstetric",
      category: "onward_routing",
      suggestion:
        "Route to the obstetric / maternity assessment area, not the general adult stream.",
      rationale: "Pregnant / recently-postpartum patients need an obstetric team and setting.",
      source: "MEOWS escalation principle (obstetric red-flag → obstetric review).",
      seam: "pending_intent",
      confidence: "needs_cso_input",
    });
  } else if (isPaediatric) {
    recs.push({
      code: "route_paediatric",
      category: "onward_routing",
      suggestion:
        "Route to the paediatric / senior-paeds area; complete a manual PEWS chart before any down-disposition.",
      rationale:
        "Children deteriorate fast; the per-point PEWS rubric is not encoded, so route up and score manually.",
      source:
        "PEWS escalation principle; NHS National PEWS v3 (per-point rubric not openly encoded).",
      seam: "pending_intent",
      confidence: "needs_cso_input",
    });
  } else if (level === 3) {
    recs.push({
      code: "route_urgent_appointment",
      category: "onward_routing",
      suggestion:
        "An urgent appointment can be created to secure prompt review (live scheduling seam).",
      rationale: "Urgent-but-stable warrants a prompt slot rather than a high-acuity alert.",
      source: "5-tier model (L3 target 60 min); SATS Yellow <60 min.",
      seam: "live",
      confidence: "high",
    });
  }

  // Stable, clinically-meaningful ordering (most acute categories first).
  return recs.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
}

function monitoringRec(
  result: TriageResult,
  level: AcuityLevel,
  provisionalPop: boolean,
): Recommendation {
  const total = result.news2?.total ?? null;
  let band: string;
  let why: string;
  let recheck: RecheckBand;
  if (level <= 2 || (total != null && total >= 7) || result.dangerVitals.length > 0) {
    band = "continuous monitoring (or at minimum hourly until stabilised)";
    recheck = "continuous";
    why = "High acuity / NEWS2 ≥7 / a danger-zone vital — risk of rapid deterioration is high.";
  } else if (total != null && (total >= 5 || result.news2?.hasSingleParameterThree)) {
    band = "re-vitals at minimum hourly";
    recheck = "hourly";
    why = "NEWS2 5–6, or a single parameter scoring 3, needs hourly observation.";
  } else if (total != null && total >= 1) {
    band = "re-vitals at minimum 4–6 hourly";
    recheck = "4-6h";
    why = "Low NEWS2 aggregate — routine cadence with nurse-led step-up.";
  } else if (total === 0) {
    band = "re-vitals at minimum 12 hourly (routine baseline)";
    recheck = "12h";
    why = "NEWS2 0 — routine baseline cadence, still scheduled.";
  } else {
    band = "set a short re-vitals interval and complete the picture";
    recheck = "short";
    why = "Score is provisional / not auto-computed — bias to a tighter interval until complete.";
  }
  // Provisional / incomplete biases tighter.
  if (result.incompleteVitals || result.provisional) {
    band = `${band} — provisional, tighten until vitals complete`;
  }
  return {
    code: "monitor_interval",
    category: "monitoring",
    suggestion: `Suggested monitoring: ${band}. (Clinician confirms; nothing auto-schedules.)`,
    rationale: why,
    source:
      "RCP NEWS2 2017 Chart 4 response thresholds; ESI v5 danger-zone (hourly until stabilised).",
    seam: "pending_intent",
    confidence: provisionalPop ? "needs_cso_input" : "high",
    recheck,
  };
}

function spo2Critical(result: TriageResult): boolean {
  const p = result.news2?.parameters.find((x) => x.parameter === "spo2");
  return !!p && p.present && p.points >= 2;
}

function alteredMentation(result: TriageResult): boolean {
  const p = result.news2?.parameters.find((x) => x.parameter === "consciousness");
  return !!p && p.present && p.points > 0;
}
