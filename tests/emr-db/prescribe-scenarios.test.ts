/**
 * The one Prescribe, acceptance scenarios S1–S3 (prescribing kit §4) on the PGlite lane: 0279
 * replayed, the session the dialog opens with, "Sign and send" through placePlan with the place,
 * the server's own checks and answers, the pharmacy's view of what the prescriber saw, and the draft
 * kept on close. Fictional patients (the kit's demo script). Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { PlanBasketRx } from "@/lib/clerking/plan/draft";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import { beforeAll, describe, expect, it } from "vitest";

import { RX_CHECKS } from "@/content/pharmacy-rework-daily";
import { loadPrescribeSession } from "@/lib/emr/read/prescribe";
import { withPatientWrite } from "@/lib/emr/write/context";
import { recordAllergy, recordObservations } from "@/lib/emr/write/facts";
import { keepPrescribeDraft, loadPlanFacts, sendPrescribed } from "@/lib/emr/write/plan";
import { encrypt, generateKey } from "@/lib/encryption";
import { rxFlags } from "@/lib/pharmacy/derive/checks";
import { drugById } from "@/lib/prescribing/formulary";
import { egfrOf, needingAnswer, planChecks } from "@/lib/prescribing/plan-checks";
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

describe.skipIf(!laneOn)("the one Prescribe, S1–S3 (PGlite lane)", () => {
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
    process.env.ENCOUNTER_ENGINE_LIVE = "1";
    process.env.EMR_V1 = "1";
    process.env.EMR_PRESCRIBING = "1";
    process.env.PRESCRIBE_V2 = "1";
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

  async function person(o: { first: string; last: string; sex: string; dob: string }) {
    const p = await patient(lane.pg);
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, $4, $5, 'none', $6, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt(o.first), encrypt(o.last), o.sex, o.dob, encrypt("0700000000")],
    );
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      departmentId: dept,
    });
    return { p, e };
  }

  const line = (over: Partial<PlanRx>): PlanRx => ({
    clientKey: key(),
    kind: "drug",
    drugId: "amoxicillin",
    conditionId: null,
    regimenId: null,
    doseNum: 250,
    unit: "mg",
    strength: null,
    route: "oral",
    method: null,
    infusionOver: null,
    diluent: null,
    frequency: "8h",
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

  /** The checks the server will run, from the record: what the dialog shows for this line. */
  async function checksFor(p: string, rx: PlanRx) {
    const facts = await as(mo, p, (ctx) => loadPlanFacts(ctx.tx, p, ctx.now));
    return {
      facts,
      checks: planChecks(drugById(rx.drugId)!, rx, {
        ...facts,
        kidneyTestPlanned: false,
        sepsisTypeProblem: false,
        bloodCulture: "none",
        others: [],
        cosign: "allowed",
        v2: true,
      }),
    };
  }

  /** Answers every check that needs one the way a prescriber would: a word, or "Other" with words. */
  const answerAll = (rx: PlanRx, checks: Awaited<ReturnType<typeof checksFor>>["checks"]) => ({
    ...rx,
    answers: needingAnswer(checks).map((c) =>
      c.code === "kidney"
        ? { code: c.code, answer: "other" as const, text: "Interval extended and levels booked" }
        : { code: c.code, answer: "senior_agreed" as const },
    ),
  });

  it("S1: clinic visit, a 3-year-old's amoxicillin: quantity worked out from the brand, then 'Waiting at pharmacy'", async () => {
    const v = await person({ first: "Mugisha", last: "Ivan", sex: "male", dob: "2023-06-01" });
    await as(mo, v.p, (ctx) =>
      recordObservations(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        clientKey: key(),
        observations: [
          { conceptId: "obs.weight", value: { type: "quantity", value: 13, unit: "kg" } },
        ],
      }),
    );
    const [product] = await q<{ id: string }>(
      `INSERT INTO public.pharmacy_products (hospital_id, medicine_id, name, manufacturer, strength, pack_size,
         issue_unit, created_by)
       VALUES ($1, 'amoxicillin', 'Amoxicillin suspension', 'Fictional Pharma', '125 mg/5 mL', '100 mL', 'bottle', $2)
       RETURNING id`,
      [h, mo.userId],
    );
    const opened = await as(mo, v.p, (ctx) =>
      loadPrescribeSession(ctx, { patientUserId: v.p, encounterId: v.e, place: "clinic" }),
    );
    expect(opened.collect).toBe("Main window");
    expect(opened.patient).toEqual({ name: "Mugisha Ivan", mrn: expect.any(String) });
    expect(opened.facts).toMatchObject({ ageYears: 3, sex: "male", weight: { kg: 13 } });

    const rx = line({ productId: product!.id });
    const { checks } = await checksFor(v.p, rx);
    const sent = await as(mo, v.p, (ctx) =>
      sendPrescribed(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        place: "clinic",
        lines: [answerAll(rx, checks)],
      }),
    );
    const [row] = await q(
      `SELECT prescribe_place, product_id, quantity, dose, concentration FROM prescriptions WHERE id = $1`,
      [sent.prescriptionIds[0]],
    );
    expect(row).toEqual({
      prescribe_place: "clinic",
      product_id: product!.id,
      // 250 mg 8-hourly × 5 days from 125 mg/5 mL: 150 mL → two 100 mL bottles, worked out on the server.
      quantity: "2 bottles of 100 mL (150 mL for 15 doses)",
      dose: "250 mg",
      concentration: "125 mg/5 mL",
    });
    const after = await as(mo, v.p, (ctx) =>
      loadPrescribeSession(ctx, { patientUserId: v.p, encounterId: v.e, place: "clinic" }),
    );
    expect(after.placed).toHaveLength(1);
    expect(after.placed[0]).toMatchObject({ drugId: "amoxicillin", word: "Waiting at pharmacy" });
    expect(after.placed[0]!.display).toContain("2 bottles of 100 mL");

    // A brand of another medicine is refused, whatever the screen sent.
    await expect(
      as(mo, v.p, (ctx) =>
        sendPrescribed(ctx, {
          patientUserId: v.p,
          encounterId: v.e,
          place: "clinic",
          lines: [answerAll(line({ drugId: "paracetamol", productId: product!.id }), checks)],
        }),
      ),
    ).rejects.toThrow(/brand is not stocked/);
  });

  it("S2: ward round, penicillin allergy and creatinine 168: cross-reactivity and eGFR, overridden with reasons, seen by the pharmacy", async () => {
    const v = await person({ first: "Namusoke", last: "Grace", sex: "female", dob: "1974-05-01" });
    await lane.pg.query(`UPDATE public.encounters SET encounter_type = 'inpatient' WHERE id = $1`, [
      v.e,
    ]);
    await as(mo, v.p, async (ctx) => {
      await recordAllergy(ctx, {
        patientUserId: v.p,
        encounterId: null,
        clientKey: key(),
        substance: { text: "Penicillin" },
        informant: "patient",
      });
      await recordObservations(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        clientKey: key(),
        observations: [
          { conceptId: "obs.weight", value: { type: "quantity", value: 64, unit: "kg" } },
          { conceptId: "obs.creatinine", value: { type: "quantity", value: 168, unit: "umol/L" } },
        ],
      });
    });
    const cef = line({
      drugId: "ceftriaxone",
      doseNum: 1,
      unit: "g",
      route: "iv",
      frequency: "daily",
    });
    const gent = line({
      drugId: "gentamicin",
      doseNum: 320,
      unit: "mg",
      route: "iv",
      frequency: "daily",
    });
    const c1 = await checksFor(v.p, cef);
    const c2 = await checksFor(v.p, gent);
    const allergy = c1.checks.find((c) => c.code === "allergy")!;
    expect(allergy.outcome).toBe("check");
    expect(allergy.message).toMatch(/Penicillin.*cross-reaction is possible/);
    const kidney = c2.checks.find((c) => c.code === "kidney")!;
    expect(kidney.outcome).toBe("check");
    const e = egfrOf(c2.facts)!;
    expect(kidney.message).toContain(`eGFR ${e.value} mL/min/1.73 m²`);
    expect(kidney.message).toContain("CKD-EPI 2021");

    const send = (lines: PlanRx[]) =>
      as(mo, v.p, (ctx) =>
        sendPrescribed(ctx, { patientUserId: v.p, encounterId: v.e, place: "ward", lines }),
      );
    // Unanswered, the server refuses: the checks are enforced in the action, not only shown.
    await expect(send([cef])).rejects.toThrow(/Answer "Allergy" to continue/);
    const sent = await send([answerAll(cef, c1.checks), answerAll(gent, c2.checks)]);
    const rows = await q<{
      id: string;
      drug_id: string;
      prescribe_place: string;
      check_answers: { code: string; answer: string; outcome: string }[];
      confirmed_flags: string[];
    }>(
      `SELECT id, drug_id, prescribe_place, check_answers, confirmed_flags FROM prescriptions
        WHERE id = ANY($1) ORDER BY placement_line`,
      [sent.prescriptionIds],
    );
    expect(rows.map((r) => r.prescribe_place)).toEqual(["ward", "ward"]);
    expect(rows[0]!.check_answers).toContainEqual({
      code: "allergy",
      answer: "senior_agreed",
      outcome: "check",
    });
    expect(rows[1]!.check_answers).toContainEqual({
      code: "kidney",
      answer: "other",
      outcome: "check",
    });
    // The pharmacy's checks panel reads what the prescriber saw and answered.
    const flags = rxFlags(
      rows.map((r) => ({
        id: r.id,
        checkAnswers: r.check_answers,
        confirmedFlags: r.confirmed_flags,
      })),
    );
    expect(flags).toContainEqual(
      expect.objectContaining({
        lineId: rows[0]!.id,
        code: "allergy",
        title: "Allergy",
        level: "check",
        prescriberAnswer: "Senior reviewed and agreed",
      }),
    );
    expect(flags).toContainEqual(
      expect.objectContaining({ lineId: rows[1]!.id, code: "kidney", title: "Kidney function" }),
    );
    expect(RX_CHECKS.prescriberSaid).toMatch(/^Prescriber saw/);
  });

  it("S3: closed with two lines, the draft comes back on Resume; sending removes it", async () => {
    const v = await person({ first: "Draft", last: "Patient", sex: "male", dob: "1980-01-01" });
    const basket = (rx: PlanRx): PlanBasketRx => ({
      ...rx,
      display: rx.drugId,
      drugName: rx.drugId,
      problemLogicalId: null,
    });
    const two = [
      basket(line({ drugId: "paracetamol", doseNum: 1000 })),
      basket(line({ drugId: "amlodipine", doseNum: 5, frequency: "daily" })),
    ];
    const open = () =>
      as(mo, v.p, (ctx) =>
        loadPrescribeSession(ctx, { patientUserId: v.p, encounterId: v.e, place: "clinic" }),
      );
    expect((await open()).draft).toBeNull();
    await as(mo, v.p, (ctx) =>
      keepPrescribeDraft(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        place: "clinic",
        lines: two,
      }),
    );
    const resumed = await open();
    expect(resumed.draft?.lines.map((l) => [l.clientKey, l.drugId, l.doseNum])).toEqual(
      two.map((l) => [l.clientKey, l.drugId, l.doseNum]),
    );
    // Kept again (one row per author, visit and place), then another place has its own.
    await as(mo, v.p, (ctx) =>
      keepPrescribeDraft(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        place: "clinic",
        lines: two.slice(0, 1),
      }),
    );
    expect((await open()).draft?.lines).toHaveLength(1);
    const going = await as(mo, v.p, (ctx) =>
      loadPrescribeSession(ctx, { patientUserId: v.p, encounterId: v.e, place: "going_home" }),
    );
    expect(going.draft).toBeNull();
    // An empty basket closes the draft.
    await as(mo, v.p, (ctx) =>
      keepPrescribeDraft(ctx, { patientUserId: v.p, encounterId: v.e, place: "clinic", lines: [] }),
    );
    expect((await open()).draft).toBeNull();
  });
});
