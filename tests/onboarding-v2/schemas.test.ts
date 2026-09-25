import { describe, expect, it } from "vitest";

import {
  clinicalSchema,
  fieldErrors,
  hospitalSchema,
  nonClinicalSchema,
  patientSchema,
  UNDER_18,
} from "@/lib/onboarding/schemas";

const consent = { consent: true, consentVersion: "v1.0", consentSha: "a".repeat(64) } as const;
const pw = "a sentence that is long";

function dobYearsAgo(years: number, plusDays = 0) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return {
    dobDay: String(d.getUTCDate()),
    dobMonth: String(d.getUTCMonth() + 1),
    dobYear: String(d.getUTCFullYear()),
  };
}

const patient = {
  firstName: "Amina",
  surname: "Nakato",
  sex: "female",
  ...dobYearsAgo(40),
  phone: "0772 123 456",
  place: "UG10080102",
  email: "amina@example.com",
  password: pw,
  ...consent,
};

describe("patient v2", () => {
  it("accepts a complete, adult signup with a phone written the Ugandan way", () => {
    expect(patientSchema.safeParse(patient).success).toBe(true);
  });

  it("O15 / S4 / D13: under 18 is refused with the under-18 code (DPPA s.8)", () => {
    const r = patientSchema.safeParse({ ...patient, ...dobYearsAgo(17) });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!).dobDay).toBe(UNDER_18);
    const eighteenTomorrow = patientSchema.safeParse({ ...patient, ...dobYearsAgo(18, 1) });
    expect(eighteenTomorrow.success).toBe(false);
    expect(patientSchema.safeParse({ ...patient, ...dobYearsAgo(18) }).success).toBe(true);
  });

  it("impossible and future dates get their own message", () => {
    expect(
      fieldErrors(
        patientSchema.safeParse({ ...patient, dobDay: "31", dobMonth: "2", dobYear: "1990" })
          .error!,
      ).dobDay,
    ).toMatch(/doesn't exist/);
    expect(
      fieldErrors(patientSchema.safeParse({ ...patient, ...dobYearsAgo(-1) }).error!).dobDay,
    ).toMatch(/future/);
  });

  it("asks once: no display name, no region, no ID at signup (Appendix A)", () => {
    const keys = Object.keys(
      patientSchema.parse({ ...patient, fullName: "x", region: "Eastern", idNumber: "1" }),
    );
    expect(keys).not.toEqual(expect.arrayContaining(["fullName"]));
    expect(keys).not.toContain("region");
    expect(keys).not.toContain("idNumber");
  });

  it("a mobile is required; landlines are refused for patients", () => {
    expect(
      fieldErrors(patientSchema.safeParse({ ...patient, phone: "0414 123 456" }).error!).phone,
    ).toMatch(/mobile/);
  });
});

describe("clinical v2", () => {
  const clinical = {
    fullName: "Dr Okello",
    email: "okello@example.com",
    phone: "0772 000 111",
    password: pw,
    profession: "medical-officer",
    registrationNumber: "UMDPC/123",
    licence: "later",
    hospitalId: "11111111-1111-4111-8111-111111111111",
    departmentId: "22222222-2222-4222-8222-222222222222",
    employmentType: "full_time",
    ...consent,
  };

  it("one profession replaces council, cadre, grade and role (O11): the schema has none of them", () => {
    const parsed = clinicalSchema.parse({
      ...clinical,
      council_id: "x",
      cadre_grade_id: "x",
      role_id: "x",
    });
    expect(Object.keys(parsed)).not.toEqual(
      expect.arrayContaining(["council_id", "cadre_grade_id", "role_id"]),
    );
  });

  it("O12 / Law 7: the licence must be attached or explicitly deferred", () => {
    const { licence: _ignored, ...noLicence } = clinical;
    expect(fieldErrors(clinicalSchema.safeParse(noLicence).error!).licence).toMatch(/Add it later/);
  });

  it("S7: consultants must choose a specialty; 'not listed yet' is allowed", () => {
    expect(
      fieldErrors(clinicalSchema.safeParse({ ...clinical, profession: "consultant" }).error!)
        .specialty,
    ).toMatch(/specialty/);
    expect(
      clinicalSchema.safeParse({ ...clinical, profession: "consultant", specialty: "unlisted" })
        .success,
    ).toBe(true);
  });
});

