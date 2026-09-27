import type { AmpleHistory } from "@/lib/resus/exposure";
import type { CareLevel, EpisodePhase, OutcomeCode, Rhythm } from "@/lib/resus/model";
import type { AbcdeLetter } from "@/lib/resus/types";
import type { VitalSnapshot } from "@/lib/resus/vitals";

import { LEVELS_OF_CARE, NO_SUGGESTION_TEXT } from "@/lib/resus/reference/levels-of-care";
import { ABCDE_LETTERS } from "@/lib/resus/types";
import { TREND_VITALS } from "@/lib/resus/vitals";

/**
 * SBAR handover draft (docs/clinical/resus-closeout-clinical-catalog.md §1,
 * CO-HO-01..03) — PURE and deterministic: the same input gives the same text.
 * It only restates what the input carries; missing items read "not recorded"
 * rather than being inferred — an empty devices, investigations or escort list
 * was not collected, so it never reads "none". The leader edits the draft
 * before signing.
 */

/** AMPLE as stored: v1 writes `past`; v2 writes `pastHistory` and `nkda`. */
export type HandoverAmple = AmpleHistory & { pastHistory?: string; nkda?: boolean };

export interface HandoverInput {
  patient: { label: string; ageYears: number | null; sex: string | null };
  /** e.g. "Triage Red (rapid)". */
  trigger: string;
  phase: EpisodePhase;
  outcome: OutcomeCode | null;
  /** Treatment-limitation decision summary, if any. */
  treatmentLimitation: string | null;
  ample: HandoverAmple | null;
  weightKg: number | null;
  /** Final A–E states (display labels) with key-finding labels. */
  steps: { step: AbcdeLetter; state: string | null; findings: string[] }[];
  lastVitals: { snapshot: VitalSnapshot; atLabel: string | null; trend: string | null } | null;
  news2: number | null;
  arrest: {
    firstRhythm: Rhythm | null;
    shocks: number;
    /** e.g. "Adrenaline 1 mg IV ×3". */
    drugs: string[];
    timeToRoscMin: number | null;
    totalCprMin: number | null;
    sustained: boolean | null;
  } | null;
  devices: string[];
  outstandingActions: string[];
  /** Post-ROSC bundle targets, as displayed (refValue). */
  targets: string[];
  pendingInvestigations: string[];
  level: { suggested: CareLevel | null; chosen: CareLevel | null };
  escortNeeds: string[];
}

export interface SbarDraft {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
}

/**
 * Outstanding tests on the close-out's handover event (PROMPT §5.12, A5): test-menu ids and an
 * optional short reason, stored beside the SBAR text as it is. The EMR handoff proposes each one to
 * the receiving clinician; nothing is ordered until they accept.
 */
export interface OutstandingTest {
  testId: string;
  reason: string | null;
}
export const OUTSTANDING_TESTS_MAX = 20;
export const OUTSTANDING_REASON_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tests a stored handover payload carries: none on older events; malformed or repeated
 *  entries are dropped, the first of a repeated test kept. */
export function outstandingTestsOf(payload: unknown): OutstandingTest[] {
  const raw = (payload as { outstandingTests?: unknown } | null)?.outstandingTests;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: OutstandingTest[] = [];
  for (const t of raw.slice(0, OUTSTANDING_TESTS_MAX) as { testId?: unknown; reason?: unknown }[]) {
    if (typeof t?.testId !== "string" || !UUID.test(t.testId) || seen.has(t.testId)) continue;
    seen.add(t.testId);
    const reason =
      typeof t.reason === "string" ? t.reason.trim().slice(0, OUTSTANDING_REASON_MAX) : "";
    out.push({ testId: t.testId, reason: reason || null });
  }
  return out;
}

const NR = "not recorded";

const PHASE_LABEL: Record<EpisodePhase, string> = {
  survey: "primary survey",
  arrest: "cardiac arrest",
  post_rosc: "post-ROSC",
  boarding: "boarding",
};

const OUTCOME_LABEL: Record<OutcomeCode, string> = {
  stabilised: "stabilised",
  rosc_sustained: "ROSC, sustained",
  rosc_not_sustained: "ROSC, not sustained",
  died_after_cpr: "died after CPR",
  died_cpr_not_attempted: "died, CPR not attempted",
  transferred_out: "transferred out",
};

const RHYTHM_LABEL: Record<Rhythm, string> = {
  vf_pvt: "VF/pVT",
  pea: "PEA",
  asystole: "Asystole",
  organised: "Organised rhythm",
};

const DIED: readonly (OutcomeCode | null)[] = ["died_after_cpr", "died_cpr_not_attempted"];

/** Empty reads `empty`: "none" only where the list is derived from the record. */
const list = (items: readonly string[], empty: string) =>
  items.length > 0 ? items.join("; ") : empty;
