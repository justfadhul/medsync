import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";

/**
 * The hospital's clock in words — pure and client-safe, one place for the
 * engine, the board and the actions. Months are DESIGN-medsync.md's three
 * letters on every ICU (newer ones write "Sept"); times are 24-hour.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function hospitalClock(timeZone: string = DEFAULT_TIME_ZONE) {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  // "2026-09-22": the local calendar day, and the parts of "22 Sep".
  const day = new Intl.DateTimeFormat("en-CA", { timeZone });
  const date = (ms: number) => {
    const [, month, dd] = day.format(ms).split("-");
    return `${Number(dd)} ${MONTHS[Number(month) - 1]}`;
  };
  return {
    sameDay: (a: number, b: number) => day.format(a) === day.format(b),
    /** "11:06" on `nowMs`'s day, "22 Sep" before — a badge's words. */
    when: (ms: number, nowMs: number) =>
      day.format(ms) === day.format(nowMs) ? time.format(ms) : date(ms),
    /** "11:06" on `nowMs`'s day, "5 Jun 10:31" before — a timeline's words. */
    whenAt: (ms: number, nowMs: number) =>
      day.format(ms) === day.format(nowMs) ? time.format(ms) : `${date(ms)} ${time.format(ms)}`,
    /** "24 Sep 11:06" — always both. */
    stamp: (ms: number) => `${date(ms)} ${time.format(ms)}`,
  };
}
