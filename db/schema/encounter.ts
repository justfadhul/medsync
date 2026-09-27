import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitals } from "./hospitals";
import { encounters } from "./scheduling";

/**
 * Encounter / EMR engine — the clinical-data spine (migration 0040, GATED).
 *
 * The encounter's clinical documentation is a structured Hutchison CLERKSHIP
 * (history → examination → differential → initial management) — not a free-text
 * note. This schema EXTENDS the existing `encounters` table (migration 0028;
 * db/schema/scheduling.ts adds the new columns) and adds the clinical objects
 * the clerking populates. See docs/encounter-emr-engine-gate-a-proposal.md +
 * docs/clinical/clerkship-clinical-reference.md.
 *
 * CLINICAL-SAFETY + PDPO-CRITICAL. Documentation + the encounter timeline are
 * VERSIONED / APPEND-ONLY (a correction is a new version that supersedes an
 * earlier one — nothing is silently edited/deleted). PHI free-text is encrypted
 * at rest; coded/structured fields are queryable. Clinical writes go through
 * service-role server actions (which stamp author/cadre + write the audit, incl.
 * AUDIT-ON-READ); RLS keeps reception out at the DB. Decision-support, not
 * autonomous — the clinician examines, reasons, and decides; no auto-diagnosis.
 */

/**
 * The versioned, append-only clerkship documentation. One row per VERSION of the
 * clerking for an encounter. `sectionData` holds the structured Hutchison
 * sections (history/exam/synthesis); PHI free-text within is encrypted.
 */
