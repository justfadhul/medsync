/**
 * The NCD capture ↔ clinical fact bridge (lib/ncd/cfc-map.ts). Pure: every rule names a real NCD
 * feature and a real CFC concept, values move in the shape the concept holds, and the round trip
 * (capture → facts → capture) returns what was captured wherever the map claims both directions.
 */
import type { ClinicalFact } from "@/lib/facts/types";
import type { CaptureMap } from "@/lib/ncd/engine/evaluate";
import { describe, expect, it } from "vitest";

import { conceptDef } from "@/lib/facts/project/shared";
import { DIABETES_CATALOG } from "@/lib/ncd/catalog/diabetes";
import {
  captureFromFacts,
  captureFromNote,
  factsFromCapture,
  NCD_CFC_RULES,
  NCD_NOTE_SECTION,
} from "@/lib/ncd/cfc-map";

const AT = "2026-09-26T08:00:00.000Z";
const features = new Map(DIABETES_CATALOG.features.map((f) => [f.code, f]));
const rec = (value: unknown, at?: string) => ({ state: "recorded" as const, value, at });

/** A fact as the loader would hand it back for one written observation. */
function asFact(o: ReturnType<typeof factsFromCapture>[number]): ClinicalFact {
  const base = {
    id: `x:${o.conceptId}`,
    logicalId: o.conceptId,
    patientId: "p",
    tenantId: "h",
    concept: o.conceptId,
    effective: { at: o.effectiveAt },
    recordedAt: o.effectiveAt,
    status: "final",
    source: "clinician",
    trust: 3,
    sensitivity: "standard",
    provenance: { table: "clinical_observations", rowId: "r", version: 1 },
    interpretable: { ok: true },
  };
  const v = o.value;
  if (v.type === "presence")
    return {
      ...base,
      kind: "finding",
      token: o.conceptId,
      presence: v.presence,
      elicitedBy: "history",
    } as unknown as ClinicalFact;
  return {
    ...base,
    kind: "observation",
    value:
      v.type === "quantity"
        ? {
            type: "quantity",
            value: v.value,
            unit: v.unit,
            canonical: { value: v.value, unit: v.unit },
          }
        : { type: "coded", code: v.code },
    context: {},
  } as unknown as ClinicalFact;
}

