import type { BookingSymptom } from "../../supabase/functions/_shared/symptoms";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { clinicSessions } from "./clinic-sessions";
import { hospitalDepartments } from "./hospital-departments";
import { hospitals } from "./hospitals";
import { provisionalPatients } from "./provisional-patients";

/**
 * Scheduling, Appointments & Booking — migration 0028.
 *
 * See docs/scheduling-gate-a-proposal.md for the design rationale.
 *
 * Tables (in dependency order):
 *   - availability_blocks            (clinician declared time)
 *   - clinician_scheduling_settings  (per-clinician + per-hospital config)
 *   - department_scheduling_policy   (per-department defaults / overrides)
 *   - appointments                   (the core booking object)
 *   - encounters                     (minimal seam to clinical module)
 *   - queue_entries                  (same-day arrival queue)
 *   - appointment_reminders          (queued reminders; dispatcher elsewhere)
 *
 * `appointments.triggered_by_alert_id` is intentionally TEXT, not a FK
 * to alerts(id) — the monitoring module hasn't shipped. The day it
 * does, a follow-up migration upgrades the column to a real FK.
 */

/* ─── availability_blocks ─────────────────────────────────────────── */
export const availabilityBlocks = pgTable(
  "availability_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    clinicianUserId: uuid("clinician_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => hospitalDepartments.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    recurrence: text("recurrence").notNull().default("none"),
    recurrenceWeekday: smallint("recurrence_weekday"),
    recurrenceUntil: timestamp("recurrence_until", { withTimezone: true }),
    location: text("location"),
    notes: text("notes"),
    /**
     * Migration 0065 / ADR 0095: the clinician's own name for a `custom`
     * block (≤ 40 chars). Required when kind = custom; ignored otherwise.
     */
    label: text("label"),
    state: text("state").notNull().default("active"),
    createdByUserId: uuid("created_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Migration 0065 / ADR 0095 added 'custom' — inert to the slot engine,
    // like teaching, ward_round and admin.
    check(
      "availability_blocks_kind_check",
      sql`${t.kind} IN ('bookable','teaching','ward_round','admin','leave','unavailable','custom')`,
    ),
    check(
      "availability_blocks_label_length",
      sql`${t.label} IS NULL OR char_length(${t.label}) BETWEEN 1 AND 40`,
    ),
    check(
      "availability_blocks_custom_has_label",
      sql`${t.kind} <> 'custom' OR ${t.label} IS NOT NULL`,
    ),
    check("availability_blocks_recurrence_check", sql`${t.recurrence} IN ('none','weekly')`),
    check("availability_blocks_state_check", sql`${t.state} IN ('active','cancelled')`),
    check("availability_blocks_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    index("availability_blocks_clinician_idx").on(t.clinicianUserId, t.startsAt),
    index("availability_blocks_hospital_idx").on(t.hospitalId, t.startsAt),
  ],
);

/* ─── clinician_scheduling_settings ───────────────────────────────── */
export const clinicianSchedulingSettings = pgTable(
  "clinician_scheduling_settings",
  {
    clinicianUserId: uuid("clinician_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    autoConfirm: boolean("auto_confirm").notNull().default(false),
    defaultSlotMinutes: integer("default_slot_minutes").notNull().default(15),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    allowVirtual: boolean("allow_virtual").notNull().default(false),
    allowOutOfHoursOverride: boolean("allow_out_of_hours_override").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clinicianUserId, t.hospitalId] }),
    check("clinician_scheduling_slot_range", sql`${t.defaultSlotMinutes} BETWEEN 5 AND 240`),
    check("clinician_scheduling_buffer_range", sql`${t.bufferMinutes} BETWEEN 0 AND 60`),
  ],
);

