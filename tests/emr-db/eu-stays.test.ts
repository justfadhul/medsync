/**
 * Migration 0311 on the PGlite lane (ADR 0541): the EU stay. One open stay per patient, started open and kept for
 * good; only its status, space, arrival, responsible clinician and end move; a bed assignment serves an admission or
 * a stay, never both; clinical staff of the hospital read stays, nobody writes them from a client.
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
  intake,
  laneOn,
  patient,
  probe,
  staff,
} from "./_pglite";

const BOOT_MS = 180_000;

describe.skipIf(!laneOn)("0311 — the EU stay on real SQL", () => {
  let pg: Pg;
  let h: string;
  let dept: string;
  let doctor: string;
  let eu: string;
  let euBeds: Record<string, string>;

  beforeAll(async () => {
    pg = (await bootLane()).pg;
    h = await hospital(pg, "EU");
    dept = await department(pg, h);
    doctor = (await staff(pg, { hospitalId: h, departmentId: dept })).userId;
    const s = randomUUID().slice(0, 8);
    eu = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count, ward_type)
         VALUES ($1, $2, $3, $4, 2, 'emergency_observation') RETURNING id`,
        [h, dept, `EU ${s}`, `eu-${s}`],
      )
    ).rows[0]!.id;
    for (const label of ["R1", "T1"])
      await pg.query(
        `INSERT INTO public.hospital_beds (hospital_id, ward_id, label) VALUES ($1, $2, $3)`,
        [h, eu, label],
      );
    euBeds = Object.fromEntries(
      (
        await pg.query<{ id: string; label: string }>(
          `SELECT id, label FROM public.hospital_beds WHERE ward_id = $1`,
          [eu],
        )
      ).rows.map((r) => [r.label, r.id]),
    );
  }, BOOT_MS);

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

  /** A doctor's stay for a fresh patient unless `p` and `e` are given; overrides win. */
  async function insertStay(o: Record<string, unknown> = {}): Promise<string> {
    const v = o.patient_user_id ? null : await visit();
    const cols: Record<string, unknown> = {
      hospital_id: h,
      patient_user_id: v?.p,
      encounter_id: v?.e,
      ward_id: eu,
      started_by_kind: "doctor",
      decided_by: doctor,
      responsible_user_id: doctor,
      status: "awaiting_space",
      space_wait_reason: "no_free_bed",
      ...o,
    };
    const keys = Object.keys(cols);
    return (
      await pg.query<{ id: string }>(
        `INSERT INTO public.eu_stays (${keys.join(", ")})
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        keys.map((k) => cols[k]),
      )
    ).rows[0]!.id;
  }

  it("a stay starts open, ends once, and is never deleted", async () => {
    const s = await insertStay({ status: "in_space" });
    await expect(
      pg.query(
        `UPDATE public.eu_stays SET status='ended', ended_at=now(), ended_by=$2, end_kind='home' WHERE id=$1`,
        [s, doctor],
      ),
    ).resolves.toBeTruthy();
    await expect(
      pg.query(`UPDATE public.eu_stays SET end_kind='died' WHERE id=$1`, [s]),
    ).rejects.toThrow(/ended stay/);
    await expect(pg.query(`DELETE FROM public.eu_stays WHERE id=$1`, [s])).rejects.toThrow(
      /kept for good/,
    );
    await expect(
      insertStay({
        status: "ended",
        ended_at: new Date().toISOString(),
        ended_by: doctor,
        end_kind: "home",
      }),
    ).rejects.toThrow(/starts open, not arrived, with no admission/);
    await expect(
      insertStay({ arrived_at: new Date().toISOString(), arrived_by: doctor }),
    ).rejects.toThrow(/starts open, not arrived, with no admission/);
  });

  it("moves only awaiting_space ↔ in_space, or to ended", async () => {
    const s = await insertStay();
    await pg.query(
      `UPDATE public.eu_stays SET status='in_space', space_wait_reason=null WHERE id=$1`,
      [s],
    );
    await pg.query(
      `UPDATE public.eu_stays SET status='awaiting_space', space_wait_reason='floor' WHERE id=$1`,
      [s],
    );
    await expect(
      pg.query(`UPDATE public.eu_stays SET status='ended' WHERE id=$1`, [s]),
    ).rejects.toThrow(/eu_stays_end_check/);
  });

  it("one open stay per patient", async () => {
    const { p, e } = await visit();
    await insertStay({ patient_user_id: p, encounter_id: e });
    await expect(insertStay({ patient_user_id: p, encounter_id: e })).rejects.toThrow(
      /eu_stays_one_open_per_patient/,
    );
  });

  it("a triage stay needs an intake; a doctor's stay needs an encounter", async () => {
    const p = await patient(pg);
    const i = await intake(pg, { hospitalId: h, patientUserId: p });
    await expect(
      insertStay({ patient_user_id: p, encounter_id: null, started_by_kind: "triage_nurse" }),
    ).rejects.toThrow(/eu_stays_who_check/);
    await expect(
      insertStay({ patient_user_id: p, encounter_id: null, intake_id: i }),
    ).rejects.toThrow(/eu_stays_who_check/);
    await expect(
      insertStay({
        patient_user_id: p,
        encounter_id: null,
        intake_id: i,
        started_by_kind: "triage_nurse",
      }),
    ).resolves.toBeTruthy();
  });

  it("decided_by and decided_at never change; encounter_id is stamped once", async () => {
    const p = await patient(pg);
    const i = await intake(pg, { hospitalId: h, patientUserId: p });
    const s = await insertStay({
      patient_user_id: p,
      encounter_id: null,
      intake_id: i,
      started_by_kind: "triage_nurse",
    });
    await expect(
      pg.query(`UPDATE public.eu_stays SET decided_by=$2 WHERE id=$1`, [s, randomUUID()]),
    ).rejects.toThrow(/^Only an EU stay/);
    await expect(
      pg.query(`UPDATE public.eu_stays SET decided_at=now() - interval '1 hour' WHERE id=$1`, [s]),
    ).rejects.toThrow(/^Only an EU stay/);
    const e1 = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    const e2 = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    await pg.query(`UPDATE public.eu_stays SET encounter_id=$2 WHERE id=$1`, [s, e1]);
    await expect(
      pg.query(`UPDATE public.eu_stays SET encounter_id=$2 WHERE id=$1`, [s, e2]),
    ).rejects.toThrow(/stamped once/);
    await expect(
      pg.query(`UPDATE public.eu_stays SET encounter_id=null WHERE id=$1`, [s]),
    ).rejects.toThrow(/stamped once/);
  });

  it("an assignment is for an admission or a stay, never both; only an EU move may start arrived", async () => {
    const { p, e } = await visit();
    const s = await insertStay({ patient_user_id: p, encounter_id: e });
    const adm = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.admissions (hospital_id, patient_user_id, source_encounter_id, ward_id, decided_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [h, p, e, eu, doctor],
      )
    ).rows[0]!.id;
    await expect(
      pg.query(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, admission_id, eu_stay_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [h, eu, euBeds["T1"], p, doctor, adm, s],
      ),
    ).rejects.toThrow(/bed_assignments_one_purpose_check/);
    // An insert that comes arrived: refused without a stay, allowed for a stay (a move inside the EU).
    await expect(
      pg.query(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, arrived_at, arrived_by)
         VALUES ($1, $2, $3, $4, $5, now(), $5)`,
        [h, eu, euBeds["T1"], p, doctor],
      ),
    ).rejects.toThrow(/starts open/);
    const ok = await pg.query<{ eu_stay_id: string; arrived_at: string }>(
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, eu_stay_id, arrived_at, arrived_by)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $5) RETURNING eu_stay_id, arrived_at`,
      [h, eu, euBeds["T1"], p, doctor, s],
    );
    expect(ok.rows[0]).toMatchObject({ eu_stay_id: s });
    expect(ok.rows[0]!.arrived_at).not.toBeNull();
  });

  it("RLS: clinical staff read stays; a patient and an outsider read none; nobody writes", async () => {
    const { p, e } = await visit();
    await insertStay({ patient_user_id: p, encounter_id: e });
    const h2 = await hospital(pg, "Elsewhere");
    const outsider = (await staff(pg, { hospitalId: h2, departmentId: await department(pg, h2) }))
      .userId;
    const read = (userId: string) =>
      probe(
        pg,
        { userId, role: "authenticated", aal: "aal2" },
        `SELECT id FROM public.eu_stays WHERE patient_user_id = $1`,
        [p],
      );
    const asDoctor = await read(doctor);
    expect(asDoctor.ok && asDoctor.rows.length).toBe(1);
    const asPatient = await read(p);
    expect(asPatient.ok && asPatient.rows.length).toBe(0);
    const asOutsider = await read(outsider);
    expect(asOutsider.ok && asOutsider.rows.length).toBe(0);
    // Without MFA, staff read nothing (0288's gate).
    const aal1 = await probe(
      pg,
      { userId: doctor, role: "authenticated", aal: "aal1" },
      `SELECT id FROM public.eu_stays WHERE patient_user_id = $1`,
      [p],
    );
    expect(aal1.ok && aal1.rows.length).toBe(0);
    const write = await probe(
      pg,
      { userId: doctor, role: "authenticated", aal: "aal2" },
      `INSERT INTO public.eu_stays (hospital_id, patient_user_id, encounter_id, ward_id, started_by_kind, decided_by, responsible_user_id)
       VALUES ($1, $2, $3, $4, 'doctor', $5, $5)`,
      [h, p, e, eu, doctor],
    );
    expect(write.ok).toBe(false);
    expect(!write.ok && write.error).toMatch(/permission denied/);
    const rls = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.eu_stays'::regclass`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  /* ─── observe_in_eu and the EU arrival (0311 section 5) ─── */

  const call = async (fn: string, payload: Record<string, unknown>) =>
    (
      await pg.query<{ r: Record<string, string | boolean | null> }>(
        `SELECT public.${fn}($1::jsonb) AS r`,
        [JSON.stringify(payload)],
      )
    ).rows[0]!.r;

  const refusal = async (fn: string, payload: Record<string, unknown>) => {
    try {
      await call(fn, payload);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`${fn} should have refused`);
  };

  const row = async (sql: string, params: unknown[]) =>
    (await pg.query<Record<string, unknown>>(sql, params)).rows[0]!;

  /** A fresh ward (an EU unless `type` says otherwise) with its own spaces, so tests never share a bed. */
  async function newWard(
    labels: string[],
    o: { hospitalId?: string; type?: string } = {},
  ): Promise<{ ward: string; beds: Record<string, string> }> {
    const hid = o.hospitalId ?? h;
    const s = randomUUID().slice(0, 8);
    const ward = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count, ward_type)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          hid,
          hid === h ? dept : await department(pg, hid),
          `Unit ${s}`,
          `unit-${s}`,
          labels.length,
          o.type ?? "emergency_observation",
        ],
      )
    ).rows[0]!.id;
    const beds: Record<string, string> = {};
    for (const label of labels)
      beds[label] = (
        await pg.query<{ id: string }>(
          `INSERT INTO public.hospital_beds (hospital_id, ward_id, label) VALUES ($1, $2, $3) RETURNING id`,
          [hid, ward, label],
        )
      ).rows[0]!.id;
    return { ward, beds };
  }

  /** What a call could have written for this patient and visit: stays, spaces, disposition events. */
  const footprint = async (p: string, e: string) =>
    row(
      `SELECT (SELECT count(*) FROM public.eu_stays WHERE patient_user_id = $1)::int AS stays,
              (SELECT count(*) FROM public.bed_assignments WHERE patient_user_id = $1)::int AS spaces,
              (SELECT count(*) FROM public.encounter_events WHERE encounter_id = $2 AND kind = 'disposition')::int AS events`,
      [p, e],
    );

  it("sends to the EU with a space: a stay, an Arriving space, the visit stays open", async () => {
    const { ward, beds } = await newWard(["R1", "T1"]);
    const { p, e } = await visit();
    const i = await intake(pg, { hospitalId: h, patientUserId: p });
    await pg.query(`UPDATE public.encounters SET visit_id = $2 WHERE id = $1`, [e, i]);
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      bed_id: beds["T1"],
    });
    expect(r).toMatchObject({
      bed: "T1",
      patient_user_id: p,
      hospital_id: h,
      intake_id: i,
      adopted: false,
    });
    expect(
      await row(
        `SELECT status, started_by_kind, decided_by, responsible_user_id, encounter_id, intake_id, arrived_at
           FROM public.eu_stays WHERE id=$1`,
        [r.stay_id],
      ),
    ).toMatchObject({
      status: "in_space",
      started_by_kind: "doctor",
      decided_by: doctor,
      responsible_user_id: doctor,
      encounter_id: e,
      intake_id: i,
      arrived_at: null,
    });
    expect(
      await row(
        `SELECT eu_stay_id, encounter_id, bed_id, started_by, arrived_at FROM public.bed_assignments WHERE id=$1`,
        [r.assignment_id],
      ),
    ).toMatchObject({
      eu_stay_id: r.stay_id,
      encounter_id: e,
      bed_id: beds["T1"],
      started_by: doctor,
      arrived_at: null,
    });
    expect((await row(`SELECT state FROM public.encounters WHERE id=$1`, [e])).state).toBe(
      "in_progress",
    );
    expect(
      (
        await row(
          `SELECT label FROM public.encounter_events WHERE encounter_id=$1 AND kind='disposition'`,
          [e],
        )
      ).label,
    ).toMatch(/^Sent to .*, T1 \(the visit stays open\)$/);
  });

  it("refuses: not in progress, not an EU, space taken, already in the EU, no space and no reason", async () => {
    const { ward, beds } = await newWard(["R1", "T1"]);
    const general = await newWard(["1"], { type: "general" });
    const elsewhere = await newWard(["X1"], { hospitalId: await hospital(pg, "Other EU") });
    const archived = await newWard(["A1"]);
    await pg.query(`UPDATE public.hospital_wards SET archived_at = now() WHERE id = $1`, [
      archived.ward,
    ]);
    const { p, e } = await visit();
    const send = (o: Record<string, unknown>) =>
      refusal("observe_in_eu", { encounter_id: e, actor: doctor, ward_id: ward, ...o });
    const before = await footprint(p, e);

    expect(await send({ encounter_id: randomUUID() })).toBe("EU404 Visit not found.");
    const done = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor,
      state: "completed",
    });
    expect(await send({ encounter_id: done, bed_id: beds["T1"] })).toBe(
      "EU409 This visit is not in progress.",
    );
    for (const w of [general, elsewhere, archived])
      expect(await send({ ward_id: w.ward, bed_id: Object.values(w.beds)[0] })).toBe(
        "EU409 That is not an emergency unit at this hospital.",
      );
    expect(await send({})).toBe("EU400 Choose a space, or say why the patient waits for one.");
    expect(await send({ space_wait_reason: "other" })).toBe("EU400 Say why the patient waits.");
    // A space on another ward is not a space of this EU (0091's words pass through).
    expect(await send({ bed_id: general.beds["1"] })).toBe(
      "AD409 That bed is not an open bed of this ward.",
    );
    expect(await footprint(p, e)).toEqual(before);

    // Space taken: another patient is Arriving in T1.
    const other = await visit();
    await call("observe_in_eu", {
      encounter_id: other.e,
      actor: doctor,
      ward_id: ward,
      bed_id: beds["T1"],
    });
    expect(await send({ bed_id: beds["T1"] })).toBe("AD409 Bed T1 was just taken. Choose another.");
    expect(await footprint(p, e)).toEqual(before);

    // Already in the EU: the patient's open stay names an encounter.
    expect(
      await refusal("observe_in_eu", {
        encounter_id: other.e,
        actor: doctor,
        ward_id: ward,
        bed_id: beds["R1"],
      }),
    ).toBe("EU409 This patient is already in the EU.");

    // Already in a bed: an open ward bed of the patient's, with no stay.
    await pg.query(
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [h, general.ward, general.beds["1"], p, doctor],
    );
    const inBed = await footprint(p, e);
    expect(await send({ bed_id: beds["R1"] })).toBe(
      "EU409 This patient is already in a bed. The ward releases it first.",
    );
    expect(await footprint(p, e)).toEqual(inBed);

    // An open admission.
    const admitted = await visit();
    await pg.query(
      `INSERT INTO public.admissions (hospital_id, patient_user_id, source_encounter_id, ward_id, decided_by, bed_wait_reason)
       VALUES ($1, $2, $3, $4, $5, 'floor')`,
      [h, admitted.p, admitted.e, general.ward, doctor],
    );
    const again = await encounter(pg, {
      hospitalId: h,
      patientUserId: admitted.p,
      clinicianUserId: doctor,
    });
    expect(
      await refusal("observe_in_eu", {
        encounter_id: again,
        actor: doctor,
        ward_id: ward,
        bed_id: beds["R1"],
      }),
    ).toBe("EU409 This patient has an open admission.");
  });

  it("waits for a space with a reason", async () => {
    const { ward } = await newWard(["R1"]);
    const { p, e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      space_wait_reason: "other",
      space_wait_note_ciphertext: "enc:abc",
    });
    expect(r).toMatchObject({ assignment_id: null, bed: null, adopted: false });
    expect(
      await row(
        `SELECT status, space_wait_reason, space_wait_note_ciphertext FROM public.eu_stays WHERE id=$1`,
        [r.stay_id],
      ),
    ).toMatchObject({
      status: "awaiting_space",
      space_wait_reason: "other",
      space_wait_note_ciphertext: "enc:abc",
    });
    expect((await footprint(p, e)).spaces).toBe(0);
    expect(
      (
        await row(
          `SELECT label FROM public.encounter_events WHERE encounter_id=$1 AND kind='disposition'`,
          [e],
        )
      ).label,
    ).toMatch(/^Sent to .*, waiting for a space \(the visit stays open\)$/);
  });

  it("adopts a triage stay and moves it to the chosen space", async () => {
    const { ward, beds } = await newWard(["R1", "T1"]);
    const p = await patient(pg);
    const i = await intake(pg, { hospitalId: h, patientUserId: p });
    const s = await insertStay({
      patient_user_id: p,
      encounter_id: null,
      intake_id: i,
      started_by_kind: "triage_nurse",
      ward_id: ward,
      status: "in_space",
      space_wait_reason: null,
    });
    const old = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, eu_stay_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [h, ward, beds["R1"], p, doctor, s],
      )
    ).rows[0]!.id;
    const e = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      bed_id: beds["T1"],
    });
    expect(r).toMatchObject({ stay_id: s, adopted: true, bed: "T1", intake_id: i });
    expect(
      await row(`SELECT encounter_id, status, started_by_kind FROM public.eu_stays WHERE id=$1`, [
        s,
      ]),
    ).toMatchObject({ encounter_id: e, status: "in_space", started_by_kind: "triage_nurse" });
    expect(
      await row(
        `SELECT ended_at IS NOT NULL AS ended, reason FROM public.bed_assignments WHERE id=$1`,
        [old],
      ),
    ).toEqual({ ended: true, reason: "Moved to T1" });
    const open = await pg.query<{ id: string; bed_id: string; arrived_at: string | null }>(
      `SELECT id, bed_id, arrived_at FROM public.bed_assignments WHERE patient_user_id=$1 AND ended_at IS NULL`,
      [p],
    );
    expect(open.rows).toEqual([{ id: r.assignment_id, bed_id: beds["T1"], arrived_at: null }]);

    // A triage stay waiting for a space: placing the patient means they are here (Occupied at once).
    const p2 = await patient(pg);
    const i2 = await intake(pg, { hospitalId: h, patientUserId: p2 });
    const s2 = await insertStay({
      patient_user_id: p2,
      encounter_id: null,
      intake_id: i2,
      started_by_kind: "triage_nurse",
      ward_id: ward,
    });
    const e2 = await encounter(pg, { hospitalId: h, patientUserId: p2, clinicianUserId: doctor });
    const r2 = await call("observe_in_eu", {
      encounter_id: e2,
      actor: doctor,
      ward_id: ward,
      bed_id: beds["R1"],
    });
    expect(r2).toMatchObject({ stay_id: s2, adopted: true, bed: "R1" });
    expect(
      await row(
        `SELECT a.arrived_by, s.status, s.arrived_by AS stay_arrived_by, s.space_wait_reason
           FROM public.bed_assignments a JOIN public.eu_stays s ON s.id = a.eu_stay_id WHERE a.id=$1`,
        [r2.assignment_id],
      ),
    ).toEqual({
      arrived_by: doctor,
      status: "in_space",
      stay_arrived_by: doctor,
      space_wait_reason: null,
    });
  });

  it("Arrived in the EU: Occupied, the stay arrived, no inpatient encounter", async () => {
    const { ward, beds } = await newWard(["T1"]);
    const { p, e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      bed_id: beds["T1"],
    });
    const a = await call("confirm_bed_arrival", {
      hospital_id: h,
      assignment_id: r.assignment_id,
      actor: doctor,
    });
    expect(a).toEqual({ stay_id: r.stay_id, eu: true });
    expect(
      (await row(`SELECT arrived_by FROM public.bed_assignments WHERE id=$1`, [r.assignment_id]))
        .arrived_by,
    ).toBe(doctor);
    expect(
      await row(`SELECT status, arrived_by FROM public.eu_stays WHERE id=$1`, [r.stay_id]),
    ).toEqual({ status: "in_space", arrived_by: doctor });
    expect(
      (
        await row(
          `SELECT count(*)::int AS n FROM public.encounters WHERE patient_user_id=$1 AND encounter_type='inpatient'`,
          [p],
        )
      ).n,
    ).toBe(0);
    expect(
      await refusal("confirm_bed_arrival", {
        hospital_id: h,
        assignment_id: r.assignment_id,
        actor: doctor,
      }),
    ).toMatch(/Nobody is arriving/);
  });

  it("only the service role runs the EU functions", async () => {
    for (const fn of ["observe_in_eu", "confirm_bed_arrival", "move_eu_space", "end_eu_stay"]) {
      const direct = await probe(
        pg,
        { userId: doctor, role: "authenticated", aal: "aal2" },
        `SELECT public.${fn}('{}'::jsonb)`,
      );
      expect(direct.ok).toBe(false);
      expect(!direct.ok && direct.error).toMatch(/permission denied/);
      const grants = await pg.query<{ grantee: string }>(
        `SELECT grantee FROM information_schema.routine_privileges
          WHERE routine_schema = 'public' AND routine_name = $1 AND privilege_type = 'EXECUTE'`,
        [fn],
      );
      expect(grants.rows.map((g) => g.grantee).filter((g) => g !== "postgres")).toEqual([
        "service_role",
      ]);
    }
  });

  /* ─── R56: adoption and the space's patient ─── */

  /** A triage nurse's stay for a fresh patient, responsible = the nurse; the doctor's encounter not yet started. */
  async function triageStay(ward: string, o: Record<string, unknown> = {}) {
    const p = await patient(pg);
    const i = await intake(pg, { hospitalId: h, patientUserId: p });
    const nurse = (await staff(pg, { hospitalId: h, departmentId: dept })).userId;
    const s = await insertStay({
      patient_user_id: p,
      encounter_id: null,
      intake_id: i,
      started_by_kind: "triage_nurse",
      decided_by: nurse,
      responsible_user_id: nurse,
      ward_id: ward,
      ...o,
    });
    const e = await encounter(pg, { hospitalId: h, patientUserId: p, clinicianUserId: doctor });
    return { p, i, s, e, nurse };
  }

  it("adopting a triage stay makes the doctor responsible; waiting on the same EU keeps the doctor's reason", async () => {
    const { ward, beds } = await newWard(["R1"]);
    const waiting = await triageStay(ward);
    await call("observe_in_eu", {
      encounter_id: waiting.e,
      actor: doctor,
      ward_id: ward,
      space_wait_reason: "other",
      space_wait_note_ciphertext: "enc:doctor",
    });
    expect(
      await row(
        `SELECT encounter_id, decided_by, responsible_user_id, status, space_wait_reason, space_wait_note_ciphertext
           FROM public.eu_stays WHERE id=$1`,
        [waiting.s],
      ),
    ).toEqual({
      encounter_id: waiting.e,
      decided_by: waiting.nurse,
      responsible_user_id: doctor,
      status: "awaiting_space",
      space_wait_reason: "other",
      space_wait_note_ciphertext: "enc:doctor",
    });
    // Adopted into a space: the doctor is responsible too.
    const placed = await triageStay(ward);
    await call("observe_in_eu", {
      encounter_id: placed.e,
      actor: doctor,
      ward_id: ward,
      bed_id: beds["R1"],
    });
    expect(
      (await row(`SELECT responsible_user_id FROM public.eu_stays WHERE id=$1`, [placed.s]))
        .responsible_user_id,
    ).toBe(doctor);
  });

  it("an EU space is for its stay's patient", async () => {
    const { ward, beds } = await newWard(["R1"]);
    const s = await insertStay({ ward_id: ward });
    const stranger = await patient(pg);
    await expect(
      pg.query(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, eu_stay_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [h, ward, beds["R1"], stranger, doctor, s],
      ),
    ).rejects.toThrow(/stay's patient/);
  });

  /* ─── move_eu_space and end_eu_stay (0311 section 6) ─── */

  const asg = (id: unknown) =>
    row(
      `SELECT bed_id, eu_stay_id, arrived_by, ended_at IS NOT NULL AS ended, reason
         FROM public.bed_assignments WHERE id=$1`,
      [id],
    );
  const stayRow = (id: unknown) =>
    row(
      `SELECT ward_id, status, decided_at, arrived_by, space_wait_reason, ended_by, end_kind, encounter_id
         FROM public.eu_stays WHERE id=$1`,
      [id],
    );

  it("moves resus → trolley: the EU clock keeps its start, the old space frees", async () => {
    const { ward, beds } = await newWard(["R1", "T2"]);
    const { e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      bed_id: beds["R1"],
    });
    await call("confirm_bed_arrival", {
      hospital_id: h,
      assignment_id: r.assignment_id,
      actor: doctor,
    });
    const before = await stayRow(r.stay_id);
    const m = await call("move_eu_space", {
      hospital_id: h,
      stay_id: r.stay_id,
      actor: doctor,
      bed_id: beds["T2"],
    });
    expect(m).toMatchObject({ stay_id: r.stay_id, bed: "T2" });
    expect(await stayRow(r.stay_id)).toEqual(before);
    expect(await asg(r.assignment_id)).toMatchObject({ ended: true, reason: "Moved to T2" });
    expect(await asg(m.assignment_id)).toEqual({
      bed_id: beds["T2"],
      eu_stay_id: r.stay_id,
      arrived_by: doctor,
      ended: false,
      reason: null,
    });
  });

  it("placing a waiting patient is one tap: Occupied at once", async () => {
    const { ward, beds } = await newWard(["T1"]);
    const { e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      space_wait_reason: "no_free_bed",
    });
    const m = await call("move_eu_space", {
      hospital_id: h,
      stay_id: r.stay_id,
      actor: doctor,
      bed_id: beds["T1"],
    });
    expect((await asg(m.assignment_id)).arrived_by).toBe(doctor);
    expect(await stayRow(r.stay_id)).toMatchObject({
      status: "in_space",
      arrived_by: doctor,
      space_wait_reason: null,
    });
  });

  it("moving an Arriving patient keeps them Arriving; out of a space, they wait with a reason", async () => {
    const { ward, beds } = await newWard(["R1", "T1"]);
    const { e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      bed_id: beds["R1"],
    });
    const m = await call("move_eu_space", {
      hospital_id: h,
      stay_id: r.stay_id,
      actor: doctor,
      bed_id: beds["T1"],
    });
    expect((await asg(m.assignment_id)).arrived_by).toBeNull();
    expect(await stayRow(r.stay_id)).toMatchObject({ status: "in_space", arrived_by: null });

    const out = await call("move_eu_space", {
      hospital_id: h,
      stay_id: r.stay_id,
      actor: doctor,
      space_wait_reason: "floor",
    });
    expect(out).toMatchObject({ assignment_id: null, bed: null });
    expect(await asg(m.assignment_id)).toMatchObject({
      ended: true,
      reason: "Moved out of a space",
    });
    expect(await stayRow(r.stay_id)).toMatchObject({
      status: "awaiting_space",
      space_wait_reason: "floor",
    });
  });

  it("moves to another EU of the hospital, refuses a general ward", async () => {
    const a = await newWard(["A1"]);
    const b = await newWard(["B1"]);
    const general = await newWard(["1"], { type: "general" });
    const elsewhere = await newWard(["X1"], { hospitalId: await hospital(pg, "Third EU") });
    const { p, e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: a.ward,
      space_wait_reason: "no_free_bed",
    });
    const move = (o: Record<string, unknown>) =>
      refusal("move_eu_space", { hospital_id: h, stay_id: r.stay_id, actor: doctor, ...o });
    const before = await footprint(p, e);
    for (const w of [general, elsewhere])
      expect(await move({ ward_id: w.ward, bed_id: Object.values(w.beds)[0] })).toBe(
        "EU409 That is not an emergency unit at this hospital.",
      );
    expect(await move({ hospital_id: elsewhere.ward })).toBe(
      "EU404 That stay is not at this hospital.",
    );
    expect(await move({ stay_id: randomUUID() })).toBe("EU404 That stay is not at this hospital.");
    expect(await move({ ward_id: b.ward })).toBe(
      "EU400 Choose a space, or say why the patient waits for one.",
    );
    expect(await move({ space_wait_reason: "other" })).toBe("EU400 Say why the patient waits.");
    expect(await footprint(p, e)).toEqual(before);

    // The old EU's board hears the patient leave (the stay had no space there to end).
    const heard = async () =>
      (
        await row(
          `SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1 AND payload->>'ward_id' = $2`,
          [`ward-beds:${h}`, a.ward],
        )
      ).n;
    const heardBefore = await heard();
    const m = await call("move_eu_space", {
      hospital_id: h,
      stay_id: r.stay_id,
      actor: doctor,
      ward_id: b.ward,
      bed_id: b.beds["B1"],
    });
    expect(m).toMatchObject({ bed: "B1" });
    expect(await stayRow(r.stay_id)).toMatchObject({ ward_id: b.ward, status: "in_space" });
    expect(await heard()).toBeGreaterThan(heardBefore as number);
  });

  const end = (e: string, o: Record<string, unknown> = {}) => ({
    encounter_id: e,
    actor: doctor,
    end_kind: "home",
    disposition: "home",
    ...o,
  });

  it("end_eu_stay closes the visit and the stay together", async () => {
    const { ward, beds } = await newWard(["T1"]);
    const { e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      bed_id: beds["T1"],
    });
    expect(await refusal("end_eu_stay", end(e, { end_kind: "admitted" }))).toBe(
      "EU400 An admission ends the stay when the patient arrives on the ward.",
    );
    const x = await call(
      "end_eu_stay",
      end(e, { disposition_detail: { note: "well" }, follow_up: { kind: "none" } }),
    );
    expect(x).toEqual({ ended: true, stay_id: r.stay_id });
    const enc = await row(
      `SELECT state, ended_at IS NOT NULL AS ended, completed_by, closure_kind, disposition, disposition_detail,
              follow_up, completion_reason FROM public.encounters WHERE id=$1`,
      [e],
    );
    const wardName = (await row(`SELECT name FROM public.hospital_wards WHERE id=$1`, [ward])).name;
    expect(enc).toEqual({
      state: "completed",
      ended: true,
      completed_by: doctor,
      closure_kind: "clinical",
      disposition: "home",
      disposition_detail: { note: "well", eu_stay_id: r.stay_id, eu_ward: wardName },
      follow_up: { kind: "none" },
      completion_reason: "ended_by_clinician",
    });
    expect(await stayRow(r.stay_id)).toMatchObject({
      status: "ended",
      end_kind: "home",
      ended_by: doctor,
    });
    expect(await asg(r.assignment_id)).toMatchObject({ ended: true, reason: "Left the EU" });
    expect(
      (
        await pg.query<{ label: string }>(
          `SELECT label FROM public.encounter_events WHERE encounter_id=$1 AND kind='disposition' ORDER BY recorded_at`,
          [e],
        )
      ).rows.map((x) => x.label),
    ).toContain(`Visit completed: home, left ${wardName}`);
  });

  it("end_eu_stay ends a triage stay and stamps the encounter that closed it", async () => {
    const { ward } = await newWard(["R1"]);
    const t = await triageStay(ward);
    const x = await call("end_eu_stay", end(t.e, { end_kind: "died", disposition: "deceased" }));
    expect(x).toEqual({ ended: true, stay_id: t.s });
    expect(await stayRow(t.s)).toMatchObject({
      status: "ended",
      end_kind: "died",
      encounter_id: t.e,
    });
    expect(
      (await row(`SELECT disposition FROM public.encounters WHERE id=$1`, [t.e])).disposition,
    ).toBe("deceased");
  });

  it("end_eu_stay ignores an unrelated encounter", async () => {
    const { ward } = await newWard(["R1"]);
    const { p, e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      space_wait_reason: "floor",
    });
    const clinic = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor,
    });
    const before = await footprint(p, clinic);
    expect(await call("end_eu_stay", end(clinic))).toEqual({ ended: false });
    expect(await footprint(p, clinic)).toEqual(before);
    expect((await stayRow(r.stay_id)).status).toBe("awaiting_space");
    expect((await row(`SELECT state FROM public.encounters WHERE id=$1`, [clinic])).state).toBe(
      "in_progress",
    );
  });

  it("a stay ends once", async () => {
    const { ward } = await newWard(["R1"]);
    const { e } = await visit();
    const r = await call("observe_in_eu", {
      encounter_id: e,
      actor: doctor,
      ward_id: ward,
      space_wait_reason: "floor",
    });
    expect(await call("end_eu_stay", end(e))).toMatchObject({ ended: true });
    expect(await call("end_eu_stay", end(e))).toEqual({ ended: false });
    expect(
      await refusal("move_eu_space", {
        hospital_id: h,
        stay_id: r.stay_id,
        actor: doctor,
        space_wait_reason: "floor",
      }),
    ).toBe("EU409 This stay has ended.");
  });
});
