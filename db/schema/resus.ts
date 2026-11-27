import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitalDepartments } from "./hospital-departments";
import { hospitalWards } from "./hospital-wards";
import { hospitals } from "./hospitals";
import { patientIntakes } from "./patient-intakes";
import { saNotifications } from "./sa-notifications";
import { encounters } from "./scheduling";
import { hospitalBeds } from "./services-hub";
import { triageRecords } from "./triage";

/**
 * ABCDE Resuscitation surface — migration 0038.
 *
 *   - resus_episodes            one per resus activation (the header)
 *   - resus_timeline_events     the append-only, immutable medico-legal log
 *   - resus_role_assignments    who holds which team role over time
 *   - resus_mobilisation_alerts the team-call + the "who's responding" view
 *
 * Decision-support, not autonomous: these tables RECORD what the team
 * does; the clinician leads. The timeline is hard append-only (REVOKE
 * UPDATE/DELETE + a block trigger) — corrections are NEW events that
 * supersede an earlier one via supersedes_event_id; nothing is silently
 * edited or deleted. lib/resus/timeline.ts is the pure reconstruction.
 *
 * Clinical basis: docs/resus-abcde-gate-a-proposal.md (CSO-signed
 * 2026-06-02). v2 (migration 0068, docs/resus-v2-gate-a-proposal.md §8) adds
 * the episode phase and close-out columns, arrest-scoped + idempotent timeline
 * rows, and the care-unit / bay-profile / settings / arrest-record / debrief /
 * after-death tables at the end of this file.
 */

