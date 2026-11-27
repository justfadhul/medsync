import { afterEach, describe, expect, it, vi } from "vitest";

import { euObservationLiveFor } from "@/lib/wards/feature";

const on = (extra: Record<string, string> = {}) => {
  const env = {
    EU_OBSERVATION: "1",
    WARD_BUILDER: "1",
    ENCOUNTER_CLOSE_V2: "1",
    EMR_V1: "1",
    ENCOUNTER_ENGINE_LIVE: "1",
    ...extra,
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
};

afterEach(() => vi.unstubAllEnvs());

describe("euObservationLiveFor", () => {
  it("is on when it and its prerequisites are", () => {
    on();
    expect(euObservationLiveFor("h1")).toBe(true);
  });
  it.each(["WARD_BUILDER", "ENCOUNTER_CLOSE_V2"])("is off without %s", (k) => {
    on({ [k]: "" });
    expect(euObservationLiveFor("h1")).toBe(false);
  });
  it("takes a trimmed list of hospital ids", () => {
    on({ EU_OBSERVATION: "h1, h2" });
    expect(euObservationLiveFor("h2")).toBe(true);
    expect(euObservationLiveFor("h3")).toBe(false);
  });
  it("is off when unset", () => {
    on({ EU_OBSERVATION: "" });
    expect(euObservationLiveFor("h1")).toBe(false);
  });
});
