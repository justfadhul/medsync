/**
 * CFC §10 item 7: projection round-trip for EVERY concept in the catalogue (145 v1 + 59 v1.1).
 * A synthetic valid row per concept is projected, parsed by the full contract (structure + the
 * catalogue's refinements) and must be interpretable. Then each required context key is dropped in
 * turn: where the CFC type leaves it optional, the fact survives and `missing` names the key (C2);
 * where the type makes it structural, the row is quarantined (C11) or, if the key carries the value
 * itself, there is simply no fact (C3).
 */
import type { Projection } from "@/lib/facts/project/shared";
import { describe, expect, it } from "vitest";

import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { projectCondition } from "@/lib/facts/project/condition";
import { projectContext } from "@/lib/facts/project/context";
import { projectDemographics } from "@/lib/facts/project/demographic";
import { projectObservation } from "@/lib/facts/project/observation";
import { projectPregnancy } from "@/lib/facts/project/pregnancy";
import { projectProcedure } from "@/lib/facts/project/procedure";
import { FactSchema } from "@/lib/facts/refinements";
import { cfcRowFor, conditionRow, def, H, P, pregnancyRow, procedureRow, T0, T1 } from "./_rows";

type Id = keyof typeof CONCEPTS;
const ALL = Object.keys(CONCEPTS) as Id[];

const CONDITION_DROP: Record<string, object> = {
  clinicalStatus: { clinicalStatus: null },
  verificationStatus: { verification: null },
  assertedBy: { assertedBy: null },
  subjectRelation: { subjectRelation: null },
};
const PREGNANCY_DROP: Record<string, object> = {
  episodeId: { logicalId: "" },
  basis: { lnmp: null },
  asOf: { lnmp: null },
  date: { deliveredAt: null },
};

function project(concept: Id, drop?: string): Projection {
  const d = def(concept);
  const only = new Set([concept]);
  switch (d.kind) {
    case "observation":
    case "finding":
      return projectObservation(cfcRowFor(concept, drop));
    case "condition":
      return projectCondition(
        conditionRow({ conceptId: concept, ...(drop ? CONDITION_DROP[drop] : {}) }),
      );
    case "pregnancy":
      return projectPregnancy(pregnancyRow(drop ? PREGNANCY_DROP[drop] : {}), { concepts: only });
    case "procedure":
      return projectProcedure(
        procedureRow({
          conceptId: concept,
          ...(drop === "outcome" ? { outcome: null as never } : {}),
        }),
      );
    case "demographic":
      return projectDemographics(
        { id: P, sex: "female", dateOfBirth: "1990-05-17", primaryFacilityId: H, createdAt: T1 },
        { concepts: only },
      );
    case "context":
      return projectContext(
        {
          patientId: P,
          hospital: { id: H, level: "national_referral", updatedAt: T1 },
          capabilities: drop
            ? []
            : [{ capabilityId: "cap.glucometer", status: "intermittent", updatedAt: T1 }],
          encounter: { id: H, encounterType: "opd", createdAt: T0 },
        },
        { concepts: only },
      );
  }
}

describe("round-trip: every catalogue concept projects, validates and is interpretable", () => {
  it("covers the whole catalogue (145 v1 + 59 v1.1)", () => {
    expect(ALL).toHaveLength(204);
  });

  it.each(ALL)("%s", (concept) => {
    const out = project(concept);
    if (concept === "obs.uncatalogued") {
      // A4: stored encrypted, shown as "Uncatalogued", never a fact.
      expect(out).toEqual({ facts: [], quarantined: [] });
      return;
    }
    expect(out.quarantined).toEqual([]);
    expect(out.facts).toHaveLength(1);
    const fact = out.facts[0]!;
    expect(fact.concept).toBe(concept);
    expect(FactSchema.safeParse(fact).success).toBe(true);
    expect(fact.interpretable).toEqual({ ok: true });
    expect(fact.sensitivity).toBe(
      def(concept).sensitivity === "restricted" ? "restricted" : "standard",
    );
  });
});

/** Keys the CFC type makes structural: dropping them cannot give a well-typed fact. */
const STRUCTURAL: Record<string, readonly string[]> = {
  finding: ["elicitedBy"],
  condition: ["clinicalStatus", "verificationStatus", "assertedBy", "subjectRelation"],
  pregnancy: ["episodeId"],
  procedure: ["outcome"],
};
/** Keys that carry the value itself: without them the concept has nothing to say (C3). */
const VALUE_KEYS: Record<string, readonly string[]> = {
  "preg.gestational_age": ["basis", "asOf"],
  "ctx.facility_capability": ["capabilityStatus", "updatedAt"],
};

const DROPS = ALL.flatMap((concept) => {
  const d = def(concept);
  // demo.date_of_birth: precision is part of the DOB value and always 'day' from the profile.
  if (concept === "obs.uncatalogued" || concept === "demo.date_of_birth") return [];
  return d.contextRequired.map((key) => [concept, key] as const);
});

describe("drop one required context key", () => {
  it("exercises every droppable (concept, key) pair", () => {
    expect(DROPS.length).toBeGreaterThan(200);
  });

  it.each(DROPS)("%s without %s", (concept, key) => {
    const out = project(concept, key);
    const d = def(concept);
    const kind = d.kind === "finding" && d.valueType !== "presence" ? "observation" : d.kind;
    if (VALUE_KEYS[concept]?.includes(key)) {
      expect(out).toEqual({ facts: [], quarantined: [] });
    } else if (STRUCTURAL[kind]?.includes(key)) {
      expect(out.facts).toEqual([]);
      expect(out.quarantined).toHaveLength(1);
    } else {
      expect(out.quarantined).toEqual([]);
      expect(out.facts).toHaveLength(1);
      const fact = out.facts[0]!;
      expect(fact.interpretable.ok).toBe(false);
      if (!fact.interpretable.ok) expect(fact.interpretable.missing).toContain(key);
      expect(FactSchema.safeParse(fact).success).toBe(true);
    }
  });
});