/* ─── department_scheduling_policy ────────────────────────────────── */
export const departmentSchedulingPolicy = pgTable(
  "department_scheduling_policy",
  {
    departmentId: uuid("department_id")
      .primaryKey()
      .references(() => hospitalDepartments.id, { onDelete: "cascade" }),
    defaultSlotMinutes: integer("default_slot_minutes").notNull().default(15),
    defaultBufferMinutes: integer("default_buffer_minutes").notNull().default(0),
    defaultAutoConfirm: boolean("default_auto_confirm").notNull().default(false),
    // smallint[] / integer[] — typed as unknown until we wire generated
    // Database types. Stored as Postgres array literals; the Edge
    // Functions handle parsing.
    bookableWeekdays: smallint("bookable_weekdays").array().notNull().default([1, 2, 3, 4, 5]),
    bookableStartMinutesLocal: integer("bookable_start_minutes_local").notNull().default(480),
    bookableEndMinutesLocal: integer("bookable_end_minutes_local").notNull().default(1020),
    // ONE 24h reminder, not two (migration 0052). The array's LENGTH is the
    // number of messages a booking queues, so this default is a per-booking
    // spend multiplier for every department that never opens the editor.
    reminderLeadMinutes: integer("reminder_lead_minutes").array().notNull().default([1440]),
    /**
     * Migration 0061 / ADR 0090: "release at T-minus-X" (PRD §3.2.3). NULL =
     * OFF, the default — no punitive automation unless the facility asks.
     */
    releaseUnconfirmedHours: smallint("release_unconfirmed_hours"),
    allowVirtual: boolean("allow_virtual").notNull().default(false),
    notes: text("notes"),
    updatedByUserId: uuid("updated_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "dept_policy_release_unconfirmed_range",
      sql`${t.releaseUnconfirmedHours} IS NULL OR ${t.releaseUnconfirmedHours} BETWEEN 1 AND 20`,
    ),
    check("dept_policy_slot_range", sql`${t.defaultSlotMinutes} BETWEEN 5 AND 240`),
    check("dept_policy_buffer_range", sql`${t.defaultBufferMinutes} BETWEEN 0 AND 60`),
    check(
      "dept_policy_window_order",
      sql`${t.bookableEndMinutesLocal} > ${t.bookableStartMinutesLocal}`,
    ),
    // Shipped in 0028 but never mirrored here, so `db:check` reported drift
    // and a regenerated migration would have proposed dropping it.
    check(
      "dept_policy_window_range",
      sql`${t.bookableStartMinutesLocal} BETWEEN 0 AND 1440 AND ${t.bookableEndMinutesLocal} BETWEEN 0 AND 1440`,
    ),
    // Migration 0052. ISO weekdays, 1 = Monday … 7 = Sunday — the same
    // convention as availability_blocks.recurrence_weekday, the slot engine
    // and both walk-in readers. `<@` is element-wise containment, so an empty
    // array passes: "closed every day" is a value an operator may want.
    check(
      "dept_policy_weekday_range",
      sql`${t.bookableWeekdays} <@ ARRAY[1,2,3,4,5,6,7]::smallint[]`,
    ),
    // Migration 0052. The per-booking message ceiling, at the layer no writer
    // can bypass. array_length of an empty array is NULL, so "no reminders"
    // still passes.
    check(
      "dept_policy_reminder_count",
      sql`array_length(${t.reminderLeadMinutes}, 1) IS NULL OR array_length(${t.reminderLeadMinutes}, 1) <= 2`,
    ),
  ],
);

