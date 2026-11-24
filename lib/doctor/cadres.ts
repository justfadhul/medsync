/** Pure, so the PGlite lane can import it (scope.ts loads the database client). */

/** Junior cadres — these are the ones whose flagged actions can route to co-sign. */
export const JUNIOR_CADRE_CODES = ["INTERN_DOCTOR", "CLINICAL_OFFICER"] as const;

/** Senior cadres — these can review + co-sign. */
export const SENIOR_CADRE_CODES = [
  "MEDICAL_OFFICER",
  "MEDICAL_OFFICER_SG",
  "CONSULTANT",
  "SENIOR_CONSULTANT",
] as const;
