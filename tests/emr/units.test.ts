import { describe, expect, it } from "vitest";

import {
  acceptedUnits,
  canonicalUnit,
  fromCanonical,
  mismatchPrompt,
  parseComparator,
  toCanonical,
  UNIT_TABLE,
} from "@/lib/units";

/**
 * lib/units: CFC §5 conversions, clinical reference §8 (v1.1) conversions,
 * the five signed D-CFC-14 mismatch prompts, and comparator parsing.
 * Known pairs are textbook reference values, not the factors echoed back.
 */

// [concept, value, unit, expected canonical, tolerance]
const PAIRS: [string, number, string, number, number][] = [
  ["obs.glucose", 126, "mg/dL", 7.0, 0.01],
  ["obs.glucose", 200, "mg/dL", 11.1, 0.01],
  ["obs.glucose", 100, "mg/dL", 5.55, 0.01],
  ["obs.glucose", 70, "mg/dL", 3.9, 0.02],
  ["obs.glucose", 180.156, "mg/dL", 10, 1e-9],
  ["obs.hba1c", 48, "mmol/mol", 6.5, 0.05],
  ["obs.hba1c", 53, "mmol/mol", 7.0, 0.05],
  ["obs.hba1c", 42, "mmol/mol", 6.0, 0.05],
  ["obs.hba1c", 64, "mmol/mol", 8.0, 0.05],
  ["obs.creatinine", 1, "mg/dL", 88.42, 1e-9],
  ["obs.creatinine", 1.5, "mg/dL", 132.63, 1e-9],
  ["obs.chol_total", 200, "mg/dL", 5.17, 0.01],
  ["obs.chol_hdl", 40, "mg/dL", 1.03, 0.01],
  ["obs.chol_ldl", 100, "mg/dL", 2.59, 0.01],
  ["obs.triglycerides", 150, "mg/dL", 1.69, 0.01],
  ["obs.urea", 14, "mg/dL", 5.0, 0.01],
  ["obs.uacr", 30, "mg/g", 3.39, 0.01],
  ["obs.uacr", 300, "mg/g", 33.9, 0.05],
  ["obs.haemoglobin", 120, "g/L", 12, 1e-9],
  ["obs.c_peptide", 1, "ng/mL", 0.331, 1e-9],
  ["obs.c_peptide", 600, "pmol/L", 0.6, 1e-9],
  ["obs.weight", 100, "[lb_av]", 45.359237, 1e-9],
  ["obs.height", 70, "[in_i]", 177.8, 1e-9],
  ["obs.temperature", 98.6, "[degF]", 37, 1e-9],
  ["obs.temperature", 32, "[degF]", 0, 1e-9],
  ["obs.temperature", 212, "[degF]", 100, 1e-9],
  ["obs.bilirubin_total", 1, "mg/dL", 17.1, 1e-9],
  ["obs.bilirubin_direct", 0.3, "mg/dL", 5.13, 1e-9],
  ["obs.calcium", 10, "mg/dL", 2.495, 0.001],
  ["obs.magnesium", 2, "mg/dL", 0.823, 0.001],
  ["obs.phosphate", 3.5, "mg/dL", 1.13, 0.001],
  ["obs.uric_acid", 6, "mg/dL", 356.88, 1e-9],
  ["obs.lactate", 18, "mg/dL", 2.0, 0.005],
  ["obs.albumin", 3.5, "g/dL", 35, 1e-9],
  ["obs.total_protein", 7, "g/dL", 70, 1e-9],
];

describe("known pairs", () => {
  it.each(PAIRS)("%s %d %s", (concept, value, unit, expected, tol) => {
    const r = toCanonical(concept, value, unit);
    if ("error" in r) throw new Error(r.error);
    expect(r.unit).toBe(canonicalUnit(concept));
    expect(Math.abs(r.value - expected)).toBeLessThanOrEqual(tol);
  });

  it("derives IFCC from stored NGSP: 6.5 % ≈ 48 mmol/mol", () => {
    const r = fromCanonical("obs.hba1c", 6.5, "mmol/mol");
    if ("error" in r) throw new Error(r.error);
    expect(r.unit).toBe("mmol/mol");
    expect(Math.round(r.value)).toBe(48);
  });

  it("displays 7.0 mmol/L as 126 mg/dL", () => {
    const r = fromCanonical("obs.glucose", 7.0, "mg/dL");
    expect("value" in r && Math.round(r.value)).toBe(126);
  });

  it("returns full precision (display rounds)", () => {
    const r = toCanonical("obs.glucose", 126, "mg/dL");
    expect("value" in r && r.value).toBe(126 / 18.0156);
  });
});

