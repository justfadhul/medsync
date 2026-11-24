import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";

/**
 * In-app notifications. MVP scope: break-glass-access alerts to the
 * affected hospital's admin. Email / SMS delivery deferred to the
 * PHI phase. NOT audited — operational state only; the underlying
 * triggering event (e.g. a break-glass grant) already lives in
 * `sa_audit_log`.
 *
 * RLS: own (`recipient_user_id = auth.uid()`) + superadmin oversight.
 * UPDATE allows the recipient to mark read/dismissed; every other
 * column has REVOKE UPDATE so a malicious authenticated user cannot
 * rewrite subject/body/recipient.
 */
export const saNotifications = pgTable(
  "sa_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    relatedKind: text("related_kind"),
    relatedId: text("related_id"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "sa_notifications_kind_check",
      sql`${t.kind} IN ('break_glass_access','admin_action_on_tenant','account_security','clinical_triage_alert','clinical_resus_mobilisation','clinical_resus_arrest_call','clinical_resus_idle','care_request','care_request_update','ward_incoming')`,
    ),
    index("sa_notifications_recipient_idx").on(t.recipientUserId, t.readAt, t.deliveredAt),
  ],
);

export type SaNotification = typeof saNotifications.$inferSelect;
export type NewSaNotification = typeof saNotifications.$inferInsert;
