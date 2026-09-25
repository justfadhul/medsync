import { describe, expect, it } from "vitest";

import { getPlace, resolvePoint, SEARCH_LIMIT, searchPlaces } from "@/lib/geo";
import {
  ageOn,
  emailSuggestion,
  formatUgPhone,
  isoFromParts,
  ninWarning,
  normalizeUgPhone,
  passwordBytes,
} from "@/lib/onboarding/fields";
import {
  COUNCILS,
  professionById,
  PROFESSIONS,
  registrationLabel,
} from "@/lib/onboarding/profession";
import { getRegistryFacility, PNFP_BUREAUS, searchRegistry } from "@/lib/registry";

describe("LOC — location engine", () => {
  it("LOC-5 / S2: 'Arua' finds the district, labelled Northern region, and never offers a region control", () => {
    const hits = searchPlaces("Arua");
    expect(hits[0]).toMatchObject({
      level: "district",
      name: "Arua District",
      region: { name: "Northern" },
    });
    expect(hits.every((p) => p.region.name)).toBe(true);
    // the 2020 vintage holds the city as "Arua Municipality"; the city alias reaches its divisions
    const city = searchPlaces("Arua city");
    expect(city.length).toBeGreaterThan(0);
    expect(
      city.every((p) => p.county === "Arua Municipality" && p.region.name === "Northern"),
    ).toBe(true);
  });

  it("LOC-5: prefix before contains, higher level first on ties, at most 8, full path on each", () => {
    const hits = searchPlaces("kawempe");
    expect(hits[0]).toMatchObject({
      name: "Kawempe Division",
      path: "KCCA · Kampala · Central region",
    });
    const gulu = searchPlaces("gulu");
    expect(gulu[0]!.level).toBe("district");
    expect(gulu.length).toBeLessThanOrEqual(SEARCH_LIMIT);
    expect(searchPlaces("a")).toEqual([]);
    expect(searchPlaces("Gulu district")[0]!.name).toBe("Gulu District");
  });

  it("LOC-1 / LOC-2: every unit derives its district and region; each sub-county has exactly one parent", () => {
    const sub = getPlace("UG10080102")!;
    expect(sub).toMatchObject({
      level: "subcounty",
      district: { code: "UG1008" },
      region: { name: "Central" },
    });
    expect(getPlace("UG3072")!.region.name).toBe("Northern"); // Arua — the Eastern + Arua pair can't be formed
    expect(getPlace("nope")).toBeNull();
  });

  it("LOC-5: search p95 under 150 ms on the full dataset", () => {
    const qs = [
      "ka",
      "kawempe",
      "gulu city",
      "fort portal city",
      "bar",
      "nakawa",
      "mbarara",
      "lwemiyaga",
      "zz",
      "kampala central",
    ];
    const times: number[] = [];
    for (let i = 0; i < 20; i++)
      for (const q of qs) {
        const t = performance.now();
        searchPlaces(q);
        times.push(performance.now() - t);
      }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(150);
  });

  it("LOC-6: a point resolves to its sub-county; accuracy decides the level; outside Uganda gives nothing", async () => {
    // Mulago National Referral Hospital, Kampala (public coordinates) — Kawempe Division.
    const mulago = await resolvePoint(0.3376, 32.5763, 25);
    expect(mulago).toMatchObject({
      ok: true,
      precision: "subcounty",
      place: { name: "Kawempe Division" },
    });
    const coarse = await resolvePoint(0.3376, 32.5763, 5_000);
    expect(coarse).toMatchObject({
      ok: true,
      precision: "district",
      place: { name: "Kampala", level: "district" },
    });
    expect(await resolvePoint(0.3376, 32.5763, 25_000)).toEqual({ ok: false, reason: "imprecise" });
    expect(await resolvePoint(-1.2921, 36.8219, 10)).toEqual({ ok: false, reason: "outside" }); // Nairobi
    expect(await resolvePoint(Number.NaN, 32, 10)).toEqual({ ok: false, reason: "outside" });
    const gulu = await resolvePoint(2.7747, 32.299, 50); // Gulu town centre
    expect(gulu.ok && gulu.place.district.name).toBe("Gulu");
  });

  it("LOC-6: reverse geocoding p95 under 200 ms warm", async () => {
    await resolvePoint(0.3376, 32.5763, 25);
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      await resolvePoint(-1 + (i % 10) * 0.5, 30 + (i % 7) * 0.7, 25);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(200);
  });
});

