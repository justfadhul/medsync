/**
 * CFC rows of `clinical_observations` (concept_id set; cfc-v1.1-addendum A6) → observation or
 * finding facts. `value_type = 'presence'` is a finding; everything else is an observation (a
 * finding concept with an ordinal value, sign.dehydration, reads as an observation).
 *
 * Two clocks on this table: effective = `effective_at`; knowledge time = `created_at` (the legacy
 * `recorded_at` column keeps its bedside meaning, A6).
 */
import type { FactConcept, ObservationContext, ObservationValue } from "../types";
import type { Candidate, DateOfBirth, Projection } from "./shared";
import type { clinicalObservations } from "@/db/schema/nurse-workspace";

import { conceptDef, EMPTY, finish, isoOf, opt, quarantine, sensitivityFor } from "./shared";

export type ObservationRow = typeof clinicalObservations.$inferSelect;

/** ObservationContext keys that may arrive in the `context` jsonb; anything else is a qualifier. */
const CONTEXT_KEYS = new Set<string>([
  "fastingHours",
  "idmsTraceable",
  "labId",
  "container",
  "processingDelayMinutes",
  "testPurpose",
  "qualityFlags",
  "referenceRange",
  "labInterpretation",
  "position",
  "arm",
  "cuffSize",
  "device",
  "setting",
  "readingSetId",
  "readingIndex",
  "measurement",
  "posture",
  "protocol",
  "formula",
  "windowDays",
  "sensorWearPercent",
  "laterality",
]);
/** Finding attributes that live in the jsonb for a presence row. */
const FINDING_KEYS = ["elicitedBy", "onset", "durationDays", "severity", "laterality"] as const;

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** For a non-presence row: columns (the typed home of the common keys), then the jsonb remainder.
 *  A finding concept read as an observation (sign.dehydration) keeps `elicitedBy` as a qualifier. */
function contextOf(row: ObservationRow): ObservationContext {
  const json = record(row.context);
  const ctx: Record<string, unknown> = {};
  const qualifiers: Record<string, unknown> = { ...record(json.qualifiers) };
  for (const [k, v] of Object.entries(json)) {
    if (k === "qualifiers") continue;
    if (CONTEXT_KEYS.has(k)) ctx[k] = v;
    else qualifiers[k] = v;
  }
  if (row.specimen !== null) ctx.specimen = row.specimen;
  if (row.calibration !== null) ctx.calibration = row.calibration;
  if (row.fastingState !== null) ctx.fastingState = row.fastingState;
  if (row.challenge !== null)
    ctx.challenge =
      row.challenge === "meal"
        ? { type: "meal", minutesPostMeal: row.challengeMinutes }
        : { type: row.challenge, minutesPostLoad: row.challengeMinutes };
  if (row.method !== null) ctx.method = row.method;
  if (row.certification !== null) ctx.certification = row.certification;
  if (row.pointOfCare !== null) ctx.pointOfCare = row.pointOfCare;
  if (row.deviceId !== null) ctx.deviceId = row.deviceId;
  if (Object.keys(qualifiers).length) ctx.qualifiers = qualifiers;
  // Zod (refinements.FactSchema) judges the shape; a malformed context quarantines the row.
  return ctx as ObservationContext;
}

function valueOf(row: ObservationRow, canonicalUnit: string | null): ObservationValue {
  switch (row.valueType) {
    case "quantity":
      return {
        type: "quantity",
        value: Number(row.valueNum),
        unit: row.valueUnit ?? "",
        canonical: { value: Number(row.valueCanonical), unit: canonicalUnit ?? "" },
        ...(row.valueComparator
          ? { comparator: row.valueComparator as "<" | "<=" | ">" | ">=" }
          : {}),
      };
    case "boolean":
      return { type: "boolean", value: row.valueBool as boolean };
    default: // coded, ordinal
      return { type: "coded", code: row.valueCode ?? "" };
  }
}

export function projectObservation(
  row: ObservationRow,
  opts: { dob?: DateOfBirth } = {},
): Projection {
  const id = `clinical_observations:${row.id}`;
  if (!row.conceptId)
    return quarantine(id, "not a CFC row (concept_id is null): use projectLegacyObservation");
  const def = conceptDef(row.conceptId);
  if (!def) return quarantine(id, `unknown concept ${row.conceptId}`);
  // obs.uncatalogued (as typed): stored encrypted, shown as "Uncatalogued", never a fact (A4).
  if (row.valueType === "as_typed") return EMPTY;

  const concept = row.conceptId as FactConcept;
  const json = record(row.context);
  const envelope = {
    id,
    logicalId: row.logicalId ?? row.id,
    patientId: row.patientUserId,
    tenantId: row.hospitalId,
    concept,
    effective: { at: isoOf(row.effectiveAt ?? row.recordedAt) },
    recordedAt: isoOf(row.createdAt),
    status: row.status,
    source: row.source,
    trust: row.trust,
    sensitivity: sensitivityFor(concept, row.sensitivity, {
      dob: opts.dob,
      effectiveAt: row.effectiveAt ?? row.recordedAt,
    }),
    provenance: {
      table: "clinical_observations",
      rowId: row.id,
      version: row.version ?? 1,
      encounterId: opt(row.encounterId),
      orderId: opt(row.orderId),
      authorId: row.recordedByUserId,
      authorCadre: opt(row.authorCadre),
      deviceId: opt(row.deviceId),
      labId: typeof json.labId === "string" ? json.labId : undefined,
    },
  };

  const candidate =
    row.valueType === "presence"
      ? {
          ...envelope,
          kind: "finding" as const,
          token: def.symptomCode ?? row.conceptId,
          presence: row.presence,
          ...Object.fromEntries(
            FINDING_KEYS.filter((k) => json[k] !== undefined).map((k) => [k, json[k]]),
          ),
        }
      : {
          ...envelope,
          kind: "observation" as const,
          value: valueOf(row, def.canonicalUnit),
          context: contextOf(row),
        };
  // The row's text columns are CHECK-constrained to the CFC enums; Zod re-checks them in finish().
  return finish([candidate as unknown as Candidate]);
}
