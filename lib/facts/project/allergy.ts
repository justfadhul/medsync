/**
 * `allergies` → allergy facts and `allergy_status_assertions` → assertions (cfc-v1.1-addendum A1).
 * Resolving them into an AllergyStatus is lib/emr/allergy.ts's job, not this module's.
 *
 * The substance text is ciphertext (or, for a backfilled row, lives in the untouched legacy row,
 * [D2]); a pure projection cannot read either, so the caller that may decrypt passes it in. Without
 * it the fact still says `matchedByNameOnly` when there is no code.
 */
import type { AllergyAssertion } from "../types";
import type { Candidate, Projection } from "./shared";
import type { allergies, allergyStatusAssertions } from "@/db/schema/emr";

import { AllergyAssertionSchema } from "../schemas";
import { finish, isoOf, opt } from "./shared";

export type AllergyRow = typeof allergies.$inferSelect;
export type AllergyAssertionRow = typeof allergyStatusAssertions.$inferSelect;

export function projectAllergy(row: AllergyRow, opts: { text?: string } = {}): Projection {
  return finish([
    {
      id: `allergies:${row.id}`,
      logicalId: row.logicalId,
      patientId: row.patientUserId,
      tenantId: row.hospitalId,
      kind: "allergy",
      concept: "allergy",
      effective: { at: isoOf(row.effectiveAt) },
      recordedAt: isoOf(row.recordedAt),
      status: row.status,
      source: row.source,
      trust: row.trust,
      sensitivity: row.sensitivity,
      provenance: {
        table: "allergies",
        rowId: row.id,
        version: row.version,
        encounterId: opt(row.encounterId),
        authorId: opt(row.recordedByUserId),
        authorCadre: opt(row.authorCadre),
      },
      substance: { code: opt(row.substanceCode), kind: opt(row.substanceKind), text: opts.text },
      category: opt(row.category),
      allergyType: opt(row.allergyType),
      criticality: opt(row.criticality),
      manifestations: row.manifestations,
      severity: opt(row.severity),
      clinicalStatus: row.clinicalStatus,
      verification: row.verification,
      informant: row.informant,
      // Uncoded text is still name-matched by prescribing (B4 [H]); the label says so.
      matchedByNameOnly: !row.substanceCode,
    } as Candidate,
  ]);
}

export type ProjectedAssertion =
  | { ok: true; assertion: AllergyAssertion }
  | { ok: false; id: string; reason: string };

export function projectAllergyAssertion(row: AllergyAssertionRow): ProjectedAssertion {
  const r = AllergyAssertionSchema.safeParse({
    id: row.id,
    patientId: row.patientUserId,
    tenantId: row.hospitalId,
    state: row.assertion,
    assertedBy: row.assertedByUserId,
    assertedAt: isoOf(row.assertedAt),
    recordedAt: isoOf(row.recordedAt),
    status: row.status,
    supersedesId: opt(row.supersedesId),
  });
  return r.success
    ? { ok: true, assertion: r.data }
    : {
        ok: false,
        id: `allergy_status_assertions:${row.id}`,
        reason: r.error.issues.map((i) => i.message).join("; "),
      };
}
