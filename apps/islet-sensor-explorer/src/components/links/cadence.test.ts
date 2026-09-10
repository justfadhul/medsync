import { describe, expect, it } from "vitest";

import { CYCLE, LINKS } from "@/content/sensor";
import {
  buildCadenceSteps,
  CADENCE_STEPS,
  cadenceSeconds,
  cyclesFor,
  loopCycles,
  normaliseStepIndex,
  stepDwellMs,
  stepFiresOnCycle,
  tierFor,
} from "./cadence";

/**
 * The cadence sequence is derived from each link's own cadence string, never
 * from a list of part ids written out by hand. These tests pin the derivation,
 * not the wording: they read the content file and check what falls out of it.
 */

describe("cadenceSeconds", () => {
  it("reads an interval, and reports a link that waits for an event", () => {
    expect(cadenceSeconds("Every 60 s")).toBe(60);
    expect(cadenceSeconds("Every 60 s; hourly")).toBe(60);
    expect(cadenceSeconds("Every 5 min and on event")).toBe(300);
    expect(cadenceSeconds("Continuous")).toBe(0);
    expect(cadenceSeconds("Continuous; hourly")).toBe(0);
    expect(cadenceSeconds("On clinician action")).toBeNull();
  });
});

describe("cyclesFor and tierFor", () => {
  it("counts measurement cycles between firings", () => {
    expect(cyclesFor("Every 60 s")).toBe(1);
    expect(cyclesFor("Continuous")).toBe(1);
    expect(cyclesFor("Every 5 min and on event")).toBe(5);
    expect(cyclesFor("As needed")).toBe(0);
  });

  it("sorts a cadence into its tier", () => {
    expect(tierFor("Every 60 s")).toBe("cycle");
    expect(tierFor("Every 5 min and on event")).toBe("multi-cycle");
    expect(tierFor("When bridged")).toBe("on-demand");
  });
});

describe("buildCadenceSteps", () => {
  it("carries every link exactly once", () => {
    const carried = CADENCE_STEPS.flatMap((step) => step.links);
    expect(carried).toHaveLength(LINKS.length);
    expect(new Set(carried.map((link) => `${link.from}-${link.to}`)).size).toBe(LINKS.length);
  });

  it("is as long as the counter the store steps in", () => {
    expect(CADENCE_STEPS).toHaveLength(CYCLE.length);
  });

  it("puts the links that fire every cycle first and the ones that wait last", () => {
    const tiers = CADENCE_STEPS.map((step) => step.tier);
    const rank = { cycle: 0, "multi-cycle": 1, "on-demand": 2 } as const;
    const ranks = tiers.map((tier) => rank[tier]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("opens with the optical link that starts a measurement", () => {
    const first = CADENCE_STEPS[0];
    expect(first?.tier).toBe("cycle");
    expect(first?.links[0]?.path).toBe("optical");
  });

  it("marks the steps that carry the insulin path, and only those", () => {
    const insulinSteps = CADENCE_STEPS.filter((step) => step.carriesInsulin);
    const pairs = insulinSteps.flatMap((step) =>
      step.links.filter((link) => link.path === "insulin").map((link) => `${link.from}-${link.to}`),
    );
    const fromContent = LINKS.filter((link) => link.path === "insulin").map(
      (link) => `${link.from}-${link.to}`,
    );
    expect(new Set(pairs)).toEqual(new Set(fromContent));
  });

  it("keeps the content order inside a step", () => {
    const rebuilt = buildCadenceSteps(LINKS);
    expect(rebuilt.map((step) => step.cadence)).toEqual(CADENCE_STEPS.map((step) => step.cadence));
  });
});

describe("playback timing", () => {
  it("runs the measurement cycle long enough to watch", () => {
    expect(stepDwellMs()).toBeGreaterThan(0);
  });

  it("holds the slower step back until its cycle comes round", () => {
    const slow = CADENCE_STEPS.find((step) => step.tier === "multi-cycle");
    expect(slow).toBeDefined();
    if (!slow) return;
    expect(stepFiresOnCycle(slow, 1)).toBe(false);
    expect(stepFiresOnCycle(slow, slow.everyNthCycle)).toBe(true);
    expect(loopCycles()).toBe(slow.everyNthCycle);
  });

  it("keeps a step index inside the sequence however the counter has wrapped", () => {
    expect(normaliseStepIndex(0, 10)).toBe(0);
    expect(normaliseStepIndex(12, 10)).toBe(2);
    expect(normaliseStepIndex(-1, 10)).toBe(9);
    expect(normaliseStepIndex(3, 0)).toBe(0);
  });
});
