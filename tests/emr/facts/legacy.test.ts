/**
 * The read-only projections of what exists today (cfc-v1.1-addendum A6, B5): legacy
 * clinical_observations kinds, triage vitals snapshots, problem_list / encounter_diagnoses,
 * encounter_medications. Each legacy kind and snapshot key has its test; ACVPU 'C' and the kinds
 * with no concept are quarantined with a reason, never dropped.
 */
import type { ObservationFact } from "@/lib/facts/types";
import { describe, expect, it } from "vitest";

import {
  icd10ConceptIndex,
  projectLegacyDiagnosis,
  projectLegacyProblem,
} from "@/lib/facts/project/condition";
import {
  LEGACY_KIND_CONCEPTS,
  projectLegacyObservation,
  UNCATALOGUED_LEGACY_KINDS,
} from "@/lib/facts/project/legacy-observation";
import { projectLegacyMedication } from "@/lib/facts/project/medication";
import { projectObservation } from "@/lib/facts/project/observation";
import { projectTriageVitals } from "@/lib/facts/project/triage-vitals";
import {
  diagnosisRow,
  H,
  legacyMedicationRow,
  legacyRow,
  problemRow,
  T0,
  T1,
  triageRow,
} from "./_rows";

const obs = (f: unknown) => f as ObservationFact;
const qty = (f: unknown) => {
  const v = obs(f).value;
  if (v.type !== "quantity") throw new Error("not a quantity");
  return v;
};

