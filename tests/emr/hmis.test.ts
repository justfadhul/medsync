import type {
  HmisAgeBands,
  HmisAttendanceDefinition,
  HmisCategoryMap,
} from "@/lib/emr/reference/hmis";
import type { IdsrClasses, IdsrScreen } from "@/lib/emr/reference/idsr";
import type { RefEntry } from "@/lib/resus/reference/ref";
import { describe, expect, it } from "vitest";

import {
  ageBand,
  attendanceType,
  hmisCategory,
  idsrClass,
  idsrExposureTokens,
  signedData,
} from "@/lib/emr/hmis";
import { REF_DX_TESTFIRST } from "@/lib/emr/reference/diagnosis";
import { REF_DM_FASTING_DEF } from "@/lib/emr/reference/fasting";
import { REF_HMIS_AGEBANDS, REF_HMIS_ATTENDANCE, REF_HMIS_MAP } from "@/lib/emr/reference/hmis";
import { REF_IDSR_CLASSES, REF_IDSR_SCREEN } from "@/lib/emr/reference/idsr";
import { REF_PREG_AGE, REF_PREG_POSTPARTUM } from "@/lib/emr/reference/pregnancy";
import { indexRefs, PENDING_CSO, refValue } from "@/lib/resus/reference/ref";

const ALL_REFS = [
  REF_HMIS_ATTENDANCE,
  REF_HMIS_AGEBANDS,
  REF_HMIS_MAP,
  REF_IDSR_CLASSES,
  REF_IDSR_SCREEN,
  REF_PREG_AGE,
  REF_PREG_POSTPARTUM,
  REF_DM_FASTING_DEF,
  REF_DX_TESTFIRST,
];

/** TEST-ONLY signed fixtures. The numbers below are invented to exercise the mechanism; they are
 *  not HMIS definitions and must never be copied into lib/emr/reference. */
function signed<T>(ref: RefEntry, data: T): RefEntry & { data: T } {
  return { ...ref, id: `TEST-${ref.id}`, status: "signed", data };
}
const TEST_ATTENDANCE_FY = signed<HmisAttendanceDefinition>(REF_HMIS_ATTENDANCE, {
  period: { kind: "financial_year", startMonth: 7 },
});
const TEST_ATTENDANCE_CY = signed<HmisAttendanceDefinition>(REF_HMIS_ATTENDANCE, {
  period: { kind: "calendar_year" },
});
const TEST_ATTENDANCE_ROLL = signed<HmisAttendanceDefinition>(REF_HMIS_ATTENDANCE, {
  period: { kind: "rolling_days", days: 10 },
});
const TEST_BANDS = signed<HmisAgeBands>(REF_HMIS_AGEBANDS, {
  bands: [
    { id: "b0", label: "Band 0", from: {}, to: { days: 20 } },
    { id: "b1", label: "Band 1", from: { days: 20 }, to: { years: 3 } },
    { id: "b2", label: "Band 2", from: { years: 3 }, to: { years: 30 } },
    { id: "b3", label: "Band 3", from: { years: 30 } },
  ],
});
const TEST_MAP = signed<HmisCategoryMap>(REF_HMIS_MAP, {
  categories: [{ id: "cat.a", label: "Category A" }],
  map: { "term-1": "cat.a" },
});
const TEST_IDSR = signed<IdsrClasses>(REF_IDSR_CLASSES, {
  classes: [
    { id: "cls.x", label: "Class X", immediatelyReportable: true, actionText: "Test action" },
  ],
  map: { "term-1": "cls.x" },
});
const TEST_SCREEN = signed<IdsrScreen>(REF_IDSR_SCREEN, {
  tokens: [{ id: "exp.t", label: "Test exposure" }],
});

// Kampala is UTC+3: 22:30 UTC on 30 Jun is 01:30 on 1 Jul locally.
const kla = (iso: string) => new Date(`${iso}+03:00`);

