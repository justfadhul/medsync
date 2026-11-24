import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PickerBed } from "@/lib/emr/actions/close";
import { describe, expect, expectTypeOf, it } from "vitest";

/** ADR 0199 §7: the sending doctor never sees another patient's name in the space picker. */
describe("the EU space picker reads no patient", () => {
  it("a picker bed has no patient", () => {
    expectTypeOf<PickerBed>().not.toHaveProperty("patient");
  });
  it("the close actions read the board with patients: none", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/emr/actions/close.ts"), "utf8");
    expect(src).toMatch(/loadBedBoard\([^)]*\{ patients: "none" \}\)/);
    expect(src).not.toMatch(/patients: "(names|mrn)"/);
  });
});
