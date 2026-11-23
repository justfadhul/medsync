import { describe, expect, it } from "vitest";

import { vitalsView } from "@/components/clerking/model";

const v = {
  respiratoryRate: 12,
  spo2: 95,
  spo2Scale: "scale1",
  oxygen: null,
  systolicBp: 110,
  pulse: 54,
  consciousness: null,
  temperature: 32.5,
} as const;

describe("the rail's vital-sign trend", () => {
  it("shows the earlier reading, and nothing without one", () => {
    const rows = vitalsView(v, [], {
      ageYears: 76,
      prev: { systolicBp: 126, diastolicBp: 84, pulse: 54, temperature: 31.9, spo2: null },
    }).rows;
    const t = (k: string) => rows.find((r) => r.key === k)?.trend;
    expect(t("systolic_bp")).toEqual({ was: "126/84" });
    expect(t("pulse")).toEqual({ was: "54" });
    expect(t("temperature")).toEqual({ was: "31.9" });
    expect(t("spo2")).toBeNull();
    expect(t("respiratory_rate")).toBeNull();
    expect(t("consciousness")).toBeNull();
  });
  it("is absent when no earlier readings are passed", () => {
    expect(vitalsView(v, []).rows.every((r) => !r.trend)).toBe(true);
  });
});
