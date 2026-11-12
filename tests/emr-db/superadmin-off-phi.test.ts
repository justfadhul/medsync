/**
 * Review C-3 + H-11 (migration 0287) on the real SQL: the superadmin's standing read of patient data is gone (every
 * other arm stays), and the avatars bucket shows a person their own photo and clinicians' photos, nobody else's.
 * Every actor carries an aal2 token, so the 0285 MFA gate cannot be what hides a row.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  laneOn,
  MIGRATIONS_DIR,
  patient,
  superadmin,
} from "./_pglite";

async function rows(pg: Pg, userId: string, sql: string, params: unknown[] = []) {
  return pg.transaction(async (tx) => {
    await tx.query(
      `SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claims', $2, true)`,
      [userId, JSON.stringify({ sub: userId, role: "authenticated", aal: "aal2" })],
    );
    await tx.exec("SET LOCAL ROLE authenticated");
    const r = await tx.query(sql, params);
    await tx.rollback();
    return r.rows;
  });
}

describe.skipIf(!laneOn)("0287: superadmin off PHI, avatars", () => {
  let pg: Pg;
  beforeAll(async () => {
    pg = (await bootLane()).pg;
    // Supabase grants these; the lane's bootstrap does not.
    await pg.exec(
      "GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT ON storage.objects TO authenticated;",
    );
  }, 600_000);

  it("leaves no superadmin arm on the patient tables or audit_log", async () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0287_superadmin_off_phi.sql"), "utf8");
    const phi = [...sql.match(/ARRAY\[([\s\S]*?)\];/)![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(phi.length).toBeGreaterThan(40);
    const left = await pg.query(
      `SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = ANY ($1::text[])
          AND coalesce(qual, '') || coalesce(with_check, '') ILIKE '%superadmin%'`,
      [[...phi, "audit_log"]],
    );
    expect(left.rows).toEqual([]);
  });

  it("the superadmin reads no patient row; the patient and the care team still do", async () => {
    const H = await hospital(pg);
    const D = await department(pg, H);
    const doc = await clinician(pg, { hospitalId: H, departmentId: D });
    const P = await patient(pg);
    const SA = await superadmin(pg);
    const enc = await encounter(pg, {
      hospitalId: H,
      patientUserId: P,
      clinicianUserId: doc.userId,
    });

    // The token works: a non-PHI superadmin arm (user_roles) still answers.
    expect(
      await rows(pg, SA, `SELECT 1 FROM public.user_roles WHERE user_id = $1`, [doc.userId]),
    ).toHaveLength(1);

    expect(await rows(pg, SA, `SELECT 1 FROM public.users WHERE id = $1`, [P])).toHaveLength(0);
    expect(await rows(pg, SA, `SELECT 1 FROM public.encounters WHERE id = $1`, [enc])).toHaveLength(
      0,
    );
    expect(await rows(pg, SA, `SELECT 1 FROM public.audit_log LIMIT 1`)).toHaveLength(0);

    expect(await rows(pg, P, `SELECT 1 FROM public.users WHERE id = $1`, [P])).toHaveLength(1);
    expect(
      await rows(pg, doc.userId, `SELECT 1 FROM public.encounters WHERE id = $1`, [enc]),
    ).toHaveLength(1);
  });

  it("avatars: your own photo and clinicians' photos, not another patient's", async () => {
    const H = await hospital(pg);
    const D = await department(pg, H);
    const doc = await clinician(pg, { hospitalId: H, departmentId: D });
    const [A, B] = [await patient(pg), await patient(pg)];
    for (const owner of [A, B, doc.userId])
      await pg.query(
        `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', $1, $2)`,
        [`${owner}/face.jpg`, owner],
      );
    const seen = (
      await rows(pg, A, `SELECT name FROM storage.objects WHERE bucket_id = 'avatars'`)
    ).map((r) => (r.name as string).split("/")[0]);
    expect(seen.sort()).toEqual([A, doc.userId].sort());
  });
});
