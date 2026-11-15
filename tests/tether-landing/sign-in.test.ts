import { describe, expect, it } from "vitest";

import { isTetherHost, tetherClosed, tetherHome, tetherRewrite } from "@/lib/landing/feature";

/** ADR 0498: the Tether sign-in pages take over `/sign-in` and its code step only while the landing is on. */
describe("tetherRewrite", () => {
  it("serves the Tether pages at the hospital app's addresses when on", () => {
    expect(tetherRewrite("/", true)).toBe("/tether");
    expect(tetherRewrite("/sign-in", true)).toBe("/tether/sign-in");
    expect(tetherRewrite("/sign-in/mfa", true)).toBe("/tether/sign-in/mfa");
    expect(tetherRewrite("/onboarding/mfa-setup", true)).toBe("/tether/onboarding/mfa-setup");
  });

  it("leaves everything else, and everything when off", () => {
    for (const p of ["/sign-up", "/get-started", "/sign-in/other", "/reception", "/tether"])
      expect(tetherRewrite(p, true)).toBeNull();
    for (const p of ["/", "/sign-in", "/sign-in/mfa"]) expect(tetherRewrite(p, false)).toBeNull();
  });
});

/** ADR 0499: Tether is this app on its own domain, and opens only booking there. */
describe("the Tether domain", () => {
  it("matches TETHER_HOSTS by host name, any case or port", () => {
    expect(isTetherHost("Tether.ug:443", "tether.ug, www.tether.ug")).toBe(true);
    expect(isTetherHost("www.tether.ug", "tether.ug, www.tether.ug")).toBe(true);
    expect(isTetherHost("medsync-pi-inky.vercel.app", "tether.ug")).toBe(false);
    expect(isTetherHost("tether.ug", undefined)).toBe(false);
    expect(isTetherHost(null, "tether.ug")).toBe(false);
  });

  it("opens booking, sign-in and emergency", () => {
    for (const p of [
      "/",
      "/sign-in",
      "/sign-in/mfa",
      "/signup/patient",
      "/emergency/tell",
      "/patient/book/day",
      "/reception/book",
      "/clinician/availability",
      "/doctor/schedule",
      "/nurse/incoming",
      "/hospital-admin/clinics",
      "/clinic",
      "/clinic/screen",
      "/sw.js",
      "/robots.txt",
    ])
      expect(tetherClosed(p), p).toBe(false);
  });

  it("closes the clinical workspaces", () => {
    for (const p of [
      "/doctor",
      "/doctor/encounters",
      "/nurse/mar",
      "/lab",
      "/pharmacy",
      "/hmis",
      "/ipc",
      "/ncd",
      "/about",
      "/tether/gallery",
      "/patients",
    ])
      expect(tetherClosed(p), p).toBe(true);
  });
});

/** ADR 0509: a nurse's or doctor's MedSync home is the clinic floor on Tether. */
describe("tetherHome", () => {
  it("sends the nurse and doctor homes to the floor", () => {
    expect(tetherHome("/nurse")).toBe("/clinic");
    expect(tetherHome("/nurse/")).toBe("/clinic");
    expect(tetherHome("/nurse/triage")).toBe("/clinic?view=triage");
    expect(tetherHome("/doctor")).toBe("/clinic?view=line");
  });
  it("sends the door page to the Tether sign-in, where the doors are (ADR 0510)", () => {
    expect(tetherHome("/get-started")).toBe("/sign-in");
  });
  it("leaves every other page alone", () => {
    for (const p of [
      "/",
      "/nurse/mar",
      "/nurse/incoming",
      "/doctor/schedule",
      "/clinic",
      "/reception",
    ])
      expect(tetherHome(p), p).toBeNull();
  });
});
