import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitDeskClaim } from "@/app/signup/patient/actions";
import { PATIENT_CLAIM } from "@/content/desk-register";
import { deskClaimSchema } from "@/lib/onboarding/schemas";
import {
  claimCodeIndexInput,
  formatClaimCode,
  isDeskRecord,
  newClaimCode,
  normalizeClaimCode,
} from "@/supabase/functions/_shared/desk-record";

/**
 * ADR 0475 / migration 0292 — a person takes over the record the desk registered. The SQL rules (wrong, expired,
 * spent and claimed codes, another hospital, the auth.users guard) run for real on the PGlite lane
 * (tests/emr-db/desk-takeover.test.ts, `npm run test:emr-db`). This file holds the code itself, the sign-up action's
 * steps against a stubbed Supabase, and the source-level laws.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/* ─── The code ──────────────────────────────────────────────────── */

describe("the claim code", () => {
  it("is 8 unambiguous characters; case, spaces and dashes do not matter", () => {
    for (let i = 0; i < 200; i++) {
      const code = newClaimCode();
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
      expect(normalizeClaimCode(formatClaimCode(code).toLowerCase())).toBe(code);
    }
    expect(normalizeClaimCode(" abcd efgh ")).toBe("ABCDEFGH");
    expect(normalizeClaimCode("ABCD-EFG0")).toBeNull(); // 0 is never issued
    expect(normalizeClaimCode("ABCDEFG")).toBeNull();
    expect(claimCodeIndexInput("ABCDEFGH")).not.toBe("ABCDEFGH"); // never a phone's blind index
  });

  it("the claim form asks the phone, the code and a sign-in — not the record's details again", () => {
    const ok = deskClaimSchema.safeParse({
      phone: "0772 123 456",
      claimCode: "abcd-efgh",
      email: "amina@example.org",
      password: "the river at kampala is wide",
      consent: true,
      consentVersion: "v1",
      consentSha: "a".repeat(64),
    });
    expect(ok.success).toBe(true);
    const bad = deskClaimSchema.safeParse({ phone: "0772 123 456", claimCode: "nope" });
    expect(bad.success).toBe(false);
  });

  it("a desk record is known by its flag or its undeliverable address", () => {
    expect(isDeskRecord({ app_metadata: { desk_registered: true } })).toBe(true);
    expect(isDeskRecord({ email: "desk-1@Patients.Medsync.invalid" })).toBe(true);
    expect(
      isDeskRecord({ email: "amina@example.org", app_metadata: { desk_registered: false } }),
    ).toBe(false);
  });
});

/* ─── Sign-up takes the record over ─────────────────────────────── */

const sb = vi.hoisted(() => ({
  begin: { outcome: "ok", user_id: "desk-user" } as { outcome: string; user_id: string | null },
  updateError: null as { code?: string; message: string } | null,
  finishErrors: [] as ({ message: string } | null)[],
  signInError: null as { message: string } | null,
  calls: [] as unknown[][],
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/encryption", () => ({
  blindIndex: (v: string) => `bi:${v}`,
  encrypt: (v: string) => v,
}));
vi.mock("@/lib/onboarding/rate-limit", () => ({ allow: async () => true }));
vi.mock("@/lib/onboarding/submit", () => ({
  // The real one also checks the legal gate, the password list and the notice hash.
  validateSignup: async (
    schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } },
    input: unknown,
    key: string,
  ) => {
    const p = schema.safeParse(input);
    return p.success ? { data: p.data, key } : { result: { ok: false, fieldErrors: { _: "x" } } };
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: unknown) => {
      sb.calls.push([name, args]);
      if (name === "desk_claim_begin") return { data: [sb.begin], error: null };
      return { data: "MS-2026-00012", error: sb.finishErrors.shift() ?? null };
    },
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: unknown) => {
          sb.calls.push(["updateUserById", id, attrs]);
          return { error: sb.updateError };
        },
      },
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  slotForSignIn: async () => 2,
  setActiveAccount: async (slot: number) => void sb.calls.push(["setActiveAccount", slot]),
  createClient: async () => ({
    auth: {
      signInWithPassword: async (creds: unknown) => {
        sb.calls.push(["signIn", creds]);
        return { error: sb.signInError };
      },
    },
  }),
}));

const INPUT = {
  phone: "0772 123 456",
  claimCode: "abcd-efgh",
  email: "amina@example.org",
  password: "the river at kampala is wide",
  consent: true,
  consentVersion: "v1",
  consentSha: "a".repeat(64),
};
const KEY = "0b7f3c1e-0c1a-4d7e-9a55-2f1f8a3b9c10";
const called = (name: string) => sb.calls.filter((c) => c[0] === name);

beforeEach(() => {
  Object.assign(sb, {
    begin: { outcome: "ok", user_id: "desk-user" },
    updateError: null,
    finishErrors: [],
    signInError: null,
    calls: [],
  });
});

