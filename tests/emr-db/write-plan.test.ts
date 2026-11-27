/**
 * Placing the Plan (ADRs 0184–0189) on the PGlite lane: 0087–0089 replayed, the basket's orders
 * and prescriptions in one transaction with the problem, the server's own checks and answers, the
 * edits against a signed regimen, the charts the rule table opens, and the database's own rules
 * (a routine order carries its frequency, fluid entries are append-only).
 * Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import { beforeAll, describe, expect, it } from "vitest";

import { dxTermUuid, TEST_UUIDS } from "@/lib/clerking/impression/load";
import { withPatientWrite } from "@/lib/emr/write/context";
import { recordAllergy, recordEncounterDiagnosis } from "@/lib/emr/write/facts";
import { placePlan } from "@/lib/emr/write/plan";
import { decrypt, encrypt, generateKey } from "@/lib/encryption";
import {
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  patient,
} from "./_pglite";

const key = () => `k-${randomUUID()}`;

describe.skipIf(!laneOn)("placing the Plan (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let mo: EmrActor;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await lane.pg.query<T>(sql, params)).rows;
  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    const s = await clinician(lane.pg, { hospitalId: h, departmentId: dept });
    mo = {
      userId: s.userId,
      affiliationId: s.affiliationId,
      fullName: null,
      hospitalId: h,
      departmentId: dept,
      cadreCode: "MEDICAL_OFFICER",
      isClinical: true,
      surface: "doctor",
    };
  }, 180_000);

  async function visit() {
    const p = await patient(lane.pg);
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1968-03-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Test"), encrypt("Patient"), encrypt("0700000000")],
    );
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      departmentId: dept,
    });
    const dx = await as(mo, p, (ctx) =>
      recordEncounterDiagnosis(ctx, {
        patientUserId: p,
        encounterId: e,
        clientKey: key(),
        termId: dxTermUuid("dx.sepsis"),
        rank: "primary",
      }),
    );
    return { p, e, cond: dx.id };
  }

  const drug = (cond: string, over: Partial<PlanRx> = {}): PlanRx => ({
    clientKey: key(),
    kind: "drug",
    drugId: "ceftriaxone",
    conditionId: cond,
    regimenId: null,
    doseNum: 2,
    unit: "g",
    strength: null,
    route: "iv",
    method: "Intermittent infusion",
    infusionOver: "30 min",
    diluent: "Sodium chloride 0.9%",
    frequency: "daily",
    prn: false,
    course: "5d",
    start: "now",
    note: null,
    fluid: null,
    answers: [],
    witness: null,
    weightAt: null,
    typedDose: null,
    ...over,
  });
  const fluid = (cond: string): PlanRx =>
    drug(cond, {
      kind: "fluid",
      drugId: "ringers_lactate",
      doseNum: 1000,
      unit: "mL",
      method: "Gravity drip",
      infusionOver: null,
      diluent: null,
      frequency: "stat",
      course: null,
      fluid: {
        purpose: "maintenance",
        volumeMl: 1000,
        overMinutes: 480,
        delivery: "gravity",
        dropsPerMl: 20,
        warmed: false,
      },
    });
  /** The cultures and allergy-status checks fire for ceftriaxone on sepsis with no allergy record. */
  const answered = (r: PlanRx): PlanRx => ({
    ...r,
    answers: [
      { code: "cultures", answer: "aware_monitor" },
      { code: "allergy_status", answer: "aware_monitor" },
    ],
  });

  it("places orders and prescriptions for the problem, and opens the charts the rules name", async () => {
    const v = await visit();
    const r = await as(mo, v.p, (ctx) =>
      placePlan(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        orders: [
          {
            clientKey: key(),
            testId: TEST_UUIDS["test.blood_culture"]!,
            testKey: "test.blood_culture",
            display: "Blood culture",
            priority: "emergency",
            frequency: null,
            reasonConditionIds: [v.cond],
          },
          {
            clientKey: key(),
            testId: TEST_UUIDS["test.urea_electrolytes"]!,
            testKey: "test.urea_electrolytes",
            display: "U&E",
            priority: "routine",
            frequency: "daily",
            reasonConditionIds: [v.cond],
          },
        ],
        prescriptions: [
          answered(drug(v.cond)),
          { ...fluid(v.cond), answers: [{ code: "allergy_status", answer: "aware_monitor" }] },
        ],
        requests: [],
        observationFrequency: "hourly",
        measureUrine: true,
      }),
    );
    const orders = await q(
      `SELECT priority, frequency, reason_condition_ids FROM encounter_orders WHERE id = ANY($1) ORDER BY priority`,
      [r.orderIds],
    );
    expect(orders).toEqual([
      { priority: "emergency", frequency: null, reason_condition_ids: [v.cond] },
      { priority: "routine", frequency: "daily", reason_condition_ids: [v.cond] },
    ]);
    const rx = await q<Record<string, unknown>>(
      `SELECT drug_id, dose, kind, condition_id, method, infusion_over, diluent, frequency, duration, start,
              fluid_purpose, volume_ml, over_minutes, giving_set_drops_per_ml, check_answers, confirmed_flags,
              confirm_reason_ciphertext, medication_statement_id, placement_id, placement_line
         FROM prescriptions WHERE id = ANY($1) ORDER BY kind`,
      [r.prescriptionIds],
    );
    expect(rx[0]).toMatchObject({
      drug_id: "ceftriaxone",
      dose: "2 g",
      kind: "drug",
      condition_id: v.cond,
      method: "Intermittent infusion",
      infusion_over: "30 min",
      frequency: "daily",
      duration: "5d",
      start: "now",
      // The level is stored beside each answer (Pharmacy Phase 0, ADR 0233).
      check_answers: [
        { code: "cultures", answer: "aware_monitor", outcome: "check" },
        { code: "allergy_status", answer: "aware_monitor", outcome: "check" },
      ],
      confirmed_flags: ["cultures", "allergy_status"],
    });
    expect(decrypt(rx[0]!.confirm_reason_ciphertext as string)).toMatch(
      /Check allergy: Aware; will monitor.*Check cultures before antibiotics: Aware; will monitor/,
    );
    // One basket, one placement id on every line (ADR 0230).
    expect(rx[0]!.placement_id).toEqual(expect.any(String));
    expect(rx[1]!.placement_id).toBe(rx[0]!.placement_id);
    const lines = await q<{ drug_id: string; placement_line: number }>(
      `SELECT drug_id, placement_line FROM prescriptions WHERE id = ANY($1) ORDER BY placement_line`,
      [r.prescriptionIds],
    );
    // The order written is recorded: the basket's first medicine is line 1.
    expect(lines.map((l) => l.placement_line)).toEqual([1, 2]);
    expect(rx[1]).toMatchObject({
      drug_id: "ringers_lactate",
      kind: "fluid",
      fluid_purpose: "maintenance",
      volume_ml: "1000",
      over_minutes: 480,
      giving_set_drops_per_ml: 20,
    });
    const charts = await q<{
      kind: string;
      frequency: string | null;
      measure_urine: boolean;
      opened_by: { rule: string };
    }>(
      `SELECT kind, frequency, measure_urine, opened_by FROM monitoring_charts WHERE encounter_id = $1 ORDER BY kind`,
      [v.e],
    );
    expect(charts.map((c) => [c.kind, c.frequency, c.opened_by.rule])).toEqual([
      ["fluid_balance", "hourly", "fluid.iv"],
      ["mar", null, "mar.rx"],
      ["observations", "hourly", "obs.frequency"],
    ]);
    expect(charts.find((c) => c.kind === "fluid_balance")!.measure_urine).toBe(true);
  });

  it("the server re-runs the checks: an unanswered check refuses; the cultures check reads the record", async () => {
    const v = await visit();
    const place = (rx: PlanRx) =>
      as(mo, v.p, (ctx) =>
        placePlan(ctx, {
          patientUserId: v.p,
          encounterId: v.e,
          orders: [],
          prescriptions: [rx],
          requests: [],
          observationFrequency: null,
          measureUrine: false,
        }),
      );
    await expect(place(drug(v.cond))).rejects.toThrow(/Answer/);
    // No blood culture ordered: the cultures check fires too.
    await expect(
      place({ ...drug(v.cond), answers: [{ code: "allergy_status", answer: "aware_monitor" }] }),
    ).rejects.toThrow(/Cultures before antibiotics/);
    const ok = await place(answered(drug(v.cond)));
    expect(ok.prescriptionIds).toHaveLength(1);
  });

  it("an allergy stop needs an override reason, recorded encrypted", async () => {
    const v = await visit();
    await as(mo, v.p, (ctx) =>
      recordAllergy(ctx, {
        patientUserId: v.p,
        encounterId: null,
        clientKey: key(),
        substance: { text: "Cephalosporins" },
        informant: "patient",
      }),
    );
    const place = (rx: PlanRx) =>
      as(mo, v.p, (ctx) =>
        placePlan(ctx, {
          patientUserId: v.p,
          encounterId: v.e,
          orders: [],
          prescriptions: [rx],
          requests: [],
          observationFrequency: null,
          measureUrine: false,
        }),
      );
    const base = {
      ...drug(v.cond),
      answers: [{ code: "cultures", answer: "aware_monitor" as const }],
    };
    await expect(place(base)).rejects.toThrow(/Answer "Allergy"/);
    const r = await place({
      ...base,
      answers: [...base.answers, { code: "allergy", answer: "senior_agreed" }],
    });
    const [row] = await q<{ confirm_reason_ciphertext: string; check_answers: unknown }>(
      `SELECT confirm_reason_ciphertext, check_answers FROM prescriptions WHERE id = $1`,
      [r.prescriptionIds[0]],
    );
    expect(decrypt(row!.confirm_reason_ciphertext)).toMatch(
      /Override allergy: Senior reviewed and agreed/,
    );
    expect(row!.check_answers).toContainEqual({
      code: "allergy",
      answer: "senior_agreed",
      outcome: "stop",
    });
  });

  it("records edits against a signed regimen; a per-kg regimen with no weight refuses", async () => {
    const v = await visit();
    const place = (rx: PlanRx) =>
      as(mo, v.p, (ctx) =>
        placePlan(ctx, {
          patientUserId: v.p,
          encounterId: v.e,
          orders: [],
          prescriptions: [rx],
          requests: [],
          observationFrequency: null,
          measureUrine: false,
        }),
      );
    const glucose = drug(v.cond, {
      drugId: "glucose_10",
      regimenId: "glucose_10.adult.hypoglycaemia",
      doseNum: 200,
      unit: "mL",
      strength: "10%",
      method: null,
      infusionOver: null,
      diluent: null,
      frequency: "stat",
      course: null,
      answers: [{ code: "allergy_status", answer: "aware_monitor" }],
    });
    const r = await place(glucose);
    const [row] = await q<{ edits: unknown; regimen_id: string }>(
      `SELECT edits, regimen_id FROM prescriptions WHERE id = $1`,
      [r.prescriptionIds[0]],
    );
    expect(row).toEqual({
      regimen_id: "glucose_10.adult.hypoglycaemia",
      edits: [{ field: "dose", from: "150 mL", to: "200 mL" }],
    });
    await expect(
      place({ ...glucose, clientKey: key(), regimenId: "glucose_10.child.hypoglycaemia" }),
    ).rejects.toThrow(/per-kg dose cannot be placed|age band/);
  });

  it("charts open once per kind; a changed observation frequency updates the open chart", async () => {
    const v = await visit();
    const place = (observationFrequency: "hourly" | "4h") =>
      as(mo, v.p, (ctx) =>
        placePlan(ctx, {
          patientUserId: v.p,
          encounterId: v.e,
          orders: [
            {
              clientKey: key(),
              testId: TEST_UUIDS["test.fbc"]!,
              testKey: "test.fbc",
              display: "FBC",
              priority: "urgent",
              frequency: null,
              reasonConditionIds: [v.cond],
            },
          ],
          prescriptions: [],
          requests: [],
          observationFrequency,
          measureUrine: false,
        }),
      );
    await place("hourly");
    await place("4h");
    const charts = await q<{ kind: string; frequency: string }>(
      `SELECT kind, frequency FROM monitoring_charts WHERE encounter_id = $1`,
      [v.e],
    );
    expect(charts).toEqual([{ kind: "observations", frequency: "4h" }]);
    await expect(q(`DELETE FROM monitoring_charts WHERE encounter_id = $1`, [v.e])).rejects.toThrow(
      /append-only/,
    );
  });

  it("the database's own rules: routine carries a frequency; fluid entries are append-only", async () => {
    const v = await visit();
    await expect(
      q(
        `INSERT INTO encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id, lifecycle, hospital_id,
           priority, performer, intent_source, requester_cadre, effective_at, reason_text_ciphertext)
         VALUES ($1, $2, 'ecg', 'ECG', $3, 'events', $4, 'routine', 'in_house', 'clinician', 'MEDICAL_OFFICER', now(), 'x')`,
        [v.e, v.p, mo.userId, h],
      ),
    ).resolves.toBeDefined();
    const [legacy] = await q<{ frequency: string }>(
      `SELECT frequency FROM encounter_orders WHERE encounter_id = $1 AND priority = 'routine' AND frequency IS NOT NULL`,
      [v.e],
    );
    // What the code deployed before 0087 writes is kept, as a one-off.
    expect(legacy).toEqual({ frequency: "once" });
    await expect(
      q(
        `INSERT INTO encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id, lifecycle, hospital_id,
           priority, frequency, performer, intent_source, requester_cadre, effective_at, reason_text_ciphertext)
         VALUES ($1, $2, 'ecg', 'ECG', $3, 'events', $4, 'routine', 'weekly', 'in_house', 'clinician', 'MEDICAL_OFFICER', now(), 'x')`,
        [v.e, v.p, mo.userId, h],
      ),
    ).rejects.toThrow(/enc_order_frequency_check/);
    const [chart] = await q<{ id: string }>(
      `INSERT INTO monitoring_charts (hospital_id, patient_user_id, encounter_id, kind, opened_by, opened_by_user_id)
       VALUES ($1, $2, $3, 'fluid_balance', '{"rule":"fluid.iv","label":"x","items":[]}', $4) RETURNING id`,
      [h, v.p, v.e, mo.userId],
    );
    expect(chart).toBeTruthy();
    await expect(
      q(
        `INSERT INTO fluid_balance_entries (hospital_id, patient_user_id, encounter_id, kind, volume_ml, measured, effective_at, recorded_by_user_id)
         VALUES ($1, $2, $3, 'oral_in', NULL, true, now(), $4)`,
        [h, v.p, v.e, mo.userId],
      ),
    ).rejects.toThrow(/fbe_measured/);
    const [entry] = await q<{ id: string }>(
      `INSERT INTO fluid_balance_entries (hospital_id, patient_user_id, encounter_id, kind, volume_ml, measured, effective_at, recorded_by_user_id)
       VALUES ($1, $2, $3, 'urine_out', NULL, false, now(), $4) RETURNING id`,
      [h, v.p, v.e, mo.userId],
    );
    await expect(
      q(`UPDATE fluid_balance_entries SET volume_ml = 0 WHERE id = $1`, [entry!.id]),
    ).rejects.toThrow(/append-only/);
  });

  const consult = (cond: string): PlanRequestLine => ({
    clientKey: key(),
    kind: "consult",
    targetDepartmentId: dept,
    wardId: null,
    namedUserIds: [],
    urgency: "routine",
    helpWanted: "advice",
    reasonConditionIds: [cond],
    question: "Is this sepsis?",
    phoned: null,
    display: "Consult",
  });
  const oneOrder = (cond: string) => ({
    clientKey: key(),
    testId: TEST_UUIDS["test.blood_culture"]!,
    testKey: "test.blood_culture",
    display: "Blood culture",
    priority: "emergency" as const,
    frequency: null,
    reasonConditionIds: [cond],
  });
  const basket = (v: { p: string; e: string }, over: Record<string, unknown>) =>
    as(mo, v.p, (ctx) =>
      placePlan(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        orders: [],
        prescriptions: [],
        requests: [],
        observationFrequency: null,
        measureUrine: false,
        ...over,
      }),
    );

  it("places a request with the orders, in one transaction", async () => {
    const v = await visit();
    const r = await basket(v, { orders: [oneOrder(v.cond)], requests: [consult(v.cond)] });
    expect(r.requestIds).toHaveLength(1);
    expect(r.orderIds).toHaveLength(1);
    const [n] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM encounter_orders WHERE id = ANY($1)`,
      [r.orderIds],
    );
    expect(n!.n).toBe(1);
  });

  it("all or nothing: a refused request places no order", async () => {
    const v = await visit();
    // The order's own reason stays valid; only the consult's condition is superseded.
    const other = await as(mo, v.p, (ctx) =>
      recordEncounterDiagnosis(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        clientKey: key(),
        termId: dxTermUuid("dx.anaemia"),
        rank: "secondary",
      }),
    );
    await q(
      `INSERT INTO public.conditions (id, logical_id, version, supersedes_id, hospital_id, patient_user_id,
         encounter_id, effective_at, recorded_by_user_id, source, trust, category, text_ciphertext,
         clinical_status, verification, asserted_by, sensitivity, rank)
       VALUES (gen_random_uuid(), $1, 2, $1, $2, $3, $4, now(), $5, 'clinician', 3, 'encounter_diagnosis',
         'iv:tag:ct', 'active', 'confirmed', 'clinician', 'standard', 'secondary')`,
      [v.cond, h, v.p, v.e, mo.userId],
    );
    await expect(
      basket(v, { orders: [oneOrder(other.id)], requests: [consult(v.cond)] }),
    ).rejects.toThrow(/has changed or was entered in error/);
    const [o] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM encounter_orders WHERE encounter_id = $1`,
      [v.e],
    );
    const [c] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM care_requests WHERE encounter_id = $1`,
      [v.e],
    );
    expect([o!.n, c!.n]).toEqual([0, 0]);
  });

  it("a basket of only requests places", async () => {
    const v = await visit();
    const r = await basket(v, { requests: [consult(v.cond)] });
    expect(r.id).toBe(r.requestIds[0]);
    expect(r.orderIds).toEqual([]);
  });

  it("an empty basket is still refused", async () => {
    const v = await visit();
    await expect(basket(v, {})).rejects.toThrow(/The basket is empty/);
  });
});
