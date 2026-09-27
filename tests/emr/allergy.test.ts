import type { AllergyRow, AssertionRow } from "@/lib/emr/allergy";
import { describe, expect, it } from "vitest";

import {
  compareWorstFirst,
  currentAllergies,
  currentAssertion,
  NAME_ONLY_LABEL,
  prescribingAllergyInput,
  resolveAllergyStatus,
} from "@/lib/emr/allergy";
import { runSafetyChecks } from "@/lib/prescribing/engine";
import { getEmergencyDrug } from "@/lib/prescribing/reference/emergency-drug-catalog";

const H1 = "hospital-1";
const H2 = "hospital-2";
const T0 = Date.UTC(2026, 8, 1);
const at = (days: number) => new Date(T0 + days * 86_400_000);

let n = 0;
function allergy(p: Partial<AllergyRow> = {}): AllergyRow {
  const id = p.id ?? `a${++n}`;
  return {
    id,
    logicalId: p.logicalId ?? id,
    version: 1,
    hospitalId: H1,
    status: "final",
    substanceKind: null,
    substanceCode: null,
    substanceText: "Penicillin",
    criticality: null,
    severity: null,
    manifestations: [],
    clinicalStatus: "active",
    verification: "unconfirmed",
    effectiveAt: at(0),
    recordedAt: at(0),
    informant: "patient",
    ...p,
  };
}

function assertion(p: Partial<AssertionRow> = {}): AssertionRow {
  return {
    id: p.id ?? `s${++n}`,
    hospitalId: H1,
    assertion: "no_known_drug_allergies",
    assertedByUserId: "dr-okello",
    asserterCadre: "MO",
    assertedAt: at(0),
    recordedAt: at(0),
    status: "final",
    supersedesId: null,
    ...p,
  };
}

describe("the four statuses", () => {
  it("not recorded: nothing at all (never shown as NKDA)", () => {
    expect(resolveAllergyStatus([], [])).toEqual({ kind: "not_recorded" });
  });
  it("NKDA: asserted by a named person at a time", () => {
    expect(resolveAllergyStatus([], [assertion({ assertedAt: at(3) })])).toEqual({
      kind: "no_known_drug_allergies",
      assertedByUserId: "dr-okello",
      asserterCadre: "MO",
      assertedAt: at(3),
      hospitalId: H1,
    });
  });
  it("unable to assess", () => {
    expect(resolveAllergyStatus([], [assertion({ assertion: "unable_to_assess" })]).kind).toBe(
      "unable_to_assess",
    );
  });
  it("listed", () => {
    const s = resolveAllergyStatus([allergy()], []);
    expect(s.kind).toBe("listed");
  });
});

describe("an active allergy outranks any assertion", () => {
  it("outranks an NKDA asserted later", () => {
    expect(
      resolveAllergyStatus([allergy({ effectiveAt: at(0) })], [assertion({ assertedAt: at(9) })])
        .kind,
    ).toBe("listed");
  });
  it("outranks unable to assess", () => {
    expect(
      resolveAllergyStatus([allergy()], [assertion({ assertion: "unable_to_assess" })]).kind,
    ).toBe("listed");
  });
  it("from another hospital, still outranks this hospital's NKDA (STOP 1)", () => {
    const s = resolveAllergyStatus([allergy({ hospitalId: H2 })], [assertion({ hospitalId: H1 })]);
    expect(s.kind === "listed" && s.allergies[0]?.hospitalIds).toEqual([H2]);
  });
});

describe("what does not count as an allergy", () => {
  it("refuted is excluded (NKDA then shows)", () => {
    expect(resolveAllergyStatus([allergy({ verification: "refuted" })], [assertion()]).kind).toBe(
      "no_known_drug_allergies",
    );
  });
  it("entered in error is excluded", () => {
    expect(resolveAllergyStatus([allergy({ status: "entered_in_error" })], []).kind).toBe(
      "not_recorded",
    );
  });
  it("cancelled is excluded", () => {
    expect(resolveAllergyStatus([allergy({ status: "cancelled" })], []).kind).toBe("not_recorded");
  });
  it("resolved and inactive are not listed", () => {
    expect(
      resolveAllergyStatus(
        [allergy({ clinicalStatus: "resolved" }), allergy({ clinicalStatus: "inactive" })],
        [],
      ).kind,
    ).toBe("not_recorded");
  });
});

