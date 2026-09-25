import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Probe (landing S6 Gate 0, "an append-only audit trail of who viewed or
 * changed what"). Source-level, like tests/emergency/rls-as-written: the
 * behavioural proof for audit_log (tests/audit/audit.test.ts) needs a live
 * test database, and nothing tested the read log (clinical_phi_access_log).
 */

const DIR = resolve(process.cwd(), "supabase/migrations");
const SQL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .join("\n");

const LOGS = [
  { table: "audit_log", trigger: "audit_log_no_modify", fn: "audit_log_block_modify" },
  {
    table: "clinical_phi_access_log",
    trigger: "phi_access_log_no_modify",
    fn: "phi_access_log_block_modify",
  },
];

describe.each(LOGS)("public.$table is append-only", ({ table, trigger, fn }) => {
  it("a BEFORE UPDATE OR DELETE trigger raises", () => {
    expect(SQL).toMatch(
      new RegExp(
        `CREATE TRIGGER ${trigger}\\s+BEFORE UPDATE OR DELETE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.${fn}\\(\\)`,
      ),
    );
    const body = SQL.slice(SQL.indexOf(`FUNCTION public.${fn}()`));
    expect(body.slice(0, body.indexOf("$$;"))).toMatch(/RAISE EXCEPTION/);
  });

  it("clients cannot even attempt UPDATE or DELETE", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(SQL).toContain(`REVOKE UPDATE, DELETE ON public.${table} FROM ${role};`);
    }
  });

  it("no later migration drops, disables or re-grants it", () => {
    const lastDrop = Math.max(
      -1,
      ...[...SQL.matchAll(new RegExp(`DROP TRIGGER (IF EXISTS )?${trigger}\\b`, "g"))].map(
        (m) => m.index,
      ),
    );
    expect(SQL.lastIndexOf(`CREATE TRIGGER ${trigger}`)).toBeGreaterThan(lastDrop);
    expect(SQL).not.toMatch(new RegExp(`ALTER TABLE public\\.${table} DISABLE TRIGGER`));
    expect(SQL).not.toMatch(new RegExp(`DROP FUNCTION (IF EXISTS )?public\\.${fn}\\b`));
    expect(SQL).not.toMatch(new RegExp(`GRANT [^;]*(UPDATE|DELETE)[^;]* ON public\\.${table}\\b`));
  });
});

describe("staff reads write the read log", () => {
  it.each([
    "lib/doctor/patient-access.ts",
    "lib/nurse/patient-access.ts",
    "lib/reception/queries.ts",
  ])("%s", (file) => {
    expect(readFileSync(resolve(process.cwd(), file), "utf8")).toMatch(
      /db\s*\.insert\(clinicalPhiAccessLog\)/,
    );
  });
});
