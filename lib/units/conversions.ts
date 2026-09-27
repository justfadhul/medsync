/**
 * The one unit table (CFC §5, D-CFC-05; clinical reference §8 for the v1.1 analytes).
 * Nothing else in the app converts units. Every conversion here is linear and
 * increasing (canonical = value × factor + offset), so a lab comparator ("<0.5")
 * keeps its direction through conversion and inversion is exact arithmetic.
 *
 * Numbers are the signed ones from the spec, written the way the spec writes them
 * (÷ 18.0156 stays a division) so a reviewer can check each line against the table.
 * Full precision is returned; rounding is the display's job.
 */

type Linear = { factor: number; offset: number };
type ConceptUnits = { canonical: string; from: Record<string, Linear> };

const times = (factor: number): Linear => ({ factor, offset: 0 });
const divide = (divisor: number): Linear => ({ factor: 1 / divisor, offset: 0 });

const lipid = (): ConceptUnits => ({ canonical: "mmol/L", from: { "mg/dL": divide(38.67) } });
const bilirubin = (): ConceptUnits => ({ canonical: "umol/L", from: { "mg/dL": times(17.1) } });
const protein = (): ConceptUnits => ({ canonical: "g/L", from: { "g/dL": times(10) } });

export const UNIT_TABLE: Record<string, ConceptUnits> = {
  // CFC §5 (v1)
  "obs.glucose": { canonical: "mmol/L", from: { "mg/dL": divide(18.0156) } },
  // NGSP master equation: % = 0.09148 × IFCC + 2.152. IFCC is derived for display, never stored.
  "obs.hba1c": { canonical: "%", from: { "mmol/mol": { factor: 0.09148, offset: 2.152 } } },
  "obs.creatinine": { canonical: "umol/L", from: { "mg/dL": times(88.42) } },
  "obs.chol_total": lipid(),
  "obs.chol_hdl": lipid(),
  "obs.chol_ldl": lipid(),
  "obs.triglycerides": { canonical: "mmol/L", from: { "mg/dL": divide(88.57) } },
  // mg/dL here is urea NITROGEN (BUN), the way US-style reports give it; the spec's
  // factor 0.357 assumes that. A report of mg/dL urea itself would need 0.1665.
  "obs.urea": { canonical: "mmol/L", from: { "mg/dL": times(0.357) } },
  "obs.uacr": { canonical: "mg/mmol", from: { "mg/g": divide(8.84) } },
  "obs.haemoglobin": { canonical: "g/dL", from: { "g/L": divide(10) } },
  "obs.c_peptide": { canonical: "nmol/L", from: { "ng/mL": times(0.331), "pmol/L": divide(1000) } },
  "obs.weight": { canonical: "kg", from: { "[lb_av]": times(0.45359237) } },
  "obs.height": { canonical: "cm", from: { "[in_i]": times(2.54) } },
  // (F − 32) × 5/9
  "obs.temperature": {
    canonical: "Cel",
    from: { "[degF]": { factor: 5 / 9, offset: (-32 * 5) / 9 } },
  },
  // Clinical reference §8 (v1.1)
  "obs.bilirubin_total": bilirubin(),
  "obs.bilirubin_direct": bilirubin(),
  "obs.calcium": { canonical: "mmol/L", from: { "mg/dL": divide(4.008) } },
  "obs.magnesium": { canonical: "mmol/L", from: { "mg/dL": divide(2.431) } },
  // mg/dL of phosphorus (how labs report "phosphate").
  "obs.phosphate": { canonical: "mmol/L", from: { "mg/dL": divide(3.097) } },
  "obs.uric_acid": { canonical: "umol/L", from: { "mg/dL": times(59.48) } },
  "obs.lactate": { canonical: "mmol/L", from: { "mg/dL": divide(9.008) } },
  "obs.albumin": protein(),
  "obs.total_protein": protein(),
};

export type UnitResult = { value: number; unit: string } | { error: string };

// Same unit in and out is the identity, so the canonical unit needs no table row.
function linearFor(conceptId: string, unit: string): Linear | { error: string } {
  const entry = UNIT_TABLE[conceptId];
  if (!entry) return { error: `No unit table for ${conceptId}` };
  if (unit === entry.canonical) return times(1);
  return entry.from[unit] ?? { error: `Unit ${unit} is not accepted for ${conceptId}` };
}

export function canonicalUnit(conceptId: string): string | null {
  return UNIT_TABLE[conceptId]?.canonical ?? null;
}

/** Units a value may be entered in: canonical first, then the convertible ones. */
export function acceptedUnits(conceptId: string): string[] {
  const entry = UNIT_TABLE[conceptId];
  return entry ? [entry.canonical, ...Object.keys(entry.from)] : [];
}

/** C4: the caller keeps the reported value and unit; this is the computed canonical copy. */
export function toCanonical(conceptId: string, value: number, unit: string): UnitResult {
  if (!Number.isFinite(value)) return { error: "Value is not a finite number" };
  const l = linearFor(conceptId, unit);
  if ("error" in l) return l;
  return { value: value * l.factor + l.offset, unit: UNIT_TABLE[conceptId]!.canonical }; // linearFor found the entry
}

export function fromCanonical(conceptId: string, value: number, displayUnit: string): UnitResult {
  if (!Number.isFinite(value)) return { error: "Value is not a finite number" };
  const l = linearFor(conceptId, displayUnit);
  if ("error" in l) return l;
  return { value: (value - l.offset) / l.factor, unit: displayUnit };
}

export type Comparator = "<" | "<=" | ">" | ">=";

const COMPARATOR = /^\s*(<=|>=|<|>|≤|≥)?\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/;

/**
 * Parses a reported result like "<0.5", "> 33.3" or "7.2". The comparator is part of
 * the result and must never be dropped: "<0.5" is not 0.5. Unicode ≤ ≥ from lab
 * exports map to the stored ASCII forms (obs_comparator_check).
 */
export function parseComparator(
  raw: string,
): { comparator: Comparator | null; value: number } | { error: string } {
  const m = COMPARATOR.exec(raw);
  if (!m) return { error: `Not a number: ${raw}` };
  const sym = m[1] === "≤" ? "<=" : m[1] === "≥" ? ">=" : m[1];
  return { comparator: (sym as Comparator | undefined) ?? null, value: Number(m[2]) };
}
