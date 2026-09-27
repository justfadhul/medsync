/**
 * What every projection shares: the result shape, the validate-or-quarantine step (C11), and the
 * sensitivity rule (C9, cfc-v1.1-addendum A3). Pure: no I/O.
 */
import type { ConceptDef } from "../catalogue.generated";
import type { ClinicalFact, FactConcept, Sensitivity } from "../types";

import { CONCEPTS } from "../catalogue.generated";
import { interpretability, validateFact } from "../refinements";

export type Quarantine = { id: string; reason: string };
/** One source row can give several facts (a BP row gives two) and quarantine some of them. */
export type Projection = { facts: ClinicalFact[]; quarantined: Quarantine[] };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A fact before the catalogue has judged its context. */
export type Candidate = DistributiveOmit<ClinicalFact, "interpretable">;

export const EMPTY: Projection = { facts: [], quarantined: [] };

export const quarantine = (id: string, reason: string): Projection => ({
  facts: [],
  quarantined: [{ id, reason }],
});

/** Interpretability from the catalogue, then the full contract; a failure is quarantined, never thrown. */
export function finish(candidates: readonly Candidate[]): Projection {
  const out: Projection = { facts: [], quarantined: [] };
  for (const c of candidates) {
    const withCtx = { ...c, interpretable: { ok: true } } as ClinicalFact;
    const v = validateFact({ ...c, interpretable: interpretability(withCtx) });
    if (v.ok) out.facts.push(v.fact);
    else out.quarantined.push({ id: c.id, reason: v.reason });
  }
  return out;
}

export function merge(parts: readonly Projection[]): Projection {
  return {
    facts: parts.flatMap((p) => p.facts),
    quarantined: parts.flatMap((p) => p.quarantined),
  };
}

export const isoOf = (d: Date | string): string =>
  (d instanceof Date ? d : new Date(d)).toISOString();
export const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function conceptDef(id: string): ConceptDef | undefined {
  return (CONCEPTS as Record<string, ConceptDef>)[id];
}

/* ─── Sensitivity (C9) ─── */

/** D-CFC-09 (signed as recommended 2026-09-26): restrict pregnancy for patients under 18. The only
 *  age in this module, and the one number cfc-v1.1-addendum A3 allows. */
const MINOR_AGE_YEARS = 18;

export type DateOfBirth = { value: string; precision: "day" | "month" | "year" | "estimated" };

/**
 * Could the patient have been under 18 at `at`? Imprecise dates are read at their latest possible
 * birth date, so an uncertainty that spans 18 restricts (D-CFC-12); an estimated date has no bound
 * and always restricts.
 */
export function possiblyMinorAt(dob: DateOfBirth, at: Date | string): boolean {
  if (dob.precision === "estimated") return true;
  const y = Number(dob.value.slice(0, 4));
  const m = Number(dob.value.slice(5, 7));
  // Latest possible birth: the day itself, the month's last day (day 0 of the next month), or 31 Dec.
  const latestBirth =
    dob.precision === "day"
      ? Date.UTC(y, m - 1, Number(dob.value.slice(8, 10)))
      : Date.UTC(y, dob.precision === "month" ? m : 12, 0);
  const adulthood = new Date(latestBirth);
  adulthood.setUTCFullYear(adulthood.getUTCFullYear() + MINOR_AGE_YEARS);
  return new Date(at).getTime() < adulthood.getTime();
}

/** Concepts under SR-PREG-MINOR: every pregnancy concept and obs.pregnancy_test (catalogue-declared). */
export function hasMinorRule(concept: FactConcept): boolean {
  return conceptDef(concept)?.sensitivityRule === "SR-PREG-MINOR";
}

/**
 * The fact's sensitivity: restricted when the row says so, the concept is restricted, or the
 * minors rule applies. Only ever raises: the row's own value, set at insert, is never lowered.
 */
export function sensitivityFor(
  concept: FactConcept,
  row: string | null | undefined,
  minors?: { dob?: DateOfBirth; effectiveAt: Date | string },
): Sensitivity {
  if (row === "restricted" || conceptDef(concept)?.sensitivity === "restricted")
    return "restricted";
  if (minors?.dob && hasMinorRule(concept) && possiblyMinorAt(minors.dob, minors.effectiveAt))
    return "restricted";
  return "standard";
}
