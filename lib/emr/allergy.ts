import type { Allergy, AllergyStatusAssertion } from "@/db/schema/emr";

import { EMERGENCY_DRUGS } from "@/lib/prescribing/reference/emergency-drug-catalog";

/**
 * The allergy record as the single source (ADR 0135, clinical reference [05], D-EMR-04). PURE.
 *
 * Status is always one of four: listed, no known drug allergies (an assertion by a named person
 * at a time), unable to assess, not recorded. An active, non-refuted allergy ALWAYS outranks an
 * assertion. "Not recorded" is never shown as NKDA. Allergies from every hospital are included,
 * each with the hospital that recorded it (STOP 1, O-8).
 */

/** An allergy row as the resolver needs it. `substanceText` is the decrypted
 *  substance_text_ciphertext, or for a backfilled row the text read from its untouched source. */
export type AllergyRow = Pick<
  Allergy,
  | "id"
  | "logicalId"
  | "version"
  | "hospitalId"
  | "status"
  | "substanceKind"
  | "substanceCode"
  | "criticality"
  | "severity"
  | "manifestations"
  | "clinicalStatus"
  | "verification"
  | "effectiveAt"
  | "recordedAt"
  | "informant"
> & { substanceText: string | null };

export type AssertionRow = Pick<
  AllergyStatusAssertion,
  | "id"
  | "hospitalId"
  | "assertion"
  | "assertedByUserId"
  | "asserterCadre"
  | "assertedAt"
  | "recordedAt"
  | "status"
  | "supersedesId"
>;

export interface ListedAllergy {
  /** The worst record for this substance; the rest are `duplicates` (grouped, not hidden). */
  allergy: AllergyRow;
  duplicates: AllergyRow[];
  /** Hospitals the substance was recorded at (cross-hospital, STOP 1). */
  hospitalIds: string[];
  coded: boolean;
}

export type AllergyStatus =
  | { kind: "listed"; allergies: ListedAllergy[] }
  | {
      kind: "no_known_drug_allergies";
      assertedByUserId: string;
      asserterCadre: string | null;
      assertedAt: Date;
      hospitalId: string;
    }
  | { kind: "unable_to_assess"; assertedByUserId: string; assertedAt: Date; hospitalId: string }
  | { kind: "not_recorded" };

/** The newest version of each logical allergy (supersession by logical_id/version). */
export function currentAllergies(rows: AllergyRow[]): AllergyRow[] {
  const byLogical = new Map<string, AllergyRow>();
  for (const r of rows) {
    const cur = byLogical.get(r.logicalId);
    if (!cur || r.version > cur.version) byLogical.set(r.logicalId, r);
  }
  return [...byLogical.values()];
}

/** Active on the record: not voided, not refuted, clinically active. */
export function isActiveAllergy(r: AllergyRow): boolean {
  return (
    r.status !== "entered_in_error" &&
    r.status !== "cancelled" &&
    r.verification !== "refuted" &&
    r.clinicalStatus === "active"
  );
}

const CRITICALITY_RANK: Record<string, number> = { high: 0, unable_to_assess: 1, low: 2 };
const SEVERITY_RANK: Record<string, number> = { severe: 0, moderate: 1, mild: 2 };
const rank = (table: Record<string, number>, v: string | null) =>
  (v === null ? undefined : table[v]) ?? 3;

/** Worst first: criticality (high, unable to assess, low, unknown), then severity, then anaphylaxis,
 *  then the newest, then id (deterministic). */
