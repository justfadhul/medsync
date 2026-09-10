import type { PlaygroundInputs } from "@/lib/playground";
import { describe, expect, it } from "vitest";

import { PHYSICS, STATES } from "@/content/sensor";
import { DEFAULT_INPUTS, holdTrust, runModel } from "@/lib/playground";

function inputs(overrides: Partial<PlaygroundInputs> = {}): PlaygroundInputs {
  return { ...DEFAULT_INPUTS, ...overrides };
}

const stateOf = (overrides: Partial<PlaygroundInputs> = {}) => runModel(inputs(overrides)).state.id;

describe("the four cases the brief names", () => {
  it("(a) the default inputs give valid", () => {
    const result = runModel(inputs());
    expect(result.state.id).toBe("valid");
    expect(result.agree).toBe(true);
    // Both sensors read back the glucose that was put in.
    expect(result.a.value).toBeCloseTo(PHYSICS.glucose.default, 10);
    expect(result.b.value).toBeCloseTo(PHYSICS.glucose.default, 10);
  });

  it("(b) paracetamol with no fouling gives invalid, because no health evidence points anywhere", () => {
    const result = runModel(inputs({ paracetamol: true, fouling: 0 }));
    expect(result.state.id).toBe("invalid");
    expect(result.agree).toBe(false);
    expect(result.a.flags).toHaveLength(0);
    expect(result.b.flags).toHaveLength(0);
  });

  it("(c) fouling at 70 per cent gives doubtful with the electrochemical sensor flagged", () => {
    const result = runModel(inputs({ fouling: 70 }));
    expect(result.state.id).toBe("doubtful-one");
    expect(result.b.flags.length).toBeGreaterThan(0);
    expect(result.a.flags).toHaveLength(0);
  });

  it("(d) mannitol with fouling at 70 per cent gives invalid, because both sensors are flagged", () => {
    const result = runModel(inputs({ mannitol: true, fouling: 70 }));
    expect(result.state.id).toBe("invalid");
    expect(result.a.flags.length).toBeGreaterThan(0);
    expect(result.b.flags.length).toBeGreaterThan(0);
  });
});