describe("legacy clinical_observations", () => {
  it("bp → systolic + diastolic, ids :sys/:dia, mmHg read as mm[Hg]", () => {
    const row = legacyRow("bp", { numericValue1: "128", numericValue2: "84", unit: "mmHg" });
    const out = projectLegacyObservation(row);
    expect(out.quarantined).toEqual([]);
    expect(out.facts.map((f) => [f.id, f.concept])).toEqual([
      [`clinical_observations:${row.id}:sys`, "obs.bp_systolic"],
      [`clinical_observations:${row.id}:dia`, "obs.bp_diastolic"],
    ]);
    expect(qty(out.facts[0]).canonical).toEqual({ value: 128, unit: "mm[Hg]" });
    expect(qty(out.facts[1]).value).toBe(84);
    // No position, arm, cuff, device, setting or reading set was ever recorded (C2).
    expect(out.facts[0]!.interpretable).toEqual({
      ok: false,
      missing: ["position", "arm", "cuffSize", "device", "setting", "readingSetId", "readingIndex"],
    });
  });

  it("bp with one half gives one fact", () => {
    const out = projectLegacyObservation(legacyRow("bp", { numericValue1: "110", unit: "mmHg" }));
    expect(out.facts.map((f) => f.concept)).toEqual(["obs.bp_systolic"]);
    expect(out.quarantined).toEqual([]);
  });

  it.each([
    ["hr", "/min", "obs.heart_rate", 88, "/min"],
    ["rr", "/min", "obs.resp_rate", 18, "/min"],
    ["spo2", "%", "obs.spo2", 97, "%"],
    ["gcs", "/15", "obs.gcs", 15, "{score}"],
    ["weight", "kg", "obs.weight", 70, "kg"],
    ["height", "cm", "obs.height", 170, "cm"],
    ["temperature", "°C", "obs.temperature", 37.2, "Cel"],
    ["glucose", "mmol/L", "obs.glucose", 6.1, "mmol/L"],
  ])("%s (%s) → %s", (kind, unit, concept, value, canonicalUnit) => {
    const out = projectLegacyObservation(legacyRow(kind, { numericValue1: String(value), unit }));
    expect(out.quarantined).toEqual([]);
    expect(out.facts).toHaveLength(1);
    expect(out.facts[0]!.concept).toBe(concept);
    expect(qty(out.facts[0]).canonical).toEqual({ value, unit: canonicalUnit });
    expect(LEGACY_KIND_CONCEPTS[kind]).toContain(concept);
  });

  it("source poc_staff, trust 3; effective = recorded_at, knowledge = created_at", () => {
    const f = projectLegacyObservation(legacyRow("hr", { numericValue1: "70", unit: "/min" }))
      .facts[0]!;
    expect([f.source, f.trust, f.status]).toEqual(["poc_staff", 3, "final"]);
    expect(f.effective).toEqual({ at: T0.toISOString() });
    expect(f.recordedAt).toBe(T1.toISOString());
  });

  it("°F and lb convert through lib/units", () => {
    const t = projectLegacyObservation(
      legacyRow("temperature", { numericValue1: "98.6", unit: "°F" }),
    );
    expect(qty(t.facts[0]).canonical.value).toBeCloseTo(37, 5);
    expect(qty(t.facts[0]).unit).toBe("[degF]");
    const w = projectLegacyObservation(legacyRow("weight", { numericValue1: "100", unit: "lbs" }));
    expect(qty(w.facts[0]).canonical.value).toBeCloseTo(45.359237, 6);
  });

  it("glucose: specimen and fasting unknown → stored, non-interpretable (never a confirm lane)", () => {
    const f = projectLegacyObservation(
      legacyRow("glucose", { numericValue1: "180", unit: "mg/dL" }),
    ).facts[0]!;
    expect(qty(f).canonical.value).toBeCloseTo(180 / 18.0156, 6);
    expect(obs(f).context).toMatchObject({ specimen: "unknown", fastingState: "unknown" });
    expect(f.interpretable).toEqual({ ok: false, missing: ["specimen", "fastingState"] });
  });

  it("spo2 without oxygen support is non-interpretable", () => {
    const f = projectLegacyObservation(legacyRow("spo2", { numericValue1: "94", unit: "%" }))
      .facts[0]!;
    expect(f.interpretable).toEqual({ ok: false, missing: ["oxygenSupport"] });
  });

  it("height without a measurement method is non-interpretable", () => {
    const f = projectLegacyObservation(legacyRow("height", { numericValue1: "160", unit: "cm" }))
      .facts[0]!;
    expect(f.interpretable).toEqual({ ok: false, missing: ["measurement"] });
  });

  it("pain: pain_scale → scale when it is a catalogue scale; otherwise missing", () => {
    const ok = projectLegacyObservation(
      legacyRow("pain", { numericValue1: "6", painScale: "nrs_0_10" }),
    ).facts[0]!;
    expect(ok.concept).toBe("obs.pain_score");
    expect(obs(ok).context.qualifiers).toEqual({ scale: "nrs_0_10" });
    expect(ok.interpretable).toEqual({ ok: true });
    const free = projectLegacyObservation(
      legacyRow("pain", { numericValue1: "6", painScale: "0-10 bad" }),
    ).facts[0]!;
    expect(free.interpretable).toEqual({ ok: false, missing: ["scale"] });
  });

  it("a null unit is read as the concept's only unit, never guessed for a convertible concept", () => {
    expect(projectLegacyObservation(legacyRow("hr", { numericValue1: "70" })).facts).toHaveLength(
      1,
    );
    const g = projectLegacyObservation(legacyRow("glucose", { numericValue1: "7" }));
    expect(g.facts).toEqual([]);
    expect(g.quarantined[0]!.reason).toMatch(/unit missing/);
  });

  it("an unrecognised unit is quarantined", () => {
    const out = projectLegacyObservation(
      legacyRow("hr", { numericValue1: "70", unit: "furlongs" }),
    );
    expect(out.facts).toEqual([]);
    expect(out.quarantined).toHaveLength(1);
  });

  it("a row with no value is quarantined", () => {
    expect(projectLegacyObservation(legacyRow("hr", { unit: "/min" })).quarantined).toHaveLength(1);
  });

  it.each([
    ["A", "alert"],
    ["V", "voice"],
    ["P", "pain"],
    ["U", "unresponsive"],
  ])("acvpu %s → obs.avpu %s", (letter, code) => {
    const f = projectLegacyObservation(legacyRow("acvpu", { notes: letter })).facts[0]!;
    expect(f.concept).toBe("obs.avpu");
    expect(obs(f).value).toEqual({ type: "coded", code });
  });

  it("acvpu C (new confusion) is quarantined with a reason", () => {
    const out = projectLegacyObservation(legacyRow("acvpu", { notes: "C" }));
    expect(out.facts).toEqual([]);
    expect(out.quarantined[0]!.reason).toMatch(/'C'.*no AVPU answer/);
  });

  it("acvpu without a letter is quarantined, and notes text is never read otherwise", () => {
    const out = projectLegacyObservation(legacyRow("acvpu", { notes: "patient alert and chatty" }));
    expect(out.facts).toEqual([]);
    expect(out.quarantined).toHaveLength(1);
  });

  it.each(UNCATALOGUED_LEGACY_KINDS)("%s has no concept: quarantined as uncatalogued", (kind) => {
    const out = projectLegacyObservation(legacyRow(kind, { numericValue1: "4", unit: "kPa" }));
    expect(out.facts).toEqual([]);
    expect(out.quarantined[0]!.reason).toMatch(/no catalogue concept/);
  });

  it("free-text notes never reach a fact", () => {
    const out = projectLegacyObservation(
      legacyRow("hr", { numericValue1: "70", unit: "/min", notes: "SECRET NOTE" }),
    );
    expect(JSON.stringify(out)).not.toContain("SECRET NOTE");
  });

  it("corrected (resus retraction) → entered_in_error; before the correction was made, final", () => {
    const row = legacyRow("hr", {
      numericValue1: "70",
      unit: "/min",
      state: "corrected",
      updatedAt: new Date("2026-03-02T00:00:00Z"),
    });
    expect(projectLegacyObservation(row).facts[0]!.status).toBe("entered_in_error");
    expect(projectLegacyObservation(row, { asOf: "2026-03-01T12:00:00Z" }).facts[0]!.status).toBe(
      "final",
    );
  });

  it("routing guards: a CFC row is not legacy and a legacy row is not CFC", () => {
    expect(
      projectLegacyObservation(legacyRow("hr", { conceptId: "obs.heart_rate" })).quarantined,
    ).toHaveLength(1);
    expect(projectObservation(legacyRow("hr")).quarantined).toHaveLength(1);
  });
});

