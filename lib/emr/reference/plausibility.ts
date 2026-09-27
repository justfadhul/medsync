import type { ConceptId } from "@/lib/facts/catalogue.generated";
import type { RefEntry } from "@/lib/resus/reference/ref";

import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { signedNumber } from "./critical";

/**
 * Plausibility bounds (CFC §6, D-CFC-15). Each quantity concept gets a soft bound (ask the user
 * to confirm) and a hard bound (reject a physically impossible value), low and high. The numbers
 * are signed in the dossier; none is yet, so every entry is `pending_cso` with the value withheld
 * and `checkPlausibility` answers 'unbounded' — the mechanism ships, no number does.
 */

export interface PlausibilityRef extends RefEntry {
  conceptId: ConceptId;
  bound: "soft" | "hard";
  side: "low" | "high";
}

const DRAFTED_ON = "2026-09-26";
const DOSSIER_URL = "docs/emr/SPEC-CLINICAL-FACT-CONTRACT-v1.md";

export const PLAUSIBILITY_REFS: readonly PlausibilityRef[] = (
  Object.keys(CONCEPTS) as ConceptId[]
).flatMap((conceptId) => {
  const c = CONCEPTS[conceptId];
  if (c.valueType !== "quantity") return [];
  return (["soft", "hard"] as const).flatMap((bound) =>
    (["low", "high"] as const).map(
      (side): PlausibilityRef => ({
        id: `REF-PLAUS-${conceptId.slice(4).toUpperCase()}-${bound.toUpperCase()}-${side.toUpperCase()}`,
        text: `${bound === "hard" ? "Impossible" : "Implausible"} ${side} ${c.display.toLowerCase()}`,
        unit: c.canonicalUnit ?? undefined,
        source: "CFC-DOSSIER",
        url: DOSSIER_URL,
        verifiedOn: DRAFTED_ON,
        confidence: "design",
        status: "pending_cso",
        conceptId,
        bound,
        side,
      }),
    ),
  );
});

export type PlausibilityResult =
  /** No signed bound exists for the concept: nothing was checked (never read as "fine"). */
  | { kind: "unbounded" }
  | { kind: "ok" }
  | { kind: "confirm"; ruleId: string }
  | { kind: "reject"; ruleId: string };

/** `value` is in the concept's canonical unit (lib/units). A hard bound outranks a soft one. */
export function checkPlausibility(
  conceptId: string,
  value: number,
  refs: readonly PlausibilityRef[] = PLAUSIBILITY_REFS,
): PlausibilityResult {
  let bounded = false;
  let confirm: string | null = null;
  for (const r of refs) {
    if (r.conceptId !== conceptId) continue;
    const limit = signedNumber(r);
    if (limit === null) continue;
    bounded = true;
    const outside = r.side === "low" ? value < limit : value > limit;
    if (!outside) continue;
    if (r.bound === "hard") return { kind: "reject", ruleId: r.id };
    confirm ??= r.id;
  }
  if (confirm) return { kind: "confirm", ruleId: confirm };
  return bounded ? { kind: "ok" } : { kind: "unbounded" };
}
