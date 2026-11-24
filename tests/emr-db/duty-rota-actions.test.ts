/**
 * Rota writes and reads (ADR 0534) on the PGlite lane: writes run in asClinicalWriter under the 0307 guard and
 * its refusals come back in content/duty-rota.ts words; reads derive state through lib/rota/cover.ts, and the
 * cover panel carries staff names and places only, never a patient (ADR 0199). Runs with EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import type { RotaActor } from "@/lib/rota/write";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { encrypt, generateKey } from "@/lib/encryption";
import { coverForWard, loadRotaWeek, myDuties } from "@/lib/rota/read";
import { archivePost, assignDuty, createPost, endDuty } from "@/lib/rota/write";
import { authUser, bootLane, clinician, department, hospital, laneOn } from "./_pglite";

const saved = process.env.DUTY_ROTA;

describe.skipIf(!laneOn)("rota writes and reads (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let med: string;
  let ward: string;
  let admin: RotaActor;
  let mo: string;
  let intern: string;
  let c1: string;
  let wardPost: string;
  let consultantPost: string;
  let night: string;
  let mrn: string;
  const opts = (now?: Date) => ({ database: lane.db, now });
  const name = (userId: string, full: string) =>
    lane.pg.query(
      `INSERT INTO public.users (id, full_name, email) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name`,
      [userId, full, `${userId}@lane.test`],
    );
  const ok = async <T>(p: Promise<{ ok: boolean; error?: string; data?: T }>) => {
    const r = await p;
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  };

  beforeAll(async () => {
    process.env.DUTY_ROTA = "1";
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    const pg = lane.pg;
    h = await hospital(pg, "Rota actions");
    med = await department(pg, h, "Medicine");
    ward = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug) VALUES ($1, $2, 'Ward 4', 'ward-4')
         RETURNING id`,
        [h, med],
      )
    ).rows[0]!.id;
    const a = await authUser(pg, "admin");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
      [a, h],
    );
    admin = { userId: a, hospitalId: h };
    mo = (await clinician(pg, { hospitalId: h, departmentId: med })).userId;
    intern = (await clinician(pg, { hospitalId: h, departmentId: med, cadre: "INTERN_DOCTOR" }))
      .userId;
    c1 = (await clinician(pg, { hospitalId: h, departmentId: med, cadre: "CONSULTANT" })).userId;
    await name(mo, "Dr Okello Rota");
    await name(c1, "Dr Achieng Rota");
    await name(intern, "Dr Intern Rota");

    // A patient on the ward: neither the name nor the MRN may reach a cover panel.
    const p = await authUser(pg, "patient");
    await name(p, "Nakato Patientname");
    mrn = (
      await pg.query<{ patient_code: string }>(
        `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
           phone_encrypted, district_id)
         VALUES ($1, $2, $3, 'female', '1968-03-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))
         RETURNING patient_code`,
        [p, encrypt("Nakato"), encrypt("Patientname"), encrypt("0700000000")],
      )
    ).rows[0]!.patient_code;

    wardPost = (
      await ok<{ id: string }>(
        createPost(
          admin,
          {
            departmentId: med,
            wardId: ward,
            name: "Ward 4 doctor",
            level: "senior",
            eligibleCadres: ["MEDICAL_OFFICER"],
            takesConsults: false,
            escalatesToPostId: null,
            capacity: 1,
          },
          opts(),
        ),
      )
    ).id;
    consultantPost = (
      await ok<{ id: string }>(
        createPost(
          admin,
          {
            departmentId: med,
            wardId: null,
            name: "Consultant in charge",
            level: "consultant",
            eligibleCadres: ["CONSULTANT"],
            takesConsults: true,
            escalatesToPostId: null,
            capacity: 1,
          },
          opts(),
        ),
      )
    ).id;
    night = (
      await ok<{ id: string }>(
        assignDuty(
          admin,
          {
            postId: wardPost,
            userId: mo,
            day: "2026-11-24",
            shift: "night",
            kind: "rostered",
            coversAssignmentId: null,
          },
          opts(),
        ),
      )
    ).id;
  }, 900_000);

  afterAll(() => {
    if (saved === undefined) delete process.env.DUTY_ROTA;
    else process.env.DUTY_ROTA = saved;
  });

  it("assign writes the shift window in Kampala time", async () => {
    const r = await lane.pg.query<{ starts_at: Date; ends_at: Date; created_by: string }>(
      `SELECT starts_at, ends_at, created_by FROM public.duty_assignments WHERE id = $1`,
      [night],
    );
    expect(new Date(r.rows[0]!.starts_at).toISOString()).toBe("2026-11-24T14:00:00.000Z");
    expect(new Date(r.rows[0]!.ends_at).toISOString()).toBe("2026-11-25T05:00:00.000Z");
    expect(r.rows[0]!.created_by).toBe(admin.userId);
  });

  it("a guard refusal comes back in words", async () => {
    const r = await assignDuty(
      admin,
      {
        postId: consultantPost,
        userId: intern,
        day: "2026-11-26",
        shift: "day",
        kind: "rostered",
        coversAssignmentId: null,
      },
      opts(),
    );
    expect(r).toEqual({ ok: false, code: "forbidden", error: DUTY_ROTA_COPY.refusal.rota_grade });

    // The guard on ending: only a rota maker ends a duty.
    const notMaker = await endDuty(
      { userId: mo, hospitalId: h },
      { assignmentId: night, reason: "Unwell" },
      opts(new Date("2026-11-24T10:00:00Z")),
    );
    expect(notMaker).toEqual({
      ok: false,
      code: "forbidden",
      error: DUTY_ROTA_COPY.refusal.rota_maker,
    });

    // Flag off: refused as a config error, nothing written.
    process.env.DUTY_ROTA = "";
    const off = await archivePost(admin, { postId: consultantPost }, opts());
    process.env.DUTY_ROTA = "1";
    expect(off).toMatchObject({ ok: false, code: "config" });
  });

  it("needs cover appears when leave is approved later", async () => {
    const id = (
      await ok<{ id: string }>(
        assignDuty(
          admin,
          {
            postId: consultantPost,
            userId: c1,
            day: "2026-11-26",
            shift: "day",
            kind: "rostered",
            coversAssignmentId: null,
          },
          opts(),
        ),
      )
    ).id;
    await lane.pg.query(
      `INSERT INTO public.availability_blocks (hospital_id, clinician_user_id, kind, starts_at, ends_at, state, notes)
       VALUES ($1, $2, 'leave', '2026-11-26T10:00:00+03:00', '2026-11-26T12:00:00+03:00', 'active', 'Private reason')`,
      [h, c1],
    );
    const week = await loadRotaWeek(h, med, "2026-11-23", opts(new Date("2026-11-25T06:00:00Z")));
    const row = week.assignments.find((a) => a.id === id);
    expect(row).toMatchObject({ state: "needs_cover", name: "Dr Achieng Rota", endedAt: null });
    expect(JSON.stringify(week)).not.toContain("Private reason");
    expect(week.gaps.some((g) => g.postId === consultantPost)).toBe(true);
    expect(week.eligible.map((e) => e.userId)).toEqual(expect.arrayContaining([mo, c1]));
    const db = await lane.pg.query(`SELECT ended_at FROM public.duty_assignments WHERE id = $1`, [
      id,
    ]);
    expect(db.rows).toEqual([{ ended_at: null }]);
  });

  it("cover for a ward names staff only", async () => {
    const cover = await coverForWard(h, ward, new Date("2026-11-24T20:00:00Z"), opts());
    expect(cover).toEqual({
      step: "ward_post",
      people: [
        { name: "Dr Okello Rota", postName: "Ward 4 doctor", until: "2026-11-25T05:00:00.000Z" },
      ],
    });
    const json = JSON.stringify(cover);
    for (const s of ["Nakato", "Patientname", mrn]) expect(json).not.toContain(s);
  });

  it("my duties shows the chip's post and end", async () => {
    expect(await myDuties(mo, h, new Date("2026-11-24T12:00:00Z"), opts())).toEqual([
      {
        postName: "Ward 4 doctor",
        until: new Date("2026-11-25T05:00:00.000Z"),
        state: "planned",
      },
    ]);
  });
});
