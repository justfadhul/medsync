/**
 * The rest of the contract: sensitivity (C9 + SR-PREG-MINOR incl. imprecise DOB), the catalogue
 * refinements rejecting what the catalogue forbids, quarantine instead of throw (C11), the record
 * projections (medicines, allergies, pregnancy, context), manifest validation (C10, A4) and the
 * deterministic hash (property over 200 seeds).
 */
import type { ClinicalFact } from "@/lib/facts/types";
import { describe, expect, it } from "vitest";

import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { canonicalJson, snapshotHash } from "@/lib/facts/hash";
import { validateManifest } from "@/lib/facts/loader";
import { projectAllergy, projectAllergyAssertion } from "@/lib/facts/project/allergy";
import { projectCondition } from "@/lib/facts/project/condition";
import { projectContext } from "@/lib/facts/project/context";
import { projectDemographics } from "@/lib/facts/project/demographic";
import { projectMedication } from "@/lib/facts/project/medication";
import { projectObservation } from "@/lib/facts/project/observation";
import { projectPregnancy } from "@/lib/facts/project/pregnancy";
import { projectProcedure } from "@/lib/facts/project/procedure";
import { possiblyMinorAt } from "@/lib/facts/project/shared";
import { projectTriageVitals } from "@/lib/facts/project/triage-vitals";
import { FactSchema, validateFact } from "@/lib/facts/refinements";
import {
  allergyRow,
  assertionRow,
  cfcRowFor,
  conditionRow,
  def,
  H,
  medicationRow,
  P,
  pregnancyRow,
  procedureRow,
  T0,
  T1,
  triageRow,
} from "./_rows";

const RESTRICTED = Object.keys(CONCEPTS).filter((c) => def(c).sensitivity === "restricted");

describe("sensitivity (C9)", () => {
  it("the catalogue restricts 13 concepts (6 more by SR-PREG-MINOR)", () =>
    expect(RESTRICTED).toHaveLength(13));

  it.each(RESTRICTED)("%s is restricted even when the row says standard", (concept) => {
    const kind = def(concept).kind;
    const out =
      kind === "condition"
        ? projectCondition(conditionRow({ conceptId: concept, sensitivity: "standard" }))
        : projectObservation(cfcRowFor(concept, undefined, { sensitivity: "standard" }));
    expect(out.facts[0]!.sensitivity).toBe("restricted");
  });

  it("a restricted concept marked standard fails the contract", () => {
    const fact = projectCondition(conditionRow({ conceptId: "cond.hiv" })).facts[0]!;
    expect(FactSchema.safeParse({ ...fact, sensitivity: "standard" }).success).toBe(false);
  });

  it("a restricted drug class restricts the medicine", () => {
    expect(
      projectMedication(medicationRow({ classTags: ["dolutegravir"] })).facts[0]!.sensitivity,
    ).toBe("restricted");
    expect(projectMedication(medicationRow()).facts[0]!.sensitivity).toBe("standard");
  });

  describe("SR-PREG-MINOR (D-CFC-09, D-CFC-12)", () => {
    const at = "2026-03-01T08:00:00.000Z";
    it.each([
      [{ value: "2008-03-02", precision: "day" as const }, true], // 17, turns 18 tomorrow
      [{ value: "2008-03-01", precision: "day" as const }, false], // 18 today
      [{ value: "2008-03-01", precision: "month" as const }, true], // could be born 31 Mar 2008
      [{ value: "2008-02-01", precision: "month" as const }, false], // at the latest 29 Feb 2008
      [{ value: "2008-01-01", precision: "year" as const }, true], // could be born 31 Dec 2008
      [{ value: "2007-01-01", precision: "year" as const }, false],
      [{ value: "1970-01-01", precision: "estimated" as const }, true], // no bound: restrict
    ])("possiblyMinorAt(%o) = %s", (dob, minor) => expect(possiblyMinorAt(dob, at)).toBe(minor));

    it("a minor's pregnancy facts are restricted; an adult's are not", () => {
      const minor = projectPregnancy(pregnancyRow(), {
        dob: { value: "2010-06-01", precision: "day" },
      });
      expect(minor.facts.map((f) => f.sensitivity)).toEqual(Array(5).fill("restricted"));
      const adult = projectPregnancy(pregnancyRow(), {
        dob: { value: "1990-06-01", precision: "day" },
      });
      expect(adult.facts.map((f) => f.sensitivity)).toEqual(Array(5).fill("standard"));
    });

    it("obs.pregnancy_test is restricted for a minor", () => {
      const row = cfcRowFor("obs.pregnancy_test");
      expect(
        projectObservation(row, { dob: { value: "2012-01-01", precision: "day" } }).facts[0]!
          .sensitivity,
      ).toBe("restricted");
      expect(
        projectObservation(row, { dob: { value: "1990-01-01", precision: "day" } }).facts[0]!
          .sensitivity,
      ).toBe("standard");
    });

    it("a termination restricts every fact of the episode", () => {
      const out = projectPregnancy(pregnancyRow({ outcome: "termination" }));
      expect(out.facts.every((f) => f.sensitivity === "restricted")).toBe(true);
    });

    it("a row already restricted at insert is never lowered", () => {
      const out = projectPregnancy(pregnancyRow({ sensitivity: "restricted" }), {
        dob: { value: "1980-01-01", precision: "day" },
      });
      expect(out.facts.every((f) => f.sensitivity === "restricted")).toBe(true);
    });
  });
});

