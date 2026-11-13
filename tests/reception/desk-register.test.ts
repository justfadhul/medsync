import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { UNDER_18 } from "@/lib/onboarding/fields";
import { deskPatientSchema } from "@/lib/onboarding/schemas";
import {
  BASIS_SAME_NAME_YEAR,
  BASIS_SAME_PHONE,
  deskMatches,
} from "@/supabase/functions/_shared/identity-match";

/**
 * ADR 0475 — a walk-in registered at the desk. The SQL rules run for real on the PGlite lane
 * (tests/emr-db/desk-register.test.ts); this file holds the duplicate check's matching, the shared form rules, and
 * the source-level laws of `ha-register-patient`.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/* ─── The duplicate check ───────────────────────────────────────── */

/** "enc:" + plaintext stands in for ciphertext; anything else cannot be decrypted. */
const decrypt = async (c: string) => {
  if (!c.startsWith("enc:")) throw new Error("bad payload");
  return c.slice(4);
};
const row = (o: {
  id: string;
  first: string;
  surname: string;
  dob: string;
  phone?: string;
  hmac: string | null;
}) => ({
  patient_user_id: o.id,
  patient_code: `MS-2026-${o.id}`,
  sex: "female",
  date_of_birth: o.dob,
  first_name_encrypted: o.first,
  surname_encrypted: o.surname,
  phone_encrypted: `enc:${o.phone ?? "+256700000000"}`,
  phone_hmac: o.hmac,
});
const declared = {
  name: "Sarah Nakato",
  phone: "+256772123456",
  phoneHmac: "hmac-mine",
  dateOfBirth: "1980-05-01",
};

describe("deskMatches — the desk's duplicate check", () => {
  it("names the basis in words: same phone; same name and year of birth", async () => {
    const out = await deskMatches(
      declared,
      [
        row({
          id: "1",
          first: "enc:Agnes",
          surname: "enc:Auma",
          dob: "1955-01-01",
          hmac: "hmac-mine",
        }),
        // Any order and case of the same two names, born the same year (day and month typed wrong).
        row({
          id: "2",
          first: "enc:nakato",
          surname: "enc:SARAH",
          dob: "1980-11-30",
          hmac: "other",
        }),
        row({
          id: "3",
          first: "enc:Sarah",
          surname: "enc:Nakato",
          dob: "1980-05-01",
          hmac: "hmac-mine",
        }),
      ],
      decrypt,
    );
    expect(out.map((m) => [m.patientUserId, m.basis])).toEqual([
      ["1", [BASIS_SAME_PHONE]],
      ["2", [BASIS_SAME_NAME_YEAR]],
      ["3", [BASIS_SAME_PHONE, BASIS_SAME_NAME_YEAR]],
    ]);
    expect(out[0]).toMatchObject({ displayName: "Agnes Auma", patientCode: "MS-2026-1" });
  });

  it("leaves out a different person: other phone, other name or other year", async () => {
    const out = await deskMatches(
      declared,
      [
        row({ id: "4", first: "enc:Sarah", surname: "enc:Nakato", dob: "1981-05-01", hmac: "x" }),
        row({ id: "5", first: "enc:Sarah", surname: "enc:Namuli", dob: "1980-05-01", hmac: "x" }),
      ],
      decrypt,
    );
    expect(out).toEqual([]);
  });

  it("decrypts the phone only for a row written before the blind index", async () => {
    const out = await deskMatches(
      declared,
      [
        row({
          id: "6",
          first: "enc:Ann",
          surname: "enc:Apio",
          dob: "1990-01-01",
          phone: declared.phone,
          hmac: null,
        }),
        row({
          id: "7",
          first: "enc:Ann",
          surname: "enc:Apio",
          dob: "1990-01-01",
          phone: declared.phone,
          hmac: "rotated",
        }),
      ],
      decrypt,
    );
    expect(out.map((m) => m.patientUserId)).toEqual(["6"]);
  });

  it("skips a row it cannot decrypt instead of guessing", async () => {
    const out = await deskMatches(
      declared,
      [
        row({
          id: "8",
          first: "garbled",
          surname: "enc:Nakato",
          dob: "1980-05-01",
          hmac: "hmac-mine",
        }),
      ],
      decrypt,
    );
    expect(out).toEqual([]);
  });
});

