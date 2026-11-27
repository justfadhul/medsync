import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0308_care_request_escalation.sql", "utf8");

describe("migration 0308 (static)", () => {
  it("is GATED", () => {
    expect(sql.startsWith("-- GATED")).toBe(true);
    expect(sql.slice(0, 300)).toMatch(/0308/);
  });

  it("widens the heartbeat source", () => {
    // 0102:151 is the only definition; its two sources are kept verbatim.
    expect(sql).toMatch(
      /DROP CONSTRAINT IF EXISTS escalation_heartbeats_source_check[\s\S]*ADD CONSTRAINT escalation_heartbeats_source_check\s+CHECK \(source IN \('scheduler','lazy','care_requests'\)\)/,
    );
  });

  it("forces RLS, gates MFA and audits the response times", () => {
    expect((sql.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(sql).toMatch(
      /REVOKE ALL ON public\.care_request_response_versions FROM anon, authenticated/,
    );
    expect(sql).toMatch(
      /CREATE POLICY mfa_gate ON public\.care_request_response_versions AS RESTRICTIVE/,
    );
    expect(sql).toMatch(/CREATE TRIGGER audit_care_request_response_versions/);
  });

  it("ships no numbers: nothing is inserted", () => {
    expect(sql).not.toMatch(/INSERT INTO/i);
  });
});