describe("catalogue refinements quarantine, never throw (C11)", () => {
  it("a coded answer outside the answer set", () => {
    const out = projectObservation(
      cfcRowFor("obs.malaria_test", undefined, { valueCode: "maybe" }),
    );
    expect(out.facts).toEqual([]);
    expect(out.quarantined[0]!.reason).toMatch(/not an answer/);
  });

  it("a reported unit the concept does not accept", () => {
    const out = projectObservation(cfcRowFor("obs.glucose", undefined, { valueUnit: "g/L" }));
    expect(out.quarantined[0]!.reason).toMatch(/not accepted/);
  });

  it("a value type that does not fit the concept", () => {
    const out = projectObservation(
      cfcRowFor("obs.glucose", undefined, { valueType: "coded", valueCode: "high" }),
    );
    expect(out.quarantined[0]!.reason).toMatch(/needs a quantity/);
  });

  it("a canonical unit that is not the concept's", () => {
    const fact = projectObservation(cfcRowFor("obs.glucose")).facts[0]!;
    const forged = {
      ...fact,
      value: { type: "quantity", value: 1, unit: "mmol/L", canonical: { value: 1, unit: "mg/dL" } },
    };
    expect(validateFact(forged)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/canonical unit/),
    });
  });

  it("an unknown concept, a wrong kind and a forged interpretable are rejected", () => {
    const fact = projectObservation(cfcRowFor("obs.glucose")).facts[0]!;
    expect(validateFact({ ...fact, concept: "obs.nonsense" }).ok).toBe(false);
    expect(validateFact({ ...fact, concept: "cond.hiv" }).ok).toBe(false);
    const missing = projectObservation(cfcRowFor("obs.glucose", "specimen")).facts[0]!;
    expect(validateFact({ ...missing, interpretable: { ok: true } }).ok).toBe(false);
  });

  it("a malformed jsonb context quarantines the row (strict schema)", () => {
    const out = projectObservation(
      cfcRowFor("obs.bp_systolic", undefined, { context: { position: "upside_down" } }),
    );
    expect(out.facts).toEqual([]);
    expect(out.quarantined).toHaveLength(1);
  });

  it("an unknown concept id on a row is quarantined, not thrown", () => {
    expect(
      projectObservation(cfcRowFor("obs.glucose", undefined, { conceptId: "obs.gone" }))
        .quarantined,
    ).toHaveLength(1);
  });

  it("fasting 'unknown' is missing, never fasting (C2)", () => {
    const f = projectObservation(cfcRowFor("obs.glucose", undefined, { fastingState: "unknown" }))
      .facts[0]!;
    expect(f.interpretable).toEqual({ ok: false, missing: ["fastingState"] });
  });
});