/* ─── The form: sign-up's rules, no sign-in ─────────────────────── */

const valid = {
  firstName: "Sarah",
  surname: "Nakato",
  sex: "female",
  dobDay: "1",
  dobMonth: "5",
  dobYear: "1980",
  phone: "0772 123 456",
  place: "UG102",
  consent: true,
  consentVersion: "1.0.0",
  consentSha: "a".repeat(64),
};

describe("deskPatientSchema — sign-up's questions without the sign-in", () => {
  it("accepts an adult with sign-up's fields and the notice ticked", () => {
    expect(deskPatientSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a child, a landline and an unticked notice, as sign-up does", () => {
    const year = String(new Date().getFullYear() - 10);
    const child = deskPatientSchema.safeParse({ ...valid, dobYear: year });
    expect(child.success).toBe(false);
    expect(child.error?.issues.map((i) => i.message)).toContain(UNDER_18);
    expect(deskPatientSchema.safeParse({ ...valid, phone: "0414 123 456" }).success).toBe(false);
    expect(deskPatientSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
  });

  it("asks for no email and no password", () => {
    const keys = Object.keys(deskPatientSchema.def.shape);
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("password");
  });
});

/* ─── ha-register-patient: the laws a reviewer would grep for ───── */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("ha-register-patient", () => {
  const src = strip(read("supabase/functions/ha-register-patient/index.ts"));
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    expect(i, needle).toBeGreaterThan(-1);
    return i;
  };

  it("authenticates with the MFA check and the desk's hospital before any service-role work", () => {
    expect(at("await getCaller(request)")).toBeLessThan(at("authoriseAtHospital(caller.id"));
    expect(at("authoriseAtHospital(caller.id")).toBeLessThan(at("serviceClient()"));
  });

  it("runs the duplicate check before it creates anything", () => {
    expect(at('rpc("desk_patient_candidates"')).toBeLessThan(at("auth.admin.createUser"));
    expect(at('outcome: "matches"')).toBeLessThan(at("auth.admin.createUser"));
  });

  it("creates a login no one can use: no password, no phone, an undeliverable address", () => {
    const create = src.slice(at("auth.admin.createUser"), at('rpc("desk_register_patient"'));
    expect(create).not.toMatch(/password|phone:/);
    expect(src).toContain('"patients.medsync.invalid"');
    expect(create).toContain("desk_registered: true");
  });

  it("removes the login again when the record is not written", () => {
    const after = src.slice(at('rpc("desk_register_patient"'));
    expect(after).toContain("auth.admin.deleteUser(userId)");
  });

  it("is the only function that registers a patient at the desk", () => {
    const fns = resolve(ROOT, "supabase/functions");
    for (const p of walk(fns)) {
      if (p.endsWith("ha-register-patient/index.ts")) continue;
      expect(readFileSync(p, "utf8"), p).not.toContain("desk_register_patient");
    }
  });
});

describe("migration 0291", () => {
  const actions = (sql: string) => {
    const block = sql.slice(sql.lastIndexOf("sa_audit_log_action_check CHECK"));
    return new Set([...block.slice(0, block.indexOf(");")).matchAll(/'(\w+)'/g)].map((m) => m[1]));
  };

  it("keeps every audit verb 0091 allowed and adds register_patient", () => {
    const before = actions(read("supabase/migrations/0091_encounter_closure.sql"));
    const after = actions(read("supabase/migrations/0291_desk_registered_patients.sql"));
    expect(before.size).toBeGreaterThan(100);
    for (const a of before) expect(after.has(a), a).toBe(true);
    expect(after.has("register_patient")).toBe(true);
    expect(read("supabase/functions/_shared/sa-audit.ts")).toContain('| "register_patient"');
  });

  it("grants the register functions to the service role only", () => {
    const sql = read("supabase/migrations/0291_desk_registered_patients.sql");
    for (const fn of ["desk_can_register", "desk_patient_candidates", "desk_register_patient"]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${fn}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([\\s\\S]*?TO service_role;`),
      );
    }
  });
});