describe("canonical units (D-CFC-05)", () => {
  it.each([
    ["obs.glucose", "mmol/L"],
    ["obs.hba1c", "%"],
    ["obs.creatinine", "umol/L"],
    ["obs.uacr", "mg/mmol"],
    ["obs.haemoglobin", "g/dL"],
    ["obs.weight", "kg"],
    ["obs.height", "cm"],
    ["obs.temperature", "Cel"],
    ["obs.bilirubin_total", "umol/L"],
    ["obs.albumin", "g/L"],
  ])("%s → %s", (concept, unit) => expect(canonicalUnit(concept)).toBe(unit));

  it("canonical in is canonical out, untouched", () => {
    expect(toCanonical("obs.creatinine", 97.3, "umol/L")).toEqual({ value: 97.3, unit: "umol/L" });
  });

  it("unknown concept has no canonical unit", () => expect(canonicalUnit("obs.nope")).toBeNull());
});

describe("round trips", () => {
  const cases = Object.entries(UNIT_TABLE).flatMap(([concept, e]) =>
    Object.keys(e.from).map((unit) => [concept, unit] as const),
  );
  it.each(cases)("%s via %s", (concept, unit) => {
    for (const v of [0.37, 1, 42, 123.456]) {
      const c = toCanonical(concept, v, unit);
      if ("error" in c) throw new Error(c.error);
      const back = fromCanonical(concept, c.value, unit);
      if ("error" in back) throw new Error(back.error);
      expect(back.value).toBeCloseTo(v, 9);
    }
  });

  it("covers the 14 v1 + 9 v1.1 concepts", () => {
    expect(Object.keys(UNIT_TABLE)).toHaveLength(23);
    expect(acceptedUnits("obs.c_peptide")).toEqual(["nmol/L", "ng/mL", "pmol/L"]);
  });
});

describe("errors", () => {
  it("unknown unit → error", () => {
    expect(toCanonical("obs.glucose", 5, "mg/L")).toHaveProperty("error");
    expect(fromCanonical("obs.glucose", 5, "g/L")).toHaveProperty("error");
  });
  it("UCUM is case-sensitive: MG/DL is not mg/dL", () => {
    expect(toCanonical("obs.glucose", 126, "MG/DL")).toHaveProperty("error");
  });
  it("unknown concept → error", () => {
    expect(toCanonical("obs.wbc", 5, "10*9/L")).toHaveProperty("error");
  });
  it("non-finite value → error", () => {
    expect(toCanonical("obs.glucose", Number.NaN, "mmol/L")).toHaveProperty("error");
    expect(fromCanonical("obs.glucose", Infinity, "mg/dL")).toHaveProperty("error");
  });
});

describe("mismatch prompts (D-CFC-14): confirm, never reject", () => {
  // [concept, unit, fires, quiet, ask]
  const RULES: [string, string, number, number, string][] = [
    ["obs.glucose", "mmol/L", 60.1, 60, "Is this mg/dL?"],
    ["obs.hba1c", "%", 20.1, 20, "Is this IFCC mmol/mol?"],
    ["obs.creatinine", "umol/L", 14.9, 15, "Is this mg/dL?"],
    ["obs.haemoglobin", "g/dL", 30.1, 30, "Is this g/L?"],
    ["obs.chol_total", "mmol/L", 30.1, 30, "Is this mg/dL?"],
  ];
  it.each(RULES)("%s in %s", (concept, unit, fires, quiet, ask) => {
    expect(mismatchPrompt(concept, fires, unit)).toEqual({ ask });
    expect(mismatchPrompt(concept, quiet, unit)).toBeNull();
    // Prompting never blocks the value: it still converts.
    expect(toCanonical(concept, fires, unit)).toHaveProperty("value");
  });

  it("only fires for the rule's entered unit", () => {
    expect(mismatchPrompt("obs.glucose", 126, "mg/dL")).toBeNull();
    expect(mismatchPrompt("obs.creatinine", 1.2, "mg/dL")).toBeNull();
  });

  it("no rule for unsigned concepts (HDL, v1.1)", () => {
    expect(mismatchPrompt("obs.chol_hdl", 50, "mmol/L")).toBeNull();
    expect(mismatchPrompt("obs.calcium", 10, "mmol/L")).toBeNull();
  });
});

describe("comparators", () => {
  it.each([
    ["<0.5", "<", 0.5],
    ["> 33.3", ">", 33.3],
    ["<=5", "<=", 5],
    [">= 1e3", ">=", 1000],
    ["≤ 0.1", "<=", 0.1],
    ["≥40", ">=", 40],
    ["7.2", null, 7.2],
    [" .5 ", null, 0.5],
    ["-1.5", null, -1.5],
  ])("%s", (raw, comparator, value) => {
    expect(parseComparator(raw)).toEqual({ comparator, value });
  });

  it.each(["", "<", "abc", "5 mg", "<<5", "5.5.5", "=5"])("rejects %j", (raw) => {
    expect(parseComparator(raw)).toHaveProperty("error");
  });

  it("comparator direction survives conversion (all maps increase)", () => {
    const p = parseComparator("<10");
    if ("error" in p) throw new Error(p.error);
    const c = toCanonical("obs.creatinine", p.value, "mg/dL");
    expect(p.comparator).toBe("<");
    expect("value" in c && c.value).toBeCloseTo(884.2, 9);
  });
});
