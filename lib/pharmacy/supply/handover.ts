import type { CollectorInput, CollectorRow, SecondIdentifier } from "./identity";
import type { PharmacyAccess } from "@/lib/pharmacy/access";
import type { PrescriptionLane } from "@/lib/pharmacy/lanes";
import type { LineEventKind, LineStatus, Move, MoveKind, OpenOutcome } from "@/lib/pharmacy/lines";
import type { ReviewEvent } from "@/lib/pharmacy/review/review";
import type { BatchRow } from "@/lib/pharmacy/stock/fefo";
import type { Batch, MovementKind } from "@/lib/pharmacy/stock/ledger";

import { PRESCRIBE_HANDOFF_COPY } from "@/content/pharmacy-prescriber";
import { can } from "@/lib/pharmacy/access";
import { priceSnapshot, sameStrength } from "@/lib/pharmacy/catalogue";
import { applyMove, quantityLeft } from "@/lib/pharmacy/lines";
import { printTime } from "@/lib/pharmacy/print/label";
import {
  reviewBasis,
  supplyWithoutReviewAllowed,
  WAITING_FOR_PHARMACIST,
} from "@/lib/pharmacy/review/review";
import { batchChoiceNeedsReason, proposeBatches } from "@/lib/pharmacy/stock/fefo";
import { isExpired } from "@/lib/pharmacy/stock/ledger";
import { identifiedAnotherWay, IDENTITY_COPY, validateCollector } from "./identity";

/**
 * The hand-over (Pharmacy Phase 1; SU-1..SU-3, SU-6..SU-10, SU-12, Law 3, Law 6, Law 10, H2, H3, W4,
 * 5.6). Pure: `checkHandover` is the server's re-check under the locks (SU-2); `handoverWrites` turns a
 * plan that passes into exactly the rows the store inserts, so the store decides nothing.
 *
 * - SU-2 Refused, for every line, unless: co-signed and not cancelled (H1: `completed` is not continued,
 *   so refused); the decision's version is the current one; the line is at `ready` (or owed / buying
 *   outside, for the rest) and the quantity is no more than is left (H3); a pharmacist-first line has an
 *   acceptance of that version, or D-PH1-05's reason (never controlled); each batch is of the product, at
 *   the point, unexpired and holds the quantity (summed across the hand-over); each quantity is a whole
 *   number above zero in the issue unit; the product is the prescribed medicine, or SU-8 applies. And
 *   unless identity is confirmed (SU-4), the actor holds `pharmacy.dispense`, the point is live and the
 *   payment status meets SU-12. A controlled line goes through the controlled supply (6.9), never here.
 * - SU-3 Any batch choice other than first expiry, first out needs a coded reason.
 * - SU-8, W4, H2 Same strength, another pack: anyone who may dispense. A different strength: only with a
 *   signed strength mapping (none exists, so refused), `pharmacy.review`, a coded reason and the
 *   pharmacist's line (2–80 characters). A strength that cannot be compared needs the supplier's check.
 * - SU-6 The quantity is never pre-filled: no prescription carries a structured quantity (Q3).
 * - SU-1, Law 3 One supply and one `supplied` movement of the same quantity per batch; one outcome event
 *   per line (`lines.ts` conventions); one hand-over row. SU-9: the supplying point and organisation
 *   are their own fields.
 * - SU-10 Idempotency is the database's unique client key; this only validates its shape.
 * - SU-12 Where the hospital requires a status, `not_recorded` is refused; `emergency` always passes.
 * Words: Appendix B B-19, B-20, B-21, B-6, B-7 and B-38 where it has them; the rest are new drafts.
 */

