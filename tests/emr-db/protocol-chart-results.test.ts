/**
 * Chart values to results (prescribing kit P5, F7 "values typed here save to results and close
 * pending orders"; §3 P5) on the PGlite lane, 0282–0284 replayed. An HHS chart for a fictional
 * patient: the doctor orders the U&Es from the chart, then types the potassium on the chart → the
 * results writer enters it on that order (closed, tagged with the chart); the nurse's hourly slot
 * goes to the record as observations tagged with the chart, with the osmolality worked out on save
 * (on the chart only: it has no record concept). Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import { beforeAll, describe, expect, it } from "vitest";

import { withPatientWrite } from "@/lib/emr/write/context";
import { recordObservations } from "@/lib/emr/write/facts";
import { chartAct, loadChart, recordSlot, startChart } from "@/lib/emr/write/protocol-charts";
import { encrypt, generateKey } from "@/lib/encryption";
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
const T0 = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000);
const at = (min: number) => new Date(T0.getTime() + min * 60000);

describe.skipIf(!laneOn)("protocol chart values to results (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let mo: EmrActor;
  let nurse: EmrActor;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await lane.pg.query<T>(sql, params)).rows;
  const as = <T>(a: EmrActor, p: string, min: number, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db, now: at(min) });

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

  it("a typed potassium closes the chart's U&E order; slot values are recorded, tagged with the chart", async () => {
    const p = await patient(lane.pg);
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'male', '1958-03-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Okello"), encrypt("Peter"), encrypt("0700000001")],
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
    await as(mo, p, -30, (ctx) =>
      recordObservations(ctx, {
        patientUserId: p,
        encounterId: e,
        clientKey: key(),
        observations: [
          { conceptId: "obs.weight", value: { type: "quantity", value: 74, unit: "kg" } },
        ],
      }),
    );
    const [ver] = await q<{ id: string; seed: { insulin?: unknown } }>(
      `SELECT id, seed FROM public.protocol_versions WHERE protocol_id = 'hhs' AND hospital_id IS NULL`,
    );
    expect(ver!.seed.insulin).toBeTruthy(); // 0284 filled the seed
    const chartId = (
      await as(mo, p, 0, (ctx) =>
        startChart(ctx, { patientUserId: p, encounterId: e, versionId: ver!.id, clientKey: key() }),
      )
    ).id;
    const c = { patientUserId: p, chartId };
    const view = (a: EmrActor, min: number) => as(a, p, min, (ctx) => loadChart(ctx, c));

    // The doctor orders the U&Es from the potassium step.
    let v = (await view(mo, 1)).view;
    expect(v.blocked).toBeNull();
    const k5 = v.phases[0]!.acts.find((s) => s.key === "imm5")!;
    const order = k5.btns.find((b) => b.act.t === "order")!.act;
    await as(mo, p, 2, (ctx) => chartAct(ctx, { ...c, act: order, clientKey: key() }));
    const [ev] = await q<{ payload: { orderIds: string[] } }>(
      `SELECT payload FROM public.protocol_chart_events WHERE chart_id = $1 AND type = 'order'`,
      [chartId],
    );
    const orderId = ev!.payload.orderIds[0]!;
    v = (await view(mo, 3)).view;
    expect(v.phases[0]!.acts.find((s) => s.key === "imm5")!.fields[0]!.source).toMatch(/Ordered/);

    // The doctor types the potassium on the chart: entered on that order, tagged with the chart.
    const typed = { ...c, act: { t: "value" as const, key: "k" }, value: "4.1", clientKey: key() };
    await as(mo, p, 10, (ctx) => chartAct(ctx, typed));
    await as(mo, p, 10, (ctx) => chartAct(ctx, typed)); // a replay writes nothing twice
    const reports = await q<{ id: string }>(
      `SELECT id FROM public.diagnostic_reports WHERE order_id = $1`,
      [orderId],
    );
    expect(reports).toHaveLength(1);
    const kRows = await q<{ report_id: string | null; chart: string; value_num: string }>(
      `SELECT report_id, context->>'protocolChartId' AS chart, value_num FROM public.clinical_observations
        WHERE patient_user_id = $1 AND concept_id = 'obs.potassium'`,
      [p],
    );
    expect(kRows).toHaveLength(1);
    expect(kRows[0]).toMatchObject({ report_id: reports[0]!.id, chart: chartId });
    expect(Number(kRows[0]!.value_num)).toBe(4.1);

    // The nurse's hour: glucose, sodium, urea to the record; osmolality worked out on the chart.
    await as(nurse, p, 65, (ctx) =>
      recordSlot(ctx, {
        ...c,
        values: { cbg: "38.6", nacl: "1000", uo: "40", na: "152", urea: "24.5" },
        clientKey: key(),
      }),
    );
    const [slot] = await q<{ payload: { values: Record<string, string> } }>(
      `SELECT payload FROM public.protocol_chart_events WHERE chart_id = $1 AND type = 'slot'`,
      [chartId],
    );
    expect(slot!.payload.values.osm).toBe("367.1"); // 2 × 152 + 38.6 + 24.5
    const obs = await q<{ concept_id: string; report_id: string | null; source: string }>(
      `SELECT concept_id, report_id, context->>'source' AS source FROM public.clinical_observations
        WHERE patient_user_id = $1 AND context->>'protocolChartId' = $2 AND report_id IS NULL
        ORDER BY concept_id`,
      [p, chartId],
    );
    expect(obs.map((o) => o.concept_id)).toEqual([
      "obs.glucose_capillary",
      "obs.sodium",
      "obs.urea",
    ]);
    expect(obs[0]!.source).toBe("entered on the HHS chart");
    // The chart now reads them back from the record, and the U&Es are no longer "waiting".
    v = (await view(mo, 70)).view;
    const a1 = v.phases[0]!.acts.find((s) => s.key === "imm1")!;
    expect(a1.fields.find((f) => f.key === "na")!.source).not.toMatch(/Ordered/);
  });
});
