import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitalDepartments } from "./hospital-departments";
import { hospitals } from "./hospitals";
import { cadreGrades, cadres, councils, roles, specialties } from "./reference-data";

/**
 * Clinician verification anchor (GATE D).
 *
 * 1:1 with auth.users. `registration_number` is plaintext on purpose —
 * the approver looks it up against the council register, so it has to
 * be queryable. Licence document lives in private Storage bucket
 * `clinician-licences`; `licence_document_path` holds the key.
 *
 * `verified_*` columns are service-role only (column-level REVOKE in
 * migration 0013); the clinician can never self-verify.
 */
export const clinicianProfiles = pgTable(
  "clinician_profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    councilId: uuid("council_id")
      .notNull()
      .references(() => councils.id, { onDelete: "restrict" }),
    registrationNumber: text("registration_number").notNull(),
    registrationExpiry: date("registration_expiry"),
    licenceDocumentPath: text("licence_document_path"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("clinician_profiles_reg_unique").on(t.councilId, t.registrationNumber),
    index("clinician_profiles_verified_idx").on(t.verifiedAt),
  ],
);

/**
 * Per-affiliation row (GATE D). Permissions attach HERE, not on the
 * clinician — a clinician can be `active` at hospital A and
 * `pending_approval` at hospital B at the same time. State transitions
 * (`approved_at`/`approved_by`/`rejection_reason`) are service-role
 * only via the GATE F Edge Functions.
 */
export const staffAffiliations = pgTable(
  "staff_affiliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => hospitalDepartments.id, { onDelete: "restrict" }),
    cadreId: uuid("cadre_id")
      .notNull()
      .references(() => cadres.id, { onDelete: "restrict" }),
    cadreGradeId: uuid("cadre_grade_id").references(() => cadreGrades.id, {
      onDelete: "set null",
    }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    specialtyId: uuid("specialty_id").references(() => specialties.id, {
      onDelete: "set null",
    }),
    employmentType: text("employment_type").notNull(),
    state: text("state").notNull().default("pending_approval"),
    rejectionReason: text("rejection_reason"),
    approvedBy: uuid("approved_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "staff_affiliations_employment_type_check",
      sql`${t.employmentType} IN ('full_time','visiting','locum')`,
    ),
    uniqueIndex("staff_affiliations_unique").on(t.userId, t.hospitalId, t.departmentId, t.roleId),
    index("staff_affiliations_user_idx").on(t.userId),
    index("staff_affiliations_hospital_state_idx").on(t.hospitalId, t.state),
  ],
);

export type ClinicianProfile = typeof clinicianProfiles.$inferSelect;
export type NewClinicianProfile = typeof clinicianProfiles.$inferInsert;
export type StaffAffiliation = typeof staffAffiliations.$inferSelect;
export type NewStaffAffiliation = typeof staffAffiliations.$inferInsert;
