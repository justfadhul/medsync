import { describe, expect, it } from "vitest";

import {
  asBedType,
  BED_TYPE_CODES,
  bedSize,
  bedTypesFor,
  blockingFailures,
  EU_BED_TYPES,
  EU_WARD_TYPE,
  layoutChecks,
} from "@/supabase/functions/_shared/ward-layout";
import { openWardDoc } from "./fixtures";

describe("EU space types (ADRs 0539–0540)", () => {
  it("chair is 2×2 and resus is 3×4, with their words", () => {
    expect(bedSize("chair")).toMatchObject({ label: "Chair", w: 2, h: 2 });
    expect(bedSize("resus")).toMatchObject({ label: "Resus space", short: "Resus", w: 3, h: 4 });
    expect(BED_TYPE_CODES).toEqual(["standard", "icu", "cot", "couch", "chair", "resus"]);
    expect(EU_BED_TYPES).toEqual(["chair", "resus"]);
    expect(EU_WARD_TYPE).toBe("emergency_observation");
  });

  it("the register's resus and chair are kept, an unknown type still falls back", () => {
    expect(asBedType("resus")).toBe("resus");
    expect(asBedType("sofa")).toBe("standard");
  });

  it("chair and resus are offered only on an EU ward; a bed keeps its own type", () => {
    const codes = (w: string | null, keep?: Parameters<typeof bedTypesFor>[1]) =>
      bedTypesFor(w, keep).map((b) => b.code);
    expect(codes("emergency_observation")).toEqual(BED_TYPE_CODES);
    expect(codes("general")).toEqual(["standard", "icu", "cot", "couch"]);
    expect(codes(null)).toEqual(["standard", "icu", "cot", "couch"]);
    expect(codes("general", "resus")).toEqual(["standard", "icu", "cot", "couch", "resus"]);
  });

  it("R54: publish refuses chair or resus on a ward that is not an EU, and takes them on an EU", () => {
    const base = openWardDoc();
    const doc = {
      ...base,
      beds: base.beds.map((b, i) => (i === 0 ? { ...b, type: "resus" as const } : b)),
    };
    const eu = (c: ReturnType<typeof layoutChecks>) => c.find((x) => x.code === "eu_spaces");
    const general = layoutChecks(doc, "general");
    expect(eu(general)).toMatchObject({ ok: false, blocking: true });
    expect(blockingFailures(general).map((c) => c.code)).toContain("eu_spaces");
    expect(blockingFailures(layoutChecks(doc, null)).map((c) => c.code)).toContain("eu_spaces");
    expect(eu(layoutChecks(doc, EU_WARD_TYPE))).toBeUndefined();
    expect(eu(layoutChecks(base, "general"))).toBeUndefined();
  });
});
