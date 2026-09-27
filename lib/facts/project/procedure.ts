/** `procedures` → procedure facts. An uncoded procedure (text only) has no concept and no engine reads it. */
import type { FactConcept } from "../types";
import type { Candidate, Projection } from "./shared";
import type { procedures } from "@/db/schema/emr";

import { EMPTY, finish, isoOf, opt, sensitivityFor } from "./shared";

export type ProcedureRow = typeof procedures.$inferSelect;

export function projectProcedure(row: ProcedureRow): Projection {
  if (!row.conceptId) return EMPTY;
  const concept = row.conceptId as FactConcept;
  return finish([
    {
      id: `procedures:${row.id}`,
      logicalId: row.logicalId,
      patientId: row.patientUserId,
      tenantId: row.hospitalId,
      kind: "procedure",
      concept,
      effective: { at: isoOf(row.effectiveAt) },
      recordedAt: isoOf(row.recordedAt),
      status: row.status,
      source: row.source,
      trust: row.trust,
      sensitivity: sensitivityFor(concept, row.sensitivity),
      provenance: {
        table: "procedures",
        rowId: row.id,
        version: row.version,
        encounterId: opt(row.encounterId),
        authorId: row.recordedByUserId,
        authorCadre: opt(row.authorCadre),
      },
      outcome: row.outcome,
    } as Candidate,
  ]);
}
