/**
 * The medicines round across patients (ADR 0546 Phase 3): today's cells of each line placed into the four drug rounds,
 * by the hospital's clock. Pure.
 */
export const ROUNDS = [
  { key: "night", label: "Night", from: 0 },
  { key: "morning", label: "Morning", from: 6 },
  { key: "midday", label: "Midday", from: 12 },
  { key: "evening", label: "Evening", from: 18 },
] as const;

/** Which round an instant falls in, by the hour in `timeZone`. */
export function roundOf(at: string | Date, timeZone = "Africa/Kampala"): number {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(
      new Date(at),
    ),
  );
  return Math.min(3, Math.floor(h / 6));
}

export function byRound<T extends { at: string }>(cells: T[], timeZone?: string): T[][] {
  const out: T[][] = [[], [], [], []];
  for (const c of cells) out[roundOf(c.at, timeZone)]!.push(c);
  return out;
}
