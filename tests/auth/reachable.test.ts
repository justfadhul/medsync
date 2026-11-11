import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { staffReachable } from "@/lib/auth/reachable-states";

// Review finding C-1 / H-14 / C-4: one rule for every staff workspace.
describe("staffReachable", () => {
  const ok = { affiliationState: "active", hospitalState: "active", userState: "approved" };

  it("lets an approved person at a live hospital in", () => {
    expect(staffReachable(ok)).toBe(true);
    expect(
      staffReachable({ ...ok, affiliationState: "approved", hospitalState: "provisioning" }),
    ).toBe(true);
    expect(staffReachable({ ...ok, userState: "verified" })).toBe(true);
  });

  it.each(["pending_approval", "rejected", "suspended", "deactivated", "unverified", "verified"])(
    "refuses an affiliation that is %s",
    (affiliationState) => expect(staffReachable({ ...ok, affiliationState })).toBe(false),
  );

  it.each(["offboarded", "suspended", "agreement_expired", "under_review", "pending_approval"])(
    "refuses a hospital that is %s",
    (hospitalState) => expect(staffReachable({ ...ok, hospitalState })).toBe(false),
  );

  it.each(["suspended", "deactivated", "rejected"])("refuses a person who is %s", (userState) =>
    expect(staffReachable({ ...ok, userState })).toBe(false),
  );
});

describe("every staff scope uses the shared rule", () => {
  const scopes = [
    "lib/clinician/scope.ts",
    "lib/doctor/scope.ts",
    "lib/hospital-admin/scope.ts",
    "lib/ipc/scope.ts",
    "lib/lab-tech/scope.ts",
    "lib/lab/governance-scope.ts",
    "lib/lab/hmis-scope.ts",
    "lib/ncdreg/scope.ts",
    "lib/nurse/scope.ts",
    "lib/pharmacy/scope.ts",
    "lib/reception/scope.ts",
    "lib/resus/scope.ts",
    "lib/triage/scope.ts",
  ];

  it.each(scopes)("%s", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).toMatch(/from "@\/lib\/auth\/reachable"/);
    // No scope may carry its own copy of the affiliation-state list again.
    expect(src).not.toMatch(/staffAffiliations\.state,\s*\["active", "approved"\]/);
  });
});
