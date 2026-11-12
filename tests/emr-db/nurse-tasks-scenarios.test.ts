/**
 * Nurse tasks and the medicine chart, acceptance scenario S5 (prescribing kit §4, P2 (b)) on the
 * PGlite lane: 0281 replayed, "Sign and send" of an IV line for a patient with no line raises
 * "Insert an IV cannula", the nurse records 18G left forearm, the line is on the patient (a
 * procedures row and the task outcome), then Given / Withhold / undo on the line and a result typed
 * on a task through the results writer. Fictional patient. Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import { beforeAll, describe, expect, it } from "vitest";

import { asClinicalReader } from "@/lib/emr/db";
import { ivLinesFor, loadNurseMar, loadNurseTasks } from "@/lib/emr/read/nursing";
import { withPatientWrite } from "@/lib/emr/write/context";
import {
  completeIvTask,
  completeResultTask,
  raiseNurseTask,
  recordDose,
  reverseDose,
} from "@/lib/emr/write/nursing";
import { placeOrders } from "@/lib/emr/write/orders";
import { loadPlanFacts, sendPrescribed } from "@/lib/emr/write/plan";
import { collectSpecimen } from "@/lib/emr/write/specimens";
import { decrypt, encrypt, generateKey } from "@/lib/encryption";
import { drugById } from "@/lib/prescribing/formulary";
import { needingAnswer, planChecks } from "@/lib/prescribing/plan-checks";
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
const MALARIA_RDT = "461e61e7-1f95-589b-a8e4-87e9e007d16e";

describe.skipIf(!laneOn)("nurse tasks and the medicine chart, S5 (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let mo: EmrActor;
  let nurse: EmrActor;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await lane.pg.query<T>(sql, params)).rows;
  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });
  const read = <T>(a: EmrActor, fn: Parameters<typeof asClinicalReader<T>>[1]) =>
    asClinicalReader({ userId: a.userId, hospitalId: a.hospitalId }, fn, lane.db);
  const code = (pr: Promise<unknown>) =>
    pr.then(
      () => "ok",
      (e: { code?: string }) => e.code ?? String(e),
    );

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    process.env.ENCOUNTER_ENGINE_LIVE = "1";
    process.env.EMR_V1 = "1";
    process.env.EMR_PRESCRIBING = "1";
    process.env.PRESCRIBE_V2 = "1";
    lane = await bootLane();
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    const make = async (cadreCode: string, surface: EmrActor["surface"]): Promise<EmrActor> => ({
      ...(await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: cadreCode })),
      fullName: null,
      hospitalId: h,
      departmentId: dept,
      cadreCode,
      isClinical: true,
      surface,
    });
    mo = await make("MEDICAL_OFFICER", "doctor");
    nurse = await make("NURSE", "nurse");
  }, 180_000);

  async function person() {
    const p = await patient(lane.pg);
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'male', '1980-03-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Okello"), encrypt("Peter"), encrypt("0700000000")],
    );
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      departmentId: dept,
    });
    await lane.pg.query(`UPDATE public.encounters SET encounter_type = 'inpatient' WHERE id = $1`, [
      e,
    ]);
    return { p, e };
  }

  const line = (over: Partial<PlanRx>): PlanRx => ({
    clientKey: key(),
    kind: "drug",
    drugId: "ceftriaxone",
    conditionId: null,
    regimenId: null,
    doseNum: 1,
    unit: "g",
    strength: null,
    route: "iv",
    method: null,
    infusionOver: null,
    diluent: null,
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

  /** Answers whatever the server's checks ask, as a prescriber would. */
  async function answered(p: string, rx: PlanRx): Promise<PlanRx> {
    const facts = await as(mo, p, (ctx) => loadPlanFacts(ctx.tx, p, ctx.now));
    const checks = planChecks(drugById(rx.drugId)!, rx, {
      ...facts,
      kidneyTestPlanned: false,
      sepsisTypeProblem: false,
      bloodCulture: "none",
      others: [],
      cosign: "allowed",
      v2: true,
    });
    return {
      ...rx,
      answers: needingAnswer(checks).map((c) => ({
        code: c.code,
        answer: "senior_agreed" as const,
      })),
    };
  }

  const send = async (v: { p: string; e: string }, lines: PlanRx[]) =>
    as(mo, v.p, (ctx) =>
      sendPrescribed(ctx, { patientUserId: v.p, encounterId: v.e, place: "ward", lines }),
    );

  it("S5: IV ceftriaxone, no line → 'Insert an IV cannula' → the nurse records 18G, left forearm → the line is on the patient", async () => {
    const v = await person();
    const sent = await send(v, [await answered(v.p, line({}))]);
    const tasks = await q<{
      id: string;
      type: string;
      status: string;
      source_kind: string;
      source_id: string;
      payload: { drugs: string[]; first: string; prescriptionIds: string[] };
      due_at: Date | null;
      encounter_id: string;
    }>(`SELECT * FROM nurse_tasks WHERE patient_user_id = $1`, [v.p]);
    expect(tasks).toHaveLength(1);
    const t = tasks[0]!;
    expect(t).toMatchObject({
      type: "iv_cannula",
      status: "open",
      source_kind: "prescription",
      source_id: sent.prescriptionIds[0],
      encounter_id: v.e,
      payload: { drugs: ["Ceftriaxone"], first: "now", prescriptionIds: sent.prescriptionIds },
    });
    expect(t.due_at).not.toBeNull();

    // A second IV line while the task is open raises no second task; an oral line none at all.
    await send(v, [
      await answered(
        v.p,
        line({ drugId: "metronidazole", doseNum: 500, unit: "mg", frequency: "8h" }),
      ),
    ]);
    await send(v, [
      await answered(
        v.p,
        line({ drugId: "paracetamol", doseNum: 1, unit: "g", route: "oral", frequency: "6h" }),
      ),
    ]);
    expect(await q(`SELECT id FROM nurse_tasks WHERE patient_user_id = $1`, [v.p])).toHaveLength(1);

    // The nurse sees it under RLS; the line is not on the patient yet.
    const seen = await read(nurse, (tx) => loadNurseTasks(tx, h));
    expect(seen.open.map((x) => x.id)).toContain(t.id);
    expect(await read(nurse, (tx) => ivLinesFor(tx, v.p))).toEqual([]);

    // Role gate in the write: a doctor cannot close a nurse task; a size off the list is refused.
    const done = (a: EmrActor, size: string, clientKey = key()) =>
      as(a, v.p, (ctx) =>
        completeIvTask(ctx, {
          patientUserId: v.p,
          taskId: t.id,
          size,
          site: "left forearm",
          clientKey,
        }),
      );
    expect(await code(done(mo, "18G"))).toBe("forbidden");
    expect(await code(done(nurse, "16G"))).toBe("invalid");

    const k = key();
    await done(nurse, "18G", k);
    expect(await code(done(nurse, "18G", k))).toBe("ok"); // a replay lands once
    expect(await code(done(nurse, "20G"))).toBe("conflict");

    const [closed] = await q<{
      status: string;
      outcome: { size: string; site: string; procedureId: string };
    }>(`SELECT status, outcome FROM nurse_tasks WHERE id = $1`, [t.id]);
    expect(closed).toMatchObject({
      status: "done",
      outcome: { size: "18G", site: "left forearm" },
    });
    const [proc] = await q<{
      outcome: string;
      laterality: string;
      text_ciphertext: string;
      encounter_id: string;
    }>(`SELECT outcome, laterality, text_ciphertext, encounter_id FROM procedures WHERE id = $1`, [
      closed!.outcome.procedureId,
    ]);
    expect(proc).toMatchObject({ outcome: "completed", laterality: "left", encounter_id: v.e });
    expect(decrypt(proc!.text_ciphertext)).toBe("Peripheral IV cannula 18G, left forearm");
    expect(await read(nurse, (tx) => ivLinesFor(tx, v.p))).toEqual([
      expect.objectContaining({ size: "18G", site: "left forearm" }),
    ]);

    // With the line in, the next IV medicine on this visit raises no task.
    await send(v, [await answered(v.p, line({ drugId: "gentamicin", doseNum: 320, unit: "mg" }))]);
    expect(await q(`SELECT id FROM nurse_tasks WHERE patient_user_id = $1`, [v.p])).toHaveLength(1);

    // A closed task is frozen and never deleted (trigger).
    await expect(
      lane.pg.query(`UPDATE nurse_tasks SET outcome = '{}'::jsonb WHERE id = $1`, [t.id]),
    ).rejects.toThrow(/frozen/);
    await expect(lane.pg.query(`DELETE FROM nurse_tasks WHERE id = $1`, [t.id])).rejects.toThrow(
      /never deleted/,
    );
  });

  it("Given / Withhold on the line, a reason to withhold, a mistake undone by a reversal", async () => {
    const v = await person();
    const sent = await send(v, [await answered(v.p, line({}))]);
    const rx = sent.prescriptionIds[0]!;
    const chart = await read(nurse, (tx) =>
      loadNurseMar(tx, { hospitalId: h, patientUserId: v.p, now: new Date() }),
    );
    expect(chart).toHaveLength(1);
    expect(chart[0]!.chartable).toBe(true);
    const due = chart[0]!.row.cells.find((c) => c.state === "due" || c.state === "delayed")!;
    expect(due).toBeTruthy();
    const at = new Date(due.at);
    const dose = (a: EmrActor, given: boolean, reason?: string, clientKey = key()) =>
      as(a, v.p, (ctx) =>
        recordDose(ctx, {
          patientUserId: v.p,
          prescriptionId: rx,
          scheduledFor: at,
          given,
          reason,
          clientKey,
        }),
      );

    expect(await code(dose(mo, true))).toBe("forbidden");
    expect(await code(dose(nurse, false))).toBe("invalid"); // Withhold needs a reason
    const k = key();
    const g = await dose(nurse, true, undefined, k);
    expect((await dose(nurse, true, undefined, k)).id).toBe(g.id); // replay
    expect(await code(dose(nurse, true))).toBe("conflict"); // one record per due time

    const [row] = await q(
      `SELECT state, emr_prescription_id, drug_name, dose, route FROM medication_administration_records WHERE id = $1`,
      [g.id],
    );
    expect(row).toMatchObject({ state: "administered", emr_prescription_id: rx, route: "iv" });

    // Wrong entry: a reversal row with the reason; the dose row stays, the due time opens again.
    const undo = await as(nurse, v.p, (ctx) =>
      reverseDose(ctx, {
        patientUserId: v.p,
        marId: g.id,
        reason: "Charted on the wrong patient",
        clientKey: key(),
      }),
    );
    expect(
      await code(
        as(nurse, v.p, (ctx) =>
          reverseDose(ctx, { patientUserId: v.p, marId: g.id, reason: "Again", clientKey: key() }),
        ),
      ),
    ).toBe("conflict");
    const rows = await q<{ id: string; state: string; reverses_id: string | null }>(
      `SELECT id, state, reverses_id FROM medication_administration_records WHERE emr_prescription_id = $1`,
      [rx],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === undo.id)).toMatchObject({
      state: "reversed",
      reverses_id: g.id,
    });
    const w = await dose(nurse, false, "Patient vomiting, doctor informed");
    const after = await read(nurse, (tx) =>
      loadNurseMar(tx, { hospitalId: h, patientUserId: v.p, now: new Date() }),
    );
    const cell = after[0]!.row.cells.find((c) => c.at === due.at)!;
    expect(cell).toMatchObject({
      state: "omitted",
      word: "Omitted (Patient vomiting, doctor informed)",
    });
    expect(after[0]!.doses.map((d) => d.id)).toEqual([w.id]);
  });

  it("a result typed on a task goes through the results writer and closes the task", async () => {
    const v = await person();
    const order = await as(mo, v.p, (ctx) =>
      placeOrders(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        orders: [
          { clientKey: key(), testId: MALARIA_RDT, priority: "routine", reasonText: "Fever" },
        ],
      }),
    );
    await as(nurse, v.p, (ctx) =>
      collectSpecimen(ctx, {
        patientUserId: v.p,
        orderId: order.id,
        identifiersConfirmed: true,
        clientKey: key(),
      }),
    );
    // The way P4's charts will raise one: generic type, source, payload.
    const taskId = await as(mo, v.p, (ctx) =>
      raiseNurseTask(ctx, {
        patientUserId: v.p,
        encounterId: v.e,
        type: "enter_result",
        sourceKind: "order",
        sourceId: order.id,
        payload: { orderId: order.id, conceptId: "obs.malaria_test", test: "mRDT" },
        dueAt: null,
        clientKey: key(),
      }),
    );
    const r = await as(nurse, v.p, (ctx) =>
      completeResultTask(ctx, { patientUserId: v.p, taskId, code: "negative", clientKey: key() }),
    );
    expect(r.id).toBe(taskId);
    const [t] = await q<{ status: string; outcome: { reportId: string } }>(
      `SELECT status, outcome FROM nurse_tasks WHERE id = $1`,
      [taskId],
    );
    expect(t!.status).toBe("done");
    const [report] = await q(
      `SELECT order_id, source, status FROM diagnostic_reports WHERE id = $1`,
      [t!.outcome.reportId],
    );
    expect(report).toMatchObject({ order_id: order.id, source: "poc_staff", status: "final" });
  });
});
