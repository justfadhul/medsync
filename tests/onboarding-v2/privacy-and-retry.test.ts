import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * LOC-7: a patient's coordinates are used once to find an area, then dropped — never logged,
 * never stored, never sent to a third party. And §5.1: a retried submit (lost response) finds the
 * account it already made instead of failing with "email already in use".
 */

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => undefined }),
}));
const serviceCalls: string[] = [];
const authState = {
  signUp: vi.fn(),
  signIn: vi.fn(),
  usersRow: null as null | { id: string },
  meta: {} as Record<string, unknown>,
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    serviceCalls.push("service");
    return {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: authState.usersRow }) }) }),
      }),
      auth: {
        admin: { getUserById: async () => ({ data: { user: { user_metadata: authState.meta } } }) },
      },
    };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signUp: authState.signUp, signInWithPassword: authState.signIn },
  }),
}));

describe("LOC-7 — patient coordinates", () => {
  beforeEach(() => {
    serviceCalls.length = 0;
  });

  it("resolvePlaceAction logs nothing, stores nothing and calls no one", async () => {
    const { logger } = await import("@/lib/logger");
    const spies = [
      vi.spyOn(logger, "info"),
      vi.spyOn(logger, "warn"),
      vi.spyOn(logger, "error"),
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { resolvePlaceAction } = await import("@/app/signup/_actions/lookup");
    const r = await resolvePlaceAction({ lat: 0.3376, lng: 32.5763, accuracyM: 25 });
    expect(r).toMatchObject({ ok: true, place: { name: "Kawempe Division" } });
    // garbage and far-away points too
    await resolvePlaceAction({ lat: "x", lng: 1 });
    await resolvePlaceAction({ lat: -1.2921, lng: 36.8219, accuracyM: 10 });
    for (const s of spies) {
      const dumped = JSON.stringify(s.mock.calls);
      expect(dumped).not.toMatch(/0\.3376|32\.5763|36\.8219/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(serviceCalls).toEqual([]); // no database write (or read) at all
  });

  it("the logger's PII redaction covers coordinates", async () => {
    const { redactPII } = await import("@/lib/logger");
    expect(
      JSON.stringify(redactPII({ lat: 0.3, lng: 32.5, latitude: 1, longitude: 2 })),
    ).not.toMatch(/0\.3|32\.5/);
  });
});

describe("§5.1 idempotent submit", () => {
  beforeEach(() => {
    authState.signUp.mockReset();
    authState.signIn.mockReset();
  });

  it("a first submit creates the account and carries the key's hash, not the key", async () => {
    authState.signUp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const { createAccount } = await import("@/lib/onboarding/account");
    const r = await createAccount({
      email: "a@x.ug",
      password: "p",
      fullName: "A",
      key: "11111111-1111-4111-8111-111111111111",
    });
    expect(r).toEqual({ userId: "u1", replay: false });
    const meta = authState.signUp.mock.calls[0]![0].options.data;
    expect(meta.onboarding_key).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(meta)).not.toContain("11111111-1111");
  });

  it("a retry with the same key after a lost response signs back in and replays", async () => {
    authState.signUp.mockResolvedValueOnce({ data: { user: { id: "u1" } }, error: null });
    const { createAccount } = await import("@/lib/onboarding/account");
    const key = "22222222-2222-4222-8222-222222222222";
    await createAccount({ email: "b@x.ug", password: "p", fullName: "B", key });
    const firstHash = authState.signUp.mock.calls[0]![0].options.data.onboarding_key;
    authState.signUp.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "User already registered" },
    });
    authState.usersRow = { id: "u1" };
    authState.meta = { onboarding_key: firstHash };
    authState.signIn.mockResolvedValue({ error: null });
    expect(await createAccount({ email: "b@x.ug", password: "p", fullName: "B", key })).toEqual({
      userId: "u1",
      replay: true,
    });
  });

  it("a different submit for an existing email is refused plainly", async () => {
    authState.signUp.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    });
    authState.usersRow = { id: "u1" };
    authState.meta = { onboarding_key: "not-this-one" };
    const { createAccount } = await import("@/lib/onboarding/account");
    const r = await createAccount({
      email: "c@x.ug",
      password: "p",
      fullName: "C",
      key: "33333333-3333-4333-8333-333333333333",
    });
    expect(r).toEqual({ error: "An account with this email already exists. Sign in instead." });
    expect(authState.signIn).not.toHaveBeenCalled();
  });
});
