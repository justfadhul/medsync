/**
 * `triage_records.vitals_snapshot` → observation facts (cfc-v1.1-addendum A6: projected, never
 * copied). The snapshot is lib/triage `TriageVitals` as the triage action stores it; a rapid Step-0
 * record stores `{ rapid: true }` and gives no facts. A null means "not measured", never zero.
 * Units are the triage engine's (NEWS2): mmHg, /min, °C, %, mmol/L.
 */
import type { ConceptId } from "../catalogue.generated";
import type { ObservationContext } from "../types";
import type { Candidate, Projection } from "./shared";
import type { triageRecords } from "@/db/schema/triage";

import { ACVPU_TO_AVPU, canonicalOf } from "./legacy-observation";
import { conceptDef, EMPTY, finish, isoOf, merge, opt, quarantine } from "./shared";

export type TriageRow = typeof triageRecords.$inferSelect;

/** Snapshot key → [concept, id component, unit as recorded]. */
const QUANTITIES: ReadonlyArray<
  readonly [key: string, concept: ConceptId, component: string, unit: string]
> = [
  ["systolicBp", "obs.bp_systolic", "sys", "mm[Hg]"],
  ["diastolicBp", "obs.bp_diastolic", "dia", "mm[Hg]"],
  ["pulse", "obs.heart_rate", "hr", "/min"],
  ["respiratoryRate", "obs.resp_rate", "rr", "/min"],
  ["temperature", "obs.temperature", "temp", "Cel"],
  ["spo2", "obs.spo2", "spo2", "%"],
  ["bloodGlucose", "obs.glucose", "glucose", "mmol/L"],
];
/** Which concepts a snapshot can give (the loader asks only for these). */
export const TRIAGE_CONCEPTS: readonly ConceptId[] = [...QUANTITIES.map((q) => q[1]), "obs.avpu"];

const OXYGEN: Readonly<Record<string, string>> = { air: "room_air", oxygen: "supplemental_oxygen" };

export function projectTriageVitals(
  row: TriageRow,
  opts: { concepts?: ReadonlySet<ConceptId> } = {},
): Projection {
  const base = `triage_records:${row.id}`;
  if (!row.patientUserId) return EMPTY; // an unidentified patient's triage belongs to nobody's record
  const snap = row.vitalsSnapshot;
  if (!snap || typeof snap !== "object" || Array.isArray(snap))
    return quarantine(base, "vitals_snapshot is not an object");
  const s = snap as Record<string, unknown>;
  const wanted = (c: ConceptId) => !opts.concepts || opts.concepts.has(c);

  const common = {
    patientId: row.patientUserId,
    tenantId: row.hospitalId,
    effective: { at: isoOf(row.triagedAt) },
    recordedAt: isoOf(row.createdAt),
    status: "final" as const,
    // Triage staff measured it at the bedside (A6).
    source: "poc_staff" as const,
    trust: 3 as const,
  };
  const envelope = (concept: ConceptId, component: string) => ({
    ...common,
    id: `${base}:${component}`,
    logicalId: `${row.id}:${component}`,
    concept,
    sensitivity: conceptDef(concept)?.sensitivity ?? "standard",
    provenance: {
      table: "triage_records",
      rowId: row.id,
      version: 1,
      authorId: opt(row.triagedByUserId),
    },
  });

  const parts: Projection[] = [];
  for (const [key, concept, component, unit] of QUANTITIES) {
    const raw = s[key];
    if (raw === null || raw === undefined || !wanted(concept)) continue;
    if (typeof raw !== "number") {
      parts.push(quarantine(`${base}:${component}`, `${key} is not a number`));
      continue;
    }
    const canonical = canonicalOf(concept, raw, unit);
    if ("error" in canonical) {
      parts.push(quarantine(`${base}:${component}`, canonical.error));
      continue;
    }
    const context: ObservationContext = {};
    if (concept === "obs.glucose") {
      // Triage never records the specimen or fasting state: never usable by a confirm lane (A6).
      context.specimen = "unknown";
      context.fastingState = "unknown";
    }
    if (concept === "obs.spo2" && typeof s.oxygen === "string" && OXYGEN[s.oxygen])
      context.qualifiers = { oxygenSupport: OXYGEN[s.oxygen] as string };
    parts.push(
      finish([
        {
          ...envelope(concept, component),
          kind: "observation",
          value: { type: "quantity", value: raw, unit, canonical },
          context,
        } as Candidate,
      ]),
    );
  }

  const acvpu = s.consciousness;
  if (acvpu !== null && acvpu !== undefined && wanted("obs.avpu")) {
    const code = typeof acvpu === "string" ? ACVPU_TO_AVPU[acvpu] : undefined;
    if (code === undefined)
      parts.push(quarantine(`${base}:avpu`, `consciousness ${String(acvpu)} is not ACVPU`));
    else if (code === null)
      parts.push(
        quarantine(
          `${base}:avpu`,
          "ACVPU 'C' (new confusion) has no AVPU answer until a concept is signed",
        ),
      );
    else
      parts.push(
        finish([
          {
            ...envelope("obs.avpu", "avpu"),
            kind: "observation",
            value: { type: "coded", code },
            context: {},
          } as Candidate,
        ]),
      );
  }
  return merge(parts);
}
