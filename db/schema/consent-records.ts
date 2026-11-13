import { sql } from "drizzle-orm";
import {
  check,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";

/**
 * Versioned, immutable consent log. Once a (user, consent_type, version) tuple
 * is recorded it must never change — proven via RLS (no UPDATE/DELETE policy)
 * and the audit trigger.
 *
 * `consent_text_sha256` is the SHA-256 of the exact legal text the user saw,
 * so we can prove later what they signed even if `docs/legal/` is edited.
 *
 * Required by the Uganda Data Protection and Privacy Act 2019.
 */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    consentType: text("consent_type").notNull(),
    version: text("version").notNull(),
    consentTextSha256: text("consent_text_sha256").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedIp: inet("accepted_ip"),
    acceptedUserAgent: text("accepted_user_agent"),
    /** Migration 0061 / ADR 0090: withdrawn at; NULL = in force. The record itself never changes. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Migration 0291 / ADR 0475: the staff member who recorded an agreement given at the desk; NULL = self. */
    recordedByUserId: uuid("recorded_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check(
      "consent_records_type_check",
      sql`${t.consentType} IN ('data_processing', 'sms_communication', 'research_use', 'third_party_share', 'results_in_app', 'results_sms')`,
    ),
    index("consent_records_user_type_idx").on(t.userId, t.consentType),
    uniqueIndex("consent_records_unique_version").on(t.userId, t.consentType, t.version),
    index("consent_records_live_sms_idx")
      .on(t.userId)
      .where(sql`${t.consentType} = 'sms_communication' AND ${t.revokedAt} IS NULL`),
  ],
);

export type ConsentRecord = typeof consentRecords.$inferSelect;
export type NewConsentRecord = typeof consentRecords.$inferInsert;

export const CONSENT_TYPES = [
  "data_processing",
  "sms_communication",
  "research_use",
  "third_party_share",
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];
