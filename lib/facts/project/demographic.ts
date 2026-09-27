/**
 * The patient profile → demographic facts (CFC §4.9). Only id, sex, date of birth and the primary
 * facility are read; names and contact fields never leave the table (C10). The profile is written at
 * patient self-signup: source `patient_reported`, trust 1. It holds a full date, so precision is
 * `day` (0071 added no dob_precision column). `prefer_not_say` is `unknown`: sex at birth is for
 * physiological calculations only and is never guessed.
 *
 * The CFC type carries both fields on every demographic fact, so a manifest asking for one concept
 * receives both values on it.
 */
import type { ConceptId } from "../catalogue.generated";
import type { DemographicFact } from "../types";
import type { Candidate, Projection } from "./shared";
import type { patientProfiles } from "@/db/schema/patient-profiles";

import { finish, isoOf } from "./shared";

export type DemographicRow = Pick<
  typeof patientProfiles.$inferSelect,
  "id" | "sex" | "dateOfBirth" | "primaryFacilityId" | "createdAt"
>;

export const DEMOGRAPHIC_CONCEPTS = [
  "demo.date_of_birth",
  "demo.sex_at_birth",
] as const satisfies readonly ConceptId[];

const SEX: Readonly<Record<string, DemographicFact["sexAtBirth"]>> = {
  female: "female",
  male: "male",
  intersex: "intersex",
};

/** No facility recorded it when the patient self-registered with none chosen. */
export const NO_FACILITY = "unaffiliated";

export function projectDemographics(
  row: DemographicRow,
  opts: { concepts?: ReadonlySet<ConceptId> } = {},
): Projection {
  return finish(
    DEMOGRAPHIC_CONCEPTS.filter((c) => !opts.concepts || opts.concepts.has(c)).map(
      (concept) =>
        ({
          id: `patient_profiles:${row.id}:${concept === "demo.date_of_birth" ? "dob" : "sex"}`,
          logicalId: `${row.id}:${concept}`,
          patientId: row.id,
          tenantId: row.primaryFacilityId ?? NO_FACILITY,
          kind: "demographic",
          concept,
          effective: { at: isoOf(row.createdAt) },
          recordedAt: isoOf(row.createdAt),
          status: "final",
          source: "patient_reported",
          trust: 1,
          sensitivity: "standard",
          provenance: { table: "patient_profiles", rowId: row.id, version: 1 },
          dateOfBirth: { value: row.dateOfBirth, precision: "day" },
          sexAtBirth: SEX[row.sex] ?? "unknown",
        }) as Candidate,
    ),
  );
}