describe("NCD ↔ CFC map", () => {
  it("every rule names a catalogued NCD feature and a CFC concept, once", () => {
    const seen = new Set<string>();
    for (const r of NCD_CFC_RULES) {
      expect(features.has(r.feature), r.feature).toBe(true);
      expect(conceptDef(r.concept), r.concept).toBeDefined();
      expect(seen.has(r.feature), `${r.feature} mapped twice`).toBe(false);
      seen.add(r.feature);
    }
    expect(NCD_CFC_RULES.length).toBeGreaterThanOrEqual(40);
  });

  it("quantity rules sit on quantity concepts in their canonical unit", () => {
    for (const r of NCD_CFC_RULES) {
      if (r.kind !== "quantity") continue;
      const def = conceptDef(r.concept)!;
      expect(def.valueType, r.concept).toBe("quantity");
      expect(def.canonicalUnit, r.concept).toBe(r.unit);
    }
  });

  it("select rules write only answers the concept accepts, and read only real options", () => {
    for (const r of NCD_CFC_RULES) {
      if (r.kind !== "select") continue;
      const def = conceptDef(r.concept)!;
      const f = features.get(r.feature)!;
      const options = new Set((f.options ?? []).map((o) => o.value));
      for (const [key, v] of Object.entries(r.to)) {
        if (f.valueType === "boolean") expect(["true", "false"], r.feature).toContain(key);
        else expect(options.has(key), `${r.feature}: ${key}`).toBe(true);
        if ("code" in v) expect(def.answers, `${r.concept} ${v.code}`).toContain(v.code);
        else expect(def.valueType, r.concept).toBe("presence");
      }
      for (const back of Object.values(r.from)) {
        if (typeof back === "boolean") expect(f.valueType, r.feature).toBe("boolean");
        else expect(options.has(back), `${r.feature} ← ${back}`).toBe(true);
      }
    }
  });

  it("writes quantities, series and findings with their clocks and context", () => {
    const values: CaptureMap = {
      capillary_glucose: rec(14.2),
      bp_systolic: rec([
        { value: 150, at: "2026-09-26T07:50:00.000Z" },
        { value: 142, at: "2026-09-26T07:55:00.000Z" },
      ]),
      polyuria: rec(true),
      deep_rapid_breathing: rec(false),
      pedal_pulses: rec("both"),
      bmi: rec(31),
      dehydration: rec(true),
    } as CaptureMap;
    const out = factsFromCapture(values, AT);
    const by = (c: string) => out.filter((o) => o.conceptId === c);
    expect(by("obs.glucose")).toEqual([
      {
        conceptId: "obs.glucose",
        effectiveAt: AT,
        value: { type: "quantity", value: 14.2, unit: "mmol/L" },
        specimen: "capillary_whole_blood",
        pointOfCare: true,
      },
    ]);
    expect(by("obs.bp_systolic").map((o) => o.effectiveAt)).toEqual([
      "2026-09-26T07:50:00.000Z",
      "2026-09-26T07:55:00.000Z",
    ]);
    expect(by("sx.polyuria")[0]).toMatchObject({
      value: { type: "presence", presence: "present" },
      context: { elicitedBy: "history" },
    });
    expect(by("sign.kussmaul_breathing")[0]!.value).toEqual({
      type: "presence",
      presence: "absent",
    });
    expect(by("exam.pedal_pulses")[0]).toMatchObject({
      value: { type: "coded", code: "present" },
      context: { laterality: "bilateral" },
    });
    // Derived values are never written from the form; an ungradable "yes" is not invented.
    expect(by("derived.bmi")).toEqual([]);
    expect(by("sign.dehydration")).toEqual([]);
  });

  it("not-assessed, unavailable and non-finite values write nothing", () => {
    const out = factsFromCapture(
      {
        hba1c: { state: "not_assessed" },
        waist_cm: { state: "unavailable", capability: "hba1c_lab" },
        weight_kg: rec(Number.NaN),
      } as CaptureMap,
      AT,
    );
    expect(out).toEqual([]);
  });

  it("round trip: capture → facts → capture keeps every two-way value", () => {
    const values: CaptureMap = {
      capillary_glucose: rec(9.1, AT),
      hba1c: rec(8.4, AT),
      weight_kg: rec(88, AT),
      pulse: rec([{ value: 96, at: AT }], AT),
      polydipsia: rec(true, AT),
      pallor: rec(false, AT),
      urine_ketones: rec("2plus", AT),
      cyanosis: rec("none", AT),
      avpu: rec("voice", AT),
    } as CaptureMap;
    const back = captureFromFacts(factsFromCapture(values, AT).map(asFact));
    expect(back).toEqual(values);
  });

  it("prefill takes the newest fact per concept, skips voided ones and comparators", () => {
    const f = (at: string, value: number, extra: Record<string, unknown> = {}) =>
      ({
        ...asFact({
          conceptId: "obs.hba1c",
          effectiveAt: at,
          value: { type: "quantity", value, unit: "%" },
        }),
        ...extra,
      }) as ClinicalFact;
    const facts = [
      f("2026-01-01T00:00:00.000Z", 7),
      f("2026-06-01T00:00:00.000Z", 9, { status: "entered_in_error" }),
      f("2026-03-01T00:00:00.000Z", 8),
    ];
    expect(captureFromFacts(facts).hba1c).toEqual(rec(8, "2026-03-01T00:00:00.000Z"));
    const cmp = f("2026-07-01T00:00:00.000Z", 14) as ClinicalFact & {
      value: { comparator?: string };
    };
    (cmp as { value: { comparator?: string } }).value.comparator = ">";
    expect(captureFromFacts([cmp]).hba1c).toBeUndefined();
  });

  it("reads the NCD capture out of a note's content", () => {
    const values = { polyuria: rec(true) } as CaptureMap;
    expect(
      captureFromNote({
        sections: { [NCD_NOTE_SECTION]: { items: [{ kind: "ncd_capture", values }] } },
      }),
    ).toEqual(values);
    expect(captureFromNote({ sections: {} })).toBeUndefined();
  });

  it("a value still exactly as pulled from the record is projected, never copied (HARMONISATION §5.1)", () => {
    const TRIAGE = "2026-09-26T07:10:00.000Z";
    const pulled = {
      capillary_glucose: rec(11.2, TRIAGE),
      pulse: rec([{ value: 96, at: TRIAGE }]),
      weight_kg: rec(88, TRIAGE),
    } as CaptureMap;
    const values = {
      capillary_glucose: rec(11.2, TRIAGE), // untouched: triage's (maybe venous, maybe lab)
      pulse: rec([
        { value: 96, at: TRIAGE },
        { value: 104, at: AT }, // the clinician's own reading
      ]),
      weight_kg: rec(86), // changed: now the clinician's
    } as CaptureMap;
    const out = factsFromCapture(values, AT, pulled);
    expect(out.map((o) => [o.conceptId, (o.value as { value: number }).value])).toEqual([
      ["obs.heart_rate", 104],
      ["obs.weight", 86],
    ]);
    expect(
      captureFromNote(
        {
          sections: {
            [NCD_NOTE_SECTION]: { items: [{ kind: "ncd_capture", values, pulled }] },
          },
        },
        "pulled",
      ),
    ).toEqual(pulled);
  });
});
