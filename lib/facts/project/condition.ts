/**
 * `conditions` rows → condition facts, and the two legacy tables projected read-only beside them
 * (cfc-v1.1-addendum B5): `problem_list` and `encounter_diagnoses`, source `imported`, trust 1
 * (CFC: T1 = unverified import). A condition reaches an engine only through a concept: its own
 * `concept_id`, its diagnosis term's, or, for a legacy row, its ICD-10 code matched to a concept's
 * ICD-10 (WHO) mapping. An uncoded condition is shown by the chart and read by no engine.
 */
import type { ConceptId } from "../catalogue.generated";
import type { ConditionFact, FactConcept } from "../types";
import type { Candidate, DateOfBirth, Projection } from "./shared";
import type { conditions } from "@/db/schema/emr";
import type { encounterDiagnoses, problemList } from "@/db/schema/encounter";

import { DIAGNOSIS_TERMS_RESTRICTED_FOR_MINORS } from "../catalogue.generated";
import { EMPTY, finish, isoOf, opt, possiblyMinorAt, sensitivityFor } from "./shared";

export type ConditionRow = typeof conditions.$inferSelect;
export type ProblemListRow = typeof problemList.$inferSelect;
export type EncounterDiagnosisRow = typeof encounterDiagnoses.$inferSelect;

const MINOR_TERMS = new Set<string>(Object.values(DIAGNOSIS_TERMS_RESTRICTED_FOR_MINORS));

export function projectCondition(
  row: ConditionRow,
  opts: { termConceptId?: string | null; dob?: DateOfBirth } = {},
): Projection {
  const concept = (row.conceptId ?? opts.termConceptId ?? null) as FactConcept | null;
  if (!concept) return EMPTY;
  let sensitivity = sensitivityFor(concept, row.sensitivity);
  // D-CFC-09: pregnancy diagnoses (pre-eclampsia, …) are restricted for minors, like pregnancy facts.
  if (
    row.termId &&
    MINOR_TERMS.has(row.termId) &&
    opts.dob &&
    possiblyMinorAt(opts.dob, row.effectiveAt)
  )
    sensitivity = "restricted";
  return finish([
    {
      id: `conditions:${row.id}`,
      logicalId: row.logicalId,
      patientId: row.patientUserId,
      tenantId: row.hospitalId,
      kind: "condition",
      concept,
      effective: { at: isoOf(row.effectiveAt) },
      recordedAt: isoOf(row.recordedAt),
      status: row.status,
      source: row.source,
      trust: row.trust,
      sensitivity,
      provenance: {
        table: "conditions",
        rowId: row.id,
        version: row.version,
        encounterId: opt(row.encounterId),
        authorId: row.recordedByUserId,
        authorCadre: opt(row.authorCadre),
      },
      clinicalStatus: row.clinicalStatus,
      verification: row.verification,
      assertedBy: row.assertedBy,
      subject: row.subjectRelation,
      onset: opt(row.onset),
      abatement: row.abatementAt ? isoOf(row.abatementAt) : undefined,
      stage: opt(row.stage),
      codes: { icd11: opt(row.icd11Code), ciel: opt(row.cielId) },
    } as Candidate,
  ]);
}

/* ─── Legacy ─── */

export type ConceptCodes = { id: string; codes: unknown };

/**
 * ICD-10 code → concept, from the concepts' own ICD-10 (WHO) mappings (clinical_concepts.codes).
 * Exact code first, then the 3-character category ("E11.9" → E11). Ranges ("B20-B24") are not
 * expanded, and a code two concepts share maps to neither: a guess would be a fabricated diagnosis.
 */
export function icd10ConceptIndex(
  concepts: readonly ConceptCodes[],
): (code: string | null) => ConceptId | null {
  const byCode = new Map<string, Set<string>>();
  for (const c of concepts) {
    for (const code of Array.isArray(c.codes)
      ? (c.codes as { system?: unknown; code?: unknown }[])
      : []) {
      if (
        code.system !== "ICD-10 (WHO)" ||
        typeof code.code !== "string" ||
        /[-,\s]/.test(code.code)
      )
        continue;
      const key = code.code.toUpperCase();
      let hits = byCode.get(key);
      if (!hits) byCode.set(key, (hits = new Set()));
      hits.add(c.id);
    }
  }
  const one = (key: string) => {
    const hit = byCode.get(key);
    return hit && hit.size === 1 ? ([...hit][0] as ConceptId) : null;
  };
  return (code) => {
    if (!code) return null;
    const k = code.trim().toUpperCase();
    return byCode.has(k) ? one(k) : one(k.slice(0, 3));
  };
}

const legacyEnvelope = (
  table: string,
  id: string,
  patientId: string,
  tenantId: string,
  concept: ConceptId,
  at: Date,
  authorId: string | null,
) => ({
  id: `${table}:${id}`,
  logicalId: id,
  patientId,
  tenantId,
  kind: "condition" as const,
  concept,
  effective: { at: isoOf(at) },
  recordedAt: isoOf(at),
  status: "final" as const,
  source: "imported" as const,
  trust: 1 as const,
  sensitivity: sensitivityFor(concept, null),
  provenance: { table, rowId: id, version: 1, authorId: opt(authorId) },
  assertedBy: "clinician" as const,
  subject: "self" as const,
});

/** problem_list has no verification: `unconfirmed`, and `active` false = resolved. */
export function projectLegacyProblem(row: ProblemListRow, concept: ConceptId | null): Projection {
  if (!concept) return EMPTY;
  const fact: Omit<ConditionFact, "interpretable"> = {
    ...legacyEnvelope(
      "problem_list",
      row.id,
      row.patientUserId,
      row.hospitalId,
      concept,
      row.createdAt,
      row.authoredByUserId,
    ),
    clinicalStatus: row.active ? "active" : "resolved",
    verification: "unconfirmed",
    abatement: row.resolvedAt ? isoOf(row.resolvedAt) : undefined,
    codes: { icd10: opt(row.icd10Code) },
  };
  return finish([fact as Candidate]);
}

const DX_VERIFICATION: Readonly<Record<string, ConditionFact["verification"]>> = {
  working: "provisional",
  final: "confirmed",
  excluded: "refuted",
};

/** encounter_diagnoses has no hospital: the caller passes the encounter's. */
export function projectLegacyDiagnosis(
  row: EncounterDiagnosisRow,
  concept: ConceptId | null,
  hospitalId: string,
): Projection {
  if (!concept) return EMPTY;
  const fact = {
    ...legacyEnvelope(
      "encounter_diagnoses",
      row.id,
      row.patientUserId,
      hospitalId,
      concept,
      row.createdAt,
      row.authoredByUserId,
    ),
    provenance: {
      table: "encounter_diagnoses",
      rowId: row.id,
      version: 1,
      encounterId: row.encounterId,
      authorId: opt(row.authoredByUserId),
    },
    clinicalStatus: "active",
    verification: DX_VERIFICATION[row.status],
    codes: { icd10: opt(row.icd10Code) },
  };
  return finish([fact as Candidate]);
}