export const clinicalDocumentation = pgTable(
  "clinical_documentation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** 1-based version; a correction appends a new version. */
    version: integer("version").notNull().default(1),
    /** The version this one supersedes (a correction), or null for the first. */
    supersedesId: uuid("supersedes_id"),
    /** The structured Hutchison clerking (history/exam/synthesis). PHI in here. */
    sectionData: jsonb("section_data").notNull(),
    status: text("status").notNull().default("draft"),
    authoredByUserId: uuid("authored_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    authorCadreCode: text("author_cadre_code"),
    /** Junior-clerking co-sign hook (a senior attests) — soft, surfaced. */
    cosignedByUserId: uuid("cosigned_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("clin_doc_status_check", sql`${t.status} IN ('draft','final')`),
    // One row per (encounter, version) — a racing corrector errors rather than
    // silently duplicating a version number (see record.ts version increment).
    unique("clin_doc_encounter_version_unique").on(t.encounterId, t.version),
    index("clin_doc_patient_idx").on(t.patientUserId, t.createdAt),
  ],
);

/** The differential → diagnoses (working/final/excluded), ICD-10 where codable. */
export const encounterDiagnoses = pgTable(
  "encounter_diagnoses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    icd10Code: text("icd10_code"),
    text: text("text").notNull(),
    /** Rank within the differential (1 = most likely). */
    rank: integer("rank"),
    /** A "must-not-miss" dangerous diagnosis to exclude (safety-net). */
    mustNotMiss: boolean("must_not_miss").notNull().default(false),
    status: text("status").notNull().default("working"),
    authoredByUserId: uuid("authored_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("enc_dx_status_check", sql`${t.status} IN ('working','final','excluded')`),
    index("enc_dx_encounter_idx").on(t.encounterId),
    index("enc_dx_patient_idx").on(t.patientUserId, t.createdAt),
  ],
);

/** The patient-level problem list (acute + chronic), ICD-10 where codable. */
export const problemList = pgTable(
  "problem_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    item: text("item").notNull(),
    icd10Code: text("icd10_code"),
    active: boolean("active").notNull().default(true),
    onset: text("onset"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    sourceEncounterId: uuid("source_encounter_id").references(() => encounters.id, {
      onDelete: "set null",
    }),
    authoredByUserId: uuid("authored_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    /* ── Assessment-synthesis projection (GATED migration 0049; nullable so the
       legacy rows + the un-flagged write path are unaffected). Mirrors the richer
       `ClerkProblem` modelling carried in the versioned section_data, so the
       problem list is QUERYABLE by kind/status/linkage without parsing JSON.
       Written only when `problemListSynthesisLive()` is on. ── */
    /** Where the problem entered from: a vital / a working diagnosis / an exam
     *  finding / active background. */
    kind: text("kind"),
    /** Lifecycle in the synthesis sense — `active`, `resolved`, or `linked`
     *  (subsumed under a working diagnosis; the canonical `active` boolean still
     *  drives the live list, derived as status !== 'resolved'). */
    status: text("status"),
    /** The working-diagnosis text this problem is linked/merged under (the
     *  clinician's act); null when the problem stands on its own. */
    linkedTo: text("linked_to"),
    /** Auditable provenance string for the proposal (e.g. "vitals · NEWS2 +2"). */
    provenance: text("provenance"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("problem_list_patient_idx").on(t.patientUserId, t.active),
    check(
      "problem_list_kind_check",
      sql`${t.kind} IS NULL OR ${t.kind} IN ('vital','diagnosis','finding','background')`,
    ),
    check(
      "problem_list_status_check",
      sql`${t.status} IS NULL OR ${t.status} IN ('active','resolved','linked')`,
    ),
  ],
);

// NOTE: `patient_allergies` is the canonical allergy object and already lives in
// db/schema/prescribing.ts (declared for the gated 0039 — the table is actually
// created by THIS migration, 0040). The clerkship writes to it (the prescribing
// allergy check reads it). We reuse it rather than redeclare it here.

/** Medications elicited/recorded in the clerking. */
export const encounterMedications = pgTable(
  "encounter_medications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dose: text("dose"),
    route: text("route"),
    frequency: text("frequency"),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("clerking"),
    authoredByUserId: uuid("authored_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("enc_med_status_check", sql`${t.status} IN ('active','stopped','suspended')`),
    index("enc_med_encounter_idx").on(t.encounterId),
  ],
);

/** Investigations ordered in the plan (LOINC where codable). Execution is a
 *  later seam — the record exists now; results display when back. */
export const encounterOrders = pgTable(
  "encounter_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    loincCode: text("loinc_code"),
    text: text("text").notNull(),
    /** Why ordered — justified by the differential (not a blind panel). */
    justification: text("justification"),
    status: text("status").notNull().default("ordered"),
    authoredByUserId: uuid("authored_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // ── EMR orders (migration 0071, GATED) ──
    // 'legacy' rows keep the /lab status UPDATE; 'events' rows are immutable (trigger) and their
    // status is derived from encounter_order_events — the status column above stays 'ordered'.
    lifecycle: text("lifecycle").notNull().default("legacy"),
    hospitalId: uuid("hospital_id").references(() => hospitals.id, { onDelete: "restrict" }),
    // FK to test_catalogue enforced in SQL: emr.ts imports this file.
    testId: uuid("test_id"),
    priority: text("priority"),
    reasonConditionIds: uuid("reason_condition_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    reasonTextCiphertext: text("reason_text_ciphertext"),
    fastingRequired: boolean("fasting_required"),
    /** The requester is authored_by_user_id. */
    requesterCadre: text("requester_cadre"),
    performer: text("performer"),
    intentSource: text("intent_source"),
    /** Triage recommendation code or resus event id. */
    sourceIntentId: text("source_intent_id"),
    requisitionNo: text("requisition_no"),
    sensitivity: text("sensitivity").notNull().default("standard"),
    clientKey: text("client_key"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "enc_order_kind_check",
      sql`${t.kind} IN ('bloods','imaging','bedside','special','other','lab','ecg','procedure','referral')`,
    ),
    check(
      "enc_order_status_check",
      sql`${t.status} IN ('ordered','collected','resulted','cancelled')`,
    ),
    check("enc_order_lifecycle_check", sql`${t.lifecycle} IN ('legacy','events')`),
    check(
      "enc_order_priority_check",
      sql`${t.priority} IS NULL OR ${t.priority} IN ('routine','urgent','immediate')`,
    ),
    check(
      "enc_order_performer_check",
      sql`${t.performer} IS NULL OR ${t.performer} IN ('in_house','external','referral')`,
    ),
    check(
      "enc_order_intent_check",
      sql`${t.intentSource} IS NULL OR ${t.intentSource} IN ('clinician','triage_recommendation','resus_handover')`,
    ),
    check("enc_order_sensitivity_check", sql`${t.sensitivity} IN ('standard','restricted')`),
    check(
      "enc_order_events_shape",
      sql`${t.lifecycle} = 'legacy' OR (
        ${t.hospitalId} IS NOT NULL AND ${t.priority} IS NOT NULL AND ${t.performer} IS NOT NULL AND ${t.intentSource} IS NOT NULL
        AND ${t.requesterCadre} IS NOT NULL AND ${t.effectiveAt} IS NOT NULL
        AND ${t.kind} IN ('lab','imaging','ecg','procedure','referral')
        AND (${t.kind} <> 'lab' OR ${t.testId} IS NOT NULL)
        AND (cardinality(${t.reasonConditionIds}) > 0 OR ${t.reasonTextCiphertext} IS NOT NULL))`,
    ),
    index("enc_order_encounter_idx").on(t.encounterId, t.status),
    uniqueIndex("enc_order_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
    index("enc_order_events_patient")
      .on(t.patientUserId, t.createdAt.desc())
      .where(sql`${t.lifecycle} = 'events'`),
    index("enc_order_events_hospital")
      .on(t.hospitalId, t.createdAt.desc())
      .where(sql`${t.lifecycle} = 'events'`),
  ],
);

export const encounterResults = pgTable(
  "encounter_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => encounterOrders.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    unit: text("unit"),
    abnormalFlag: text("abnormal_flag"),
    loincCode: text("loinc_code"),
    resultedAt: timestamp("resulted_at", { withTimezone: true }).notNull().defaultNow(),
    /* ── Lab-tech workspace (GATED migration 0050; nullable — legacy rows + the
       un-flagged path are unaffected). The manual results-entry + verify/release +
       critical-value workflow. Written only when `labResultsLive()` is on. ── */
    /** Specimen logging. */
    specimenType: text("specimen_type"),
    specimenCollectedAt: timestamp("specimen_collected_at", { withTimezone: true }),
    specimenId: text("specimen_id"),
    /** Reference range shown alongside the value (prose, e.g. "3.5–5.1 mmol/L"). */
    referenceRangeText: text("reference_range_text"),
    /** A crossed critical/panic threshold (drives the alert + priority release). */
    criticalFlag: text("critical_flag"),
    /** entered (not yet released) → released (clinician-visible final) → rejected. */
    qualityStatus: text("quality_status"),
    /** Who ENTERED the result (entered ≠ released). */
    enteredByUserId: uuid("entered_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    /** Release is a deliberate, cadre-gated act — set on release, not on entry. */
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedByUserId: uuid("released_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    /** Why a specimen/result was rejected ("haemolysed — recollect"). */
    rejectionReason: text("rejection_reason"),
  },
  (t) => [
    // One result row per order (GATED 0051): the entered/rejected row is the
    // single editable slot; a released result is frozen. The unique index is the
    // DB backstop for the select-then-upsert in enterLabResultAction — it also
    // serves the order_id lookup, so it replaces the old non-unique index.
    uniqueIndex("enc_result_one_per_order").on(t.orderId),
    check(
      "enc_result_quality_check",
      sql`${t.qualityStatus} IS NULL OR ${t.qualityStatus} IN ('entered','released','rejected')`,
    ),
    check(
      "enc_result_critical_check",
      sql`${t.criticalFlag} IS NULL OR ${t.criticalFlag} IN ('panic_high','panic_low','critical')`,
    ),
  ],
);

/** The append-only encounter timeline (mirrors the resus-timeline model). */
export const encounterEvents = pgTable(
  "encounter_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The id of the row this event refers to (documentation/diagnosis/etc.). */
    refId: uuid("ref_id"),
    label: text("label").notNull(),
    actorUserId: uuid("actor_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "enc_event_kind_check",
      sql`${t.kind} IN ('documentation','diagnosis','problem','order','result','medication','allergy','disposition','note','access')`,
    ),
    index("enc_event_encounter_idx").on(t.encounterId, t.recordedAt),
  ],
);

/** Care plan — goals/plan spanning encounters (kickoff §1.10). Editable (goals
 *  evolve) → audited + updated_at-stamped, not append-only. */
export const carePlan = pgTable(
  "care_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    sourceEncounterId: uuid("source_encounter_id").references(() => encounters.id, {
      onDelete: "set null",
    }),
    goal: text("goal").notNull(),
    detail: text("detail"),
    status: text("status").notNull().default("active"),
    targetDate: date("target_date"),
    authoredByUserId: uuid("authored_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("care_plan_status_check", sql`${t.status} IN ('active','met','cancelled')`),
    index("care_plan_patient_idx").on(t.patientUserId, t.status),
  ],
);

// NOTE: the VITALS-LINK INTERFACE (kickoff §1.9) is the EXISTING
// `clinical_observations` table (db/schema/nurse-workspace.ts; created by
// migration 0031, extended for triage in 0036). It already links to
// encounters + patients, carries observation kinds (bp/hr/temp/rr/spo2/…), and
// has a correction model. The monitoring engine (later) writes there. We REUSE
// it as the interface rather than declaring a duplicate.
