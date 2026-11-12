/**
 * ADR 0475 / migration 0292 on the real SQL: a person takes over the record the desk registered, with the claim code
 * the desk gave. The code is the desk hospital's to give; a wrong, expired, spent or used code opens nothing; the
 * record keeps its id and history; every step is audited; and nothing but an open claim can put a credential on a
 * desk record (the auth.users guard).
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
  $1::uuid, $2::uuid, $3::uuid, 'enc-first', 'enc-surname', 'female', '1980-05-01', 'enc-phone', $4,
  $5::uuid, NULL, NULL, $6, $7, ARRAY[]::text[], NULL, '127.0.0.1', 'vitest') AS code`;
const ISSUE = `SELECT public.desk_issue_claim_code($1::uuid, $2::uuid, $3, $4, NULL, '127.0.0.1', 'vitest') AS expires`;
const BEGIN = `SELECT outcome, user_id FROM public.desk_claim_begin($1, $2)`;
const FINISH = `SELECT public.desk_claim_finish($1::uuid, $2, $3, $4, '127.0.0.1', 'vitest') AS code`;
/** What GoTrue's admin update does to the row (password, email, the desk flag). */
const TAKE_OVER = `UPDATE auth.users SET encrypted_password = 'bcrypt-hash', email = $2,
  raw_app_meta_data = raw_app_meta_data || '{"desk_registered": false}' WHERE id = $1`;

