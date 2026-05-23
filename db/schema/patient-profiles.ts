import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitals } from "./hospitals";
import { districts, subcounties } from "./reference-data";

/**
 * 1:1 patient profile (GATE C).
 *
 * DOB plaintext (kickoff Q3 — keeps age-range analytics possible).
 * Every other identifying field is AES-256-GCM ciphertext written
 * by lib/encryption.ts BEFORE insert. `patient_code` is DB-issued
 * via the public.issue_patient_code() function in migration 0011
 * — leave the column off your insert and Postgres fills it in.
 *
 * RLS (migration 0011): SELECT own + superadmin; INSERT/UPDATE own.
 */
export const patientProfiles = pgTable(
  "patient_profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    patientCode: text("patient_code").notNull().unique(),

    titleCode: text("title_code"),
    firstNameEncrypted: text("first_name_encrypted").notNull(),
    surnameEncrypted: text("surname_encrypted").notNull(),

    sex: text("sex").notNull(),
    dateOfBirth: date("date_of_birth").notNull(),

    idType: text("id_type").notNull(),
    idNumberEncrypted: text("id_number_encrypted"),
    phoneEncrypted: text("phone_encrypted").notNull(),

    districtId: uuid("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "restrict" }),
    subcountyId: uuid("subcounty_id").references(() => subcounties.id, {
      onDelete: "restrict",
    }),
    villageAddressEncrypted: text("village_address_encrypted"),
    preferredLanguage: text("preferred_language"),

    primaryFacilityId: uuid("primary_facility_id").references(() => hospitals.id, {
      onDelete: "set null",
    }),

    knownConditions: text("known_conditions").array(),

    nokNameEncrypted: text("nok_name_encrypted"),
    nokRelationship: text("nok_relationship"),
    nokPhoneEncrypted: text("nok_phone_encrypted"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "patient_profiles_title_check",
      sql`${t.titleCode} IS NULL OR ${t.titleCode} IN ('mr','ms','mrs','dr','other')`,
    ),
    check(
      "patient_profiles_sex_check",
      sql`${t.sex} IN ('male','female','intersex','prefer_not_say')`,
    ),
    check("patient_profiles_id_type_check", sql`${t.idType} IN ('nin','passport','none')`),
    check(
      "patient_profiles_id_number_match",
      sql`(${t.idType} = 'none' AND ${t.idNumberEncrypted} IS NULL)
          OR (${t.idType} <> 'none' AND ${t.idNumberEncrypted} IS NOT NULL)`,
    ),
    check(
      "patient_profiles_nok_relationship_check",
      sql`${t.nokRelationship} IS NULL OR ${t.nokRelationship} IN (
        'spouse','parent','child','sibling','guardian','friend','other'
      )`,
    ),
    index("patient_profiles_district_idx").on(t.districtId),
    index("patient_profiles_primary_facility_idx").on(t.primaryFacilityId),
  ],
);

export type PatientProfile = typeof patientProfiles.$inferSelect;
export type NewPatientProfile = typeof patientProfiles.$inferInsert;
