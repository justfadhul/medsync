/**
 * Pharmacy Phase 1, Step 9: the prescriber's stock line and the nurse's chip on the PGlite lane, every
 * migration replayed (0133 included). S84–S89 of docs/pharmacy/phase-1/PROMPT-PHARMACY-PHASE-1.md, H8
 * (gate-a-proposal §1), and Section 11's budget for the read (one round trip, p95 < 150 ms for five
 * medicines). Every medicine id, point, batch and quantity here is a fixture (Law 8).
 * Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Actor, Lane, Pg } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { StockLine } from "@/lib/prescribing/pharmacy";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { dxTermUuid } from "@/lib/clerking/impression/load";
import { withPatientWrite } from "@/lib/emr/write/context";
import { recordEncounterDiagnosis } from "@/lib/emr/write/facts";
import { placePlan } from "@/lib/emr/write/plan";
import { decrypt, encrypt, generateKey } from "@/lib/encryption";
import { answeredChecks } from "@/lib/pharmacy/checks";
import { availabilityFor, readStock, stockLinesFor } from "@/lib/pharmacy/stock/availability-read";
import { wardChipWords } from "@/lib/pharmacy/ward-chip";
import { loadWardChips } from "@/lib/pharmacy/ward-chip-read";
import { stockLineWords } from "@/lib/prescribing/pharmacy";
import {
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  nursingAssignment,
  patient,
  probe,
  staff,
} from "./_pglite";

vi.mock("server-only", () => ({}));

const key = () => `k-${randomUUID()}`;
const FLAGS = ["PHARMACY_WORKSPACE", "PHARMACY_STOCK_ANSWER", "PHARMACY_DISPENSING"] as const;
const flagsOn = () => FLAGS.forEach((f) => (process.env[f] = "1"));
/** Dates and times are the only figures the prescriber's words may carry. */
const DATE_TIME = /\b\d{1,2} [A-Z][a-z]{2}(, \d{2}:\d{2})?/g;

