/**
 * Migration 0295 on the real SQL (clinic floor, ADRs 0491–0497). S1: no client — nurse, doctor, desk, this
 * hospital or another — reads or writes `clinic_floor_events`. S2: a device's client id makes one event per
 * hospital, so a replayed call or check-in cannot double. Append-only (CF9). No column for a name, phone or vital.
 */
import { randomUUID } from "node:crypto";
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  authUser,
  bootLane,
  clinician,
  department,
  hospital,
  laneOn,
  probe,
  reception,
} from "./_pglite";

describe.skipIf(!laneOn)("0295: clinic floor", () => {
  let pg: Pg;
  let H: string;
  let H2: string;
  let intake: string;
  const users: string[] = [];
  let doc: string;

  beforeAll(async () => {
    ({ pg } = await bootLane());
    H = await hospital(pg, "Floor A");
    H2 = await hospital(pg, "Floor B");
    const D = await department(pg, H);
    const D2 = await department(pg, H2);
    doc = (await clinician(pg, { hospitalId: H, departmentId: D })).userId;
    users.push(
      doc,
      (await clinician(pg, { hospitalId: H2, departmentId: D2 })).userId,
      (await reception(pg, { hospitalId: H, departmentId: D })).userId,
    );
    const p = await authUser(pg, "patient");
    intake = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.patient_intakes (hospital_id, entry_type_code, patient_user_id, status)
         VALUES ($1, 'walk_in', $2, 'arrived') RETURNING id`,
        [H, p],
      )
    ).rows[0]!.id;
    await pg.query(
      `INSERT INTO public.clinic_floor_events (hospital_id, intake_id, kind, client_id, by_user_id)
       VALUES ($1, $2, 'call', $3, $4)`,
      [H, intake, randomUUID(), doc],
    );
  }, 120_000);

  it("S1: no client reads or writes the floor events, in any hospital", async () => {
    for (const userId of users) {
      const read = await probe(
        pg,
        { userId, role: "authenticated" },
        `SELECT * FROM public.clinic_floor_events`,
      );
      expect(read.ok ? read.rows : []).toEqual([]);
      const write = await probe(
        pg,
        { userId, role: "authenticated" },
        `INSERT INTO public.clinic_floor_events (hospital_id, intake_id, kind, client_id, by_user_id)
         VALUES ($1, $2, 'here', $3, $4)`,
        [H, intake, randomUUID(), userId],
      );
      expect(write.ok).toBe(false);
    }
  });

  it("S2: one client id makes one event per hospital", async () => {
    const id = randomUUID();
    const ins = `INSERT INTO public.clinic_floor_events (hospital_id, intake_id, kind, client_id, by_user_id)
                 VALUES ($1, $2, 'call', $3, $4)`;
    await pg.query(ins, [H, intake, id, doc]);
    await expect(pg.query(ins, [H, intake, id, doc])).rejects.toThrow(/unique|duplicate/i);
    await pg.query(
      `INSERT INTO public.clinic_floor_events (hospital_id, kind, detail, client_id, by_user_id)
       VALUES ($1, 'doctor_status', 'in_room', $2, $3)`,
      [H2, id, doc],
    );
  });

  it("visit kinds need a visit; detail is a closed list", async () => {
    await expect(
      pg.query(
        `INSERT INTO public.clinic_floor_events (hospital_id, kind, client_id, by_user_id) VALUES ($1, 'call', $2, $3)`,
        [H, randomUUID(), doc],
      ),
    ).rejects.toThrow(/visit_kinds|check/i);
    await expect(
      pg.query(
        `INSERT INTO public.clinic_floor_events (hospital_id, kind, detail, client_id, by_user_id)
         VALUES ($1, 'doctor_status', 'John Okello', $2, $3)`,
        [H, randomUUID(), doc],
      ),
    ).rejects.toThrow(/check/i);
  });

  it("append-only, and no column for a name, phone or vital", async () => {
    const cols = (
      await pg.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'clinic_floor_events'`,
      )
    ).rows.map((r) => r.column_name);
    expect(cols.some((c) => /name|phone|spo2|pulse|bp|temp|vital|position/.test(c))).toBe(false);
    for (const sql of [
      `UPDATE public.clinic_floor_events SET room = 'x'`,
      `DELETE FROM public.clinic_floor_events`,
    ]) {
      const r = await pg
        .transaction(async (tx) => {
          await tx.exec("SET LOCAL ROLE service_role");
          await tx.query(sql);
        })
        .then(() => "ok")
        .catch((e: Error) => e.message);
      expect(r).toMatch(/permission denied/i);
    }
  });
});
