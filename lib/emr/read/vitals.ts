import "server-only";

import type { EmrDb, EmrTx } from "@/lib/emr/db";
import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { LEGACY_KIND_CONCEPTS } from "@/lib/facts/project/legacy-observation";
import { conceptDef } from "@/lib/facts/project/shared";

/**
 * CFC vital-sign rows (concept group `vitals`) in the legacy reader shape (STOP 2 carried item), so
 * the NCD prefill, the triage trend and the nurse patient page show one vital-signs series under
 * EMR v1. The legacy readers keep `state = 'active'`, which never matches a CFC row (`state =
 * 'fact'`), so merging these in cannot double count. Current version only; voided rows dropped.
 * Values are canonical (the concept's unit), so a Fahrenheit entry reads in Celsius. A value a lab
 * report carries (a venous glucose) is a result, not a vital, and never joins the series: the NCD
 * prefill would otherwise take it as a capillary point-of-care glucose.
 *
 * Callers gate on `emrV1Live()` (on anywhere = 0071 applied), not per hospital: a vital is the
 * patient's wherever it was taken, and the legacy reads it joins have no hospital filter either.
 */
export interface CfcVital {
  id: string;
  /** The legacy `observation_kind` the concept maps to (bp, hr, rr, temperature, …). */
  kind: string;
  value1: number | null;
  value2: number | null;
  unit: string | null;
  recordedAt: Date;
}

const KIND_OF = new Map<string, string>();
for (const [kind, concepts] of Object.entries(LEGACY_KIND_CONCEPTS)) {
  for (const c of concepts) {
    if (conceptDef(c)?.valueType === "quantity") KIND_OF.set(c, kind);
  }
}
const DISPLAY_UNIT: Record<string, string | null> = {
  "mm[Hg]": "mmHg",
  Cel: "°C",
  "{score}": null,
};

export async function loadCfcVitals(
  tx: EmrTx | EmrDb,
  patientUserId: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<CfcVital[]> {
  const co = clinicalObservations;
  const rows = await tx
    .select({
      id: co.id,
      conceptId: co.conceptId,
      value: co.valueCanonical,
      effectiveAt: co.effectiveAt,
      encounterId: co.encounterId,
      readingSetId: sql<string | null>`${co.context}->>'readingSetId'`,
    })
    .from(co)
    .where(
      and(
        eq(co.patientUserId, patientUserId),
        inArray(co.conceptId, [...KIND_OF.keys()]),
        notInArray(co.status, ["entered_in_error", "cancelled"]),
        isNull(co.reportId),
        sql`NOT EXISTS (SELECT 1 FROM public.clinical_observations s WHERE s.supersedes_id = ${co.id})`,
        opts.since ? gte(co.effectiveAt, opts.since) : undefined,
      ),
    )
    .orderBy(desc(co.effectiveAt))
    .limit(opts.limit ?? 200);

  const out: CfcVital[] = [];
  // Systolic and diastolic are two facts; the legacy shape is one `bp` row with two values.
  const bp = new Map<string, CfcVital>();
  for (const r of rows) {
    if (!r.conceptId || !r.effectiveAt || r.value === null) continue;
    const kind = KIND_OF.get(r.conceptId)!;
    const unit = conceptDef(r.conceptId)?.canonicalUnit ?? null;
    const value = Number(r.value);
    if (kind !== "bp") {
      out.push({
        id: r.id,
        kind,
        value1: value,
        value2: null,
        unit: unit !== null && unit in DISPLAY_UNIT ? (DISPLAY_UNIT[unit] ?? null) : unit,
        recordedAt: r.effectiveAt,
      });
      continue;
    }
    const key = r.readingSetId ?? `${r.encounterId}:${r.effectiveAt.toISOString()}`;
    let row = bp.get(key);
    if (!row) {
      row = { id: r.id, kind, value1: null, value2: null, unit: "mmHg", recordedAt: r.effectiveAt };
      bp.set(key, row);
      out.push(row);
    }
    if (r.conceptId === "obs.bp_systolic") row.value1 = value;
    else row.value2 = value;
  }
  return out;
}
