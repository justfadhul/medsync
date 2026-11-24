/**
 * Migration 0312 section 2 on the PGlite lane (ADR 0542): admit from the EU (a boarder keeps the EU space until the
 * ward's Arrived), D6 (the boarder's inpatient record opens at the decision to admit), and the ward's Arrived ends
 * the EU space and the stay in one transaction. R61: one open bed per patient, or the boarding pair.
 * Runs only with EMR_PGLITE=1 (see _pglite.ts).
 */
import { randomUUID } from "node:crypto";
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  bootLane,
  department,
  encounter,
  hospital,
  laneOn,
  patient,
  readMigration,
  staff,
} from "./_pglite";

const BOOT_MS = 180_000;
const PAIR_ONLY = /one open bed, or their EU space and the ward bed they board for/;

describe.skipIf(!laneOn)("0312 — boarding from the EU on real SQL", () => {
  let pg: Pg;
  let h: string;
  let dept: string;
  let doctor: string;
  let nurse: string;

  beforeAll(async () => {
    pg = (await bootLane()).pg;
    h = await hospital(pg, "Boarding");
    dept = await department(pg, h);
    doctor = (await staff(pg, { hospitalId: h, departmentId: dept })).userId;
    nurse = (await staff(pg, { hospitalId: h, departmentId: dept })).userId;
  }, BOOT_MS);

  const call = async (fn: string, payload: Record<string, unknown>) =>
    (
      await pg.query<{ r: Record<string, string> }>(`SELECT public.${fn}($1::jsonb) AS r`, [
        JSON.stringify(payload),
      ])
    ).rows[0]!.r;
  const refusal = (fn: string, payload: Record<string, unknown>) =>
    call(fn, payload).then(
      () => "no refusal",
      (e: Error) => e.message,
    );
  const row = async (sql: string, params: unknown[] = []) =>
    (await pg.query<Record<string, unknown>>(sql, params)).rows[0]!;
  const rows = async (sql: string, params: unknown[] = []) =>
    (await pg.query<Record<string, unknown>>(sql, params)).rows;

  async function newWard(labels: string[], type = "general") {
    const s = randomUUID().slice(0, 8);
    const ward = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count, ward_type)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [h, dept, `Ward ${s}`, `ward-${s}`, labels.length, type],
      )
    ).rows[0]!.id;
    const beds: Record<string, string> = {};
    for (const label of labels)
      beds[label] = (
        await pg.query<{ id: string }>(
          `INSERT INTO public.hospital_beds (hospital_id, ward_id, label) VALUES ($1, $2, $3) RETURNING id`,
          [h, ward, label],
        )
      ).rows[0]!.id;
    return { ward, beds };
  }

  async function visit() {
    const p = await patient(pg);
    const e = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor,
      departmentId: dept,
    });
    return { p, e };
  }

  /** A patient sent to an EU space (arrived unless told otherwise), and a general ward to admit to. */
  async function inEu(o: { arrived?: boolean } = {}) {
    const eu = await newWard(["R1", "T1"], "emergency_observation");
    const ward = await newWard(["1", "2"]);
    const { p, e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: eu.ward,
      bed_id: eu.beds["R1"],
    });
    if (o.arrived !== false)
      await call("confirm_bed_arrival", {
        hospital_id: h,
        assignment_id: r.assignment_id,
        actor: nurse,
      });
    return { eu, ward, p, e, stay: r.stay_id!, euAsg: r.assignment_id! };
  }

  const open = (p: string) =>
    rows(
      `SELECT id, ward_id, eu_stay_id, admission_id, arrived_at IS NOT NULL AS arrived
         FROM public.bed_assignments WHERE patient_user_id = $1 AND ended_at IS NULL ORDER BY started_at`,
      [p],
    );

  it("admit with a ward bed from an arrived EU space: Arriving ward bed, EU space kept, stay boarding, inpatient record open now", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_id: x.ward.beds["1"],
    });
    const adm = await row(
      `SELECT status, inpatient_encounter_id FROM public.admissions WHERE id = $1`,
      [r.admission_id],
    );
    expect(adm.status).toBe("bed_allocated");
    expect(adm.inpatient_encounter_id).not.toBeNull();
    expect(
      await row(
        `SELECT state, encounter_type, clinician_user_id, department_id FROM public.encounters WHERE id = $1`,
        [adm.inpatient_encounter_id],
      ),
    ).toEqual({
      state: "in_progress",
      encounter_type: "inpatient",
      clinician_user_id: doctor,
      department_id: dept,
    });
    expect(
      await row(`SELECT state, disposition FROM public.encounters WHERE id = $1`, [x.e]),
    ).toEqual({ state: "completed", disposition: "admitted" });
    const o = await open(x.p);
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({ id: x.euAsg, eu_stay_id: x.stay, arrived: true });
    expect(o[1]).toMatchObject({
      ward_id: x.ward.ward,
      admission_id: r.admission_id,
      arrived: false,
    });
    expect(
      await row(`SELECT status, admission_id FROM public.eu_stays WHERE id = $1`, [x.stay]),
    ).toEqual({ status: "in_space", admission_id: r.admission_id });
  });

  it("refuses while the EU space is still Arriving", async () => {
    const x = await inEu({ arrived: false });
    expect(
      await refusal("admit_from_encounter", {
        encounter_id: x.e,
        actor: doctor,
        ward_id: x.ward.ward,
        bed_id: x.ward.beds["1"],
      }),
    ).toBe("AD409 Mark the patient as arrived in the EU first.");
    expect(
      await row(
        `SELECT (SELECT count(*) FROM public.admissions WHERE patient_user_id = $1)::int AS admissions,
                (SELECT count(*) FROM public.encounters WHERE patient_user_id = $1)::int AS encounters,
                (SELECT state FROM public.encounters WHERE id = $2) AS state,
                (SELECT admission_id FROM public.eu_stays WHERE id = $3) AS stay_admission`,
        [x.p, x.e, x.stay],
      ),
    ).toEqual({ admissions: 0, encounters: 1, state: "in_progress", stay_admission: null });
    expect(await open(x.p)).toHaveLength(1);
  });

  it("admits to the waiting list from the EU", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_wait_reason: "no_free_bed",
    });
    const adm = await row(
      `SELECT status, inpatient_encounter_id FROM public.admissions WHERE id = $1`,
      [r.admission_id],
    );
    expect(adm.status).toBe("awaiting_bed");
    expect(adm.inpatient_encounter_id).not.toBeNull();
    expect(
      (await row(`SELECT admission_id FROM public.eu_stays WHERE id = $1`, [x.stay])).admission_id,
    ).toBe(r.admission_id);
    expect(await open(x.p)).toHaveLength(1);
    // The ward gives the boarder a bed later: the boarding pair.
    await call("allocate_admission_bed", {
      hospital_id: h,
      admission_id: r.admission_id,
      bed_id: x.ward.beds["2"],
      actor: nurse,
    });
    const o = await open(x.p);
    expect(o.map((a) => [a.eu_stay_id, a.admission_id, a.arrived])).toEqual([
      [x.stay, null, true],
      [null, r.admission_id, false],
    ]);
  });

  it("a boarder on the waiting list whose EU space is Arriving gets no ward bed yet", async () => {
    const x = await inEu({ arrived: false });
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_wait_reason: "no_free_bed",
    });
    expect(
      await refusal("allocate_admission_bed", {
        hospital_id: h,
        admission_id: r.admission_id,
        bed_id: x.ward.beds["1"],
        actor: nurse,
      }),
    ).toBe("AD409 Mark the patient as arrived in the EU first.");
    expect(await open(x.p)).toHaveLength(1);
  });

  it("refuses an EU as the ward", async () => {
    const x = await inEu();
    expect(
      await refusal("admit_from_encounter", {
        encounter_id: x.e,
        actor: doctor,
        ward_id: x.eu.ward,
        bed_id: x.eu.beds["T1"],
      }),
    ).toBe("AD409 An emergency unit is not a ward to admit to.");
    const plain = await visit();
    expect(
      await refusal("admit_from_encounter", {
        encounter_id: plain.e,
        actor: doctor,
        ward_id: x.eu.ward,
        bed_wait_reason: "no_free_bed",
      }),
    ).toBe("AD409 An emergency unit is not a ward to admit to.");
  });

  it("a patient not in the EU is admitted exactly as before", async () => {
    const ward = await newWard(["1", "2"]);
    const { p, e } = await visit();
    const r = await call("admit_from_encounter", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward.ward,
      bed_id: ward.beds["1"],
    });
    expect(
      await row(`SELECT status, inpatient_encounter_id FROM public.admissions WHERE id = $1`, [
        r.admission_id,
      ]),
    ).toEqual({ status: "bed_allocated", inpatient_encounter_id: null });
    expect(
      (
        await row(
          `SELECT count(*)::int AS n FROM public.encounters WHERE patient_user_id = $1 AND encounter_type = 'inpatient'`,
          [p],
        )
      ).n,
    ).toBe(0);
    const a = await call("confirm_bed_arrival", {
      hospital_id: h,
      assignment_id: r.assignment_id,
      actor: nurse,
    });
    expect(a.inpatient_encounter_id).toBeTruthy();
    expect(
      await row(`SELECT status, inpatient_encounter_id FROM public.admissions WHERE id = $1`, [
        r.admission_id,
      ]),
    ).toEqual({ status: "arrived", inpatient_encounter_id: a.inpatient_encounter_id });
    // A patient already in a bed (Occupied, no EU) is still refused a second one (AD409).
    const bed = await newWard(["9"]);
    const q = await visit();
    await pg.query(
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [h, bed.ward, bed.beds["9"], q.p, nurse],
    );
    expect(
      await refusal("admit_from_encounter", {
        encounter_id: q.e,
        actor: doctor,
        ward_id: ward.ward,
        bed_id: ward.beds["2"],
      }),
    ).toBe("AD409 This patient is already in a bed. The ward releases it first.");
  });

  it("the ward's Arrived ends the EU space and stay in one go and reuses the inpatient record", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_id: x.ward.beds["1"],
    });
    const inpatient = (
      await row(`SELECT inpatient_encounter_id FROM public.admissions WHERE id = $1`, [
        r.admission_id,
      ])
    ).inpatient_encounter_id;
    const a = await call("confirm_bed_arrival", {
      hospital_id: h,
      assignment_id: r.assignment_id,
      actor: nurse,
    });
    expect(a.inpatient_encounter_id).toBe(inpatient);
    expect(
      (
        await row(
          `SELECT count(*)::int AS n FROM public.encounters WHERE patient_user_id = $1 AND encounter_type = 'inpatient'`,
          [x.p],
        )
      ).n,
    ).toBe(1);
    const wardName = (
      await row(`SELECT name FROM public.hospital_wards WHERE id = $1`, [x.ward.ward])
    ).name;
    expect(
      await row(
        `SELECT ended_at IS NOT NULL AS ended, ended_by, reason FROM public.bed_assignments WHERE id = $1`,
        [x.euAsg],
      ),
    ).toEqual({ ended: true, ended_by: nurse, reason: `Arrived on ${wardName}` });
    expect(
      await row(
        `SELECT status, end_kind, ended_by, admission_id FROM public.eu_stays WHERE id = $1`,
        [x.stay],
      ),
    ).toEqual({
      status: "ended",
      end_kind: "admitted",
      ended_by: nurse,
      admission_id: r.admission_id,
    });
    const o = await open(x.p);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ id: r.assignment_id, arrived: true });
    expect(
      await row(`SELECT status, inpatient_encounter_id FROM public.admissions WHERE id = $1`, [
        r.admission_id,
      ]),
    ).toEqual({ status: "arrived", inpatient_encounter_id: inpatient });
    expect(
      (await row(`SELECT state FROM public.encounters WHERE id = $1`, [inpatient])).state,
    ).toBe("in_progress");
  });

  it("moving EU spaces while boarding works", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_id: x.ward.beds["1"],
    });
    const m = await call("move_eu_space", {
      hospital_id: h,
      stay_id: x.stay,
      actor: nurse,
      bed_id: x.eu.beds["T1"],
    });
    const o = await open(x.p);
    expect(o.map((a) => [a.id, a.arrived])).toEqual([
      [r.assignment_id, false],
      [m.assignment_id, true],
    ]);
    expect(o[1]).toMatchObject({ eu_stay_id: x.stay, ward_id: x.eu.ward });
  });

  it("an ended admission leaves the boarder in the EU", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_id: x.ward.beds["1"],
    });
    await call("release_admission_bed", {
      hospital_id: h,
      admission_id: r.admission_id,
      actor: nurse,
      reason: "Needs the EU a while longer",
      outcome: "end",
    });
    expect(
      (await row(`SELECT status FROM public.admissions WHERE id = $1`, [r.admission_id])).status,
    ).toBe("cancelled");
    expect((await row(`SELECT status FROM public.eu_stays WHERE id = $1`, [x.stay])).status).toBe(
      "in_space",
    );
    const o = await open(x.p);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ id: x.euAsg, arrived: true });
  });

  it("the guard refuses an inpatient record on a non-boarder's admission before arrival", async () => {
    const ward = await newWard(["1"]);
    const { p, e } = await visit();
    const other = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor,
      departmentId: dept,
    });
    const insert = (inpatient: string | null) =>
      pg.query<{ id: string }>(
        `INSERT INTO public.admissions (hospital_id, patient_user_id, source_encounter_id, ward_id, decided_by,
                                        bed_wait_reason, inpatient_encounter_id)
         VALUES ($1, $2, $3, $4, $5, 'no_free_bed', $6) RETURNING id`,
        [h, p, e, ward.ward, doctor, inpatient],
      );
    await expect(insert(other)).rejects.toThrow(/starts waiting for a bed or with a bed allocated/);
    const adm = (await insert(null)).rows[0]!.id;
    // Stamped before arrival: refused.
    await expect(
      pg.query(
        `UPDATE public.admissions SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2,
                cancel_reason = 'Not needed', inpatient_encounter_id = $3 WHERE id = $1`,
        [adm, doctor, other],
      ),
    ).rejects.toThrow(/stamped with their own move/);
    // Same status: still refused.
    await expect(
      pg.query(`UPDATE public.admissions SET status = 'awaiting_bed' WHERE id = $1`, [adm]),
    ).rejects.toThrow(/cannot go from awaiting_bed to awaiting_bed/);
  });

  it("a boarder's inpatient record is stamped once", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_wait_reason: "no_free_bed",
    });
    const other = await encounter(pg, {
      hospitalId: h,
      patientUserId: x.p,
      clinicianUserId: doctor,
      departmentId: dept,
    });
    await expect(
      pg.query(
        `UPDATE public.admissions SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2,
                cancel_reason = 'Not needed', inpatient_encounter_id = $3 WHERE id = $1`,
        [r.admission_id, doctor, other],
      ),
    ).rejects.toThrow(/stamped once/);
  });

  /* ─── R61: one open bed per patient, or the boarding pair ─── */

  it("the boarding pair is allowed: an Occupied EU space and an Arriving ward bed for the stay's admission", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_wait_reason: "no_free_bed",
    });
    const pair = await pg.query<{ id: string }>(
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, admission_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [h, x.ward.ward, x.ward.beds["1"], x.p, nurse, r.admission_id],
    );
    expect(pair.rows).toHaveLength(1);
    expect(await open(x.p)).toHaveLength(2);
    // A third open row, of any kind, is refused.
    await expect(
      pg.query(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, eu_stay_id,
                                             arrived_at, arrived_by)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $5)`,
        [h, x.eu.ward, x.eu.beds["T1"], x.p, nurse, x.stay],
      ),
    ).rejects.toThrow(PAIR_ONLY);
  });

  it("a second open row that is not the boarding pair is refused", async () => {
    // In the EU with an admission the stay does not board for (another index each: only the guard sees it).
    const x = await inEu();
    const adm = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.admissions (hospital_id, patient_user_id, source_encounter_id, ward_id, decided_by,
                                        bed_wait_reason)
         VALUES ($1, $2, $3, $4, $5, 'no_free_bed') RETURNING id`,
        [h, x.p, x.e, x.ward.ward, doctor],
      )
    ).rows[0]!.id;
    await expect(
      pg.query(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, admission_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [h, x.ward.ward, x.ward.beds["1"], x.p, nurse, adm],
      ),
    ).rejects.toThrow(PAIR_ONLY);
    // An Arriving EU space and a ward bed: refused too.
    const y = await inEu({ arrived: false });
    const r = await call("admit_from_encounter", {
      encounter_id: y.e,
      actor: doctor,
      ward_id: y.ward.ward,
      bed_wait_reason: "no_free_bed",
    });
    await expect(
      pg.query(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, admission_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [h, y.ward.ward, y.ward.beds["1"], y.p, nurse, r.admission_id],
      ),
    ).rejects.toThrow(PAIR_ONLY);
  });

  it("the close guard: the admitted boarder's visit completes; their inpatient record closes only with the EU close", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_id: x.ward.beds["1"],
    });
    expect((await row(`SELECT state FROM public.encounters WHERE id = $1`, [x.e])).state).toBe(
      "completed",
    );
    await call("release_admission_bed", {
      hospital_id: h,
      admission_id: r.admission_id,
      actor: nurse,
      reason: "Ward full after all",
      outcome: "end",
    });
    const inpatient = (
      await row(`SELECT inpatient_encounter_id FROM public.admissions WHERE id = $1`, [
        r.admission_id,
      ])
    ).inpatient_encounter_id as string;
    await expect(
      pg.query(
        `UPDATE public.encounters SET state = 'completed', ended_at = now(), completed_by = $2 WHERE id = $1`,
        [inpatient, doctor],
      ),
    ).rejects.toThrow(/EU409 This patient is in the emergency unit/);
    const end = await call("end_eu_stay", {
      encounter_id: inpatient,
      actor: doctor,
      end_kind: "home",
      disposition: "home",
    });
    expect(end).toEqual({ ended: true, stay_id: x.stay });
    expect(await row(`SELECT state FROM public.encounters WHERE id = $1`, [inpatient])).toEqual({
      state: "completed",
    });
    expect(await open(x.p)).toHaveLength(0);
  });

  it("admits only from the visit the stay belongs to", async () => {
    const x = await inEu();
    const other = await encounter(pg, {
      hospitalId: h,
      patientUserId: x.p,
      clinicianUserId: doctor,
      departmentId: dept,
    });
    expect(
      await refusal("admit_from_encounter", {
        encounter_id: other,
        actor: doctor,
        ward_id: x.ward.ward,
        bed_wait_reason: "no_free_bed",
      }),
    ).toBe(
      "AD409 This patient is in the emergency unit on another visit. Admit them from that visit.",
    );
  });

  it("R62: a boarder who dies in the EU: the admission ends, no bed is held, the ward's Arrived is refused", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_id: x.ward.beds["1"],
    });
    const inpatient = (
      await row(`SELECT inpatient_encounter_id FROM public.admissions WHERE id = $1`, [
        r.admission_id,
      ])
    ).inpatient_encounter_id as string;
    expect(
      await call("end_eu_stay", {
        encounter_id: inpatient,
        actor: doctor,
        end_kind: "died",
        disposition: "deceased",
      }),
    ).toEqual({ ended: true, stay_id: x.stay });
    expect(
      await row(`SELECT status, cancelled_by, cancel_reason FROM public.admissions WHERE id = $1`, [
        r.admission_id,
      ]),
    ).toEqual({
      status: "cancelled",
      cancelled_by: doctor,
      cancel_reason: "Left the EU before reaching the ward",
    });
    expect(
      await row(`SELECT status, end_kind FROM public.eu_stays WHERE id = $1`, [x.stay]),
    ).toEqual({ status: "ended", end_kind: "died" });
    expect(await open(x.p)).toHaveLength(0);
    expect(
      (await row(`SELECT reason FROM public.bed_assignments WHERE id = $1`, [r.assignment_id]))
        .reason,
    ).toBe("Left the EU");
    expect(
      await refusal("confirm_bed_arrival", {
        hospital_id: h,
        assignment_id: r.assignment_id,
        actor: nurse,
      }),
    ).toBe("AD409 Nobody is arriving in this bed.");
  });

  it("R62: a boarder on the waiting list who goes home from the EU: the admission ends", async () => {
    const x = await inEu();
    const r = await call("admit_from_encounter", {
      encounter_id: x.e,
      actor: doctor,
      ward_id: x.ward.ward,
      bed_wait_reason: "no_free_bed",
    });
    const inpatient = (
      await row(`SELECT inpatient_encounter_id FROM public.admissions WHERE id = $1`, [
        r.admission_id,
      ])
    ).inpatient_encounter_id as string;
    await call("end_eu_stay", {
      encounter_id: inpatient,
      actor: doctor,
      end_kind: "home",
      disposition: "home",
    });
    expect(
      (await row(`SELECT status FROM public.admissions WHERE id = $1`, [r.admission_id])).status,
    ).toBe("cancelled");
    expect(await open(x.p)).toHaveLength(0);
  });
});