describe("non-clinical v2", () => {
  it("O10: no role pickers; NIN is the identity anchor", () => {
    const r = nonClinicalSchema.safeParse({
      fullName: "Grace",
      email: "grace@example.com",
      phone: "0772 000 222",
      password: pw,
      nin: "CM12345678ABCD",
      hospitalId: "11111111-1111-4111-8111-111111111111",
      departmentId: "22222222-2222-4222-8222-222222222222",
      employmentType: "visiting",
      ...consent,
    });
    expect(r.success).toBe(true);
    expect(Object.keys(r.data!)).not.toEqual(expect.arrayContaining(["cadre_id", "role_id"]));
  });

  it("O14: the same 12-character password rule as every other form", () => {
    const r = nonClinicalSchema.safeParse({ password: "short1234" });
    expect(fieldErrors(r.error!).password).toMatch(/12 or more/);
  });
});

describe("hospital v2", () => {
  const base = {
    facilitySource: "registry",
    registryCode: "9805583",
    ownership: "public_moh",
    applicantName: "Sarah Achieng",
    applicantRole: "administrator",
    email: "sarah@mulago.go.ug",
    phone: "0414 000 111",
    password: pw,
    officerName: "Dr B",
    officerTitle: "med_super",
    officerPhone: "0772 999 888",
    letter: "later",
    ...consent,
  };

  it("S9: a registry-listed government facility needs no licence and no DPA at application", () => {
    expect(hospitalSchema.safeParse(base).success).toBe(true);
  });

  it("O5: the applicant's council number is gone; O7: no separate email domain", () => {
    const keys = Object.keys(
      hospitalSchema.parse({ ...base, applicantCouncilNumber: "x", institutionalEmailDomain: "x" }),
    );
    expect(keys).not.toContain("applicantCouncilNumber");
    expect(keys).not.toContain("institutionalEmailDomain");
  });

  it("O16: the officer contact is validated, needs at least one channel, and can't be the applicant's", () => {
    expect(
      fieldErrors(hospitalSchema.safeParse({ ...base, officerPhone: "not a phone" }).error!)
        .officerPhone,
    ).toMatch(/Ugandan number/);
    expect(
      fieldErrors(hospitalSchema.safeParse({ ...base, officerPhone: undefined }).error!)
        .officerPhone,
    ).toMatch(/at least one/);
    expect(
      fieldErrors(hospitalSchema.safeParse({ ...base, officerPhone: "0414 000 111" }).error!)
        .officerPhone,
    ).toMatch(/not yours/);
    expect(
      fieldErrors(
        hospitalSchema.safeParse({
          ...base,
          officerPhone: undefined,
          officerEmail: "SARAH@mulago.go.ug",
        }).error!,
      ).officerEmail,
    ).toMatch(/not yours/);
  });

  it("S10 / §5.7: a private facility needs the issuing council, a number and the licence (or later)", () => {
    const e = fieldErrors(hospitalSchema.safeParse({ ...base, ownership: "private" }).error!);
    expect(Object.keys(e)).toEqual(
      expect.arrayContaining(["licensingBody", "licenceNumber", "licence"]),
    );
    expect(
      hospitalSchema.safeParse({
        ...base,
        ownership: "private",
        licensingBody: "umdpc",
        licenceNumber: "L-1",
        licence: "later",
      }).success,
    ).toBe(true);
  });

  it("the manual path asks for name, level, ownership, place — and a bureau for PNFP", () => {
    const e = fieldErrors(
      hospitalSchema.safeParse({
        ...base,
        facilitySource: "manual",
        registryCode: undefined,
        ownership: "pnfp",
      }).error!,
    );
    expect(Object.keys(e)).toEqual(
      expect.arrayContaining(["facilityName", "facilityLevel", "place", "bureau"]),
    );
  });
});
