import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PHARMACY_MAP_CADRES } from "@/lib/pharmacy/access";

const sql = readFileSync("supabase/migrations/0306_care_requests.sql", "utf8");

describe("migration 0306 (static)", () => {
  it("is GATED", () => {
    expect(sql.startsWith("-- GATED")).toBe(true);
    expect(sql.slice(0, 300)).toMatch(/0306/);
  });

  it("forces RLS on both tables", () => {
    expect((sql.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/REVOKE ALL ON public\.care_requests FROM anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON public\.care_request_events FROM anon, authenticated/);
  });

  it("append-only", () => {
    for (const t of ["care_requests", "care_request_events"])
      expect(sql).toMatch(
        new RegExp(
          `BEFORE UPDATE OR DELETE ON public\\.${t}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.block_modify_append_only`,
        ),
      );
  });

  it("widens the note type and notification kinds", () => {
    expect(sql).toContain("'consult'");
    expect(sql).toContain("'ward_incoming'");
  });

  it("the team read arm leaves out the pharmacy cadres, the signed map's (R32)", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION private.care_request_visible"));
    const list = fn.match(/c\.code NOT IN \(([^)]*)\)/)?.[1];
    expect(
      list
        ?.split(",")
        .map((x) => x.trim().replace(/'/g, ""))
        .sort(),
    ).toEqual([...PHARMACY_MAP_CADRES].sort());
  });
});
