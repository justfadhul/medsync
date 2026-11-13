/**
 * GATE A D-CF-20 / G1: the typed re-check band on `monitor_interval` is a projection of the sentence the engine
 * already writes — every branch maps 1:1, and no other recommendation carries one.
 */
import type { TriageInput, TriageVitals } from "@/lib/triage/types";
import { describe, expect, it } from "vitest";

import { runTriage } from "@/lib/triage/engine";
import { RECHECK_DUE_MINUTES, recommend } from "@/lib/triage/recommend";

const calm: TriageVitals = {
  respiratoryRate: 16,
  spo2: 98,
  oxygen: "air",
  systolicBp: 124,
  diastolicBp: 78,
  pulse: 72,
  consciousness: "A",
  temperature: 36.8,
  bloodGlucose: null,
};
const input = (v: Partial<TriageVitals>): TriageInput => ({
  context: {
    ageYears: 40,
    pregnancy: "not_pregnant",
    reproductiveAgeFemale: false,
    spo2Scale2Enabled: false,
  },
  vitals: { ...calm, ...v },
});
const SENTENCE = {
  continuous: "continuous monitoring",
  hourly: "re-vitals at minimum hourly",
  "4-6h": "4–6 hourly",
  "12h": "12 hourly",
  short: "short re-vitals interval",
} as const;

describe("re-check band (G1)", () => {
  it("over random inputs, the band always matches the sentence, and every band is reached", () => {
    let seed = 11;
    const r = (lo: number, hi: number) =>
      lo + Math.floor(((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * (hi - lo + 1));
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const base = input({
        respiratoryRate: r(6, 34),
        spo2: r(84, 100),
        oxygen: r(0, 4) === 0 ? "oxygen" : "air",
        systolicBp: r(80, 200),
        diastolicBp: r(40, 110),
        pulse: r(38, 140),
        consciousness: r(0, 10) === 0 ? "C" : "A",
        temperature: r(345, 400) / 10,
      });
      const child = r(0, 5) === 0;
      const recs = recommend(
        runTriage(child ? { ...base, context: { ...base.context, ageYears: 4 } } : base),
      );
      const mon = recs.find((x) => x.code === "monitor_interval")!;
      expect(mon.suggestion).toContain(SENTENCE[mon.recheck!]);
      expect(recs.filter((x) => x.recheck !== undefined)).toHaveLength(1);
      seen.add(mon.recheck!);
    }
    expect([...seen].sort()).toEqual(["12h", "4-6h", "continuous", "hourly", "short"]);
  });
  it("only the 'at minimum hourly' bands fall due on the floor", () => {
    expect(RECHECK_DUE_MINUTES).toEqual({ continuous: 60, hourly: 60 });
  });
});
