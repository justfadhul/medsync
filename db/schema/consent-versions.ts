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

/**
 * Versioned consent text (kickoff GATE A, Q5 answer).
 *
 * Phase 0's `consent_records` captures who agreed to what + when,
 * with a SHA-256 of the exact text they saw. This adds a queryable
 * record of the text itself so regulators asking "show me the exact
 * text the patient agreed to on date X" becomes a single join, not
 * a git-history walk.
 *
 * Append-only by convention: don't edit a shipped version, supersede
 * it by inserting a new row with `supersedes_id` set to the prior.
 *
 * The `body_sha256` MUST match `consent_records.consent_text_sha256`
 * at write time — the action that writes a consent record looks up
 * the active row here, validates the hash, then writes.
 */
export const consentVersions = pgTable(
  "consent_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consentType: text("consent_type").notNull(),
    version: text("version").notNull(),
    effectiveDate: date("effective_date").notNull(),
    /** Optional pointer to the prior version this one replaces. */
    supersedesId: uuid("supersedes_id"),
    body: text("body").notNull(),
    bodySha256: text("body_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "consent_versions_type_check",
      sql`${t.consentType} IN ('data_processing', 'sms_communication', 'research_use', 'third_party_share')`,
    ),
    uniqueIndex("consent_versions_unique").on(t.consentType, t.version),
    index("consent_versions_type_effective_idx").on(t.consentType, t.effectiveDate),
  ],
);

export type ConsentVersion = typeof consentVersions.$inferSelect;
export type NewConsentVersion = typeof consentVersions.$inferInsert;
