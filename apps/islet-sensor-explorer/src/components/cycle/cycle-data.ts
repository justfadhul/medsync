import { CYCLE, CYCLE_META } from "@/content/sensor";

/**
 * Derivations over the measurement cycle. Every figure here is either read from
 * the content file or summed from it: nothing is a new number.
 */

/** Steps that keep the sensors powered, in content order. */
export const AWAKE_STEPS = CYCLE.filter((step) => step.awake);

/** The one step that does not run on every cycle. */
export const PERIODIC_STEP = CYCLE.find((step) => step.periodic);

/** Milliseconds awake once the cycle has reached this step, counted from zero. */
export function awakeMsThrough(index: number): number {
  return CYCLE.slice(0, index + 1).reduce((total, step) => total + step.ms, 0);
}

/** Milliseconds awake across a whole cycle, summed from the itemised steps. */
export const ITEMISED_AWAKE_MS = awakeMsThrough(CYCLE.length - 1);

/**
 * The itemised step times do not add up to the stated figure of about 250 ms
 * awake. Both come from the source and neither is adjusted to fit the other, so
 * the screen shows the sum and the stated figure side by side and says which is
 * which rather than quietly reconciling them.
 */
export const STATED_AWAKE_MS = CYCLE_META.awakeApproxMs;

/**
 * How wide a step's bar is, as a share of the widest itemised step. Steps with
 * no itemised duration keep a small minimum width so they are still hittable.
 */
export function barShare(ms: number): number {
  const widest = Math.max(...CYCLE.map((step) => step.ms), 1);
  return Math.max(ms / widest, 0.06);
}
