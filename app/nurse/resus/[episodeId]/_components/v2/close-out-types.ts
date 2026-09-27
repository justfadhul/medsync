import type { SbarDraft } from "@/lib/resus/closeout/handover";
import type {
  CareLevel,
  CareUnit,
  Destination,
  LevelMismatchCode,
  LevelSuggestion,
  OutcomeCode,
} from "@/lib/resus/model";

/** Lane U6 — the close-out sheet's working state (re-exported by close-out-model.ts). */

export type BedStatus = "requested" | "accepted" | "not_available";

export interface CloseOutDraft {
  /** Mid-arrest: how the arrest ended (a data prompt, never a block). */
  arrestEnd: "rosc" | "stop" | "cpr_ongoing" | null;
  outcome: OutcomeCode | "cancel" | null;
  cancelReason: string;
  adminReason: string;
  extras: { agitationDelirium: boolean; riskOfEscalation: boolean; rrtNeeded: boolean };
  destination: Destination | null;
  unitId: string | null;
  mismatch: LevelMismatchCode | null;
  mismatchNote: string;
  bed: BedStatus | null;
  bedAcceptedBy: string;
  sbarEdits: Partial<SbarDraft>;
  /** One per line; null = the record-derived list. */
  devices: string | null;
  /** Outstanding-action keys NOT carried forward. */
  dropped: string[];
  /** Outstanding tests from the facility menu (A5), proposed to the receiving clinician. */
  tests: { testId: string; reason: string }[];
  escort: string;
  /** Null = default from the chosen unit / destination. */
  receivingUnit: string | null;
  receivingCadre: string;
}

/** What the record says, computed once per render of the sheet. */
export interface CloseOutFacts {
  inArrest: boolean;
  /**
   * Resuscitation stopped (or CPR not attempted) with no return of function since, death
   * not yet confirmed — the desk shows the confirmation; only Died fits the record.
   */
  stopped: boolean;
  deathConfirmed: boolean;
  deathCode: OutcomeCode;
  roscRecorded: boolean;
  roscSustained: boolean | null;
  /** Already boarding: the destination is decided; "Patient left resus" ends it. */
  boarding: boolean;
  /** Boarding is possible from here (survey / post-ROSC, not a death, not CPR ongoing). */
  canBoard: boolean;
  suggestion: LevelSuggestion;
  unit: CareUnit | null;
  chosen: CareLevel | null;
  mismatchNeeded: boolean;
  outstanding: { key: string; label: string }[];
  devicesDefault: string[];
  sbar: SbarDraft;
}

export interface StepProps {
  draft: CloseOutDraft;
  patch: (p: Partial<CloseOutDraft>) => void;
  facts: CloseOutFacts;
}
