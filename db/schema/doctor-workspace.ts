import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { staffAffiliations } from "./clinician-profiles";
import { hospitalDepartments } from "./hospital-departments";
import { hospitals } from "./hospitals";

/**
 * Doctor workspace — migration 0030.
 *
 * Four tables (the cadre-enforcement + audit scaffold):
 *   - clinical_supervision        intern → consultant pairings
 *   - clinical_cosign_policies    per-hospital/department policy matrix
 *   - clinical_cosign_requests    workflow object for flagged actions
 *   - clinical_phi_access_log     append-only "who viewed which patient"
 *
 * Writes are service-role only (Edge Functions own the workflow);
 * reads are RLS-scoped per the proposal §3–§5.
 */

/* ─── clinical_supervision ───────────────────────────────────────── */
export const clinicalSupervision = pgTable(
  "clinical_supervision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    superviseeAffiliationId: uuid("supervisee_affiliation_id")
      .notNull()
      .references(() => staffAffiliations.id, { onDelete: "cascade" }),
    supervisorAffiliationId: uuid("supervisor_affiliation_id")
      .notNull()
      .references(() => staffAffiliations.id, { onDelete: "cascade" }),
    relationshipKind: text("relationship_kind").notNull().default("primary"),
    startsOn: date("starts_on").notNull().defaultNow(),
    endsOn: date("ends_on"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("supervision_kind_check", sql`${t.relationshipKind} IN ('primary','backup')`),
    check(
      "supervision_self_pair_check",
      sql`${t.superviseeAffiliationId} <> ${t.supervisorAffiliationId}`,
    ),
    check("supervision_date_order", sql`${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
    index("clinical_supervision_supervisee_idx").on(t.superviseeAffiliationId, t.startsOn),
    index("clinical_supervision_supervisor_idx").on(t.supervisorAffiliationId, t.startsOn),
  ],
);

export type ClinicalSupervision = typeof clinicalSupervision.$inferSelect;
export type NewClinicalSupervision = typeof clinicalSupervision.$inferInsert;

/* ─── clinical_cosign_policies ───────────────────────────────────── */
export const clinicalCosignPolicies = pgTable(
  "clinical_cosign_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => hospitalDepartments.id, {
      onDelete: "cascade",
    }),
    cadreCode: text("cadre_code").notNull(),
    actionKind: text("action_kind").notNull(),
    requirement: text("requirement").notNull(),
    notes: text("notes"),
    setByUserId: uuid("set_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "cosign_policy_requirement_check",
      sql`${t.requirement} IN ('allowed','cosign_required','blocked')`,
    ),
    check(
      "cosign_policy_action_check",
      // 0036 widened the policy kinds; mirror it so db:generate never narrows them.
      sql`${t.actionKind} IN ('prescription_routine','prescription_controlled','order_high_cost_imaging','admit_patient','discharge_patient','high_alert_med_administration','independent_complex_procedure','triage_patient','triage_downgrade')`,
    ),
    index("cosign_policy_lookup_idx").on(t.hospitalId, t.cadreCode, t.actionKind),
  ],
);

export type ClinicalCosignPolicy = typeof clinicalCosignPolicies.$inferSelect;
export type NewClinicalCosignPolicy = typeof clinicalCosignPolicies.$inferInsert;

/* ─── clinical_cosign_requests ───────────────────────────────────── */
export const clinicalCosignRequests = pgTable(
  "clinical_cosign_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    requestedByAffiliationId: uuid("requested_by_affiliation_id")
      .notNull()
      .references(() => staffAffiliations.id, { onDelete: "restrict" }),
    requestedByCadreCode: text("requested_by_cadre_code").notNull(),
    actionKind: text("action_kind").notNull(),
    actionPayload: jsonb("action_payload").notNull(),
    state: text("state").notNull().default("pending_review"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Note co-sign (migration 0071): set exactly when action_kind = 'sign_note'. FK to
    // clinical_notes enforced in SQL: emr.ts imports this file.
    noteId: uuid("note_id"),
  },
  (t) => [
    check(
      "cosign_state_check",
      sql`${t.state} IN ('pending_review','approved','returned','cancelled','expired')`,
    ),
    // 0036's kinds (this list had drifted at 0030's five) + 0071's sign_note.
    check(
      "cosign_action_kind_check",
      sql`${t.actionKind} IN ('prescription_routine','prescription_controlled','order_high_cost_imaging','admit_patient','discharge_patient','high_alert_med_administration','independent_complex_procedure','triage_patient','triage_downgrade','sign_note')`,
    ),
    check("cosign_note_link", sql`(${t.actionKind} = 'sign_note') = (${t.noteId} IS NOT NULL)`),
    index("cosign_requester_idx").on(t.requestedByUserId, t.createdAt),
    index("cosign_patient_idx").on(t.patientUserId, t.createdAt),
    index("cosign_note_idx")
      .on(t.noteId)
      .where(sql`${t.noteId} IS NOT NULL`),
  ],
);

export type ClinicalCosignRequest = typeof clinicalCosignRequests.$inferSelect;
export type NewClinicalCosignRequest = typeof clinicalCosignRequests.$inferInsert;

/* ─── clinical_phi_access_log ────────────────────────────────────── */
export const clinicalPhiAccessLog = pgTable(
  "clinical_phi_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    clinicianUserId: uuid("clinician_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessBasis: text("access_basis").notNull(),
    requestId: uuid("request_id"),
    surface: text("surface"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "phi_access_basis_check",
      sql`${t.accessBasis} IN ('care_team','active_encounter','department_recent','break_glass','assigned','open_intake')`,
    ),
    index("phi_access_patient_idx").on(t.patientUserId, t.createdAt),
    index("phi_access_clinician_idx").on(t.clinicianUserId, t.createdAt),
    index("phi_access_hospital_idx").on(t.hospitalId, t.createdAt),
  ],
);

export type ClinicalPhiAccessLog = typeof clinicalPhiAccessLog.$inferSelect;
export type NewClinicalPhiAccessLog = typeof clinicalPhiAccessLog.$inferInsert;
