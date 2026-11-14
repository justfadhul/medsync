/**
 * Pharmacy Phase 0, Step 2 (gate-a-proposal §2.4, §6.2): migrations 0098 and 0100 on the PGlite lane.
 *
 * 0098: `pharmacy_staff` follows the affiliation — granted when a pharmacy cadre is approved, revoked
 * when it is suspended, deactivated, moved or re-cadred — inside the transaction that changed the
 * affiliation, each with a `pharmacy_access` audit row carrying the basis (cadre name included).
 *
 * 0100: the client reads prescriptions, emergency administrations and crash carts only as the
 * patient, the prescriber or giver, clinical staff of the hospital, or pharmacy staff of the
 * hospital. Reception, lab, hospital admins, other hospitals, superadmin and anon read nothing;
 * nobody writes.
 *
 * Runs with EMR_PGLITE=1 (PGlite symlinked from ~/Desktop/medsync/.emr-harness, tests/emr-db/_pglite.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Actor, Lane, Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { PHARMACY_MAP_CADRES } from "@/lib/pharmacy/access";
import {
  authUser,
  bootLane,
  department,
  hospital,
  laneOn,
  patient,
  probe,
  staff,
  superadmin,
} from "./_pglite";

async function rows<T = Record<string, unknown>>(pg: Pg, sql: string, params?: unknown[]) {
  return (await pg.query<T>(sql, params)).rows;
}

const pharmacyRoles = (pg: Pg, userId: string) =>
  rows<{ hospital_id: string; created_by: string | null }>(
    pg,
    `SELECT hospital_id, created_by FROM public.user_roles WHERE user_id = $1 AND role = 'pharmacy_staff'`,
    [userId],
  );

const accessAudit = (pg: Pg, userId: string) =>
  rows<{ action: string; actor_id: string | null; data: Record<string, unknown> }>(
    pg,
    `SELECT action, actor_id, coalesce(after_data, before_data) AS data
       FROM public.audit_log
      WHERE table_name = 'pharmacy_access' AND coalesce(after_data, before_data)->>'user_id' = $1
      ORDER BY id`,
    [userId],
  );

/** An affiliation still awaiting approval, as sign-up leaves it: no role, no grant yet. */
async function pendingStaff(pg: Pg, hospitalId: string, departmentId: string, cadre: string) {
  const userId = await authUser(pg, cadre.toLowerCase());
  const [row] = await rows<{ id: string }>(
    pg,
    `INSERT INTO public.staff_affiliations
       (user_id, hospital_id, department_id, cadre_id, role_id, employment_type, state)
     SELECT $1, $2, $3, c.id, (SELECT r.id FROM public.roles r WHERE r.cadre_id = c.id LIMIT 1),
            'full_time', 'pending_approval'
       FROM public.cadres c WHERE c.code = $4
     RETURNING id`,
    [userId, hospitalId, departmentId, cadre],
  );
  return { userId, affiliationId: row!.id };
}

const approve = (pg: Pg, affiliationId: string, adminId: string) =>
  pg.query(
    `UPDATE public.staff_affiliations SET state = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`,
    [affiliationId, adminId],
  );

const setState = (pg: Pg, affiliationId: string, state: string) =>
  pg.query(`UPDATE public.staff_affiliations SET state = $2::lifecycle_state WHERE id = $1`, [
    affiliationId,
    state,
  ]);