describe("triage_records.vitals_snapshot", () => {
  const full = {
    systolicBp: 132,
    diastolicBp: 86,
    pulse: 96,
    respiratoryRate: 20,
    temperature: 38.1,
    spo2: 95,
    bloodGlucose: 9.4,
    consciousness: "A",
    oxygen: "air",
  };

  it("every snapshot key → its concept, ids triage_records:<id>:<component>", () => {
    const row = triageRow(full);
    const out = projectTriageVitals(row);
    expect(out.quarantined).toEqual([]);
    expect(
      out.facts.map((f) => [f.id.slice(`triage_records:${row.id}:`.length), f.concept]),
    ).toEqual([
      ["sys", "obs.bp_systolic"],
      ["dia", "obs.bp_diastolic"],
      ["hr", "obs.heart_rate"],
      ["rr", "obs.resp_rate"],
      ["temp", "obs.temperature"],
      ["spo2", "obs.spo2"],
      ["glucose", "obs.glucose"],
      ["avpu", "obs.avpu"],
    ]);
    for (const f of out.facts)
      expect([f.source, f.trust, f.effective]).toEqual(["poc_staff", 3, { at: T0.toISOString() }]);
  });

  it("oxygen → oxygenSupport, so triage SpO2 is interpretable", () => {
    const air = projectTriageVitals(triageRow({ spo2: 95, oxygen: "air" })).facts[0]!;
    expect(obs(air).context.qualifiers).toEqual({ oxygenSupport: "room_air" });
    expect(air.interpretable).toEqual({ ok: true });
    const o2 = projectTriageVitals(triageRow({ spo2: 92, oxygen: "oxygen" })).facts[0]!;
    expect(obs(o2).context.qualifiers).toEqual({ oxygenSupport: "supplemental_oxygen" });
    expect(
      projectTriageVitals(triageRow({ spo2: 92, oxygen: null })).facts[0]!.interpretable.ok,
    ).toBe(false);
  });

  it("glucose: specimen and fasting unknown → non-interpretable", () => {
    const f = projectTriageVitals(triageRow({ bloodGlucose: 12 })).facts[0]!;
    expect(f.interpretable).toEqual({ ok: false, missing: ["specimen", "fastingState"] });
  });

  it("null = not measured: no fact, no quarantine", () => {
    expect(
      projectTriageVitals(triageRow({ ...full, pulse: null, consciousness: null })).facts,
    ).toHaveLength(6);
  });

  it("a rapid Step-0 record ({ rapid: true }) gives no facts", () => {
    expect(projectTriageVitals(triageRow({ rapid: true }))).toEqual({ facts: [], quarantined: [] });
  });

  it("consciousness C is quarantined; a non-number is quarantined; the rest survive", () => {
    const out = projectTriageVitals(
      triageRow({ pulse: "fast", consciousness: "C", respiratoryRate: 18 }),
    );
    expect(out.facts.map((f) => f.concept)).toEqual(["obs.resp_rate"]);
    expect(out.quarantined.map((q) => q.reason)).toEqual([
      "pulse is not a number",
      "ACVPU 'C' (new confusion) has no AVPU answer until a concept is signed",
    ]);
  });

  it("asks only for the concepts it is given (C10)", () => {
    const out = projectTriageVitals(triageRow(full), {
      concepts: new Set(["obs.heart_rate"] as const),
    });
    expect(out.facts.map((f) => f.concept)).toEqual(["obs.heart_rate"]);
  });

  it("a snapshot that is not an object is quarantined; an unidentified patient gives nothing", () => {
    expect(projectTriageVitals(triageRow("garbage")).quarantined).toHaveLength(1);
    expect(projectTriageVitals(triageRow(full, { patientUserId: null }))).toEqual({
      facts: [],
      quarantined: [],
    });
  });
});

