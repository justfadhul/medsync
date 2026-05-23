import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitals } from "./hospitals";
import { districts, subcounties } from "./reference-data";

/**
 * Anon landing-page captures (GATE E). Lighter than a full
 * application — no account required, no document upload, just
 * contact intent. Superadmin triages and decides whether to invite
 * the lead to apply. Rate-limited at the action via Turnstile.
 */
export const hospitalLeads = pgTable(
  "hospital_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalName: text("hospital_name").notNull(),
    facilityLevel: text("facility_level").notNull(),
    ownership: text("ownership").notNull(),
    districtId: uuid("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "restrict" }),
    contactName: text("contact_name").notNull(),
    contactRole: text("contact_role").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone").notNull(),
    notes: text("notes"),
    source: text("source"),
    state: text("state").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "hospital_leads_ownership_check",
      sql`${t.ownership} IN ('public_moh','private','pnfp','private_clinic')`,
    ),
    check(
      "hospital_leads_state_check",
      sql`${t.state} IN ('new','contacted','invited','archived')`,
    ),
    index("hospital_leads_state_created_idx").on(t.state, t.createdAt),
    index("hospital_leads_contact_email_idx").on(t.contactEmail),
  ],
);

/**
 * Full pilot application (GATE E). One per applicant (UNIQUE on
 * applicant_user_id). On superadmin approval (GATE F), a row lands
 * in public.hospitals and the applicant's user_roles is elevated to
 * hospital_admin scoped to the new hospital.
 */
export const hospitalApplications = pgTable(
  "hospital_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    hospitalName: text("hospital_name").notNull(),
    facilityLevel: text("facility_level").notNull(),
    ownership: text("ownership").notNull(),
    registrationNumber: text("registration_number").notNull(),
    registrationAuthority: text("registration_authority"),
    districtId: uuid("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "restrict" }),
    subcountyId: uuid("subcounty_id").references(() => subcounties.id, {
      onDelete: "restrict",
    }),
    physicalAddress: text("physical_address").notNull(),
    institutionalEmailDomain: text("institutional_email_domain").notNull(),
    applicantRole: text("applicant_role").notNull(),
    authorisationDocumentPath: text("authorisation_document_path"),
    state: text("state").notNull().default("pending_approval"),
    rejectionReason: text("rejection_reason"),
    reviewedBy: uuid("reviewed_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedHospitalId: uuid("approved_hospital_id").references(() => hospitals.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "hospital_applications_ownership_check",
      sql`${t.ownership} IN ('public_moh','private','pnfp','private_clinic')`,
    ),
    index("hospital_applications_state_created_idx").on(t.state, t.createdAt),
    index("hospital_applications_district_idx").on(t.districtId),
  ],
);

export type HospitalLead = typeof hospitalLeads.$inferSelect;
export type NewHospitalLead = typeof hospitalLeads.$inferInsert;
export type HospitalApplication = typeof hospitalApplications.$inferSelect;
export type NewHospitalApplication = typeof hospitalApplications.$inferInsert;
