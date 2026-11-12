import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Pharmacy Phase 1: dispensing with stock (migrations 0122–0130 — GATED; GATE A signed 12 Oct 2026,
 * docs/pharmacy/phase-1/gate-a-proposal.md §8). The SQL is the source of truth: the append-only
 * triggers, the stock guard, the supply ↔ movement pairing at commit (Law 3) and every CHECK live
 * there. These mirrors carry columns only; tests/emr-db/drizzle-parity.test.ts keeps them equal.
 */
const tz = { withTimezone: true } as const;

/* ─── 0122 foundations ─────────────────────────────────────────────── */

export const pharmacySignedSets = pgTable("pharmacy_signed_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  kind: text("kind").notNull(),
  version: integer("version").notNull(),
  content: jsonb("content").notNull(),
  sha256: text("sha256").notNull(),
  status: text("status").$type<"draft" | "signed" | "retired">().notNull().default("draft"),
  authoredBy: uuid("authored_by").notNull(),
  firstSigner: uuid("first_signer"),
  firstSignerRole: text("first_signer_role"),
  secondSigner: uuid("second_signer"),
  secondSignerRole: text("second_signer_role"),
  exceptionText: text("exception_text"),
  signedAt: timestamp("signed_at", tz),
  retiredAt: timestamp("retired_at", tz),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const pharmacyAttestations = pgTable("pharmacy_attestations", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  actorUserId: uuid("actor_user_id").notNull(),
  attesterUserId: uuid("attester_user_id"),
  purpose: text("purpose").$type<"witness" | "signer">().notNull(),
  action: text("action").notNull(),
  method: text("method").notNull().default("password+totp"),
  outcome: text("outcome").$type<"passed" | "failed" | "locked">().notNull(),
  attestedAt: timestamp("attested_at", tz).notNull().defaultNow(),
});

/* ─── 0123 catalogue ───────────────────────────────────────────────── */

export const pharmacyProducts = pgTable("pharmacy_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  medicineId: text("medicine_id").notNull(),
  name: text("name").notNull(),
  manufacturer: text("manufacturer"),
  strength: text("strength"),
  packSize: text("pack_size"),
  issueUnit: text("issue_unit").notNull(),
  registrationNumber: text("registration_number"),
  priceUgx: numeric("price_ugx", { precision: 14, scale: 2 }),
  /** SC-3 (0180): optional GS1 GTIN, one active product per hospital. */
  gtin: text("gtin"),
  /** 0255: formulary (on the prescribing list) or a health supply; non-formulary products carry a `cat_` key. */
  itemKind: text("item_kind").notNull().default("formulary"),
  cataloguePackId: uuid("catalogue_pack_id"),
  catalogueMedicineId: uuid("catalogue_medicine_id"),
  localProposalId: uuid("local_proposal_id"),
  /** Rework 0265: the controlled class from the signed list, so the ledger guard can tell a controlled batch. */
  controlledClass: text("controlled_class"),
  /** 0276: Receive checks VVM and freeze on a vaccine; `ownCode` = the GTIN is our in-house 200… code; the shelf it lives on. */
  vaccine: boolean("vaccine").notNull().default(false),
  ownCode: boolean("own_code").notNull().default(false),
  usualShelf: text("usual_shelf"),
  active: boolean("active").notNull().default(true),
  addedAtWindow: boolean("added_at_window").notNull().default(false),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

export const pharmacyProductPoints = pgTable(
  "pharmacy_product_points",
  {
    productId: uuid("product_id").notNull(),
    dispensingPointId: uuid("dispensing_point_id").notNull(),
    hospitalId: uuid("hospital_id").notNull(),
    active: boolean("active").notNull().default(true),
    startedAt: timestamp("started_at", tz).notNull().defaultNow(),
    endedAt: timestamp("ended_at", tz),
    endedBy: uuid("ended_by"),
  },
  (t) => [primaryKey({ columns: [t.productId, t.dispensingPointId] })],
);

export const pharmacyNationalListEditions = pgTable("pharmacy_national_list_editions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  publishedOn: date("published_on"),
  sourceRef: text("source_ref").notNull(),
  importedBy: uuid("imported_by").notNull(),
  importedAt: timestamp("imported_at", tz).notNull().defaultNow(),
});

