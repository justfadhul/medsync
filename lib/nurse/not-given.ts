/**
 * Standard reasons a dose was not given (ADR 0545 Phase 3; the prototype's codes, a draft for the CSO). Stored as the
 * reason's opening words, so every reader of `withheld_reason` keeps working and reports can group by them.
 */
export const NOT_GIVEN = {
  absent: "Away from the ward",
  fasting: "Nil by mouth",
  refused: "Patient refused",
  vomiting: "Vomiting",
  not_available: "Medicine not available",
  clinical: "Withheld for a clinical reason",
  other: "Other",
} as const;
export type NotGivenCode = keyof typeof NOT_GIVEN;
export const NOT_GIVEN_CODES = Object.keys(NOT_GIVEN) as NotGivenCode[];

/** The reason as stored: the code's words, then the nurse's note when there is one. */
export function notGivenReason(
  code: NotGivenCode | undefined,
  note: string | undefined,
): string | null {
  const n = note?.trim() ?? "";
  if (!code) return n.length >= 3 ? n : null;
  if ((code === "other" || code === "clinical") && n.length < 3) return null;
  return n ? `${NOT_GIVEN[code]}: ${n}` : NOT_GIVEN[code];
}
