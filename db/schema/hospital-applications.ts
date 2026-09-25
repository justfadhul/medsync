import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitalDpaVersions } from "./hospital-dpa-versions";
import { hospitals } from "./hospitals";
import { districts, regions, subcounties } from "./reference-data";

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
    // 0070: the short v2 leads ask only a name + district (+ a contact).
    facilityLevel: text("facility_level"),
    ownership: text("ownership"),
    districtId: uuid("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "restrict" }),
    contactName: text("contact_name"),
    contactRole: text("contact_role"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
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
 * Full pilot application — extended in the hospital-registration-
 * upgrade (migrations 0021 + 0022) with institution profile, clinical
 * profile, verification, authority, and agreement metadata.
 *
 * State CHECK now accepts both the legacy `pending_approval` and the
 * upgrade-spec `applied` (same state, kept as alias). Forward states
 * are `under_review → verified → agreement_signed → provisioning →
 * active` plus the side states from `lib/lifecycle.ts`.
 *
 * Multi-value selections live in two junction tables:
 *   - hospital_application_departments (ref-data-anchored)
 *   - hospital_application_specialties (FK to specialties)
 */
export const hospitalApplications = pgTable(
  "hospital_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),

    // Original Phase 0 columns ────────────────────────────────────
    hospitalName: text("hospital_name").notNull(),
    facilityLevel: text("facility_level").notNull(),
    ownership: text("ownership").notNull(),
    registrationNumber: text("registration_number"), // 0070: government facilities have none
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

    // Hospital-registration-upgrade additions (migrations 0021, 0022)

    // §B Institution profile
    hospitalAka: text("hospital_aka"),
    yearEstablished: integer("year_established"),
    mainPhone: text("main_phone").notNull().default(""),
    officialEmail: text("official_email").notNull().default(""),
    website: text("website"),
    regionId: uuid("region_id").references(() => regions.id, { onDelete: "restrict" }),

    // §C–§E5 Clinical & operating profile
    specialisedClinics: text("specialised_clinics")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    specialisedClinicsOther: text("specialised_clinics_other")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    diagnosticServices: text("diagnostic_services")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    supportServices: text("support_services")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    servicesOffered: text("services_offered")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    hasOnsitePharmacy: boolean("has_onsite_pharmacy"),
    bedCapacityBand: text("bed_capacity_band"),
    clinicalStaffBand: text("clinical_staff_band"),
    dailyOpdBand: text("daily_opd_band"),
    internetConnectivity: text("internet_connectivity"),
    powerBackup: text("power_backup"),
    existingEmr: text("existing_emr"),
    existingEmrName: text("existing_emr_name"),

    // §E6 Verification & authority
    licensingBody: text("licensing_body"),
    facilityLicencePath: text("facility_licence_path"),
    applicantFullName: text("applicant_full_name"),
    applicantWorkEmail: text("applicant_work_email"),
    applicantPhone: text("applicant_phone"),
    applicantCouncilNumber: text("applicant_council_number"),
    authorityOfficerName: text("authority_officer_name"),
    authorityOfficerTitle: text("authority_officer_title"),
    authorityLetterPath: text("authority_letter_path"),
    callbackContactValue: text("callback_contact_value"),
    callbackContactKind: text("callback_contact_kind"),
    emailDomainMismatch: boolean("email_domain_mismatch").notNull().default(false),

    // §E7 Agreement metadata (acceptance row lives in hospital_agreements)
    signatoryName: text("signatory_name"),
    signatoryTitle: text("signatory_title"),
    authorisedToBind: boolean("authorised_to_bind").notNull().default(false),
    agreementAcceptedVersion: uuid("agreement_accepted_version").references(
      () => hospitalDpaVersions.id,
      { onDelete: "restrict" },
    ),
    agreementAcceptedAt: timestamp("agreement_accepted_at", { withTimezone: true }),

    // Onboarding v2 (0070) ─────────────────────────────────────────
    registryCode: text("registry_code"),
    facilitySource: text("facility_source").notNull().default("manual"),
    registryCorrectionNote: text("registry_correction_note"),
    duplicateFacility: boolean("duplicate_facility").notNull().default(false),
    publicEmailDomain: boolean("public_email_domain").notNull().default(false),
    pnfpBureau: text("pnfp_bureau"),
    /** App-encrypted (lib/encryption). */
    authorityOfficerPhone: text("authority_officer_phone"),
    authorityOfficerEmail: text("authority_officer_email"),
    /** DOC-2: the letter, plus the licence unless government. */
    documentsComplete: boolean("documents_complete").generatedAlwaysAs(
      sql`authority_letter_path IS NOT NULL AND (ownership = 'public_moh' OR facility_licence_path IS NOT NULL)`,
    ),
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