export const pharmacyNationalListRows = pgTable("pharmacy_national_list_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  editionId: uuid("edition_id").notNull(),
  genericName: text("generic_name").notNull(),
  form: text("form"),
  strength: text("strength"),
  levelOfCare: text("level_of_care"),
  venClass: text("ven_class"),
  therapeuticClass: text("therapeutic_class"),
  sourceLine: integer("source_line"),
  // 0136: what the edition prints beside the six import columns, as printed.
  kind: text("kind").$type<"medicine" | "supply">().notNull().default("medicine"),
  listSection: text("list_section"),
  unit: text("unit"),
  specialist: boolean("specialist").notNull().default(false),
  sourcePage: integer("source_page"),
  checkNote: text("check_note"),
});

/** 0136: a person checked a flagged row against the source. Append-only, one per row. */
export const pharmacyNationalListRowChecks = pgTable("pharmacy_national_list_row_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  rowId: uuid("row_id").notNull(),
  checkedBy: uuid("checked_by").notNull(),
  checkedAt: timestamp("checked_at", tz).notNull().defaultNow(),
  note: text("note").notNull(),
});

export const pharmacyMedicineLinks = pgTable("pharmacy_medicine_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  medicineId: text("medicine_id").notNull(),
  rowId: uuid("row_id").notNull(),
  editionId: uuid("edition_id").notNull(),
  linkedBy: uuid("linked_by").notNull(),
  linkedAt: timestamp("linked_at", tz).notNull().defaultNow(),
});

/* ─── 0124 stock ───────────────────────────────────────────────────── */

export const MOVEMENT_KINDS = [
  "received",
  "supplied",
  "reversed",
  "adjusted",
  "count_correction",
  "transfer_out",
  "transfer_in",
  // Phase 2 (0180, SL-12)
  "issued",
  "received_from_issue",
  "returned_out",
  "returned_in",
  "lent",
  "borrowed",
  "loan_returned_out",
  "loan_returned_in",
  "ward_used",
  "cart_used",
  "quarantined_out",
  "quarantined_in",
  "written_off",
  "returned_to_supplier",
  // Phase 4 (0230, SA-1): two-leg moves into and out of a point's `prepared` location
  "set_aside_out",
  "set_aside_in",
  "released_out",
  "released_in",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const pharmacyBatches = pgTable("pharmacy_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  /** A dispensing point's id, or NULL at a Phase 2 location (0180: `location_id`). */
  dispensingPointId: uuid("dispensing_point_id"),
  locationId: uuid("location_id"),
  productId: uuid("product_id").notNull(),
  batchNumber: text("batch_number").notNull(),
  expiry: date("expiry").notNull(),
  expiryMonthOnly: boolean("expiry_month_only").notNull().default(false),
  firstBatchNumber: text("first_batch_number").notNull(),
  firstExpiry: date("first_expiry").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const pharmacyStockMovements = pgTable("pharmacy_stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  /** A dispensing point's id, or NULL at a Phase 2 location (0180: `location_id`). */
  dispensingPointId: uuid("dispensing_point_id"),
  locationId: uuid("location_id"),
  pairId: uuid("pair_id"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }),
  allocated: boolean("allocated").notNull().default(false),
  counterpartyId: uuid("counterparty_id"),
  loanMovementId: uuid("loan_movement_id"),
  batchId: uuid("batch_id").notNull(),
  kind: text("kind").$type<MovementKind>().notNull(),
  quantity: integer("quantity").notNull(),
  effectiveAt: timestamp("effective_at", tz).notNull(),
  recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
  actorUserId: uuid("actor_user_id").notNull(),
  reasonCode: text("reason_code"),
  reasonNote: text("reason_note"),
  sourceKind: text("source_kind").notNull(),
  sourceId: uuid("source_id"),
  deliveryFrom: text("delivery_from"),
  deliveryRef: text("delivery_ref"),
  witnessAttestationId: uuid("witness_attestation_id"),
  downtime: boolean("downtime").notNull().default(false),
  /** Rework 0265: the movement this one mirrors (one reversal per movement). */
  reversesId: uuid("reverses_id"),
  /** 0269: the right line replacing a reversed one (Records › correct an entry). */
  correctionOfId: uuid("correction_of_id"),
  /** Rework 0265: a downtime back-entry's witness, as written on the paper sheet. */
  paperWitnessName: text("paper_witness_name"),
  idempotencyKey: text("idempotency_key"),
  /** Generated: entered more than 30 minutes after it happened. Never written. */
  late: boolean("late").generatedAlwaysAs(sql`recorded_at - effective_at > interval '30 minutes'`),
});

