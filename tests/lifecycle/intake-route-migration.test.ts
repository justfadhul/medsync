import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR 0101 — migration 0067 is written as agreed: owner-gated, purely
 * additive, NULL meaning the legacy triage route, and mirrored in Drizzle so
 * the web and the database cannot disagree about the column.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const sql = read("supabase/migrations/0067_intake_route.sql");
const schema = read("db/schema/patient-intakes.ts");

describe("migration 0067 — patient_intakes.routed_to", () => {
  it("is gated for the owner and applied after 0066", () => {
    expect(sql).toMatch(/GATED — DO NOT APPLY TO PRODUCTION WITHOUT EXPLICIT, NAMED OWNER/);
    expect(sql).toMatch(/AFTER 0066/);
  });

  it("adds a nullable column closed to triage | clinic, and rewrites nothing", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS routed_to text;/);
    expect(sql).toMatch(/CHECK \(routed_to IS NULL OR routed_to IN \('triage', 'clinic'\)\)/);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|NOT NULL/);
  });

  it("is mirrored in the Drizzle schema with the same CHECK", () => {
    expect(schema).toMatch(/routedTo: text\("routed_to"\)/);
    expect(schema).toMatch(/intakes_routed_to_check/);
  });
});
