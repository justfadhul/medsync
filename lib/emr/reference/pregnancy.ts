import type { RefEntry } from "@/lib/resus/reference/ref";

/**
 * Pregnancy references (clinical reference [09]). VALUES pending the CSO. While REF-PREG-AGE is
 * pending, the safety bar shows no pregnancy line and the imaging prompt does not fire; the
 * obstetric module is offered collapsed for female patients (note-templates references).
 */

export interface PregnancyAgeRange {
  /** Ages in [fromYears, toYears). */
  fromYears: number;
  toYears: number;
}

export interface PostpartumWindow {
  days: number;
}

export const REF_PREG_AGE: RefEntry & { data?: PregnancyAgeRange } = {
  id: "REF-PREG-AGE",
  text: "The age range, for patients whose sex at birth is female, in which pregnancy status is shown and prompted.",
  source: "Uganda Clinical Guidelines 2023 (reproductive health chapter) — confirm at signing",
  url: "docs/emr/emr-clinical-reference.md#09-pregnancy",
  verifiedOn: "2026-09-26", // drafted; verified when signed
  confidence: "design",
  status: "pending_cso",
};

export const REF_PREG_POSTPARTUM: RefEntry & { data?: PostpartumWindow } = {
  id: "REF-PREG-POSTPARTUM",
  text: "The postpartum window after delivery during which the postpartum state applies.",
  source:
    "WHO recommendations on maternal and newborn care for a positive postnatal experience (2022) — confirm at signing",
  url: "docs/emr/emr-clinical-reference.md#09-pregnancy",
  verifiedOn: "2026-09-26", // drafted; verified when signed
  confidence: "design",
  status: "pending_cso",
};