export const pharmacyCounts = pgTable("pharmacy_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id"),
  locationId: uuid("location_id"),
  scope: text("scope").notNull(),
  medicineId: text("medicine_id"),
  countedBy: uuid("counted_by").notNull(),
  witnessAttestationId: uuid("witness_attestation_id"),
  countedAt: timestamp("counted_at", tz).notNull().defaultNow(),
});

export const pharmacyCountLines = pgTable(
  "pharmacy_count_lines",
  {
    countId: uuid("count_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    countedQuantity: integer("counted_quantity").notNull(),
    recordedBalance: integer("recorded_balance").notNull(),
    differenceReason: text("difference_reason"),
    differenceNote: text("difference_note"),
  },
  (t) => [primaryKey({ columns: [t.countId, t.batchId] })],
);

export const pharmacyReorderLevels = pgTable("pharmacy_reorder_levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  medicineId: text("medicine_id").notNull(),
  level: integer("level"),
  setBy: uuid("set_by").notNull(),
  setAt: timestamp("set_at", tz).notNull().defaultNow(),
});

export const pharmacyStockRequests = pgTable("pharmacy_stock_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  fromPointId: uuid("from_point_id").notNull(),
  toPointId: uuid("to_point_id").notNull(),
  medicineId: text("medicine_id").notNull(),
  quantity: integer("quantity"),
  prescriptionId: uuid("prescription_id"),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: timestamp("requested_at", tz).notNull().defaultNow(),
  closedAt: timestamp("closed_at", tz),
  closedBy: uuid("closed_by"),
  closeReason: text("close_reason"),
  transferMovementId: uuid("transfer_movement_id"),
});

export const pharmacyBatchCorrections = pgTable("pharmacy_batch_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull(),
  hospitalId: uuid("hospital_id").notNull(),
  oldBatchNumber: text("old_batch_number").notNull(),
  newBatchNumber: text("new_batch_number").notNull(),
  oldExpiry: date("old_expiry").notNull(),
  newExpiry: date("new_expiry").notNull(),
  actorUserId: uuid("actor_user_id").notNull(),
  reason: text("reason").notNull(),
  witnessAttestationId: uuid("witness_attestation_id"),
  correctedAt: timestamp("corrected_at", tz).notNull().defaultNow(),
});

export const pharmacyStockouts = pgTable("pharmacy_stockouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  medicineId: text("medicine_id").notNull(),
  startedAt: timestamp("started_at", tz).notNull(),
  startMovementId: uuid("start_movement_id"),
  endedAt: timestamp("ended_at", tz),
  endMovementId: uuid("end_movement_id"),
});

/* ─── 0125 review and queries ──────────────────────────────────────── */

export const pharmacyScopeEntries = pgTable("pharmacy_scope_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  prescriptionId: uuid("prescription_id").notNull(),
  placementId: uuid("placement_id"),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  broughtBy: uuid("brought_by").notNull(),
  broughtAt: timestamp("brought_at", tz).notNull().defaultNow(),
});

export const pharmacyLineEvents = pgTable("pharmacy_line_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  prescriptionId: uuid("prescription_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id"),
  kind: text("kind").notNull(),
  lane: text("lane").$type<"pharmacist_first" | "standard">(),
  laneReasons: text("lane_reasons").array().notNull().default([]),
  ruleVersion: integer("rule_version"),
  reasonCode: text("reason_code"),
  reasonNote: text("reason_note"),
  quantitySupplied: integer("quantity_supplied"),
  quantityNotSupplied: integer("quantity_not_supplied"),
  decision: jsonb("decision"),
  patientTold: text("patient_told"),
  handoverId: uuid("handover_id"),
  replacedByPrescriptionId: uuid("replaced_by_prescription_id"),
  actorUserId: uuid("actor_user_id").notNull(),
  actorCadre: text("actor_cadre"),
  occurredAt: timestamp("occurred_at", tz).notNull().defaultNow(),
  effectiveAt: timestamp("effective_at", tz).notNull().defaultNow(),
  clientKey: text("client_key"),
});

