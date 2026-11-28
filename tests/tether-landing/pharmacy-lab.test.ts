import { afterEach, describe, expect, it, vi } from "vitest";

import {
  medsyncAddress,
  tetherClosed,
  tetherWorkspaceLiveFor,
  tetherWorkspacesOpen,
} from "@/lib/landing/feature";

/** ADR 0545: the lab and the pharmacy open on Tether behind TETHER_LAB and TETHER_PHARMACY. */
describe("pharmacy and lab on Tether", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps both closed while their flags are unset", () => {
    vi.stubEnv("TETHER_LAB", "");
    vi.stubEnv("TETHER_PHARMACY", "");
    expect(tetherWorkspacesOpen()).toEqual([]);
    expect(tetherClosed("/lab/bench")).toBe(true);
    expect(tetherClosed("/pharmacy/today")).toBe(true);
  });

  it("opens each one on its own flag", () => {
    vi.stubEnv("TETHER_LAB", "1");
    vi.stubEnv("TETHER_PHARMACY", "");
    expect(tetherClosed("/lab")).toBe(false);
    expect(tetherClosed("/lab/needs-you/criticals/x")).toBe(false);
    expect(tetherClosed("/pharmacy")).toBe(true);
    expect(tetherClosed("/laboratory")).toBe(true);
    vi.stubEnv("TETHER_PHARMACY", "h-1,h-2");
    expect(tetherClosed("/pharmacy/dispense")).toBe(false);
    // The other clinical workspaces stay MedSync's.
    expect(tetherClosed("/doctor/encounters")).toBe(true);
    expect(tetherClosed("/hmis")).toBe(true);
  });

  it("names hospitals: 1 is every hospital, a list is only those", () => {
    expect(tetherWorkspaceLiveFor("/lab", "h-1", "1")).toBe(true);
    expect(tetherWorkspaceLiveFor("/lab", "h-1", " h-2 , h-1 ")).toBe(true);
    expect(tetherWorkspaceLiveFor("/lab", "h-3", "h-2,h-1")).toBe(false);
    expect(tetherWorkspaceLiveFor("/pharmacy", "h-1", "")).toBe(false);
    expect(tetherWorkspaceLiveFor("/pharmacy", "h-1", undefined)).toBe(false);
  });

  it("builds the MedSync address a closed page goes to", () => {
    expect(medsyncAddress("/lab?x=1", "medsync.ug/")).toBe("https://medsync.ug/lab?x=1");
    expect(medsyncAddress("/pharmacy", "http://localhost:3000")).toBe(
      "http://localhost:3000/pharmacy",
    );
    expect(medsyncAddress("/lab", "")).toBeNull();
    expect(medsyncAddress("/lab", undefined)).toBeNull();
  });
});
