/* ─── clinical_observations ──────────────────────────────────────── */
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitalDepartments } from "./hospital-departments";
import { hospitalWards } from "./hospital-wards";
import { hospitals } from "./hospitals";
import { prescriptions } from "./prescribing";
import { encounters } from "./scheduling";

/**
 * Nurse workspace — migration 0031.
 *
 * Five tables:
 *   - nursing_assignments               patient ↔ nurse pairing per shift
 *   - ward_in_charge_assignments        who is currently in-charge of a ward
 *   - clinical_observations             nurse-recorded vitals/obs
 *   - medication_administration_records administer + document; prescription_id TEXT seam
 *   - shift_handovers                   structured between-shift handover
 *
 * Writes are service-role only (Edge Functions own the workflow);
 * reads are RLS-scoped per the proposal §4–§6.
 */

/* ─── nursing_assignments ────────────────────────────────────────── */
export const nursingAssignments = pgTable(
  "nursing_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    wardId: uuid("ward_id").references(() => hospitalWards.id, {
      onDelete: "cascade",
    }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => hospitalDepartments.id, { onDelete: "cascade" }),
    nurseUserId: uuid("nurse_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    relationshipKind: text("relationship_kind").notNull().default("primary"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    assignedByUserId: uuid("assigned_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("na_kind_check", sql`${t.relationshipKind} IN ('primary','cover')`),
    check("na_time_order", sql`${t.endsAt} IS NULL OR ${t.endsAt} >= ${t.startsAt}`),
    index("nursing_assignments_nurse_active_idx").on(t.nurseUserId, t.startsAt),
    index("nursing_assignments_patient_active_idx").on(t.patientUserId, t.startsAt),
    index("nursing_assignments_ward_active_idx").on(t.wardId, t.startsAt),
  ],
);

export type NursingAssignment = typeof nursingAssignments.$inferSelect;
export type NewNursingAssignment = typeof nursingAssignments.$inferInsert;

/* ─── ward_in_charge_assignments ─────────────────────────────────── */
export const wardInChargeAssignments = pgTable(
  "ward_in_charge_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    wardId: uuid("ward_id")
      .notNull()
      .references(() => hospitalWards.id, { onDelete: "cascade" }),
    nurseUserId: uuid("nurse_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    setByUserId: uuid("set_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    /** 0080: an acting in-charge sits beside the substantive one (STR-3). */
    acting: boolean("acting").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("wic_time_order", sql`${t.endsAt} IS NULL OR ${t.endsAt} >= ${t.startsAt}`),
    uniqueIndex("ward_in_charge_one_open")
      .on(t.wardId, t.acting)
      .where(sql`${t.endsAt} IS NULL`),
    index("ward_in_charge_nurse_idx").on(t.nurseUserId, t.startsAt),
  ],
);

export type WardInChargeAssignment = typeof wardInChargeAssignments.$inferSelect;
export type NewWardInChargeAssignment = typeof wardInChargeAssignments.$inferInsert;

