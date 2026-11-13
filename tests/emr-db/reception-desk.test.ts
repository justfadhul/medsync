/**
 * Migration 0294 on the real SQL (reception desk, ADRs 0486–0489). S1: no client — reception, clinician or patient,
 * this hospital or another — reads or writes the desk tables. S2: a check-in's client id is unique per hospital,
 * so a replay cannot make a second intake. Identity attempts are append-only and hold no answer column. A pre-alert
 * cannot arrive before it is acknowledged. The PIN hash stays in the database; 5 wrong tries lock it.
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

const TABLES = ["desk_identity_attempts", "desk_day_closures", "desk_devices", "desk_pins"];

describe.skipIf(!laneOn)("0294: reception desk", () => {
  let pg: Pg;
  let H: string;
  let H2: string;
  let desk: string;
  let deskH2: string;
  let doc: string;
  let device: string;

  beforeAll(async () => {
    ({ pg } = await bootLane());
    H = await hospital(pg, "Desk A");
    H2 = await hospital(pg, "Desk B");
    const D = await department(pg, H);
    const D2 = await department(pg, H2);
    desk = (await reception(pg, { hospitalId: H, departmentId: D })).userId;
    deskH2 = (await reception(pg, { hospitalId: H2, departmentId: D2 })).userId;
    doc = (await clinician(pg, { hospitalId: H, departmentId: D })).userId;
    device = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.desk_devices (hospital_id, label, created_by) VALUES ($1, 'Main desk', $2) RETURNING id`,
        [H, desk],
      )
    ).rows[0]!.id;
    await pg.query(
      `INSERT INTO public.desk_identity_attempts (hospital_id, method, matched, attempt_no, by_user_id)
       VALUES ($1, 'yob', false, 1, $2)`,
      [H, desk],
    );
    await pg.query(
      `INSERT INTO public.desk_day_closures (hospital_id, service_date, closed_by) VALUES ($1, current_date, $2)`,
      [H, desk],
    );
  }, 120_000);

  it("S1: no client reads or writes a desk table, in any hospital", async () => {
    for (const userId of [desk, deskH2, doc]) {
      for (const t of TABLES) {
        const read = await probe(
          pg,
          { userId, role: "authenticated" },
          `SELECT * FROM public.${t}`,
        );
        expect(read.ok ? read.rows : []).toEqual([]);
      }
      const write = await probe(
        pg,
        { userId, role: "authenticated" },
        `INSERT INTO public.desk_devices (hospital_id, label, created_by) VALUES ($1, 'x', $2)`,
        [H, userId],
      );
      expect(write.ok).toBe(false);
    }
  });

  it("S1: the PIN functions are not callable by a client", async () => {
    const r = await probe(
      pg,
      { userId: desk, role: "authenticated" },
      `SELECT public.desk_pin_check($1, $2, '1234')`,
      [device, desk],
    );
    expect(r.ok).toBe(false);
  });

  it("S2: one client id makes one intake per hospital", async () => {
    const p = await authUser(pg, "patient");
    const id = randomUUID();
    const ins = `INSERT INTO public.patient_intakes (hospital_id, entry_type_code, patient_user_id, status, client_id)
                 VALUES ($1, 'walk_in', $2, 'arrived', $3)`;
    await pg.query(ins, [H, p, id]);
    await expect(pg.query(ins, [H, p, id])).rejects.toThrow(/unique|duplicate/i);
    // Another hospital's device may by chance send the same id.
    await pg.query(ins, [H2, p, id]);
  });

  it("identity attempts: append-only, no column for the answer", async () => {
    const cols = (
      await pg.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'desk_identity_attempts'`,
      )
    ).rows.map((r) => r.column_name);
    expect(cols).not.toEqual(expect.arrayContaining(["answer"]));
    expect(cols.some((c) => /answer|year|digits|phone|dob/.test(c))).toBe(false);
    const upd = await pg
      .transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE service_role");
        await tx.query(`UPDATE public.desk_identity_attempts SET matched = true`);
      })
      .then(() => "ok")
      .catch((e: Error) => e.message);
    expect(upd).toMatch(/permission denied/);
  });

  it("a pre-alert cannot arrive before it is acknowledged", async () => {
    const pre = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.emergency_pre_arrivals (facility_id, reporter_token_hash) VALUES ($1, 'x') RETURNING id`,
        [H],
      )
    ).rows[0]!.id;
    await expect(
      pg.query(`UPDATE public.emergency_pre_arrivals SET arrived_at = now() WHERE id = $1`, [pre]),
    ).rejects.toThrow(/pre_alert_not_acknowledged/);
    await pg.query(
      `UPDATE public.emergency_pre_arrivals SET acknowledged_at = now(), acknowledged_by_user_id = $2 WHERE id = $1`,
      [pre, desk],
    );
    await pg.query(`UPDATE public.emergency_pre_arrivals SET arrived_at = now() WHERE id = $1`, [
      pre,
    ]);
  });

  it("PIN: hashed, checked in the database, locked after 5 wrong tries", async () => {
    await expect(
      pg.query(`SELECT public.desk_pin_set($1, $2, '12a4')`, [device, desk]),
    ).rejects.toThrow(/pin_format/);
    await pg.query(`SELECT public.desk_pin_set($1, $2, '4821')`, [device, desk]);
    const hash = (
      await pg.query<{ pin_hash: string }>(
        `SELECT pin_hash FROM public.desk_pins WHERE user_id = $1`,
        [desk],
      )
    ).rows[0]!.pin_hash;
    expect(hash).toMatch(/^\$2/);
    expect(hash).not.toContain("4821");
    const check = async (pin: string) =>
      (
        await pg.query<{ r: string }>(`SELECT public.desk_pin_check($1, $2, $3) AS r`, [
          device,
          desk,
          pin,
        ])
      ).rows[0]!.r;
    expect(await check("4821")).toBe("ok");
    expect(await check("0000")).toBe("wrong");
    expect(await check("4821")).toBe("ok"); // a right PIN clears the count
    for (let i = 0; i < 4; i++) expect(await check("0000")).toBe("wrong");
    expect(await check("0000")).toBe("locked");
    expect(await check("4821")).toBe("locked");
    await pg.query(`SELECT public.desk_pin_set($1, $2, '4821')`, [device, desk]); // after full sign-in
    expect(await check("4821")).toBe("ok");
  });

  it("audit CHECK keeps 0291/0292's verbs and adds the desk's", async () => {
    const def = (
      await pg.query<{ d: string }>(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'sa_audit_log_action_check'`,
      )
    ).rows[0]!.d;
    for (const v of [
      "register_patient",
      "issue_claim_code",
      "claim_desk_record",
      "desk_identity_check",
      "close_day",
    ])
      expect(def).toContain(`'${v}'`);
  });
});
