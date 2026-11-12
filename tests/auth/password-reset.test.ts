import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmLinkAction,
  requestResetAction,
  setNewPasswordAction,
} from "@/app/(auth)/forgot-password/actions";
import {
  CONFIRM_PATH,
  EXPIRED_PATH,
  linkProof,
  MFA_PATH,
  needsMfa,
  NEW_PATH,
  newPasswordProblem,
  SIGN_IN_AFTER,
  updateRefusal,
  verifierSlot,
} from "@/app/(auth)/forgot-password/flow";
import { NEW_PASSWORD, RESET } from "@/content/auth";
import { authCookieName } from "@/lib/supabase/accounts";

/**
 * Password reset (/forgot-password): ask for a link → Continue on the link's page → staff with an
 * authenticator pass it → choose a password → every session ends, sign in again.
 */

vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" } }));

const jar = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://medsync.test" }),
  cookies: async () => ({ getAll: () => jar.cookies }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

type Err = { code?: string; status?: number; message: string } | null;
const sb = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  aal: { currentLevel: "aal1", nextLevel: "aal1" } as { currentLevel: string; nextLevel: string },
  resetError: null as Err,
  verifyError: null as Err,
  updateError: null as Err,
  calls: [] as unknown[][],
  slots: [] as (number | undefined)[],
}));
const setActiveAccount = vi.hoisted(() => vi.fn(async (_slot: number) => {}));
const slotForSignIn = vi.hoisted(() => vi.fn(async (_email: string) => 1));
vi.mock("@/lib/supabase/server", () => ({
  setActiveAccount,
  slotForSignIn,
  createClient: async (slot?: number) => {
    sb.slots.push(slot);
    const call =
      (name: string, result: unknown) =>
      async (...args: unknown[]) => {
        sb.calls.push([name, ...args]);
        return result;
      };
    return {
      auth: {
        getUser: async () => ({ data: { user: sb.user } }),
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: sb.aal }) },
        resetPasswordForEmail: call("resetPasswordForEmail", { error: sb.resetError }),
        verifyOtp: call("verifyOtp", { error: sb.verifyError }),
        exchangeCodeForSession: call("exchangeCodeForSession", { error: sb.verifyError }),
        updateUser: call("updateUser", { error: sb.updateError }),
        signOut: call("signOut", { error: null }),
      },
    };
  },
}));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const redirectOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => e.message.replace(/^REDIRECT /, ""),
  );
const called = (name: string) => sb.calls.filter((c) => c[0] === name);

const GOOD = "the river at kampala is wide";

beforeEach(() => {
  Object.assign(sb, {
    user: { id: "u1", email: "nurse.akello@clinic.test" },
    aal: { currentLevel: "aal1", nextLevel: "aal1" },
    resetError: null,
    verifyError: null,
    updateError: null,
    calls: [],
    slots: [],
  });
  jar.cookies = [];
  setActiveAccount.mockClear();
});

describe("the link", () => {
  it("reads a token hash (recovery only) or a PKCE code; anything else is no link", () => {
    const get = (q: string) => {
      const p = new URLSearchParams(q);
      return (n: string) => p.get(n);
    };
    expect(linkProof(get("token_hash=abc&type=recovery"))).toEqual({ tokenHash: "abc" });
    expect(linkProof(get("token_hash=abc&type=signup"))).toBeNull();
    expect(linkProof(get("code=xyz"))).toEqual({ code: "xyz" });
    expect(linkProof(get("error=access_denied&error_code=otp_expired"))).toBeNull();
    expect(linkProof(() => ["a", "b"])).toBeNull();
  });

  it("finds the slot that holds the PKCE verifier", () => {
    expect(verifierSlot([{ name: `${authCookieName(2)}-code-verifier` }])).toBe(2);
    expect(verifierSlot([{ name: `${authCookieName(0)}-code-verifier.0` }])).toBe(0);
    expect(verifierSlot([{ name: authCookieName(1) }])).toBeNull();
  });
});

describe("asking for a link", () => {
  it("sends the link to the confirm page on this site", async () => {
    const state = await requestResetAction({}, form({ email: " nurse.akello@clinic.test " }));
    expect(state).toEqual({ sentTo: "nurse.akello@clinic.test" });
    expect(called("resetPasswordForEmail")[0]).toEqual([
      "resetPasswordForEmail",
      "nurse.akello@clinic.test",
      { redirectTo: `https://medsync.test${CONFIRM_PATH}` },
    ]);
    expect(slotForSignIn).toHaveBeenCalledWith("nurse.akello@clinic.test");
  });

  it("answers the same whether or not the email has an account, rate limits included", async () => {
    const outcomes: Err[] = [
      null, // unknown email: Supabase says success
      { code: "over_email_send_rate_limit", status: 429, message: "x" },
      { code: "over_request_rate_limit", status: 429, message: "x" },
      { code: "email_address_not_authorized", status: 400, message: "x" },
      { status: 500, message: "Error sending recovery email" },
    ];
    for (const error of outcomes) {
      sb.resetError = error;
      expect(await requestResetAction({}, form({ email: "a@clinic.test" }))).toEqual({
        sentTo: "a@clinic.test",
      });
    }
  });

  it("a desk-registered record's address gets the same answer, and no link is asked for (ADR 0475)", async () => {
    const email = "desk-4f1c@patients.medsync.invalid";
    expect(await requestResetAction({}, form({ email }))).toEqual({ sentTo: email });
    expect(called("resetPasswordForEmail")).toHaveLength(0);
  });

  it("refuses a malformed email before asking Supabase", async () => {
    expect(await requestResetAction({}, form({ email: "not-an-email" }))).toEqual({
      errors: { email: RESET.errors.email },
    });
    expect(called("resetPasswordForEmail")).toHaveLength(0);
  });
});

