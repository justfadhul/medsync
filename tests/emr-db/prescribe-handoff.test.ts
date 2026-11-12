/**
 * The one Prescribe's pharmacy hand-off, acceptance scenario S4 (prescribing kit §4, F4) on the PGlite
 * lane: the pharmacy queries a line → the prescriber answers "Change it" from "already prescribed" →
 * the pharmacy hands over with the identity and counselling confirmation (0280). A controlled line
 * needs the witness (the controlled supply). A resus line is never dispensed: the cart check restocks
 * it. Each step is read back as the prescriber's word. Fixture products and batches; fictional
 * patient. Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { PharmacyActor, PharmacyCtx, PharmacyNeed } from "@/lib/pharmacy/write";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import type { z } from "zod";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { PRESCRIBE_HANDOFF_COPY } from "@/content/pharmacy-prescriber";
import { medicationAdministrationRecords as mar } from "@/db/schema/nurse-workspace";
import { encrypt, generateKey } from "@/lib/encryption";
import { PHARMACY_MAP_V2, pharmacyDispensingAccess } from "@/lib/pharmacy/access";
import {
  bootLane,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  patient,
  staff,
} from "./_pglite";

vi.mock("server-only", () => ({}));
const held = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return held.db;
  },
}));

const { withPatientWrite } = await import("@/lib/emr/write/context");
const { loadPlanFacts, sendPrescribed } = await import("@/lib/emr/write/plan");
const { loadPrescribeSession } = await import("@/lib/emr/read/prescribe");
const { needingAnswer, planChecks } = await import("@/lib/prescribing/plan-checks");
const { drugById } = await import("@/lib/prescribing/formulary");
const { runPharmacyWrite } = await import("@/lib/pharmacy/write");
const review = await import("@/lib/pharmacy/review/store");
const reviewRead = await import("@/lib/pharmacy/review/read");
const supply = await import("@/lib/pharmacy/supply/store");
const rxChecks = await import("@/lib/pharmacy/rx-checks-store");
const { liveDose } = await import("@/lib/pharmacy/clinical/read");

const W = PRESCRIBE_HANDOFF_COPY.line;

describe.skipIf(!laneOn)("the pharmacy hand-off, S4 (PGlite lane)", () => {
  let lane: Lane;
  let pg: Pg;
  const f = {} as Record<string, string>;
  let mo: EmrActor;

  const one = async <T = { id: string }>(q: string, p?: unknown[]) =>
    (await pg.query<T>(q, p)).rows[0] as T;
  const actor = (userId: string, cadre: string): PharmacyActor => ({
    userId,
    hospitalId: f.h!,
    cadreCode: cadre,
    cadreName: cadre === "PHARMACIST" ? "Pharmacist" : "Pharmacy technician",
    pointId: f.point!,
    access: pharmacyDispensingAccess(cadre, PHARMACY_MAP_V2),
  });
  const pharmacist = () => actor(f.pharmacist!, "PHARMACIST");
  const run = <I, R extends { id: string }>(
    a: PharmacyActor,
    schema: z.ZodType<I>,
    need: PharmacyNeed,
    write: (ctx: PharmacyCtx, input: I) => Promise<R>,
    raw: Record<string, unknown>,
  ) =>
    runPharmacyWrite(schema, { clientKey: randomUUID(), ...raw }, a, need, write, {
      database: lane.db,
    });
  const as = <T>(fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(mo, f.patient!, fn, { database: lane.db });
  const session = () =>
    as((ctx) =>
      loadPrescribeSession(ctx, {
        patientUserId: f.patient!,
        encounterId: f.visit!,
        place: "clinic",
      }),
    );
  const wordOf = async (id: string) => (await session()).placed.find((p) => p.id === id)?.word;

  /** One line written straight to the record (the pharmacy's fixtures do the same). */
  const written = async (o: { drug: string; place: string; controlled?: boolean }) =>
    (
      await one(
        `INSERT INTO public.prescriptions
           (hospital_id, encounter_id, patient_user_id, prescriber_user_id, prescriber_cadre, drug_id, drug_name,
            dose, route, frequency, is_emergency, state, placement_id, placement_line, check_answers, controlled,
            prescribe_place, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'MEDICAL_OFFICER', $5, $5, '[fixture dose]', 'oral', '[fixture frequency]', false,
                 'active', $6, 1, '[]'::jsonb, $7, $8, now(), now())
         RETURNING id`,
        [f.h, f.visit, f.patient, mo.userId, o.drug, randomUUID(), o.controlled ?? false, o.place],
      )
    ).id;
  const product = async (medicine: string) => {
    const id = (
      await one(
        `INSERT INTO public.pharmacy_products (hospital_id, medicine_id, name, issue_unit, created_by)
         VALUES ($1, $2, $3, 'tablet', $4) RETURNING id`,
        [f.h, medicine, `Fixture ${medicine}`, f.pharmacist],
      )
    ).id;
    await pg.query(
      `INSERT INTO public.pharmacy_product_points (product_id, dispensing_point_id, hospital_id) VALUES ($1, $2, $3)`,
      [id, f.point, f.h],
    );
    const batch = (
      await one(
        `INSERT INTO public.pharmacy_batches (hospital_id, dispensing_point_id, product_id, batch_number, expiry,
           first_batch_number, first_expiry, created_by)
         VALUES ($1, $2, $3, 'FX-S4', '2099-03-31', 'FX-S4', '2099-03-31', $4) RETURNING id`,
        [f.h, f.point, id, f.pharmacist],
      )
    ).id;
    await pg.query(
      `INSERT INTO public.pharmacy_stock_movements (hospital_id, dispensing_point_id, batch_id, kind, quantity,
         effective_at, actor_user_id, source_kind)
       VALUES ($1, $2, $3, 'received', 100, now() - interval '50 days', $4, 'delivery')`,
      [f.h, f.point, batch, f.pharmacist],
    );
    return { id, batch };
  };
  const stage = (lineId: string, quantity: number) =>
    run(pharmacist(), review.DecisionsInput, review.DISPENSE_NEED, review.saveLineDecisions, {
      decisions: [{ lineId, kind: "full", quantity }],
    });
  const handover = async (
    lineId: string,
    p: { id: string; batch: string },
    explained?: boolean,
  ) => {
    const clientKey = randomUUID();
    await run(
      pharmacist(),
      supply.IdentifierInput,
      supply.DISPENSE_LIVE,
      supply.checkSecondIdentifier,
      { clientKey, lineId, kind: "date_of_birth", typed: "01/07/1988" },
    );
    return runPharmacyWrite(
      supply.HandoverInput,
      {
        clientKey,
        lines: [
          {
            lineId,
            productId: p.id,
            rows: [{ batchId: p.batch, quantity: 10 }],
            strengthConfirmed: true,
          },
        ],
        collector: { kind: "patient" },
        identity: { route: "two_identifiers", nameAttested: true },
        payment: { status: "paid" },
        ...(explained === undefined ? {} : { explainedAttested: explained }),
      },
      pharmacist(),
      supply.DISPENSE_LIVE,
      // Kit F4: the action passes PRESCRIBE_V2 as `explainRequired`.
      (ctx, input) =>
        supply.recordHandover(ctx, input, null, { patientList: false, explainRequired: true }),
      { database: lane.db },
    );
  };
  const inQueue = async (lineId: string) =>
    (await reviewRead.getReviewQueue(f.h!, f.point!, lane.db)).rows.some(
      (r) => r.firstLineId === lineId,
    );

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    process.env.ENCOUNTER_ENGINE_LIVE = "1";
    process.env.EMR_V1 = "1";
    process.env.EMR_PRESCRIBING = "1";
    process.env.PRESCRIBE_V2 = "1";
    process.env.PHARMACY_CORE = "1";
    lane = await bootLane();
    pg = lane.pg;
    held.db = lane.db;
    f.h = await hospital(pg, "Hand-off");
    const pharm = (
      await one(
        `INSERT INTO public.hospital_departments (hospital_id, name, slug, kind, catalogue_code)
         VALUES ($1, 'Pharmacy', $2, 'support', 'PHARMACY') RETURNING id`,
        [f.h, `ph-${randomUUID()}`],
      )
    ).id;
    f.point = (
      await one(
        `INSERT INTO public.hospital_departments (hospital_id, parent_id, name, slug, kind)
         VALUES ($1, $2, 'Main window', $3, 'support') RETURNING id`,
        [f.h, pharm, `pt-${randomUUID()}`],
      )
    ).id;
    await pg.query(
      `INSERT INTO public.pharmacy_dispensing_points (department_id, hospital_id, serves, live_at)
       VALUES ($1, $2, 'window', now() - interval '40 days')`,
      [f.point, f.h],
    );
    const clinic = await department(pg, f.h, "Clinic");
    f.pharmacist = (
      await staff(pg, { hospitalId: f.h, departmentId: pharm, cadre: "PHARMACIST" })
    ).userId;
    const doc = await staff(pg, {
      hospitalId: f.h,
      departmentId: clinic,
      cadre: "MEDICAL_OFFICER",
    });
    mo = {
      userId: doc.userId,
      affiliationId: doc.affiliationId,
      fullName: null,
      hospitalId: f.h,
      departmentId: clinic,
      cadreCode: "MEDICAL_OFFICER",
      isClinical: true,
      surface: "doctor",
    };
    await pg.query(
      `INSERT INTO public.clinical_cosign_policies (hospital_id, cadre_code, action_kind, requirement)
       VALUES ($1, 'MEDICAL_OFFICER', 'prescription_routine', 'allowed') ON CONFLICT DO NOTHING`,
      [f.h],
    );
    await pg.query(
      `INSERT INTO public.pharmacy_hospital_settings (hospital_id, updated_by) VALUES ($1, $2)`,
      [f.h, f.pharmacist],
    );
    await pg.query(
      `INSERT INTO public.pharmacy_signed_sets (hospital_id, kind, version, content, sha256, status, authored_by,
         first_signer, second_signer, signed_at)
       VALUES ($1, 'lane_rule', 1, '{"reasons":[]}'::jsonb, repeat('b', 64), 'signed', $2, $2, $3, now())`,
      [f.h, f.pharmacist, mo.userId],
    );
    f.patient = await patient(pg);
    await pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1988-07-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [f.patient, encrypt("Namusoke"), encrypt("Grace"), encrypt("0700000000")],
    );
    await intake(pg, { hospitalId: f.h, patientUserId: f.patient });
    f.visit = await encounter(pg, {
      hospitalId: f.h,
      patientUserId: f.patient,
      clinicianUserId: mo.userId,
      departmentId: clinic,
    });
  }, 180_000);

  it("S4: query → Change it from 'already prescribed' → hand-over with the identity and counselling confirmation", async () => {
    const rx = await written({ drug: "amoxicillin", place: "clinic" });
    expect(await wordOf(rx)).toBe(W.to_review);

    // The pharmacy asks.
    const sent = await run(pharmacist(), review.QueryInput, review.QUERY_NEED, review.sendQuery, {
      lineId: rx,
      typeCode: "dose",
      proposal: "Fixture proposal: please confirm the dose.",
      patientWaiting: true,
    });
    if (!sent.ok) throw new Error(sent.error);
    await review.deliverQuery(pharmacist(), sent.id, sent.data!, { database: lane.db });
    const asked = await session();
    expect(asked.placed.find((p) => p.id === rx)?.word).toBe(W.queried);
    expect(asked.pharmacy?.count).toBe(1);
    const item = asked.pharmacy!.items[0]!;
    expect(item).toMatchObject({ kind: "query", state: "open" });
    expect(item.lines.map((l) => l.id)).toEqual([rx]);

    // "Change it": the new line goes through the one Prescribe, naming the line it replaces.
    const facts = await as((ctx) => loadPlanFacts(ctx.tx, f.patient!, ctx.now));
    const line: PlanRx = {
      clientKey: `k-${randomUUID()}`,
      kind: "drug",
      drugId: "amoxicillin",
      conditionId: null,
      regimenId: null,
      doseNum: 500,
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
      replaces: { kind: "query", ref: item.id, lineId: rx },
    };
    // The line being replaced is still active, so the dialog (and the server) show "Already
    // prescribed" for it; the prescriber answers it like any other check.
    const amox = drugById("amoxicillin")!;
    const checks = planChecks(amox, line, {
      ...facts,
      kidneyTestPlanned: false,
      sepsisTypeProblem: false,
      bloodCulture: "none",
      others: [
        { drugId: amox.id, classId: amox.class, display: amox.generic, source: "this_visit" },
      ],
      cosign: "allowed",
      v2: true,
    });
    line.answers = needingAnswer(checks).map((c) => ({
      code: c.code,
      answer: "senior_agreed" as const,
    }));
    const placed = await as((ctx) =>
      sendPrescribed(ctx, {
        patientUserId: f.patient!,
        encounterId: f.visit!,
        place: "clinic",
        lines: [line],
      }),
    );
    const fresh = placed.prescriptionIds[0]!;
    expect(
      await one(
        `SELECT kind, answer FROM public.pharmacy_query_events WHERE query_id = $1 AND kind = 'answered'`,
        [item.id],
      ),
    ).toEqual({ kind: "answered", answer: "changed" });
    const changed = await session();
    expect(changed.placed.find((p) => p.id === rx)?.word).toBe(W.replaced);
    expect(changed.placed.find((p) => p.id === fresh)?.word).toBe(W.to_review);
    expect(changed.pharmacy?.count).toBe(0);

    // The hand-over: refused without the confirmation, recorded with it.
    const prod = await product("amoxicillin");
    const st = await stage(fresh, 10);
    if (!st.ok) throw new Error(st.error);
    // The pharmacist answers the checks the prescriber answered (rework test 8), then hands over.
    const { codes } = await one<{ codes: string[] }>(
      `SELECT coalesce(array_agg(a->>'code'), '{}') AS codes
         FROM public.prescriptions, jsonb_array_elements(check_answers) a WHERE id = $1`,
      [fresh],
    );
    for (const code of codes) {
      const r = await run(
        pharmacist(),
        rxChecks.AnswerCheckInput,
        supply.DISPENSE_LIVE,
        rxChecks.answerCheck,
        {
          lineId: fresh,
          code,
          answer: "prescriber_confirmed",
        },
      );
      if (!r.ok) throw new Error(r.error);
    }
    const without = await handover(fresh, prod, false);
    expect(without).toMatchObject({ ok: false });
    if (!without.ok) expect(without.error).toContain(PRESCRIBE_HANDOFF_COPY.explainedRefused);
    const given = await handover(fresh, prod, true);
    if (!given.ok) throw new Error(given.error);
    expect(
      await one(
        `SELECT explained_attested, identity_route FROM public.pharmacy_handovers WHERE id = $1`,
        [given.id],
      ),
    ).toEqual({ explained_attested: true, identity_route: "two_identifiers" });
    expect(await wordOf(fresh)).toBe(W.supplied);
  });

  it("S4: a controlled line is refused by the plain hand-over; it needs the witnessed controlled supply", async () => {
    const rx = await written({ drug: "morphine", place: "clinic", controlled: true });
    const prod = await product("morphine");
    await stage(rx, 10);
    const r = await handover(rx, prod, true);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("Use the controlled supply.");
    expect(
      (
        await one<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.pharmacy_supplies WHERE prescription_id = $1`,
          [rx],
        )
      ).n,
    ).toBe(0);
  });

  it("S4: a resus line is given from the cart: never in the queue, never handed over", async () => {
    const rx = await written({ drug: "adrenaline", place: "resus" });
    expect(await wordOf(rx)).toBe("Given from the cart");
    expect(await inQueue(rx)).toBe(false);
    const prod = await product("adrenaline");
    expect(await stage(rx, 1)).toMatchObject({ ok: false });
    expect(await handover(rx, prod, true)).toMatchObject({ ok: false });
    // The same line written at a clinic visit is dispensed as usual (the rule is the place, not the drug).
    const clinicLine = await written({ drug: "adrenaline", place: "clinic" });
    expect(await inQueue(clinicLine)).toBe(true);
  });

  it("0281: a dose undone by a reversed row is not counted by the pharmacy's MAR reads", async () => {
    const rx = await written({ drug: "amoxicillin", place: "ward" });
    const dose = async (state: string, reverses: string | null) =>
      (
        await one(
          `INSERT INTO public.medication_administration_records (hospital_id, patient_user_id, encounter_id,
             administered_by_user_id, drug_name, dose, route, state, emr_prescription_id, administered_at,
             withheld_reason, reverses_id)
           VALUES ($1, $2, $3, $4, 'Fixture', '[fixture dose]', 'oral', $5, $6, now(), $7, $8) RETURNING id`,
          [
            f.h,
            f.patient,
            f.visit,
            mo.userId,
            state,
            rx,
            reverses ? "Charted in error" : null,
            reverses,
          ],
        )
      ).id;
    const kept = await dose("administered", null);
    const undone = await dose("administered", null);
    await dose("reversed", undone);
    const live = await lane.db
      .select({ id: mar.id })
      .from(mar)
      .where(and(eq(mar.emrPrescriptionId, rx), liveDose()));
    expect(live.map((r) => r.id)).toEqual([kept]);
  });
});
