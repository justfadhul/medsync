import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
    /** Migration 0062 / ADR 0091: blind index of the phone (`blindIndex()`); NULL until written or backfilled. */
    phoneHmac: text("phone_hmac"),

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

    /** Migration 0170: the home pin from phone sign-up, with its own consent; all four set or none. */
    homePinLat: numeric("home_pin_lat", { precision: 9, scale: 6 }),
    homePinLng: numeric("home_pin_lng", { precision: 9, scale: 6 }),
    homePinConsentVersion: text("home_pin_consent_version"),
    homePinConsentedAt: timestamp("home_pin_consented_at", { withTimezone: true }),

    nokNameEncrypted: text("nok_name_encrypted"),
    nokRelationship: text("nok_relationship"),
    nokPhoneEncrypted: text("nok_phone_encrypted"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "patient_profiles_home_pin_check",
      sql`(${t.homePinLat} IS NULL AND ${t.homePinLng} IS NULL AND ${t.homePinConsentVersion} IS NULL AND ${t.homePinConsentedAt} IS NULL) OR (${t.homePinLat} BETWEEN -90 AND 90 AND ${t.homePinLng} BETWEEN -180 AND 180 AND ${t.homePinConsentVersion} IS NOT NULL AND ${t.homePinConsentedAt} IS NOT NULL)`,
    ),
    check(
      "patient_profiles_title_check",
      sql`${t.titleCode} IS NULL OR ${t.titleCode} IN ('mr','ms','mrs','dr','other')`,
    ),
    check(
      "patient_profiles_sex_check",
      sql`${t.sex} IN ('male','female','intersex','prefer_not_say')`,
    ),
    check(
      "patient_profiles_id_type_check",
      sql`${t.idType} IN ('nin','passport','refugee_id','other','none')`, // 0070 (D12)
    ),
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

/**
 * The claim code the desk gives a walk-in it registered (migration 0292, ADR 0475): with it and their phone, the
 * person takes the desk's record over at sign-up. One row per desk record; `codeHash` is the code's blind index,
 * never the code. RLS on with no policies: the service role only (the SQL functions in 0292).
 */
export const deskClaimCodes = pgTable(
  "desk_claim_codes",
  {
    patientUserId: uuid("patient_user_id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id),
    codeHash: text("code_hash").notNull(),
    issuedBy: uuid("issued_by").references(() => authUsers.id, { onDelete: "set null" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    /** Open for 5 minutes after the right code: the auth.users guard lets the credential through only then. */
    claimPermitUntil: timestamp("claim_permit_until", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** The person's own acceptance of the notice when they took the record over. */
    claimConsentVersion: text("claim_consent_version"),
    claimConsentSha256: text("claim_consent_sha256"),
  },
  (t) => [index("desk_claim_codes_hash_idx").on(t.codeHash)],
);
