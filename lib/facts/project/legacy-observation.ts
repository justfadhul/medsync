/**
 * Legacy `clinical_observations` rows (concept_id null) → observation facts, read-only
 * (cfc-v1.1-addendum A6: projected, never backfilled). Nurse, triage and resus staff took these at
 * the bedside: source `poc_staff`, trust 3. Effective time is the legacy `recorded_at`; knowledge
 * time is `created_at`. `notes` is free text and never becomes a fact.
 */
import type { ConceptId } from "../catalogue.generated";
import type { ObservationContext } from "../types";
import type { ObservationRow } from "./observation";
import type { Candidate, Projection } from "./shared";

import { toCanonical, UNIT_TABLE } from "@/lib/units";
import { ENUMS } from "../catalogue.generated";
import { conceptDef, finish, isoOf, merge, opt, quarantine } from "./shared";

/** Legacy kind → concept. BP gives two facts; kinds without a concept are quarantined. */
export const LEGACY_KIND_CONCEPTS: Readonly<Record<string, readonly ConceptId[]>> = {
  bp: ["obs.bp_systolic", "obs.bp_diastolic"],
  hr: ["obs.heart_rate"],
  rr: ["obs.resp_rate"],
  temperature: ["obs.temperature"],
  spo2: ["obs.spo2"],
  glucose: ["obs.glucose"],
  pain: ["obs.pain_score"],
  weight: ["obs.weight"],
  height: ["obs.height"],
  gcs: ["obs.gcs"],
  acvpu: ["obs.avpu"],
};
/** Legacy kinds with no catalogue concept: no manifest can ask for them (A6). */
export const UNCATALOGUED_LEGACY_KINDS = [
  "etco2",
  "urine_output",
  "intake",
  "output",
  "other",
] as const;

/** Spellings the legacy writers used (resus mirrors, the nurse form) → UCUM. */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  mmhg: "mm[Hg]",
  "mm hg": "mm[Hg]",
  "mm[hg]": "mm[Hg]",
  "°c": "Cel",
  ºc: "Cel",
  c: "Cel",
  degc: "Cel",
  cel: "Cel",
  "°f": "[degF]",
  f: "[degF]",
  degf: "[degF]",
  "/min": "/min",
  bpm: "/min",
  "breaths/min": "/min",
  "beats/min": "/min",
  "%": "%",
  "/15": "{score}",
  "/10": "{score}",
  kg: "kg",
  lb: "[lb_av]",
  lbs: "[lb_av]",
  cm: "cm",
  in: "[in_i]",
  "mmol/l": "mmol/L",
  "mg/dl": "mg/dL",
};

/** ACVPU → AVPU. `C` (new confusion) has no AVPU answer: quarantined until a concept is signed. */
export const ACVPU_TO_AVPU: Readonly<Record<string, string | null>> = {
  A: "alert",
  C: null,
  V: "voice",
  P: "pain",
  U: "unresponsive",
};

type Unit = { unit: string } | { error: string };

/** Null unit = the concept's only unit when it has exactly one; otherwise the unit is unknown. */
export function legacyUnit(concept: ConceptId, raw: string | null): Unit {
  const def = conceptDef(concept);
  const canonical = def?.canonicalUnit ?? null;
  if (raw === null || raw.trim() === "") {
    return canonical && def?.acceptedUnits.length === 0
      ? { unit: canonical }
      : { error: `unit missing and ${concept} accepts more than one` };
  }
  const unit = UNIT_ALIASES[raw.trim().toLowerCase()] ?? raw.trim();
  return { unit };
}

/** Reported value + unit → the canonical copy (C4), through lib/units only. */
export function canonicalOf(
  concept: ConceptId,
  value: number,
  unit: string,
): { value: number; unit: string } | { error: string } {
  const canonical = conceptDef(concept)?.canonicalUnit ?? null;
  if (!canonical) return { error: `${concept} has no canonical unit` };
  if (UNIT_TABLE[concept]) return toCanonical(concept, value, unit);
  return unit === canonical
    ? { value, unit }
    : { error: `unit ${unit} is not accepted for ${concept}` };
}

export function projectLegacyObservation(
  row: ObservationRow,
  opts: { asOf?: Date | string } = {},
): Projection {
  const base = `clinical_observations:${row.id}`;
  if (row.conceptId) return quarantine(base, "a CFC row: use projectObservation");
  const concepts = LEGACY_KIND_CONCEPTS[row.observationKind];
  if (!concepts)
    return quarantine(base, `legacy kind ${row.observationKind} has no catalogue concept`);

  // `corrected` is a resus artefact retraction (retractMirror). The UPDATE left the row otherwise
  // byte-identical, so updated_at is the earliest it can have been known: before then it stood.
  const correctedBy =
    row.state === "corrected" &&
    !(opts.asOf && row.updatedAt.getTime() > new Date(opts.asOf).getTime());
  const common = {
    patientId: row.patientUserId,
    tenantId: row.hospitalId,
    effective: { at: isoOf(row.recordedAt) },
    recordedAt: isoOf(row.createdAt),
    status: correctedBy ? ("entered_in_error" as const) : ("final" as const),
    source: "poc_staff" as const,
    trust: 3 as const,
    provenance: {
      table: "clinical_observations",
      rowId: row.id,
      version: 1,
      encounterId: opt(row.encounterId),
      authorId: row.recordedByUserId,
    },
  };

  if (row.observationKind === "acvpu") {
    // No writer defines a value column for a legacy ACVPU row; only an exact letter in `notes` is read.
    const letter = (row.notes ?? "").trim().toUpperCase();
    const code = ACVPU_TO_AVPU[letter];
    if (code === undefined) return quarantine(base, "legacy ACVPU row carries no ACVPU letter");
    if (code === null)
      return quarantine(
        base,
        "ACVPU 'C' (new confusion) has no AVPU answer until a concept is signed",
      );
    return finish([
      {
        ...common,
        id: base,
        logicalId: row.id,
        kind: "observation",
        concept: "obs.avpu",
        sensitivity: "standard",
        value: { type: "coded", code },
        context: {},
      } as Candidate,
    ]);
  }

  const values = [row.numericValue1, row.numericValue2];
  return merge(
    concepts.map((concept, i) => {
      const suffix = concepts.length > 1 ? (i === 0 ? ":sys" : ":dia") : "";
      const id = base + suffix;
      const raw = values[i];
      if (raw === null || raw === undefined) {
        // A BP row may carry one half; a missing half is simply not a fact.
        return concepts.length > 1 ? { facts: [], quarantined: [] } : quarantine(id, "no value");
      }
      const u = legacyUnit(concept, row.unit);
      if ("error" in u) return quarantine(id, u.error);
      const value = Number(raw);
      const canonical = canonicalOf(concept, value, u.unit);
      if ("error" in canonical) return quarantine(id, canonical.error);

      const context: ObservationContext = {};
      if (concept === "obs.glucose") {
        // Specimen and fasting were never recorded: stored, never usable by a confirm lane (A6).
        context.specimen = "unknown";
        context.fastingState = "unknown";
      }
      if (
        concept === "obs.pain_score" &&
        (ENUMS.painScale as readonly string[]).includes(row.painScale ?? "")
      )
        context.qualifiers = { scale: row.painScale as string };
      return finish([
        {
          ...common,
          id,
          logicalId: row.id + suffix,
          kind: "observation",
          concept,
          sensitivity: conceptDef(concept)?.sensitivity ?? "standard",
          value: { type: "quantity", value, unit: u.unit, canonical },
          context,
        } as Candidate,
      ]);
    }),
  );
}