describe("supersession by logical_id/version", () => {
  it("the newest version wins, in any input order", () => {
    const v1 = allergy({ id: "v1", logicalId: "L", version: 1, criticality: "low" });
    const v2 = allergy({ id: "v2", logicalId: "L", version: 2, criticality: "high" });
    expect(currentAllergies([v2, v1]).map((r) => r.id)).toEqual(["v2"]);
    expect(currentAllergies([v1, v2]).map((r) => r.id)).toEqual(["v2"]);
  });
  it("a refuting version 2 removes the allergy even though version 1 was active", () => {
    const v1 = allergy({ logicalId: "L", version: 1 });
    const v2 = allergy({ logicalId: "L", version: 2, verification: "refuted" });
    expect(resolveAllergyStatus([v1, v2], [assertion()]).kind).toBe("no_known_drug_allergies");
  });
  it("a version 2 entered in error voids it", () => {
    const v1 = allergy({ logicalId: "L", version: 1 });
    const v2 = allergy({ logicalId: "L", version: 2, status: "entered_in_error" });
    expect(resolveAllergyStatus([v1, v2], []).kind).toBe("not_recorded");
  });
  it("a migrated row (resus AMPLE) arrives unconfirmed and still lists", () => {
    const s = resolveAllergyStatus(
      [allergy({ informant: "resus_ample_migration", verification: "unconfirmed" })],
      [],
    );
    expect(s.kind).toBe("listed");
  });
});

describe("assertions", () => {
  it("the newest assertion is current", () => {
    const a = assertion({ id: "old", assertion: "unable_to_assess", assertedAt: at(1) });
    const b = assertion({ id: "new", assertedAt: at(2) });
    expect(currentAssertion([b, a])?.id).toBe("new");
  });
  it("a voided (entered-in-error) assertion no longer counts, and the one before shows again", () => {
    const first = assertion({ id: "first", assertion: "unable_to_assess", assertedAt: at(1) });
    const nkda = assertion({ id: "nkda", assertedAt: at(2) });
    const voiding = assertion({
      id: "void",
      status: "entered_in_error",
      supersedesId: "nkda",
      assertedAt: at(3),
    });
    expect(resolveAllergyStatus([], [first, nkda, voiding]).kind).toBe("unable_to_assess");
    expect(resolveAllergyStatus([], [nkda, voiding]).kind).toBe("not_recorded");
  });
  it("ties on asserted time break on recorded time", () => {
    const a = assertion({ id: "x", assertion: "unable_to_assess", recordedAt: at(1) });
    const b = assertion({ id: "y", recordedAt: at(2) });
    expect(currentAssertion([a, b])?.id).toBe("y");
  });
});