const levelLabel = (l: CareLevel | null, empty: string) => (l ? LEVELS_OF_CARE[l].label : empty);

function allergies(a: HandoverAmple | null): string {
  if (a && a.allergies.length > 0) return a.allergies.join(", ");
  return a?.nkda ? "none known (NKDA)" : NR;
}

function vitalsLine(v: VitalSnapshot): string {
  const parts: string[] = TREND_VITALS.flatMap(({ key, label, unit }) => {
    const n = v[key];
    return typeof n === "number" ? [`${label} ${n} ${unit}`] : [];
  });
  if (v.consciousness) parts.push(`ACVPU ${v.consciousness}`);
  if (v.oxygen) parts.push(v.oxygen === "oxygen" ? "on O₂" : "on air");
  return parts.length > 0 ? parts.join(" · ") : NR;
}

function situation(i: HandoverInput): string {
  const who = [
    i.patient.label,
    i.patient.ageYears !== null ? `${i.patient.ageYears} y` : null,
    i.patient.sex,
  ].filter((s): s is string => !!s);
  const lines = [
    `${who.join(", ")}.`,
    `Trigger: ${i.trigger}.`,
    `Mode: ${PHASE_LABEL[i.phase]}${i.outcome ? `; outcome: ${OUTCOME_LABEL[i.outcome]}` : ""}.`,
  ];
  if (i.treatmentLimitation) lines.push(`Treatment limitation: ${i.treatmentLimitation}.`);
  return lines.join("\n");
}

function background(i: HandoverInput): string {
  const a = i.ample;
  const lines = [
    `Allergies: ${allergies(a)}.`,
    `Medications: ${a?.medications || NR}.`,
    `Past history: ${a?.pastHistory || a?.past || NR}.`,
    `Last meal: ${a?.lastMeal || NR}.`,
    `Events: ${a?.events || NR}.`,
  ];
  if (i.weightKg !== null) lines.push(`Weight: ${i.weightKg} kg.`);
  return lines.join("\n");
}

function assessment(i: HandoverInput): string {
  const lines = ABCDE_LETTERS.map((letter) => {
    const s = i.steps.find((x) => x.step === letter);
    if (!s) return `${letter}: ${NR}.`;
    const f = s.findings.length > 0 ? ` (${s.findings.join(", ")})` : "";
    return `${letter}: ${s.state ?? NR}${f}.`;
  });
  if (i.lastVitals) {
    const at = i.lastVitals.atLabel ? ` at ${i.lastVitals.atLabel}` : "";
    lines.push(`Last vitals${at}: ${vitalsLine(i.lastVitals.snapshot)}.`);
    if (i.lastVitals.trend) lines.push(`Trend: ${i.lastVitals.trend}.`);
  } else lines.push(`Last vitals: ${NR}.`);
  lines.push(`NEWS2: ${i.news2 ?? NR}.`);
  if (i.arrest) {
    const r = i.arrest;
    const parts = [
      `first rhythm ${r.firstRhythm ? RHYTHM_LABEL[r.firstRhythm] : NR}`,
      `shocks ${r.shocks}`,
      `drugs ${list(r.drugs, "none")}`,
      `time to ROSC ${r.timeToRoscMin !== null ? `${r.timeToRoscMin} min` : NR}`,
      `total CPR ${r.totalCprMin !== null ? `${r.totalCprMin} min` : NR}`,
      `ROSC ${r.sustained === null ? NR : r.sustained ? "sustained" : "not sustained"}`,
    ];
    lines.push(`Arrest: ${parts.join(", ")}.`);
  }
  lines.push(`Lines, tubes, devices: ${list(i.devices, NR)}.`);
  return lines.join("\n");
}

function recommendation(i: HandoverInput): string {
  // CO-R: no suggestion reads the signed "insufficient data — choose"; after a death no level applies.
  const level = DIED.includes(i.outcome)
    ? []
    : [
        `Level of care: suggested ${levelLabel(i.level.suggested, NO_SUGGESTION_TEXT)}; chosen ${levelLabel(i.level.chosen, "not chosen")}.`,
      ];
  return [
    `Outstanding actions: ${list(i.outstandingActions, "none")}.`,
    `Targets: ${list(i.targets, "none")}.`,
    `Pending investigations: ${list(i.pendingInvestigations, NR)}.`,
    ...level,
    `Escort: ${list(i.escortNeeds, NR)}.`,
  ].join("\n");
}

/** CO-HO-01..03: the deterministic SBAR draft. */
export function buildSbar(input: HandoverInput): SbarDraft {
  return {
    situation: situation(input),
    background: background(input),
    assessment: assessment(input),
    recommendation: recommendation(input),
  };
}