export const pharmacyQueries = pgTable("pharmacy_queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  scope: text("scope").$type<"line" | "prescription">().notNull(),
  prescriptionId: uuid("prescription_id").notNull(),
  placementId: uuid("placement_id"),
  typeCode: text("type_code").notNull(),
  proposal: text("proposal").notNull(),
  patientWaiting: boolean("patient_waiting").notNull().default(false),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  senderUserId: uuid("sender_user_id").notNull(),
  senderCadre: text("sender_cadre"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  /** IV-2a (0210): asks a question or proposes a change. */
  intent: text("intent")
    .$type<"asks_question" | "proposes_change">()
    .notNull()
    .default("proposes_change"),
  clientKey: text("client_key"),
});

export const pharmacyQueryEvents = pgTable("pharmacy_query_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  queryId: uuid("query_id").notNull(),
  hospitalId: uuid("hospital_id").notNull(),
  kind: text("kind").notNull(),
  recipientUserId: uuid("recipient_user_id"),
  recipientRole: text("recipient_role"),
  answer: text("answer").$type<"keep" | "changed" | "stopped">(),
  answerReasonCode: text("answer_reason_code"),
  note: text("note"),
  via: text("via").$type<"app" | "phone">(),
  answeredByUserId: uuid("answered_by_user_id"),
  replacedByPrescriptionId: uuid("replaced_by_prescription_id"),
  actorUserId: uuid("actor_user_id").notNull(),
  occurredAt: timestamp("occurred_at", tz).notNull().defaultNow(),
  clientKey: text("client_key"),
});

/* ─── 0126 supply ──────────────────────────────────────────────────── */

export const pharmacyHandovers = pgTable("pharmacy_handovers", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  collector: text("collector").notNull(),
  collectorName: text("collector_name"),
  collectorRelationship: text("collector_relationship"),
  collectorUserId: uuid("collector_user_id"),
  identityRoute: text("identity_route").notNull(),
  secondIdentifier: text("second_identifier"),
  identifiedHow: text("identified_how"),
  identifiedNote: text("identified_note"),
  sheetIdentity: text("sheet_identity"),
  labelMode: text("label_mode").notNull(),
  labelsWrittenAttested: boolean("labels_written_attested").notNull().default(false),
  counselling: text("counselling").array().notNull().default([]),
  // 0280 (prescribing kit F4): "I checked who they are, and explained how to take each medicine".
  explainedAttested: boolean("explained_attested").notNull().default(false),
  language: text("language"),
  paymentStatus: text("payment_status").notNull().default("not_recorded"),
  paymentDetail: text("payment_detail"),
  actorUserId: uuid("actor_user_id").notNull(),
  actorCadre: text("actor_cadre"),
  clientKey: text("client_key").notNull(),
  enteredAfterDowntime: boolean("entered_after_downtime").notNull().default(false),
  sheetNumber: integer("sheet_number"),
  sheetRow: integer("sheet_row"),
  suppliedAt: timestamp("supplied_at", tz).notNull().defaultNow(),
  enteredAt: timestamp("entered_at", tz).notNull().defaultNow(),
});