describe.skipIf(!laneOn)("0098 — pharmacy access follows the affiliation", () => {
  let lane: Lane;
  let pg: Pg;
  let hospitalA: string;
  let hospitalB: string;
  let pharmA: string;
  let pharmB: string;
  let admin: string;

  beforeAll(async () => {
    lane = await bootLane();
    pg = lane.pg;
    hospitalA = await hospital(pg, "Pharmacy A");
    hospitalB = await hospital(pg, "Pharmacy B");
    pharmA = await department(pg, hospitalA, "Pharmacy");
    pharmB = await department(pg, hospitalB, "Pharmacy");
    admin = await authUser(pg, "hospital-admin");
  }, 120_000);

  it("the SQL names exactly the cadres of the signed map", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/0098_pharmacy_access.sql"),
      "utf8",
    );
    const listed = [...sql.matchAll(/c\.code IN \(([^)]*)\)/g)].flatMap((m) =>
      [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]),
    );
    expect(new Set(listed)).toEqual(new Set(PHARMACY_MAP_CADRES));
  });

  it("approving a pharmacist grants pharmacy_staff in that transaction, with a basis audit row (S1)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "PHARMACIST");
    expect(await pharmacyRoles(pg, userId)).toEqual([]);
    await approve(pg, affiliationId, admin);
    expect(await pharmacyRoles(pg, userId)).toEqual([
      { hospital_id: hospitalA, created_by: admin },
    ]);
    const audit = await accessAudit(pg, userId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("insert");
    expect(audit[0]!.actor_id).toBe(admin);
    expect(audit[0]!.data).toMatchObject({
      event: "pharmacy_access_granted",
      hospital_id: hospitalA,
      permission: "pharmacy.view",
      basis: {
        affiliation_id: affiliationId,
        cadre: "PHARMACIST",
        cadre_name: "Pharmacist",
        council: "PHARM_BOARD",
        approved_by: admin,
      },
    });
  });

  it("a pharmacy technician is granted the same way, and the basis names the technician's cadre (S2, Law 4)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "PHARMACY_TECH");
    await approve(pg, affiliationId, admin);
    expect((await pharmacyRoles(pg, userId)).map((r) => r.hospital_id)).toEqual([hospitalA]);
    const [grant] = await accessAudit(pg, userId);
    const basis = (grant!.data as { basis: { cadre: string; cadre_name: string } }).basis;
    expect(basis.cadre).toBe("PHARMACY_TECH");
    expect(basis.cadre_name).not.toMatch(/^pharmacist$/i);
    expect(basis.cadre_name).toMatch(/technician/i);
  });

  it.each(["NURSE", "LAB_TECH", "MEDICAL_OFFICER", "RECEPTION"])(
    "approving %s grants no pharmacy access (S4, PA-4, PA-5)",
    async (cadre) => {
      const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, cadre);
      await approve(pg, affiliationId, admin);
      expect(await pharmacyRoles(pg, userId)).toEqual([]);
      expect(await accessAudit(pg, userId)).toEqual([]);
    },
  );

  it("suspension and deactivation revoke in that transaction, audited (S17)", async () => {
    for (const state of ["suspended", "deactivated"]) {
      const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "PHARMACIST");
      await approve(pg, affiliationId, admin);
      await setState(pg, affiliationId, state);
      expect(await pharmacyRoles(pg, userId)).toEqual([]);
      const audit = await accessAudit(pg, userId);
      expect(audit.map((a) => a.action)).toEqual(["insert", "delete"]);
      expect(audit[1]!.data).toMatchObject({
        event: "pharmacy_access_revoked",
        reason: { affiliation_id: affiliationId, to_state: state },
      });
    }
  });

  it("reactivation grants again", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "PHARMACIST");
    await approve(pg, affiliationId, admin);
    await setState(pg, affiliationId, "suspended");
    await setState(pg, affiliationId, "active");
    expect((await pharmacyRoles(pg, userId)).length).toBe(1);
    expect((await accessAudit(pg, userId)).map((a) => a.action)).toEqual([
      "insert",
      "delete",
      "insert",
    ]);
  });

  it("is idempotent: a second approval-shaped update changes nothing", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "PHARMACY_TECH");
    await approve(pg, affiliationId, admin);
    await setState(pg, affiliationId, "active");
    await setState(pg, affiliationId, "active");
    expect((await pharmacyRoles(pg, userId)).length).toBe(1);
    expect((await accessAudit(pg, userId)).length).toBe(1);
  });

  it("a cadre change away from the pharmacy revokes (PA-7)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "PHARMACIST");
    await approve(pg, affiliationId, admin);
    await pg.query(
      `UPDATE public.staff_affiliations SET cadre_id = (SELECT id FROM public.cadres WHERE code = 'NURSE') WHERE id = $1`,
      [affiliationId],
    );
    expect(await pharmacyRoles(pg, userId)).toEqual([]);
  });

  it("access is per hospital: approval at A grants nothing at B", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "PHARMACIST");
    await pg.query(
      `INSERT INTO public.staff_affiliations (user_id, hospital_id, department_id, cadre_id, role_id, employment_type, state)
       SELECT user_id, $2, $3, cadre_id, role_id, employment_type, 'pending_approval' FROM public.staff_affiliations WHERE id = $1`,
      [affiliationId, hospitalB, pharmB],
    );
    await approve(pg, affiliationId, admin);
    expect((await pharmacyRoles(pg, userId)).map((r) => r.hospital_id)).toEqual([hospitalA]);
  });

  it("a hand-granted pharmacy_staff with no pharmacy affiliation goes at the next affiliation change (Law 3)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "NURSE");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'pharmacy_staff', $2)`,
      [userId, hospitalA],
    );
    await approve(pg, affiliationId, admin);
    expect(await pharmacyRoles(pg, userId)).toEqual([]);
  });

  it("the backfill path grants staff approved before 0098, once (S3)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "PHARMACIST");
    await pg.exec(
      `ALTER TABLE public.staff_affiliations DISABLE TRIGGER staff_affiliations_pharmacy_access`,
    );
    await approve(pg, affiliationId, admin);
    await pg.exec(
      `ALTER TABLE public.staff_affiliations ENABLE TRIGGER staff_affiliations_pharmacy_access`,
    );
    expect(await pharmacyRoles(pg, userId)).toEqual([]);
    const call = `SELECT private.sync_pharmacy_access($1, $2, NULL, '{"op":"backfill"}'::jsonb) AS outcome`;
    expect((await rows(pg, call, [userId, hospitalA]))[0]).toEqual({ outcome: "granted" });
    expect((await rows(pg, call, [userId, hospitalA]))[0]).toEqual({ outcome: "unchanged" });
    expect((await pharmacyRoles(pg, userId)).length).toBe(1);
  });

  it("the lab's grant is unchanged beside it: a lab technician still gets lab_tech, not pharmacy_staff", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, pharmA, "LAB_TECH");
    await approve(pg, affiliationId, admin);
    const held = await rows<{ role: string }>(
      pg,
      `SELECT role FROM public.user_roles WHERE user_id = $1 ORDER BY role`,
      [userId],
    );
    expect(held.map((r) => r.role)).toEqual(["lab_tech"]);
  });

  describe("no client writes a role or runs the sync", () => {
    it.each(["authenticated", "anon"] as const)(
      "%s cannot run private.sync_pharmacy_access",
      async (role) => {
        const userId = await authUser(pg, "probe");
        const r = await probe(
          pg,
          { userId: role === "anon" ? null : userId, role },
          `SELECT private.sync_pharmacy_access($1, $2, NULL, '{}'::jsonb)`,
          [userId, hospitalA],
        );
        expect(r.ok).toBe(false);
      },
    );

    it("authenticated pharmacy staff cannot grant themselves pharmacy_staff elsewhere", async () => {
      const { userId } = await staff(pg, {
        hospitalId: hospitalA,
        departmentId: pharmA,
        cadre: "PHARMACIST",
      });
      const me = { userId, role: "authenticated" as const };
      const insert = await probe(
        pg,
        me,
        `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'pharmacy_staff', $2)`,
        [userId, hospitalB],
      );
      const update = await probe(
        pg,
        me,
        `UPDATE public.user_roles SET role = 'hospital_admin' WHERE user_id = $1`,
        [userId],
      );
      const del = await probe(pg, me, `DELETE FROM public.user_roles WHERE user_id = $1`, [userId]);
      expect(insert.ok).toBe(false);
      expect(update.ok ? update.affected : 0).toBe(0);
      expect(del.ok ? del.affected : 0).toBe(0);
    });
  });
});

