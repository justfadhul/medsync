import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PENDING } from "@/content/onboarding";
import { APPROVAL, STAFF, STAFF_PENDING } from "@/content/onboarding-staff";

/** Every string a copy object can render, calling its functions with sample arguments. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "function") return strings((v as (...a: string[]) => unknown)("X", "Y"));
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}
const src = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

const V2_FILES = [
  "app/signup/clinical/_components/form.tsx",
  "app/signup/non-clinical/_components/form.tsx",
  "app/signup/_components/staff-work.tsx",
  "app/onboarding/clinical-pending/_components/view.tsx",
  "app/onboarding/clinical-pending/_components/details.tsx",
];

describe("staff onboarding v2 copy", () => {
  it("non-clinical pending copy never mentions a council or a clinician role (O13)", () => {
    const text = strings(PENDING.nonClinical).join(" ").toLowerCase();
    for (const word of ["council", "clinician", "clinical", "register", "licence"])
      expect(text).not.toContain(word);
  });

  it("clinical pending copy names the council register, not a cadre registry", () => {
    expect(PENDING.clinical.body("Mulago", "UMDPC")).toContain("UMDPC register");
  });

  it("no pending or staff copy promises an email or SMS (Q11)", () => {
    const text = strings([PENDING, STAFF, STAFF_PENDING, APPROVAL]).join(" ").toLowerCase();
    expect(text).not.toMatch(
      /email you|emailed|we'll email|notify you|we'll text|sms you|by sms|by email/,
    );
  });

  it("staff copy never says cadre, affiliation or tenant", () => {
    const text = strings([STAFF, STAFF_PENDING, APPROVAL]).join(" ").toLowerCase();
    expect(text).not.toMatch(/cadre|affiliation|tenant/);
  });
});

describe("staff onboarding v2 surfaces", () => {
  it("the clinical form asks profession only: no grade or role picker (§5.6)", () => {
    const form = src("app/signup/clinical/_components/form.tsx");
    expect(form).toContain("<ProfessionField");
    expect(form).not.toMatch(/name="(grade|cadreGrade\w*|role\w*|council\w*|cadre\w*)"/);
    expect(form).not.toContain("PROFILE_GRADES");
  });

  it("the non-clinical form shows the role, never asks it (O10)", () => {
    const form = src("app/signup/non-clinical/_components/form.tsx");
    expect(form).toContain("NON_CLINICAL.joiningAs(RECEPTION.label)");
    expect(form).not.toMatch(/name="role\w*"/);
  });

  it("v2 staff surfaces keep red for Emergency only (Law 9)", () => {
    for (const f of V2_FILES)
      expect(src(f), f).not.toMatch(/\b(?:bg|text|border|ring)-red-|destructive/);
  });

  it("the v2 pending page carries Emergency in its header", () => {
    const view = src("app/onboarding/clinical-pending/_components/view.tsx");
    expect(view).toContain("<EmergencyButton");
    expect(view).toContain("data-emergency-inline");
  });
});