export const pharmacySupplies = pgTable("pharmacy_supplies", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoverId: uuid("handover_id").notNull(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  // Exactly one of the hospital and the partner supplies (0231 ps_supplier, ADR 0437); a partner supply has no
  // product or batch keys and moves no hospital stock (RT-5).
  supplyingHospitalId: uuid("supplying_hospital_id"),
  supplyingPartnerId: uuid("supplying_partner_id"),
  routingId: uuid("routing_id"),
  patientUserId: uuid("patient_user_id").notNull(),
  prescriptionId: uuid("prescription_id"),
  paperPrescriptionLineId: uuid("paper_prescription_line_id"),
  productId: uuid("product_id"),
  batchId: uuid("batch_id"),
  partnerProductText: text("partner_product_text"),
  partnerRegistrationNumber: text("partner_registration_number"),
  partnerBatchText: text("partner_batch_text"),
  partnerExpiry: date("partner_expiry"),
  supervisingPharmacistUserId: uuid("supervising_pharmacist_user_id"),
  quantity: integer("quantity").notNull(),
  issueUnit: text("issue_unit").notNull(),
  daysCovered: integer("days_covered"),
  priceUgx: numeric("price_ugx", { precision: 14, scale: 2 }),
  prescribedStrength: text("prescribed_strength"),
  suppliedStrength: text("supplied_strength"),
  substitutionReason: text("substitution_reason"),
  pharmacistLine: text("pharmacist_line"),
  pharmacistLineBy: uuid("pharmacist_line_by"),
  reviewEventId: uuid("review_event_id"),
  batchChoiceReason: text("batch_choice_reason"),
  suppliedAt: timestamp("supplied_at", tz).notNull(),
  enteredAfterDowntime: boolean("entered_after_downtime").notNull().default(false),
  // 0257: the payer and which of Law 11's three it was, beside the `price_ugx` snapshot.
  payerId: uuid("payer_id"),
  priceKind: text("price_kind").$type<"priced" | "free" | "price_not_set">(),
});

export const pharmacySupplyReversals = pgTable("pharmacy_supply_reversals", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplyId: uuid("supply_id").notNull(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  packFit: boolean("pack_fit").notNull(),
  returnedMovementId: uuid("returned_movement_id").notNull(),
  writeoffMovementId: uuid("writeoff_movement_id"),
  witnessAttestationId: uuid("witness_attestation_id"),
  actorUserId: uuid("actor_user_id").notNull(),
  actorCadre: text("actor_cadre"),
  reversedAt: timestamp("reversed_at", tz).notNull().defaultNow(),
});

export const pharmacySupplyCorrections = pgTable("pharmacy_supply_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplyId: uuid("supply_id").notNull(),
  hospitalId: uuid("hospital_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  note: text("note"),
  actorUserId: uuid("actor_user_id").notNull(),
  correctedAt: timestamp("corrected_at", tz).notNull().defaultNow(),
});

export const pharmacyLookBacks = pgTable("pharmacy_look_backs", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  supplyId: uuid("supply_id").notNull(),
  kind: text("kind").$type<"flagged" | "looked">().notNull(),
  reasons: text("reasons").array().notNull().default([]),
  note: text("note"),
  actorUserId: uuid("actor_user_id").notNull(),
  at: timestamp("at", tz).notNull().defaultNow(),
});

export const pharmacyIdentityAttempts = pgTable("pharmacy_identity_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  handoverKey: text("handover_key").notNull(),
  identifier: text("identifier").$type<"date_of_birth" | "phone">().notNull(),
  outcome: text("outcome").$type<"match" | "mismatch" | "closed" | "reopened">().notNull(),
  actorUserId: uuid("actor_user_id").notNull(),
  attemptedAt: timestamp("attempted_at", tz).notNull().defaultNow(),
});

export const pharmacyPrintEvents = pgTable("pharmacy_print_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id"),
  kind: text("kind").notNull(),
  refId: uuid("ref_id"),
  copies: integer("copies").notNull().default(1),
  outcome: text("outcome").notNull().default("printed"),
  actorUserId: uuid("actor_user_id").notNull(),
  printedAt: timestamp("printed_at", tz).notNull().defaultNow(),
});

export const pharmacySlips = pgTable("pharmacy_slips", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  code: text("code").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  prescriptionIds: uuid("prescription_ids").array().notNull(),
  copyCount: integer("copy_count").notNull().default(1),
  printedBy: uuid("printed_by").notNull(),
  printedAt: timestamp("printed_at", tz).notNull().defaultNow(),
});

export const pharmacyPatientNotices = pgTable("pharmacy_patient_notices", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  prescriptionId: uuid("prescription_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  kind: text("kind").notNull(),
  channel: text("channel").notNull(),
  outcome: text("outcome").notNull(),
  sentBy: uuid("sent_by").notNull(),
  sentAt: timestamp("sent_at", tz).notNull().defaultNow(),
  /** 0134: why it was not sent (Law 11); null when sent. */
  reason: text("reason"),
  /** 0134: the outcome event an owed or buying-outside message answers (one per event, MS-3). */
  lineEventId: uuid("line_event_id"),
});

