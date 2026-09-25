import { describe, expect, it } from "vitest";

import { hospitalApprove } from "@/app/admin/_lib/hospital-review";
import { agreementSchema } from "@/app/onboarding/hospital-pending/_lib/schema";
import { proofFor } from "@/app/signup/hospital/_lib/proof";
import { HOSPITAL_REVIEW as R } from "@/content/onboarding-hospital";

describe("hospital v2 — proof by ownership (§5.7)", () => {
  it("government: the registry listing; PNFP: bureau licence; private and clinics: council licence", () => {
    expect(proofFor("public_moh")).toBe("registry");
    expect(proofFor("pnfp")).toBe("bureau");
    expect(proofFor("private")).toBe("licence");
    expect(proofFor("private_clinic")).toBe("licence");
    expect(proofFor(undefined)).toBeNull();
  });
});

describe("hospital v2 — agreement gate (§5.10)", () => {
  const ok = {
    dpaId: "0b8f2a1c-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
    dpaSha: "a".repeat(64),
    signatoryName: "Dr Example Officer",
    signatoryTitle: "med_super",
    bind: "on",
    accept: "on",
  };

  it("accepts a complete signature bound to a DPA id and hash", () => {
    expect(agreementSchema.safeParse(ok).success).toBe(true);
  });

  it("both boxes must be ticked; an unticked box is simply missing from the form", () => {
    const { bind: _b, ...noBind } = ok;
    const r = agreementSchema.safeParse(noBind);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toEqual(["bind"]);
    expect(agreementSchema.safeParse({ ...ok, accept: "" }).success).toBe(false);
  });

  it("the title is one of the six roles; the name can't be blank; the hash must be SHA-256", () => {
    expect(agreementSchema.safeParse({ ...ok, signatoryTitle: "ceo" }).success).toBe(false);
    expect(agreementSchema.safeParse({ ...ok, signatoryName: "   " }).success).toBe(false);
    expect(agreementSchema.safeParse({ ...ok, dpaSha: "abc" }).success).toBe(false);
    expect(agreementSchema.safeParse({ ...ok, dpaId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("hospital v2 — the reviewer's next step (D7)", () => {
  it("v2: Verify first, then wait for the signature, then Approve & provision", () => {
    expect(hospitalApprove({ state: "pending_approval", agreementAcceptedVersion: null })).toEqual({
      approveLabel: R.verify,
    });
    expect(hospitalApprove({ state: "under_review", agreementAcceptedVersion: null })).toEqual({
      approveLabel: R.verify,
    });
    expect(hospitalApprove({ state: "verified", agreementAcceptedVersion: null })).toEqual({
      approveBlocked: R.waitingSignature,
    });
    expect(hospitalApprove({ state: "verified", agreementAcceptedVersion: "dpa" })).toEqual({
      approveLabel: R.provision,
    });
  });

  it("v1: the agreement came with the application — one plain Approve provisions", () => {
    expect(hospitalApprove({ state: "pending_approval", agreementAcceptedVersion: "dpa" })).toEqual(
      {},
    );
  });
});
