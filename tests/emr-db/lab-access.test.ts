/**
 * Lab Phase 0, Step 2 (gate-a-proposal §6): migration 0097 on the PGlite lane. The lab role follows
 * the affiliation — granted when a lab cadre is approved, revoked when it is suspended, deactivated,
 * moved or re-cadred — inside the transaction that changed the affiliation, each with a
 * `lab_access` audit row carrying the basis. No client role writes a role or runs the sync.
 *
 * Runs with EMR_PGLITE=1 (PGlite symlinked from ~/Desktop/medsync/.emr-harness, tests/emr-db/_pglite.ts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Lane, Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { LAB_MAP_CADRES } from "@/lib/lab/access";
import { authUser, bootLane, department, hospital, laneOn, probe, staff } from "./_pglite";

async function rows<T = Record<string, unknown>>(pg: Pg, sql: string, params?: unknown[]) {
  return (await pg.query<T>(sql, params)).rows;
}

const labRoles = (pg: Pg, userId: string) =>
  rows<{ hospital_id: string; created_by: string | null }>(
    pg,
    `SELECT hospital_id, created_by FROM public.user_roles WHERE user_id = $1 AND role = 'lab_tech'`,
    [userId],
  );

const accessAudit = (pg: Pg, userId: string) =>
  rows<{ action: string; actor_id: string | null; data: Record<string, unknown> }>(
    pg,
    `SELECT action, actor_id, coalesce(after_data, before_data) AS data
       FROM public.audit_log
      WHERE table_name = 'lab_access' AND coalesce(after_data, before_data)->>'user_id' = $1
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

describe.skipIf(!laneOn)("0097 — lab access follows the affiliation", () => {
  let lane: Lane;
  let pg: Pg;
  let hospitalA: string;
  let hospitalB: string;
  let labA: string;
  let labB: string;
  let admin: string;

  beforeAll(async () => {
    lane = await bootLane();
    pg = lane.pg;
    hospitalA = await hospital(pg, "Lab A");
    hospitalB = await hospital(pg, "Lab B");
    labA = await department(pg, hospitalA, "Laboratory");
    labB = await department(pg, hospitalB, "Laboratory");
    admin = await authUser(pg, "hospital-admin");
  }, 120_000);

  it("the SQL names exactly the cadres of the signed map", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/0097_lab_access_sync.sql"),
      "utf8",
    );
    const listed = [...sql.matchAll(/c\.code IN \(([^)]*)\)/g)].flatMap((m) =>
      [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]),
    );
    expect(new Set(listed)).toEqual(new Set(LAB_MAP_CADRES));
  });

  it("approval of a lab technician grants lab_tech in that transaction, with a basis audit row (S1)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "LAB_TECH");
    expect(await labRoles(pg, userId)).toEqual([]);
    await approve(pg, affiliationId, admin);
    expect(await labRoles(pg, userId)).toEqual([{ hospital_id: hospitalA, created_by: admin }]);
    const audit = await accessAudit(pg, userId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("insert");
    expect(audit[0]!.actor_id).toBe(admin);
    expect(audit[0]!.data).toMatchObject({
      event: "lab_access_granted",
      hospital_id: hospitalA,
      role: "lab_tech",
      basis: {
        affiliation_id: affiliationId,
        cadre: "LAB_TECH",
        council: "AHPC",
        approved_by: admin,
      },
    });
  });

  it("a lab technologist is granted the same way", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "LAB_TECHNOLOGIST");
    await approve(pg, affiliationId, admin);
    expect((await labRoles(pg, userId)).map((r) => r.hospital_id)).toEqual([hospitalA]);
  });

  it("approving a nurse grants no lab access (S3)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "NURSE");
    await approve(pg, affiliationId, admin);
    expect(await labRoles(pg, userId)).toEqual([]);
    expect(await accessAudit(pg, userId)).toEqual([]);
  });

  it("suspension and deactivation revoke in that transaction, audited (S13)", async () => {
    for (const state of ["suspended", "deactivated"]) {
      const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "LAB_TECH");
      await approve(pg, affiliationId, admin);
      await setState(pg, affiliationId, state);
      expect(await labRoles(pg, userId)).toEqual([]);
      const audit = await accessAudit(pg, userId);
      expect(audit.map((a) => a.action)).toEqual(["insert", "delete"]);
      expect(audit[1]!.data).toMatchObject({
        event: "lab_access_revoked",
        reason: { affiliation_id: affiliationId, to_state: state },
      });
    }
  });

  it("reactivation grants again", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "LAB_TECH");
    await approve(pg, affiliationId, admin);
    await setState(pg, affiliationId, "suspended");
    await setState(pg, affiliationId, "active");
    expect((await labRoles(pg, userId)).length).toBe(1);
    expect((await accessAudit(pg, userId)).map((a) => a.action)).toEqual([
      "insert",
      "delete",
      "insert",
    ]);
  });

  it("is idempotent: a second approval-shaped update changes nothing", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "LAB_TECH");
    await approve(pg, affiliationId, admin);
    await setState(pg, affiliationId, "active");
    await setState(pg, affiliationId, "active");
    expect((await labRoles(pg, userId)).length).toBe(1);
    expect((await accessAudit(pg, userId)).length).toBe(1);
  });

  it("a cadre change away from the lab revokes (LA-8)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "LAB_TECH");
    await approve(pg, affiliationId, admin);
    await pg.query(
      `UPDATE public.staff_affiliations SET cadre_id = (SELECT id FROM public.cadres WHERE code = 'NURSE') WHERE id = $1`,
      [affiliationId],
    );
    expect(await labRoles(pg, userId)).toEqual([]);
  });

  it("access is per hospital: approval at A grants nothing at B (S12)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "LAB_TECH");
    await pg.query(
      `INSERT INTO public.staff_affiliations (user_id, hospital_id, department_id, cadre_id, role_id, employment_type, state)
       SELECT user_id, $2, $3, cadre_id, role_id, employment_type, 'pending_approval' FROM public.staff_affiliations WHERE id = $1`,
      [affiliationId, hospitalB, labB],
    );
    await approve(pg, affiliationId, admin);
    expect((await labRoles(pg, userId)).map((r) => r.hospital_id)).toEqual([hospitalA]);
  });

  it("a hand-granted lab_tech with no lab affiliation goes at the next affiliation change (Law 3)", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "NURSE");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'lab_tech', $2)`,
      [userId, hospitalA],
    );
    await approve(pg, affiliationId, admin);
    expect(await labRoles(pg, userId)).toEqual([]);
  });

  it("the backfill path grants staff approved before 0097, once", async () => {
    const { userId, affiliationId } = await pendingStaff(pg, hospitalA, labA, "LAB_TECH");
    await pg.exec(
      `ALTER TABLE public.staff_affiliations DISABLE TRIGGER staff_affiliations_lab_access`,
    );
    await approve(pg, affiliationId, admin);
    await pg.exec(
      `ALTER TABLE public.staff_affiliations ENABLE TRIGGER staff_affiliations_lab_access`,
    );
    expect(await labRoles(pg, userId)).toEqual([]);
    const call = `SELECT private.sync_lab_access($1, $2, NULL, '{"op":"backfill"}'::jsonb) AS outcome`;
    expect((await rows(pg, call, [userId, hospitalA]))[0]).toEqual({ outcome: "granted" });
    expect((await rows(pg, call, [userId, hospitalA]))[0]).toEqual({ outcome: "unchanged" });
    expect((await labRoles(pg, userId)).length).toBe(1);
  });

  describe("no client writes a role or runs the sync", () => {
    it.each(["authenticated", "anon"] as const)(
      "%s cannot run private.sync_lab_access",
      async (role) => {
        const userId = await authUser(pg, "probe");
        const r = await probe(
          pg,
          { userId: role === "anon" ? null : userId, role },
          `SELECT private.sync_lab_access($1, $2, NULL, '{}'::jsonb)`,
          [userId, hospitalA],
        );
        expect(r.ok).toBe(false);
      },
    );

    it("authenticated staff cannot insert, update or delete user_roles", async () => {
      const { userId } = await staff(pg, {
        hospitalId: hospitalA,
        departmentId: labA,
        cadre: "LAB_TECH",
      });
      const me = { userId, role: "authenticated" as const };
      const insert = await probe(
        pg,
        me,
        `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'lab_tech', $2)`,
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
