import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ClinicianSchedulingSettingsRow,
  DepartmentSchedulingPolicyRow,
} from "@/supabase/functions/_shared/slots";
import { describe, expect, it } from "vitest";

import { resolveSchedulingSettings } from "@/supabase/functions/_shared/slots";

/**
 * ADR 0476: a booking's initial status follows the same auto-confirm the
 * doctor's page shows — the clinician's own row, else the department's
 * default, else manual. The behaviour half pins the chain; the source half
 * pins that the one writer and both patient previews use it, and that the
 * doctor's page resolves in the same order.
 */

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const own = (autoConfirm: boolean): ClinicianSchedulingSettingsRow => ({
  defaultSlotMinutes: 15,
  bufferMinutes: 0,
  autoConfirm,
  allowVirtual: false,
});

const dept = (defaultAutoConfirm: boolean): DepartmentSchedulingPolicyRow => ({
  defaultSlotMinutes: 15,
  defaultBufferMinutes: 0,
  defaultAutoConfirm,
  allowVirtual: false,
  bookableWeekdays: [1, 2, 3, 4, 5],
  bookableStartMinutesLocal: 480,
  bookableEndMinutesLocal: 1020,
});

const autoConfirm = (
  c: ClinicianSchedulingSettingsRow | null,
  d: DepartmentSchedulingPolicyRow | null,
) => resolveSchedulingSettings(c, d).autoConfirm;

describe("auto-confirm rule (ADR 0476)", () => {
  it("a doctor with no row of their own follows the department's default", () => {
    expect(autoConfirm(null, dept(true))).toBe(true);
    expect(autoConfirm(null, dept(false))).toBe(false);
  });

  it("the doctor's own setting wins over the department's, both ways", () => {
    expect(autoConfirm(own(false), dept(true))).toBe(false);
    expect(autoConfirm(own(true), dept(false))).toBe(true);
  });

  it("with neither row, requests wait for a person", () => {
    expect(autoConfirm(null, null)).toBe(false);
  });

  it("the booking writer sets the initial status from the resolved chain", () => {
    const book = read("supabase/functions/_shared/book.ts");
    expect(book).toMatch(
      /const effective = resolveSchedulingSettings\(clinicianSettings, departmentPolicy\);/,
    );
    expect(book).toMatch(/status: effective\.autoConfirm \? "confirmed" : "pending_approval"/);
    expect(book).not.toMatch(/settings\?\.auto_confirm/);
  });

  it("both patient previews promise what the writer does", () => {
    const edge = read("supabase/functions/pt-bookable-clinicians/index.ts");
    expect(edge).toMatch(
      /autoConfirm: resolveSchedulingSettings\(clinicianSettings, departmentPolicy\)\.autoConfirm/,
    );
    const web = read("lib/scheduling/booking-options.ts");
    expect(web).toMatch(/autoConfirm: effective\.autoConfirm/);
    for (const src of [edge, web]) {
      expect(src).not.toMatch(/clinicianSettings\?\.autoConfirm \?\? false/);
    }
  });

  it("the doctor's page resolves in the same order", () => {
    expect(read("lib/scheduling/doctor.ts")).toMatch(
      /own\?\.autoConfirm \?\? policy\?\.defaultAutoConfirm \?\? HARD_DEFAULTS\.autoConfirm/,
    );
  });
});
