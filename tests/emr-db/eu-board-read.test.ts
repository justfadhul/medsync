/**
 * The EU board read (Task 22, ADR 0541, D10) on the PGlite lane: the open stays come under RLS
 * (eu_stays_select_scoped, as PostgREST runs it), the owner lookups fill the tracking row, names only for EU staff
 * with one clinical_phi_access_log row per patient per viewer per day and a basis the viewer holds, and none of
 * that without names. Also the rota seam: the EU ward's own doctor posts only (R63). Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { euDoctorOnDuty } from "@/lib/eu/cover";
import type { loadEuBoard } from "@/lib/eu/load";
import type * as WardFeature from "@/lib/wards/feature";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { encrypt, generateKey } from "@/lib/encryption";
import {
  authUser,
  bootLane,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  patient,
  staff,
} from "./_pglite";

const held = vi.hoisted(() => ({
  db: undefined as unknown,
  pg: undefined as unknown,
  viewer: "",
  live: true,
  clientCalls: 0,
}));
vi.mock("@/db", () => ({
  get db() {
    return held.db;
  },
}));
vi.mock("@/lib/wards/feature", async (orig) => ({
  ...(await orig<typeof WardFeature>()),
  euObservationLiveFor: () => held.live,
}));
// The viewer's own session, as PostgREST runs it: role authenticated with the viewer's JWT (aal2), RLS on.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    held.clientCalls++;
    const { actAs } = await import("./_pglite");
    return {
      from: (table: string) => {
        let cols = "*";
        const where: string[] = [];
        const params: unknown[] = [];
        const q = {
          select: (c: string) => ((cols = c), q),
          eq: (c: string, v: unknown) => (
            params.push(v),
            where.push(`${c} = $${params.length}`),
            q
          ),
          neq: (c: string, v: unknown) => (
            params.push(v),
            where.push(`${c} <> $${params.length}`),
            q
          ),
          then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
            actAs(
              held.pg as Pg,
              { userId: held.viewer, role: "authenticated", aal: "aal2" },
              (tx) =>
                tx.query(
                  `SELECT ${cols} FROM public.${table} WHERE ${where.join(" AND ")}`,
                  params,
                ),
            )
              .then((r) => ({
                data: r.rows.map((row) =>
                  Object.fromEntries(
                    Object.entries(row).map(([k, v]) => [
                      k,
                      v instanceof Date ? v.toISOString() : v,
                    ]),
                  ),
                ),
                error: null,
              }))
              .then(ok, ko),
        };
        return q;
      },
    };
  },
}));

const BOOT_MS = 180_000;
const HOUR = 3_600_000;

describe.skipIf(!laneOn)("the EU board read on real SQL", () => {
  let lane: Lane;
  let pg: Pg;
  let h: string;
  let dept: string;
  let doctor: string;
  let nurse: string;
  let admin: string;
  let outsider: string;
  let eu: { ward: string; beds: Record<string, string> };
  let general: { ward: string; beds: Record<string, string> };
  let a: { p: string; e: string; stay: string; resus: string; mrn: string };
  let b: { p: string; e: string; stay: string };
  let load: typeof loadEuBoard;
  let onDuty: typeof euDoctorOnDuty;

  const call = async (fn: string, payload: Record<string, unknown>) =>
    (
      await pg.query<{ r: Record<string, string> }>(`SELECT public.${fn}($1::jsonb) AS r`, [
        JSON.stringify(payload),
      ])
    ).rows[0]!.r;

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

  async function namedPatient(name: string) {
    const p = await patient(pg);
    await pg.query(
      `INSERT INTO public.users (id, full_name, email) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`,
      [p, name, `${p}@lane.test`],
    );
    const mrn = (
      await pg.query<{ code: string }>(
        `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
           phone_encrypted, district_id)
         VALUES ($1, $2, $3, 'female', '1980-01-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))
         RETURNING patient_code AS code`,
        [p, encrypt("Lane"), encrypt("Patient"), encrypt("0700000000")],
      )
    ).rows[0]!.code;
    return { p, mrn };
  }

  const logRows = (viewer: string) =>
    pg
      .query<{ patient_user_id: string; access_basis: string }>(
        `SELECT patient_user_id, access_basis FROM public.clinical_phi_access_log
          WHERE clinician_user_id = $1 AND surface = 'eu_board' ORDER BY patient_user_id`,
        [viewer],
      )
      .then((r) => r.rows);

  const as = (viewer: string) => {
    held.viewer = viewer;
    return viewer;
  };

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    pg = lane.pg;
    held.db = lane.db;
    held.pg = pg;
    ({ loadEuBoard: load } = await import("@/lib/eu/load"));
    ({ euDoctorOnDuty: onDuty } = await import("@/lib/eu/cover"));

    h = await hospital(pg, "EU board");
    dept = await department(pg, h);
    doctor = (await staff(pg, { hospitalId: h, departmentId: dept })).userId;
    nurse = (await staff(pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" })).userId;
    admin = await authUser(pg, "admin");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
      [admin, h],
    );
    const elsewhere = await hospital(pg, "Elsewhere");
    outsider = (
      await staff(pg, { hospitalId: elsewhere, departmentId: await department(pg, elsewhere) })
    ).userId;
    eu = await newWard(["R1", "T1"], "emergency_observation");
    general = await newWard(["1"]);

    // A: arrived at the hospital 3 h ago, triaged twice (latest Level 2), sent to R1 (still Arriving), a Plan
    // of hourly obs, one obs since, and an active resus episode.
    const pa = await namedPatient("Achieng Lane");
    const visitA = await intake(pg, {
      hospitalId: h,
      patientUserId: pa.p,
      arrivedAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    });
    for (const [level, ago] of [
      [3, 2],
      [2, 1],
    ])
      await pg.query(
        `INSERT INTO public.triage_records (hospital_id, patient_user_id, intake_id, ruleset, vitals_snapshot,
           computed_level, computed_breakdown, assigned_level, triaged_at)
         VALUES ($1, $2, $3, 'adult_news2', '{}'::jsonb, $4, '{}'::jsonb, $4, now() - make_interval(hours => $5))`,
        [h, pa.p, visitA, level, ago],
      );
    const ea = await encounter(pg, {
      hospitalId: h,
      patientUserId: pa.p,
      clinicianUserId: doctor,
      departmentId: dept,
    });
    await pg.query(`UPDATE public.encounters SET visit_id = $1 WHERE id = $2`, [visitA, ea]);
    await pg.query(
      `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id,
         template_version, author_user_id, author_cadre, content_ciphertext, effective_at)
       VALUES ($1, $2, $3, 'clerking', 'clerking.v2', '1', $4, 'MEDICAL_OFFICER', $5, now())`,
      [
        h,
        pa.p,
        ea,
        doctor,
        encrypt(JSON.stringify({ plan: { observations: { frequency: "hourly" } } })),
      ],
    );
    const sa = await call("observe_in_eu", {
      encounter_id: ea,
      actor: doctor,
      ward_id: eu.ward,
      bed_id: eu.beds["R1"],
    });
    await pg.query(
      `INSERT INTO public.clinical_observations (hospital_id, patient_user_id, recorded_by_user_id, observation_kind,
         numeric_value_1, recorded_at)
       VALUES ($1, $2, $3, 'hr', 88, now() + interval '1 second')`,
      [h, pa.p, nurse],
    );
    const resus = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.resus_episodes (hospital_id, patient_user_id, trigger_kind) VALUES ($1, $2, 'triage_red')
         RETURNING id`,
        [h, pa.p],
      )
    ).rows[0]!.id;
    a = { p: pa.p, e: ea, stay: sa.stay_id!, resus, mrn: pa.mrn };

    // B: arrived in T1, admitted to the general ward's waiting list (boarding); an obs from before the stay.
    const pb = await namedPatient("Okello Lane");
    await pg.query(
      `INSERT INTO public.clinical_observations (hospital_id, patient_user_id, recorded_by_user_id, observation_kind,
         numeric_value_1, recorded_at)
       VALUES ($1, $2, $3, 'hr', 70, now() - interval '5 hours')`,
      [h, pb.p, nurse],
    );
    const eb = await encounter(pg, {
      hospitalId: h,
      patientUserId: pb.p,
      clinicianUserId: doctor,
      departmentId: dept,
    });
    const sb = await call("observe_in_eu", {
      encounter_id: eb,
      actor: doctor,
      ward_id: eu.ward,
      bed_id: eu.beds["T1"],
    });
    await call("confirm_bed_arrival", {
      hospital_id: h,
      assignment_id: sb.assignment_id,
      actor: nurse,
    });
    await call("admit_from_encounter", {
      encounter_id: eb,
      actor: doctor,
      ward_id: general.ward,
      bed_wait_reason: "no_free_bed",
    });
    b = { p: pb.p, e: eb, stay: sb.stay_id! };
  }, BOOT_MS);

  it("flag off: nothing, and no stay read", async () => {
    held.live = false;
    const before = held.clientCalls;
    try {
      expect(
        await load(h, eu.ward, { userId: as(nurse), names: true, surface: "nurse" }),
      ).toBeNull();
      expect(held.clientCalls).toBe(before);
    } finally {
      held.live = true;
    }
  });

  it("an EU nurse sees the tracking rows with names, each logged once a day with a basis she holds", async () => {
    const data = (await load(h, eu.ward, { userId: as(nurse), names: true, surface: "nurse" }))!;
    expect(data.names).toBe(true);
    expect(data.limitHours).toBe(24);
    const ra = data.rows.find((r) => r.stayId === a.stay)!;
    expect(ra).toMatchObject({
      patientUserId: a.p,
      status: "in_space",
      arriving: true,
      bedLabel: "R1",
      level: 2,
      obsFrequency: "hourly",
      resultsReady: false,
      admission: null,
      resusEpisodeId: a.resus,
      name: "Achieng Lane",
      mrn: a.mrn,
    });
    expect(ra.hospitalArrivedAt).not.toBeNull();
    expect(ra.spaceStartedAt).not.toBeNull();
    expect(ra.lastObsAt).not.toBeNull();
    expect(ra.clocks.inHospitalMs).toBeGreaterThan(2.9 * HOUR);

    const rb = data.rows.find((r) => r.stayId === b.stay)!;
    expect(rb).toMatchObject({
      arriving: false,
      bedLabel: "T1",
      level: null,
      obsFrequency: null,
      lastObsAt: null,
      name: "Okello Lane",
    });
    expect(rb.admission).toMatchObject({ status: "awaiting_bed" });
    expect(rb.clocks.boardingMs).not.toBeNull();

    const expected = await pg.query<{ p: string; basis: string | null }>(
      `SELECT p, private.patient_access_basis($1::uuid, p, $2::uuid) AS basis FROM unnest($3::uuid[]) p`,
      [nurse, h, [a.p, b.p]],
    );
    const logged = await logRows(nurse);
    expect(logged).toHaveLength(2);
    for (const row of logged)
      expect(row.access_basis).toBe(
        expected.rows.find((x) => x.p === row.patient_user_id)?.basis ?? "eu_staff",
      );

    // The same day again: no second row.
    await load(h, eu.ward, { userId: nurse, names: true, surface: "nurse" });
    expect(await logRows(nurse)).toHaveLength(2);
  });

  it("without names: no name, no MRN, nothing logged", async () => {
    const data = (await load(h, eu.ward, { userId: as(doctor), names: false, surface: "doctor" }))!;
    expect(data.rows).toHaveLength(2);
    for (const r of data.rows) expect([r.name, r.mrn]).toEqual([null, null]);
    expect(data.board.beds.every((x) => x.patient === null)).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/Achieng|Okello/);
    expect(await logRows(doctor)).toEqual([]);
  });

  it("an admin (no chart basis) gets names, logged eu_staff (R64)", async () => {
    const data = (await load(h, eu.ward, { userId: as(admin), names: true, surface: "admin" }))!;
    expect(data.rows.map((r) => r.name).sort()).toEqual(["Achieng Lane", "Okello Lane"]);
    expect(data.rows.find((r) => r.stayId === a.stay)?.mrn).toBe(a.mrn);
    expect((await logRows(admin)).map((r) => r.access_basis)).toEqual(["eu_staff", "eu_staff"]);
  });

  it("an EU nurse keeps her chart basis where she has one and is eu_staff where she has none (R64)", async () => {
    // Another department: no department_recent for B (no intake either); A's intake today is open_intake.
    const other = await department(pg, h, "Emergency");
    const euNurse = (await staff(pg, { hospitalId: h, departmentId: other, cadre: "NURSE" }))
      .userId;
    const data = (await load(h, eu.ward, { userId: as(euNurse), names: true, surface: "nurse" }))!;
    expect(data.rows.every((r) => r.name !== null)).toBe(true);
    const basis = Object.fromEntries(
      (await logRows(euNurse)).map((r) => [r.patient_user_id, r.access_basis]),
    );
    expect(basis).toEqual({ [a.p]: "open_intake", [b.p]: "eu_staff" });
  });

  it("staff of another hospital read no stay (RLS)", async () => {
    const data = (await load(h, eu.ward, {
      userId: as(outsider),
      names: false,
      surface: "doctor",
    }))!;
    expect(data.rows).toEqual([]);
  });

  it("the EU doctor on duty: holders of the ward's own doctor posts only, rota on", async () => {
    const at = new Date();
    expect(await onDuty(h, eu.ward, at, { database: lane.db })).toEqual([]); // rota off
    process.env.DUTY_ROTA = "1";
    try {
      expect(await onDuty(h, eu.ward, at, { database: lane.db })).toEqual([]); // no post
      const post = async (level: string, cadres: string[]) =>
        (
          await pg.query<{ id: string }>(
            `INSERT INTO public.duty_posts (hospital_id, department_id, ward_id, scope_kind, name, level,
               eligible_cadres, takes_consults, created_by)
             VALUES ($1, $2, $3, 'ward', 'EU', $4, $5, false, $6) RETURNING id`,
            [h, dept, eu.ward, level, cadres, admin],
          )
        ).rows[0]!.id;
      const assign = (postId: string, userId: string) =>
        pg.query(
          `INSERT INTO public.duty_assignments (hospital_id, post_id, user_id, starts_at, ends_at, kind, created_by)
           VALUES ($1, $2, $3, now() - interval '1 hour', now() + interval '8 hours', 'rostered', $4)`,
          [h, postId, userId, admin],
        );
      await assign(await post("nurse_in_charge", ["NURSE"]), nurse);
      expect(await onDuty(h, eu.ward, at, { database: lane.db })).toEqual([]);
      await assign(await post("junior", ["MEDICAL_OFFICER"]), doctor);
      expect(await onDuty(h, eu.ward, at, { database: lane.db })).toEqual([doctor]);
      expect(await onDuty(h, general.ward, at, { database: lane.db })).toEqual([]);
    } finally {
      delete process.env.DUTY_ROTA;
    }
  });
});
