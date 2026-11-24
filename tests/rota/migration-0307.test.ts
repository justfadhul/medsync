import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { POST_LEVELS } from "@/lib/rota/cover";

const sql = readFileSync("supabase/migrations/0307_duty_rota.sql", "utf8");

describe("migration 0307 (static)", () => {
  it("is GATED", () => {
    expect(sql.startsWith("-- GATED")).toBe(true);
    expect(sql.slice(0, 300)).toMatch(/0307/);
    expect(sql).toMatch(/ADDITIVE and re-runnable\./);
  });

  it("forces RLS", () => {
    expect((sql.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length).toBeGreaterThanOrEqual(2);
    for (const t of ["duty_posts", "duty_assignments"]) {
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM anon, authenticated`);
      expect(sql).toMatch(new RegExp(`CREATE POLICY mfa_gate ON public\\.${t} AS RESTRICTIVE`));
      expect(sql).toMatch(new RegExp(`AFTER INSERT OR UPDATE OR DELETE ON public\\.${t}`));
    }
  });

  it("the guard names every hint", () => {
    const hints = Object.keys(DUTY_ROTA_COPY.refusal).filter((h) => h !== "rota_locked"); // rota_locked is 0309's
    expect(hints.sort()).toEqual([
      "rota_double",
      "rota_full",
      "rota_grade",
      "rota_leave",
      "rota_maker",
    ]);
    for (const h of hints) expect(sql).toContain(`HINT = '${h}'`);
  });

  it("takes the post lock before counting, as 0273 does", () => {
    const guard = sql.slice(sql.indexOf("FUNCTION private.duty_assignment_guard"));
    const lock = guard.indexOf("pg_advisory_xact_lock(hashtext(NEW.post_id::text))");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(guard.indexOf("'rota_double'"));
    expect(lock).toBeLessThan(guard.indexOf("'rota_full'"));
  });

  it("the post levels are the engine's", () => {
    const list = sql.match(/duty_posts_level_check CHECK \(level IN \(([^)]*)\)\)/)?.[1];
    expect(list?.split(",").map((x) => x.trim().replace(/'/g, ""))).toEqual([...POST_LEVELS]);
  });
});
