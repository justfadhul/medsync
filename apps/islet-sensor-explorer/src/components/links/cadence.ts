import type { Link, Path } from "@/content/sensor";

import { CYCLE_META, LINKS } from "@/content/sensor";
import { DURATION_MS, STAGGER_MS } from "@/lib/motion";

/**
 * Cadence grouping for the transport on screen [02].
 *
 * This module is pure: no React, no timers, no content of its own. It reads
 * each link's own cadence string and works out when that link fires, so the
 * playback order follows the content file rather than a list of part ids
 * written out by hand. Change a cadence in src/content/sensor.ts and the
 * grouping, the order and the packet timing all follow.
 *
 * The eighteen links carry ten distinct cadence strings, so the sequence is ten
 * steps long, which is the length the store's cycleIndex counts in.
 */

/** How a cadence string behaves against the measurement period. */
export type CadenceTier = "cycle" | "multi-cycle" | "on-demand";

export interface CadenceStep {
  /** Position in the sequence, counted from zero. */
  index: number;
  /** The cadence string itself, verbatim from the content file. */
  cadence: string;
  tier: CadenceTier;
  /** The links that share this cadence, in the order the content lists them. */
  links: Link[];
  /**
   * How many measurement cycles pass between one firing and the next. 1 means
   * every cycle, 5 means every fifth cycle, 0 means it is not on the clock at
   * all and fires when something happens.
   */
  everyNthCycle: number;
  /** True when any link in the step runs on the insulin path. */
  carriesInsulin: boolean;
  /** The signal paths present in the step, in the order the links appear. */
  paths: Path[];
}

/**
 * Playback compression. The steps that make up one measurement cycle are
 * played inside this many milliseconds, so a cycle that really takes
 * CYCLE_META.periodSeconds is watchable. A presentation figure, not content.
 */
export const CYCLE_PLAY_MS = 3000;

/** One packet crosses one link in this long: the reveal duration. */
export const PACKET_TRAVEL_MS = DURATION_MS.reveal;

/** The sibling stagger the design system names. */
export const PACKET_STAGGER_MS = STAGGER_MS;

/** Where a packet is parked when motion is reduced: halfway along its link. */
export const STATIC_PACKET_T = 0.5;

const CONTINUOUS = /continuous/i;
const EVERY =
  /every\s+(\d+(?:\.\d+)?)\s*(seconds|second|secs|sec|s|minutes|minute|mins|min|hours|hour|h)\b/i;

function unitSeconds(unit: string): number {
  const lower = unit.toLowerCase();
  if (lower.startsWith("h")) return 3600;
  if (lower.startsWith("m")) return 60;
  return 1;
}

/**
 * The interval a cadence string states, in seconds. 0 for a link that is on all
 * the time, null for a link that fires on an event rather than on a clock.
 */
export function cadenceSeconds(cadence: string): number | null {
  if (CONTINUOUS.test(cadence)) return 0;
  const match = EVERY.exec(cadence);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value) || unit === undefined) return null;
  return value * unitSeconds(unit);
}

/**
 * How many measurement cycles pass between firings: 1 for every cycle, 5 for
 * every fifth, 0 for a link that waits for an event.
 */
export function cyclesFor(
  cadence: string,
  periodSeconds: number = CYCLE_META.periodSeconds,
): number {
  const seconds = cadenceSeconds(cadence);
  if (seconds === null) return 0;
  if (seconds <= 0) return 1;
  const period = periodSeconds > 0 ? periodSeconds : 1;
  return Math.max(1, Math.round(seconds / period));
}

export function tierFor(
  cadence: string,
  periodSeconds: number = CYCLE_META.periodSeconds,
): CadenceTier {
  const cycles = cyclesFor(cadence, periodSeconds);
  if (cycles === 0) return "on-demand";
  return cycles === 1 ? "cycle" : "multi-cycle";
}

/** Steps run fastest first: every cycle, then every few cycles, then on an event. */
const TIER_ORDER: Record<CadenceTier, number> = {
  cycle: 0,
  "multi-cycle": 1,
  "on-demand": 2,
};

interface Bucket {
  cadence: string;
  firstSeen: number;
  links: Link[];
}

/**
 * Group the links by their cadence string, then order the groups: the links
 * that fire every measurement cycle first, the slower ones next, and the ones
 * that wait for a clinician or for the network last. Within a group and within
 * a tier the content order is kept, so nothing depends on chance.
 */
export function buildCadenceSteps(
  links: readonly Link[] = LINKS,
  periodSeconds: number = CYCLE_META.periodSeconds,
): CadenceStep[] {
  const buckets = new Map<string, Bucket>();

  links.forEach((link, index) => {
    const bucket = buckets.get(link.cadence);
    if (bucket) {
      bucket.links.push(link);
      return;
    }
    buckets.set(link.cadence, { cadence: link.cadence, firstSeen: index, links: [link] });
  });

  return [...buckets.values()]
    .sort((a, b) => {
      const tierGap =
        TIER_ORDER[tierFor(a.cadence, periodSeconds)] -
        TIER_ORDER[tierFor(b.cadence, periodSeconds)];
      return tierGap !== 0 ? tierGap : a.firstSeen - b.firstSeen;
    })
    .map((bucket, index) => {
      const paths: Path[] = [];
      for (const link of bucket.links) {
        if (!paths.includes(link.path)) paths.push(link.path);
      }
      return {
        index,
        cadence: bucket.cadence,
        tier: tierFor(bucket.cadence, periodSeconds),
        links: bucket.links,
        everyNthCycle: cyclesFor(bucket.cadence, periodSeconds),
        carriesInsulin: bucket.links.some((link) => link.path === "insulin"),
        paths,
      };
    });
}

/** The ten cadence steps of the eighteen links, built once. */
export const CADENCE_STEPS: CadenceStep[] = buildCadenceSteps();

/**
 * How many measurement cycles the sequence has to run before every step has
 * fired at least once. The slowest step on the clock sets it.
 */
export function loopCycles(steps: readonly CadenceStep[] = CADENCE_STEPS): number {
  return steps.reduce((slowest, step) => Math.max(slowest, step.everyNthCycle), 1);
}

/**
 * How long one step is held during playback. The steps that make up the
 * measurement cycle share the compressed cycle between them, and every other
 * step is held for the same length, so the pace of the screen stays even.
 */
export function stepDwellMs(steps: readonly CadenceStep[] = CADENCE_STEPS): number {
  const inCycle = steps.filter((step) => step.tier === "cycle").length;
  return Math.round(CYCLE_PLAY_MS / Math.max(1, inCycle));
}

/** True when this step actually fires on this measurement cycle, counted from one. */
export function stepFiresOnCycle(step: CadenceStep, cycleNumber: number): boolean {
  if (step.everyNthCycle <= 1) return true;
  return cycleNumber % step.everyNthCycle === 0;
}

/** Keep an index inside the sequence however the store's counter has wrapped. */
export function normaliseStepIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}
