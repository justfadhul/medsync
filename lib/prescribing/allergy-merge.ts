import type { EmergencyDrug } from "@/lib/prescribing/reference/emergency-drug-catalog";

import { runSafetyChecks } from "@/lib/prescribing/engine";

/**
 * Union allergy substance lists for the prescribing safety check — the resus
 * timeline capture + the persistent (clerked) patient_allergies. Case-insensitive
 * dedupe (first-seen casing wins), blanks dropped. Pure.
 */
export function mergeAllergyLists(...lists: (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const v = raw.trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/**
 * The server's own allergy check on an emergency administration (Phase 0 safety finding): the
 * dialog's flags are never trusted. A match on the record's allergies (plus the episode's captures)
 * needs an override reason, as the dialog asks; without one the administration is refused. Only the
 * allergy block is re-run here; the other blocks stay as they were (Law 6).
 */
export function allergyRecheck(
  drug: EmergencyDrug,
  allergies: string[],
  overrideReason: string | undefined,
): { matched: boolean; refusal: string | null } {
  const flag = runSafetyChecks({
    drug,
    patient: { ageYears: null, weightKg: null, allergies, conditions: [] },
    priorAdministrations: [],
  }).find((f) => f.code === "allergy");
  if (!flag) return { matched: false, refusal: null };
  const reasoned = (overrideReason?.trim().length ?? 0) >= 3;
  return {
    matched: true,
    refusal: reasoned ? null : `${flag.message} Record the override reason.`,
  };
}
