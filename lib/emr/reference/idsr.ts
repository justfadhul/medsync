import type { RefEntry } from "@/lib/resus/reference/ref";

/**
 * IDSR references (clinical reference [03], [04], [11]). VALUES pending the CSO, from the current
 * national IDSR technical guidelines. `data` is withheld until signed: no class is derived, no
 * notifiable confirm sheet fires, and the exposure picker shows no list (narrative still works).
 */

const IDSR_GUIDELINES =
  "MoH Uganda — National Technical Guidelines for Integrated Disease Surveillance and Response (current edition)";

export interface IdsrClasses {
  classes: { id: string; label: string; immediatelyReportable: boolean; actionText: string }[];
  /** diagnosis_terms.id → class id. */
  map: Record<string, string>;
}

export interface IdsrScreen {
  /** Exposure finding tokens offered in history of presenting complaint. */
  tokens: { id: string; label: string }[];
}

export const REF_IDSR_CLASSES: RefEntry & { data?: IdsrClasses } = {
  id: "REF-IDSR-CLASSES",
  text: "IDSR priority-disease classes, their actions and which are immediately reportable.",
  source: IDSR_GUIDELINES,
  url: "docs/emr/emr-clinical-reference.md#11-hmis-and-idsr-alignment",
  verifiedOn: "2026-09-26", // drafted; verified when signed
  confidence: "design",
  status: "pending_cso",
};

export const REF_IDSR_SCREEN: RefEntry & { data?: IdsrScreen } = {
  id: "REF-IDSR-SCREEN",
  text: "Exposure screening tokens (travel, contact, animal and outbreak exposures).",
  source: IDSR_GUIDELINES,
  url: "docs/emr/emr-clinical-reference.md#11-hmis-and-idsr-alignment",
  verifiedOn: "2026-09-26", // drafted; verified when signed
  confidence: "design",
  status: "pending_cso",
};
