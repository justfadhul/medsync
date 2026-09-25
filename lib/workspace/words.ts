/**
 * The workspace's small words — separate from the projection so the board's
 * browser bundle carries these few lines, not the engine.
 */

const MIN = 60_000;

/** "12 min", "3 h", "4 d", "16 w" — floored, never negative. */
export function ago(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d < 14 ? `${d} d` : `${Math.floor(d / 7)} w`;
}

/** The triage scale's colour words — every acuity chip carries one (never colour alone). */
export const COLOUR_WORD = {
  1: "Red",
  2: "Orange",
  3: "Yellow",
  4: "Green",
  5: "Blue",
} as const;
