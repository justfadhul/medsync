/**
 * `medication_statements` → medication facts, and legacy `encounter_medications` read-only beside
 * them (cfc-v1.1-addendum B5: `patient_reported`, source `imported`, trust 1). Dose, frequency and
 * every dosing field are NEVER projected: dosing belongs to the prescribing engine (CFC §4.7).
 * Medicines have no catalogue concept; they are requested as `medication` and read by class tag.
 */
import type { MedicationFact } from "../types";
import type { Candidate, Projection } from "./shared";
import type { medicationStatements } from "@/db/schema/emr";
import type { encounterMedications } from "@/db/schema/encounter";

import { DRUG_CLASS_TAGS, ENUMS } from "../catalogue.generated";
import { finish, isoOf, opt } from "./shared";

export type MedicationRow = typeof medicationStatements.$inferSelect;
export type LegacyMedicationRow = typeof encounterMedications.$inferSelect;

const restrictedTag = (tag: string) =>
  (DRUG_CLASS_TAGS as Record<string, { sensitivity: string }>)[tag]?.sensitivity === "restricted";

export function projectMedication(row: MedicationRow): Projection {
  return finish([
    {
      id: `medication_statements:${row.id}`,
      logicalId: row.logicalId,
      patientId: row.patientUserId,
      tenantId: row.hospitalId,
      kind: "medication",
      concept: "medication",
      effective: { at: isoOf(row.effectiveAt) },
      recordedAt: isoOf(row.recordedAt),
      status: row.status,
      source: row.source,
      trust: row.trust,
      // A restricted class (dolutegravir, antipsychotics, …) restricts the row whatever it says.
      sensitivity:
        row.sensitivity === "restricted" || row.classTags.some(restrictedTag)
          ? "restricted"
          : "standard",
      provenance: {
        table: "medication_statements",
        rowId: row.id,
        version: row.version,
        encounterId: opt(row.encounterId),
        authorId: row.recordedByUserId,
        authorCadre: opt(row.authorCadre),
      },
      // An uncoded medicine's name is ciphertext and never a fact: "" says "not coded".
      drug: row.drugCode ?? "",
      atc: opt(row.atcCode),
      classTags: row.classTags,
      medicationStatus: row.medicationStatus,
      period: { start: opt(row.periodStart), end: opt(row.periodEnd) },
      route: opt(row.route),
      medicationSource: row.medicationSource,
    } as Candidate,
  ]);
}

const LEGACY_STATUS: Readonly<Record<string, MedicationFact["medicationStatus"]>> = {
  active: "active",
  stopped: "stopped",
  suspended: "on_hold",
};

/** encounter_medications has no hospital: the caller passes the encounter's. */
export function projectLegacyMedication(row: LegacyMedicationRow, hospitalId: string): Projection {
  const route = row.route?.trim().toLowerCase();
  return finish([
    {
      id: `encounter_medications:${row.id}`,
      logicalId: row.id,
      patientId: row.patientUserId,
      tenantId: hospitalId,
      kind: "medication",
      concept: "medication",
      effective: { at: isoOf(row.createdAt) },
      recordedAt: isoOf(row.createdAt),
      status: "final",
      source: "imported",
      trust: 1,
      sensitivity: "standard",
      provenance: {
        table: "encounter_medications",
        rowId: row.id,
        version: 1,
        encounterId: row.encounterId,
        authorId: opt(row.authoredByUserId),
      },
      // The name as the clerking recorded it; dose, route text beyond the enum and frequency stay behind.
      drug: row.name,
      classTags: [],
      medicationStatus: LEGACY_STATUS[row.status] ?? "unknown",
      period: {},
      route: route && (ENUMS.route as readonly string[]).includes(route) ? route : undefined,
      medicationSource: "patient_reported",
    } as Candidate,
  ]);
}
