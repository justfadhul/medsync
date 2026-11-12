/**
 * What the desk loads for step 10 when the Plan by problem is on (ADR 0184): the record the Plan
 * reads back, the ward list, the facts the checks read (weight with its time and source, the latest
 * creatinine and glucose), the co-sign policy and the monitoring charts. Plain data.
 */
import type { PlanRecord } from "./record";
import type { MonitoringPayload } from "@/lib/emr/charts/payload";
import type { InteractionContext } from "@/lib/pharmacy/clinical/read";
import type { PrescriberPharmacyView } from "@/lib/pharmacy/review/prescriber-read";
import type { WeightFact } from "@/lib/prescribing/formulary";
import type { CultureState, PlanCheckContext } from "@/lib/prescribing/plan-checks";

export type CosignRequirement = "allowed" | "cosign_required" | "blocked";

export interface PlanPayload {
  /** EMR_PRESCRIBING is on here: the Plan can prescribe. */
  prescribing: boolean;
  /** Lab Phase 2 (labOneMenu): each test's state here today, by `test.*` id. */
  labToday?: Record<string, { words: string | null; orderable: boolean; linked: boolean }>;
  record: PlanRecord;
  /** The hospital's ward names, for Admit. */
  /** The wards that take admissions; counts (words) with WARD_BUILDER on (ADR 0197 §5). */
  wards: { id: string; name: string; counts: string | null }[];
  /** The viewer is an intern: discharging with NEWS2 of 5 or more needs a senior to agree. */
  intern: boolean;
  facts: {
    ageYears: number | null;
    weight: WeightFact | null;
    creatinine: { value: number; unit: string; at: string } | null;
    glucose: { value: number; at: string } | null;
    conditions: string[];
    /** PRESCRIBE_V2 (kit F1/F3): eGFR and the pregnancy question read these. */
    sex?: "female" | "male" | null;
    pregnancy?: PlanCheckContext["pregnancy"];
  };
  /** PRESCRIBE_V2 is on here: the dialog shows the strip, brand, supply and the kit's checks. */
  prescribeV2?: boolean;
  cosign: { routine: CosignRequirement; controlled: CosignRequirement };
  /** The blood culture ordered at this visit, as the record holds it. */
  bloodCulture: Exclude<CultureState, "in_basket">;
  /** A U&E or creatinine ordered at this visit. */
  kidneyTestOrdered: boolean;
  monitoring: MonitoringPayload | null;
  /** Pharmacy Phase 1 (5.4): queries and notices from the pharmacy; absent with the flag off. */
  pharmacy?: PrescriberPharmacyView | null;
  /** Pharmacy Phase 3 (5.3): signed pairs and current medicines for the interaction check; absent with the flag off. */
  interactions?: InteractionContext | null;
  /** Pharmacy Phase 1 (5.10): where the dialog asks for the stock line; absent with the flag off (S88). */
  stockAnswer?: { surface: "doctor" | "clinician"; patientUserId: string; encounterId: string };
  /** Pharmacy Phase 4 (5.2): the Repeats step's signed bounds and each placed line's terms; absent with the flag off. */
  repeats?: RepeatsPayload;
}

export interface RepeatTerms {
  furtherSupplies: number;
  minIntervalDays: number;
  notAfter: string;
  reviewBy: string | null;
  /** Stopped by a prescriber (RP-3), or ended because the line was cancelled or replaced. */
  stopped: { cadre: string | null; on: string } | null;
  ended: boolean;
}

export interface RepeatsPayload {
  /** Null while the repeat pack is unsigned: no Repeats step is shown (Appendix D). */
  bounds: {
    offered: string[];
    maxSupplies: number;
    maxPeriodDays: number;
    minIntervalDays: number;
  } | null;
  today: string;
  lines: Record<string, RepeatTerms>;
  /** Who acts from the card (Stop repeats). */
  who?: { surface: "doctor" | "clinician"; patientUserId: string };
}
