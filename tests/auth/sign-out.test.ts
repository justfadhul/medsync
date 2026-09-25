import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/sign-out/route";

/**
 * Signing out ends this device's session only. supabase-js defaults to the
 * "global" scope, which revoked every session the user held: a clinician who
 * signed out of a shared ward PC was signed out of their phone too.
 */

const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signOut } }) }));

describe("sign-out scope", () => {
  it("web: POST /sign-out signs this browser out, then goes to /sign-in", async () => {
    const res = await POST(new Request("https://medsync.test/sign-out", { method: "POST" }));
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
  });

  it("phone: the app signs this phone out, not the patient's web session", () => {
    const src = readFileSync(resolve(process.cwd(), "mobile/src/lib/session.tsx"), "utf8");
    expect(src).toMatch(/supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
    expect(src).not.toMatch(/supabase\.auth\.signOut\(\)/);
  });
});
