import type { RefEntry } from "@/lib/resus/reference/ref";

/**
 * HMIS references (clinical reference [11]). Structure signed at GATE A; VALUES pending the CSO,
 * built with the facility records officer and the district HMIS focal person from the current MoH
 * HMIS manual. Each entry's `data` is withheld (absent) until it is signed; lib/emr/hmis.ts reads
 * `data` only from a signed entry and otherwise returns unknown / null.
 */

const HMIS_MANUAL =
  "MoH Uganda — The Health Management Information System manual (current edition)";

/** A span of age from the date of birth. */
export interface AgeSpan {
  years?: number;
  months?: number;
  days?: number;
}

/** New versus re-attendance: "new" when the patient has no earlier attendance at this facility
 *  inside the period that contains this visit. */
export interface HmisAttendanceDefinition {
  period:
    | { kind: "financial_year"; startMonth: number }
    | { kind: "calendar_year" }
    | { kind: "rolling_days"; days: number };
}

export interface HmisAgeBands {
  /** Contiguous, ordered; a band holds ages in [from, to). The last band has no `to`. */
  bands: { id: string; label: string; from: AgeSpan; to?: AgeSpan }[];
}

export interface HmisCategoryMap {
  categories: { id: string; label: string }[];
  /** diagnosis_terms.id → category id. */
  map: Record<string, string>;
}

export const REF_HMIS_ATTENDANCE: RefEntry & { data?: HmisAttendanceDefinition } = {
  id: "REF-HMIS-ATTENDANCE",
  text: "Definition of a new attendance versus a re-attendance for HMIS 031 and 105.",
  source: HMIS_MANUAL,
  url: "docs/emr/emr-clinical-reference.md#11-hmis-and-idsr-alignment",
  verifiedOn: "2026-09-26", // drafted; verified when signed
  confidence: "design",
  status: "pending_cso",
};

export const REF_HMIS_AGEBANDS: RefEntry & { data?: HmisAgeBands } = {
  id: "REF-HMIS-AGEBANDS",
  text: "The age groups of the HMIS 105 outpatient monthly report.",
  source: `${HMIS_MANUAL}; HMIS 105 template`,
  url: "docs/emr/emr-clinical-reference.md#11-hmis-and-idsr-alignment",
  verifiedOn: "2026-09-26", // drafted; verified when signed
  confidence: "design",
  status: "pending_cso",
};

export const REF_HMIS_MAP: RefEntry & { data?: HmisCategoryMap } = {
  id: "REF-HMIS-MAP",
  text: "Mapping from MedSync diagnosis terms to HMIS 105 diagnosis categories.",
  source: `${HMIS_MANUAL}; HMIS 105 diagnosis list`,
  url: "docs/emr/emr-clinical-reference.md#11-hmis-and-idsr-alignment",
  verifiedOn: "2026-09-26", // drafted; verified when signed
  confidence: "design",
  status: "pending_cso",
};