describe("record projections", () => {
  it("medication: tags, status, period; never a dose field", () => {
    const f = projectMedication(medicationRow()).facts[0]!;
    expect(f).toMatchObject({
      kind: "medication",
      concept: "medication",
      drug: "metformin",
      classTags: ["metformin", "glucose_lowering_any"],
      medicationStatus: "active",
      period: { start: "2026-01-01" },
      route: "oral",
    });
    expect(Object.keys(f).some((k) => /dose/i.test(k))).toBe(false);
  });

  it("an unknown class tag is quarantined", () => {
    expect(projectMedication(medicationRow({ classTags: ["not_a_tag"] })).quarantined).toHaveLength(
      1,
    );
  });

  it("an uncoded medicine carries no name (ciphertext is never a fact)", () => {
    const f = projectMedication(
      medicationRow({ drugCode: null, drugTextCiphertext: "iv:tag:ct", classTags: [] }),
    ).facts[0]!;
    expect(f).toMatchObject({ drug: "" });
    expect(JSON.stringify(f)).not.toContain("iv:tag:ct");
  });

  it("allergy: coded vs name-only; the text only when the caller supplies it", () => {
    const coded = projectAllergy(allergyRow()).facts[0]!;
    expect(coded).toMatchObject({
      kind: "allergy",
      matchedByNameOnly: false,
      substance: { code: "penicillin" },
    });
    const named = projectAllergy(
      allergyRow({
        substanceCode: null,
        substanceKind: null,
        substanceTextCiphertext: "iv:tag:ct",
      }),
      {
        text: "amoxicillin",
      },
    ).facts[0]!;
    expect(named).toMatchObject({ matchedByNameOnly: true, substance: { text: "amoxicillin" } });
  });

  it("allergy assertions project; an invalid one is refused, not thrown", () => {
    expect(projectAllergyAssertion(assertionRow())).toMatchObject({
      ok: true,
      assertion: { state: "no_known_drug_allergies" },
    });
    expect(projectAllergyAssertion(assertionRow({ assertion: "maybe" })).ok).toBe(false);
  });

  it("pregnancy: one fact per concept with a value; gestational age derived from the LMP", () => {
    const out = projectPregnancy(pregnancyRow({ effectiveAt: new Date("2026-03-01T08:00:00Z") }));
    expect(out.facts.map((f) => f.concept)).toEqual([
      "preg.status",
      "preg.gestational_age",
      "preg.edd",
      "preg.outcome",
      "preg.birth_weight",
    ]);
    expect(out.facts[1]).toMatchObject({
      gestation: { days: 59, basis: "lmp", asOf: "2026-03-01" },
    });
    const noLmp = projectPregnancy(
      pregnancyRow({ lnmp: null, outcome: null, birthWeightGrams: null }),
    );
    expect(noLmp.facts.map((f) => f.concept)).toEqual(["preg.status", "preg.edd"]);
    // No LMP: the EDD's basis cannot be carried (PregnancyFact has no EDD-basis slot).
    expect(noLmp.facts[1]!.interpretable).toEqual({ ok: false, missing: ["basis"] });
  });

  it("an uncoded procedure or condition reaches no engine", () => {
    expect(
      projectProcedure(procedureRow({ conceptId: null, textCiphertext: "iv:tag:ct" })),
    ).toEqual({ facts: [], quarantined: [] });
    expect(projectCondition(conditionRow({ textCiphertext: "iv:tag:ct" }))).toEqual({
      facts: [],
      quarantined: [],
    });
    expect(projectCondition(conditionRow(), { termConceptId: "cond.ckd" }).facts[0]!.concept).toBe(
      "cond.ckd",
    );
  });

  it("demographics: prefer_not_say → unknown; no facility → unaffiliated", () => {
    const f = projectDemographics({
      id: P,
      sex: "prefer_not_say",
      dateOfBirth: "1980-01-01",
      primaryFacilityId: null,
      createdAt: T1,
    }).facts;
    expect(f.map((x) => [x.concept, x.tenantId])).toEqual([
      ["demo.date_of_birth", "unaffiliated"],
      ["demo.sex_at_birth", "unaffiliated"],
    ]);
    expect(f[1]).toMatchObject({
      sexAtBirth: "unknown",
      dateOfBirth: { value: "1980-01-01", precision: "day" },
    });
  });

  it("context: no capabilities recorded → no capability fact (C3); unmapped encounter type → no setting", () => {
    const out = projectContext({
      patientId: P,
      hospital: { id: H, level: "hc4", updatedAt: T1 },
      capabilities: [],
      encounter: { id: H, encounterType: "follow_up", createdAt: T0 },
    });
    expect(out.facts.map((f) => f.concept)).toEqual(["ctx.facility_level"]);
  });
});