describe("taking over at sign-up", () => {
  it("checks the phone and the code by their blind indexes, then gives THAT record the sign-in", async () => {
    const r = await submitDeskClaim(INPUT, KEY);
    expect(r).toEqual({ ok: true, next: "/patient/profile?welcome=1", uploads: [] });
    expect(called("desk_claim_begin")[0]![1]).toEqual({
      p_phone_hmac: "bi:+256772123456",
      p_code_hash: "bi:desk-claim:ABCDEFGH",
    });
    const [, id, attrs] = called("updateUserById")[0]!;
    expect(id).toBe("desk-user"); // the desk's record, not a new account
    expect(attrs).toMatchObject({
      email: "amina@example.org",
      password: INPUT.password,
      app_metadata: { desk_registered: false },
    });
    expect(called("desk_claim_finish")[0]![1]).toMatchObject({
      p_user_id: "desk-user",
      p_email: "amina@example.org",
      p_consent_version: "v1",
    });
    expect(called("setActiveAccount")).toEqual([["setActiveAccount", 2]]);
    // Order: begin → credential → finish → sign-in.
    expect(sb.calls.map((c) => c[0])).toEqual([
      "desk_claim_begin",
      "updateUserById",
      "desk_claim_finish",
      "signIn",
      "setActiveAccount",
    ]);
  });

  it.each([
    ["wrong_code", PATIENT_CLAIM.errors.wrong_code],
    ["expired", PATIENT_CLAIM.errors.expired],
    ["too_many_tries", PATIENT_CLAIM.errors.too_many_tries],
    ["already_claimed", PATIENT_CLAIM.errors.already_claimed],
  ])("a %s code changes nothing and says why", async (outcome, message) => {
    sb.begin = { outcome, user_id: null };
    const r = await submitDeskClaim(INPUT, KEY);
    expect(r).toMatchObject({ ok: false, fieldErrors: { claimCode: message } });
    if (outcome !== "already_claimed")
      expect(r).toMatchObject({ formError: PATIENT_CLAIM.errors.later }); // the way to finish later
    expect(called("updateUserById")).toHaveLength(0);
    expect(called("desk_claim_finish")).toHaveLength(0);
  });

  it("an email another account uses is refused on the email; the code stays unused", async () => {
    sb.updateError = {
      code: "email_exists",
      message: "A user with this email address has already been registered",
    };
    const r = await submitDeskClaim(INPUT, KEY);
    expect(r).toEqual({ ok: false, fieldErrors: { email: PATIENT_CLAIM.errors.emailTaken } });
    expect(called("desk_claim_finish")).toHaveLength(0);
  });

  it("retries the finish once (its audit row), and still lets the person in", async () => {
    sb.finishErrors = [{ message: "timeout" }];
    expect((await submitDeskClaim(INPUT, KEY)).ok).toBe(true);
    expect(called("desk_claim_finish")).toHaveLength(2);
  });

  it("a malformed code is refused before anything is asked", async () => {
    const r = await submitDeskClaim({ ...INPUT, claimCode: "1234" }, KEY);
    expect(r.ok).toBe(false);
    expect(sb.calls).toHaveLength(0);
  });
});

/* ─── Laws a reviewer would grep for ────────────────────────────── */

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("ha-register-patient gives a code", () => {
  const src = strip(read("supabase/functions/ha-register-patient/index.ts"));
  const fn = src.slice(src.indexOf("async function giveClaimCode"));

  it("authenticates with the MFA check and the hospital before any service-role work", () => {
    const at = (s: string) => fn.indexOf(s);
    expect(at("await getCaller(request)")).toBeGreaterThan(-1);
    expect(at("await getCaller(request)")).toBeLessThan(at("authoriseAtHospital(caller.id"));
    expect(at("authoriseAtHospital(caller.id")).toBeLessThan(at("serviceClient()"));
  });

  it("stores only the code's blind index", () => {
    expect(fn).toContain("p_code_hash: await blindIndex(claimCodeIndexInput(code), key)");
    expect(fn).not.toMatch(/p_code\s*:/);
  });
});

describe("migration 0292", () => {
  const sql = read("supabase/migrations/0292_desk_record_takeover.sql");
  const actions = (text: string) => {
    const block = text.slice(text.lastIndexOf("sa_audit_log_action_check CHECK"));
    return new Set([...block.slice(0, block.indexOf(");")).matchAll(/'(\w+)'/g)].map((m) => m[1]));
  };

  it("keeps every audit verb 0291 allowed and adds the two", () => {
    const before = actions(read("supabase/migrations/0291_desk_registered_patients.sql"));
    const after = actions(sql);
    for (const a of before) expect(after.has(a), a).toBe(true);
    expect(after.has("issue_claim_code")).toBe(true);
    expect(after.has("claim_desk_record")).toBe(true);
    const union = read("supabase/functions/_shared/sa-audit.ts");
    expect(union).toContain('| "issue_claim_code"');
    expect(union).toContain('| "claim_desk_record"');
  });

  it("grants the claim functions to the service role only, and guards auth.users", () => {
    for (const fn of ["desk_issue_claim_code", "desk_claim_begin", "desk_claim_finish"]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${fn}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([\\s\\S]*?TO service_role;`),
      );
    }
    expect(sql).toContain("BEFORE UPDATE ON auth.users");
    expect(sql).toContain("ALTER TABLE public.desk_claim_codes ENABLE ROW LEVEL SECURITY");
  });
});