/* ─── 0127 controlled ──────────────────────────────────────────────── */

export const pharmacyControlledEntries = pgTable("pharmacy_controlled_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  /** NULL for a ward, cart or clinic register (rework 0265: `location_id`). */
  dispensingPointId: uuid("dispensing_point_id"),
  locationId: uuid("location_id"),
  medicineId: text("medicine_id").notNull(),
  kind: text("kind").notNull(),
  handoverId: uuid("handover_id"),
  movementId: uuid("movement_id"),
  countId: uuid("count_id"),
  confirmsEntryId: uuid("confirms_entry_id"),
  witnessAttestationId: uuid("witness_attestation_id"),
  witnessNameAsWritten: text("witness_name_as_written"),
  paperPrescriptionAttested: boolean("paper_prescription_attested").notNull().default(false),
  registerAttested: boolean("register_attested").notNull().default(false),
  witnessAgreedBalance: integer("witness_agreed_balance"),
  actorUserId: uuid("actor_user_id").notNull(),
  actorCadre: text("actor_cadre"),
  recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
});

export const pharmacyControlledDifferences = pgTable("pharmacy_controlled_differences", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  countId: uuid("count_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  countedQuantity: integer("counted_quantity").notNull(),
  recordedBalance: integer("recorded_balance").notNull(),
  supplierUserId: uuid("supplier_user_id").notNull(),
  witnessAttestationId: uuid("witness_attestation_id").notNull(),
  correctionMovementId: uuid("correction_movement_id").notNull(),
  recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
  closedAt: timestamp("closed_at", tz),
  closedBy: uuid("closed_by"),
  closeNote: text("close_note"),
});

/* ─── 0128 paper prescriptions (the downtime columns live in lab-safety.ts) ── */

export const paperPrescriptions = pgTable("paper_prescriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  prescriberName: text("prescriber_name").notNull(),
  prescriberCadre: text("prescriber_cadre").notNull(),
  writtenOn: date("written_on").notNull(),
  sheetNumber: integer("sheet_number").notNull(),
  /** 0134: the row of a "not supplied" paper entry, once per sheet (DT-2). */
  sheetRow: integer("sheet_row"),
  transcribedBy: uuid("transcribed_by").notNull(),
  transcribedAt: timestamp("transcribed_at", tz).notNull().defaultNow(),
});

export const paperPrescriptionLines = pgTable("paper_prescription_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  paperPrescriptionId: uuid("paper_prescription_id").notNull(),
  hospitalId: uuid("hospital_id").notNull(),
  lineNo: integer("line_no").notNull(),
  medicineId: text("medicine_id"),
  medicineAsWritten: text("medicine_as_written").notNull(),
  directionsAsWritten: text("directions_as_written").notNull(),
  quantityAsWritten: text("quantity_as_written"),
  notSuppliedReason: text("not_supplied_reason"),
  notSuppliedOutcome: text("not_supplied_outcome"),
});

/* ─── 0129 going live ──────────────────────────────────────────────── */

export const pharmacyGolive = pgTable("pharmacy_golive", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  action: text("action").$type<"switch_on" | "switch_off">().notNull(),
  conditions: jsonb("conditions").notNull(),
  reason: text("reason"),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: timestamp("requested_at", tz).notNull().defaultNow(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", tz),
  withdrawnAt: timestamp("withdrawn_at", tz),
});

export const pharmacyBriefings = pgTable("pharmacy_briefings", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id"),
  /** 0182 (Pharmacy Phase 2, 5.12): a briefing at a store, ward or cart. */
  locationId: uuid("location_id"),
  audience: text("audience").$type<"pharmacy" | "prescribers">().notNull(),
  heldOn: date("held_on").notNull(),
  notes: text("notes"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
});

export const pharmacyLegalAnswers = pgTable("pharmacy_legal_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id"),
  question: integer("question").notNull(),
  answer: text("answer").notNull(),
  sourceRef: text("source_ref").notNull(),
  givenBy: text("given_by").notNull(),
  givenOn: date("given_on").notNull(),
  interim: boolean("interim").notNull().default(true),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
});

