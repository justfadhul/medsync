/**
 * The desk's second identifier (ADR 0486, D-RD-04): year of birth, else the last 3 digits of the phone. Pure and
 * import-free, shared by `ha-reception-desk` and the tests. The answer is compared here and never stored or logged.
 */
export type IdentityMethod = "yob" | "phone3";

/** Two misses (one per method) stop the check-in; more tries are refused. */
export const IDENTITY_MAX_ATTEMPTS = 2;

export function identityMatches(
  method: IdentityMethod,
  answer: string,
  known: { dateOfBirth: string | null; phone: string | null },
): boolean {
  const a = answer.replace(/\D/g, "");
  if (method === "yob") {
    const year = known.dateOfBirth?.slice(0, 4) ?? "";
    return a.length === 4 && /^\d{4}$/.test(year) && a === year;
  }
  const digits = (known.phone ?? "").replace(/\D/g, "");
  return a.length === 3 && digits.length >= 3 && digits.endsWith(a);
}

/** The next method the desk may ask, or null when the check must stop (RD5). */
export function nextIdentityStep(
  tries: { method: IdentityMethod; matched: boolean }[],
): IdentityMethod | "done" | null {
  if (tries.some((t) => t.matched)) return "done";
  if (tries.length === 0) return "yob";
  if (tries.length === 1 && tries[0]!.method === "yob") return "phone3";
  return null;
}