describe.skipIf(!laneOn)("0100 — who reads prescriptions and emergency doses (§6.2)", () => {
  let pg: Pg;
  let hospitalA: string;
  let hospitalB: string;
  const actor: Record<string, Actor> = {};
  let restrictedPatient: string;

  const count = async (who: Actor, table: string) => {
    const r = await probe(pg, who, `SELECT count(*)::int AS n FROM public.${table}`);
    return r.ok ? (r.rows[0]!.n as number) : r.error;
  };

  beforeAll(async () => {
    pg = (await bootLane()).pg;
    hospitalA = await hospital(pg, "Reads A");
    hospitalB = await hospital(pg, "Reads B");
    const dA = await department(pg, hospitalA, "Medicine");
    const pA = await department(pg, hospitalA, "Pharmacy");
    const dB = await department(pg, hospitalB, "Medicine");
    const as = (userId: string | null, role: Actor["role"] = "authenticated"): Actor => ({
      userId,
      role,
    });

    const doctor = await staff(pg, { hospitalId: hospitalA, departmentId: dA });
    const nurse = await staff(pg, { hospitalId: hospitalA, departmentId: dA, cadre: "NURSE" });
    const pharmacist = await staff(pg, {
      hospitalId: hospitalA,
      departmentId: pA,
      cadre: "PHARMACIST",
    });
    const tech = await staff(pg, {
      hospitalId: hospitalA,
      departmentId: pA,
      cadre: "PHARMACY_TECH",
    });
    const lab = await staff(pg, { hospitalId: hospitalA, departmentId: dA, cadre: "LAB_TECH" });
    const desk = await staff(pg, { hospitalId: hospitalA, departmentId: dA, cadre: "RECEPTION" });
    const otherDoctor = await staff(pg, { hospitalId: hospitalB, departmentId: dB });
    const otherPharmacist = await staff(pg, {
      hospitalId: hospitalB,
      departmentId: dB,
      cadre: "PHARMACIST",
    });
    const pendingPharm = await pendingStaff(pg, hospitalA, pA, "PHARMACIST");
    const hadmin = await authUser(pg, "hospital-admin");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
      [hadmin, hospitalA],
    );
    const sa = await superadmin(pg);
    const pt = await patient(pg);
    restrictedPatient = pt;

    Object.assign(actor, {
      doctor: as(doctor.userId),
      nurse: as(nurse.userId),
      pharmacist: as(pharmacist.userId),
      tech: as(tech.userId),
      lab: as(lab.userId),
      reception: as(desk.userId),
      hospitalAdmin: as(hadmin),
      otherDoctor: as(otherDoctor.userId),
      otherPharmacist: as(otherPharmacist.userId),
      pendingPharmacist: as(pendingPharm.userId),
      superadmin: as(sa),
      patient: as(pt),
      anon: as(null, "anon"),
    });

    // Fixture rows at hospital A: one standard and one restricted prescription for the patient,
    // one emergency dose, one cart with one stock row. Fixture medicines only (Law 8).
    await pg.query(
      `INSERT INTO public.prescriptions
         (hospital_id, patient_user_id, prescriber_user_id, drug_id, drug_name, dose, route, is_emergency, sensitivity)
       VALUES ($1, $2, $3, 'fixture.a', 'Fixture medicine A', 'fixture dose', 'oral', false, 'standard'),
              ($1, $2, $3, 'fixture.b', 'Fixture medicine B', 'fixture dose', 'oral', false, 'restricted')`,
      [hospitalA, pt, doctor.userId],
    );
    const [cart] = await rows<{ id: string }>(
      pg,
      `INSERT INTO public.crash_carts (hospital_id, label) VALUES ($1, 'Fixture cart') RETURNING id`,
      [hospitalA],
    );
    await pg.query(
      `INSERT INTO public.crash_cart_stock (cart_id, drug_id, drug_name) VALUES ($1, 'fixture.c', 'Fixture medicine C')`,
      [cart!.id],
    );
    await pg.query(
      `INSERT INTO public.emergency_administrations
         (hospital_id, patient_user_id, drug_id, drug_name, dose, route, cart_id, administered_by_user_id)
       VALUES ($1, $2, 'fixture.c', 'Fixture medicine C', 'fixture dose', 'iv', $3, $4)`,
      [hospitalA, pt, cart!.id, nurse.userId],
    );
  }, 120_000);

  const TABLES = [
    "prescriptions",
    "emergency_administrations",
    "crash_carts",
    "crash_cart_stock",
  ] as const;
  // Rows each actor sees in each table at hospital A (the only fixture rows).
  const EXPECTED: Record<string, readonly [number, number, number, number]> = {
    pharmacist: [2, 1, 1, 1],
    tech: [2, 1, 1, 1],
    doctor: [2, 1, 1, 1],
    nurse: [2, 1, 1, 1],
    pendingPharmacist: [0, 0, 0, 0],
    lab: [0, 0, 0, 0],
    reception: [0, 0, 0, 0],
    hospitalAdmin: [0, 0, 0, 0],
    otherDoctor: [0, 0, 0, 0],
    otherPharmacist: [0, 0, 0, 0],
    superadmin: [0, 0, 0, 0],
    // Own rows only; 0074's restrictive policy still hides the restricted prescription.
    patient: [1, 1, 0, 0],
    anon: [0, 0, 0, 0],
  };

  it.each(Object.entries(EXPECTED))("%s reads the rows §6.2 allows", async (who, expected) => {
    const seen = [];
    for (const t of TABLES) seen.push(await count(actor[who]!, t));
    expect(seen).toEqual(expected);
  });

  it("the patient never sees their restricted prescription through the client", async () => {
    const r = await probe(
      pg,
      actor.patient!,
      `SELECT sensitivity FROM public.prescriptions WHERE patient_user_id = $1`,
      [restrictedPatient],
    );
    expect(r.ok && r.rows.map((x) => x.sensitivity)).toEqual(["standard"]);
  });

  it.each(["pharmacist", "doctor", "nurse"])(
    "%s cannot insert, update or delete prescriptions or emergency doses",
    async (who) => {
      const me = actor[who]!;
      for (const t of ["prescriptions", "emergency_administrations"]) {
        const upd = await probe(pg, me, `UPDATE public.${t} SET drug_name = 'changed'`);
        const del = await probe(pg, me, `DELETE FROM public.${t}`);
        expect(upd.ok ? upd.affected : 0, `${t} update`).toBe(0);
        expect(del.ok ? del.affected : 0, `${t} delete`).toBe(0);
      }
      const ins = await probe(
        pg,
        me,
        `INSERT INTO public.prescriptions (hospital_id, patient_user_id, prescriber_user_id, drug_id, drug_name, dose, route)
         VALUES ($1, $2, $2, 'x', 'x', 'x', 'x')`,
        [hospitalA, me.userId],
      );
      expect(ins.ok).toBe(false);
    },
  );
});

