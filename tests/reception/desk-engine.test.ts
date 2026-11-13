/**
 * Reception desk engine (Step 2): the second identifier (ADR 0486), S3 nothing secret logged, S2 replay in
 * ha-check-in-patient, and the desk's lateness permission (D-RD-11). The SQL side is tests/emr-db/reception-desk.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { identityMatches, nextIdentityStep } from "@/supabase/functions/_shared/desk-identity";

const src = (p: string) => readFileSync(p, "utf8");

describe("second identifier", () => {
  const known = { dateOfBirth: "1990-04-12", phone: "+256 772 123 233" };

  it("year of birth matches the four digits only", () => {
    expect(identityMatches("yob", "1990", known)).toBe(true);
    expect(identityMatches("yob", " 1990 ", known)).toBe(true);
    expect(identityMatches("yob", "1991", known)).toBe(false);
    expect(identityMatches("yob", "90", known)).toBe(false);
    expect(identityMatches("yob", "1990", { dateOfBirth: null, phone: null })).toBe(false);
  });

  it("last 3 phone digits match the end of the number", () => {
    expect(identityMatches("phone3", "233", known)).toBe(true);
    expect(identityMatches("phone3", "232", known)).toBe(false);
    expect(identityMatches("phone3", "2233", known)).toBe(false);
    expect(identityMatches("phone3", "233", { dateOfBirth: null, phone: null })).toBe(false);
  });

  it("asks year, then phone, then stops (S8)", () => {
    expect(nextIdentityStep([])).toBe("yob");
    expect(nextIdentityStep([{ method: "yob", matched: false }])).toBe("phone3");
    expect(
      nextIdentityStep([
        { method: "yob", matched: false },
        { method: "phone3", matched: false },
      ]),
    ).toBeNull();
    expect(nextIdentityStep([{ method: "yob", matched: true }])).toBe("done");
  });
});

describe("S3: nothing secret leaves the desk function", () => {
  const fn = src("supabase/functions/ha-reception-desk/index.ts");

  it("never logs, audits or returns the answer or the PIN", () => {
    for (const line of fn.split("\n")) {
      if (/log\.|afterData|beforeData|reason:|ok\(/.test(line)) {
        expect(line).not.toMatch(/input\.answer|input\.pin|\bphone\b(?!3)/);
      }
    }
    expect(fn).not.toMatch(/parsed\.error/); // a bad body is not echoed back
  });

  it("stores method and result only", () => {
    const insert = fn.slice(fn.indexOf('from("desk_identity_attempts").insert'));
    expect(insert.slice(0, insert.indexOf("});"))).not.toMatch(/answer/);
  });
});

describe("S2: check-in replay by client id", () => {
  const fn = src("supabase/functions/ha-check-in-patient/index.ts");

  it("looks the client id up before any write and returns the first result", () => {
    const lookup = fn.indexOf('.eq("client_id", input.client_id)');
    expect(lookup).toBeGreaterThan(0);
    expect(lookup).toBeLessThan(fn.indexOf('.update({ status: "arrived" })'));
    expect(fn).toContain("replayed: true");
  });

  it("the desk path needs a matched identity first (RD5)", () => {
    expect(fn).toContain('.from("desk_identity_attempts")');
    expect(fn).toContain('"Check it is them before checking in."');
  });
});

describe("D-RD-11: the desk may mark running late, not cancel a day", () => {
  it("ha-set-session-delay accepts reception; ha-cancel-session does not", () => {
    expect(src("supabase/functions/ha-set-session-delay/index.ts")).toContain(
      "isReceptionAt(caller.id",
    );
    expect(src("supabase/functions/ha-cancel-session/index.ts")).not.toContain("isReceptionAt");
  });
});