describe("listed: worst criticality first, duplicates grouped", () => {
  it("high, unable to assess, low, unknown", () => {
    const rows = [
      allergy({ id: "low", criticality: "low", substanceText: "A1" }),
      allergy({ id: "none", criticality: null, substanceText: "A2" }),
      allergy({ id: "high", criticality: "high", substanceText: "A3" }),
      allergy({ id: "uta", criticality: "unable_to_assess", substanceText: "A4" }),
    ];
    const s = resolveAllergyStatus(rows, []);
    expect(s.kind === "listed" && s.allergies.map((l) => l.allergy.id)).toEqual([
      "high",
      "uta",
      "low",
      "none",
    ]);
  });
  it("then severity, then anaphylaxis, then newest", () => {
    const a = allergy({ id: "mild", severity: "mild" });
    const b = allergy({ id: "severe", severity: "severe" });
    expect([a, b].sort(compareWorstFirst).map((r) => r.id)).toEqual(["severe", "mild"]);
    const c = allergy({ id: "rash", manifestations: ["rash"] });
    const d = allergy({ id: "ana", manifestations: ["anaphylaxis"] });
    expect([c, d].sort(compareWorstFirst).map((r) => r.id)).toEqual(["ana", "rash"]);
    const e = allergy({ id: "old", effectiveAt: at(1) });
    const f = allergy({ id: "new", effectiveAt: at(2) });
    expect([e, f].sort(compareWorstFirst).map((r) => r.id)).toEqual(["new", "old"]);
  });
  it("the same substance recorded twice (two hospitals) groups under the worst record", () => {
    const rows = [
      allergy({ id: "h1", substanceText: "penicillin", criticality: "low", hospitalId: H1 }),
      allergy({ id: "h2", substanceText: " Penicillin ", criticality: "high", hospitalId: H2 }),
      allergy({ id: "x", substanceText: "Sulfa" }),
    ];
    const s = resolveAllergyStatus(rows, []);
    if (s.kind !== "listed") throw new Error("expected listed");
    expect(s.allergies).toHaveLength(2);
    const [worst] = s.allergies;
    expect(worst?.allergy.id).toBe("h2");
    expect(worst?.duplicates.map((d) => d.id)).toEqual(["h1"]);
    expect(worst?.hospitalIds).toEqual([H2, H1]);
  });
  it("coded records group by code and are marked coded", () => {
    const rows = [
      allergy({
        id: "c1",
        substanceKind: "drug_ingredient",
        substanceCode: "adrenaline",
        substanceText: null,
      }),
      allergy({
        id: "c2",
        substanceKind: "drug_ingredient",
        substanceCode: "adrenaline",
        substanceText: "Epi",
      }),
    ];
    const s = resolveAllergyStatus(rows, []);
    expect(s.kind === "listed" && s.allergies.map((l) => [l.coded, l.duplicates.length])).toEqual([
      [true, 1],
    ]);
  });
});

describe("prescribing input (runSafetyChecks)", () => {
  it("uncoded text is passed through, labelled 'matched by name only' [H]", () => {
    const r = prescribingAllergyInput([allergy({ substanceText: "Penicillin" })]);
    expect(r.allergies).toEqual(["Penicillin"]);
    expect(r.entries).toEqual([
      { value: "Penicillin", coded: false, hospitalId: H1, label: NAME_ONLY_LABEL },
    ]);
  });
  it("a coded ingredient passes as the formulary drugKey", () => {
    const r = prescribingAllergyInput([
      allergy({
        substanceKind: "drug_ingredient",
        substanceCode: "amiodarone",
        substanceText: "cordarone",
      }),
    ]);
    expect(r.entries).toEqual([{ value: "amiodarone", coded: true, hospitalId: H1, label: null }]);
  });
  it("a coded class passes as the formulary drugClass and blocks every drug of that class", () => {
    const r = prescribingAllergyInput([
      allergy({
        substanceKind: "drug_class",
        substanceCode: "Benzodiazepine",
        substanceText: null,
      }),
    ]);
    const benzo = getEmergencyDrug("lorazepam_seizure_iv");
    if (!benzo) throw new Error("no benzodiazepine in the catalogue");
    const flags = runSafetyChecks({
      drug: benzo,
      patient: { ageYears: 40, weightKg: 70, allergies: r.allergies, conditions: [] },
      priorAdministrations: [],
    });
    expect(flags.some((f) => f.code === "allergy" && f.severity === "block")).toBe(true);
  });
  it("a code the formulary does not know falls back to its text, labelled", () => {
    const r = prescribingAllergyInput([
      allergy({
        substanceKind: "drug_ingredient",
        substanceCode: "not_a_key",
        substanceText: "Ceftriaxone",
      }),
    ]);
    expect(r.entries).toEqual([
      { value: "Ceftriaxone", coded: false, hospitalId: H1, label: NAME_ONLY_LABEL },
    ]);
  });
  it("includes allergies from every hospital, each with its hospital (STOP 1)", () => {
    const r = prescribingAllergyInput([
      allergy({ substanceText: "Sulfa", hospitalId: H1 }),
      allergy({ substanceText: "Aspirin", hospitalId: H2 }),
    ]);
    expect(r.entries.map((e) => [e.value, e.hospitalId]).sort()).toEqual([
      ["Aspirin", H2],
      ["Sulfa", H1],
    ]);
  });
  it("excludes refuted, entered-in-error and resolved allergies", () => {
    const r = prescribingAllergyInput([
      allergy({ substanceText: "A", verification: "refuted" }),
      allergy({ substanceText: "B", status: "entered_in_error" }),
      allergy({ substanceText: "C", clinicalStatus: "resolved" }),
    ]);
    expect(r.allergies).toEqual([]);
  });
  it("adds the current resus episode's captures, deduplicated case-insensitively (no gap)", () => {
    const r = prescribingAllergyInput(
      [allergy({ substanceText: "Penicillin" })],
      ["penicillin", " Latex ", ""],
    );
    expect(r.allergies).toEqual(["Penicillin", "Latex"]);
    expect(r.entries[1]).toEqual({
      value: "Latex",
      coded: false,
      hospitalId: null,
      label: NAME_ONLY_LABEL,
    });
  });
  it("end to end: a recorded text allergy blocks the matching drug in runSafetyChecks", () => {
    const drug = getEmergencyDrug("adrenaline_anaphylaxis_im");
    if (!drug) throw new Error("no adrenaline entry");
    const r = prescribingAllergyInput([allergy({ substanceText: "Adrenaline" })]);
    const flags = runSafetyChecks({
      drug,
      patient: { ageYears: 40, weightKg: 70, allergies: r.allergies, conditions: [] },
      priorAdministrations: [],
    });
    expect(flags[0]).toMatchObject({ code: "allergy", severity: "block" });
  });
});