describe.skipIf(!laneOn)("the prescriber's stock line and the nurse's chip (Step 9)", () => {
  let lane: Lane;
  let pg: Pg;
  let mo: EmrActor;
  const f = {} as Record<string, string>;

  const one = async <T = { id: string }>(sql: string, p?: unknown[]) =>
    (await pg.query<T>(sql, p)).rows[0] as T;
  const rows = async <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
    (await pg.query<T>(sql, p)).rows;
  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });

  /* ─── Stock fixtures (owner inserts, as the pharmacy's store writes them) ─── */

  async function point(name: string, serves: string, hospitalId = f.h!, parent = f.pharmDept!) {
    const id = (
      await one(
        `INSERT INTO public.hospital_departments (hospital_id, parent_id, name, slug, kind)
         VALUES ($1, $2, $3, $4, 'support') RETURNING id`,
        [hospitalId, parent, name, `pt-${randomUUID()}`],
      )
    ).id;
    await pg.query(
      `INSERT INTO public.pharmacy_dispensing_points (department_id, hospital_id, serves, live_at)
       VALUES ($1, $2, $3, now() - interval '30 days')`,
      [id, hospitalId, serves],
    );
    return id;
  }
  async function product(med: string, pointId: string) {
    const id = (
      await one(
        `INSERT INTO public.pharmacy_products (hospital_id, medicine_id, name, issue_unit, created_by)
         VALUES ($1, $2, $3, 'tablet', $4) RETURNING id`,
        [f.h, med, `Fixture ${med}`, f.pharmacist],
      )
    ).id;
    await pg.query(
      `INSERT INTO public.pharmacy_product_points (product_id, dispensing_point_id, hospital_id) VALUES ($1, $2, $3)`,
      [id, pointId, f.h],
    );
    return id;
  }
  async function batch(productId: string, pointId: string) {
    return (
      await one(
        `INSERT INTO public.pharmacy_batches (hospital_id, dispensing_point_id, product_id, batch_number, expiry,
           first_batch_number, first_expiry, created_by)
         VALUES ($1, $2, $3, $4, '2099-12-31', $4, '2099-12-31', $5) RETURNING id`,
        [f.h, pointId, productId, `FX-${randomUUID().slice(0, 6)}`, f.pharmacist],
      )
    ).id;
  }
  async function move(
    batchId: string,
    pointId: string,
    kind: string,
    quantity: number,
    o: { downtime?: boolean; at?: string } = {},
  ) {
    await pg.query(
      `INSERT INTO public.pharmacy_stock_movements (hospital_id, dispensing_point_id, batch_id, kind, quantity,
         effective_at, actor_user_id, source_kind, reason_code, downtime)
       VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7, $8, $9, $10)`,
      [
        f.h,
        pointId,
        batchId,
        kind,
        quantity,
        o.at ?? null,
        f.pharmacist,
        kind === "received" ? "delivery" : "adjustment",
        kind === "adjusted" || kind === "transfer_in" ? "damaged" : null,
        o.downtime ?? false,
      ],
    );
  }
  async function count(med: string, pointId: string) {
    await pg.query(
      `INSERT INTO public.pharmacy_counts (hospital_id, dispensing_point_id, scope, medicine_id, counted_by)
       VALUES ($1, $2, 'medicine', $3, $4)`,
      [f.h, pointId, med, f.pharmacist],
    );
  }
  /** A medicine at a point: received `received`, counted, then `supplied` taken out. */
  async function stocked(
    med: string,
    pointId: string,
    o: { received?: number; supplied?: number; counted?: boolean; level?: number } = {},
  ) {
    const b = await batch(await product(med, pointId), pointId);
    await move(b, pointId, "received", o.received ?? 20);
    if (o.counted ?? true) await count(med, pointId);
    // A supply needs its hand-over (Law 3): an adjustment takes stock out here.
    if (o.supplied) await move(b, pointId, "adjusted", -o.supplied);
    if (o.level !== undefined)
      await pg.query(
        `INSERT INTO public.pharmacy_reorder_levels (hospital_id, dispensing_point_id, medicine_id, level, set_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [f.h, pointId, med, o.level, f.pharmacist],
      );
    return b;
  }

  /* ─── A visit with a problem, as write-plan.test.ts ─── */

  async function visit(type: "opd" | "inpatient" | "emergency" = "opd") {
    const p = await patient(pg);
    await pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1968-03-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Test"), encrypt("Patient"), encrypt("0700000000")],
    );
    await intake(pg, { hospitalId: f.h!, patientUserId: p });
    const e = await encounter(pg, {
      hospitalId: f.h!,
      patientUserId: p,
      clinicianUserId: mo.userId,
      departmentId: f.clinic!,
    });
    await pg.query(`UPDATE public.encounters SET encounter_type = $2 WHERE id = $1`, [e, type]);
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

  /** Ceftriaxone on sepsis with no allergy record: the cultures and allergy-status checks fire. */
  const ceftriaxone = (cond: string, stock?: "prescribe_anyway"): PlanRx => ({
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
    answers: [
      { code: "cultures", answer: "aware_monitor" },
      { code: "allergy_status", answer: "aware_monitor" },
      ...(stock ? [{ code: "stock", answer: stock } as const] : []),
    ],
    witness: null,
    weightAt: null,
    typedDose: null,
  });
  const place = (v: { p: string; e: string }, rx: PlanRx) =>
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
  const answerRow = (rx: string) =>
    rows(`SELECT * FROM public.pharmacy_stock_answers WHERE prescription_id = $1`, [rx]);

  const lines = async (encounterId: string, medicineIds: string[]) =>
    stockLinesFor(lane.db, { hospitalId: f.h!, encounterId, medicineIds, now: new Date() });

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    flagsOn();
    lane = await bootLane();
    pg = lane.pg;
    f.h = await hospital(pg, "Stock answer hospital");
    f.clinic = await department(pg, f.h, "Medicine");
    f.pharmDept = (
      await one(
        `INSERT INTO public.hospital_departments (hospital_id, name, slug, kind, catalogue_code)
         VALUES ($1, 'Pharmacy', $2, 'support', 'PHARMACY') RETURNING id`,
        [f.h, `pharmacy-${randomUUID()}`],
      )
    ).id;
    f.window = await point("Outpatient pharmacy", "window");
    f.wards = await point("Inpatient pharmacy", "wards");
    f.pharmacist = (
      await staff(pg, { hospitalId: f.h, departmentId: f.window, cadre: "PHARMACIST" })
    ).userId;
    const s = await clinician(pg, { hospitalId: f.h, departmentId: f.clinic });
    mo = {
      userId: s.userId,
      affiliationId: s.affiliationId,
      fullName: null,
      hospitalId: f.h,
      departmentId: f.clinic,
      cadreCode: "MEDICAL_OFFICER",
      isClinical: true,
      surface: "doctor",
    };
    await pg.query(
      `INSERT INTO public.clinical_cosign_policies (hospital_id, cadre_code, action_kind, requirement)
       VALUES ($1, 'MEDICAL_OFFICER', 'prescription_routine', 'allowed') ON CONFLICT DO NOTHING`,
      [f.h],
    );

    // The states of AV-3 at the window point (fixture medicine ids).
    await stocked("fx_in", f.window);
    await stocked("fx_low", f.window, { supplied: 15, level: 10 });
    await stocked("fx_out", f.window, { supplied: 20 });
    await stocked("fx_out", f.wards); // held elsewhere (AV-5)
    await product("fx_uncounted", f.window); // a product, never counted, nothing received
    const rx = await batch(await product("fx_received", f.window), f.window);
    await move(rx, f.window, "received", 5); // received, never counted
    // S87: a batch below zero (downtime), and a medicine both uncounted and at zero.
    const below = await stocked("fx_below", f.window);
    await move(below, f.window, "adjusted", -25, { downtime: true });
    const zero = await batch(await product("fx_zero", f.window), f.window);
    await move(zero, f.window, "transfer_in", 4);
    await move(zero, f.window, "adjusted", -4);
    // The medicine prescribed in S85, out at the window.
    await stocked("ceftriaxone", f.window, { supplied: 20 });
  }, 180_000);

  afterEach(flagsOn);

  /* ─── S84: each state in its words, and no figure ─── */

  it("S84: each state reads in its words at the answering point, with no quantity anywhere", async () => {
    const v = await visit("opd");
    const meds = ["fx_in", "fx_low", "fx_out", "fx_unstocked", "fx_uncounted", "fx_received"];
    const got = await lines(v.e, meds);
    const words = (m: string) => stockLineWords(got.get(m)!).replace(DATE_TIME, "{when}");
    expect(words("fx_in")).toBe("On the shelf at Outpatient pharmacy. Counted {when}.");
    expect(words("fx_low")).toBe("Low at Outpatient pharmacy. Counted {when}.");
    expect(words("fx_out")).toBe(
      "Not on the shelf at Outpatient pharmacy since {when}. In stock at Inpatient pharmacy.",
    );
    expect(words("fx_unstocked")).toBe("Not stocked at Outpatient pharmacy.");
    expect(words("fx_uncounted")).toBe(
      "Stock at Outpatient pharmacy has not been counted yet. This answer may be wrong.",
    );
    expect(words("fx_received")).toBe(
      "On the shelf at Outpatient pharmacy. Received {when}, not yet counted.",
    );
    // D-PH1-22 (the proposal, outside production): Notes and Checks, never a Stop.
    expect(meds.map((m) => got.get(m)!.level)).toEqual([
      "note",
      "note",
      "check",
      "check",
      "note",
      "note",
    ]);
    // AV-6: what reaches the prescriber holds no number; its words carry only dates and times.
    const noNumber = (l: StockLine) =>
      Object.values(l).every((x) => typeof x !== "number") &&
      !Object.keys(l).some((k) => /quantity|balance|total|level_?num/i.test(k));
    for (const m of meds) {
      expect(noNumber(got.get(m)!)).toBe(true);
      expect(stockLineWords(got.get(m)!).replace(DATE_TIME, "")).not.toMatch(/\d/);
    }
  });

  /* ─── S85: out → "Aware; prescribe anyway" → placed, stored, readable by the pharmacy ─── */

  it("S85, AV-8: a medicine that is out is prescribed anyway; the answer is stored and the pharmacy reads it", async () => {
    const v = await visit("opd");
    const r = await place(v, ceftriaxone(v.cond, "prescribe_anyway"));
    const [rx] = await rows<{
      check_answers: { code: string; answer: string; outcome: string }[];
      confirm_reason_ciphertext: string;
      confirmed_flags: string[];
    }>(
      `SELECT check_answers, confirm_reason_ciphertext, confirmed_flags FROM public.prescriptions WHERE id = $1`,
      [r.prescriptionIds[0]],
    );
    expect(rx!.check_answers).toContainEqual({
      code: "stock",
      answer: "prescribe_anyway",
      outcome: "check",
    });
    expect(decrypt(rx!.confirm_reason_ciphertext)).toContain(
      "Check pharmacy stock: Aware; prescribe anyway",
    );
    const [a] = await answerRow(r.prescriptionIds[0]!);
    expect(a).toMatchObject({
      state: "out",
      level: "check",
      answer: "prescribe_anyway",
      point_id: f.window,
      point_name: "Outpatient pharmacy",
    });
    expect(a!.last_count_at).not.toBeNull();
    expect(a!.since).not.toBeNull();
    expect(Object.keys(a!).some((k) => /quantity|balance/.test(k))).toBe(false);
    // The pharmacy's review screen reads it: under RLS as the pharmacist, and in its answered checks.
    const asPharmacist: Actor = {
      userId: f.pharmacist!,
      role: "medsync_clinical_reader",
      hospitalId: f.h,
    };
    const seen = await probe(
      pg,
      asPharmacist,
      `SELECT state, answer FROM public.pharmacy_stock_answers WHERE prescription_id = $1`,
      [r.prescriptionIds[0]],
    );
    expect(seen.ok && seen.rows).toEqual([{ state: "out", answer: "prescribe_anyway" }]);
    expect(
      answeredChecks({ checkAnswers: rx!.check_answers, confirmedFlags: rx!.confirmed_flags }),
    ).toContainEqual(
      expect.objectContaining({ code: "stock", level: "check", answer: "Aware; prescribe anyway" }),
    );
  });

  it("Law 10: a Check left unanswered (stock ran out after the dialog) still places, stored unanswered", async () => {
    const v = await visit("opd");
    const r = await place(v, ceftriaxone(v.cond));
    expect(r.prescriptionIds).toHaveLength(1);
    expect((await answerRow(r.prescriptionIds[0]!))[0]).toMatchObject({
      state: "out",
      level: "check",
      answer: null,
    });
  });

  /* ─── S86: no live point serving the patient ─── */

  it("S86: with no live point serving the patient the line is 'Pharmacy not linked yet', as today", async () => {
    const v = await visit("emergency"); // no point serves emergency
    const got = await lines(v.e, ["fx_in"]);
    expect(got.get("fx_in")).toMatchObject({ state: "not_linked", level: "not_checked" });
    expect(stockLineWords(got.get("fx_in")!)).toBe("Pharmacy not linked yet.");
    const r = await place(v, ceftriaxone(v.cond));
    expect((await answerRow(r.prescriptionIds[0]!))[0]).toMatchObject({
      state: "not_linked",
      level: "not_checked",
      point_id: null,
      answer: null,
    });
  });

  /* ─── S87: AV-3's order ─── */

  it("S87: a batch below zero answers not counted; uncounted and at zero answers not counted", async () => {
    const v = await visit("opd");
    const got = await lines(v.e, ["fx_below", "fx_zero"]);
    expect(got.get("fx_below")!.state).toBe("not_counted");
    expect(got.get("fx_zero")!.state).toBe("not_counted");
    expect(stockLineWords(got.get("fx_below")!).replace(DATE_TIME, "{when}")).toBe(
      "Stock at Outpatient pharmacy has not been counted since {when}. This answer may be wrong.",
    );
  });

  /* ─── S88: flag off → baseline ─── */

  it("S88: with pharmacyStockAnswer off, placing is the baseline: no stock answer, stock not checked", async () => {
    delete process.env.PHARMACY_STOCK_ANSWER;
    const v = await visit("opd");
    const r = await place(v, ceftriaxone(v.cond)); // out at the window, yet no answer is asked for
    expect(await answerRow(r.prescriptionIds[0]!)).toEqual([]);
    const [rx] = await rows<{ check_answers: { code: string }[] }>(
      `SELECT check_answers FROM public.prescriptions WHERE id = $1`,
      [r.prescriptionIds[0]],
    );
    expect(rx!.check_answers.map((c) => c.code).sort()).toEqual(["allergy_status", "cultures"]);
  });

  /* ─── H8: the snapshot never fails the placement ─── */

  it("H8: a failing stock-answer insert is logged and the prescription is still placed", async () => {
    await pg.exec(`
      CREATE FUNCTION public.fixture_fail_stock_answer() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$;
      CREATE TRIGGER fixture_fail BEFORE INSERT ON public.pharmacy_stock_answers
        FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_stock_answer();`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const v = await visit("opd");
      const r = await place(v, ceftriaxone(v.cond, "prescribe_anyway"));
      expect(
        await rows(`SELECT id FROM public.prescriptions WHERE id = $1`, [r.prescriptionIds[0]]),
      ).toHaveLength(1);
      expect(await answerRow(r.prescriptionIds[0]!)).toEqual([]);
      expect(warn).toHaveBeenCalledWith("pharmacy.stock_answer_failed", expect.any(String));
    } finally {
      warn.mockRestore();
      await pg.exec(`DROP TRIGGER fixture_fail ON public.pharmacy_stock_answers;
                     DROP FUNCTION public.fixture_fail_stock_answer();`);
    }
  });

  /* ─── Section 11: one round trip, p95 < 150 ms for five medicines ─── */

  it("the read is one statement, and five medicines answer within budget", async () => {
    const meds = ["fx_in", "fx_low", "fx_out", "fx_unstocked", "fx_below"];
    const query = vi.spyOn(pg, "query");
    const exec = vi.spyOn(pg, "exec");
    await readStock(lane.db, f.h!, meds);
    expect(query.mock.calls.length + exec.mock.calls.length).toBe(1);
    query.mockRestore();
    exec.mockRestore();

    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      await availabilityFor({
        database: lane.db,
        hospitalId: f.h!,
        origin: "window",
        medicineIds: meds,
        now: new Date(),
      });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
    console.warn(
      `availabilityFor, 5 medicines (PGlite): p50 ${times[20]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
    );
    expect(p95).toBeLessThan(150);
  });

  /* ─── S89: the nurse's chip ─── */

  it("S89: a new pharmacist-first ward medicine reads 'not yet reviewed', its first dose charts, and review changes the chip", async () => {
    // A signed lane rule with the typed-dose reason on (LN-1): a typed dose is pharmacist-first.
    await pg.query(
      `INSERT INTO public.pharmacy_signed_sets (hospital_id, kind, version, content, sha256, status, authored_by,
         first_signer, second_signer, signed_at)
       VALUES ($1, 'lane_rule', 1, '{"reasons":[{"code":"typed_dose","on":true}]}', repeat('b', 64), 'signed', $2, $2,
               $3, now())`,
      [f.h, f.pharmacist, mo.userId],
    );
    const v = await visit("inpatient");
    const nurse = (await staff(pg, { hospitalId: f.h!, departmentId: f.clinic!, cadre: "NURSE" }))
      .userId;
    await nursingAssignment(pg, {
      hospitalId: f.h!,
      departmentId: f.clinic!,
      nurseUserId: nurse,
      patientUserId: v.p,
    });
    const typed = (await place(v, ceftriaxone(v.cond, "prescribe_anyway"))).prescriptionIds[0]!;
    // A line from a signed regimen, unchanged: no reason fires, so it is standard lane.
    const standard = (
      await one(
        `INSERT INTO public.prescriptions (hospital_id, encounter_id, patient_user_id, prescriber_user_id,
           prescriber_cadre, drug_id, drug_name, dose, route, frequency, is_emergency, state, placement_id,
           placement_line, regimen_id, condition_id, kind)
         VALUES ($1, $2, $3, $4, 'MEDICAL_OFFICER', 'fixture_tablet', 'Fixture tablet', '[fixture dose]', 'oral',
                 '[fixture frequency]', false, 'active', $5, 1, 'fixture_regimen', $6, 'drug') RETURNING id`,
        [f.h, v.e, v.p, mo.userId, randomUUID(), v.cond],
      )
    ).id;

    const chips = () =>
      loadWardChips({ userId: nurse, hospitalId: f.h! }, [typed, standard], lane.db);
    let got = await chips();
    expect(wardChipWords(got.get(typed)!)).toBe("Pharmacy: not yet reviewed");
    expect(wardChipWords(got.get(standard)!)).toBe("Pharmacy: standard lane, not reviewed");

    // The first dose is never held: it charts while the line waits for review.
    await pg.query(
      `INSERT INTO public.medication_administration_records (hospital_id, patient_user_id, encounter_id,
         administered_by_user_id, drug_name, dose, route, state, emr_prescription_id)
       VALUES ($1, $2, $3, $4, 'Ceftriaxone', '2 g', 'iv', 'administered', $5)`,
      [f.h, v.p, v.e, nurse, typed],
    );

    // A query, then the pharmacist's acceptance.
    const q = (
      await one(
        `INSERT INTO public.pharmacy_queries (hospital_id, patient_user_id, scope, prescription_id, type_code,
           proposal, dispensing_point_id, sender_user_id)
         VALUES ($1, $2, 'line', $3, 'dose_unclear', 'Fixture proposal', $4, $5) RETURNING id`,
        [f.h, v.p, typed, f.wards, f.pharmacist],
      )
    ).id;
    got = await chips();
    expect(got.get(typed)!.kind).toBe("queried");
    expect(wardChipWords(got.get(typed)!)).toBe("Pharmacy: query with the prescriber");
    await pg.query(
      `INSERT INTO public.pharmacy_query_events (query_id, hospital_id, kind, actor_user_id)
       VALUES ($1, $2, 'withdrawn', $3)`,
      [q, f.h, f.pharmacist],
    );
    await pg.query(
      `INSERT INTO public.pharmacy_line_events (hospital_id, prescription_id, patient_user_id, dispensing_point_id,
         kind, lane, actor_user_id) VALUES ($1, $2, $3, $4, 'accepted', 'pharmacist_first', $5)`,
      [f.h, typed, v.p, f.wards, f.pharmacist],
    );
    got = await chips();
    expect(got.get(typed)!.kind).toBe("reviewed");
    expect(wardChipWords(got.get(typed)!).replace(DATE_TIME, "{time}")).toBe(
      "Pharmacy: reviewed {time}",
    );
    // Another hospital's nurse reads nothing.
    const other = await hospital(pg, "Other hospital");
    const otherNurse = (
      await staff(pg, {
        hospitalId: other,
        departmentId: await department(pg, other),
        cadre: "NURSE",
      })
    ).userId;
    expect(
      (await loadWardChips({ userId: otherNurse, hospitalId: other }, [typed], lane.db)).size,
    ).toBe(0);
  });
});
