import { afterEach, describe, expect, it, vi } from "vitest";

import { PHARMACY_REWORK_COPY } from "@/content/pharmacy-rework";
import { pharmacyDevHospital } from "@/lib/pharmacy/access";
import {
  pharmacyReactionsLiveFor,
  pharmacyTiersFor,
  pharmacyWorkspaceV2LiveFor,
} from "@/lib/pharmacy/feature";

// ADR 0468: in production the unsigned v2 wording keeps v2 off, except at a PHARMACY_DEV_HOSPITALS test hospital.
describe("PHARMACY_WORKSPACE_V2 in production", () => {
  afterEach(() => vi.unstubAllEnvs());
  const prod = (dev: string) => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PHARMACY_WORKSPACE", "1");
    vi.stubEnv("PHARMACY_WORKSPACE_V2", "1");
    vi.stubEnv("PHARMACY_DEV_HOSPITALS", dev);
  };

  it("stays off at a hospital that is not a test hospital while the wording is draft", () => {
    prod("h-test");
    expect(pharmacyWorkspaceV2LiveFor("h-real")).toBe(false);
  });

  it("is on at a listed test hospital, and everywhere with 1", () => {
    prod("h-test");
    expect(pharmacyWorkspaceV2LiveFor("h-test")).toBe(true);
    prod("1");
    expect(pharmacyWorkspaceV2LiveFor("h-real")).toBe(true);
  });

  it("still needs its own flag at a test hospital", () => {
    prod("h-test");
    vi.stubEnv("PHARMACY_WORKSPACE_V2", "");
    expect(pharmacyWorkspaceV2LiveFor("h-test")).toBe(false);
  });

  it("reads the list the same way as the permission map", () => {
    expect(pharmacyDevHospital("a", "a, b")).toBe(true);
    expect(pharmacyDevHospital("c", "a, b")).toBe(false);
    expect(pharmacyDevHospital(null, "a")).toBe(false);
    expect(pharmacyDevHospital("c", undefined)).toBe(false);
  });
});

// The rework's tiers keep the same exemption: a test hospital is not sent to a 404 while the rework wording is draft.
describe("the rework tiers in production", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("are on at a real hospital once the CSO signed the rework wording (28 Nov 2026), and at a test hospital", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PHARMACY_WORKSPACE", "1");
    vi.stubEnv("PHARMACY_DEV_HOSPITALS", "h-test");
    expect(PHARMACY_REWORK_COPY.status).toBe("signed");
    expect(pharmacyTiersFor("h-real").core).toBe(true);
    expect(pharmacyTiersFor("h-test").core).toBe(true);
    vi.stubEnv("PHARMACY_WORKSPACE", "h-other");
    expect(pharmacyTiersFor("h-real").core).toBe(false);
  });

  it("every older area gate takes the same exemption, so a test hospital never meets a draft-wording 404", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PHARMACY_CORE", "1");
    vi.stubEnv("PHARMACY_INSIGHTS", "1");
    vi.stubEnv("PHARMACY_DEV_HOSPITALS", "h-test");
    expect(pharmacyReactionsLiveFor("h-test")).toBe(true);
    expect(pharmacyReactionsLiveFor("h-real")).toBe(false);
  });
});