/* ─── resus_episodes (the header; PHI-linked) ───────────────────────── */
export const resusEpisodes = pgTable(
  "resus_episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => hospitalDepartments.id, {
      onDelete: "set null",
    }),
    triageRecordId: uuid("triage_record_id").references(() => triageRecords.id, {
      onDelete: "set null",
    }),
    intakeId: uuid("intake_id").references(() => patientIntakes.id, { onDelete: "set null" }),
    patientUserId: uuid("patient_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    encounterId: uuid("encounter_id").references(() => encounters.id, { onDelete: "set null" }),

    triggerKind: text("trigger_kind").notNull(),
    triggerReason: text("trigger_reason"),

    state: text("state").notNull().default("active"),
    disposition: text("disposition"),
    outcome: text("outcome"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    arrestDetectedAt: timestamp("arrest_detected_at", { withTimezone: true }),

    openedByUserId: uuid("opened_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    // v2 (0068)
    phase: text("phase").notNull().default("survey"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    currentArrestSeq: integer("current_arrest_seq").notNull().default(0),
    outcomeCode: text("outcome_code"),
    closureKind: text("closure_kind"),
    closedBy: uuid("closed_by").references(() => authUsers.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    dispositionDecidedAt: timestamp("disposition_decided_at", { withTimezone: true }),
    suggestedLevel: text("suggested_level"),
    chosenLevel: text("chosen_level"),
    levelMismatchCode: text("level_mismatch_code"),
    deathConfirmedAt: timestamp("death_confirmed_at", { withTimezone: true }),
    pendingEncounterHandoff: boolean("pending_encounter_handoff").notNull().default(false),
    idleNotifiedAt: timestamp("idle_notified_at", { withTimezone: true }),
    bayProfileId: uuid("bay_profile_id").references((): AnyPgColumn => resusBayProfiles.id, {
      onDelete: "set null",
    }),
    destinationUnitId: uuid("destination_unit_id").references(
      (): AnyPgColumn => hospitalCareUnits.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    check("re_phase_check", sql`${t.phase} IN ('survey','arrest','post_rosc','boarding')`),
    check("re_arrest_seq_check", sql`${t.currentArrestSeq} >= 0`),
    check(
      "re_outcome_code_check",
      sql`${t.outcomeCode} IS NULL OR ${t.outcomeCode} IN ('stabilised','rosc_sustained','rosc_not_sustained','died_after_cpr','died_cpr_not_attempted','transferred_out')`,
    ),
    check("re_outcome_code_state_check", sql`${t.outcomeCode} IS NULL OR ${t.state} = 'concluded'`),
    check(
      "re_closure_kind_check",
      sql`${t.closureKind} IS NULL OR (${t.closureKind} IN ('bedside','administrative') AND ${t.state} = 'concluded')`,
    ),
    check(
      "re_level_check",
      sql`(${t.suggestedLevel} IS NULL OR ${t.suggestedLevel} IN ('ward','l1','l2','l3')) AND (${t.chosenLevel} IS NULL OR ${t.chosenLevel} IN ('ward','l1','l2','l3'))`,
    ),
    check(
      "re_level_mismatch_check",
      sql`${t.levelMismatchCode} IS NULL OR ${t.levelMismatchCode} IN ('no_bed','ceiling_of_care','family_declined','transfer_arranged','clinical_judgement')`,
    ),
    index("resus_episodes_board_idx").on(t.hospitalId, t.state, t.lastActivityAt),
    check(
      "re_trigger_kind_check",
      sql`${t.triggerKind} IN ('triage_red','step0_life_threat','in_resus_deterioration')`,
    ),
    check("re_state_check", sql`${t.state} IN ('active','concluded','cancelled')`),
    check(
      "re_disposition_check",
      sql`${t.disposition} IS NULL OR ${t.disposition} IN ('theatre','icu','cath_lab','ward','mortuary','transferred','deceased','hdu','labour_ward','discharged')`,
    ),
    index("resus_episodes_hospital_idx").on(t.hospitalId, t.startedAt),
    index("resus_episodes_patient_idx").on(t.patientUserId, t.startedAt),
    index("resus_episodes_triage_idx").on(t.triageRecordId),
  ],
);

export type ResusEpisode = typeof resusEpisodes.$inferSelect;
export type NewResusEpisode = typeof resusEpisodes.$inferInsert;

/* ─── resus_timeline_events (immutable, append-only) ────────────────── */
export const resusTimelineEvents = pgTable(
  "resus_timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => resusEpisodes.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    step: text("step"),
    recordedByUserId: uuid("recorded_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    /** Clinical time (bedside). */
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    /** System time (row written). */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
    /** PHI narrative, AES-256-GCM (lib/encryption). Nullable. */
    narrativeEncrypted: text("narrative_encrypted"),
    /** Non-null when this event corrects (supersedes) an earlier one. */
    supersedesEventId: uuid("supersedes_event_id").references(
      (): AnyPgColumn => resusTimelineEvents.id,
      { onDelete: "set null" },
    ),
    // v2 (0068)
    arrestSeq: integer("arrest_seq"),
    /** The client's idempotency key — unique per episode. */
    clientEventId: uuid("client_event_id"),
    lateEntry: boolean("late_entry").notNull().default(false),
  },
  (t) => [
    check(
      "rte_kind_check",
      sql`${t.kind} IN ('assessment','action','drug','fluid','procedure','vital','decision','role_change','mobilisation','reassessment','arrest_detected','cpr_started','handover','note','context','rhythm_check','shock','rosc','resuscitation_stopped','death_confirmed')`,
    ),
    check(
      "rte_step_check",
      sql`${t.step} IS NULL OR ${t.step} IN ('pre','A','B','C','D','E','arrest','post')`,
    ),
    check("rte_arrest_seq_check", sql`${t.arrestSeq} IS NULL OR ${t.arrestSeq} >= 1`),
    uniqueIndex("resus_timeline_client_event_uidx")
      .on(t.episodeId, t.clientEventId)
      .where(sql`client_event_id IS NOT NULL`),
    index("resus_timeline_episode_recorded_idx").on(t.episodeId, t.recordedAt),
    index("resus_timeline_episode_created_idx").on(t.episodeId, t.createdAt),
  ],
);

export type ResusTimelineEventRow = typeof resusTimelineEvents.$inferSelect;
export type NewResusTimelineEvent = typeof resusTimelineEvents.$inferInsert;

/* ─── resus_role_assignments (who holds which role over time) ───────── */
export const resusRoleAssignments = pgTable(
  "resus_role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => resusEpisodes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    assignedByUserId: uuid("assigned_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "rra_role_check",
      sql`${t.role} IN ('leader','airway','circulation','scribe','runner','cpr_provider','family_liaison')`,
    ),
    index("resus_role_episode_open_idx")
      .on(t.episodeId, t.role)
      .where(sql`ended_at IS NULL`),
  ],
);

export type ResusRoleAssignmentRow = typeof resusRoleAssignments.$inferSelect;
export type NewResusRoleAssignment = typeof resusRoleAssignments.$inferInsert;

/* ─── resus_mobilisation_alerts (team-call + responding view) ───────── */
export const resusMobilisationAlerts = pgTable(
  "resus_mobilisation_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => resusEpisodes.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("in_app"),
    saNotificationId: uuid("sa_notification_id").references(() => saNotifications.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    responding: boolean("responding").notNull().default(false),
  },
  (t) => [
    check("rma_channel_check", sql`${t.channel} IN ('in_app','sms','push')`),
    index("resus_mobilisation_episode_idx").on(t.episodeId),
    index("resus_mobilisation_recipient_idx").on(t.recipientUserId, t.sentAt),
  ],
);

export type ResusMobilisationAlertRow = typeof resusMobilisationAlerts.$inferSelect;
export type NewResusMobilisationAlert = typeof resusMobilisationAlerts.$inferInsert;

/* ─── v2 (migration 0068) ───────────────────────────────────────────── */

/** What each unit can deliver — the level-of-care capability mapping. */
export const hospitalCareUnits = pgTable(
  "hospital_care_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    unitType: text("unit_type").notNull(),
    ageGroup: text("age_group").notNull().default("adult"),
    continuousEcg: boolean("continuous_ecg").notNull().default(false),
    arterialLine: boolean("arterial_line").notNull().default(false),
    vasopressors: boolean("vasopressors").notNull().default(false),
    nivCpap: boolean("niv_cpap").notNull().default(false),
    invasiveVentilation: boolean("invasive_ventilation").notNull().default(false),
    rrt: boolean("rrt").notNull().default(false),
    active: boolean("active").notNull().default(true),
    /** 0313 (D7): the ward this unit is drawn as; set null if the ward goes. */
    wardId: uuid("ward_id").references(() => hospitalWards.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "hcu_unit_type_check",
      sql`${t.unitType} IN ('ward','hdu','icu','theatre','cath_lab','labour_ward','paeds_ward','picu','nicu','ed_obs')`,
    ),
    check("hcu_age_group_check", sql`${t.ageGroup} IN ('adult','paediatric','all')`),
    uniqueIndex("hcu_name_unique").on(t.hospitalId, t.name),
  ],
);
export type HospitalCareUnitRow = typeof hospitalCareUnits.$inferSelect;

/** The defibrillator registered to a bay (energy sequence entered by biomedical engineering). */
export const resusBayProfiles = pgTable(
  "resus_bay_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    bayLabel: text("bay_label").notNull(),
    deviceModel: text("device_model"),
    waveform: text("waveform").notNull().default("unknown"),
    energySequenceJ: integer("energy_sequence_j").array(),
    capnography: boolean("capnography").notNull().default(false),
    ultrasound: boolean("ultrasound").notNull().default(false),
    mechanicalCpr: boolean("mechanical_cpr").notNull().default(false),
    ecpr: boolean("ecpr").notNull().default(false),
    verifiedBy: uuid("verified_by").references(() => authUsers.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** 0313 (D7): the resus space of an emergency unit this bay is; one bay per space. */
    bedId: uuid("bed_id").references(() => hospitalBeds.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "rbp_waveform_check",
      sql`${t.waveform} IN ('monophasic','biphasic_truncated_exponential','rectilinear_biphasic','pulsed_biphasic','unknown')`,
    ),
    check(
      "rbp_energy_positive",
      sql`${t.energySequenceJ} IS NULL OR (cardinality(${t.energySequenceJ}) BETWEEN 1 AND 10 AND 0 < ALL (${t.energySequenceJ}) AND 400 >= ALL (${t.energySequenceJ}))`,
    ),
    uniqueIndex("rbp_bay_unique").on(t.hospitalId, t.bayLabel),
    uniqueIndex("rbp_bed_unique")
      .on(t.bedId)
      .where(sql`${t.bedId} IS NOT NULL`),
  ],
);
export type ResusBayProfileRow = typeof resusBayProfiles.$inferSelect;

/** Per-hospital resus settings — no clinical constants live here. */
export const hospitalResusSettings = pgTable(
  "hospital_resus_settings",
  {
    hospitalId: uuid("hospital_id")
      .primaryKey()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    antiarrhythmic: text("antiarrhythmic").notNull().default("amiodarone"),
    rhythmCheckTone: boolean("rhythm_check_tone").notNull().default(true),
    metronome: boolean("metronome").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => authUsers.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("hrs_antiarrhythmic_check", sql`${t.antiarrhythmic} IN ('amiodarone','lidocaine')`),
  ],
);
export type HospitalResusSettingsRow = typeof hospitalResusSettings.$inferSelect;

/** Immutable Utstein snapshot per arrest (corrections insert a superseding row). */
export const resusArrestRecords = pgTable(
  "resus_arrest_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => resusEpisodes.id, { onDelete: "cascade" }),
    arrestSeq: integer("arrest_seq").notNull(),
    record: jsonb("record").notNull(),
    supersedesRecordId: uuid("supersedes_record_id").references(
      (): AnyPgColumn => resusArrestRecords.id,
      { onDelete: "set null" },
    ),
    createdBy: uuid("created_by").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("rar_seq_check", sql`${t.arrestSeq} >= 1`),
    index("resus_arrest_records_episode_idx").on(t.episodeId, t.arrestSeq, t.createdAt),
  ],
);
export type ResusArrestRecordRow = typeof resusArrestRecords.$inferSelect;

