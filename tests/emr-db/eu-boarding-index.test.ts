/**
 * Migration 0312 section 1 on the PGlite lane (ADR 0542): the one-open-bed-per-patient index becomes one Occupied
 * plus one Arriving per patient. Proven over live-shaped rows: 0312 applies over them and changes none.
 * Its own instance (migrated to 0311, seeded, then 0312). Runs only with EMR_PGLITE=1 (see _pglite.ts).
 */
import { randomUUID } from "node:crypto";
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  bootEmpty,
  department,
  encounter,
  hospital,
  laneOn,
  migrate,
  patient,
  staff,
} from "./_pglite";

const BOOT_MS = 180_000;

describe.skipIf(!laneOn)("0312 — one Occupied and one Arriving per patient", () => {
  let pg: Pg;
  let h: string;
  let dept: string;
  let doctor: string;
  let ward: string;
  let beds: Record<string, string>;
  let p1: string;
  let p2: string;
  let p2Admission: string;
  let before: unknown[];

  const call = async (fn: string, payload: Record<string, unknown>) =>
    (
      await pg.query<{ r: Record<string, string> }>(`SELECT public.${fn}($1::jsonb) AS r`, [
        JSON.stringify(payload),
      ])
    ).rows[0]!.r;

  async function makeWard(labels: string[], type = "general") {
    const s = randomUUID().slice(0, 8);
    const id = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count, ward_type)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [h, dept, `Ward ${s}`, `ward-${s}`, labels.length, type],
      )
    ).rows[0]!.id;
    const b: Record<string, string> = {};
    for (const label of labels)
      b[label] = (
        await pg.query<{ id: string }>(
          `INSERT INTO public.hospital_beds (hospital_id, ward_id, label) VALUES ($1, $2, $3) RETURNING id`,
          [h, id, label],
        )
      ).rows[0]!.id;
    return { id, beds: b };
  }

  const visit = async () => {
    const p = await patient(pg);
    const e = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: doctor,
      departmentId: dept,
    });
    return { p, e };
  };

  const direct = (p: string, bed: string) =>
    pg.query<{ id: string }>(
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [h, ward, bed, p, doctor],
    );

  const snapshot = async () =>
    (await pg.query(`SELECT * FROM public.bed_assignments ORDER BY id`)).rows;

  const indexNames = async (table: string) =>
    (
      await pg.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
        [table],
      )
    ).rows.map((r) => r.indexname);

  beforeAll(async () => {
    pg = await bootEmpty();
    await migrate(pg, { upTo: "0311_zzz" });
    h = await hospital(pg, "Boarding");
    dept = await department(pg, h);
    doctor = (await staff(pg, { hospitalId: h, departmentId: dept })).userId;
    const w = await makeWard(["1", "2", "3", "4", "5"]);
    ward = w.id;
    beds = w.beds;
    const eu = await makeWard(["R1"], "emergency_observation");

    // P1 Occupied: a direct assignment, no admission.
    p1 = await patient(pg);
    await direct(p1, beds["1"]!);
    // P2 Arriving: admitted from the visit with a bed.
    const v2 = await visit();
    p2 = v2.p;
    p2Admission = (
      await call("admit_from_encounter", {
        encounter_id: v2.e,
        actor: doctor,
        ward_id: ward,
        bed_id: beds["2"],
      })
    ).admission_id!;
    // P3 ended.
    const p3 = await patient(pg);
    const a3 = (await direct(p3, beds["3"]!)).rows[0]!.id;
    await pg.query(
      `UPDATE public.bed_assignments SET ended_at = now(), ended_by = $2, reason = 'Discharged' WHERE id = $1`,
      [a3, doctor],
    );
    // P4 arrived in an EU space.
    const v4 = await visit();
    const r4 = await call("observe_in_eu", {
      encounter_id: v4.e,
      actor: doctor,
      ward_id: eu.id,
      bed_id: eu.beds["R1"],
    });
    await call("confirm_bed_arrival", {
      hospital_id: h,
      assignment_id: r4.assignment_id,
      actor: doctor,
    });

    before = await snapshot();
  }, BOOT_MS);

  it("0312 applies over live rows and changes none", async () => {
    expect(before).toHaveLength(4);
    await migrate(pg, { from: "0312", upTo: "0312_zzz" });
    expect(await snapshot()).toEqual(before);
    expect(await indexNames("bed_assignments")).toEqual(
      expect.arrayContaining([
        "bed_assignments_one_occupied_per_patient",
        "bed_assignments_one_arriving_per_patient",
      ]),
    );
    expect(await indexNames("bed_assignments")).not.toContain(
      "bed_assignments_one_open_per_patient",
    );
    // Re-runnable.
    await migrate(pg, { from: "0312", upTo: "0312_zzz" });
    expect(await snapshot()).toEqual(before);
  });

  it("still one Occupied and one Arriving per patient", async () => {
    await expect(direct(p1, beds["4"]!)).rejects.toThrow(/one_occupied_per_patient/);
    await expect(
      pg.query(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by, admission_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [h, ward, beds["4"], p2, doctor, p2Admission],
      ),
    ).rejects.toThrow(/one_arriving_per_patient/);
  });

  it("an ordinary admission still refuses a patient who is in a bed", async () => {
    const e = await encounter(pg, {
      hospitalId: h,
      patientUserId: p1,
      clinicianUserId: doctor,
      departmentId: dept,
    });
    await expect(
      call("admit_from_encounter", {
        encounter_id: e,
        actor: doctor,
        ward_id: ward,
        bed_id: beds["5"],
      }),
    ).rejects.toThrow(/AD409 This patient is already in a bed/);
  });
});