/* ─── appointments ────────────────────────────────────────────────── */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => hospitalDepartments.id, { onDelete: "restrict" }),
    /** NULL only for a booking made for a provisional patient (migration 0060); set by ha-reconcile-identity alone. */
    patientUserId: uuid("patient_user_id").references(() => authUsers.id, { onDelete: "cascade" }),
    /** Migration 0060 / ADR 0089: the PROVENANCE of a booking made without an account; stays set after reconciliation. */
    provisionalPatientId: uuid("provisional_patient_id").references(() => provisionalPatients.id, {
      onDelete: "restrict",
    }),
    clinicianUserId: uuid("clinician_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    reasonNote: text("reason_note"),
    origin: text("origin").notNull(),
    status: text("status").notNull().default("requested"),
    priority: text("priority").notNull().default("routine"),
    type: text("type").notNull().default("in_person"),
    locationRoom: text("location_room"),
    cancelledReason: text("cancelled_reason"),
    cancelledByUserId: uuid("cancelled_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    declinedReason: text("declined_reason"),
    rescheduledFromAppointmentId: uuid("rescheduled_from_appointment_id").references(
      (): AnyPgColumn => appointments.id,
      { onDelete: "set null" },
    ),
    /** Intent: FK to alerts(id) when monitoring lands. Text for now. */
    triggeredByAlertId: text("triggered_by_alert_id"),
    createdByUserId: uuid("created_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    notifyLeadMinutes: integer("notify_lead_minutes").array(),

    // ── Migration 0058 / ADR 0087 (proposal §5.5, §5.6) ──────────────
    /** Client-generated once per wizard submission; a retry returns the same row. */
    idempotencyKey: text("idempotency_key"),
    /** 'web' | 'app' | 'ussd' | 'desk' | 'system' */
    channel: text("channel").notNull().default("web"),
    /** Session mode: the clinic_sessions row this booking holds a position in. */
    sessionId: uuid("session_id").references(() => clinicSessions.id, { onDelete: "restrict" }),
    /** Allocated from clinic_sessions.next_position at confirmation; never renumbered. */
    positionNumber: smallint("position_number"),
    /** Derived once at confirmation and stored so the SMS the patient holds never changes. */
    arrivalWindowStart: timestamp("arrival_window_start", { withTimezone: true }),
    arrivalWindowEnd: timestamp("arrival_window_end", { withTimezone: true }),
    /**
     * Migration 0063 / ADR 0092: the fee the patient was told, snapshotted at
     * booking by `_shared/book.ts` alone — the same rule the arrival window
     * follows, so a facility editing its price never moves a held booking.
     * NULL = no fee was quoted; that is not the same fact as zero.
     */
    quotedFeeUgx: integer("quoted_fee_ugx"),
    /** The cadre's registered name, or the line's. Stored, never joined back to. */
    quotedFeeLabel: text("quoted_fee_label"),
    quotedFeeAt: timestamp("quoted_fee_at", { withTimezone: true }),
    /**
     * Migration 0065 / ADR 0095: what the patient said is bothering them, as
     * they said it — a list of {code, label, duration}, or NULL when they
     * said nothing. Descriptive only: never ranked, routed or scored, and
     * never read by triage, clerkship or encounter code (the clinical
     * firewall test holds that line). Shape owned by `_shared/symptoms.ts`.
     */
    symptoms: jsonb("symptoms").$type<BookingSymptom[]>(),
    /**
     * Migration 0066 / ADR 0098: the advisory tier the catalog computed for
     * this booking (E/U/R) and the submission it came from. On the
     * appointment, not the element, so no list can be coloured by it.
     */
    symptomTier: text("symptom_tier"),
    /** FK in migration 0066 (→ symptom_submissions); not declared here — `db/schema/emergency.ts` imports this file, and a lazy back-reference would close an import cycle. */
    symptomSubmissionId: uuid("symptom_submission_id"),
    /** 6 chars, unambiguous alphabet, printed on the receipt (§3.6). */
    bookingCode: text("booking_code"),
    /** Migration 0061 / ADR 0090: the patient's answer to the T-24h confirmation request. */
    confirmedByPatientAt: timestamp("confirmed_by_patient_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("appointments_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    // Migration 0058 (ruling C5): Appendix A's 13 codes plus the shipped
    // 'urgent_review' (system-only, see below) and 'other'.
    check(
      "appointments_reason_check",
      sql`${t.reason} IN ('follow_up','post_discharge','new_concern','refill','test_results','antenatal','immunisation','child_wellness','specialist_review','routine','procedure','counselling','second_opinion','urgent_review','other')`,
    ),
    check("appointments_channel_check", sql`${t.channel} IN ('web','app','ussd','desk','system')`),
    check(
      "appointments_symptom_tier_check",
      sql`${t.symptomTier} IS NULL OR ${t.symptomTier} IN ('E','U','R')`,
    ),
    // Migration 0065: the container is a list; the element shape is every writer's job.
    check(
      "appointments_symptoms_is_list",
      sql`${t.symptoms} IS NULL OR jsonb_typeof(${t.symptoms}) = 'array'`,
    ),
    check(
      "appointments_session_position_pair",
      sql`(${t.sessionId} IS NULL) = (${t.positionNumber} IS NULL)`,
    ),
    unique("appointments_hospital_booking_code_unique").on(t.hospitalId, t.bookingCode),
    check(
      "appointments_origin_check",
      sql`${t.origin} IN ('patient','clinician','nurse','reception','system_urgent','walk_in','ussd')`,
    ),
    // Migration 0053 / ADR 0084 §12. 'urgent_review' stays a legal reason —
    // system-propose-urgent-appointment writes it with origin='system_urgent'
    // and it is correct there. What leaves is the patient's ability to pick
    // it: a self-rated "urgent" (kappa 0.166 / 0.07) must not sit one column
    // from a system escalation under a near-identical name. `origin` is the
    // discriminator because it is not patient-supplied — pt-request-appointment
    // hard-codes it. The SQL applies this NOT VALID (existing rows keep their
    // value, per the ADR); Drizzle has no way to say so.
    check(
      "appointments_patient_reason_check",
      sql`${t.origin} <> 'patient' OR ${t.reason} <> 'urgent_review'`,
    ),
    // Migration 0060: 'void' (FHIR entered-in-error) joins the list. No
    // writer at this gate; absent from LIVE_APPOINTMENT_STATUSES by construction.
    check(
      "appointments_status_check",
      sql`${t.status} IN ('requested','pending_approval','confirmed','arrived','in_progress','completed','cancelled','no_show','rescheduled','declined','void')`,
    ),
    check(
      "appointments_patient_or_provisional",
      sql`${t.patientUserId} IS NOT NULL OR ${t.provisionalPatientId} IS NOT NULL`,
    ),
    check("appointments_priority_check", sql`${t.priority} IN ('routine','urgent')`),
    // A closed code, never staff words — the patient reads this column (0064, ADR 0094).
    check(
      "appointments_cancelled_reason_code",
      sql`${t.cancelledReason} IS NULL OR ${t.cancelledReason} IN ('session_cancelled','patient_cancelled','staff_cancelled','unconfirmed_release','rescheduled')`,
    ),
    check("appointments_type_check", sql`${t.type} IN ('in_person','virtual')`),
    index("appointments_patient_idx").on(t.patientUserId, t.startsAt),
    index("appointments_clinician_idx").on(t.clinicianUserId, t.startsAt),
    index("appointments_hospital_status_idx").on(t.hospitalId, t.status, t.startsAt),
    // Partial unique index — only enforced for live SLOT bookings. Migration
    // 0058 re-scoped it with `session_id IS NULL`: every position in a
    // session shares the session's starts_at, and the allocator's counter is
    // that mode's guard instead.
    uniqueIndex("appointments_no_double_booking")
      .on(t.clinicianUserId, t.startsAt)
      .where(
        sql`${t.sessionId} IS NULL AND ${t.status} IN ('requested','pending_approval','confirmed','arrived','in_progress')`,
      ),
    uniqueIndex("appointments_idempotency_unique")
      .on(t.patientUserId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    uniqueIndex("appointments_session_position_unique")
      .on(t.sessionId, t.positionNumber)
      .where(sql`${t.sessionId} IS NOT NULL`),
    index("appointments_session_idx")
      .on(t.sessionId)
      .where(sql`${t.sessionId} IS NOT NULL`),
    // Migration 0060: replay safety keyed by the CREATOR, which the
    // (patient_user_id, key) index cannot see for a provisional booking.
    uniqueIndex("appointments_creator_idempotency_unique")
      .on(t.createdByUserId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL AND ${t.createdByUserId} IS NOT NULL`),
    index("appointments_provisional_idx")
      .on(t.provisionalPatientId)
      .where(sql`${t.provisionalPatientId} IS NOT NULL`),
  ],
);

/* ─── encounters ──────────────────────────────────────────────────── */
export const encounters = pgTable(
  "encounters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    clinicianUserId: uuid("clinician_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id").references(() => hospitalDepartments.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    state: text("state").notNull().default("in_progress"),
    // Free-text "why the encounter ended" — discharged / referred-out
    // / left-without-being-seen / admitted / completed-routine. Added
    // in migration 0033 alongside ha-complete-encounter.
    completionReason: text("completion_reason"),
    // ── Encounter / EMR engine (migration 0040, GATED) ──
    // The clinical disposition the clerking produces (the admission slice
    // consumes this). FK enforced in SQL (avoids a triage↔scheduling import cycle).
    disposition: text("disposition"),
    triageRecordId: uuid("triage_record_id"),
    /** Clinical setting (kickoff §1.1): opd / inpatient / emergency / follow_up / tele. */
    encounterType: text("encounter_type").notNull().default("opd"),
    // ── EMR record spine (migration 0071, GATED) ──
    // The visit (patient_intakes). FK enforced in SQL: patient-intakes.ts imports this file.
    visitId: uuid("visit_id"),
    templateId: text("template_id"),
    /** Stamped by note autosave and every fact write, so active clerking never looks idle. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    /** completed_at is the existing ended_at. */
    completedBy: uuid("completed_by").references(() => authUsers.id, { onDelete: "set null" }),
    dispositionDetail: jsonb("disposition_detail"),
    followUp: jsonb("follow_up"),
    attendanceType: text("attendance_type").notNull().default("unknown"),
    referralIn: jsonb("referral_in"),
    /** null on a completed row = legacy completed (flagged, never altered). */
    closureKind: text("closure_kind"),
    closureReason: text("closure_reason"),
    closureNoteCiphertext: text("closure_note_ciphertext"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "encounters_state_check",
      sql`${t.state} IN ('planned','in_progress','completed','cancelled','entered_in_error')`,
    ),
    check(
      "encounters_type_check",
      sql`${t.encounterType} IN ('opd','inpatient','emergency','follow_up','tele','antenatal','procedure','virtual','community')`,
    ),
    // Died is stored as the existing 'deceased' (ADR 0115 reads it).
    check(
      "encounters_disposition_check",
      sql`${t.disposition} IS NULL OR ${t.disposition} IN ('admit','discharge','refer','observe','transfer','deceased','home','admitted','referred_out','transferred','left_before_completion','left_against_advice')`,
    ),
    check(
      "encounters_attendance_type_check",
      sql`${t.attendanceType} IN ('new','re_attendance','unknown')`,
    ),
    check(
      "encounters_closure_kind_check",
      sql`${t.closureKind} IS NULL OR ${t.closureKind} IN ('clinical','administrative')`,
    ),
    check(
      "encounters_closure_reason_check",
      sql`${t.closureReason} IS NULL OR ${t.closureReason} IN ('left_before_seen','duplicate_encounter','documented_elsewhere','opened_in_error','other')`,
    ),
    check(
      "encounters_closure_shape",
      sql`(${t.closureKind} IS DISTINCT FROM 'clinical' OR ${t.disposition} IS NOT NULL)
        AND (${t.closureKind} IS DISTINCT FROM 'administrative' OR ${t.closureReason} IS NOT NULL)
        AND (${t.state} <> 'entered_in_error' OR ${t.closureReason} IS NOT NULL)
        AND (${t.closureReason} IS DISTINCT FROM 'other' OR ${t.closureNoteCiphertext} IS NOT NULL)`,
    ),
    check("encounters_time_order", sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
    index("encounters_patient_idx").on(t.patientUserId, t.startedAt),
    index("encounters_clinician_idx").on(t.clinicianUserId, t.startedAt),
    index("encounters_hospital_idx").on(t.hospitalId, t.startedAt),
    index("encounters_visit_idx")
      .on(t.visitId)
      .where(sql`${t.visitId} IS NOT NULL`),
    index("encounters_open_activity_idx")
      .on(t.hospitalId, t.lastActivityAt)
      .where(sql`${t.state} IN ('planned','in_progress')`),
  ],
);

/* ─── queue_entries ───────────────────────────────────────────────── */
export const queueEntries = pgTable(
  "queue_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => hospitalDepartments.id, { onDelete: "restrict" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("waiting"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull().defaultNow(),
    calledAt: timestamp("called_at", { withTimezone: true }),
    calledByUserId: uuid("called_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
    encounterId: uuid("encounter_id").references(() => encounters.id, {
      onDelete: "set null",
    }),
    sequenceNumber: integer("sequence_number").notNull(),
    // Triage re-rank key (migration 0036). Nullable: untriaged entries
    // keep their FIFO sequence_number; once triaged, priority_order = the
    // assigned acuity (lower = seen sooner), sequence_number is the tiebreak.
    priorityOrder: integer("priority_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "queue_entries_kind_check",
      sql`${t.kind} IN ('scheduled_arrival','walk_in','urgent_walk_in')`,
    ),
    check("queue_entries_state_check", sql`${t.state} IN ('waiting','being_seen','left','done')`),
    index("queue_entries_dept_state_idx").on(t.hospitalId, t.departmentId, t.state, t.arrivedAt),
    index("queue_entries_patient_idx").on(t.patientUserId, t.arrivedAt),
  ],
);

/* ─── appointment_reminders ───────────────────────────────────────── */
export const appointmentReminders = pgTable(
  "appointment_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    /** Migration 0059 (ADR 0088): 'reminder' | 'receipt'. A receipt is scheduled for now() and never goes stale. */
    kind: text("kind").notNull().default("reminder"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("reminders_channel_check", sql`${t.channel} IN ('push','sms','email','in_app')`),
    check("reminders_state_check", sql`${t.state} IN ('queued','sent','failed','cancelled')`),
    check("reminders_kind_check", sql`${t.kind} IN ('reminder','receipt')`),
    index("appointment_reminders_dispatcher_idx")
      .on(t.state, t.scheduledAt)
      .where(sql`${t.state} = 'queued'`),
  ],
);

/* ─── Inferred types ─────────────────────────────────────────────── */
export type AvailabilityBlock = typeof availabilityBlocks.$inferSelect;
export type NewAvailabilityBlock = typeof availabilityBlocks.$inferInsert;
export type ClinicianSchedulingSettings = typeof clinicianSchedulingSettings.$inferSelect;
export type NewClinicianSchedulingSettings = typeof clinicianSchedulingSettings.$inferInsert;
export type DepartmentSchedulingPolicy = typeof departmentSchedulingPolicy.$inferSelect;
export type NewDepartmentSchedulingPolicy = typeof departmentSchedulingPolicy.$inferInsert;
export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
export type Encounter = typeof encounters.$inferSelect;
export type NewEncounter = typeof encounters.$inferInsert;
export type QueueEntry = typeof queueEntries.$inferSelect;
export type NewQueueEntry = typeof queueEntries.$inferInsert;
export type AppointmentReminder = typeof appointmentReminders.$inferSelect;
export type NewAppointmentReminder = typeof appointmentReminders.$inferInsert;

/* ─── Enums-as-string-constants (for client + form validation) ───── */

export const APPOINTMENT_REASONS = [
  "follow_up",
  "new_concern",
  "refill",
  "routine",
  "urgent_review",
  "other",
] as const;
export type AppointmentReason = (typeof APPOINTMENT_REASONS)[number];

export const APPOINTMENT_ORIGINS = [
  "patient",
  "clinician",
  "nurse",
  "reception",
  "system_urgent",
  "walk_in",
] as const;
export type AppointmentOrigin = (typeof APPOINTMENT_ORIGINS)[number];

export const APPOINTMENT_STATUSES = [
  "requested",
  "pending_approval",
  "confirmed",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
  "declined",
  /** Migration 0060 / ADR 0089 — FHIR entered-in-error. No writer yet. */
  "void",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_PRIORITIES = ["routine", "urgent"] as const;
export type AppointmentPriority = (typeof APPOINTMENT_PRIORITIES)[number];

export const APPOINTMENT_TYPES = ["in_person", "virtual"] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const AVAILABILITY_KINDS = [
  "bookable",
  "teaching",
  "ward_round",
  "admin",
  "leave",
  "unavailable",
  // Migration 0065 / ADR 0095: the clinician's own, labelled; inert to the slot engine.
  "custom",
] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

export const QUEUE_KINDS = ["scheduled_arrival", "walk_in", "urgent_walk_in"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export const QUEUE_STATES = ["waiting", "being_seen", "left", "done"] as const;
export type QueueState = (typeof QUEUE_STATES)[number];
