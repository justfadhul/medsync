/**
 * Pharmacy Phase 4, Step 4 (S10–S14): repeats authorised in the prescribing transaction, stopped by a prescriber,
 * ended with the line; renewal requests listed, answered once, renewed by a new prescription. Fixture packs and
 * medicines only. Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { dxTermUuid } from "@/lib/clerking/impression/load";
import { asClinicalWriter } from "@/lib/emr/db";
import { openRenewals } from "@/lib/emr/read/renewals";
import { withPatientWrite } from "@/lib/emr/write/context";
import { recordEncounterDiagnosis } from "@/lib/emr/write/facts";
import { cancelPrescriptionLine } from "@/lib/emr/write/pharmacy-answers";
import { placePlan } from "@/lib/emr/write/plan";
import { answerRenewal, loadRepeatsPayload, stopRepeats } from "@/lib/emr/write/repeats";
import { encrypt, generateKey } from "@/lib/encryption";
import { localDate } from "@/lib/pharmacy/stock/ledger";
import { addDays } from "@/lib/pharmacy/stores/ledger";
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

// The readers fall back to the app database only when none is passed; every call here passes the lane.
vi.mock("@/db", () => ({ db: undefined }));
vi.mock("@/lib/emr/actor", () => ({ requireEmrActor: async () => undefined }));

const key = () => `k-${randomUUID()}`;
const env = { ...process.env };

describe.skipIf(!laneOn)("repeats and renewals, written (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let clinic: string;
  let mo: EmrActor;
  let nurse: EmrActor;
  let pharmacist: string;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await lane.pg.query<T>(sql, params)).rows;
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await q<T>(sql, params))[0]!;
  const err = (pr: Promise<unknown>) =>
    pr.then(
      () => null,
      (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }),
    );
  const actor = (s: { userId: string; affiliationId: string }, cadreCode: string): EmrActor => ({
    userId: s.userId,
    affiliationId: s.affiliationId,
    fullName: null,
    hospitalId: h,
    departmentId: clinic,
    cadreCode,
    isClinical: true,
    surface: cadreCode === "NURSE" ? "nurse" : "doctor",
  });
  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });
  const today = localDate(new Date());

  const sign = (kind: string, content: unknown) =>
    q(
      `INSERT INTO public.pharmacy_signed_sets (hospital_id, kind, version, content, sha256, status, authored_by,
         first_signer, second_signer, signed_at)
       VALUES ($1, $2, 1, $3::jsonb, repeat('c', 64), 'signed', $4, $4, $5, now())`,
      [h, kind, JSON.stringify(content), pharmacist, mo.userId],
    );

  beforeAll(async () => {
    process.env.PHARMACY_WORKSPACE = "1";
    process.env.PHARMACY_REPEATS = "1";
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    h = await hospital(lane.pg, "Repeats lane");
    clinic = await department(lane.pg, h, "Clinic");
    pharmacist = (
      await clinician(lane.pg, { hospitalId: h, departmentId: clinic, cadre: "PHARMACIST" })
    ).userId;
    mo = actor(
      await clinician(lane.pg, { hospitalId: h, departmentId: clinic }),
      "MEDICAL_OFFICER",
    );
    nurse = actor(
      await clinician(lane.pg, { hospitalId: h, departmentId: clinic, cadre: "NURSE" }),
      "NURSE",
    );
    await q(`DELETE FROM public.clinical_cosign_policies WHERE hospital_id = $1`, [h]);
    await q(
      `INSERT INTO public.clinical_cosign_policies (hospital_id, cadre_code, action_kind, requirement)
       VALUES ($1, 'MEDICAL_OFFICER', 'prescription_routine', 'allowed')`,
      [h],
    );
  }, 180_000);
  afterAll(() => {
    process.env = env;
  });

  async function visit() {
    const p = await patient(lane.pg);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      departmentId: clinic,
    });
    await q(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth,
         id_type, phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1968-03-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Test"), encrypt("Patient"), encrypt("0700000000")],
    );
    const dx = await as(mo, p, (ctx) =>
      recordEncounterDiagnosis(ctx, {
        patientUserId: p,
        encounterId: enc,
        clientKey: key(),
        termId: dxTermUuid("dx.sepsis"),
        rank: "primary",
      }),
    );
    return { p, enc, cond: dx.id };
  }
  const rx = (cond: string, extra: Partial<PlanRx> = {}): PlanRx => ({
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
    ],
    witness: null,
    weightAt: null,
    typedDose: null,
    replaces: undefined,
    ...extra,
  });
  const place = (v: { p: string; enc: string }, line: PlanRx) =>
    as(mo, v.p, (ctx) =>
      placePlan(ctx, {
        patientUserId: v.p,
        encounterId: v.enc,
        orders: [],
        prescriptions: [line],
        requests: [],
        observationFrequency: null,
        measureUrine: false,
      }),
    );
  const terms = (n = 2, d = 28) => ({
    furtherSupplies: n,
    minIntervalDays: d,
    notAfter: addDays(today, 90),
    reviewBy: null,
  });
  const payload = (ids: string[]) =>
    asClinicalWriter(
      { userId: mo.userId, hospitalId: h },
      (tx) => loadRepeatsPayload(tx, h, ids, new Date()),
      lane.db,
    );
  const placed = (clientKey: string) =>
    q(`SELECT id FROM public.prescriptions WHERE client_key = $1`, [clientKey]);

  it("S10 while unsigned: repeats are not offered and a line asking for them is not placed", async () => {
    const v = await visit();
    expect((await payload([]))?.bounds).toBeNull();
    const line = rx(v.cond, { repeats: terms() });
    expect((await err(place(v, line)))?.code).toBe("invalid");
    expect(await placed(line.clientKey)).toEqual([]);
  });

  it("S10: the prescriber's terms are written with the line, once, under the signed rule version", async () => {
    await sign("repeat_rules", {
      repeatList: ["ceftriaxone"],
      neverRepeat: [],
      maxSupplies: 5,
      maxPeriodDays: 180,
      minIntervalDays: 7,
      toleranceDays: 2,
    });
    const v = await visit();
    const bounds = (await payload([]))?.bounds;
    expect(bounds).toEqual({
      offered: ["ceftriaxone"],
      maxSupplies: 5,
      maxPeriodDays: 180,
      minIntervalDays: 7,
    });
    const line = rx(v.cond, { repeats: terms() });
    const r = await place(v, line);
    const id = r.prescriptionIds[0]!;
    expect(
      await q(
        `SELECT further_supplies, min_interval_days, rule_version, prescriber_cadre
         FROM public.prescription_repeat_authorisations WHERE prescription_id = $1`,
        [id],
      ),
    ).toEqual([
      {
        further_supplies: 2,
        min_interval_days: 28,
        rule_version: 1,
        prescriber_cadre: "MEDICAL_OFFICER",
      },
    ]);
    expect((await payload([id]))?.lines[id]).toMatchObject({
      furtherSupplies: 2,
      stopped: null,
      ended: false,
    });
    // A replay of the same basket writes nothing more.
    await place(v, line);
    expect(
      await q(
        `SELECT 1 FROM public.prescription_repeat_authorisations WHERE prescription_id = $1`,
        [id],
      ),
    ).toHaveLength(1);
  });

  it("S10: terms outside the signed range are refused and the line is not placed", async () => {
    const v = await visit();
    const line = rx(v.cond, { repeats: terms(9, 3) });
    const e = await err(place(v, line));
    expect(e?.code).toBe("invalid");
    expect(e?.message).toContain("outside the signed range");
    expect(await placed(line.clientKey)).toEqual([]);
  });

  it("S11: a controlled line can never carry repeats (the 0230 backstop)", async () => {
    const v = await visit();
    const cd = (
      await one<{ id: string }>(
        `INSERT INTO public.prescriptions (hospital_id, encounter_id, patient_user_id, prescriber_user_id, drug_id,
           drug_name, dose, route, controlled) VALUES ($1, $2, $3, $4, 'fixture_cd', 'Fixture CD', 'as written',
           'oral', true) RETURNING id`,
        [h, v.enc, v.p, mo.userId],
      )
    ).id;
    const e = await lane.pg
      .query(
        `INSERT INTO public.prescription_repeat_authorisations (hospital_id, patient_user_id, prescription_id,
           further_supplies, min_interval_days, not_after, rule_version, prescriber_user_id)
         VALUES ($1, $2, $3, 1, 28, current_date + 30, 1, $4)`,
        [h, v.p, cd, mo.userId],
      )
      .then(
        () => "ran",
        (x: Error) => x.message,
      );
    expect(e).toContain("never repeated");
  });

  it("S12: a prescriber stops the repeats with a reason; the first stop stands; a nurse cannot", async () => {
    const v = await visit();
    const id = (await place(v, rx(v.cond, { repeats: terms() }))).prescriptionIds[0]!;
    expect(
      (
        await err(
          as(nurse, v.p, (ctx) =>
            stopRepeats(ctx, { patientUserId: v.p, prescriptionId: id, reason: "x" }),
          ),
        )
      )?.code,
    ).toBe("forbidden");
    await as(mo, v.p, (ctx) =>
      stopRepeats(ctx, { patientUserId: v.p, prescriptionId: id, reason: "Review due" }),
    );
    await as(mo, v.p, (ctx) =>
      stopRepeats(ctx, { patientUserId: v.p, prescriptionId: id, reason: "Again" }),
    );
    expect(
      await q(
        `SELECT e.kind, e.reason FROM public.prescription_repeat_events e
         JOIN public.prescription_repeat_authorisations a ON a.id = e.authorisation_id WHERE a.prescription_id = $1`,
        [id],
      ),
    ).toEqual([{ kind: "stopped", reason: "Review due" }]);
    expect((await payload([id]))?.lines[id]?.stopped).toEqual({
      cadre: "MEDICAL_OFFICER",
      on: today,
    });
  });

  it("S13: a cancelled line ends its repeats", async () => {
    const v = await visit();
    const id = (await place(v, rx(v.cond, { repeats: terms() }))).prescriptionIds[0]!;
    await as(mo, v.p, (ctx) =>
      cancelPrescriptionLine(ctx, {
        patientUserId: v.p,
        prescriptionId: id,
        reasonCode: "no_longer_needed",
      }),
    );
    expect((await payload([id]))?.lines[id]?.ended).toBe(true);
  });

  it("S14: a renewal request is listed until answered, once; Decline needs the signed reasons; Renew links", async () => {
    const v = await visit();
    const src = (await place(v, rx(v.cond))).prescriptionIds[0]!;
    const ask = async () =>
      (
        await one<{ id: string }>(
          `INSERT INTO public.prescription_renewal_requests (hospital_id, patient_user_id, prescription_id, reason,
             asked_by, asked_by_user_id) VALUES ($1, $2, $3, 'no_authorisation', 'pharmacy', $4) RETURNING id`,
          [h, v.p, src, pharmacist],
        )
      ).id;
    const r1 = await ask();
    const list = await openRenewals({ userId: mo.userId, hospitalId: h }, lane.db);
    const row = list.find((r) => r.id === r1)!;
    expect(row).toMatchObject({
      prescriptionId: src,
      encounterId: v.enc,
      authorised: null,
      used: null,
    });
    expect(row.mrn).not.toBe("");

    const decline = (id: string) =>
      as(mo, v.p, (ctx) =>
        answerRenewal(ctx, {
          patientUserId: v.p,
          renewalId: id,
          answer: { kind: "declined", reasonCode: "needs_review" },
          note: null,
        }),
      );
    expect((await err(decline(r1)))?.code).toBe("invalid");
    await as(mo, v.p, (ctx) =>
      answerRenewal(ctx, {
        patientUserId: v.p,
        renewalId: r1,
        answer: { kind: "visit_needed" },
        note: null,
      }),
    );
    expect((await err(decline(r1)))?.code).toBe("conflict");
    expect(
      (await openRenewals({ userId: mo.userId, hospitalId: h }, lane.db)).map((r) => r.id),
    ).not.toContain(r1);

    await sign("renewal_decline_reasons", {
      items: [{ code: "needs_review", words: "Needs a review first" }],
    });
    const r2 = await ask();
    await decline(r2);
    expect(
      await one(
        `SELECT kind, reason_code FROM public.prescription_renewal_events WHERE renewal_id = $1`,
        [r2],
      ),
    ).toEqual({ kind: "declined", reason_code: "needs_review" });

    // Renew: placing the new prescription with the request's id answers it in the same transaction.
    const r3 = await ask();
    const renewed = (
      await place(
        v,
        rx(v.cond, {
          renewalId: r3,
          answers: [
            { code: "cultures", answer: "aware_monitor" },
            { code: "allergy_status", answer: "aware_monitor" },
            { code: "duplicate", answer: "aware_monitor" },
          ],
        }),
      )
    ).prescriptionIds[0]!;
    expect(
      await one(
        `SELECT kind, new_prescription_id FROM public.prescription_renewal_events WHERE renewal_id = $1`,
        [r3],
      ),
    ).toEqual({ kind: "renewed", new_prescription_id: renewed });
  });
});
