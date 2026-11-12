import { CHECK_REASONS, OVERRIDE_REASONS, STOCK_REASONS } from "@/lib/prescribing/plan-rx";

/**
 * What the prescriber was warned about and answered, from stored data only (Law 6, PQ-8, RV-5).
 * Nothing here runs a check. Plan rows store `check_answers` ({code, answer, outcome} from Pharmacy
 * Phase 0; {code, answer} before it); EMR-sheet rows store only `confirmed_flags` codes.
 *
 * The level of an answered check is the stored `outcome`. Rows written before it was stored: only
 * the allergy check is always a stop when answered (lib/prescribing/plan-checks.ts), so only it
 * reads as a stop; every other answered code reads as an answered check (D-PH0-20).
 */

/** Plan check codes (PlanCheckCode) and EMR-sheet engine codes, in the prescriber's words. */
export const CHECK_TITLE: Readonly<Record<string, string>> = {
  allergy: "Allergy",
  allergy_status: "Allergy",
  dose_reference: "Dose against reference",
  kidney: "Kidney function",
  weight: "Weight",
  child: "Child",
  duplicate: "Already prescribed",
  indication: "Indication against the latest result",
  cultures: "Cultures before antibiotics",
  interactions: "Interactions",
  stock: "Pharmacy stock",
  cosign: "Co-sign",
  controlled: "Controlled drug",
  pregnancy: "Pregnancy",
  limits: "Limits",
  engine_concentration: "Concentration",
  engine_max_cumulative: "Maximum dose",
  engine_contraindication: "Contraindication",
  // EMR-sheet engine codes (lib/prescribing/engine.ts).
  concentration: "Concentration",
  contraindication: "Contraindication",
  dose_range: "Dose range",
  max_cumulative: "Maximum dose",
  paediatric_routing: "Child",
  weight_missing: "Weight",
};

const ANSWER_WORDS: Readonly<Record<string, string>> = {
  ...CHECK_REASONS,
  ...OVERRIDE_REASONS,
  ...STOCK_REASONS,
};

export type CheckLevel = "stop" | "check";

export interface StoredAnswer {
  code: string;
  answer?: string;
  outcome?: string;
}

export interface AnsweredCheck {
  code: string;
  title: string;
  level: CheckLevel;
  /** The answer chosen, in the prescriber's words; "other" means the reasons text says it. */
  answer: string | null;
}

export interface LineChecks {
  checkAnswers: readonly StoredAnswer[];
  confirmedFlags: readonly string[];
}

const levelOf = (a: StoredAnswer): CheckLevel =>
  a.outcome === "stop" || a.outcome === "check"
    ? a.outcome
    : a.code === "allergy"
      ? "stop"
      : "check";

/** Every answered check on one line, from what was stored. */
export function answeredChecks(line: LineChecks): AnsweredCheck[] {
  const answers: StoredAnswer[] = line.checkAnswers.length
    ? [...line.checkAnswers]
    : line.confirmedFlags.map((code) => ({ code }));
  return answers.map((a) => ({
    code: a.code,
    title: CHECK_TITLE[a.code] ?? a.code,
    level: levelOf(a),
    answer: a.answer && a.answer !== "other" ? (ANSWER_WORDS[a.answer] ?? a.answer) : null,
  }));
}

export interface ChipLine extends LineChecks {
  kind: string;
  controlled: boolean;
  /** Plan rows only: the line's problem. Its presence tells a Plan row from an EMR-sheet row. */
  conditionId: string | null;
  regimenId: string | null;
}

/**
 * The checks cell (PQ-8): most serious first — stops overridden, controlled drug, child under 16,
 * renal check answered, typed dose. Built from stored data only.
 */
export function checkChips(lines: readonly ChipLine[]): string[] {
  const answered = lines.flatMap(answeredChecks);
  const stops = answered.filter((c) => c.level === "stop").length;
  const chips: string[] = [];
  if (stops) chips.push(`${stops} ${stops === 1 ? "stop" : "stops"} overridden`);
  const controlled = lines.filter((l) => l.controlled);
  if (controlled.length)
    // The Plan refuses a controlled drug without a witness (verifyAnswers); the EMR sheet does not.
    chips.push(
      controlled.every((l) => l.conditionId) ? "Controlled drug, witnessed" : "Controlled drug",
    );
  if (answered.some((c) => c.code === "child" || c.code === "paediatric_routing"))
    chips.push("Child under 16");
  if (answered.some((c) => c.code === "kidney")) chips.push("Renal check answered");
  // Only the Plan offers signed regimens; a Plan drug line without one was typed.
  if (lines.some((l) => l.conditionId && l.kind === "drug" && !l.regimenId))
    chips.push("Typed dose");
  return chips;
}
