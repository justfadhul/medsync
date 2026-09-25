import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration 0069 (doctor workspace) — source-level checks that hold without a
 * database: additive, one audit action on top of 0068's list, payloads that
 * carry nothing about a patient, and a topic only a hospital's clinical staff
 * may hear. The live topic probes are tests/rls/workspace-realtime.test.ts.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const sql = read("supabase/migrations/0069_doctor_workspace.sql");
const code = sql.replace(/--.*$/gm, "");

const actionsOf = (src: string) => {
  const block = src.slice(src.lastIndexOf("sa_audit_log_action_check CHECK ("));
  const list = block.slice(block.indexOf("action IN ("), block.indexOf(")\n  );"));
  return [...list.replace(/--.*$/gm, "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

describe("migration 0069", () => {
  it("is additive: no table, column, row or type is dropped or rewritten", () => {
    expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION|TYPE)\b/i);
    expect(code).not.toMatch(/ALTER\s+TABLE[^;]*\b(ALTER|DROP)\s+COLUMN\b/i);
    expect(code).not.toMatch(/^\s*(DELETE|UPDATE|INSERT|TRUNCATE)\b/im);
    expect(code).not.toMatch(/CREATE\s+TABLE\b/i);
  });

  it("keeps every audit action 0068 allows and adds only retire_assignment", () => {
    const before = actionsOf(read("supabase/migrations/0068_resus_desk_v2.sql"));
    const after = actionsOf(sql);
    expect(before.length).toBeGreaterThan(100);
    expect(after).toEqual([...before, "retire_assignment"]);
  });

  it("broadcasts { kind, at } only — no id, name or clinical field leaves the database", () => {
    const payloads = [...code.matchAll(/jsonb_build_object\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(payloads).toHaveLength(1);
    const keys = [...payloads[0]!.matchAll(/'([a-zA-Z_]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(["kind", "at"]);
    expect(code).toMatch(/'workspace:' \|\| NEW\.hospital_id::text/);
    // A realtime failure never blocks the clinical write that fired it.
    expect(code).toMatch(/EXCEPTION WHEN OTHERS THEN\s+NULL;/);
    expect(code).toMatch(/SET search_path = ''/);
  });

  it("fires on the three tables that decide a lane, for the columns that move a row", () => {
    for (const table of ["patient_intakes", "triage_records", "encounters"]) {
      expect(code, table).toMatch(
        new RegExp(`CREATE TRIGGER workspace_broadcast[\\s\\S]*?ON public\\.${table}\\b`),
      );
    }
    expect(code).toMatch(/UPDATE OF state, clinician_user_id, triage_record_id, ended_at/);
    expect(code).toMatch(/UPDATE OF status, triage_level, receiving_department_id, routed_to/);
  });

  it("lets only active clinical staff of the hospital hear its topic, and skips without realtime", () => {
    expect(code).toMatch(/to_regclass\('realtime\.messages'\) IS NOT NULL/);
    expect(code).toMatch(/FOR SELECT TO authenticated/);
    expect(code).toMatch(/LIKE 'workspace:%'/);
    // "workspace:" is ten characters: the id starts at the eleventh.
    expect("workspace:".length + 1).toBe(11);
    expect(code).toMatch(/substring\(\(SELECT realtime\.topic\(\)\) FROM 11\)/);
    expect(code).toMatch(/public\.is_active_clinical_staff\(h\.id\)/);
  });
});