export function compareWorstFirst(a: AllergyRow, b: AllergyRow): number {
  return (
    rank(CRITICALITY_RANK, a.criticality) - rank(CRITICALITY_RANK, b.criticality) ||
    rank(SEVERITY_RANK, a.severity) - rank(SEVERITY_RANK, b.severity) ||
    Number(b.manifestations.includes("anaphylaxis")) -
      Number(a.manifestations.includes("anaphylaxis")) ||
    b.effectiveAt.getTime() - a.effectiveAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/** Two records of one substance: the same code, or the same typed text (case and spacing aside). */
function substanceKey(r: AllergyRow): string {
  if (r.substanceCode) return `code:${r.substanceKind}:${r.substanceCode.toLowerCase()}`;
  return `text:${(r.substanceText ?? `legacy:${r.logicalId}`).trim().toLowerCase().replace(/\s+/g, " ")}`;
}

/** The current assertion: the newest final row that no later row voids or replaces. */
export function currentAssertion(rows: AssertionRow[]): AssertionRow | null {
  const replaced = new Set(rows.map((r) => r.supersedesId).filter((id): id is string => !!id));
  const live = rows
    .filter((r) => r.status === "final" && !replaced.has(r.id))
    .sort(
      (a, b) =>
        b.assertedAt.getTime() - a.assertedAt.getTime() ||
        b.recordedAt.getTime() - a.recordedAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  return live[0] ?? null;
}

export function resolveAllergyStatus(
  allergies: AllergyRow[],
  assertions: AssertionRow[],
): AllergyStatus {
  const active = currentAllergies(allergies).filter(isActiveAllergy).sort(compareWorstFirst);
  if (active.length > 0) {
    const groups = new Map<string, [AllergyRow, ...AllergyRow[]]>();
    for (const r of active) {
      const g = groups.get(substanceKey(r));
      if (g) g.push(r);
      else groups.set(substanceKey(r), [r]);
    }
    // Map keeps insertion order, and `active` is worst first, so groups are worst first too.
    return {
      kind: "listed",
      allergies: [...groups.values()].map(([allergy, ...duplicates]) => ({
        allergy,
        duplicates,
        hospitalIds: [...new Set([allergy, ...duplicates].map((r) => r.hospitalId))],
        coded: !!allergy.substanceCode,
      })),
    };
  }
  const a = currentAssertion(assertions);
  if (!a) return { kind: "not_recorded" };
  if (a.assertion === "no_known_drug_allergies") {
    return {
      kind: "no_known_drug_allergies",
      assertedByUserId: a.assertedByUserId,
      asserterCadre: a.asserterCadre,
      assertedAt: a.assertedAt,
      hospitalId: a.hospitalId,
    };
  }
  return {
    kind: "unable_to_assess",
    assertedByUserId: a.assertedByUserId,
    assertedAt: a.assertedAt,
    hospitalId: a.hospitalId,
  };
}

/* ─── The prescribing-check input ─────────────────────────────────── */

export const NAME_ONLY_LABEL = "Matched by name only — code it for class checks";

export interface PrescribingAllergyEntry {
  /** What runSafetyChecks name-matches against drug name | brand | drugKey | drugClass. */
  value: string;
  coded: boolean;
  /** Where it was recorded; null for a current-episode capture not yet on the record. */
  hospitalId: string | null;
  /** Set for uncoded entries. */
  label: typeof NAME_ONLY_LABEL | null;
}

const FORMULARY_KEYS = new Set<string>(EMERGENCY_DRUGS.map((d) => d.drugKey));
const FORMULARY_CLASSES = new Set<string>(EMERGENCY_DRUGS.map((d) => d.drugClass));

/** A coded substance becomes the formulary's own vocabulary: a drug_ingredient code is a drugKey,
 *  a drug_class code is a drugClass display, both of which the engine's haystack contains. */
function codedValue(r: AllergyRow): string | null {
  if (!r.substanceCode) return null;
  if (r.substanceKind === "drug_ingredient" && FORMULARY_KEYS.has(r.substanceCode))
    return r.substanceCode;
  if (r.substanceKind === "drug_class" && FORMULARY_CLASSES.has(r.substanceCode))
    return r.substanceCode;
  return null;
}

/**
 * Every active allergy from every hospital, as input for lib/prescribing runSafetyChecks.
 * Coded substances pass as the formulary key or class; uncoded text is still passed to the name
 * matcher [H, safety-positive], labelled "matched by name only". A code the formulary does not know
 * falls back to its text (never dropped). `episodeCaptures` are the current resus episode's AMPLE
 * texts until the timeline writer retires (ADR 0135: no gap).
 *
 * Refuted and entered-in-error allergies are excluded; so is an NKDA assertion (it has no substance).
 */
export function prescribingAllergyInput(
  allergies: AllergyRow[],
  episodeCaptures: readonly string[] = [],
): { allergies: string[]; entries: PrescribingAllergyEntry[] } {
  const entries: PrescribingAllergyEntry[] = [];
  for (const r of currentAllergies(allergies).filter(isActiveAllergy).sort(compareWorstFirst)) {
    const coded = codedValue(r);
    const value = coded ?? r.substanceText ?? r.substanceCode;
    if (!value?.trim()) continue;
    entries.push({
      value: value.trim(),
      coded: coded !== null,
      hospitalId: r.hospitalId,
      label: coded !== null ? null : NAME_ONLY_LABEL,
    });
  }
  for (const text of episodeCaptures) {
    if (text.trim())
      entries.push({ value: text.trim(), coded: false, hospitalId: null, label: NAME_ONLY_LABEL });
  }
  // One entry per substance, case-insensitive; the first wins (worst first, record before episode).
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    const k = e.value.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { allergies: unique.map((e) => e.value), entries: unique };
}
