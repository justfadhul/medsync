import type { RefEntry } from "@/lib/resus/reference/ref";

/**
 * Test-supported diagnoses (clinical reference [04], REF-DX-TESTFIRST). VALUES pending the CSO.
 * A listed diagnosis without a supporting result this visit shows a prompt, never a block. Malaria
 * is the first expected entry (UCG 2023 parasitological confirmation; wording and page confirmed
 * at signing). Until signed, no prompt fires.
 */

export interface TestFirstList {
  entries: {
    /** diagnosis_terms.id */
    termId: string;
    /** test_catalogue ids any one of which supports the diagnosis. */
    testIds: string[];
    promptText: string;
  }[];
}

export const REF_DX_TESTFIRST: RefEntry & { data?: TestFirstList } = {
  id: "REF-DX-TESTFIRST",
  text: "Diagnoses that national guidance expects to be confirmed by a test before treatment.",
  source:
    "Uganda Clinical Guidelines 2023 (library.health.go.ug) — confirm wording and page at signing",
  url: "docs/emr/emr-clinical-reference.md#04-problem-list-and-diagnoses",
  verifiedOn: "2026-09-26", // drafted; verified when signed
  confidence: "design",
  status: "pending_cso",
};
