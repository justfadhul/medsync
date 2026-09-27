/**
 * The snapshot hash (CFC §2, §7): SHA-256 over canonical JSON of the facts, the as-of time and the
 * manifest, so an identical snapshot reproduces an identical engine output. Canonical = object keys
 * sorted, undefined dropped (as JSON.stringify does), arrays kept in their (deterministic) order.
 */
import { createHash } from "node:crypto";
import type { AllergyAssertion, ClinicalFact } from "./types";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

/** Allergy assertions (v1.1) join the hash only when the snapshot carries them. */
export function snapshotHash(input: {
  facts: readonly ClinicalFact[];
  asOf: string;
  manifest: readonly string[];
  allergyAssertions?: readonly AllergyAssertion[];
}): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
