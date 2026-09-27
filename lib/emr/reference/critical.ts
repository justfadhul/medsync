import type { ConceptId } from "@/lib/facts/catalogue.generated";
import type { RefEntry } from "@/lib/resus/reference/ref";

import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { indexRefs } from "@/lib/resus/reference/ref";

/**
 * Critical-result definitions (D-EMR-06; emr-clinical-reference §7.4). MedSync marks a value
 * critical ONLY from a signed REF-CRIT-* entry, agreed with the laboratory lead. None is signed:
 * every entry is `pending_cso` with the value withheld, so nothing is flagged critical and the
 * laboratory's own flag is shown as text (lib/emr/results.ts).
 *
 * The list below is the draft the lab lead starts from — which analytes have a critical limit,
 * not what the limit is. Signing fills `value` (in the concept's canonical unit), confirms the
 * operator, and flips `status`.
 */

export interface CriticalRef extends RefEntry {
  conceptId: ConceptId;
  /** Critical when the (canonical) value satisfies `value <operator> threshold`. Confirmed at signing. */
  operator: "<" | "<=" | ">" | ">=";
}

const DRAFTED_ON = "2026-09-26";
const POLICY_URL =
  "docs/emr/emr-clinical-reference.md#74-critical-results-policy-skeleton-for-signature";

function pending(conceptId: ConceptId, side: "low" | "high"): CriticalRef {
  const concept = CONCEPTS[conceptId];
  return {
    id: `REF-CRIT-${conceptId.slice(4).toUpperCase()}-${side.toUpperCase()}`,
    text: `Critical ${side} ${concept.display.toLowerCase()}`,
    unit: concept.canonicalUnit ?? undefined,
    source: "LAB-LEAD",
    url: POLICY_URL,
    verifiedOn: DRAFTED_ON,
    confidence: "design",
    status: "pending_cso",
    conceptId,
    operator: side === "low" ? "<" : ">",
  };
}

export const CRITICAL_REFS: readonly CriticalRef[] = [
  pending("obs.glucose", "low"),
  pending("obs.glucose", "high"),
  pending("obs.potassium", "low"),
  pending("obs.potassium", "high"),
  pending("obs.sodium", "low"),
  pending("obs.sodium", "high"),
  pending("obs.haemoglobin", "low"),
  pending("obs.platelets", "low"),
];

/** Time from a critical result being available to the responsible clinician acknowledging it,
 *  after which it escalates to the in-charge. `value` is in minutes once signed. */
export const REF_CRIT_TIMEFRAME: RefEntry = {
  id: "REF-CRIT-TIMEFRAME",
  text: "Unacknowledged critical result escalates to the in-charge after this time",
  unit: "min",
  source: "LAB-LEAD",
  url: POLICY_URL,
  verifiedOn: DRAFTED_ON,
  confidence: "design",
  status: "pending_cso",
};

/** The signed number of an entry, or null — unsigned or unreadable entries are never applied. */
export function signedNumber(e: RefEntry): number | null {
  if (e.status !== "signed" || !e.value?.trim()) return null;
  const n = Number(e.value);
  return Number.isFinite(n) ? n : null;
}

/** Throws on a duplicate id at import time. */
export const CRITICAL_REF_INDEX = indexRefs([...CRITICAL_REFS, REF_CRIT_TIMEFRAME]);
