import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";

/**
 * Display formatting for the EMR views (DESIGN: DD MMM YYYY, 24-hour). Pure and importable from
 * both trees. The payload carries ISO instants; the view formats them in the hospital's zone.
 */
export { DEFAULT_TIME_ZONE };

export function formatters(timeZone: string = DEFAULT_TIME_ZONE) {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  });
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  return {
    date: (iso: string) => date.format(new Date(iso)),
    time: (iso: string) => time.format(new Date(iso)),
    dateTime: (iso: string) => `${date.format(new Date(iso))} ${time.format(new Date(iso))}`,
  };
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const YEAR = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" });
/** A flowsheet column (yyyy-mm-dd, already in the hospital's zone): "10 Mar" and its year. */
export function dayLabel(day: string): { day: string; year: string } {
  const d = new Date(`${day}T00:00:00Z`);
  return { day: DAY.format(d), year: YEAR.format(d) };
}

/** The engine joins a few payload strings with " · "; the views set each part as its own span
 *  (UI-BRIEF §3: never dot-joined meta strings). */
export const parts = (s: string): string[] =>
  s
    .split(" · ")
    .map((p) => p.trim())
    .filter(Boolean);

/** An allergy item's text without the engine's " · by name only" tail; the view says it as a chip. */
export const withoutNameOnly = (s: string) => s.replace(/ · by name only$/, "");
