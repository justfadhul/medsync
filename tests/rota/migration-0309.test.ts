import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";

const sql = readFileSync("supabase/migrations/0309_duty_rota_upkeep.sql", "utf8");
const NEW_TABLES = [
  "duty_rota_templates",
  "duty_rota_week_events",
  "duty_rota_delegates",
  "duty_swap_requests",
  "duty_swap_request_events",
];

describe("migration 0309 (static)", () => {
  it("is GATED", () => {
    expect(
      sql.startsWith("-- GATED — applied by the owner (`npm run db:migrate`), never auto-run."),
    ).toBe(true);
    expect(sql.split("\n")[1]).toMatch(/^-- 0309: .*\(ADR 0538\)\.$/);
    expect(sql).toMatch(/ADDITIVE and re-runnable\./);
  });

  it("names rota_locked, and the request path is the only way past it", () => {
    const guard = sql.slice(sql.indexOf("FUNCTION private.duty_assignment_guard"));
    expect(guard).toContain("HINT = 'rota_locked'");
    expect(guard).toContain("current_setting('duty.rota_via', true) = 'request'");
    // Everything 0307's guard refused, it still refuses.
    for (const h of [
      "rota_cover",
      "rota_double",
      "rota_full",
      "rota_grade",
      "rota_leave",
      "rota_maker",
    ])
      expect(guard).toContain(`HINT = '${h}'`);
    const lock = guard.indexOf("pg_advisory_xact_lock(hashtext(NEW.post_id::text))");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(guard.indexOf("'rota_double'"));
    expect(lock).toBeLessThan(guard.indexOf("'rota_full'"));
  });

  it("drops the three-argument rota maker before creating the four-argument one (R8)", () => {
    const drop = sql.indexOf("DROP FUNCTION IF EXISTS private.duty_rota_maker(uuid, uuid, uuid);");
    const create = sql.indexOf(
      "CREATE OR REPLACE FUNCTION private.duty_rota_maker(p_hospital uuid, p_user uuid, p_department uuid,\n  p_publish boolean DEFAULT false)",
    );
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
  });

  it("forces RLS, gates MFA and audits every new table; events are append-only", () => {
    for (const t of NEW_TABLES) {
      expect(sql).toContain(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM anon, authenticated`);
      expect(sql).toContain(`GRANT SELECT ON public.${t} TO medsync_clinical_reader`);
      expect(sql).toMatch(new RegExp(`CREATE POLICY mfa_gate ON public\\.${t} AS RESTRICTIVE`));
      expect(sql).toMatch(new RegExp(`AFTER INSERT OR UPDATE OR DELETE ON public\\.${t}\\b`));
    }
    for (const t of ["duty_rota_week_events", "duty_swap_requests", "duty_swap_request_events"])
      expect(sql).toMatch(
        new RegExp(
          `BEFORE UPDATE OR DELETE ON public\\.${t}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.block_modify_append_only`,
        ),
      );
  });

  it("the lock gives way only to cover-shaped writes (R48)", () => {
    const guard = sql.slice(sql.indexOf("FUNCTION private.duty_assignment_guard"));
    expect(guard).toContain("via AND NEW.end_reason = 'covered'");
    expect(guard).toContain("via AND NEW.covers_assignment_id IS NOT NULL");
  });

  it("no app code sets the request bypass (R48)", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : [p];
      });
    for (const f of [...files("lib"), ...files("app")].filter((f) => /\.(ts|tsx)$/.test(f)))
      expect(readFileSync(f, "utf8"), f).not.toContain("duty.rota_via");
  });

  it("one active delegation per person per department (R49)", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS duty_rota_delegates_one\s+ON public\.duty_rota_delegates \(hospital_id, department_id, to_user\) WHERE revoked_at IS NULL;/,
    );
    expect(sql).toContain(
      "AND private.duty_rota_owner(d.hospital_id, d.from_user, d.department_id)",
    );
  });

  it("the week's shared lock precedes the rota_locked check; publish takes the same key (R50)", () => {
    const key = "hashtext(p.department_id::text || wk::text)";
    const guard = sql.slice(sql.indexOf("FUNCTION private.duty_assignment_guard"));
    const shared = guard.indexOf(`pg_advisory_xact_lock_shared(${key})`);
    expect(shared).toBeGreaterThan(-1);
    expect(shared).toBeLessThan(guard.indexOf("'rota_locked'"));
    expect(sql).toContain(
      "pg_advisory_xact_lock(hashtext(NEW.department_id::text || NEW.week_start::text))",
    );
  });

  it("every HINT 0309 raises has words in DUTY_ROTA_COPY.refusal, and every refusal carries one", () => {
    const hints = [...sql.matchAll(/HINT = '(\w+)'/g)].map((m) => m[1]!);
    expect(hints.length).toBeGreaterThan(10);
    for (const h of new Set(hints)) expect(Object.keys(DUTY_ROTA_COPY.refusal), h).toContain(h);
    // Each RAISE EXCEPTION statement (to its semicolon) names a HINT, but the "never deleted" ones, which no
    // app write can reach (the app never deletes).
    for (const stmt of sql.match(/RAISE EXCEPTION[^;]*;/g) ?? [])
      if (!/never deleted/.test(stmt)) expect(stmt, stmt).toMatch(/HINT = '\w+'/);
  });
});
