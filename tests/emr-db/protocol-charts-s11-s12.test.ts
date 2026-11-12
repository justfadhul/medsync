/**
 * Protocol charts, acceptance scenarios S11 and S12 (prescribing kit §4) on the PGlite lane.
 * S11: a running chart shows in the nurse's "Protocols running" and on the patient record, and opens
 * in its own protocol; once ended it leaves the ward list and stays on the record as ended.
 * S12 (P11): offline, the nurse records an hour and hangs a bag; both wait in the EMR outbox and are
 * sent when the connection is back. The first reply is lost, so each is resent by its client key
 * after the chart has moved on: the server returns the saved event, and nothing is doubled.
 * Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { ActionResult, WriteCtx } from "@/lib/emr/write/context";
import type { Act } from "@/lib/protocols/engine/types";
import { beforeAll, describe, expect, it } from "vitest";

import { loadRunningCharts } from "@/lib/emr/read/protocol-charts";
import { createWriteQueue } from "@/lib/emr/sync/queue";
import { withPatientWrite } from "@/lib/emr/write/context";
import { recordObservations } from "@/lib/emr/write/facts";
import { completeIvTask } from "@/lib/emr/write/nursing";
import {
  chartAct,
  endChart,
  listPatientCharts,
  loadChart,
  recordSlot,
  startChart,
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

describe.skipIf(!laneOn)("protocol charts, S11–S12 (PGlite lane)", () => {
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

  async function person() {
    const p = await patient(lane.pg);
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1990-03-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Akello"), encrypt("Mary"), encrypt("0700000001")],
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
    const versionOf = async (id: string) =>
      (
        await q<{ id: string }>(
          `SELECT id FROM public.protocol_versions WHERE protocol_id = $1 AND hospital_id IS NULL`,
          [id],
        )
      )[0]!.id;
    return { p, e, versionOf };
  }

  it("S11: a running chart is in the nurse area and on the record, and opens in its protocol", async () => {
    const g = await person();
    const start = async (protocol: string, min: number) => {
      const versionId = await g.versionOf(protocol);
      return (
        await as(mo, g.p, min, (ctx) =>
          startChart(ctx, { patientUserId: g.p, encounterId: g.e, versionId, clientKey: key() }),
        )
      ).id;
    };
    const dka = await start("dka", 0);
    const ssi = await start("ssi", 1);

    // The nurse's "Protocols running" (nurse Tasks page) lists both, by protocol name.
    const ward = await as(nurse, g.p, 2, (ctx) => loadRunningCharts(ctx.tx, h));
    const mine = ward.filter((r) => r.patientUserId === g.p);
    expect(mine.map((r) => r.id).sort()).toEqual([dka, ssi].sort());
    expect(mine.find((r) => r.id === dka)!.name).toMatch(/DKA/);

    // Patient record › Protocols lists them; each opens in its own protocol.
    const record = await as(nurse, g.p, 2, (ctx) => listPatientCharts(ctx, g.p));
    expect(Object.fromEntries(record.map((c) => [c.id, c.protocolId]))).toEqual({
      [dka]: "dka",
      [ssi]: "ssi",
    });
    for (const [id, protocol] of [
      [dka, "dka"],
      [ssi, "ssi"],
    ] as const) {
      const c = await as(nurse, g.p, 3, (ctx) =>
        loadChart(ctx, { chartId: id, patientUserId: g.p }),
      );
      expect([c.view.protocolId, c.view.endedAt]).toEqual([protocol, null]);
    }

    // Ended: off the ward list, still on the record (ended, with its reason).
    await as(mo, g.p, 4, (ctx) =>
      endChart(ctx, { patientUserId: g.p, chartId: ssi, reason: "Eating again", clientKey: key() }),
    );
    const after = await as(nurse, g.p, 5, (ctx) => loadRunningCharts(ctx.tx, h));
    expect(after.filter((r) => r.patientUserId === g.p).map((r) => r.id)).toEqual([dka]);
    const ended = (await as(nurse, g.p, 5, (ctx) => listPatientCharts(ctx, g.p))).find(
      (c) => c.id === ssi,
    )!;
    expect([ended.endedAt !== null, ended.endReason]).toEqual([true, "Eating again"]);
  });

  it("S12: an hour and a bag recorded offline sync once, with no duplicates", async () => {
    const g = await person();
    const versionId = await g.versionOf("dka");
    const chartId = (
      await as(mo, g.p, 0, (ctx) =>
        startChart(ctx, { patientUserId: g.p, encounterId: g.e, versionId, clientKey: key() }),
      )
    ).id;
    const c = { patientUserId: g.p, chartId };
    const act = (a: EmrActor, min: number, x: Act, value?: string) =>
      as(a, g.p, min, (ctx) => chartAct(ctx, { ...c, act: x, value, clientKey: key() }));
    // As S7: confirmed, a line asked for and put in, so the first bag is the nurse's to hang.
    for (const [k, x] of [
      ["cbg", "25"],
      ["ket", "4.5"],
      ["ph", "7.05"],
      ["hco3", "12"],
    ] as const)
      await act(mo, 2, { t: "value", key: k }, x);
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

    // Offline: the nurse's two entries wait in the outbox; nothing reaches the server.
    let min = 15;
    const sent: string[] = [];
    const lost = new Set<string>();
    const queue = createWriteQueue({ now: () => at(min).getTime(), online: false });
    const viaQueue =
      (write: (ctx: WriteCtx, clientKey: string) => Promise<{ id: string }>) =>
      async ({ clientKey }: { clientKey: string }): Promise<ActionResult<unknown>> => {
        sent.push(clientKey);
        const r = await as(nurse, g.p, min, (ctx) => write(ctx, clientKey));
        // The first reply is lost on the way back: saved on the server, retried by the device.
        if (!lost.has(clientKey)) {
          lost.add(clientKey);
          throw new Error("connection dropped");
        }
        return { ok: true, id: r.id, serverTime: at(min).toISOString() };
      };
    const ids: string[] = [];
    queue.submit({
      label: "Observations",
      run: viaQueue((ctx, clientKey) =>
        recordSlot(ctx, {
          ...c,
          values: { cbg: "25", ket: "4.5", ph: "7.05", hco3: "12", k: "4.2", uo: "60" },
          clientKey,
        }),
      ),
      onSaved: (r) => ids.push(r.id),
    });
    queue.submit({
      label: "Chart entry",
      run: viaQueue((ctx, clientKey) =>
        chartAct(ctx, { ...c, act: { t: "mark", key: "fluid1At" }, clientKey }),
      ),
      onSaved: (r) => ids.push(r.id),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toEqual([]);
    expect(queue.getSnapshot().map((e) => e.status)).toEqual(["pending", "pending"]);

    // Back online: sent in order; each first reply is lost and resent (a later clock, so the slot
    // has moved on and the bag is no longer offered); the server answers with the saved event.
    min = 20;
    queue.setOnline(true);
    for (let i = 0; i < 100 && queue.getSnapshot().length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      min = 21;
      queue.setOnline(true); // wake: skip the retry backoff
    }
    expect(queue.getSnapshot()).toEqual([]);
    expect(sent.length).toBe(4);
    expect(new Set(sent).size).toBe(2);

    const rows = await q<{ id: string; type: string; n: number }>(
      `SELECT type, count(*)::int AS n, min(id::text) AS id FROM public.protocol_chart_events
        WHERE chart_id = $1 AND type IN ('slot', 'mark') GROUP BY type ORDER BY type`,
      [chartId],
    );
    expect(rows.map((r) => [r.type, r.n])).toEqual([
      ["mark", 1],
      ["slot", 1],
    ]);
    expect(ids.sort()).toEqual(rows.map((r) => r.id).sort());
    const v = (await as(nurse, g.p, 22, (ctx) => loadChart(ctx, c))).view;
    expect(v.nextSlot).toBe(1);
  });
});
