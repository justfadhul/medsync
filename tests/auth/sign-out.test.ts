import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/sign-out/route";

/**
 * Signing out ends this device's session only. supabase-js defaults to the
 * "global" scope, which revoked every session the user held: a clinician who
 * signed out of a shared ward PC was signed out of their phone too.
 */

const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const accounts = vi.hoisted(() => ({
  list: [] as { slot: number; email: string; active: boolean }[],
}));
const setActiveAccount = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut } }),
  listAccounts: async () => accounts.list,
  setActiveAccount,
}));

describe("sign-out scope", () => {
  it("web: POST /sign-out signs this browser out, then goes to /sign-in", async () => {
    const res = await POST(new Request("https://medsync.test/sign-out", { method: "POST" }));
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
  });

  it("web: another account signed in here takes over, and the user picks on /accounts", async () => {
    accounts.list = [
      { slot: 0, email: "a@medsync.test", active: true },
      { slot: 2, email: "b@medsync.test", active: false },
    ];
    const res = await POST(new Request("https://medsync.test/sign-out", { method: "POST" }));
    expect(setActiveAccount).toHaveBeenCalledWith(2);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/accounts");
    accounts.list = [];
  });

  it("web: nothing links to /sign-out — a GET answers 405, so it is always a form POST", () => {
    const linked = ["app", "components"].flatMap((dir) =>
      readdirSync(resolve(process.cwd(), dir), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `${dir}/${f}`)
        .filter((f) => /href="\/sign-out"|<Link href="\/sign-out"/.test(readFileSync(f, "utf8"))),
    );
    expect(linked).toEqual([]);
  });

  it("phone: the app signs this phone out, not the patient's web session", () => {
    const src = readFileSync(resolve(process.cwd(), "mobile/src/lib/session.tsx"), "utf8");
    expect(src).toMatch(/supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
    expect(src).not.toMatch(/supabase\.auth\.signOut\(\)/);
  });
});
