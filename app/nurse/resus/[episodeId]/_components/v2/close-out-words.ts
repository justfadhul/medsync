import type { Capability, CareLevel, LevelMismatchCode, OutcomeCode } from "@/lib/resus/model";

/**
 * Lane U6 — words and styles shared by the close-out sheet, the boarding
 * banner and the board. Types only — no engines — so the board's bundle does
 * not pull the survey catalogs in.
 */

export const OUTCOME_WORD: Record<OutcomeCode, string> = {
  stabilised: "Stabilised",
  rosc_sustained: "ROSC — sustained",
  rosc_not_sustained: "ROSC — not yet sustained",
  died_after_cpr: "Died",
  died_cpr_not_attempted: "Died — CPR not attempted",
  transferred_out: "Transferred out",
};

/** An ended episode in words — the board's "Recently ended" and the doctor workspace. */
export function endedWord(e: {
  state: "concluded" | "cancelled";
  closureKind: "bedside" | "administrative" | null;
  outcomeCode: OutcomeCode | null;
}): string {
  if (e.state === "cancelled") return "Opened in error";
  if (e.closureKind === "administrative") return "Closed administratively";
  return e.outcomeCode ? OUTCOME_WORD[e.outcomeCode] : "Ended";
}

export const DESTINATION_WORD: Record<string, string> = {
  icu: "ICU",
  hdu: "HDU",
  ward: "Ward",
  theatre: "Theatre",
  cath_lab: "Cath lab",
  labour_ward: "Labour ward",
  transferred: "Transfer out",
  discharged: "Discharge after observation",
  mortuary: "Mortuary",
  deceased: "Deceased",
  ct_first: "CT before the unit",
};

export const MISMATCH_WORD: Record<LevelMismatchCode, string> = {
  no_bed: "No bed",
  ceiling_of_care: "Ceiling of care agreed",
  family_declined: "Family declined",
  transfer_arranged: "Transfer arranged",
  clinical_judgement: "Clinical judgement",
};

export const CAPABILITY_WORD: Record<Capability, string> = {
  continuous_ecg: "continuous ECG",
  arterial_line: "arterial line",
  vasopressors: "vasopressors",
  niv_cpap: "NIV/CPAP",
  invasive_ventilation: "invasive ventilation",
  rrt: "RRT",
};

export const TRIGGER_WORD: Record<string, string> = {
  triage_red: "Triage Red",
  step0_life_threat: "Step-0 life threat",
  in_resus_deterioration: "In-resus deterioration",
};

/** 24-hour wall time pinned to the hospital's zone (a UTC server must print what the bedside reads). */
export function hhmm(at: string | number): string {
  return new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });
}

/** "Ward" · "L1" · "L2" · "L3". */
export function levelShort(l: CareLevel): string {
  return l === "ward" ? "Ward" : l.toUpperCase();
}

/** Amber = open / due / waiting (never red) — light and dark. */
export const AMBER_NOTE = "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100";
export const AMBER_CHIP = "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200";

/** The sheet's two button styles (primary teal; secondary outline). */
export const PRIMARY =
  "tap text-body-m bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:shadow-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 font-medium outline-none disabled:pointer-events-none disabled:opacity-50";
export const SECONDARY =
  "tap text-body-m border-border text-foreground hover:bg-muted focus-visible:shadow-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-5 font-medium outline-none disabled:pointer-events-none disabled:opacity-50";

/** The receiving unit pre-filled from the chosen unit / destination. */
export function defaultReceiving(unitName: string | undefined, destination: string | null): string {
  if (unitName) return unitName;
  if (!destination || ["mortuary", "transferred", "discharged"].includes(destination)) return "";
  return DESTINATION_WORD[destination] ?? "";
}