/* ─── Property: never NKDA while an active allergy exists (200 seeds) ─ */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function oneOf<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}

describe("property: status is never NKDA (or unable to assess) while an active allergy exists", () => {
  for (let seed = 1; seed <= 200; seed++) {
    it(`seed ${seed}`, () => {
      const rnd = mulberry32(seed);
      const allergies: AllergyRow[] = [];
      for (let l = 0; l < Math.floor(rnd() * 4); l++) {
        for (let v = 1; v <= 1 + Math.floor(rnd() * 3); v++) {
          allergies.push(
            allergy({
              id: `${seed}-${l}-${v}`,
              logicalId: `${seed}-${l}`,
              version: v,
              hospitalId: oneOf(rnd, [H1, H2]),
              status: oneOf(rnd, ["final", "final", "amended", "entered_in_error", "cancelled"]),
              verification: oneOf(rnd, ["unconfirmed", "confirmed", "refuted"]),
              clinicalStatus: oneOf(rnd, ["active", "active", "inactive", "resolved"]),
              criticality: oneOf(rnd, ["low", "high", "unable_to_assess", null]),
              substanceText: oneOf(rnd, ["Penicillin", "Sulfa", "Latex"]),
              effectiveAt: at(Math.floor(rnd() * 30)),
            }),
          );
        }
      }
      const assertions: AssertionRow[] = [];
      for (let i = 0; i < Math.floor(rnd() * 4); i++) {
        const prior = assertions.length ? oneOf(rnd, assertions) : null;
        const voiding = !!prior && rnd() < 0.3;
        assertions.push(
          assertion({
            id: `${seed}-s${i}`,
            assertion: oneOf(rnd, ["no_known_drug_allergies", "unable_to_assess"]),
            assertedAt: at(Math.floor(rnd() * 60)),
            status: voiding ? "entered_in_error" : "final",
            supersedesId: voiding ? prior.id : null,
          }),
        );
      }

      // Independent oracle: the newest version per logical id, then the activity rule.
      const newest = new Map<string, AllergyRow>();
      for (const r of allergies)
        if ((newest.get(r.logicalId)?.version ?? 0) < r.version) newest.set(r.logicalId, r);
      const anyActive = [...newest.values()].some(
        (r) =>
          r.status !== "entered_in_error" &&
          r.status !== "cancelled" &&
          r.verification !== "refuted" &&
          r.clinicalStatus === "active",
      );

      const s = resolveAllergyStatus(allergies, assertions);
      if (anyActive) {
        expect(s.kind).toBe("listed");
        if (s.kind === "listed") {
          // Worst first holds across groups.
          const heads = s.allergies.map((g) => g.allergy);
          expect([...heads].sort(compareWorstFirst)).toEqual(heads);
          expect(prescribingAllergyInput(allergies).allergies.length).toBeGreaterThan(0);
        }
      } else {
        expect(s.kind).not.toBe("listed");
        expect(prescribingAllergyInput(allergies).allergies).toEqual([]);
      }
    });
  }
});