describe("reference entries: all pending the CSO, value withheld", () => {
  it("nine entries with unique ids", () => {
    expect(Object.keys(indexRefs(ALL_REFS)).sort()).toEqual([
      "REF-DM-FASTING-DEF",
      "REF-DX-TESTFIRST",
      "REF-HMIS-AGEBANDS",
      "REF-HMIS-ATTENDANCE",
      "REF-HMIS-MAP",
      "REF-IDSR-CLASSES",
      "REF-IDSR-SCREEN",
      "REF-PREG-AGE",
      "REF-PREG-POSTPARTUM",
    ]);
  });
  it.each(ALL_REFS.map((r) => [r.id, r]))(
    "%s is pending_cso with no value and no data",
    (_id, ref) => {
      expect(ref.status).toBe("pending_cso");
      expect(ref.value).toBeUndefined();
      expect((ref as { data?: unknown }).data).toBeUndefined();
      expect(refValue(ref)).toBe(PENDING_CSO);
      expect(ref.source.length).toBeGreaterThan(10); // names the document to fetch
    },
  );
  it("signedData withholds data from an unsigned entry even if data is present", () => {
    expect(signedData({ ...REF_HMIS_MAP, data: { categories: [], map: {} } })).toBeNull();
    expect(signedData(TEST_MAP)).toEqual(TEST_MAP.data);
  });
});

describe("while pending: unknown / null, never a guess", () => {
  const visitAt = kla("2026-09-26T10:00:00");
  it("attendance type is unknown", () => {
    expect(attendanceType({ visitAt, priorVisitAts: [] })).toBe("unknown");
    expect(attendanceType({ visitAt, priorVisitAts: [kla("2026-09-01T10:00:00")] })).toBe(
      "unknown",
    );
  });
  it("age band is null", () => {
    expect(ageBand({ dateOfBirth: "1990-01-01", visitAt })).toBeNull();
  });
  it("HMIS category is null", () => {
    expect(hmisCategory("term-1")).toBeNull();
  });
  it("IDSR class is null (no notifiable confirm sheet)", () => {
    expect(idsrClass("term-1")).toBeNull();
  });
  it("no exposure tokens are offered", () => {
    expect(idsrExposureTokens()).toEqual([]);
  });
});

describe("attendance type (TEST-ONLY signed fixture)", () => {
  it("new with no earlier attendance", () => {
    expect(
      attendanceType(
        { visitAt: kla("2026-09-26T10:00:00"), priorVisitAts: [] },
        TEST_ATTENDANCE_FY,
      ),
    ).toBe("new");
  });
  it("re-attendance with an earlier attendance in the same financial year", () => {
    const r = attendanceType(
      { visitAt: kla("2026-09-26T10:00:00"), priorVisitAts: [kla("2026-07-01T09:00:00")] },
      TEST_ATTENDANCE_FY,
    );
    expect(r).toBe("re_attendance");
  });
  it("new when the earlier attendance was in the previous financial year", () => {
    const r = attendanceType(
      { visitAt: kla("2026-09-26T10:00:00"), priorVisitAts: [kla("2026-06-30T23:59:00")] },
      TEST_ATTENDANCE_FY,
    );
    expect(r).toBe("new");
  });
  it("the year boundary is the hospital's local date, not UTC", () => {
    // 1 Jul 01:30 in Kampala is still 30 Jun in UTC.
    const prior = new Date("2026-06-30T22:30:00Z");
    expect(
      attendanceType(
        { visitAt: kla("2026-09-26T10:00:00"), priorVisitAts: [prior] },
        TEST_ATTENDANCE_FY,
      ),
    ).toBe("re_attendance");
  });
  it("a visit before the financial year's start month belongs to the year that began last July", () => {
    const r = attendanceType(
      { visitAt: kla("2026-03-01T10:00:00"), priorVisitAts: [kla("2025-08-01T10:00:00")] },
      TEST_ATTENDANCE_FY,
    );
    expect(r).toBe("re_attendance");
  });
  it("calendar year and rolling-days definitions", () => {
    const visitAt = kla("2026-01-05T10:00:00");
    expect(
      attendanceType({ visitAt, priorVisitAts: [kla("2025-12-31T10:00:00")] }, TEST_ATTENDANCE_CY),
    ).toBe("new");
    expect(
      attendanceType(
        { visitAt, priorVisitAts: [kla("2025-12-31T10:00:00")] },
        TEST_ATTENDANCE_ROLL,
      ),
    ).toBe("re_attendance");
    expect(
      attendanceType(
        { visitAt, priorVisitAts: [kla("2025-12-25T10:00:00")] },
        TEST_ATTENDANCE_ROLL,
      ),
    ).toBe("new");
  });
  it("a later attendance (a data-entry backfill) does not make this one a re-attendance", () => {
    const r = attendanceType(
      { visitAt: kla("2026-09-26T10:00:00"), priorVisitAts: [kla("2026-09-27T10:00:00")] },
      TEST_ATTENDANCE_FY,
    );
    expect(r).toBe("new");
  });
});

