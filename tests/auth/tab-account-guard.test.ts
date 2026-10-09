import { describe, expect, it } from "vitest";

import { staleAccount } from "@/app/providers";

describe("staleAccount", () => {
  it("reloads a tab whose account was swapped or signed out in another tab", () => {
    expect(staleAccount("doctor", "admin")).toBe(true);
    expect(staleAccount("doctor", null)).toBe(true);
  });
  it("leaves a tab alone when the account is unchanged or it was never signed in", () => {
    expect(staleAccount("doctor", "doctor")).toBe(false);
    expect(staleAccount(null, "doctor")).toBe(false);
    expect(staleAccount(undefined, "doctor")).toBe(false);
  });
});
