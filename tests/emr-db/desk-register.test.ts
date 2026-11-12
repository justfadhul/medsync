/**
 * ADR 0475 / migration 0291 on the real SQL: a walk-in registered at the desk. The two functions `ha-register-patient`
 * calls refuse anyone who is not staff at the hospital, a child, a notice that does not match and a login account;
 * the record is the hospital's, consented, audited, and bookable like any other; the duplicate check sees only this
 * hospital's patients.
 */
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  appointmentFixture,
  authUser,
  bootLane,
  clinician,
  department,
  hospital,
  intake,
  laneOn,
  probe,
  reception,
  superadmin,
} from "./_pglite";

const REGISTER = `SELECT public.desk_register_patient(
  $1::uuid, $2::uuid, $3::uuid, 'enc-first', 'enc-surname', 'female', $4::date, 'enc-phone', $5,
  $6::uuid, NULL, NULL, $7, $8, $9::text[], NULL, '127.0.0.1', 'vitest') AS code`;
const CANDIDATES = `SELECT patient_user_id, patient_code FROM public.desk_patient_candidates($1::uuid, $2::uuid, $3, $4)`;

describe.skipIf(!laneOn)("0291: desk-registered patients", () => {
  let pg: Pg;
  let H: string;
  let H2: string;
  let desk: string;
  let deskH2: string;
  let doc: string;
  let D: string;
  let district: string;
  let notice: { version: string; sha: string };

  /** A credential-less auth user, as ha-register-patient makes it. */
  const deskUser = async () =>
    (
      await pg.query<{ id: string }>(
        `INSERT INTO auth.users (email, raw_app_meta_data)
         VALUES ('desk-' || gen_random_uuid() || '@patients.medsync.invalid', '{"desk_registered": true}')
         RETURNING id`,
      )
    ).rows[0]!.id;

  const register = (o: {
    userId: string;
    hospitalId?: string;
    actor?: string;
    dob?: string;
    phoneHmac?: string;
    version?: string;
    sha?: string;
    despite?: string[];
  }) =>
    pg.query<{ code: string }>(REGISTER, [
      o.userId,
      o.hospitalId ?? H,
      o.actor ?? desk,
      o.dob ?? "1980-05-01",
      o.phoneHmac ?? "hmac-a",
      district,
      o.version ?? notice.version,
      o.sha ?? notice.sha,
      o.despite ?? [],
    ]);

  const error = (p: Promise<unknown>) =>
    p.then(
      () => "",
      (e: Error) => e.message,
    );

  beforeAll(async () => {
    pg = (await bootLane()).pg;
    H = await hospital(pg, "Desk clinic");
    H2 = await hospital(pg, "Other clinic");
    D = await department(pg, H);
    desk = (await reception(pg, { hospitalId: H, departmentId: D })).userId;
    deskH2 = (await reception(pg, { hospitalId: H2, departmentId: await department(pg, H2) }))
      .userId;
    doc = (await clinician(pg, { hospitalId: H, departmentId: D })).userId;
    district = (await pg.query<{ id: string }>(`SELECT id FROM public.districts LIMIT 1`)).rows[0]!
      .id;
    const v = await pg.query<{ version: string; body_sha256: string }>(
      `SELECT version, body_sha256 FROM public.consent_versions WHERE consent_type = 'data_processing' LIMIT 1`,
    );
    notice = { version: v.rows[0]!.version, sha: v.rows[0]!.body_sha256 };
  }, 600_000);

  it("creates the hospital's record: a code, consent recorded by the desk, an audit row", async () => {
    const id = await deskUser();
    const { code } = (await register({ userId: id, despite: ["MS-2026-00001"] })).rows[0]!;
    expect(code).toMatch(/^MS-\d{4}-\d{5}$/);

    const profile = (
      await pg.query<{ primary_facility_id: string; id_type: string; phone_hmac: string }>(
        `SELECT primary_facility_id, id_type, phone_hmac FROM public.patient_profiles WHERE id = $1`,
        [id],
      )
    ).rows[0]!;
    expect(profile).toEqual({ primary_facility_id: H, id_type: "none", phone_hmac: "hmac-a" });

    const consent = (
      await pg.query(
        `SELECT consent_type, version, recorded_by_user_id FROM public.consent_records WHERE user_id = $1`,
        [id],
      )
    ).rows;
    expect(consent).toEqual([
      { consent_type: "data_processing", version: notice.version, recorded_by_user_id: desk },
    ]);

    const audit = (
      await pg.query<{
        actor_id: string;
        target_kind: string;
        after_data: Record<string, unknown>;
      }>(
        `SELECT actor_id, target_kind, after_data FROM public.sa_audit_log
          WHERE action = 'register_patient' AND target_id = $1`,
        [id],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_id).toBe(desk);
    expect(audit[0]!.target_kind).toBe("patient_profile");
    expect(audit[0]!.after_data).toMatchObject({
      hospital_id: H,
      patient_code: code,
      registered_despite: ["MS-2026-00001"],
    });

    const state = await pg.query(`SELECT state FROM public.users WHERE id = $1`, [id]);
    expect(state.rows).toEqual([{ state: "verified" }]);
  });

  it("is booked, checked in and seen like any patient", async () => {
    const id = await deskUser();
    await register({ userId: id, phoneHmac: "hmac-booked" });
    await appointmentFixture(pg, {
      hospitalId: H,
      departmentId: D,
      patientUserId: id,
      clinicianUserId: doc,
    });
    await intake(pg, { hospitalId: H, patientUserId: id });
    const n = await pg.query(
      `SELECT (SELECT count(*) FROM public.appointments WHERE patient_user_id = $1)::int AS appts,
              (SELECT count(*) FROM public.patient_intakes WHERE patient_user_id = $1)::int AS intakes`,
      [id],
    );
    expect(n.rows).toEqual([{ appts: 1, intakes: 1 }]);
  });

  it("refuses staff of another hospital and a superadmin, and writes nothing", async () => {
    const id = await deskUser();
    expect(await error(register({ userId: id, actor: deskH2 }))).toContain("not_staff_here");
    expect(await error(register({ userId: id, actor: await superadmin(pg) }))).toContain(
      "not_staff_here",
    );
    const left = await pg.query(`SELECT 1 FROM public.patient_profiles WHERE id = $1`, [id]);
    expect(left.rows).toHaveLength(0);
  });

  it("refuses a child, a notice that does not match, and a login account", async () => {
    const child = new Date();
    child.setFullYear(child.getFullYear() - 17);
    expect(
      await error(register({ userId: await deskUser(), dob: child.toISOString().slice(0, 10) })),
    ).toContain("under_18");
    expect(await error(register({ userId: await deskUser(), sha: "0".repeat(64) }))).toContain(
      "consent_mismatch",
    );
    expect(await error(register({ userId: await authUser(pg, "patient") }))).toContain(
      "not_a_desk_account",
    );
  });

  it("is callable by the service role only", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      const r = await probe(pg, { userId: desk, role }, CANDIDATES, [H, desk, "x", 1980]);
      expect(r.ok, role).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/permission denied/);
    }
  });

  it("the duplicate check sees this hospital's patients only", async () => {
    // Registered here; booked here with no primary facility; only at another hospital.
    const here = await deskUser();
    await register({ userId: here, phoneHmac: "hmac-dup", dob: "1975-02-02" });
    const booked = await deskUser();
    await register({ userId: booked, hospitalId: H2, actor: deskH2, phoneHmac: "hmac-other" });
    await pg.query(`UPDATE public.patient_profiles SET primary_facility_id = NULL WHERE id = $1`, [
      booked,
    ]);
    await intake(pg, { hospitalId: H, patientUserId: booked });
    const elsewhere = await deskUser();
    await register({ userId: elsewhere, hospitalId: H2, actor: deskH2, phoneHmac: "hmac-dup" });

    const ids = async (hmac: string, year: number) =>
      (await pg.query<{ patient_user_id: string }>(CANDIDATES, [H, desk, hmac, year])).rows.map(
        (r) => r.patient_user_id,
      );

    const byPhone = await ids("hmac-dup", 1900);
    expect(byPhone).toContain(here);
    expect(byPhone).not.toContain(elsewhere);

    const byYear = await ids("none", 1980);
    expect(byYear).toContain(booked); // an intake here makes them this hospital's patient
    expect(byYear).not.toContain(here); // born 1975, different phone
    expect(byYear).not.toContain(elsewhere);

    expect(await error(pg.query(CANDIDATES, [H, deskH2, "hmac-dup", 1975]))).toContain(
      "not_staff_here",
    );
  });
});
