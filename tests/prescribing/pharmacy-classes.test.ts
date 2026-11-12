import { describe, expect, it } from "vitest";

import { CLASSES } from "@/content/pharmacy-medicines";
import { DRUG_CLASSES, DRUGS } from "@/lib/prescribing/formulary";
import { pharmacyClassOf, pharmacyGroups } from "@/lib/prescribing/pharmacy-classes";

describe("one class list for Prescribe and the pharmacy", () => {
  it("maps every formulary class to a member of the pharmacy's CLASSES", () => {
    expect(DRUG_CLASSES).toHaveLength(75);
    for (const c of DRUG_CLASSES)
      expect(CLASSES as readonly string[], c.id).toContain(pharmacyClassOf(c.id));
  });

  it("groups every medicine once, in the pharmacy list's order, with no empty class", () => {
    const groups = pharmacyGroups();
    expect(groups.flatMap((g) => g.drugs)).toHaveLength(DRUGS.length);
    const order = groups.map((g) => CLASSES.indexOf(g.name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(groups.every((g) => g.drugs.length > 0)).toBe(true);
    expect(pharmacyClassOf("oral_glucose_lowering.biguanide")).toBe("Antidiabetics");
    expect(pharmacyClassOf("abx.cephalosporin.3")).toBe("Antibiotics");
  });
});