describe("manifest (C10, A4)", () => {
  it("dedupes and sorts", () =>
    expect(validateManifest(["obs.glucose", "allergy", "obs.glucose"])).toEqual([
      "allergy",
      "obs.glucose",
    ]));
  it("refuses an unknown concept", () =>
    expect(() => validateManifest(["obs.bogus"])).toThrow(/unknown concept/));
  it("refuses obs.uncatalogued", () =>
    expect(() => validateManifest(["obs.uncatalogued"])).toThrow(/never loaded/));
});

/* ─── Hash: same input → same hash (property, 200 seeds) ─── */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rebuild an object with its keys inserted in a random order (deep). */
function shuffleKeys(v: unknown, rnd: () => number): unknown {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, rnd));
  if (!v || typeof v !== "object") return v;
  const entries = Object.entries(v as Record<string, unknown>).sort(() => rnd() - 0.5);
  return Object.fromEntries(entries.map(([k, x]) => [k, shuffleKeys(x, rnd)]));
}

function world(seed: number): ClinicalFact[] {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const facts: ClinicalFact[] = [];
  const concepts = Object.keys(CONCEPTS).filter(
    (c) => ["observation", "finding"].includes(def(c).kind) && c !== "obs.uncatalogued",
  );
  const n = 1 + Math.floor(rnd() * 12);
  for (let i = 0; i < n; i++) {
    const r = rnd();
    const at = new Date(Date.UTC(2026, 0, 1 + Math.floor(rnd() * 300)));
    if (r < 0.5)
      facts.push(
        ...projectObservation(cfcRowFor(pick(concepts), undefined, { effectiveAt: at })).facts,
      );
    else if (r < 0.7)
      facts.push(
        ...projectTriageVitals(
          triageRow({
            pulse: Math.floor(rnd() * 150),
            spo2: 90 + Math.floor(rnd() * 10),
            oxygen: "air",
          }),
        ).facts,
      );
    else if (r < 0.85) facts.push(...projectMedication(medicationRow({ effectiveAt: at })).facts);
    else facts.push(...projectAllergy(allergyRow({ effectiveAt: at })).facts);
  }
  return facts;
}

describe("snapshot hash", () => {
  for (let seed = 1; seed <= 200; seed++) {
    it(`seed ${seed}: same facts, keys in any order → same hash; any change → another`, () => {
      const facts = world(seed);
      const asOf = "2026-09-26T00:00:00.000Z";
      const manifest = ["allergy", "medication", "obs.glucose"];
      const h = snapshotHash({ facts, asOf, manifest });
      const shuffled = shuffleKeys(facts, mulberry32(seed * 7919)) as ClinicalFact[];
      expect(snapshotHash({ facts: shuffled, asOf, manifest })).toBe(h);
      expect(snapshotHash({ facts: structuredClone(facts), asOf, manifest })).toBe(h);
      expect(snapshotHash({ facts, asOf: "2026-09-26T00:00:00.001Z", manifest })).not.toBe(h);
      expect(snapshotHash({ facts, asOf, manifest: [...manifest, "obs.hba1c"] })).not.toBe(h);
      const changed = structuredClone(facts);
      changed[0] = { ...changed[0]!, trust: changed[0]!.trust === 4 ? 3 : 4 };
      expect(snapshotHash({ facts: changed, asOf, manifest })).not.toBe(h);
    });
  }

  it("canonical JSON sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, { z: 1, y: 0 }] } })).toBe(
      '{"a":{"c":[2,{"y":0,"z":1}]},"b":1}',
    );
  });
});