describe("Continue on the link's page", () => {
  it("a token hash opens the session in a free slot, makes it active, then the new-password page", async () => {
    const to = await redirectOf(
      confirmLinkAction(null, form({ token_hash: "abc", type: "recovery" })),
    );
    expect(to).toBe(NEW_PATH);
    expect(called("verifyOtp")[0]).toEqual(["verifyOtp", { type: "recovery", token_hash: "abc" }]);
    expect(sb.slots).toEqual([1]);
    expect(setActiveAccount).toHaveBeenCalledWith(1);
  });

  it("a PKCE code is exchanged in the slot holding its verifier", async () => {
    jar.cookies = [{ name: `${authCookieName(3)}-code-verifier`, value: "v" }];
    expect(await redirectOf(confirmLinkAction(null, form({ code: "xyz" })))).toBe(NEW_PATH);
    expect(called("exchangeCodeForSession")[0]).toEqual(["exchangeCodeForSession", "xyz"]);
    expect(sb.slots).toEqual([3]);
  });

  it("a used, expired or missing link goes back with the notice and opens nothing", async () => {
    sb.verifyError = { code: "otp_expired", status: 403, message: "x" };
    expect(
      await redirectOf(confirmLinkAction(null, form({ token_hash: "abc", type: "recovery" }))),
    ).toBe(EXPIRED_PATH);
    expect(await redirectOf(confirmLinkAction(null, form({})))).toBe(EXPIRED_PATH);
    expect(setActiveAccount).not.toHaveBeenCalled();
  });
});

describe("choosing the password", () => {
  const submit = (password = GOOD, confirm = password) =>
    redirectOf(setNewPasswordAction({}, form({ password, confirm })));

  it("an account with an authenticator passes it first; the password is not touched", async () => {
    sb.aal = { currentLevel: "aal1", nextLevel: "aal2" };
    expect(await submit()).toBe(MFA_PATH);
    expect(called("updateUser")).toHaveLength(0);
    expect(MFA_PATH).toBe("/sign-in/mfa?redirect=%2Fforgot-password%2Fnew");
  });

  it("Supabase's own aal2 refusal also goes to the code", async () => {
    sb.updateError = { code: "insufficient_aal", status: 403, message: "x" };
    expect(await submit()).toBe(MFA_PATH);
    expect(called("signOut")).toHaveLength(0);
  });

  it("a desk-registered record never gets a password here, even with a session (ADR 0475)", async () => {
    sb.user = { id: "desk", email: "desk-4f1c@patients.medsync.invalid" };
    expect(await submit()).toBe(EXPIRED_PATH);
    expect(called("updateUser")).toHaveLength(0);
  });

  it("no session: back to ask for a link", async () => {
    sb.user = null;
    expect(await submit()).toBe(EXPIRED_PATH);
  });

  it("saves, ends every session, then sign-in", async () => {
    sb.aal = { currentLevel: "aal2", nextLevel: "aal2" };
    expect(await submit()).toBe(SIGN_IN_AFTER);
    expect(called("updateUser")[0]).toEqual(["updateUser", { password: GOOD }]);
    expect(called("signOut")[0]).toEqual(["signOut", { scope: "global" }]);
  });

  it("keeps the sign-up password rules, and the two must match", async () => {
    const email = "nurse.akello@clinic.test";
    expect(newPasswordProblem("short", "short", email)?.password).toMatch(/12 or more/);
    expect(newPasswordProblem("password1234", "password1234", email)?.password).toBeDefined();
    expect(newPasswordProblem("nurse.akello-is-me", "nurse.akello-is-me", email)?.password).toMatch(
      /email/,
    );
    expect(newPasswordProblem(GOOD, `${GOOD}!`, email)).toEqual({
      confirm: NEW_PASSWORD.errors.mismatch,
    });
    expect(newPasswordProblem(GOOD, GOOD, email)).toBeNull();
    const state = await setNewPasswordAction({}, form({ password: GOOD, confirm: "other" }));
    expect(state.errors?.confirm).toBe(NEW_PASSWORD.errors.mismatch);
    expect(called("updateUser")).toHaveLength(0);
  });

  it("Supabase refusals read plainly", () => {
    expect(updateRefusal("same_password")).toEqual({ password: NEW_PASSWORD.errors.same });
    expect(updateRefusal("weak_password")).toEqual({ password: NEW_PASSWORD.errors.weak });
    expect(updateRefusal(undefined)).toEqual({ _form: NEW_PASSWORD.errors.failed });
  });

  it("the gate decides on the account's factors, not its roles", () => {
    expect(needsMfa({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
    expect(needsMfa({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
    expect(needsMfa({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
    expect(needsMfa(null)).toBe(false);
  });
});

describe("proxy", () => {
  it("lists /forgot-password as public and adds nothing else", () => {
    const proxy = readFileSync(resolve(process.cwd(), "proxy.ts"), "utf8");
    const block = proxy.slice(
      proxy.indexOf("const PUBLIC_PREFIXES"),
      proxy.indexOf("const PUBLIC_EXACT"),
    );
    expect(block).toMatch(/"\/forgot-password",/);
    const protectedBlock = proxy.slice(proxy.indexOf("const ALWAYS_AUTH_REQUIRED_PREFIXES"));
    expect(protectedBlock).not.toMatch(/forgot-password/);
  });
});
