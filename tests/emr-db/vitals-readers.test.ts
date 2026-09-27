/**
 * Legacy vitals readers see CFC vital-sign rows under EMR v1 (STOP 2 carried item): the NCD prefill,
 * the triage trend and the nurse patient page (loadCfcVitals) show one series. The real readers run
 * against the PGlite lane (`@/db` is the lane's drizzle). Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { bootLane, clinician, department, encounter, hospital, laneOn, patient } from "./_pglite";

vi.mock("@/db", async () => {
  const { bootLane: boot } = await import("./_pglite");
  return { db: (await boot()).db };
});

const saved = { emr: process.env.EMR_V1, engine: process.env.ENCOUNTER_ENGINE_LIVE };

describe.skipIf(!laneOn)("legacy vitals readers see CFC rows (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let nurse: string;
  let p: string;

  /** One CFC quantity fact, written as the owner (fixture values, not clinical limits). */
  async function fact(o: {
    concept: string;
    value: number;
    unit: string;
    at: string;
    set?: string;
    status?: string;
    logicalId?: string;
    version?: number;
    supersedesId?: string;
  }): Promise<string> {
    const id = randomUUID();
    await lane.pg.query(
      `INSERT INTO public.clinical_observations (id, hospital_id, patient_user_id, recorded_by_user_id,
         observation_kind, state, concept_id, logical_id, version, supersedes_id, category, value_type,
         value_num, value_unit, value_canonical, context, source, trust, status, sensitivity, effective_at,
         note_ciphertext)
       VALUES ($1, $2, $3, $4, 'fact', 'fact', $5, $6, $7, $8, 'vital_sign', 'quantity', $9, $10, $9,
         $11::jsonb, 'poc_staff', 3, $12, 'standard', $13,
         CASE WHEN $12 = 'entered_in_error' THEN 'iv:tag:ct' END)`,
      [
        id,
        h,
        p,
        nurse,
        o.concept,
        o.logicalId ?? id,
        o.version ?? 1,
        o.supersedesId ?? null,
        o.value,
        o.unit,
        JSON.stringify(o.set ? { readingSetId: o.set } : {}),
        o.status ?? "final",
        o.at,
      ],
    );
    return id;
  }

  beforeAll(async () => {
    process.env.EMR_V1 = "1";
    process.env.ENCOUNTER_ENGINE_LIVE = "1";
    lane = await bootLane();
    h = await hospital(lane.pg);
    const dept = await department(lane.pg, h);
    nurse = (await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" }))
      .userId;
    p = await patient(lane.pg);
    const at = new Date(Date.now() - 3_600_000).toISOString();
    await fact({ concept: "obs.bp_systolic", value: 130, unit: "mm[Hg]", at, set: "rs-1" });
    await fact({ concept: "obs.bp_diastolic", value: 85, unit: "mm[Hg]", at, set: "rs-1" });
    // A voided pulse: its entered-in-error version supersedes it, so neither shows.
    const pulse = await fact({ concept: "obs.heart_rate", value: 90, unit: "/min", at });
    await fact({
      concept: "obs.heart_rate",
      value: 90,
      unit: "/min",
      at,
      status: "entered_in_error",
      logicalId: pulse,
      version: 2,
      supersedesId: pulse,
    });
  }, 180_000);

  afterAll(() => {
    process.env.EMR_V1 = saved.emr;
    process.env.ENCOUNTER_ENGINE_LIVE = saved.engine;
  });

  it("loadCfcVitals (nurse page) pairs a CFC BP into one legacy-shaped row, voided rows dropped", async () => {
    const { loadCfcVitals } = await import("@/lib/emr/read/vitals");
    const rows = await loadCfcVitals(lane.db, p);
    expect(rows).toEqual([
      expect.objectContaining({ kind: "bp", value1: 130, value2: 85, unit: "mmHg" }),
    ]);
  });

  it("the triage trend (fetchRecentVitals) sees the CFC BP", async () => {
    const { fetchRecentVitals } = await import("@/lib/triage/worklist");
    const rows = await fetchRecentVitals({ patientUserId: p });
    expect(rows).toEqual([
      expect.objectContaining({ kind: "bp", value1: 130, value2: 85, unit: "mmHg" }),
    ]);
  });

  it("the NCD prefill (loadLatestVitals) sees the CFC BP", async () => {
    const { loadLatestVitals } = await import("@/lib/ncd/vitals");
    const { DIABETES_CATALOG } = await import("@/lib/ncd/catalog/diabetes");
    const pull = await loadLatestVitals(p, DIABETES_CATALOG);
    const byFeature = Object.fromEntries(pull.vitals.map((v) => [v.feature, v.value]));
    expect(byFeature).toEqual({ bp_systolic: 130, bp_diastolic: 85 });
    expect(pull.anyFromTriage).toBe(false);
  });

  it("a lab-reported glucose is a result, not a vital: the NCD prefill never takes it as capillary", async () => {
    const q = await patient(lane.pg);
    const enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: q,
      clinicianUserId: nurse,
    });
    const one = async (sql: string, params: unknown[]) =>
      (await lane.pg.query<{ id: string }>(sql, params)).rows[0]!.id;
    const order = await one(
      `INSERT INTO public.encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id, lifecycle,
         hospital_id, priority, performer, intent_source, requester_cadre, effective_at, reason_text_ciphertext)
       VALUES ($1, $2, 'ecg', 'x', $3, 'events', $4, 'routine', 'in_house', 'clinician', 'MEDICAL_OFFICER', now(),
         'iv:tag:ct') RETURNING id`,
      [enc, q, nurse, h],
    );
    const report = await one(
      `INSERT INTO public.diagnostic_reports (id, logical_id, version, hospital_id, patient_user_id, encounter_id,
         recorded_by_user_id, effective_at, source, trust, status, sensitivity, order_id, kind, issued_at, performer,
         entry_mode, entered_by_user_id, critical)
       VALUES ($1, $1, 1, $2, $3, $4, $5, now(), 'lab', 4, 'final', 'standard', $6, 'lab', now(), 'in_house',
         'direct', $5, false) RETURNING id`,
      [randomUUID(), h, q, enc, nurse, order],
    );
    const id = randomUUID();
    await lane.pg.query(
      `INSERT INTO public.clinical_observations (id, hospital_id, patient_user_id, recorded_by_user_id,
         observation_kind, state, concept_id, logical_id, version, category, value_type, value_num, value_unit,
         value_canonical, context, source, trust, status, sensitivity, effective_at, report_id, entry_mode, specimen)
       VALUES ($1, $2, $3, $4, 'fact', 'fact', 'obs.glucose', $1, 1, 'laboratory', 'quantity', 7, 'mmol/L', 7,
         '{}'::jsonb, 'lab', 4, 'final', 'standard', now(), $5, 'direct', 'venous_plasma')`,
      [id, h, q, nurse, report],
    );
    const { loadCfcVitals } = await import("@/lib/emr/read/vitals");
    expect(await loadCfcVitals(lane.db, q)).toEqual([]);
    const { loadLatestVitals } = await import("@/lib/ncd/vitals");
    const { DIABETES_CATALOG } = await import("@/lib/ncd/catalog/diabetes");
    expect((await loadLatestVitals(q, DIABETES_CATALOG)).values).not.toHaveProperty(
      "capillary_glucose",
    );
  });

  it("flag off: the readers are unchanged (no CFC row)", async () => {
    const { fetchRecentVitals } = await import("@/lib/triage/worklist");
    process.env.EMR_V1 = "";
    try {
      expect(await fetchRecentVitals({ patientUserId: p })).toEqual([]);
    } finally {
      process.env.EMR_V1 = "1";
    }
  });
});