/** The post-event debrief — immutable once submitted. */
export const resusDebriefs = pgTable(
  "resus_debriefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => resusEpisodes.id, { onDelete: "cascade" }),
    facilitatorUserId: uuid("facilitator_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    attendeeCount: integer("attendee_count"),
    wentWell: text("went_well"),
    toImprove: text("to_improve"),
    actions: text("actions"),
    equipmentIssues: text("equipment_issues"),
    welfareCheckDone: boolean("welfare_check_done").notNull().default(false),
    metrics: jsonb("metrics").notNull().default({}),
    status: text("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("rdb_status_check", sql`${t.status} IN ('draft','submitted')`),
    check("rdb_attendees_check", sql`${t.attendeeCount} IS NULL OR ${t.attendeeCount} >= 0`),
    uniqueIndex("rdb_episode_unique").on(t.episodeId),
  ],
);
export type ResusDebriefRow = typeof resusDebriefs.$inferSelect;

/** After-death checklist history (append-only; latest row per task wins). */
export const resusAfterDeathTasks = pgTable(
  "resus_after_death_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => resusEpisodes.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    state: text("state").notNull(),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => authUsers.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("radt_state_check", sql`${t.state} IN ('done','not_applicable','pending')`),
    check("radt_task_check", sql`${t.taskId} ~ '^CO-ADT-[0-9]{2}$'`),
    index("resus_after_death_tasks_episode_idx").on(t.episodeId, t.taskId, t.recordedAt),
  ],
);
export type ResusAfterDeathTaskRow = typeof resusAfterDeathTasks.$inferSelect;
