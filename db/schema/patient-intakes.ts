import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitalDepartments } from "./hospital-departments";
import { hospitalWards } from "./hospital-wards";
import { hospitals } from "./hospitals";
import { provisionalPatients } from "./provisional-patients";
import { appointments } from "./scheduling";

/**
 * Patient entry points — migration 0032.
 *
 * Two tables. patient_intakes is the unified intake / encounter-precursor
 * record that the next-build triage will consume.
 */

/* ─── entry_types (reference) ───────────────────────────────────── */
export const entryTypes = pgTable(
  "entry_types",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    isEmergency: boolean("is_emergency").notNull().default(false),
    defaultPriorityHint: text("default_priority_hint").notNull().default("routine"),
    requiresAppointmentLink: boolean("requires_appointment_link").notNull().default(false),
    requiresReferral: boolean("requires_referral").notNull().default(false),
    allowsUnknownPatient: boolean("allows_unknown_patient").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "entry_types_priority_check",
      sql`${t.defaultPriorityHint} IN ('routine','high','urgent')`,
    ),
  ],
);

export type EntryType = typeof entryTypes.$inferSelect;

/* ─── patient_intakes ───────────────────────────────────────────── */
export const patientIntakes = pgTable(
  "patient_intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),

    entryTypeCode: text("entry_type_code")
      .notNull()
      .references(() => entryTypes.code),
    entryPoint: text("entry_point"),
    receivingDepartmentId: uuid("receiving_department_id").references(
      () => hospitalDepartments.id,
      { onDelete: "set null" },
    ),
    receivingWardId: uuid("receiving_ward_id").references(() => hospitalWards.id, {
      onDelete: "set null",
    }),

    patientUserId: uuid("patient_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    patientUnknownLabel: text("patient_unknown_label"),
    /** Migration 0060: a booked arrival for a provisional patient names the provisional instead. */
    provisionalPatientId: uuid("provisional_patient_id").references(() => provisionalPatients.id, {
      onDelete: "restrict",
    }),

    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    // Encounter back-link (migration 0033). NULL until triage hands
    // off to an encounter; set by ha-complete-encounter so visit
    // history can traverse intake → encounter.
    encounterId: uuid("encounter_id"),

    referringHospitalId: uuid("referring_hospital_id").references(() => hospitals.id, {
      onDelete: "set null",
    }),
    referringFacilityOther: text("referring_facility_other"),
    referringClinicianName: text("referring_clinician_name"),
    referralReason: text("referral_reason"),
    referralDocumentUrl: text("referral_document_url"),
    referralDate: date("referral_date"),

    presentingComplaint: text("presenting_complaint"),
    broughtBy: text("brought_by"),
    priorityHint: text("priority_hint").notNull().default("routine"),
    status: text("status").notNull().default("awaiting_triage"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull().defaultNow(),

    // Set at declared→arrived transition (migration 0035). NULL on
    // staff-created arrived rows — they were physically here at row
    // creation, so arrived_at already carries that timestamp.
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),

    // True when the patient created this intake themselves via the
    // book-or-queue choice point (migration 0035). False on
    // staff-registered intakes. Drives the "Declared · not here yet"
    // chip on staff boards.
    declaredByPatient: boolean("declared_by_patient").notNull().default(false),

    // Where the desk sent this arrival at check-in (migration 0067, ADR 0101):
    // 'triage' or 'clinic'. NULL is every row before 0067 and means triage.
    // Clinic-routed arrivals stay off the triage worklist.
    routedTo: text("routed_to"),

    // Denormalized triage outcome (migration 0036) — the cheap acuity
    // sort key the worklist/board need. The full record lives in
    // triage_records; these mirror its assigned level + time.
    triageLevel: smallint("triage_level"),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),

    registeredByUserId: uuid("registered_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    /** Migration 0066 / ADR 0098: the pre-alert this arrival came from, and what was reported. */
    /** FK in migration 0066 (→ emergency_pre_arrivals); see symptomSubmissionId. */
    preArrivalId: uuid("pre_arrival_id"),
    /** FK in migration 0066 (→ symptom_submissions); not declared here — `db/schema/emergency.ts` imports this file, and a lazy back-reference would close an import cycle. */
    symptomSubmissionId: uuid("symptom_submission_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("intakes_priority_check", sql`${t.priorityHint} IN ('routine','high','urgent')`),
    check(
      "intakes_status_check",
      sql`${t.status} IN ('declared','arrived','awaiting_triage','triaged','completed','cancelled')`,
    ),
    check(
      "intakes_patient_or_unknown",
      sql`${t.patientUserId} IS NOT NULL OR ${t.provisionalPatientId} IS NOT NULL OR ${t.patientUnknownLabel} IS NOT NULL`,
    ),
    check(
      "intakes_routed_to_check",
      sql`${t.routedTo} IS NULL OR ${t.routedTo} IN ('triage','clinic')`,
    ),
    check(
      "intakes_triage_level_check",
      sql`${t.triageLevel} IS NULL OR ${t.triageLevel} BETWEEN 1 AND 5`,
    ),
    index("patient_intakes_hospital_status_idx").on(t.hospitalId, t.status, t.arrivedAt),
    index("patient_intakes_patient_idx").on(t.patientUserId, t.arrivedAt),
    index("patient_intakes_provisional_idx")
      .on(t.provisionalPatientId)
      .where(sql`${t.provisionalPatientId} IS NOT NULL`),
    index("patient_intakes_dept_idx").on(t.receivingDepartmentId, t.status, t.arrivedAt),
    index("patient_intakes_type_idx").on(t.entryTypeCode, t.arrivedAt),
  ],
);

export type PatientIntake = typeof patientIntakes.$inferSelect;
export type NewPatientIntake = typeof patientIntakes.$inferInsert;

/**
 * Sort rank for `priority_hint`. ORDER BY this ASCENDING — urgent (0) first.
 *
 * `priority_hint` is TEXT constrained to ('routine','high','urgent'), so the
 * obvious `desc(priorityHint)` sorts ALPHABETICALLY and yields
 * urgent → routine → high: reception's escalation flag lands BELOW every
 * routine patient on the nurse's un-triaged worklist. Both worklists shipped
 * that inversion (`lib/triage/worklist.ts`, `lib/intake/queries.ts`) while
 * their comments claimed "priority desc" — the intent was documented and the
 * collation quietly did the opposite.
 *
 * Every surface that orders by clinical priority must use this, never a bare
 * desc() on the column.
 *
 * ponytail: a CASE rather than a numeric column or a pg enum, because the
 * ordering is a read concern and a migration would have to rewrite live
 * intake rows. Ceiling: a fourth priority value means editing this expression.
 * Upgrade path: `priority_rank smallint` written alongside the hint.
 */
export const priorityHintRank = sql`CASE ${patientIntakes.priorityHint} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`;