describe("legacy conditions", () => {
  const index = icd10ConceptIndex([
    {
      id: "cond.dm_type2",
      codes: [
        { system: "ICD-10 (WHO)", code: "E11" },
        { system: "ICD-11", code: "5A11" },
      ],
    },
    { id: "cond.hiv", codes: [{ system: "ICD-10 (WHO)", code: "B20-B24" }] },
    { id: "cond.dka", codes: [{ system: "ICD-10 (WHO)", code: "E10.1-E14.1" }] },
    { id: "cond.a", codes: [{ system: "ICD-10 (WHO)", code: "X99" }] },
    { id: "cond.b", codes: [{ system: "ICD-10 (WHO)", code: "X99" }] },
  ]);

  it("ICD-10 → concept: exact, then category; ranges are not expanded; a shared code maps to neither", () => {
    expect(index("E11")).toBe("cond.dm_type2");
    expect(index("e11.9")).toBe("cond.dm_type2");
    expect(index("B21")).toBeNull();
    expect(index("E11.1")).toBe("cond.dm_type2");
    expect(index("X99")).toBeNull();
    expect(index(null)).toBeNull();
  });

  it("problem_list → condition: imported, trust 1, unconfirmed; inactive = resolved", () => {
    const f = projectLegacyProblem(problemRow(), "cond.dm_type2").facts[0]!;
    expect(f).toMatchObject({
      kind: "condition",
      source: "imported",
      trust: 1,
      verification: "unconfirmed",
      clinicalStatus: "active",
      subject: "self",
      codes: { icd10: "E11" },
    });
    const resolved = projectLegacyProblem(
      problemRow({ active: false, resolvedAt: T1 }),
      "cond.dm_type2",
    ).facts[0]!;
    expect(resolved).toMatchObject({ clinicalStatus: "resolved", abatement: T1.toISOString() });
    expect(JSON.stringify(f)).not.toContain("lane problem text");
  });

  it("an uncoded legacy row reaches no engine", () => {
    expect(projectLegacyProblem(problemRow({ icd10Code: null }), null)).toEqual({
      facts: [],
      quarantined: [],
    });
  });

  it.each([
    ["working", "provisional"],
    ["final", "confirmed"],
    ["excluded", "refuted"],
  ])("encounter_diagnoses %s → %s", (status, verification) => {
    const row = diagnosisRow({ status });
    const f = projectLegacyDiagnosis(row, "cond.dm_type2", H).facts[0]!;
    expect(f).toMatchObject({ verification, tenantId: H, source: "imported", trust: 1 });
    expect(f.provenance.encounterId).toBe(row.encounterId);
  });

  it("a restricted concept stays restricted on a legacy row", () => {
    expect(
      projectLegacyProblem(problemRow({ icd10Code: "B20" }), "cond.hiv").facts[0]!.sensitivity,
    ).toBe("restricted");
  });
});

describe("legacy encounter_medications", () => {
  it("never projects dose or frequency; status and route mapped; patient_reported, imported", () => {
    const f = projectLegacyMedication(legacyMedicationRow({ status: "suspended" }), H).facts[0]!;
    expect(f).toMatchObject({
      kind: "medication",
      drug: "Metformin",
      medicationStatus: "on_hold",
      route: "oral",
      medicationSource: "patient_reported",
      source: "imported",
      trust: 1,
    });
    const json = JSON.stringify(f);
    expect(json).not.toContain("500 mg");
    expect(json).not.toContain("BD");
    expect(json).not.toMatch(/dose|frequency/i);
  });

  it("a route outside the enum is left out rather than guessed", () => {
    expect(
      projectLegacyMedication(legacyMedicationRow({ route: "per rectum-ish" }), H).facts[0],
    ).not.toHaveProperty("route", expect.anything());
  });
});