/* R57 / R61: the 0312 functions keep the lock order encounter → stay → assignment. Read from the newest body
   (0313 redefines end_eu_stay). */
describe("0312 — lock order", () => {
  const sql = ["0312_eu_boarding.sql", "0313_eu_links.sql"]
    .map(readMigration)
    .join("\n")
    .replace(/--[^\n]*/g, "");
  const order = (fn: string, tables = ["encounters", "eu_stays", "bed_assignments"]) => {
    const start = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}(p jsonb)`);
    expect(start, fn).toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("\n$$;", start));
    const seen: string[] = [];
    for (const stmt of body.split(";")) {
      const t = /\bFOR UPDATE\b/.test(stmt)
        ? /FROM public\.(\w+)/.exec(stmt)?.[1]
        : /(?<!FOR )\bUPDATE public\.(\w+)/.exec(stmt)?.[1];
      if (t && tables.includes(t) && !seen.includes(t)) seen.push(t);
    }
    return seen;
  };

  it("confirm_bed_arrival and move_eu_space lock encounter → stay → assignment", () => {
    for (const fn of ["confirm_bed_arrival", "move_eu_space"])
      expect(order(fn), fn).toEqual(["encounters", "eu_stays", "bed_assignments"]);
  });

  it("admit_from_encounter locks the encounter before the stay", () => {
    expect(order("admit_from_encounter")).toEqual(["encounters", "eu_stays"]);
  });

  it("end_eu_stay locks visit → stay → admission → assignment (R62)", () => {
    expect(
      order("end_eu_stay", ["encounters", "eu_stays", "admissions", "bed_assignments"]),
    ).toEqual(["encounters", "eu_stays", "admissions", "bed_assignments"]);
  });

  it("confirm_bed_arrival boards only for an open stay", () => {
    expect(sql).toContain("ON s.admission_id = a.admission_id AND s.status <> 'ended'");
  });

  it("the guard serialises a patient's inserts", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtext(NEW.patient_user_id::text))");
  });
});
