/**
 * Context facts (CFC §4.10): the facility level (`hospitals.level`), its capabilities
 * (`facility_capabilities`, with the intermittent status stock-outs need) and the care setting of the
 * patient's open encounter there. Hospital setup is staff-entered: source `clinician`, trust 3.
 * Registry rows are config, updated in place, so a context fact reflects the configuration now.
 */
import type { ConceptId } from "../catalogue.generated";
import type { CareSetting } from "../types";
import type { Candidate, Projection } from "./shared";
import type { facilityCapabilities } from "@/db/schema/emr";

import { finish, isoOf } from "./shared";

export type CapabilityRow = Pick<
  typeof facilityCapabilities.$inferSelect,
  "capabilityId" | "status" | "updatedAt"
>;
export type ContextInput = {
  patientId: string;
  hospital: { id: string; level: string; updatedAt: Date };
  capabilities: readonly CapabilityRow[];
  /** The patient's in-progress encounter at this hospital, if any. */
  encounter?: { id: string; encounterType: string; createdAt: Date } | null;
};

export const CONTEXT_CONCEPTS = [
  "ctx.facility_level",
  "ctx.facility_capability",
  "ctx.care_setting",
] as const satisfies readonly ConceptId[];

/** encounters.encounter_type → CFC care setting. follow_up and procedure name no setting: no fact. */
const SETTING: Readonly<Record<string, CareSetting>> = {
  opd: "opd",
  inpatient: "ipd",
  emergency: "ed",
  antenatal: "antenatal",
  tele: "telehealth",
  virtual: "telehealth",
  community: "community_outreach",
};

export function projectContext(
  input: ContextInput,
  opts: { concepts?: ReadonlySet<ConceptId> } = {},
): Projection {
  const { hospital, patientId } = input;
  const wanted = (c: ConceptId) => !opts.concepts || opts.concepts.has(c);
  const envelope = (concept: ConceptId, id: string, table: string, rowId: string, at: Date) => ({
    id,
    logicalId: id,
    patientId,
    tenantId: hospital.id,
    kind: "context" as const,
    concept,
    effective: { at: isoOf(at) },
    recordedAt: isoOf(at),
    status: "final" as const,
    source: "clinician" as const,
    trust: 3 as const,
    sensitivity: "standard" as const,
    provenance: { table, rowId, version: 1, facilityLevel: hospital.level },
    facilityLevel: hospital.level,
  });

  const candidates: Candidate[] = [];
  if (wanted("ctx.facility_level"))
    candidates.push({
      ...envelope(
        "ctx.facility_level",
        `hospitals:${hospital.id}:level`,
        "hospitals",
        hospital.id,
        hospital.updatedAt,
      ),
      // Not a statement that nothing is available: capabilities are the ctx.facility_capability fact.
      capabilities: [],
    });
  if (wanted("ctx.facility_capability") && input.capabilities.length) {
    const caps = [...input.capabilities].sort((a, b) =>
      a.capabilityId.localeCompare(b.capabilityId),
    );
    const latest = new Date(Math.max(...caps.map((c) => c.updatedAt.getTime())));
    candidates.push({
      ...envelope(
        "ctx.facility_capability",
        `facility_capabilities:${hospital.id}`,
        "facility_capabilities",
        hospital.id,
        latest,
      ),
      capabilities: caps.map((c) => ({
        id: c.capabilityId,
        status: c.status as "available" | "intermittent" | "unavailable",
        updatedAt: isoOf(c.updatedAt),
      })),
    });
  }
  const setting = input.encounter ? SETTING[input.encounter.encounterType] : undefined;
  if (wanted("ctx.care_setting") && input.encounter && setting)
    candidates.push({
      ...envelope(
        "ctx.care_setting",
        `encounters:${input.encounter.id}:setting`,
        "encounters",
        input.encounter.id,
        input.encounter.createdAt,
      ),
      capabilities: [],
      setting,
    });
  return finish(candidates);
}
