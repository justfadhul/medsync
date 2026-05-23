import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// inet is a native pg type — Drizzle exposes it via a custom() but for
// our read-only Drizzle access we map it as text (we don't query by ip
// from the ORM; the column ships from the Edge Function directly).
import { authUsers } from "./_auth";

/**
 * Superadmin god-mode + sensitive-elevation log (GATE F).
 *
 * Append-only by trigger + privilege REVOKE. Reads gated to superadmin
 * by RLS. Writes are service-role only (Edge Functions). Every entry
 * carries a required free-text `reason` ≥ 8 chars so an auditor can
 * see WHY each god-mode action happened, not just THAT it did.
 *
 * `bigint` PK because audit volume is unbounded over years and we
 * don't need stable surrogate sharing semantics that uuid offers.
 *
 * NOT itself audited (recursive audit triggers = noise without
 * forensic value).
 */
export const saAuditLog = pgTable(
  "sa_audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    requestId: uuid("request_id"),
    /** Native `inet` in the DB; surfaced here as text for read-side ergonomics. */
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "sa_audit_log_action_check",
      sql`${t.action} IN (
        'approve_staff_affiliation',
        'reject_staff_affiliation',
        'approve_hospital_application',
        'reject_hospital_application',
        'cross_tenant_read',
        'cross_tenant_export',
        'elevate_admin',
        'create_superadmin',
        'demote_admin'
      )`,
    ),
    check(
      "sa_audit_log_target_kind_check",
      sql`${t.targetKind} IN (
        'staff_affiliation','hospital_application','hospital','user','patient_profile'
      )`,
    ),
    check("sa_audit_log_reason_min_len", sql`length(trim(${t.reason})) >= 8`),
    index("sa_audit_log_timestamp_idx").on(t.timestamp),
    index("sa_audit_log_actor_idx").on(t.actorId),
    index("sa_audit_log_target_idx").on(t.targetKind, t.targetId),
  ],
);

export type SaAuditLogEntry = typeof saAuditLog.$inferSelect;
export type NewSaAuditLogEntry = typeof saAuditLog.$inferInsert;