export const pharmacyPilotNotes = pgTable("pharmacy_pilot_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  note: text("note").notNull(),
  writtenBy: uuid("written_by").notNull(),
  writtenAt: timestamp("written_at", tz).notNull().defaultNow(),
});

export const pharmacyHospitalSettings = pgTable("pharmacy_hospital_settings", {
  hospitalId: uuid("hospital_id").primaryKey(),
  individualInpatientSupply: boolean("individual_inpatient_supply").notNull().default(false),
  paymentStatusRequired: boolean("payment_status_required").notNull().default(false),
  supplyWithoutPharmacist: boolean("supply_without_pharmacist").notNull().default(false),
  supplyWithoutPharmacistRequestedBy: uuid("supply_without_pharmacist_requested_by"),
  supplyWithoutPharmacistApprovedBy: uuid("supply_without_pharmacist_approved_by"),
  expiryLookaheadDays: integer("expiry_lookahead_days"),
  liveSms: boolean("live_sms").notNull().default(false),
  logColumns: jsonb("log_columns"),
  logColumnsConfirmedBy: uuid("log_columns_confirmed_by"),
  logColumnsConfirmedAt: timestamp("log_columns_confirmed_at", tz),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/* ─── 0130 the prescriber's cancel and the print record ────────────── */

export const prescriptionCancellations = pgTable("prescription_cancellations", {
  id: uuid("id").primaryKey().defaultRandom(),
  prescriptionId: uuid("prescription_id").notNull(),
  hospitalId: uuid("hospital_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  note: text("note"),
  replacedByPrescriptionId: uuid("replaced_by_prescription_id"),
  queryId: uuid("query_id"),
  actorUserId: uuid("actor_user_id").notNull(),
  actorCadre: text("actor_cadre"),
  cancelledAt: timestamp("cancelled_at", tz).notNull().defaultNow(),
});

export const prescriptionPrintEvents = pgTable("prescription_print_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  prescriptionId: uuid("prescription_id").notNull(),
  hospitalId: uuid("hospital_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  printedBy: uuid("printed_by").notNull(),
  printedAt: timestamp("printed_at", tz).notNull().defaultNow(),
});

/* ─── 0131 payment status before the hand-over (SU-12) ─────────────── */

export const pharmacyPaymentStatuses = pgTable("pharmacy_payment_statuses", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  prescriptionId: uuid("prescription_id").notNull(),
  placementId: uuid("placement_id"),
  status: text("status")
    .$type<"paid" | "exempt" | "insured" | "emergency" | "not_recorded">()
    .notNull(),
  detail: text("detail"),
  dispensingPointId: uuid("dispensing_point_id").notNull(),
  actorUserId: uuid("actor_user_id").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ─── 0132 not-supplied notice acknowledgements (RQ-11) ────────────── */

export const pharmacyNoticeAcknowledgements = pgTable("pharmacy_notice_acknowledgements", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  lineEventId: uuid("line_event_id").notNull().unique(),
  choice: text("choice").$type<"left_as_is" | "alternative_chosen">().notNull(),
  replacedByPrescriptionId: uuid("replaced_by_prescription_id"),
  actorUserId: uuid("actor_user_id").notNull(),
  acknowledgedAt: timestamp("acknowledged_at", tz).notNull().defaultNow(),
});

/* ─── 0133 the prescriber's stock answer (AV-8, D-PH1-44) ──────────── */

export const pharmacyStockAnswers = pgTable("pharmacy_stock_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull(),
  patientUserId: uuid("patient_user_id").notNull(),
  prescriptionId: uuid("prescription_id").notNull().unique(),
  state: text("state")
    .$type<"not_linked" | "not_stocked" | "not_counted" | "out" | "low" | "in_stock">()
    .notNull(),
  pointId: uuid("point_id"),
  pointName: text("point_name"),
  lastCountAt: timestamp("last_count_at", tz),
  lastReceiptAt: timestamp("last_receipt_at", tz),
  since: timestamp("since", tz),
  level: text("level").$type<"note" | "check" | "not_checked">().notNull(),
  answer: text("answer"),
  recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
});
