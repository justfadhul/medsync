/**
 * Drizzle ↔ SQL parity on the PGlite lane: every pgTable in db/schema must match the replayed
 * migrations column for column (name, SQL type, nullability) and carry only CHECKs that exist.
 * The migrations are the source of truth; this catches a Drizzle file that drifted from them
 * (the etco2 / urine_output / cosign-kind drift that 0071 fixed would each have failed here).
 * It also loads 0072, 0085, 0086, 0092 and 0095 for real: the seeds must land in 0071's registries in full, 0086's
 * signed codes on exactly its terms, and a re-run of any of them must be a no-op. The
 * cosign_action_kind_check pair covers 0084 (confirm_diagnosis).
 * Runs only with EMR_PGLITE=1 (see _pglite.ts).
 */
import type { Lane } from "./_pglite";
import { is } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { CAPABILITY_IDS, CONCEPTS, DRUG_CLASS_TAGS } from "@/lib/facts/catalogue.generated";
import { readSeedSources, uuidV5 } from "@/scripts/emr/gen-seed";
import { bootLane, laneOn, readMigration } from "./_pglite";

const src = readSeedSources(process.cwd());

type DbColumn = { column_name: string; is_nullable: "YES" | "NO"; sql_type: string };

const tables = (Object.values(schema) as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .map((t) => getTableConfig(t))
  .filter((c) => (c.schema ?? "public") === "public");

/**
 * Pre-0071 columns Drizzle deliberately maps as text over a Postgres enum / inet (see the comment
 * on users.state). Listed by name so any new drift still fails.
 */
const LEGACY_TEXT_MAPPED = new Set([
  "users.state",
  "hospitals.state",
  "staff_affiliations.state",
  "hospital_leads.facility_level",
  "hospital_applications.facility_level",
  "hospital_applications.state",
  "sa_audit_log.ip_address",
]);

/**
 * Pre-0071 Drizzle CHECKs whose value lists went stale as later migrations widened them. Not
 * touched here (their files predate the EMR); listed so any new drift still fails.
 */
const LEGACY_STALE_CHECKS = new Set([
  "user_roles_role_check",
  "sa_audit_log_action_check",
  "sa_audit_log_target_kind_check",
]);

const dialect = new PgDialect();
/** The quoted literals of a CHECK, sorted: a formatting-proof fingerprint of its allowed values. */
const literals = (def: string) =>
  [...new Set(def.match(/'[^']*'/g) ?? [])]
    .filter((l) => !/^'-?[\d.]+'$/.test(l)) // pg quotes negative bounds ('-2'::integer); Drizzle does not
    .sort()
    .join(",");

/** Drizzle and format_type() spell a few types differently; fold both to one spelling. */
function normType(t: string): string {
  return t
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^bigserial$/, "bigint")
    .replace(/^serial$/, "integer")
    .replace(/^smallserial$/, "smallint")
    .replace(/^varchar/, "charactervarying")
    .replace(/^timestamptz/, "timestampwithtimezone")
    .replace(/^timestamp(\(\d+\))?$/, "timestamp$1withouttimezone")
    .replace(/^time(\[\])?$/, "timewithouttimezone$1");
}

describe.skipIf(!laneOn)("Drizzle schema matches the replayed migrations", () => {
  let lane: Lane;
  const db = new Map<string, Map<string, DbColumn>>();
  /** table → check name → the sorted quoted literals in its definition. */
  const checks = new Map<string, Map<string, string>>();

  beforeAll(async () => {
    lane = await bootLane();
    const cols = await lane.pg.query<DbColumn & { table_name: string }>(
      `SELECT c.table_name, c.column_name, c.is_nullable,
              format_type(a.atttypid, a.atttypmod) AS sql_type
         FROM information_schema.columns c
         JOIN pg_attribute a
           ON a.attrelid = format('public.%I', c.table_name)::regclass AND a.attname = c.column_name
        WHERE c.table_schema = 'public'`,
    );
    for (const r of cols.rows) {
      if (!db.has(r.table_name)) db.set(r.table_name, new Map());
      db.get(r.table_name)!.set(r.column_name, r);
    }
    const cons = await lane.pg.query<{ table_name: string; conname: string; def: string }>(
      `SELECT rel.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE n.nspname = 'public' AND con.contype = 'c'`,
    );
    for (const r of cons.rows) {
      if (!checks.has(r.table_name)) checks.set(r.table_name, new Map());
      checks.get(r.table_name)!.set(r.conname, literals(r.def));
    }
  }, 180_000);

  it("finds the Drizzle tables (sanity)", () => {
    expect(tables.length).toBeGreaterThan(80);
    expect(tables.map((t) => t.name)).toContain("clinical_notes");
  });

  it.each(tables.map((t) => [t.name, t] as const))("%s", (name, cfg) => {
    const live = db.get(name);
    expect(live, `table ${name} missing from the migrations`).toBeDefined();
    const problems: string[] = [];
    for (const col of cfg.columns) {
      const row = live!.get(col.name);
      if (!row) {
        problems.push(`column ${col.name}: in Drizzle, not in SQL`);
        continue;
      }
      if (col.notNull !== (row.is_nullable === "NO"))
        problems.push(`column ${col.name}: Drizzle notNull=${col.notNull}, SQL ${row.is_nullable}`);
      if (
        normType(col.getSQLType()) !== normType(row.sql_type) &&
        !LEGACY_TEXT_MAPPED.has(`${name}.${col.name}`)
      )
        problems.push(`column ${col.name}: Drizzle ${col.getSQLType()}, SQL ${row.sql_type}`);
    }
    const drizzleCols = new Set(cfg.columns.map((c) => c.name));
    for (const c of live!.keys())
      if (!drizzleCols.has(c)) problems.push(`column ${c}: in SQL, not in Drizzle`);
    for (const ck of cfg.checks) {
      const live = checks.get(name)?.get(ck.name);
      const mine = literals(dialect.sqlToQuery(ck.value).sql);
      if (live === undefined) problems.push(`check ${ck.name}: in Drizzle, not in SQL`);
      else if (live !== mine && !LEGACY_STALE_CHECKS.has(ck.name))
        problems.push(`check ${ck.name}: Drizzle {${mine}}, SQL {${live}}`);
    }
    expect(problems).toEqual([]);
  });
});

describe.skipIf(!laneOn)("0072, 0085 and 0086 seeds on the 0071 registries", () => {
  const REGISTRIES = [
    "clinical_concepts",
    "drug_class_tags",
    "capabilities",
    "test_catalogue",
    "diagnosis_terms",
  ];
  const counts = async (lane: Lane) =>
    Object.fromEntries(
      await Promise.all(
        REGISTRIES.map(async (t) => [
          t,
          Number(
            (await lane.pg.query<{ n: string }>(`SELECT count(*) AS n FROM public.${t}`)).rows[0]!
              .n,
          ),
        ]),
      ),
    );

  it("every generated registry id is in the database, and a re-run adds nothing", async () => {
    const lane = await bootLane();
    const ids = async (t: string) =>
      new Set(
        (await lane.pg.query<{ id: string }>(`SELECT id FROM public.${t}`)).rows.map((r) => r.id),
      );
    expect([...(await ids("clinical_concepts"))].sort()).toEqual(Object.keys(CONCEPTS).sort());
    expect([...(await ids("drug_class_tags"))].sort()).toEqual(Object.keys(DRUG_CLASS_TAGS).sort());
    expect([...(await ids("capabilities"))].sort()).toEqual([...CAPABILITY_IDS].sort());
    const before = await counts(lane);
    // 0072's 85 terms plus 0085's 187 (REF-DX-TERMS v1.1, seeded uncoded: D-SI-26), of which 0086
    // codes the 177 the CSO signed and leaves the 10 held terms "As typed, not coded"; plus 0092's 8
    // (CFC v1.5, uncoded); plus 0095's 12 (REF-DX-TERMS v1.2, coded). Tests: 0108 adds 4 (CFC v1.6, inactive),
    // 0172 adds 251 (CFC v1.7, lab test menu v2, inactive).
    expect(before).toMatchObject({
      test_catalogue: 35 + 9 + 4 + 251,
      diagnosis_terms: 85 + 187 + 8 + 12,
    });
    const coding = async () =>
      (
        await lane.pg.query<{ id: string; icd11_code: string | null; verified_on: string | null }>(
          `SELECT id, icd11_code, verified_on::text FROM public.diagnosis_terms ORDER BY id`,
        )
      ).rows;
    const coded = await coding();
    const uncoded = coded.filter((r) => r.icd11_code === null && r.verified_on === null);
    expect(uncoded.map((r) => r.id).sort()).toEqual(
      [...src.codes11.held, ...src.v15.termsAdd]
        .map((h: { id: string }) => uuidV5(`diagnosis_terms:${h.id}`))
        .sort(),
    );
    for (const c of src.codes11.codes as { id: string; code: string }[])
      expect(
        coded.find((r) => r.id === uuidV5(`diagnosis_terms:${c.id}`)),
        c.id,
      ).toMatchObject({
        icd11_code: c.code,
        verified_on: "2026-09-28",
      });
    const linked = await lane.pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.diagnosis_terms WHERE concept_id IS NOT NULL`,
    );
    expect(linked.rows[0]!.n).toBe(16); // 0092's term → condition links
    await lane.pg.exec(readMigration("0072_emr_reference_seed.sql"));
    await lane.pg.exec(readMigration("0085_ref_dx_terms_v1_1.sql"));
    await lane.pg.exec(readMigration("0086_ref_dx_terms_v1_1_icd11.sql"));
    await lane.pg.exec(readMigration("0092_cfc_v1_5_ncd_diabetes.sql"));
    await lane.pg.exec(readMigration("0095_ref_dx_terms_v1_2.sql"));
    await lane.pg.exec(readMigration("0172_cfc_v1_7_lab_test_menu.sql"));
    expect(await counts(lane)).toEqual(before);
    expect(await coding()).toEqual(coded);
  }, 180_000);
});
