/**
 * The example visit on the landing page (D-LP-08): always six days ahead at 10:40, Africa/Kampala.
 * Kampala is UTC+3 with no daylight saving, so the day is read with a fixed offset.
 */
const KAMPALA_MS = 3 * 3_600_000;

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", ...opts });
const SHORT = fmt({ weekday: "short", day: "numeric", month: "short" });
const LONG = fmt({ weekday: "long", day: "numeric", month: "long" });

export type ExampleVisit = { at: number; short: string; long: string; time: string };

export function exampleVisit(now: number, time = "10:40", daysAhead = 6): ExampleVisit {
  const k = new Date(now + KAMPALA_MS);
  const [h = 0, m = 0] = time.split(":").map(Number);
  const at = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + daysAhead, h - 3, m);
  return {
    at,
    short: SHORT.format(at).replace(",", ""),
    long: LONG.format(at).replace(",", ""),
    time,
  };
}

/** Days, hours, minutes and seconds left, the last three padded to two digits. */
export function countdown(at: number, now: number): string[] {
  const s = Math.max(0, Math.floor((at - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    String(Math.floor(s / 86400)),
    pad(Math.floor((s % 86400) / 3600)),
    pad(Math.floor((s % 3600) / 60)),
    pad(s % 60),
  ];
}

/** The server's clock for the first paint. A server component renders once per revalidation, so this is pure enough. */
export const renderedAt = () => Date.now();
