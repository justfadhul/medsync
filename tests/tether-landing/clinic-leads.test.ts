import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseLead } from "@/lib/landing/lead";

describe("clinic sign-up input (D-LP-09)", () => {
  it("takes a full address, trimmed and lower-cased", () => {
    expect(parseLead({ email: "  Name@Clinic.UG ", company: "" })).toEqual({
      kind: "ok",
      email: "name@clinic.ug",
    });
  });
  it("refuses a part address", () => {
    for (const email of ["", "name", "name@", "name@clinic", "@clinic.com", "a b@c.com", 7])
      expect(parseLead({ email, company: "" }).kind).toBe("bad");
  });
  it("a filled honeypot is a bot, whatever the email", () => {
    expect(parseLead({ email: "name@clinic.com", company: "Acme" }).kind).toBe("bot");
  });
});

describe("migration 0293 (S17, static until the owner applies it)", () => {
  const sql = readFileSync("supabase/migrations/0293_clinic_leads.sql", "utf8").replace(
    /--.*$/gm,
    "",
  );
  it("forces RLS and gives anon nothing", () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.clinic_leads FROM anon/);
    expect(sql).not.toMatch(/TO\s+anon/i);
    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/i);
  });
  it("stores only the email, the source, a hash and the time", () => {
    const cols = [...sql.matchAll(/^\s{2}([a-z_]+)\s+(uuid|text|timestamptz)/gm)].map((m) => m[1]);
    expect(cols).toEqual(["id", "email", "source", "user_agent_hash", "created_at"]);
  });
  it("the action never logs the email", () => {
    const src = readFileSync("app/tether/actions.ts", "utf8");
    expect(src).not.toMatch(/logger\.\w+\([^)]*email/);
  });
});
