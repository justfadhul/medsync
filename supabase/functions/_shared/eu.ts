/**
 * The emergency unit's Edge Function helpers (ADR 0541). No imports: pure, and read by the app's tests.
 */

/** The refusal for assigning a bed on an EU ward while the EU is live (shown by the app and the hub). */
export const EU_SEND_FROM_VISIT =
  "In an emergency unit, send the patient from their visit (Send to EU).";

/**
 * `EU_OBSERVATION` as the function sees it: `1`, or a comma list of hospital ids. The app's
 * euObservationLiveFor (lib/wards/feature.ts) also needs WARD_BUILDER and ENCOUNTER_CLOSE_V2, which the
 * functions cannot read; this is the function's own guard, set as a function secret.
 */
export function euObservationOn(value: string | undefined, hospitalId: string): boolean {
  const v = value?.trim();
  if (!v) return false;
  return v === "1" || v.split(",").some((id) => id.trim() === hospitalId);
}

/**
 * The words a user may see for an EU or admission function's error: the words after an `EU4xx ` /
 * `AD4xx ` code, or "try again" for a deadlock (40P01) or serialization failure (40001). Anything else
 * is null: the caller logs the error's code, never its message, and returns a plain server error.
 */
export function euRefusal(e: { message: string; code?: string }): string | null {
  if (e.code === "40P01" || e.code === "40001")
    return "Someone changed this patient just now. Try again.";
  const m = /^(?:AD|EU)(400|404|409) (.*)$/s.exec(e.message);
  return m ? m[2]! : null;
}
