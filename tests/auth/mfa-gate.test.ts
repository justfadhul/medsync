import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

/**
 * Probe (landing S6 Gate 0, "clinical staff sign in with two factors"). Nothing
 * tested the AAL2 gate itself: tests/auth/auth-flow.test.ts only reads a fresh
 * user's AAL from a live database. This drives proxy.ts with the session and
 * the auth state stubbed, so it needs no database and runs in CI.
 */

const auth = vi.hoisted(() => ({
  userId: null as string | null,
  /** What updateSession wrote back — a rotated refresh token, or null for none. */
  cookie: null as string | null,
  state: {
    user: {},
    roles: [] as string[],
    mfaRequired: false,
    aal: "aal1" as "aal1" | "aal2" | null,
    nextAal: "aal1" as "aal1" | "aal2" | null,
  },
}));

vi.mock("@/lib/supabase/proxy", async () => {
  const { NextResponse } = await import("next/server");
  return {
    updateSession: async () => {
      const response = NextResponse.next();
      if (auth.cookie !== null)
        response.cookies.set("sb-medsync-auth-token", auth.cookie, { path: "/" });
      return { response, userId: auth.userId };
    },
  };
});
vi.mock("@/lib/auth", () => ({ getAuthState: async () => auth.state }));

function session(s: Partial<typeof auth.state>) {
  auth.userId = "user-1";
  auth.state = { ...auth.state, ...s };
}

async function redirectOf(path: string): Promise<URL | null> {
  const res = await proxy(new NextRequest(new URL(path, "https://medsync.test")));
  const location = res.headers.get("location");
  return location ? new URL(location) : null;
}

const GATED = ["/clinician", "/hospital-admin/staff", "/admin", "/lab"];

beforeEach(() => {
  auth.userId = null;
  auth.cookie = null;
  auth.state = { user: {}, roles: [], mfaRequired: false, aal: "aal1", nextAal: "aal1" };
});

describe("proxy.ts — the AAL2 gate", () => {
  it.each(GATED)(
    "%s: a clinical session without the second factor is sent to /sign-in/mfa",
    async (path) => {
      session({ roles: ["clinician"], mfaRequired: true, aal: "aal1", nextAal: "aal2" });
      const to = await redirectOf(path);
      expect(to?.pathname).toBe("/sign-in/mfa");
      expect(to?.searchParams.get("redirect")).toBe(path);
    },
  );

  it.each(GATED)("%s: a clinical role with no MFA enrolled is sent to enrol", async (path) => {
    session({ roles: ["nurse"], mfaRequired: true, aal: "aal1", nextAal: "aal1" });
    expect((await redirectOf(path))?.pathname).toBe("/onboarding/mfa-setup");
  });

  it("a clinical session that passed the second factor goes through", async () => {
    session({ roles: ["clinician"], mfaRequired: true, aal: "aal2", nextAal: "aal2" });
    expect(await redirectOf("/clinician")).toBeNull();
  });

  it("no session is sent to sign in", async () => {
    expect((await redirectOf("/clinician"))?.pathname).toBe("/sign-in");
  });
});

describe("proxy.ts — a redirect keeps the session it just refreshed", () => {
  // Dropping the rotated refresh token leaves the browser a spent one: the next
  // refresh is refused and the session ends early.
  it.each([
    ["sign-in (the refresh cleared it)", null, "/sign-in"],
    ["the second factor", { mfaRequired: true, aal: "aal1", nextAal: "aal2" }, "/sign-in/mfa"],
    ["MFA enrolment", { mfaRequired: true, aal: "aal1", nextAal: "aal1" }, "/onboarding/mfa-setup"],
  ] as const)("on the way to %s", async (_, state, to) => {
    if (state) session({ roles: ["clinician"], ...state });
    auth.cookie = state ? "rotated" : "";
    const res = await proxy(new NextRequest(new URL("/clinician", "https://medsync.test")));
    expect(new URL(res.headers.get("location")!).pathname).toBe(to);
    expect(res.cookies.get("sb-medsync-auth-token")?.value).toBe(auth.cookie);
  });
});

describe("the workspaces proxy.ts does not list refuse an AAL1 session themselves", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it.each(["doctor", "nurse", "reception", "clinician"])("lib/%s/scope.ts", (area) => {
    expect(read(`lib/${area}/scope.ts`)).toMatch(
      /if \(state\.aal !== "aal2"\) redirect\("\/sign-in\/mfa\?redirect=\//,
    );
  });

  it("every clinical and admin role must enrol MFA", () => {
    const roles = read("lib/auth.ts").match(
      /MFA_REQUIRED_ROLES = new Set<string>\(\[([^\]]*)\]/,
    )?.[1];
    for (const r of [
      "clinician",
      "nurse",
      "pharmacist",
      "lab_tech",
      "hospital_admin",
      "superadmin",
    ]) {
      expect(roles).toContain(`"${r}"`);
    }
  });
});
