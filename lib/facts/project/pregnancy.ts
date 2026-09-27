/**
 * `pregnancy_episodes` → pregnancy facts, one per catalogue concept the episode has a value for
 * (CFC §4.8: pregnancy is an episode, not a flag). `logical_id` is the episode. Gestational age is
 * derived, never stored: days from the LMP to the fact's effective date, basis `lmp`. No obstetric
 * constant is used, so an episode with an EDD but no LMP gives no gestational age.
 */
import type { ConceptId } from "../catalogue.generated";
import type { PregnancyFact } from "../types";
import type { Candidate, DateOfBirth, Projection } from "./shared";
import type { pregnancyEpisodes } from "@/db/schema/emr";

import { finish, isoOf, opt, sensitivityFor } from "./shared";

export type PregnancyRow = typeof pregnancyEpisodes.$inferSelect;

export const PREGNANCY_CONCEPTS = [
  "preg.status",
  "preg.gestational_age",
  "preg.edd",
  "preg.outcome",
  "preg.birth_weight",
] as const satisfies readonly ConceptId[];

const DAY_MS = 86_400_000;

export function projectPregnancy(
  row: PregnancyRow,
  opts: { concepts?: ReadonlySet<ConceptId>; dob?: DateOfBirth } = {},
): Projection {
  const effective = isoOf(row.effectiveAt);
  const gestation = row.lnmp
    ? {
        days: Math.floor((Date.parse(effective.slice(0, 10)) - Date.parse(row.lnmp)) / DAY_MS),
        basis: "lmp" as const,
        asOf: effective.slice(0, 10),
      }
    : undefined;

  // Each concept carries only its own value (C10), plus what its required context needs.
  const values: Record<(typeof PREGNANCY_CONCEPTS)[number], Partial<PregnancyFact> | null> = {
    "preg.status": {},
    "preg.gestational_age": gestation ? { gestation } : null,
    "preg.edd": row.edd ? { edd: row.edd, gestation } : null,
    "preg.outcome": row.outcome
      ? {
          outcome: row.outcome as PregnancyFact["outcome"],
          deliveredAt: row.deliveredAt ? isoOf(row.deliveredAt) : undefined,
        }
      : null,
    "preg.birth_weight":
      row.birthWeightGrams !== null ? { birthWeightGrams: row.birthWeightGrams } : null,
  };

  const candidates: Candidate[] = [];
  for (const concept of PREGNANCY_CONCEPTS) {
    const value = values[concept];
    if (!value || (opts.concepts && !opts.concepts.has(concept))) continue;
    const component = concept === "preg.status" ? "" : `:${concept.slice("preg.".length)}`;
    // A termination is sexual and reproductive health (D-CFC-09): restricted on every fact of the episode.
    const sensitivity =
      row.outcome === "termination"
        ? "restricted"
        : sensitivityFor(concept, row.sensitivity, { dob: opts.dob, effectiveAt: row.effectiveAt });
    candidates.push({
      id: `pregnancy_episodes:${row.id}${component}`,
      logicalId: `${row.logicalId}${component}`,
      patientId: row.patientUserId,
      tenantId: row.hospitalId,
      kind: "pregnancy",
      concept,
      effective: { at: effective },
      recordedAt: isoOf(row.recordedAt),
      status: row.status,
      source: row.source,
      trust: row.trust,
      sensitivity,
      provenance: {
        table: "pregnancy_episodes",
        rowId: row.id,
        version: row.version,
        encounterId: opt(row.encounterId),
        authorId: row.recordedByUserId,
        authorCadre: opt(row.authorCadre),
      },
      episodeId: row.logicalId,
      state: row.pregnancyState,
      ...value,
    } as Candidate);
  }
  return finish(candidates);
}