describe("age band (TEST-ONLY signed fixture)", () => {
  const visitAt = kla("2026-09-26T10:00:00");
  it.each([
    ["2026-09-20", "b0"],
    ["2026-09-06", "b1"], // exactly 20 days: the lower bound is inclusive
    ["2023-09-27", "b1"], // one day short of 3 years
    ["2023-09-26", "b2"], // exactly 3 years
    ["1996-09-27", "b2"],
    ["1996-09-26", "b3"],
  ])("born %s → %s", (dob, band) => {
    expect(ageBand({ dateOfBirth: dob, visitAt }, TEST_BANDS)?.id).toBe(band);
  });
  it("no date of birth, or born after the visit → null", () => {
    expect(ageBand({ dateOfBirth: null, visitAt }, TEST_BANDS)).toBeNull();
    expect(ageBand({ dateOfBirth: "2026-10-01", visitAt }, TEST_BANDS)).toBeNull();
  });
  it("an imprecise date of birth gives a band only when every possible date agrees (D-CFC-12)", () => {
    expect(ageBand({ dateOfBirth: "1980-01-01", precision: "year", visitAt }, TEST_BANDS)?.id).toBe(
      "b3",
    );
    // Born some time in 1996: could be 29 or 30 at the visit → unknown.
    expect(
      ageBand({ dateOfBirth: "1996-01-01", precision: "year", visitAt }, TEST_BANDS),
    ).toBeNull();
    expect(
      ageBand({ dateOfBirth: "1996-01-01", precision: "month", visitAt }, TEST_BANDS)?.id,
    ).toBe("b3");
    expect(
      ageBand({ dateOfBirth: "1996-09-01", precision: "month", visitAt }, TEST_BANDS),
    ).toBeNull();
  });
  it("a 29 February birthday reaches 3 years on 1 March (the conservative roll)", () => {
    expect(
      ageBand({ dateOfBirth: "2024-02-29", visitAt: kla("2027-02-28T10:00:00") }, TEST_BANDS)?.id,
    ).toBe("b1");
    expect(
      ageBand({ dateOfBirth: "2024-02-29", visitAt: kla("2027-03-01T10:00:00") }, TEST_BANDS)?.id,
    ).toBe("b2");
  });
});

describe("HMIS category and IDSR class (TEST-ONLY signed fixtures)", () => {
  it("a mapped term gives its category; unmapped or uncoded gives null", () => {
    expect(hmisCategory("term-1", TEST_MAP)).toEqual({ id: "cat.a", label: "Category A" });
    expect(hmisCategory("term-2", TEST_MAP)).toBeNull();
    expect(hmisCategory(null, TEST_MAP)).toBeNull();
  });
  it("a mapped term gives its IDSR class with the signed action text", () => {
    expect(idsrClass("term-1", TEST_IDSR)).toEqual({
      id: "cls.x",
      label: "Class X",
      immediatelyReportable: true,
      actionText: "Test action",
    });
    expect(idsrClass("term-2", TEST_IDSR)).toBeNull();
    expect(idsrClass(null, TEST_IDSR)).toBeNull();
  });
  it("a map pointing at a category the entry does not define gives null", () => {
    const broken = signed<HmisCategoryMap>(REF_HMIS_MAP, {
      categories: [],
      map: { "term-1": "cat.gone" },
    });
    expect(hmisCategory("term-1", broken)).toBeNull();
  });
  it("the exposure tokens appear once signed", () => {
    expect(idsrExposureTokens(TEST_SCREEN)).toEqual([{ id: "exp.t", label: "Test exposure" }]);
  });
});
