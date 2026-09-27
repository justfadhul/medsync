import type { RefEntry } from "@/lib/resus/reference/ref";

/**
 * The fasting definition shown on the glucose entry chip (CFC §4.1, REF-DM-FASTING-DEF). VALUE
 * pending the CSO (NCD dossier). Until signed the chip shows no definition, and `unknown` is
 * never read as fasting (CFC C2).
 */

export interface FastingDefinition {
  /** Minimum hours without caloric intake. */
  minHours: number;
}

export const REF_DM_FASTING_DEF: RefEntry & { data?: FastingDefinition } = {
  id: "REF-DM-FASTING-DEF",
  text: "Definition of a fasting sample for plasma glucose.",
  source:
    "Uganda Clinical Guidelines 2023 (diabetes mellitus) and WHO diagnostic criteria — confirm at signing",
  url: "docs/emr/SPEC-CLINICAL-FACT-CONTRACT-v1.md",
  verifiedOn: "2026-09-26", // drafted; verified when signed
  confidence: "design",
  status: "pending_cso",
};
