/**
 * S6 / T10: the floor's triage panel is a pure consumer of the engine. For 200 seeded observation sets, the input
 * the panel builds from what the nurse typed gives exactly the engine result of the same observations given to the
 * engine directly (the nurse desk's path); each manual Step 0 sign gives L1.
 */
import type { Draft } from "@/components/clinic-floor/shared";
import type { FloorPerson } from "@/lib/clinic-floor/fixture";
import type { Acvpu, TriageInput } from "@/lib/triage/types";
import { describe, expect, it } from "vitest";

import { draftInput, THREATS } from "@/components/clinic-floor/shared";
import { runTriage } from "@/lib/triage/engine";

let seed = 20261113;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const person = (age: number, sex: "F" | "M") => ({ age, sex }) as FloorPerson;
const blank: Draft = {
  threats: [],
  none: true,
  v: {},
  avpu: "A",
  o2: false,
  sugar: false,
  pick: null,
  why: "",
  clinic: "x",
  doc: null,
  note: "",
};

describe("triage panel ↔ engine parity", () => {
  it("200 seeded observation sets give the engine's own level and reasons", () => {
    for (let i = 0; i < 200; i++) {
      const age = int(16, 95);
      const sex = pick(["F", "M"] as const);
      const v = {
        sys: int(60, 230),
        dia: int(30, 130),
        pulse: int(30, 180),
        rr: int(6, 40),
        spo2: int(78, 100),
        temp: Math.round((34 + rnd() * 7) * 10) / 10,
        sugar: Math.round((1.5 + rnd() * 25) * 10) / 10,
      };
      const avpu = pick(["A", "C", "V", "P"] as Acvpu[]);
      const o2 = rnd() < 0.2;
      const sugar = rnd() < 0.5;
      const d: Draft = {
        ...blank,
        avpu,
        o2,
        sugar,
        v: Object.fromEntries(Object.entries(v).map(([k, n]) => [k, String(n)])),
      };
      const direct: TriageInput = {
        context: {
          ageYears: age,
          pregnancy: "unknown",
          reproductiveAgeFemale: sex === "F" && age < 50,
          spo2Scale2Enabled: false,
        },
        vitals: {
          systolicBp: v.sys,
          diastolicBp: v.dia,
          pulse: v.pulse,
          respiratoryRate: v.rr,
          spo2: v.spo2,
          temperature: v.temp,
          bloodGlucose: sugar ? v.sugar : null,
          oxygen: o2 ? "oxygen" : "air",
          consciousness: avpu,
        },
        lifeThreatFlags: {},
      };
      const a = runTriage(draftInput(person(age, sex), d));
      const b = runTriage(direct);
      expect(a.level).toBe(b.level);
      expect(a.reasoning).toEqual(b.reasoning);
    }
  });

  it("each manual Step 0 sign is L1 whatever the observations", () => {
    for (const [, key] of THREATS) {
      const r = runTriage(draftInput(person(40, "M"), { ...blank, none: false, threats: [key] }));
      expect(r.level).toBe(1);
      expect(r.lifeThreat).toBe(true);
    }
  });

  it("a comma decimal reads as a number; an empty box is missing, never zero", () => {
    const i = draftInput(person(40, "F"), { ...blank, v: { temp: "37,8", pulse: "" } });
    expect(i.vitals.temperature).toBe(37.8);
    expect(i.vitals.pulse).toBeNull();
  });
});