describe("the model arithmetic, against the constants in the content file", () => {
  it("reads the ratio straight off the optical line", () => {
    const { ratio } = runModel(inputs({ glucose: 10 }));
    expect(ratio).toBeCloseTo(PHYSICS.optical.intercept + PHYSICS.optical.slope * 10, 10);
  });

  it("reads the current straight off the enzymatic line", () => {
    const { current } = runModel(inputs({ glucose: 10 }));
    expect(current).toBeCloseTo(PHYSICS.enzymatic.intercept + PHYSICS.enzymatic.slope * 10, 10);
  });

  it("mannitol pushes the optical reading high, never low", () => {
    const clean = runModel(inputs());
    const fooled = runModel(inputs({ mannitol: true }));
    expect(fooled.a.value).toBeGreaterThan(clean.a.value);
    expect(fooled.b.value).toBeCloseTo(clean.b.value, 10);
  });

  it("paracetamol pushes the enzymatic reading high, never low", () => {
    const clean = runModel(inputs());
    const fooled = runModel(inputs({ paracetamol: true }));
    expect(fooled.b.value).toBeGreaterThan(clean.b.value);
    expect(fooled.a.value).toBeCloseTo(clean.a.value, 10);
  });

  it("low oxygen pulls the enzymatic reading down above the threshold and leaves it alone below", () => {
    const threshold = PHYSICS.enzymatic.lowOxygenThresholdMmol;
    const below = runModel(inputs({ glucose: threshold, lowOxygen: true }));
    const belowClean = runModel(inputs({ glucose: threshold }));
    expect(below.b.value).toBeCloseTo(belowClean.b.value, 10);

    const above = runModel(inputs({ glucose: threshold + 5, lowOxygen: true }));
    const aboveClean = runModel(inputs({ glucose: threshold + 5 }));
    expect(above.b.value).toBeLessThan(aboveClean.b.value);
  });

  it("fouling pulls the current down in proportion", () => {
    const clean = runModel(inputs());
    const fouled = runModel(inputs({ fouling: 50 }));
    const expected = clean.current * (1 - PHYSICS.enzymatic.foulingCurrentFactor * 0.5);
    expect(fouled.current).toBeCloseTo(expected, 10);
  });

  it("photobleaching dims both optical channels equally and leaves the ratio untouched", () => {
    const clean = runModel(inputs());
    for (const percent of [10, 50, 90, 100]) {
      const dim = runModel(inputs({ photobleaching: percent }));
      expect(dim.ratio, `${percent} per cent`).toBeCloseTo(clean.ratio, 10);
      expect(dim.a.value, `${percent} per cent`).toBeCloseTo(clean.a.value, 10);
      const share = 1 - percent / 100;
      expect(dim.channels.reference).toBeCloseTo(clean.channels.reference * share, 10);
      expect(dim.channels.glow).toBeCloseTo(clean.channels.glow * share, 10);
    }
  });

  it("never moves the state on photobleaching alone, at any glucose", () => {
    for (let glucose = PHYSICS.glucose.min; glucose <= PHYSICS.glucose.max; glucose += 0.5) {
      for (const percent of [0, 25, 50, 75, 100]) {
        expect(stateOf({ glucose, photobleaching: percent }), `${glucose} at ${percent}`).toBe(
          "valid",
        );
      }
    }
  });

  it("uses the wider of the absolute and the relative tolerance", () => {
    const low = runModel(inputs({ glucose: 3 }));
    expect(low.tolerance).toBeCloseTo(PHYSICS.tolerance.absoluteMmol, 10);
    const high = runModel(inputs({ glucose: 24 }));
    expect(high.tolerance).toBeCloseTo(
      PHYSICS.tolerance.relativeFraction * ((high.a.value + high.b.value) / 2),
      10,
    );
  });

  it("flags the electrochemical sensor above the fouling threshold and not at it", () => {
    const at = runModel(inputs({ fouling: PHYSICS.flags.foulingFlagPercent }));
    expect(at.b.flags).toHaveLength(0);
    const above = runModel(inputs({ fouling: PHYSICS.flags.foulingFlagPercent + 1 }));
    expect(above.b.flags.length).toBeGreaterThan(0);
  });
});

describe("bridging", () => {
  it("lifts an invalid state to bridged and no further", () => {
    const invalid = runModel(inputs({ paracetamol: true }));
    expect(invalid.state.id).toBe("invalid");
    const bridged = runModel(inputs({ paracetamol: true, bridged: true }));
    expect(bridged.state.id).toBe("bridged");
    expect(bridged.state.autonomy).toBeLessThan(
      STATES.find((state) => state.id === "valid")?.autonomy ?? 0,
    );
  });

  it("does not touch a state that is not invalid", () => {
    expect(stateOf({ bridged: true })).toBe("valid");
    expect(stateOf({ fouling: 70, bridged: true })).toBe("doubtful-one");
  });
});

/* ------------------------------------------------------------------ */
/* The grid the property tests run over                                */
/* ------------------------------------------------------------------ */

const GLUCOSE_GRID = [2, 4, 6, 8, 11, 12, 13, 16, 20, 25];
const PERCENT_GRID = [0, 20, 40, 50, 51, 70, 100];
const BOOLS = [false, true];

function* everyInput(): Generator<PlaygroundInputs> {
  for (const glucose of GLUCOSE_GRID) {
    for (const mannitol of BOOLS) {
      for (const paracetamol of BOOLS) {
        for (const lowOxygen of BOOLS) {
          for (const fouling of PERCENT_GRID) {
            for (const photobleaching of PERCENT_GRID) {
              yield {
                glucose,
                mannitol,
                paracetamol,
                lowOxygen,
                fouling,
                photobleaching,
                bridged: false,
              };
            }
          }
        }
      }
    }
  }
}

