import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchEuReport } from "@/lib/eu/report-load";

const state = vi.hoisted(() => ({ err: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/wards/feature", () => ({ euObservationLiveFor: () => true }));
vi.mock("@/lib/eu/limit", () => ({ euStayLimitHours: async () => 24 }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "leftJoin"]) chain[m] = () => chain;
  chain.where = () => (state.err ? Promise.reject(state.err) : Promise.resolve([]));
  return { db: chain };
});

describe("fetchEuReport failure modes", () => {
  beforeEach(() => {
    state.err = null;
  });
  it("a missing table is absent (null)", async () => {
    state.err = Object.assign(new Error('relation "eu_stays" does not exist'), { code: "42P01" });
    expect(await fetchEuReport("h", 28)).toBeNull();
  });
  it("any other read error is unavailable, never a report", async () => {
    state.err = Object.assign(new Error("boom"), { code: "57P01" });
    expect(await fetchEuReport("h", 28)).toEqual({ unavailable: true });
  });
  it("success is the report", async () => {
    const r = await fetchEuReport("h", 28);
    expect(r && "report" in r && r.report.stays).toBe(0);
  });
});