export const HANDOVER_COPY = {
  status: "signed",
  signedBy: "Fadhul (CSO)",
  signedOn: "2026-10-13",
  batchShort: "Batch {number} now holds {n}. Choose again.",
  alreadySupplied: "{Medicine} was already supplied at {point}, {time}.",
  changed: "{Medicine} was changed by the prescriber at {time}. Review it again.",
  awaitingCosign: "Cannot be supplied yet. A senior has not signed this prescription.",
  waiting: WAITING_FOR_PHARMACIST,
  identity: IDENTITY_COPY.rule,
  // New drafts (not in Appendix B):
  stopped: "{Medicine} was stopped by the prescriber. It cannot be supplied.",
  hasOutcome: "{Medicine} already has an outcome. Review it again.",
  notReady: "{Medicine} is not ready to supply. Review it again.",
  controlled: "{Medicine} is a controlled drug. Use the controlled supply.",
  overQuantity: "{Medicine}: only {n} left to supply.",
  wholeQuantity: "{Medicine}: supply the full {n} left, or record what happens to the rest.",
  rest: "{Medicine}: say what happens to the rest, with a reason.",
  quantity: "{Medicine}: each quantity must be a whole number above zero.",
  product: "{Medicine}: this product is not the prescribed medicine.",
  strengthCheck: "{Medicine}: check the strength on the pack against the prescription.",
  strengthUnsigned:
    "{Medicine}: no strength change is signed at this hospital. Supply the prescribed strength or ask the prescriber.",
  strengthPharmacist: "{Medicine}: only a pharmacist may supply a different strength.",
  strengthReason: "{Medicine}: a different strength needs a reason and the pharmacist's line.",
  batchWrong: "{Medicine}: batch {number} is not this product at this dispensing point.",
  batchExpired: "Batch {number} expired on {date}. Remove it from the shelf.",
  batchBlocked: "Batch {number} is recalled. It cannot be supplied; move it to quarantine.",
  batchReason: "{Medicine}: a batch that is not first to expire needs a reason.",
  permission: "You cannot record a hand-over.",
  pointNotLive: "This dispensing point is not recording supplies in MedSync.",
  payment: "Record the payment status before the hand-over.",
  collector: "Say who is collecting.",
  identityRoute: "Choose how the person was identified. Other needs a note.",
  labels: "Tick that the label is written on each envelope.",
  lines: "Choose at least one line to supply, each once.",
  clientKey: "This hand-over could not be sent. Try again.",
} as const;