describe.skipIf(!laneOn)(
  "0120 — pharmacy staff read the chart only through the server (S13, RV-7)",
  () => {
    let pg: Pg;
    let h: string;
    const who: Record<string, Actor> = {};

    beforeAll(async () => {
      pg = (await bootLane()).pg;
      h = await hospital(pg, "Chart");
      const d = await department(pg, h, "Medicine");
      const doctor = await staff(pg, { hospitalId: h, departmentId: d });
      const as = (userId: string): Actor => ({ userId, role: "authenticated" });
      for (const cadre of ["PHARMACIST", "PHARMACY_TECH", "NURSE", "PHYSIOTHERAPIST", "LAB_TECH"])
        who[cadre] = as((await staff(pg, { hospitalId: h, departmentId: d, cadre })).userId);
      who.doctor = as(doctor.userId);
      const pt = await patient(pg);
      await pg.query(
        `INSERT INTO public.encounters (hospital_id, patient_user_id, clinician_user_id, department_id) VALUES ($1, $2, $3, $4)`,
        [h, pt, doctor.userId, d],
      );
      const [ep] = (
        await pg.query<{ id: string }>(
          `INSERT INTO public.resus_episodes (hospital_id, patient_user_id, trigger_kind) VALUES ($1, $2, 'triage_red') RETURNING id`,
          [h, pt],
        )
      ).rows;
      await pg.query(
        `INSERT INTO public.resus_timeline_events (episode_id, kind, payload) VALUES ($1, 'note', '{}'::jsonb)`,
        [ep!.id],
      );
    }, 120_000);

    const count = async (actor: Actor, table: string) => {
      const r = await probe(pg, actor, `SELECT count(*)::int AS n FROM public.${table}`);
      return r.ok ? (r.rows[0]!.n as number) : -1;
    };

    it.each(["encounters", "resus_episodes", "resus_timeline_events"])(
      "%s: pharmacy cadres read nothing; doctor, nurse and physiotherapist read as before",
      async (table) => {
        expect(await count(who.PHARMACIST!, table)).toBe(0);
        expect(await count(who.PHARMACY_TECH!, table)).toBe(0);
        for (const other of ["doctor", "NURSE", "PHYSIOTHERAPIST"])
          expect(await count(who[other]!, table), other).toBe(1);
      },
    );

    it("the shared clinical-staff predicate excludes the pharmacy cadres only", async () => {
      const check = async (actor: Actor) => {
        const r = await probe(pg, actor, `SELECT public.is_active_clinical_staff($1) AS ok`, [h]);
        return r.ok && r.rows[0]!.ok;
      };
      expect(await check(who.PHARMACIST!)).toBe(false);
      expect(await check(who.PHARMACY_TECH!)).toBe(false);
      expect(await check(who.NURSE!)).toBe(true);
      expect(await check(who.PHYSIOTHERAPIST!)).toBe(true);
      // Unchanged here, reported to the lab: lab cadres still pass the clinical predicate.
      expect(await check(who.LAB_TECH!)).toBe(true);
    });

    it("the SQL excludes exactly the cadres of the signed map, in every place", () => {
      const sql = readFileSync(
        resolve(process.cwd(), "supabase/migrations/0120_pharmacy_outside_clinical_reads.sql"),
        "utf8",
      );
      const lists = [...sql.matchAll(/c\.code NOT IN \(([^)]*)\)/g)].map((m) =>
        [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort(),
      );
      expect(lists).toHaveLength(10);
      for (const l of lists) expect(l).toEqual([...PHARMACY_MAP_CADRES].sort());
    });
  },
);
