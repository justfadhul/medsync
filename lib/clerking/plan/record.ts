/**
 * What the Plan reads back from the record: this visit's placed orders and prescriptions, the
 * admission medicines with their decisions, and the monitoring charts open. The desk loads these;
 * the Plan's engines take them as plain data.
 */
import type { ChartFrequency, ChartKind } from "@/lib/emr/charts/rules";
import type { OrderFrequency, OrderPriority } from "@/lib/emr/orders";
import type { RxEdit } from "@/lib/prescribing/plan-rx";
import type { HelpWanted, RequestKind } from "@/lib/requests/engine";

export interface PlacedOrder {
  id: string;
  display: string;
  /** The catalogue test id (`test.*`), when the test is on the default menu. */
  testKey: string | null;
  testId: string | null;
  priority: OrderPriority | null;
  frequency: OrderFrequency | null;
  reasonConditionIds: string[];
  at: string;
  statusText: string;
  open: boolean;
}

export interface PlacedRx {
  id: string;
  drugId: string;
  drugName: string;
  /** The prescription as it reads in the note. */
  display: string;
  /** The problem's condition version id. */
  conditionId: string | null;
  kind: "drug" | "fluid";
  state: string;
  awaitingCosign: boolean;
  cosignWithheld: boolean;
  /** The checks answered, in words: "Override allergy: Senior reviewed and agreed". */
  answered: string[];
  edits: RxEdit[];
  at: string;
}

export type AdmissionAnswer = "pending" | "continued" | "stopped" | "changed" | "held";

export interface AdmissionMedicine {
  id: string;
  display: string;
  answer: AdmissionAnswer;
  reason?: string;
}

export interface OpenChart {
  id: string;
  kind: ChartKind;
  frequency: ChartFrequency | null;
  measureUrine: boolean;
  openedByLabel: string;
}

/** A review or consult placed at this visit (ADR 0537); empty with CARE_REQUESTS off. */
export interface PlacedRequest {
  id: string;
  kind: RequestKind;
  urgency: string;
  /** A consult's help wanted, for the note line; null on a review. */
  helpWanted: HelpWanted | null;
  /** The department asked, in words. */
  targetWords: string;
  stateWord: string;
  at: string;
}

export interface PlanRecord {
  orders: PlacedOrder[];
  prescriptions: PlacedRx[];
  medicines: AdmissionMedicine[];
  charts: OpenChart[];
  requests: PlacedRequest[];
}

export const EMPTY_RECORD: PlanRecord = {
  orders: [],
  prescriptions: [],
  medicines: [],
  charts: [],
  requests: [],
};

/** A prescription that stands (not cancelled, not withheld by the co-signer). */
export const standing = (r: PlacedRx) => r.state !== "cancelled" && !r.cosignWithheld;