const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{([\w ]+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

/* ─── The plan and the facts ───────────────────────────────────────── */

export type PaymentStatus = "paid" | "exempt" | "insured" | "emergency" | "not_recorded";

export type IdentityInput =
  | { route: "two_identifiers"; nameAttested: boolean }
  | { route: "identified_another_way"; nameAttested: boolean; how: string; note?: string | null }
  | { route: "ward_staff" };

export interface PlanLine {
  /** The line version the decision was made on. */
  lineId: string;
  productId: string;
  /** One row per batch, in the issue unit. */
  rows: readonly BatchRow[];
  batchChoiceReason?: string | null;
  /** SU-7: a part supply says what happens to the rest (both quantities typed by a person). */
  rest?: { outcome: OpenOutcome; quantityNotSupplied: number | null; reasonCode: string } | null;
  /** SU-8: a different strength. */
  strengthChange?: { reasonCode: string; pharmacistLine: string } | null;
  /** H2: the supplier checked the pack's strength where it cannot be compared as text. */
  strengthConfirmed?: boolean;
  daysCovered?: number | null;
}

export interface HandoverPlan {
  clientKey: string;
  hospitalId: string;
  pointId: string;
  patientUserId: string;
  actor: { userId: string; cadre: string; access: PharmacyAccess };
  lines: readonly PlanLine[];
  collector: CollectorInput;
  identity: IdentityInput;
  labelMode: "printed" | "by_hand";
  labelsWrittenAttested?: boolean;
  /** Kit F4: "I checked who they are, and explained how to take each medicine". */
  explainedAttested?: boolean;
  counselling?: readonly string[];
  language?: string | null;
  payment: { status: PaymentStatus; detail?: string | null };
  suppliedAt: Date;
  /** CD-2: the standing witness attestation of a controlled supply; on each controlled movement. */
  witnessAttestationId?: string | null;
}

/** What the server read under the locks for one line of the plan. */
export interface LineFacts {
  medicineId: string;
  medicineName: string;
  prescribedStrength: string | null;
  /** The line's current row id; differs from the plan's when the prescriber changed it. */
  currentVersionId: string;
  changedAt: Date | null;
  cosign: "none" | "awaiting" | "signed" | "withheld";
  state: "active" | "administered" | "completed" | "cancelled";
  controlled: boolean;
  lane: PrescriptionLane;
  status: LineStatus;
  /** The quantity decided for the line, where recorded (LO-9). */
  decided: number | null;
  reviewEvents: readonly ReviewEvent[];
  /** Where and when it was supplied, for B-20. */
  lastSupply: { pointName: string; at: Date } | null;
}

export interface HandoverFacts {
  /** Hospital-local date (Africa/Kampala). */
  today: string;
  pointLive: boolean;
  paymentRequired: boolean;
  /** Law 13 (catalogue slice Step 8): an admitted patient's supply never waits on payment. */
  admitted?: boolean;
  inpatientSupplyOn: boolean;
  collectorIsHospitalStaff: boolean;
  supplyWithoutReview: { settingOn: boolean; legalQ1OnRecord: boolean };
  /** W4: a signed strength mapping between catalogue ids. None exists yet. */
  strengthChangeSigned: boolean;
  /** D-PH1-16: the signed identity routes; null while unsigned. */
  identityRoutes: readonly string[] | null;
  /** SU-4: the server's logged match for this hand-over, if any. */
  secondIdentifierMatched: SecondIdentifier | null;
  lines: ReadonlyMap<string, LineFacts>;
  products: ReadonlyMap<
    string,
    {
      medicineId: string;
      strength: string | null;
      issueUnit: string;
      priceUgx: string | null;
      /** Catalogue slice Step 8: the price in force (`priceUgx` above), which of Law 11's three, the payer. */
      priceKind?: "priced" | "free" | "price_not_set";
      payerId?: string | null;
    }
  >;
  batches: readonly Batch[];
  balances: ReadonlyMap<string, number>;
  /** SL-14 (Phase 2): batches under an open recall; never supplied live, never proposed. */
  blocked?: ReadonlySet<string>;
  /**
   * CD-2: the controlled supply's own checks passed (pharmacy.controlled, a standing witness, a committed
   * count of each batch, both paper attestations, the witness's agreement). Only then is a controlled
   * line supplied here, and only on a pharmacist's acceptance.
   */
  controlledCleared?: boolean;
  /** Kit F4 (PRESCRIBE_V2, decided by the action): the identity and counselling confirmation is required. */
  explainRequired?: boolean;
}

export type RefusalCode =
  | "awaiting_cosign"
  | "stopped"
  | "changed"
  | "already_supplied"
  | "has_outcome"
  | "not_ready"
  | "controlled"
  | "not_accepted"
  | "over_quantity"
  | "whole_quantity"
  | "rest"
  | "quantity"
  | "product"
  | "strength_check"
  | "strength_unsigned"
  | "strength_pharmacist"
  | "strength_reason"
  | "batch_wrong"
  | "batch_expired"
  | "batch_blocked"
  | "batch_short"
  | "batch_reason"
  | "permission"
  | "point_not_live"
  | "payment"
  | "collector"
  | "identity"
  | "identity_route"
  | "labels"
  | "explained"
  | "lines"
  | "client_key";

export interface Refusal {
  lineId: string | null;
  code: RefusalCode;
  words: string;
}

/* ─── Small rules ──────────────────────────────────────────────────── */

/** SU-6: no prescription carries a structured quantity (Q3); never derived from the dose text. */
export const quantityPrefill = (_prescriptionQuantity?: unknown): null => null;

/** SU-10: the client key's shape (0126: 8–120 characters). The database makes a repeat the same hand-over. */
export const handoverClientKey = (key: string): boolean => key.length >= 8 && key.length <= 120;

/** SU-12; Law 13: an emergency or an admitted patient always passes. */
export const paymentPasses = (
  status: PaymentStatus,
  required: boolean,
  admitted = false,
): boolean => status === "emergency" || admitted || !required || status !== "not_recorded";

const codeOk = (s: string | null | undefined) =>
  !!s && s.trim().length >= 2 && s.trim().length <= 60;

/** The LO-4 move a hand-over makes on a line, from its status and the plan. */
function supplyMove(status: LineStatus, plan: PlanLine, quantity: number): Move | "rest_outcome" {
  const rest = plan.rest ?? null;
  const q = {
    quantitySupplied: quantity,
    quantityNotSupplied: rest?.quantityNotSupplied ?? null,
  };
  if (status.kind === "open") {
    if (!rest) return { kind: "handover_full", ...q, quantityNotSupplied: 0 };
    return rest.outcome === status.outcome ? { kind: "handover_part", ...q } : "rest_outcome";
  }
  if (!rest) return { kind: "handover_full", ...q };
  return {
    kind: rest.outcome === "owed" ? "handover_part_owed" : "handover_part_outside",
    ...q,
    reasonCode: rest.reasonCode,
  };
}

/* ─── SU-2: the re-check ───────────────────────────────────────────── */

function checkLine(
  plan: HandoverPlan,
  line: PlanLine,
  facts: HandoverFacts,
  use: Map<string, number>,
): Refusal[] {
  const f = facts.lines.get(line.lineId);
  const refuse = (code: RefusalCode, words: string): Refusal => ({
    lineId: line.lineId,
    code,
    words,
  });
  if (!f) return [refuse("not_ready", fill(HANDOVER_COPY.notReady, { Medicine: "This medicine" }))];
  const Medicine = f.medicineName;

  // The line itself: one refusal, and nothing further is checked.
  if (f.cosign === "awaiting" || f.cosign === "withheld")
    return [refuse("awaiting_cosign", HANDOVER_COPY.awaitingCosign)];
  if (
    f.currentVersionId !== line.lineId ||
    (f.status.kind === "closed" && f.status.outcome === "replaced")
  )
    return [
      refuse(
        "changed",
        fill(HANDOVER_COPY.changed, {
          Medicine,
          time: f.changedAt ? printTime(f.changedAt.toISOString()) : "",
        }),
      ),
    ];
  if (
    f.state === "completed" ||
    f.state === "cancelled" ||
    (f.status.kind === "closed" && f.status.outcome === "cancelled_by_prescriber")
  )
    return [refuse("stopped", fill(HANDOVER_COPY.stopped, { Medicine }))];
  if (f.status.kind === "closed" && f.status.outcome === "supplied")
    return [
      refuse(
        "already_supplied",
        fill(HANDOVER_COPY.alreadySupplied, {
          Medicine,
          point: f.lastSupply?.pointName ?? "",
          time: f.lastSupply ? printTime(f.lastSupply.at.toISOString()) : "",
        }),
      ),
    ];
  if (f.status.kind === "closed")
    return [refuse("has_outcome", fill(HANDOVER_COPY.hasOutcome, { Medicine }))];
  if (f.controlled && !facts.controlledCleared)
    return [refuse("controlled", fill(HANDOVER_COPY.controlled, { Medicine }))];

  const out: Refusal[] = [];

  // A pharmacist-first line: an acceptance of this version, or D-PH1-05's reason (never controlled).
  const basis = reviewBasis(f.lane, line.lineId, f.reviewEvents);
  const cleared =
    basis !== null &&
    (f.controlled ? basis.kind === "accepted" : true) &&
    (basis.kind !== "supplied_without_review" ||
      supplyWithoutReviewAllowed({
        ...facts.supplyWithoutReview,
        controlled: f.controlled,
        access: plan.actor.access,
      }).ok);
  if (!cleared) out.push(refuse("not_accepted", HANDOVER_COPY.waiting));

  // Quantities: whole, above zero; no more than is left; a full hand-over takes all that is left.
  const whole =
    line.rows.length > 0 && line.rows.every((r) => Number.isInteger(r.quantity) && r.quantity > 0);
  if (!whole) out.push(refuse("quantity", fill(HANDOVER_COPY.quantity, { Medicine })));
  const total = line.rows.reduce((s, r) => s + r.quantity, 0);
  const left = quantityLeft(f.status, f.decided);
  if (whole && left !== null && total > left)
    out.push(refuse("over_quantity", fill(HANDOVER_COPY.overQuantity, { Medicine, n: left })));
  else if (whole && left !== null && !line.rest && total < left)
    out.push(refuse("whole_quantity", fill(HANDOVER_COPY.wholeQuantity, { Medicine, n: left })));
  if (line.rest && f.status.kind === "stage" && !codeOk(line.rest.reasonCode))
    out.push(refuse("rest", fill(HANDOVER_COPY.rest, { Medicine })));

  // The stage: LO-4's table decides.
  if (whole) {
    const move = supplyMove(f.status, line, total);
    if (move === "rest_outcome") out.push(refuse("rest", fill(HANDOVER_COPY.rest, { Medicine })));
    // An uncleared pharmacist-first line is already refused as waiting for a pharmacist.
    else if (
      cleared &&
      !applyMove(f.status, move).ok &&
      !out.some((r) => r.code === "over_quantity")
    )
      out.push(refuse("not_ready", fill(HANDOVER_COPY.notReady, { Medicine })));
  }

  // The product (SU-8, H2, W4).
  const product = facts.products.get(line.productId);
  if (!product || product.medicineId !== f.medicineId)
    out.push(refuse("product", fill(HANDOVER_COPY.product, { Medicine })));
  else {
    const match = sameStrength(f.prescribedStrength, product.strength);
    if (match === "unknown" && !line.strengthConfirmed)
      out.push(refuse("strength_check", fill(HANDOVER_COPY.strengthCheck, { Medicine })));
    if (match === "different") {
      const sc = line.strengthChange;
      if (!facts.strengthChangeSigned)
        out.push(refuse("strength_unsigned", fill(HANDOVER_COPY.strengthUnsigned, { Medicine })));
      else if (!can(plan.actor.access, "pharmacy.review"))
        out.push(
          refuse("strength_pharmacist", fill(HANDOVER_COPY.strengthPharmacist, { Medicine })),
        );
      else if (
        !sc ||
        !codeOk(sc.reasonCode) ||
        sc.pharmacistLine.trim().length < 2 ||
        sc.pharmacistLine.trim().length > 80
      )
        out.push(refuse("strength_reason", fill(HANDOVER_COPY.strengthReason, { Medicine })));
    }
  }

  // The batches (SU-2, SU-3).
  for (const r of line.rows) {
    const b = facts.batches.find((x) => x.id === r.batchId);
    if (!b || b.productId !== line.productId || b.pointId !== plan.pointId) {
      out.push(
        refuse(
          "batch_wrong",
          fill(HANDOVER_COPY.batchWrong, { Medicine, number: b?.batchNumber ?? r.batchId }),
        ),
      );
      continue;
    }
    if (isExpired(b, facts.today))
      out.push(
        refuse(
          "batch_expired",
          fill(HANDOVER_COPY.batchExpired, { number: b.batchNumber, date: b.expiry }),
        ),
      );
    else if (facts.blocked?.has(b.id))
      out.push(
        refuse("batch_blocked", fill(HANDOVER_COPY.batchBlocked, { number: b.batchNumber })),
      );
    use.set(b.id, (use.get(b.id) ?? 0) + (Number.isInteger(r.quantity) ? r.quantity : 0));
  }
  if (whole && !line.batchChoiceReason?.trim()) {
    const proposal = proposeBatches({
      batches: facts.batches.filter(
        (b) =>
          b.productId === line.productId && b.pointId === plan.pointId && !facts.blocked?.has(b.id),
      ),
      balances: facts.balances,
      quantity: total,
      localDate: facts.today,
    });
    // ponytail: the proposal is per line; two lines of one product in one hand-over each get the first batch.
    if (proposal.ok && batchChoiceNeedsReason(line.rows, proposal.rows))
      out.push(refuse("batch_reason", fill(HANDOVER_COPY.batchReason, { Medicine })));
  }
  return out;
}

export function checkHandover(
  plan: HandoverPlan,
  facts: HandoverFacts,
): { ok: true } | { ok: false; refusals: Refusal[] } {
  const out: Refusal[] = [];
  const whole = (code: RefusalCode, words: string) => out.push({ lineId: null, code, words });

  if (!can(plan.actor.access, "pharmacy.dispense")) whole("permission", HANDOVER_COPY.permission);
  if (!facts.pointLive) whole("point_not_live", HANDOVER_COPY.pointNotLive);
  if (!handoverClientKey(plan.clientKey)) whole("client_key", HANDOVER_COPY.clientKey);
  const ids = plan.lines.map((l) => l.lineId);
  if (!ids.length || new Set(ids).size !== ids.length) whole("lines", HANDOVER_COPY.lines);

  // SU-4, SU-5, Law 6.
  const collector = validateCollector(plan.collector, {
    inpatientSupplyOn: facts.inpatientSupplyOn,
    isHospitalStaff: facts.collectorIsHospitalStaff,
  });
  if (!collector.ok) whole("collector", HANDOVER_COPY.collector);
  const id = plan.identity;
  if (id.route === "ward_staff") {
    if (plan.collector.kind !== "ward_staff") whole("identity", HANDOVER_COPY.identity);
  } else if (!id.nameAttested) whole("identity", HANDOVER_COPY.identity);
  else if (id.route === "two_identifiers" && facts.secondIdentifierMatched === null)
    whole("identity", HANDOVER_COPY.identity);
  else if (
    id.route === "identified_another_way" &&
    !identifiedAnotherWay(id.how, id.note, facts.identityRoutes).ok
  )
    whole("identity_route", HANDOVER_COPY.identityRoute);

  if (plan.labelMode === "by_hand" && !plan.labelsWrittenAttested)
    whole("labels", HANDOVER_COPY.labels);
  if (facts.explainRequired && !plan.explainedAttested)
    whole("explained", PRESCRIBE_HANDOFF_COPY.explainedRefused);
  if (!paymentPasses(plan.payment.status, facts.paymentRequired, facts.admitted))
    whole("payment", HANDOVER_COPY.payment);

  // Every line, then every batch summed across the hand-over.
  const use = new Map<string, number>();
  for (const line of plan.lines) out.push(...checkLine(plan, line, facts, use));
  for (const [batchId, n] of use) {
    const have = facts.balances.get(batchId) ?? 0;
    if (n > have) {
      const b = facts.batches.find((x) => x.id === batchId);
      const lineId = plan.lines.find((l) => l.rows.some((r) => r.batchId === batchId))?.lineId;
      out.push({
        lineId: lineId ?? null,
        code: "batch_short",
        words: fill(HANDOVER_COPY.batchShort, { number: b?.batchNumber ?? batchId, n: have }),
      });
    }
  }
  return out.length ? { ok: false, refusals: out } : { ok: true };
}

/* ─── SU-1: the rows ───────────────────────────────────────────────── */

export interface HandoverRow extends CollectorRow {
  id: string;
  hospitalId: string;
  dispensingPointId: string;
  patientUserId: string;
  identityRoute: "two_identifiers" | "identified_another_way" | "ward_staff";
  secondIdentifier: SecondIdentifier | null;
  identifiedHow: string | null;
  identifiedNote: string | null;
  labelMode: "printed" | "by_hand";
  labelsWrittenAttested: boolean;
  explainedAttested: boolean;
  counselling: string[];
  language: string | null;
  paymentStatus: PaymentStatus;
  paymentDetail: string | null;
  actorUserId: string;
  actorCadre: string;
  clientKey: string;
  enteredAfterDowntime: false;
  suppliedAt: Date;
}

export interface SupplyRow {
  id: string;
  handoverId: string;
  hospitalId: string;
  dispensingPointId: string;
  supplyingHospitalId: string;
  patientUserId: string;
  prescriptionId: string;
  productId: string;
  batchId: string;
  quantity: number;
  issueUnit: string;
  daysCovered: number | null;
  priceUgx: string | null;
  priceKind?: "priced" | "free" | "price_not_set";
  payerId?: string | null;
  prescribedStrength: string | null;
  suppliedStrength: string | null;
  substitutionReason: string | null;
  pharmacistLine: string | null;
  pharmacistLineBy: string | null;
  reviewEventId: string | null;
  batchChoiceReason: string | null;
  suppliedAt: Date;
  enteredAfterDowntime: false;
}

export interface MovementRow {
  id: string;
  hospitalId: string;
  dispensingPointId: string;
  batchId: string;
  kind: MovementKind;
  quantity: number;
  effectiveAt: Date;
  actorUserId: string;
  reasonCode: string | null;
  sourceKind: "supply" | "reversal";
  sourceId: string;
  witnessAttestationId: string | null;
  downtime: false;
}

/** A pharmacy_line_events row (0125), as the `lines.ts` fold reads it back. */
export interface LineEventRow {
  id: string;
  hospitalId: string;
  prescriptionId: string;
  patientUserId: string;
  dispensingPointId: string;
  kind: LineEventKind;
  lane: PrescriptionLane | null;
  quantitySupplied: number | null;
  quantityNotSupplied: number | null;
  reasonCode: string | null;
  handoverId: string | null;
  actorUserId: string;
  actorCadre: string;
}

export interface LookBackRow {
  id: string;
  hospitalId: string;
  supplyId: string;
  kind: "flagged";
  reasons: string[];
  actorUserId: string;
}

export interface HandoverWrites {
  handover: HandoverRow;
  supplies: SupplyRow[];
  movements: MovementRow[];
  lineEvents: LineEventRow[];
  lookBacks: LookBackRow[];
}

/** `lines.ts` conventions: a part from `ready` is `owed`/`buying_outside`; part of the rest, `part_supplied`. */
const EVENT_FOR: Partial<Record<MoveKind, LineEventKind>> = {
  handover_full: "supplied",
  handover_part_owed: "owed",
  handover_part_outside: "buying_outside",
  handover_part: "part_supplied",
};

/** SU-1: re-checks the plan (nothing is returned to write if anything is refused), then builds every row. */
export function handoverWrites(
  plan: HandoverPlan,
  facts: HandoverFacts,
  newId: () => string,
): { ok: true; writes: HandoverWrites } | { ok: false; refusals: Refusal[] } {
  const check = checkHandover(plan, facts);
  if (!check.ok) return check;
  const collector = validateCollector(plan.collector, {
    inpatientSupplyOn: facts.inpatientSupplyOn,
    isHospitalStaff: facts.collectorIsHospitalStaff,
  });
  if (!collector.ok) return { ok: false, refusals: [] }; // unreachable: checked above

  const handoverId = newId();
  const actor = plan.actor;
  const id = plan.identity;
  const another = id.route === "identified_another_way";
  const handover: HandoverRow = {
    id: handoverId,
    hospitalId: plan.hospitalId,
    dispensingPointId: plan.pointId,
    patientUserId: plan.patientUserId,
    ...collector.row,
    identityRoute: id.route,
    secondIdentifier: id.route === "two_identifiers" ? facts.secondIdentifierMatched : null,
    identifiedHow: another ? id.how : null,
    identifiedNote: another ? id.note?.trim() || null : null,
    labelMode: plan.labelMode,
    labelsWrittenAttested: plan.labelMode === "by_hand" && plan.labelsWrittenAttested === true,
    explainedAttested: plan.explainedAttested === true,
    counselling: [...(plan.counselling ?? [])],
    language: plan.language ?? null,
    paymentStatus: plan.payment.status,
    paymentDetail: plan.payment.detail ?? null,
    actorUserId: actor.userId,
    actorCadre: actor.cadre,
    clientKey: plan.clientKey,
    enteredAfterDowntime: false,
    suppliedAt: plan.suppliedAt,
  };

  const writes: HandoverWrites = {
    handover,
    supplies: [],
    movements: [],
    lineEvents: [],
    lookBacks: [],
  };
  for (const line of plan.lines) {
    const f = facts.lines.get(line.lineId)!;
    const product = facts.products.get(line.productId)!;
    const basis = reviewBasis(f.lane, line.lineId, f.reviewEvents);
    const changed = sameStrength(f.prescribedStrength, product.strength) === "different";
    for (const r of line.rows) {
      const supplyId = newId();
      writes.supplies.push({
        id: supplyId,
        handoverId,
        hospitalId: plan.hospitalId,
        dispensingPointId: plan.pointId,
        supplyingHospitalId: plan.hospitalId,
        patientUserId: plan.patientUserId,
        prescriptionId: line.lineId,
        productId: line.productId,
        batchId: r.batchId,
        quantity: r.quantity,
        issueUnit: product.issueUnit,
        daysCovered: line.daysCovered ?? null,
        priceUgx: priceSnapshot(product),
        ...(product.priceKind && {
          priceKind: product.priceKind,
          payerId: product.payerId ?? null,
        }),
        prescribedStrength: f.prescribedStrength,
        suppliedStrength: product.strength,
        substitutionReason: changed ? (line.strengthChange?.reasonCode ?? null) : null,
        pharmacistLine: changed ? (line.strengthChange?.pharmacistLine.trim() ?? null) : null,
        pharmacistLineBy: changed ? actor.userId : null,
        reviewEventId: basis && basis.kind !== "checked_at_supply" ? basis.eventId : null,
        batchChoiceReason: line.batchChoiceReason?.trim() || null,
        suppliedAt: plan.suppliedAt,
        enteredAfterDowntime: false,
      });
      writes.movements.push({
        id: newId(),
        hospitalId: plan.hospitalId,
        dispensingPointId: plan.pointId,
        batchId: r.batchId,
        kind: "supplied",
        quantity: -r.quantity,
        effectiveAt: plan.suppliedAt,
        actorUserId: actor.userId,
        reasonCode: null,
        sourceKind: "supply",
        sourceId: supplyId,
        witnessAttestationId: f.controlled ? (plan.witnessAttestationId ?? null) : null,
        downtime: false,
      });
      if (basis?.kind === "supplied_without_review")
        writes.lookBacks.push({
          id: newId(),
          hospitalId: plan.hospitalId,
          supplyId,
          kind: "flagged",
          reasons: ["supplied_without_review"],
          actorUserId: actor.userId,
        });
    }
    const total = line.rows.reduce((s, r) => s + r.quantity, 0);
    const move = supplyMove(f.status, line, total);
    if (move === "rest_outcome") continue; // refused by the check
    writes.lineEvents.push({
      id: newId(),
      hospitalId: plan.hospitalId,
      prescriptionId: line.lineId,
      patientUserId: plan.patientUserId,
      dispensingPointId: plan.pointId,
      kind: EVENT_FOR[move.kind]!,
      lane: f.lane,
      quantitySupplied: total,
      quantityNotSupplied: move.quantityNotSupplied ?? null,
      reasonCode: move.reasonCode ?? null,
      handoverId,
      actorUserId: actor.userId,
      actorCadre: actor.cadre,
    });
  }
  return { ok: true, writes };
}
