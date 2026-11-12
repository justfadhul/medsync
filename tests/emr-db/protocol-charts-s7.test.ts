/**
 * Protocol charts, acceptance scenarios S7–S9 (prescribing kit §4) on the PGlite lane, 0283 replayed.
 * S7: a DKA chart for a fictional patient runs end to end through the server writes: severe →
 * HDU informed; no line → the doctor asks for one → the nurse's cannula task → insulin started by
 * the nurse; off target → the raise is locked until the nurse checks lines and pumps → +1 → a pump
 * task; a low glucose → a hypo task until treated; resolved → SC insulin → ended → no open tasks.
 * S8: the role gates and P6 blocks hold in the server (nurse cannot raise insulin, doctor cannot
 * hang a bag, the pharmacy writes nothing). S9: the monitoring chart: trends, vitals with GCS as
 * E/V/M totalled here and an added SpO₂, dashed due cells for the venous gas. Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { Act } from "@/lib/protocols/engine/types";
import { beforeAll, describe, expect, it } from "vitest";

import { withPatientWrite } from "@/lib/emr/write/context";
import { recordObservations } from "@/lib/emr/write/facts";
import { completeIvTask } from "@/lib/emr/write/nursing";
import {
  addChartNote,
  changeParam,
  chartAct,
  endChart,
  loadChart,
  recordSlot,
  recordVitals,
  startChart,
  undoChartEvent,
} from "@/lib/emr/write/protocol-charts";
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
// An hour ahead of the wall clock: the fact loader reads only rows created by its as-of time.
const T0 = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000);
const at = (min: number) => new Date(T0.getTime() + min * 60000);

describe.skipIf(!laneOn)("protocol charts, S7–S9 (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let mo: EmrActor;
  let nurse: EmrActor;
  let pharm: EmrActor;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await lane.pg.query<T>(sql, params)).rows;
  const as = <T>(a: EmrActor, p: string, min: number, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db, now: at(min) });
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
    pharm = await make("PHARMACIST", "clinician");
  }, 180_000);

  async function person() {
    const p = await patient(lane.pg);
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1992-05-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Atim"), encrypt("Ruth"), encrypt("0700000000")],
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
          { conceptId: "obs.weight", value: { type: "quantity", value: 64, unit: "kg" } },
          {
            conceptId: "obs.potassium",
            value: { type: "quantity", value: 4.2, unit: "mmol/L" },
            specimen: "venous_whole_blood",
          },
        ],
      }),
    );
    const v = (
      await q<{ id: string }>(
        `SELECT id FROM public.protocol_versions WHERE protocol_id = 'dka' AND hospital_id IS NULL`,
      )
    )[0]!.id;
    return { p, e, v };
  }

  it("S7 + S8: a DKA chart runs end to end; the role gates and blocks hold on the server", async () => {
    const g = await person();
    const chartId = (
      await as(mo, g.p, 0, (ctx) =>
        startChart(ctx, { patientUserId: g.p, encounterId: g.e, versionId: g.v, clientKey: key() }),
      )
    ).id;
    const c = { patientUserId: g.p, chartId };
    const act = (a: EmrActor, min: number, x: Act, value?: string) =>
      as(a, g.p, min, (ctx) => chartAct(ctx, { ...c, act: x, value, clientKey: key() }));
    const view = (a: EmrActor, min: number) => as(a, g.p, min, (ctx) => loadChart(ctx, c));
    const openTasks = () =>
      q<{ key: string; type: string }>(
        `SELECT payload->>'key' AS key, type FROM public.nurse_tasks
          WHERE patient_user_id = $1 AND status = 'open' ORDER BY created_at`,
        [g.p],
      );

    // Only one running chart of a protocol for a patient; the nurse cannot start one.
    expect(
      await code(
        as(mo, g.p, 1, (ctx) =>
          startChart(ctx, {
            patientUserId: g.p,
            encounterId: g.e,
            versionId: g.v,
            clientKey: key(),
          }),
        ),
      ),
    ).toBe("conflict");
    expect(
      await code(
        as(nurse, g.p, 1, (ctx) =>
          startChart(ctx, {
            patientUserId: g.p,
            encounterId: g.e,
            versionId: g.v,
            clientKey: key(),
          }),
        ),
      ),
    ).toBe("forbidden");

    // The doctor enters the gas and ketones on Confirm: DKA, severe (pH 7.05): HDU informed.
    for (const [k, x] of [
      ["cbg", "25"],
      ["ket", "4.5"],
      ["ph", "7.05"],
      ["hco3", "12"],
    ] as const)
      await act(mo, 2, { t: "value", key: k }, x);
    expect(await code(act(nurse, 3, { t: "value", key: "ph" }, "7.2"))).toBe("forbidden");
    expect(await code(act(mo, 3, { t: "value", key: "ph" }, "abc"))).toBe("invalid");
    await act(mo, 3, { t: "mark", key: "hdu" });
    const v1 = (await view(mo, 4)).view;
    expect(
      v1.phases[0]!.acts[0]!.lines.some((l) => l.text.startsWith("HDU or ICU team informed")),
    ).toBe(true);
    expect(v1.signed).toBe(false);

    // No line: the insulin is not the nurse's to start yet; the doctor asks for a cannula.
    expect(await code(act(nurse, 4, { t: "mark", key: "insAt" }))).toBe("forbidden");
    await act(mo, 5, { t: "iv" });
    const iv = (
      await q<{ id: string }>(
        `SELECT id FROM public.nurse_tasks WHERE patient_user_id = $1 AND type = 'iv_cannula' AND status = 'open'`,
        [g.p],
      )
    )[0]!;
    await as(nurse, g.p, 8, (ctx) =>
      completeIvTask(ctx, {
        patientUserId: g.p,
        taskId: iv.id,
        size: "18G",
        site: "left forearm",
        clientKey: key(),
      }),
    );
    expect((await openTasks()).map((t) => t.key)).toContain("fluid1");

    // S8: the doctor does not start the infusion; the nurse does.
    expect(await code(act(mo, 10, { t: "mark", key: "insAt" }))).toBe("forbidden");
    await act(nurse, 10, { t: "mark", key: "fluid1At" });
    await act(nurse, 12, { t: "mark", key: "insAt" });
    expect((await openTasks()).map((t) => t.key)).not.toContain("fluid1");

    // Hour 0 and 1 charted by the nurse; the doctor cannot record a slot.
    const slot = (a: EmrActor, min: number, values: Record<string, string>) =>
      as(a, g.p, min, (ctx) => recordSlot(ctx, { ...c, values, clientKey: key() }));
    expect(await code(slot(mo, 15, { cbg: "25" }))).toBe("forbidden");
    expect(await code(slot(nurse, 15, { ket: "4.5" }))).toBe("invalid"); // glucose is required
    expect(await code(slot(nurse, 15, { cbg: "25", foo: "1" }))).toBe("invalid");
    await slot(nurse, 15, { cbg: "25", ket: "4.5", ph: "7.05", hco3: "12", k: "4.2", uo: "60" });
    await slot(nurse, 65, { cbg: "24.5", ket: "4.4", uo: "50" });

    // Off target: the raise waits for the nurse's lines-and-pumps check (P6); a nurse never raises.
    const raise: Act = { t: "mark", key: "insUp" };
    expect(await code(act(mo, 66, raise))).toBe("forbidden");
    expect((await openTasks()).map((t) => t.key)).toContain("lines0");
    expect(await code(act(nurse, 66, raise))).toBe("forbidden");
    await act(nurse, 67, { t: "mark", key: "linesAt" });
    await act(mo, 68, raise);
    expect(await code(act(mo, 69, raise))).toBe("forbidden"); // locked for the seed's 60 min
    const v2 = (await view(nurse, 69)).view;
    expect(v2.stats.find((s) => s.k === "Insulin")!.v).toBe("7.4 units/hour");
    expect((await openTasks()).map((t) => t.key)).toContain("pump1");
    await act(nurse, 70, { t: "mark", key: "pumpAt" });
    expect((await openTasks()).map((t) => t.key)).not.toContain("pump1");

    // S8: hanging a bag is the nurse's; the doctor is refused.
    expect(await code(act(mo, 70, { t: "mark", key: "bag1" }))).toBe("forbidden");
    await act(nurse, 70, { t: "mark", key: "bag1" });

    // Hypoglycaemia at hour 2: a task until treated.
    await slot(nurse, 125, { cbg: "3.5", ket: "3.6", ph: "7.15", hco3: "14", k: "4.0", uo: "40" });
    expect((await openTasks()).some((t) => t.key.startsWith("hypo"))).toBe(true);
    await act(nurse, 128, { t: "mark", key: "hypoAt" });
    expect((await openTasks()).some((t) => t.key.startsWith("hypo"))).toBe(false);

    // S8: the pharmacy reads the chart and writes nothing.
    const ph = await view(pharm, 130);
    expect(ph.role).toBe("ph");
    expect(await code(act(pharm, 130, { t: "mark", key: "bag2" }))).toBe("forbidden");
    expect(
      await code(
        as(pharm, g.p, 130, (ctx) => addChartNote(ctx, { ...c, text: "x", clientKey: key() })),
      ),
    ).toBe("forbidden");

    // Hours 3 to 12, then resolved at hour 13.
    for (let hr = 3; hr <= 12; hr++)
      await slot(nurse, hr * 60 + 5, {
        cbg: (14 - hr * 0.4).toFixed(1),
        ket: Math.max(0.4, 3.5 - hr * 0.3).toFixed(1),
        uo: "60",
      });
    await slot(nurse, 13 * 60 + 5, {
      cbg: "9",
      ket: "0.2",
      ph: "7.35",
      hco3: "19",
      k: "4.1",
      uo: "70",
    });
    expect(await code(act(mo, 13 * 60 + 6, { t: "end" }))).toBe("invalid"); // ending has its own write
    expect(
      await code(
        as(nurse, g.p, 13 * 60 + 6, (ctx) =>
          endChart(ctx, { ...c, reason: "Resolved", clientKey: key() }),
        ),
      ),
    ).toBe("forbidden");
    await act(mo, 13 * 60 + 7, { t: "set", key: "next", value: "sc" });
    const v3 = (await view(mo, 13 * 60 + 8)).view;
    const e1 = v3.phases[3]!.acts[0]!;
    expect(e1.crit.every((x) => x.mark === "met")).toBe(true);
    await as(mo, g.p, 13 * 60 + 10, (ctx) =>
      endChart(ctx, { ...c, reason: "DKA resolved, on SC insulin", clientKey: key() }),
    );
    expect(await openTasks()).toEqual([]);
    const ended = await view(nurse, 13 * 60 + 11);
    expect(ended.view.endedAt).not.toBeNull();
    expect(ended.chart.endReason).toBe("DKA resolved, on SC insulin");
    expect(await code(act(nurse, 13 * 60 + 12, { t: "mark", key: "bag5" }))).toBe("forbidden");
    // Every entry is on the record, in order, with who made it.
    const roles = await q<{ type: string; actor_role: string }>(
      `SELECT type, actor_role FROM public.protocol_chart_events WHERE chart_id = $1 ORDER BY at, id`,
      [chartId],
    );
    expect(roles[0]).toMatchObject({ type: "start", actor_role: "dr" });
    expect(roles.at(-1)).toMatchObject({ type: "end", actor_role: "dr" });
    expect(roles.filter((r) => r.type === "slot").every((r) => r.actor_role === "rn")).toBe(true);
  });

  it("S9: the monitoring chart: trends, vitals with GCS E/V/M and an added parameter, gas due cells; undo", async () => {
    const g = await person();
    const chartId = (
      await as(mo, g.p, 0, (ctx) =>
        startChart(ctx, { patientUserId: g.p, encounterId: g.e, versionId: g.v, clientKey: key() }),
      )
    ).id;
    const c = { patientUserId: g.p, chartId };
    const slot = (min: number, values: Record<string, string>) =>
      as(nurse, g.p, min, (ctx) => recordSlot(ctx, { ...c, values, clientKey: key() }));
    await slot(5, { cbg: "25", ket: "4.5", ph: "7.05", hco3: "12" });
    await slot(65, { cbg: "21", ket: "3.9" });

    const vit = (a: EmrActor, min: number, values: Record<string, string>) =>
      as(a, g.p, min, (ctx) => recordVitals(ctx, { ...c, values, clientKey: key() }));
    expect(await code(vit(nurse, 66, { sbp: "104", gcsE: "4", gcsV: "4" }))).toBe("invalid");
    expect(await code(vit(nurse, 66, { gcsE: "5", gcsV: "4", gcsM: "6" }))).toBe("invalid");
    expect(await code(vit(mo, 66, { pulse: "110" }))).toBe("forbidden");
    await vit(nurse, 66, {
      sbp: "104",
      dbp: "62",
      pulse: "112",
      rr: "24",
      gcsE: "4",
      gcsV: "4",
      gcsM: "6",
    });

    // The doctor chooses what is monitored; the nurse cannot.
    expect(
      await code(
        as(nurse, g.p, 67, (ctx) =>
          changeParam(ctx, { ...c, add: { name: "SpO₂", unit: "%" }, clientKey: key() }),
        ),
      ),
    ).toBe("forbidden");
    await as(mo, g.p, 67, (ctx) =>
      changeParam(ctx, { ...c, add: { name: "SpO₂", unit: "%" }, clientKey: key() }),
    );
    const withParam = (await as(nurse, g.p, 68, (ctx) => loadChart(ctx, c))).view;
    const spo2 = withParam.vitals.inputs.find((i) => i.label === "SpO₂")!;
    await vit(nurse, 70, { pulse: "104", [spo2.key]: "93" });

    const { view } = await as(mo, g.p, 75, (ctx) => loadChart(ctx, c));
    expect(view.panels.map((p) => p.key)).toEqual(["cbg", "ket", "hco3", "ph"]);
    expect(view.panels[0]!.points.map((p) => p.v)).toEqual([25, 21]);
    const gcs = view.vitals.tiles.find((t) => t.key === "gcs")!;
    expect(gcs.value).toBe("14");
    expect(gcs.word).toContain("E4 V4 M6");
    const tile = view.vitals.tiles.find((t) => t.label === "SpO₂")!;
    expect(tile.value).toBe("93");
    expect(tile.series).toHaveLength(1);
    expect(view.vitals.tiles.find((t) => t.key === "pulse")!.series.map((s) => s.v)).toEqual([
      112, 104,
    ]);
    const gas = view.grid.rows.find((r) => r.key === "ph")!;
    expect(gas.cells.flatMap((x, hr) => (x.due ? [hr] : []))).toEqual([2, 4, 6]);

    // Undo: the nurse undoes her own hour-1 entry with a reason; the trend drops it.
    const slot1 = view.log.find((l) => l.type === "slot" && l.text.includes("1"))!;
    expect(
      await code(
        as(nurse, g.p, 76, (ctx) =>
          undoChartEvent(ctx, { ...c, eventId: slot1.eventId, reason: "x", clientKey: key() }),
        ),
      ),
    ).toBe("invalid");
    await as(nurse, g.p, 76, (ctx) =>
      undoChartEvent(ctx, {
        ...c,
        eventId: slot1.eventId,
        reason: "Wrong patient's meter",
        clientKey: key(),
      }),
    );
    const after = (await as(mo, g.p, 77, (ctx) => loadChart(ctx, c))).view;
    expect(after.panels[0]!.points.map((p) => p.v)).toEqual([25]);
  });
});
