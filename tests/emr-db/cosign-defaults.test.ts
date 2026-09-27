/**
 * 0075 on the PGlite lane: the co-sign policy defaults reach every hospital. The matrix it seeds
 * must be exactly the rows 0030, 0031 and 0036 seeded (parsed from those files, so a drift in
 * either direction fails), the backfill fills only hospitals with no rows, the trigger seeds a
 * new hospital, a re-run adds nothing, and every insert is audited.
 * Runs only with EMR_PGLITE=1 (see _pglite.ts).
 */
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { bootEmpty, hospital, laneOn, migrate, readMigration } from "./_pglite";

const BOOT_MS = 180_000;
type Row = { cadre_code: string; action_kind: string; requirement: string };

/** The VALUES tuples of every clinical_cosign_policies INSERT in a migration. */
function seededTuples(file: string): string[] {
  const sql = readMigration(file);
  const out: string[] = [];
  for (const block of sql.matchAll(
    /INSERT INTO public\.clinical_cosign_policies[\s\S]*?ON CONFLICT DO NOTHING/g,
  )) {
    for (const m of block[0].matchAll(/\('([A-Z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)'\)/g)) {
      out.push(`${m[1]}|${m[2]}|${m[3]}`);
    }
  }
  return out;
}

const key = (r: Row) => `${r.cadre_code}|${r.action_kind}|${r.requirement}`;

describe.skipIf(!laneOn)("0075 co-sign policy defaults", () => {
  let pg: Pg;
  let before: string; // created after 0030 → no rows
  let custom: string; // already had a (customised) row
  const expected = [
    ...seededTuples("0030_doctor_workspace.sql"),
    ...seededTuples("0031_nurse_workspace.sql"),
    ...seededTuples("0036_triage_engine.sql"),
  ].sort();

  const policies = async (h: string) =>
    (
      await pg.query<Row & { department_id: string | null; notes: string | null }>(
        `SELECT cadre_code, action_kind, requirement, department_id, notes
           FROM public.clinical_cosign_policies WHERE hospital_id = $1`,
        [h],
      )
    ).rows;
  const total = async () =>
    Number(
      (await pg.query<{ n: string }>("SELECT count(*) AS n FROM public.clinical_cosign_policies"))
        .rows[0]!.n,
    );

  beforeAll(async () => {
    pg = await bootEmpty();
    await migrate(pg, { upTo: "0074_zzz" });
    before = await hospital(pg, "Created after 0030");
    custom = await hospital(pg, "Customised");
    await pg.query(
      `INSERT INTO public.clinical_cosign_policies (hospital_id, cadre_code, action_kind, requirement, notes)
       VALUES ($1, 'MEDICAL_OFFICER', 'prescription_routine', 'cosign_required', 'local rule')`,
      [custom],
    );
    await migrate(pg, { from: "0075", upTo: "0075_zzz" });
  }, BOOT_MS);

  it("the parsed source matrix is the full 0030 + 0031 + 0036 seed (54 rows)", () => {
    expect(expected).toHaveLength(54);
    expect(new Set(expected).size).toBe(54);
  });

  it("backfill: a hospital created after 0030 now has exactly the old defaults", async () => {
    const rows = await policies(before);
    expect(rows.map(key).sort()).toEqual(expected);
    expect(rows.every((r) => r.department_id === null)).toBe(true);
  });

  it("backfill leaves a hospital that already had rows untouched", async () => {
    const rows = await policies(custom);
    expect(rows).toEqual([
      {
        cadre_code: "MEDICAL_OFFICER",
        action_kind: "prescription_routine",
        requirement: "cosign_required",
        department_id: null,
        notes: "local rule",
      },
    ]);
  });

  it("trigger: a newly inserted hospital gets the defaults, also through service_role", async () => {
    const owner = await hospital(pg, "New via owner");
    expect((await policies(owner)).map(key).sort()).toEqual(expected);

    await pg.exec("SET ROLE service_role");
    let viaService: string;
    try {
      viaService = (
        await pg.query<{ id: string }>(
          `INSERT INTO public.hospitals (name, slug, level, state)
           VALUES ('Via service role', 'via-service-role', 'private', 'provisioning') RETURNING id`,
        )
      ).rows[0]!.id;
    } finally {
      await pg.exec("RESET ROLE");
    }
    expect((await policies(viaService)).map(key).sort()).toEqual(expected);
  });

  it("the resolver-level outcome: an intern's routine prescription needs co-sign, not blocked", async () => {
    const r = await pg.query<{ requirement: string }>(
      `SELECT requirement FROM public.clinical_cosign_policies
        WHERE hospital_id = $1 AND department_id IS NULL
          AND cadre_code = 'INTERN_DOCTOR' AND action_kind = 'prescription_routine'`,
      [before],
    );
    expect(r.rows.map((x) => x.requirement)).toEqual(["cosign_required"]);
  });

  it("re-running 0075 adds nothing and changes nothing", async () => {
    const n = await total();
    const snapshot = (await pg.query("SELECT * FROM public.clinical_cosign_policies ORDER BY id"))
      .rows;
    await pg.exec(readMigration("0075_cosign_policy_defaults.sql"));
    expect(await total()).toBe(n);
    expect(
      (await pg.query("SELECT * FROM public.clinical_cosign_policies ORDER BY id")).rows,
    ).toEqual(snapshot);
    // Calling the seed directly on a seeded hospital inserts 0 rows.
    const again = await pg.query<{ n: number }>(
      "SELECT private.seed_cosign_policy_defaults($1) AS n",
      [before],
    );
    expect(again.rows[0]!.n).toBe(0);
  });

  it("every seeded row is audited like the app's writes", async () => {
    const r = await pg.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.audit_log
        WHERE table_name = 'clinical_cosign_policies' AND action = 'insert'
          AND after_data->>'hospital_id' = $1`,
      [before],
    );
    expect(Number(r.rows[0]!.n)).toBe(54);
  });

  it("clients cannot call the seed function", async () => {
    await pg.exec("SET ROLE authenticated");
    try {
      await expect(
        pg.query("SELECT private.seed_cosign_policy_defaults($1)", [before]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec("RESET ROLE");
    }
  });
});