describe.skipIf(!laneOn)("0292: taking over a desk-registered record", () => {
  let pg: Pg;
  let H: string;
  let D: string;
  let desk: string;
  let deskH2: string;
  let doc: string;
  let district: string;
  let notice: { version: string; sha: string };
  let n = 0;

  const error = (p: Promise<unknown>) =>
    p.then(
      () => "",
      (e: Error) => e.message,
    );

  /** A walk-in registered at H: the auth user (as ha-register-patient makes it) and the record. */
  const walkIn = async (phoneHmac: string) => {
    const id = (
      await pg.query<{ id: string }>(
        `INSERT INTO auth.users (email, raw_app_meta_data)
         VALUES ('desk-' || gen_random_uuid() || '@patients.medsync.invalid', '{"desk_registered": true}')
         RETURNING id`,
      )
    ).rows[0]!.id;
    const { code } = (
      await pg.query<{ code: string }>(REGISTER, [
        id,
        H,
        desk,
        phoneHmac,
        district,
        notice.version,
        notice.sha,
      ])
    ).rows[0]!;
    return { id, code };
  };
  const issue = (patientCode: string, hash: string, actor = desk, hospitalId = H) =>
    pg.query(ISSUE, [hospitalId, actor, patientCode, hash]);
  const begin = async (phoneHmac: string, hash: string) =>
    (await pg.query<{ outcome: string; user_id: string | null }>(BEGIN, [phoneHmac, hash]))
      .rows[0]!;
  const finish = (id: string, email: string) =>
    pg.query<{ code: string }>(FINISH, [id, email, notice.version, notice.sha]);
  const phone = () => `hmac-claim-${++n}`;

  beforeAll(async () => {
    pg = (await bootLane()).pg;
    H = await hospital(pg, "Claim clinic");
    D = await department(pg, H);
    desk = (await reception(pg, { hospitalId: H, departmentId: D })).userId;
    const H2 = await hospital(pg, "Other clinic");
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

  it("the right code takes the record over: same id, history kept, consent and audit written", async () => {
    const p = phone();
    const { id, code } = await walkIn(p);
    await appointmentFixture(pg, {
      hospitalId: H,
      departmentId: D,
      patientUserId: id,
      clinicianUserId: doc,
    });
    await intake(pg, { hospitalId: H, patientUserId: id });

    await issue(code, "hash-right");
    expect(await begin(p, "hash-right")).toEqual({ outcome: "ok", user_id: id });
    await pg.query(TAKE_OVER, [id, "amina@example.org"]);
    expect((await finish(id, "Amina@Example.org")).rows[0]!.code).toBe(code);

    const kept = await pg.query(
      `SELECT (SELECT count(*) FROM public.appointments WHERE patient_user_id = $1)::int AS appts,
              (SELECT count(*) FROM public.patient_intakes WHERE patient_user_id = $1)::int AS intakes,
              (SELECT patient_code FROM public.patient_profiles WHERE id = $1) AS code,
              (SELECT email FROM public.users WHERE id = $1) AS email`,
      [id],
    );
    expect(kept.rows).toEqual([{ appts: 1, intakes: 1, code, email: "amina@example.org" }]);

    // The desk's consent row stands (one row per version); the person's own acceptance is on the claim.
    const consent = await pg.query(
      `SELECT recorded_by_user_id FROM public.consent_records WHERE user_id = $1 AND consent_type = 'data_processing'`,
      [id],
    );
    expect(consent.rows).toEqual([{ recorded_by_user_id: desk }]);
    const claim = await pg.query<{ claimed: boolean; claim_consent_version: string }>(
      `SELECT claimed_at IS NOT NULL AS claimed, claim_consent_version, claim_permit_until
         FROM public.desk_claim_codes WHERE patient_user_id = $1`,
      [id],
    );
    expect(claim.rows).toEqual([
      { claimed: true, claim_consent_version: notice.version, claim_permit_until: null },
    ]);

    const audit = await pg.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM public.sa_audit_log
        WHERE target_id = $1 AND action IN ('issue_claim_code', 'claim_desk_record') ORDER BY id`,
      [id],
    );
    expect(audit.rows).toEqual([
      { action: "issue_claim_code", actor_id: desk },
      { action: "claim_desk_record", actor_id: id },
    ]);
    const issued = await pg.query(
      `SELECT after_data::text AS d FROM public.sa_audit_log WHERE target_id = $1 AND action = 'issue_claim_code'`,
      [id],
    );
    expect(String(issued.rows[0]!.d)).not.toContain("hash-right"); // the code never reaches the audit
  });

  it("a wrong code opens nothing, counts a try, and five wrong tries spend the code", async () => {
    const p = phone();
    const { code } = await walkIn(p);
    await issue(code, "hash-good");
    expect(await begin(p, "hash-bad")).toEqual({ outcome: "wrong_code", user_id: null });
    expect(await begin("hmac-someone-else", "hash-good")).toEqual({
      outcome: "wrong_code",
      user_id: null,
    }); // the right code with another phone
    for (let i = 0; i < 4; i++) await begin(p, `hash-bad-${i}`); // five wrong in all
    expect((await begin(p, "hash-good")).outcome).toBe("too_many_tries");

    // A new code from the desk starts again.
    await issue(code, "hash-new");
    expect((await begin(p, "hash-new")).outcome).toBe("ok");
    expect((await begin(p, "hash-good")).outcome).toBe("wrong_code"); // the old code is gone
  });

  it("an expired code opens nothing", async () => {
    const p = phone();
    const { id, code } = await walkIn(p);
    await issue(code, "hash-old");
    await pg.query(
      `UPDATE public.desk_claim_codes SET expires_at = now() - interval '1 minute' WHERE patient_user_id = $1`,
      [id],
    );
    expect(await begin(p, "hash-old")).toEqual({ outcome: "expired", user_id: null });
  });

  it("a claimed record cannot be claimed again or get a new code", async () => {
    const p = phone();
    const { id, code } = await walkIn(p);
    await issue(code, "hash-once");
    await begin(p, "hash-once");
    await pg.query(TAKE_OVER, [id, `once-${n}@example.org`]);
    await finish(id, `once-${n}@example.org`);

    expect((await begin(p, "hash-once")).outcome).toBe("already_claimed");
    expect(await error(issue(code, "hash-again"))).toContain("already_claimed");
    expect(await error(finish(id, `once-${n}@example.org`))).toContain("no_permit");
  });

  it("another hospital's desk, a superadmin and a login account get no code", async () => {
    const { code } = await walkIn(phone());
    expect(await error(issue(code, "h", deskH2))).toContain("not_staff_here"); // asks for H
    expect(await error(pg.query(ISSUE, [await hospitalOf(deskH2), deskH2, code, "h"]))).toContain(
      "other_hospital",
    ); // asks for its own hospital
    expect(await error(issue(code, "h", await superadmin(pg)))).toContain("not_staff_here");
    expect(await error(issue("MS-0000-00000", "h"))).toContain("no_such_patient");

    const own = await authUser(pg, "patient");
    await pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id, primary_facility_id)
       VALUES ($1, 'a', 'b', 'male', '1980-01-01', 'none', 'c', $2, $3)`,
      [own, district, H],
    );
    const ownCode = (
      await pg.query<{ patient_code: string }>(
        `SELECT patient_code FROM public.patient_profiles WHERE id = $1`,
        [own],
      )
    ).rows[0]!.patient_code;
    expect(await error(issue(ownCode, "h"))).toContain("has_account");
  });

  it("nothing puts a credential on a desk record without an open claim", async () => {
    const p = phone();
    const { id, code } = await walkIn(p);
    for (const set of [
      `encrypted_password = 'reset-by-email'`,
      `email = 'someone@example.org'`,
      `phone = '256772000000'`,
      `raw_app_meta_data = '{}'::jsonb`,
    ])
      expect(await error(pg.query(`UPDATE auth.users SET ${set} WHERE id = $1`, [id]))).toContain(
        "desk_record_locked",
      );
    // A login account is untouched by the guard; a desk row's other columns too.
    const own = await authUser(pg, "login");
    await pg.query(`UPDATE auth.users SET encrypted_password = 'new' WHERE id = $1`, [own]);
    await pg.query(`UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1`, [id]);

    // A code alone opens nothing: only the begin step's permit does, and finish checks the update happened.
    await issue(code, "hash-guard");
    expect(await error(pg.query(TAKE_OVER, [id, "x@example.org"]))).toContain("desk_record_locked");
    expect(await error(finish(id, "x@example.org"))).toContain("no_permit");
    expect((await begin(p, "hash-guard")).outcome).toBe("ok");
    expect(await error(finish(id, "x@example.org"))).toContain("not_taken_over");
    await pg.query(TAKE_OVER, [id, "x@example.org"]);
    await finish(id, "x@example.org");
  });

  it("is the service role's only", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      const r = await probe(pg, { userId: desk, role }, BEGIN, ["x", "y"]);
      expect(r.ok, role).toBe(false);
      const t = await probe(pg, { userId: desk, role }, `SELECT * FROM public.desk_claim_codes`);
      expect(t.ok, role).toBe(false);
    }
  });

  const hospitalOf = async (userId: string) =>
    (
      await pg.query<{ hospital_id: string }>(
        `SELECT hospital_id FROM public.staff_affiliations WHERE user_id = $1 LIMIT 1`,
        [userId],
      )
    ).rows[0]!.hospital_id;
});
