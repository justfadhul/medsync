import type { AgreementState, StateId } from "@/content/sensor";

import { PHYSICS, STATES } from "@/content/sensor";

/**
 * The illustrative model behind screen [06].
 *
 * Every constant is read from PHYSICS in the content file. Nothing here is a
 * calibration and nothing here doses anything: it turns a set of switches into
 * two glucose values, decides whether they agree, and reads the resulting state
 * out of the content file's own table.
 *
 * The one piece of judgement in this module is which impairments leave health
 * evidence behind. Fouling does: the hourly impedance sweep sees it, so it
 * points at the electrochemical sensor. Mannitol does: it binds where glucose
 * binds and the optical module's two channels carry the signature. Paracetamol
 * does not: it produces an ordinary looking current with nothing to mark it,
 * which is exactly why a disagreement it causes cannot be arbitrated and the
 * system has to stand down rather than guess.
 */

export interface PlaygroundInputs {
  /** True blood glucose, in the unit the content file names. */
  glucose: number;
  mannitol: boolean;
  paracetamol: boolean;
  lowOxygen: boolean;
  /** Per cent, 0 to 100. */
  fouling: number;
  /** Per cent, 0 to 100. */
  photobleaching: number;
  /** True when a wearable continuous glucose monitor is bridged through the phone. */
  bridged: boolean;
}

export interface SensorReading {
  /** What the reader would see on the gauge. */
  value: number;
  /** Written reasons this sensor is flagged. Empty when it is not. */
  flags: string[];
}

export interface PlaygroundResult {
  /** The optical ratio, R, dimensionless. */
  ratio: number;
  /** The enzymatic current, in the unit the content file names. */
  current: number;
  /**
   * The two optical channels as a share of full strength. Photobleaching moves
   * both together, which is why it never moves the ratio.
   */
  channels: { glow: number; reference: number };
  a: SensorReading;
  b: SensorReading;
  /** The absolute difference between the two glucose values. */
  difference: number;
  /** How far apart they are allowed to be before they count as disagreeing. */
  tolerance: number;
  agree: boolean;
  /** The state the sensors are in right now. */
  state: AgreementState;
  /** Why the model landed on that state, in one sentence. */
  reason: string;
}

export const DEFAULT_INPUTS: PlaygroundInputs = {
  glucose: PHYSICS.glucose.default,
  mannitol: false,
  paracetamol: false,
  lowOxygen: false,
  fouling: 0,
  photobleaching: 0,
  bridged: false,
};

function stateById(id: StateId): AgreementState {
  const found = STATES.find((state) => state.id === id);
  if (!found) throw new Error(`No agreement state ${id} in the content file.`);
  return found;
}

/** The optical ratio for a given true glucose, before any interferent. */
export function cleanRatio(glucose: number): number {
  return PHYSICS.optical.intercept + PHYSICS.optical.slope * glucose;
}

/** The enzymatic current for a given true glucose, before any impairment. */
export function cleanCurrent(glucose: number): number {
  return PHYSICS.enzymatic.intercept + PHYSICS.enzymatic.slope * glucose;
}

/** Run the model. Pure: the same inputs always give the same result. */
export function runModel(inputs: PlaygroundInputs): PlaygroundResult {
  const { optical, enzymatic, tolerance, flags } = PHYSICS;

  /* ---- the optical channel ---- */
  let ratio = cleanRatio(inputs.glucose);
  if (inputs.mannitol) ratio += optical.mannitolOffset;

  // Photobleaching dims both channels by the same share, so it cancels out of
  // the ratio entirely. That is the whole reason the tip reads a ratio.
  const strength = 1 - inputs.photobleaching / 100;
  const channels = { glow: ratio * strength, reference: strength };

  /* ---- the enzymatic channel ---- */
  let current = cleanCurrent(inputs.glucose);
  if (inputs.paracetamol) current += enzymatic.paracetamolOffset;
  if (inputs.lowOxygen && inputs.glucose > enzymatic.lowOxygenThresholdMmol) {
    current *= enzymatic.lowOxygenFactor;
  }
  const foulingFraction = inputs.fouling / 100;
  current *= 1 - enzymatic.foulingCurrentFactor * foulingFraction;

  /* ---- back to glucose ---- */
  const glucoseA = (ratio - optical.intercept) / optical.slope;
  const glucoseB = (current - enzymatic.intercept) / enzymatic.slope;

  const difference = Math.abs(glucoseA - glucoseB);
  const mean = (glucoseA + glucoseB) / 2;
  const allowed = Math.max(tolerance.absoluteMmol, tolerance.relativeFraction * Math.abs(mean));
  const agree = difference <= allowed;

  /* ---- health evidence ---- */
  const flagsB: string[] = [];
  if (inputs.fouling > flags.foulingFlagPercent) {
    flagsB.push(
      `Fouling above ${flags.foulingFlagPercent} per cent. The hourly impedance sweep sees it.`,
    );
  }

  const flagsA: string[] = [];
  // An interferent counts as a flag only once it has actually pulled the two
  // sensors apart. A sensor that still agrees with its neighbour is not doubted.
  if (inputs.mannitol && !agree) {
    flagsA.push("Interferent signature in the two optical channels.");
  }

  /* ---- the state ---- */
  let id: StateId;
  let reason: string;
  if (flagsA.length > 0 && flagsB.length > 0) {
    id = "invalid";
    reason = "Both sensors are flagged, so there is nothing left to arbitrate with.";
  } else if (!agree && flagsA.length === 0 && flagsB.length === 0) {
    id = "invalid";
    reason =
      "The two sensors disagree and no health flag points at either of them, so the system cannot tell which one is wrong.";
  } else if (flagsA.length > 0 || flagsB.length > 0) {
    id = "doubtful-one";
    reason =
      flagsA.length > 0
        ? "The optical sensor is flagged, so the electrochemical sensor is trusted on its own."
        : "The electrochemical sensor is flagged, so the optical sensor is trusted on its own.";
  } else {
    id = "valid";
    reason = "Both sensors are healthy and within tolerance of each other.";
  }

  // Bridging is the one lift there is, and it lifts only out of invalid.
  if (id === "invalid" && inputs.bridged) {
    id = "bridged";
    reason =
      "The implanted sensors are invalid, so the wearable monitor bridged through the phone is carrying the reading.";
  }

  return {
    ratio,
    current,
    channels,
    a: { value: glucoseA, flags: flagsA },
    b: { value: glucoseB, flags: flagsB },
    difference,
    tolerance: allowed,
    agree,
    state: stateById(id),
    reason,
  };
}

/**
 * What the controller is actually allowed to do, as opposed to what the sensors
 * say this instant.
 *
 * Trust ratchets. Once the picture has been worse, the controller does not get
 * its autonomy back because the picture improved: a clinician has to look at it
 * and reset. The one exception is bridging, which lifts a suspended controller
 * to basal only and never further, because a wearable monitor is a lower-trust
 * source than the pair of implanted sensors it stands in for.
 *
 * This is the rule the screen exists to demonstrate, so it lives in code rather
 * than in a caption: a visitor can break a sensor, watch autonomy fall, and then
 * find there is no way to make it rise again from a bad reading.
 */
export function holdTrust(previous: AgreementState, next: AgreementState): AgreementState {
  if (next.autonomy <= previous.autonomy) return next;
  if (next.id === "bridged" && previous.id === "invalid") return next;
  return previous;
}
