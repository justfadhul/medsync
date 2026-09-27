import "server-only";

import type { ConceptId } from "./catalogue.generated";
import type { DateOfBirth, Projection } from "./project/shared";
import type { AllergyAssertion, ClinicalFact, FactConcept, FactSnapshot } from "./types";
import type { EmrTx } from "@/lib/emr/db";
import { and, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import {
  allergies,
  allergyStatusAssertions,
  clinicalConcepts,
  conditions,
  diagnosisTerms,
  facilityCapabilities,
  medicationStatements,
  pregnancyEpisodes,
  procedures,
} from "@/db/schema/emr";
import { encounterDiagnoses, encounterMedications, problemList } from "@/db/schema/encounter";
import { hospitals } from "@/db/schema/hospitals";
import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { encounters } from "@/db/schema/scheduling";
import { triageRecords } from "@/db/schema/triage";
import { resolveAllergyTexts } from "@/lib/emr/read/allergies";
import { snapshotHash } from "./hash";
import { projectAllergy, projectAllergyAssertion } from "./project/allergy";
import {
  icd10ConceptIndex,
  projectCondition,
  projectLegacyDiagnosis,
  projectLegacyProblem,
} from "./project/condition";
import { projectContext } from "./project/context";
import { projectDemographics } from "./project/demographic";
import { LEGACY_KIND_CONCEPTS, projectLegacyObservation } from "./project/legacy-observation";
import { projectLegacyMedication, projectMedication } from "./project/medication";
import { projectObservation } from "./project/observation";
import { projectPregnancy } from "./project/pregnancy";
import { projectProcedure } from "./project/procedure";
import { merge } from "./project/shared";
import { projectTriageVitals, TRIAGE_CONCEPTS } from "./project/triage-vitals";
import { isFactConcept, RULES } from "./refinements";

/**
 * loadFactSnapshot (CFC §7): the one read path from the record to an engine.
 *
 * - C10: only the manifest's concepts are queried; a legacy or triage source is read only when it
 *   can give a requested concept, and the patient profile only for demographics.
 * - C8: as of a knowledge time, each logical item is its newest version recorded at or before
 *   `asOf`; an item whose newest version is entered in error or cancelled is dropped (the `_current`
 *   views keep them, so this filters here). Rows are filtered by concept in SQL, which relies on the
 *   write paths' invariant that every version of a logical item keeps its concept (a different
 *   concept is a different item). A self-join on logical_id instead was O(n²) on stale statistics.
 * - C11: a row that fails projection is counted in `quarantined`, never thrown.
 * - The fact order and the hash are deterministic: the same record and `asOf` give the same hash.
 *
 * `tx` is an EMR transaction (lib/emr/db.ts): interactive reads run under asClinicalReader, so RLS
 * decides what exists; a sweep runs under its own role and the caller logs the run. The facility for
 * context facts is the transaction's `app.hospital_id`.
 */
export type LoadOptions = {
  manifest: readonly string[];
  asOf?: Date;
  purpose: "interactive" | "sweep";
  /** Observations only: older effective times are left out. Conditions, medicines and the rest are longitudinal. */
  lookbackYears?: number;
  /** The most recent N facts per concept. */
  perConceptCap?: number;
  /** Display only (the chart): keep items whose newest version is entered in error, so they stay
   *  visible struck through (Law 4). Engines never pass it: for them a voided item is gone. */
  keepEnteredInError?: boolean;
};

const DROPPED = new Set(["entered_in_error", "cancelled"]);

const at = (f: ClinicalFact) => ("at" in f.effective ? f.effective.at : f.effective.start);

/** Concept, then newest effective time first, then id: total and stable. */
function compareFacts(a: ClinicalFact, b: ClinicalFact): number {
  if (a.concept !== b.concept) return a.concept < b.concept ? -1 : 1;
  const ta = at(a);
  const tb = at(b);
  if (ta !== tb) return ta < tb ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The newest version per logical item (rows arrive in any order). */
function newest<R extends { logicalId: string; version: number }>(rows: readonly R[]): R[] {
  const byItem = new Map<string, R>();
  for (const r of rows) {
    const cur = byItem.get(r.logicalId);
    if (!cur || r.version > cur.version) byItem.set(r.logicalId, r);
  }
  return [...byItem.values()];
}

export function validateManifest(manifest: readonly string[]): FactConcept[] {
  const out = [...new Set(manifest)].sort();
  for (const id of out) {
    if (!isFactConcept(id)) throw new Error(`manifest: unknown concept ${id}`);
    // A4: never in a manifest, never interpretable, never exported.
    if (id === "obs.uncatalogued") throw new Error("manifest: obs.uncatalogued is never loaded");
  }
  return out as FactConcept[];
}

async function currentHospitalId(tx: EmrTx): Promise<string | null> {
  const r = (await tx.execute(
    sql`SELECT nullif(current_setting('app.hospital_id', true), '') AS h`,
  )) as unknown as { rows?: { h: string | null }[] } | { h: string | null }[];
  // postgres-js returns the rows array; PGlite returns { rows } (as lib/emr/access.ts).
  return (Array.isArray(r) ? r : (r.rows ?? []))[0]?.h ?? null;
}

export async function loadFactSnapshot(
  tx: EmrTx,
  patientUserId: string,
  opts: LoadOptions,
): Promise<FactSnapshot> {
  const manifest = validateManifest(opts.manifest);
  const asOf = opts.asOf ?? new Date();
  const wanted = new Set<FactConcept>(manifest);
  const ofKind = (...kinds: string[]) =>
    manifest.filter((c) => kinds.includes(RULES.get(c)?.kind ?? "")) as ConceptId[];

  const obsConcepts = ofKind("observation", "finding");
  const condConcepts = ofKind("condition");
  const pregConcepts = ofKind("pregnancy");
  const procConcepts = ofKind("procedure");
  const demoConcepts = ofKind("demographic");
  const ctxConcepts = ofKind("context");
  const parts: Projection[] = [];
  let quarantined = 0;

  // The profile is read only for demographics (C10). Sensitivity, incl. SR-PREG-MINOR, is written
  // into each row at insert (A3); when the DOB is in hand anyway it re-applies the rule, only ever raising.
  const needsDob = demoConcepts.length > 0;
  const profile = needsDob
    ? (
        await tx
          .select({
            id: patientProfiles.id,
            sex: patientProfiles.sex,
            dateOfBirth: patientProfiles.dateOfBirth,
            primaryFacilityId: patientProfiles.primaryFacilityId,
            createdAt: patientProfiles.createdAt,
          })
          .from(patientProfiles)
          .where(and(eq(patientProfiles.id, patientUserId), lte(patientProfiles.createdAt, asOf)))
      )[0]
    : undefined;
  const dob: DateOfBirth | undefined = profile
    ? { value: profile.dateOfBirth, precision: "day" }
    : undefined;
  if (profile && demoConcepts.length)
    parts.push(projectDemographics(profile, { concepts: new Set(demoConcepts) }));

  /* ─── Observations and findings: CFC rows, legacy rows, triage snapshots ─── */
  if (obsConcepts.length) {
    const o = clinicalObservations;
    const rows = await tx
      .select()
      .from(o)
      .where(
        and(
          eq(o.patientUserId, patientUserId),
          inArray(o.conceptId, obsConcepts),
          // Knowledge time on this table is created_at (A6).
          lte(o.createdAt, asOf),
        ),
      );
    for (const row of newest(
      rows.map((r) => ({ ...r, logicalId: r.logicalId ?? r.id, version: r.version ?? 1 })),
    ))
      parts.push(projectObservation(row, { dob }));

    const kinds = Object.entries(LEGACY_KIND_CONCEPTS)
      .filter(([, cs]) => cs.some((c) => wanted.has(c)))
      .map(([k]) => k);
    if (kinds.length) {
      const legacy = await tx
        .select()
        .from(o)
        .where(
          and(
            eq(o.patientUserId, patientUserId),
            isNull(o.conceptId),
            inArray(o.observationKind, kinds),
            lte(o.createdAt, asOf),
          ),
        );
      for (const row of legacy) parts.push(projectLegacyObservation(row, { asOf }));
    }

    const triageWanted = TRIAGE_CONCEPTS.filter((c) => wanted.has(c));
    if (triageWanted.length) {
      const triage = await tx
        .select()
        .from(triageRecords)
        .where(
          and(eq(triageRecords.patientUserId, patientUserId), lte(triageRecords.createdAt, asOf)),
        );
      for (const row of triage)
        parts.push(projectTriageVitals(row, { concepts: new Set(triageWanted) }));
    }
  }

  /* ─── Conditions (+ legacy problem list and encounter diagnoses) ─── */
  if (condConcepts.length) {
    const terms = await tx
      .select({ id: diagnosisTerms.id, conceptId: diagnosisTerms.conceptId })
      .from(diagnosisTerms)
      .where(inArray(diagnosisTerms.conceptId, condConcepts));
    const termConcept = new Map(terms.map((t) => [t.id, t.conceptId]));
    const c = conditions;
    const rows = await tx
      .select()
      .from(c)
      .where(
        and(
          eq(c.patientUserId, patientUserId),
          terms.length
            ? or(inArray(c.conceptId, condConcepts), inArray(c.termId, [...termConcept.keys()]))
            : inArray(c.conceptId, condConcepts),
          lte(c.recordedAt, asOf),
        ),
      );
    for (const row of newest(rows))
      parts.push(
        projectCondition(row, {
          termConceptId: row.termId ? termConcept.get(row.termId) : null,
          dob,
        }),
      );

    const codes = await tx
      .select({ id: clinicalConcepts.id, codes: clinicalConcepts.codes })
      .from(clinicalConcepts)
      .where(inArray(clinicalConcepts.id, condConcepts));
    const conceptFor = icd10ConceptIndex(codes);
    const problems = await tx
      .select()
      .from(problemList)
      .where(
        and(
          eq(problemList.patientUserId, patientUserId),
          isNotNull(problemList.icd10Code),
          lte(problemList.createdAt, asOf),
        ),
      );
    for (const row of problems) parts.push(projectLegacyProblem(row, conceptFor(row.icd10Code)));
    const diagnoses = await tx
      .select({ row: encounterDiagnoses, hospitalId: encounters.hospitalId })
      .from(encounterDiagnoses)
      .innerJoin(encounters, eq(encounters.id, encounterDiagnoses.encounterId))
      .where(
        and(
          eq(encounterDiagnoses.patientUserId, patientUserId),
          isNotNull(encounterDiagnoses.icd10Code),
          lte(encounterDiagnoses.createdAt, asOf),
        ),
      );
    for (const d of diagnoses)
      parts.push(projectLegacyDiagnosis(d.row, conceptFor(d.row.icd10Code), d.hospitalId));
  }

  /* ─── Medicines (+ legacy encounter medications) ─── */
  if (wanted.has("medication")) {
    const m = medicationStatements;
    const rows = await tx
      .select()
      .from(m)
      .where(and(eq(m.patientUserId, patientUserId), lte(m.recordedAt, asOf)));
    for (const row of newest(rows)) parts.push(projectMedication(row));
    const legacy = await tx
      .select({ row: encounterMedications, hospitalId: encounters.hospitalId })
      .from(encounterMedications)
      .innerJoin(encounters, eq(encounters.id, encounterMedications.encounterId))
      .where(
        and(
          eq(encounterMedications.patientUserId, patientUserId),
          lte(encounterMedications.createdAt, asOf),
        ),
      );
    for (const l of legacy) parts.push(projectLegacyMedication(l.row, l.hospitalId));
  }

  /* ─── Pregnancy, procedures ─── */
  if (pregConcepts.length) {
    const rows = await tx
      .select()
      .from(pregnancyEpisodes)
      .where(
        and(
          eq(pregnancyEpisodes.patientUserId, patientUserId),
          lte(pregnancyEpisodes.recordedAt, asOf),
        ),
      );
    for (const row of newest(rows))
      parts.push(projectPregnancy(row, { concepts: new Set(pregConcepts), dob }));
  }
  if (procConcepts.length) {
    const p = procedures;
    const rows = await tx
      .select()
      .from(p)
      .where(
        and(
          eq(p.patientUserId, patientUserId),
          inArray(p.conceptId, procConcepts),
          lte(p.recordedAt, asOf),
        ),
      );
    for (const row of newest(rows)) parts.push(projectProcedure(row));
  }

  /* ─── Allergies and NKDA / unable-to-assess assertions ─── */
  let allergyAssertions: AllergyAssertion[] | undefined;
  if (wanted.has("allergy")) {
    const rows = await tx
      .select()
      .from(allergies)
      .where(and(eq(allergies.patientUserId, patientUserId), lte(allergies.recordedAt, asOf)));
    // Uncoded text is encrypted and backfilled text lives in its source: without resolving both,
    // the safety bar would name no substance. The definer-function path works under the reader.
    const texts = new Map(
      (await resolveAllergyTexts(tx, rows, "reader")).map((r) => [r.id, r.substanceText]),
    );
    for (const row of newest(rows))
      parts.push(projectAllergy(row, { text: texts.get(row.id) ?? undefined }));
    const asserted = await tx
      .select()
      .from(allergyStatusAssertions)
      .where(
        and(
          eq(allergyStatusAssertions.patientUserId, patientUserId),
          lte(allergyStatusAssertions.recordedAt, asOf),
        ),
      );
    allergyAssertions = [];
    for (const row of asserted) {
      const a = projectAllergyAssertion(row);
      if (a.ok) allergyAssertions.push(a.assertion);
      else quarantined++;
    }
    allergyAssertions.sort((a, b) =>
      a.assertedAt === b.assertedAt ? (a.id < b.id ? -1 : 1) : a.assertedAt < b.assertedAt ? 1 : -1,
    );
  }

  /* ─── Context: the facility this transaction acts for ─── */
  if (ctxConcepts.length) {
    const hospitalId = await currentHospitalId(tx);
    const hospital = hospitalId
      ? (
          await tx
            .select({ id: hospitals.id, level: hospitals.level, updatedAt: hospitals.updatedAt })
            .from(hospitals)
            .where(eq(hospitals.id, hospitalId))
        )[0]
      : undefined;
    if (hospital) {
      const capabilities = ctxConcepts.includes("ctx.facility_capability")
        ? await tx
            .select({
              capabilityId: facilityCapabilities.capabilityId,
              status: facilityCapabilities.status,
              updatedAt: facilityCapabilities.updatedAt,
            })
            .from(facilityCapabilities)
            .where(
              and(
                eq(facilityCapabilities.hospitalId, hospital.id),
                lte(facilityCapabilities.createdAt, asOf),
              ),
            )
        : [];
      const encounter = ctxConcepts.includes("ctx.care_setting")
        ? (
            await tx
              .select({
                id: encounters.id,
                encounterType: encounters.encounterType,
                createdAt: encounters.createdAt,
              })
              .from(encounters)
              .where(
                and(
                  eq(encounters.patientUserId, patientUserId),
                  eq(encounters.hospitalId, hospital.id),
                  eq(encounters.state, "in_progress"),
                  lte(encounters.createdAt, asOf),
                ),
              )
              .orderBy(desc(encounters.createdAt), encounters.id)
              .limit(1)
          )[0]
        : undefined;
      parts.push(
        projectContext(
          { patientId: patientUserId, hospital, capabilities, encounter },
          { concepts: new Set(ctxConcepts) },
        ),
      );
    }
  }

  /* ─── Assemble ─── */
  const all = merge(parts);
  quarantined += all.quarantined.length;
  const cutoff =
    opts.lookbackYears === undefined
      ? null
      : new Date(
          Date.UTC(
            asOf.getUTCFullYear() - opts.lookbackYears,
            asOf.getUTCMonth(),
            asOf.getUTCDate(),
          ),
        ).toISOString();
  let facts = all.facts.filter(
    (f) =>
      wanted.has(f.concept) &&
      (!DROPPED.has(f.status) || (opts.keepEnteredInError && f.status === "entered_in_error")) &&
      !(cutoff && (f.kind === "observation" || f.kind === "finding") && at(f) < cutoff),
  );
  facts.sort(compareFacts);
  if (opts.perConceptCap !== undefined) {
    const seen = new Map<string, number>();
    facts = facts.filter((f) => {
      const n = (seen.get(f.concept) ?? 0) + 1;
      seen.set(f.concept, n);
      return n <= (opts.perConceptCap ?? n);
    });
  }

  const asOfIso = asOf.toISOString();
  return {
    patientId: patientUserId,
    asOf: asOfIso,
    manifest,
    facts,
    ...(allergyAssertions ? { allergyAssertions } : {}),
    quarantined,
    hash: snapshotHash({ facts, asOf: asOfIso, manifest, allergyAssertions }),
  };
}
