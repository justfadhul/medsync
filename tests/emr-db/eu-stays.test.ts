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
});