/** True when b is impaired at least as much as a in every respect, and worse in one. */
function strictlyWorse(a: PlaygroundInputs, b: PlaygroundInputs): boolean {
  const notBetter =
    b.glucose === a.glucose &&
    b.mannitol >= a.mannitol &&
    b.paracetamol >= a.paracetamol &&
    b.lowOxygen >= a.lowOxygen &&
    b.fouling >= a.fouling &&
    b.photobleaching >= a.photobleaching;
  const worseSomewhere =
    b.mannitol !== a.mannitol ||
    b.paracetamol !== a.paracetamol ||
    b.lowOxygen !== a.lowOxygen ||
    b.fouling !== a.fouling ||
    b.photobleaching !== a.photobleaching;
  return notBetter && worseSomewhere;
}

describe("(e) autonomy never rises when trust falls", () => {
  it("has no state above valid, so nothing can ever exceed full bounded autonomy", () => {
    const valid = STATES.find((state) => state.id === "valid");
    expect(valid).toBeDefined();
    for (const state of STATES) {
      expect(state.autonomy, state.id).toBeLessThanOrEqual(valid?.autonomy ?? 0);
    }
  });

  it("never gives an impaired reading more autonomy than the clean reading beside it", () => {
    for (const candidate of everyInput()) {
      const clean = runModel({
        ...candidate,
        mannitol: false,
        paracetamol: false,
        lowOxygen: false,
        fouling: 0,
        photobleaching: 0,
      });
      const impaired = runModel(candidate);
      expect(
        impaired.state.autonomy,
        `glucose ${candidate.glucose}, mannitol ${candidate.mannitol}, paracetamol ${candidate.paracetamol}, low oxygen ${candidate.lowOxygen}, fouling ${candidate.fouling}, photobleaching ${candidate.photobleaching}`,
      ).toBeLessThanOrEqual(clean.state.autonomy);
    }
  });

  it("holds trust down: once the picture has been worse, autonomy does not come back", () => {
    // Over every ordered pair on the grid where the second is worse than the
    // first, the held state after both is never more autonomous than after the
    // first, and never more autonomous than the worse of the two.
    const sample = [...everyInput()];
    for (const first of sample) {
      const worse = sample.find((candidate) => strictlyWorse(first, candidate));
      if (!worse) continue;
      const one = runModel(first).state;
      const two = runModel(worse).state;
      const held = holdTrust(one, two);
      expect(held.autonomy).toBeLessThanOrEqual(one.autonomy);
      // And recovering the clean inputs afterwards does not lift it back.
      const recovered = holdTrust(
        held,
        runModel({
          ...first,
          mannitol: false,
          paracetamol: false,
          lowOxygen: false,
          fouling: 0,
          photobleaching: 0,
        }).state,
      );
      expect(recovered.autonomy).toBeLessThanOrEqual(held.autonomy);
    }
  });

  it("lets bridging lift a suspended controller to basal only, and nothing else lift anything", () => {
    const byId = Object.fromEntries(STATES.map((state) => [state.id, state]));
    const invalid = byId.invalid;
    const bridged = byId.bridged;
    const valid = byId.valid;
    const doubtful = byId["doubtful-one"];
    if (!invalid || !bridged || !valid || !doubtful) throw new Error("missing a state");

    expect(holdTrust(invalid, bridged).id).toBe("bridged");
    // Nothing else climbs.
    expect(holdTrust(invalid, valid).id).toBe("invalid");
    expect(holdTrust(invalid, doubtful).id).toBe("invalid");
    expect(holdTrust(doubtful, valid).id).toBe("doubtful-one");
    // Bridged carries less autonomy than doubtful, so moving to it is a fall
    // and the ratchet has to allow it. The model never emits this pair, because
    // it only bridges out of invalid, but the rule has to be right either way.
    expect(holdTrust(doubtful, bridged).id).toBe("bridged");
    expect(holdTrust(bridged, valid).id).toBe("bridged");
    // And falling always takes.
    expect(holdTrust(valid, doubtful).id).toBe("doubtful-one");
    expect(holdTrust(valid, invalid).id).toBe("invalid");
    expect(holdTrust(doubtful, invalid).id).toBe("invalid");
  });
});
