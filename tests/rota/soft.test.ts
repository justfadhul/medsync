import { describe, expect, it, vi } from "vitest";

import { soft } from "@/lib/rota/soft";

describe("rota reads fail soft", () => {
  it("a rejecting read gives the fallback, never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await soft(Promise.reject(new Error("db down")), [])).toEqual([]);
    expect(await soft(Promise.reject(new Error("x")), undefined)).toBeUndefined();
  });
  it("a good read passes through", async () => {
    expect(await soft(Promise.resolve(1), 0)).toBe(1);
  });
});
