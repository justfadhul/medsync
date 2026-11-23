import type { PatientSex } from "./catalogue";
import type { ResultFact } from "./exam/context";
import type { Signoff } from "./flags";
import type { DxSignoff } from "./impression/catalogue";
import type { ConversionFlagDefs } from "./legacy";
import type { ReportedItem } from "@/lib/patient/reported-history";
import type { AdultVitals } from "@/lib/triage/types";

/**
 * What the v2 desk reads from the record, beside the v1 DeskPayload (lib/emr/read/desk.ts). The
 * catalogue itself is fetched once per session from `catalogueUrl` (immutable, keyed by its hash).
 */
export interface ClerkingDeskData {
  catalogueUrl: string;
  catalogueVersion: string;
  sex: PatientSex;
  ageYears: number | null;
  /** The encounter's type (opd, emergency, inpatient…), for `setting` lists (EC-7). */
  encounterType?: string | null;
  /** Results the reasoning reads (EC-1); absent when they could not be loaded (every `result`
   *  atom is then unknown). */
  facts?: ResultFact[];
  /** The newest reading of each NEWS2 input from the observation store (never copied). */
  vitals: AdultVitals;
  vitalsAt: string | null;
  vitalsFromTriage: boolean;
  /** The reading before the newest of each numeric input, for the rail's trend mark; absent or
   *  null where there is only one reading. */
  vitalsPrev?: VitalsPrev;
  medicines: {
    statementId: string;
    name: string;
    doseText: string | null;
    frequencyCode: string | null;
    adherence: string | null;
    informant: string | null;
    restricted: boolean;
    /** First recorded at this visit by this clinician: its X voids it (entered in error). */
    addedHere: boolean;
  }[];
  allergies: {
    status: "listed" | "no_known_drug_allergies" | "unable_to_assess" | "not_recorded";
    /** An NKDA or unable-to-assess assertion, or an allergy version, recorded at this encounter. */
    touchedThisVisit: boolean;
    items: {
      id: string;
      name: string;
      coded: boolean;
      reactions: string[];
      severity: string | null;
      source: string | null;
      restricted: boolean;
      /** First recorded at this visit by this clinician: its X voids it without a reason prompt. */
      addedHere: boolean;
    }[];
  };
  /** Catalogue symptoms whose token charts as a CFC finding at signing (token map ∘ concept), so
   *  the sign dialog can count what signing commits without shipping the fact catalogue. */
  chartable: string[];
  outbreakMode: boolean;
  /** Lab Phase 2 HR-1a (labHighRiskWarning): a fired fever-with-bleeding rule raises the lab's
   *  high-risk specimen warning for this encounter. */
  labHighRisk?: boolean;
  canSeeRestricted: boolean;
  /** What the patient reported on their phone (ADR 0414, 0189): shown as patient-reported, not yet
   *  confirmed, never a record until a clinician confirms it. Absent before 0189 or when it could
   *  not be read. */
  patientReported?: ReportedItem[];
  signoff: Signoff;
  /** The signed wording of the conversion flags (a v1 draft continued in the new format). */
  conversionFlags?: ConversionFlagDefs;
  /** The diagnosis reasoning catalogue's immutable URL (keyed by its hash) and its signature
   *  (Summary and Impression, steps 08 and 09). */
  dx?: { catalogueUrl: string; catalogueVersion: string; signoff: DxSignoff };
  /** The examination catalogue's immutable URL (keyed by its hash) and its signature. */
  exam: {
    catalogueUrl: string;
    catalogueVersion: string;
    signoff: {
      flagRules: "all" | string[];
      referenceEntries: "all" | string[];
      classifiers: "all" | string[];
      withheld: string[];
    };
    /** The newest reading of each vital and measurement on the chart (triage projected in). */
    latest: {
      sbp: number | null;
      dbp: number | null;
      pulse: number | null;
      rr: number | null;
      spo2: number | null;
      temp: number | null;
      glucose: number | null;
      weight: number | null;
      height: number | null;
      waist: number | null;
      /** The newest glucose's context when an examination set at this visit wrote it (EC-3). */
      glucoseContext?: string | null;
    };
    /** The newest set saved from an examination at this visit, with its qualifiers (D-EX-11). */
    set: null | {
      at: string;
      fields: string[];
      arm: string | null;
      position: string | null;
      rhythm: string | null;
      site: string | null;
      glucoseContext: string | null;
      oxygen: "air" | "oxygen" | null;
      oxygenModality: string | null;
      /** ACVPU as saved with the set (C lives only here until the CFC addendum, HX3). */
      acvpu: "A" | "C" | "V" | "P" | "U" | null;
      confirmed: string[];
    };
    /** An open pregnancy episode (BMI and IMAM rules); null when none is recorded. */
    pregnant: boolean | null;
    /** When that episode began (ISO): results on a pregnancy diagnosis are bounded to it (EC-5). */
    pregnancySince?: string | null;
    /** Completed weeks of gestation from the episode's LNMP (diabetes pack), while pregnant. */
    gestationWeeks?: number | null;
    /** Completed weeks since the newest episode's birth (diabetes pack). */
    weeksPostpartum?: number | null;
  };
}

/** The reading before the newest, per numeric NEWS2 input (and the diastolic, for blood pressure). */
export type VitalsPrev = Partial<
  Record<
    "respiratoryRate" | "spo2" | "systolicBp" | "diastolicBp" | "pulse" | "temperature",
    number | null
  >
>;
