/*
 * The server-anchored clock (PROMPT §9), as the resus desk's useServerOffset:
 * the offset is taken from the round-trip midpoint, only from samples near the
 * best round trip seen (a slow sample is off by half its wait), refreshed on
 * load and every 5 min — and from every EMR write, whose ActionResult already
 * carries `serverTime`. Effective times use the corrected clock; a device clock
 * more than 30 s off is warned about, never silently trusted. Pure.
 */

export const CLOCK_REFRESH_MS = 5 * 60_000;
/** Engineering budget (gate-a §H): warn past 30 s. */
export const CLOCK_WARN_MS = 30_000;
/** A sample slower than this and twice the best round trip is dropped. */
const SLOW_RTT_FLOOR_MS = 2_000;

export interface ServerClock {
  offsetMs: number;
  /** The fastest round trip a sample was taken from. */
  bestRttMs: number;
}

/** From the page's render time: no round trip, so any later good sample replaces it. */
export function initialClock(serverTimeIso: string, deviceNowMs: number): ServerClock {
  return { offsetMs: Date.parse(serverTimeIso) - deviceNowMs, bestRttMs: Number.POSITIVE_INFINITY };
}

/** Fold one timed request in: `t0`/`t1` are device times around it, `serverTime` its answer. */
export function observe(
  clock: ServerClock,
  s: { t0: number; t1: number; serverTime: string },
): ServerClock {
  const rtt = s.t1 - s.t0;
  const server = Date.parse(s.serverTime);
  if (!Number.isFinite(server) || rtt < 0) return clock;
  if (rtt > Math.max(SLOW_RTT_FLOOR_MS, clock.bestRttMs * 2)) return clock;
  return { offsetMs: server - (s.t0 + s.t1) / 2, bestRttMs: Math.min(clock.bestRttMs, rtt) };
}

export const correctedNow = (clock: ServerClock, deviceNowMs: number) =>
  deviceNowMs + clock.offsetMs;

export const clockWarning = (clock: ServerClock) => Math.abs(clock.offsetMs) > CLOCK_WARN_MS;