export const clinicalObservations = pgTable(
  "clinical_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id").references(() => encounters.id, {
      onDelete: "set null",
    }),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => authUsers.id),

    observationKind: text("observation_kind").notNull(),
    numericValue1: numeric("numeric_value_1"),
    numericValue2: numeric("numeric_value_2"),
    unit: text("unit"),
    painScale: text("pain_scale"),
    notes: text("notes"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),

    state: text("state").notNull().default("active"),
    correctedByObservationId: uuid("corrected_by_observation_id").references(
      (): AnyPgColumn => clinicalObservations.id,
    ),
    // Set when this observation was captured during a triage event
    // (migration 0036) — distinguishes triage vitals from routine obs.
    triageRecordId: uuid("triage_record_id"),

    // ── CFC fact columns (migration 0071, GATED; E3) ──
    // A CFC row has concept_id set, observation_kind = 'fact' and state = 'fact'; it is insert-only
    // (trigger). Legacy rows leave these null. FKs (clinical_concepts, devices, diagnostic_reports,
    // encounter_orders) are enforced in SQL: emr.ts imports this file.
    conceptId: text("concept_id"),
    logicalId: uuid("logical_id"),
    version: integer("version"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => clinicalObservations.id, {
      onDelete: "restrict",
    }),
    category: text("category"),
    valueType: text("value_type"),
    valueNum: numeric("value_num"),
    valueComparator: text("value_comparator"),
    /** UCUM, as reported. */
    valueUnit: text("value_unit"),
    valueCanonical: numeric("value_canonical"),
    valueCode: text("value_code"),
    valueBool: boolean("value_bool"),
    presence: text("presence"),
    specimen: text("specimen"),
    calibration: text("calibration"),
    fastingState: text("fasting_state"),
    challenge: text("challenge"),
    challengeMinutes: integer("challenge_minutes"),
    method: text("method"),
    certification: text("certification"),
    pointOfCare: boolean("point_of_care"),
    deviceId: uuid("device_id"),
    context: jsonb("context").notNull().default({}),
    source: text("source"),
    trust: smallint("trust"),
    status: text("status"),
    sensitivity: text("sensitivity"),
    /** Clinical time. Knowledge time is created_at; a legacy row's effective time is recorded_at. */
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    authorCadre: text("author_cadre"),
    noteCiphertext: text("note_ciphertext"),
    reportId: uuid("report_id"),
    orderId: uuid("order_id"),
    entryMode: text("entry_mode"),
    clientKey: text("client_key"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 0038 added etco2 + urine_output (this list had drifted); 0071 adds 'fact'.
    check(
      "obs_kind_check",
      sql`${t.observationKind} IN ('bp','hr','temperature','rr','spo2','glucose','pain','weight','height','intake','output','gcs','other','acvpu','etco2','urine_output','fact')`,
    ),
    check("obs_state_check", sql`${t.state} IN ('active','corrected','fact')`),
    check(
      "obs_category_check",
      sql`${t.category} IS NULL OR ${t.category} IN ('laboratory','vital_sign','anthropometric','symptom','sign','exam','history','social','event','derived')`,
    ),
    check(
      "obs_value_type_check",
      sql`${t.valueType} IS NULL OR ${t.valueType} IN ('quantity','coded','ordinal','boolean','presence','as_typed')`,
    ),
    check(
      "obs_comparator_check",
      sql`${t.valueComparator} IS NULL OR ${t.valueComparator} IN ('<','<=','>','>=')`,
    ),
    check(
      "obs_presence_check",
      sql`${t.presence} IS NULL OR ${t.presence} IN ('present','absent','unknown')`,
    ),
    check(
      "obs_fasting_check",
      sql`${t.fastingState} IS NULL OR ${t.fastingState} IN ('fasting','non_fasting','unknown')`,
    ),
    check(
      "obs_source_check",
      sql`${t.source} IS NULL OR ${t.source} IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')`,
    ),
    check("obs_trust_check", sql`${t.trust} IS NULL OR ${t.trust} BETWEEN 1 AND 4`),
    check(
      "obs_status_check",
      sql`${t.status} IS NULL OR ${t.status} IN ('preliminary','final','amended','corrected','entered_in_error','cancelled')`,
    ),
    check(
      "obs_sensitivity_check",
      sql`${t.sensitivity} IS NULL OR ${t.sensitivity} IN ('standard','restricted')`,
    ),
    check(
      "obs_entry_mode_check",
      sql`${t.entryMode} IS NULL OR ${t.entryMode} IN ('direct','transcribed','interface')`,
    ),
    check(
      "obs_fact_tagging",
      sql`(${t.conceptId} IS NOT NULL) = (${t.observationKind} = 'fact') AND (${t.conceptId} IS NOT NULL) = (${t.state} = 'fact')`,
    ),
    check(
      "obs_cfc_shape",
      sql`${t.conceptId} IS NULL OR (
        ${t.logicalId} IS NOT NULL AND ${t.version} IS NOT NULL AND (${t.version} = 1) = (${t.supersedesId} IS NULL)
        AND ${t.category} IS NOT NULL AND ${t.valueType} IS NOT NULL AND ${t.source} IS NOT NULL AND ${t.trust} IS NOT NULL
        AND ${t.status} IS NOT NULL AND ${t.sensitivity} IS NOT NULL AND ${t.effectiveAt} IS NOT NULL
        AND ${t.numericValue1} IS NULL AND ${t.numericValue2} IS NULL AND ${t.unit} IS NULL AND ${t.notes} IS NULL AND ${t.painScale} IS NULL
        AND (${t.reportId} IS NULL OR ${t.entryMode} IS NOT NULL)
        AND (${t.status} <> 'entered_in_error' OR ${t.noteCiphertext} IS NOT NULL))`,
    ),
    check(
      "obs_value_matches_type",
      sql`${t.conceptId} IS NULL
        OR (${t.valueType} = 'quantity' AND ${t.valueNum} IS NOT NULL AND ${t.valueUnit} IS NOT NULL AND ${t.valueCanonical} IS NOT NULL)
        OR (${t.valueType} IN ('coded','ordinal') AND ${t.valueCode} IS NOT NULL)
        OR (${t.valueType} = 'boolean' AND ${t.valueBool} IS NOT NULL)
        OR (${t.valueType} = 'presence' AND ${t.presence} IS NOT NULL)
        OR (${t.valueType} = 'as_typed' AND ${t.conceptId} = 'obs.uncatalogued' AND ${t.noteCiphertext} IS NOT NULL)`,
    ),
    index("clinical_observations_patient_kind_idx").on(
      t.patientUserId,
      t.observationKind,
      t.recordedAt,
    ),
    index("clinical_observations_recorded_by_idx").on(t.recordedByUserId, t.recordedAt),
    index("obs_cfc_patient_concept_time")
      .on(t.patientUserId, t.conceptId, t.effectiveAt.desc())
      .where(sql`${t.conceptId} IS NOT NULL`),
    index("obs_cfc_supersedes")
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} IS NOT NULL`),
    // The SQL index also INCLUDEs (patient_user_id, value_canonical, fasting_state, specimen, trust),
    // which Drizzle cannot express; the migration is the source for it.
    index("obs_cfc_sweep")
      .on(t.conceptId, t.effectiveAt)
      .where(sql`${t.status} IN ('final','amended','corrected')`),
    index("obs_cfc_hospital_time")
      .on(t.hospitalId, t.effectiveAt.desc())
      .where(sql`${t.conceptId} IS NOT NULL`),
    index("obs_cfc_report")
      .on(t.reportId)
      .where(sql`${t.reportId} IS NOT NULL`),
    uniqueIndex("obs_cfc_logical_version")
      .on(t.logicalId, t.version)
      .where(sql`${t.logicalId} IS NOT NULL`),
    uniqueIndex("obs_cfc_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);

export type ClinicalObservation = typeof clinicalObservations.$inferSelect;
export type NewClinicalObservation = typeof clinicalObservations.$inferInsert;

/* ─── medication_administration_records ──────────────────────────── */
export const medicationAdministrationRecords = pgTable(
  "medication_administration_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id").references(() => encounters.id, {
      onDelete: "set null",
    }),
    administeredByUserId: uuid("administered_by_user_id")
      .notNull()
      .references(() => authUsers.id),
    cosignedByUserId: uuid("cosigned_by_user_id").references(() => authUsers.id),

    prescriptionId: text("prescription_id"),
    /** The prescription, as a real foreign key (migration 0088; the text seam above stays). */
    emrPrescriptionId: uuid("emr_prescription_id").references(() => prescriptions.id, {
      onDelete: "restrict",
    }),
    drugName: text("drug_name").notNull(),
    dose: text("dose").notNull(),
    route: text("route").notNull(),
    isHighAlert: boolean("is_high_alert").notNull().default(false),

    state: text("state").notNull(),
    withheldReason: text("withheld_reason"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    administeredAt: timestamp("administered_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    /** 0281 (prescribing kit P2 b): idempotency for a dose recorded on a prescription line. */
    clientKey: text("client_key"),
    /** 0281: the dose this row undoes (state 'reversed', the reason in withheld_reason), at most once. */
    reversesId: uuid("reverses_id").references(
      (): AnyPgColumn => medicationAdministrationRecords.id,
      {
        onDelete: "restrict",
      },
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "mar_state_check",
      sql`${t.state} IN ('administered','withheld','refused','wasted','reversed')`,
    ),
    check("mar_reversal_shape", sql`(${t.state} = 'reversed') = (${t.reversesId} IS NOT NULL)`),
    check(
      "mar_route_check",
      sql`${t.route} IN ('oral','iv','im','sc','topical','inhaled','pr','other')`,
    ),
    check(
      "mar_withheld_reason",
      sql`${t.state} = 'administered' OR ${t.withheldReason} IS NOT NULL`,
    ),
    index("mar_patient_idx").on(t.patientUserId, t.administeredAt),
    index("mar_administered_by_idx").on(t.administeredByUserId, t.administeredAt),
    index("mar_emr_prescription_idx")
      .on(t.emrPrescriptionId, t.scheduledFor)
      .where(sql`${t.emrPrescriptionId} IS NOT NULL`),
    uniqueIndex("mar_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
    uniqueIndex("mar_reverses_once")
      .on(t.reversesId)
      .where(sql`${t.reversesId} IS NOT NULL`),
  ],
);

export type MedicationAdministrationRecord = typeof medicationAdministrationRecords.$inferSelect;
export type NewMedicationAdministrationRecord = typeof medicationAdministrationRecords.$inferInsert;

/* ─── shift_handovers ────────────────────────────────────────────── */
export const shiftHandovers = pgTable(
  "shift_handovers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    wardId: uuid("ward_id")
      .notNull()
      .references(() => hospitalWards.id, { onDelete: "cascade" }),
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => authUsers.id),

    shiftLabel: text("shift_label").notNull(),
    summary: text("summary").notNull(),
    patientsOfConcern: jsonb("patients_of_concern"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("sh_shift_label_check", sql`${t.shiftLabel} IN ('day','evening','night','custom')`),
    index("shift_handovers_ward_recent_idx").on(t.wardId, t.submittedAt),
    index("shift_handovers_hospital_recent_idx").on(t.hospitalId, t.submittedAt),
  ],
);

export type ShiftHandover = typeof shiftHandovers.$inferSelect;
export type NewShiftHandover = typeof shiftHandovers.$inferInsert;

/* ─── nurse_tasks (0281, prescribing kit P2 b) ───────────────────── */
/**
 * Work a prescription (later a protocol chart, P4) gives the nurses. One way: open → done |
 * cancelled, then frozen (trigger); never deleted. RLS: the clinical reader's scoped SELECT only.
 */
export const nurseTasks = pgTable(
  "nurse_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    encounterId: uuid("encounter_id").references(() => encounters.id, { onDelete: "restrict" }),
    /** "iv_cannula", "enter_result", …; P4 adds its own. */
    type: text("type").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: uuid("source_id"),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneByUserId: uuid("done_by_user_id").references(() => authUsers.id, { onDelete: "restrict" }),
    outcome: jsonb("outcome"),
    clientKey: text("client_key"),
  },
  (t) => [
    check("nurse_tasks_type_check", sql`${t.type} ~ '^[a-z][a-z0-9_]{1,40}$'`),
    check(
      "nurse_tasks_source_kind_check",
      sql`${t.sourceKind} IN ('prescription','order','protocol_chart','manual')`,
    ),
    check("nurse_tasks_payload_check", sql`jsonb_typeof(${t.payload}) = 'object'`),
    check("nurse_tasks_status_check", sql`${t.status} IN ('open','done','cancelled')`),
    check(
      "nurse_tasks_closed",
      sql`(${t.status} = 'open') = (${t.doneAt} IS NULL AND ${t.doneByUserId} IS NULL)`,
    ),
    uniqueIndex("nurse_tasks_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
    index("nurse_tasks_open").on(t.hospitalId, t.status, t.dueAt),
    index("nurse_tasks_patient").on(t.patientUserId, t.createdAt),
  ],
);

export type NurseTask = typeof nurseTasks.$inferSelect;