describe("REG — facility registry", () => {
  it("REG-3: a search finds the facility with the facts the server will copy", () => {
    const hit = searchRegistry("mulago national")[0]!;
    expect(hit).toMatchObject({
      name: "Mulago National Referral Hospital",
      level: "national_referral",
      ownership: "public_moh",
    });
    expect(hit.placeCode).toMatch(/^UG/);
    expect(getRegistryFacility(hit.code)).toEqual(hit);
  });

  it("REG-6: registry clinics have no catalogue level — PFP → private, others → other", () => {
    const clinics = searchRegistry("clinic", 400).filter((f) => f.registryLevel === "Clinic");
    expect(clinics.length).toBeGreaterThan(0);
    for (const c of clinics) expect(c.level).toBe(c.ownership === "private" ? "private" : "other");
  });

  it("the PNFP bureau list is the registry's own", () => {
    expect(PNFP_BUREAUS).toEqual(expect.arrayContaining(["UCMB", "UPMB", "UMMB"]));
    expect(PNFP_BUREAUS).not.toContain("Private Authority");
  });
});

describe("PRO — profession picker", () => {
  it("PRO-1: every option maps to one council, cadre, grade-or-null and generic role; ids are unique", () => {
    expect(new Set(PROFESSIONS.map((p) => p.id)).size).toBe(PROFESSIONS.length);
    for (const p of PROFESSIONS) {
      expect(COUNCILS[p.council]).toBeDefined();
      expect(p.role).toMatch(/_GENERAL$/);
    }
    expect(PROFESSIONS.filter((p) => p.needsSpecialty).map((p) => p.cadre)).toEqual([
      "CONSULTANT",
      "SENIOR_CONSULTANT",
    ]);
  });

  it("PRO-4 / S5: 'Registered nurse' names UNMC and carries the grade; no role or grade picker is needed", () => {
    const rn = professionById("registered-nurse")!;
    expect(registrationLabel(rn)).toBe("UNMC registration number");
    expect(rn).toMatchObject({ cadre: "NURSE", grade: "REGISTERED", role: "NURSE_GENERAL" });
    expect(registrationLabel(professionById("pharmacist")!)).toBe(
      "Pharmacy Board of Uganda registration number",
    );
  });

  it("D11: 'Specialist nurse' is the cadre, not the NURSE grade", () => {
    expect(professionById("specialist-nurse")).toMatchObject({
      cadre: "SPECIALIST_NURSE",
      grade: null,
    });
    expect(PROFESSIONS.some((p) => p.grade === "SPECIALIST")).toBe(false);
  });
});

describe("§5.12 field rules", () => {
  it("S13: phone numbers as people write them normalise to E.164", () => {
    for (const v of [
      "0772 123 456",
      "0772123456",
      "772123456",
      "+256 772 123 456",
      "256772123456",
      "0772-123-456",
    ])
      expect(normalizeUgPhone(v)).toBe("+256772123456");
    expect(normalizeUgPhone("0414 123 456")).toBe("+256414123456"); // landline
    expect(normalizeUgPhone("0772 123")).toBeNull();
    expect(normalizeUgPhone("hello")).toBeNull();
    expect(formatUgPhone("+256772123456")).toBe("0772 123 456");
  });

  it("NIN: a soft check — warns, never blocks", () => {
    expect(ninWarning("CM12345678ABCD")).toBeNull();
    expect(ninWarning("cm 1234 5678 abcd")).toBeNull();
    expect(ninWarning("CM123")).toMatch(/14 characters/);
    expect(ninWarning("XY12345678ABCD")).toMatch(/CM or CF/);
  });

  it("date of birth from three boxes; impossible dates are refused; age is whole years", () => {
    expect(isoFromParts("7", "3", "1961")).toBe("1961-03-07");
    expect(isoFromParts("31", "2", "1990")).toBeNull();
    expect(isoFromParts("1", "1", "90")).toBeNull();
    expect(ageOn("2008-09-26", new Date("2026-09-25T00:00:00Z"))).toBe(17);
    expect(ageOn("2008-09-25", new Date("2026-09-25T00:00:00Z"))).toBe(18);
  });

  it("email: 'Did you mean …?' from a local list", () => {
    expect(emailSuggestion("amina@gmial.com")).toBe("amina@gmail.com");
    expect(emailSuggestion("amina@yaho.com")).toBe("amina@yahoo.com");
    expect(emailSuggestion("records@mulago.go.uh")).toBe("records@mulago.go.ug");
    expect(emailSuggestion("amina@gmail.com")).toBeNull();
    expect(emailSuggestion("records@mulago.go.ug")).toBeNull();
    expect(emailSuggestion("not-an-email")).toBeNull();
  });

  it("password length counts bytes (bcrypt stops at 72)", () => {
    expect(passwordBytes("a".repeat(72))).toBe(72);
    expect(passwordBytes("é".repeat(40))).toBe(80);
  });
});
