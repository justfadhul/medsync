import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { clinicSessions } from "./clinic-sessions";
import { hospitals } from "./hospitals";
import { provisionalPatients } from "./provisional-patients";
import { appointments } from "./scheduling";
import { serviceLines } from "./service-lines";

/**
 * Notifications + waitlist — migration 0061 (GATED), ADR 0090, proposal
 * §5.7 / §5.11.
 *
 *   notification_dispatches  the ONE outbound queue. Writers insert a row
 *                            (via `dispatchRows()` in `_shared/dispatches.ts`);
 *                            the 15-minute cron plans and sends. No body stored.
 *   push_tokens              Expo push tokens, own-row RLS.
 *   waitlist_entries         FIFO release-and-refill; an offer is a
 *                            notification, never a hold (C12).
 */

export const DISPATCH_KINDS = [
  "booking_receipt",
  "confirmation_request",
  "reminder",
  "arrival_window",
  "waitlist_offer",
  "session_cancelled",
  "window_shifted",
  "position_called",
  "payment",
  "deterioration_flag",
  /** Beyond §5.11: PRD §3.2.3's release at T-minus-X must never be silent. */
  "unconfirmed_release",
  /** ADR 0473 (0290): staff cancelled one booking; the patient is told. */
  "visit_cancelled",
  /** Gate F (0062): the one reply to an inbound SMS keyword; payload = a reply key. */
  "sms_reply",
] as const;
export type DispatchKind = (typeof DISPATCH_KINDS)[number];

export const DISPATCH_STATES = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "cancelled",
  "held",
] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];

/* ─── notification_dispatches ─────────────────────────────────────── */
export const notificationDispatches = pgTable(
  "notification_dispatches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Cost attribution per facility (PRD §1.5). NULL (0062) = a platform reply with no facility. */
    hospitalId: uuid("hospital_id").references(() => hospitals.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    recipientUserId: uuid("recipient_user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    /** A provisional patient's phone ciphertext (copied at write time). */
    recipientPhoneEncrypted: text("recipient_phone_encrypted"),
    language: text("language").notNull().default("en"),
    /** 'push' | 'sms' | 'in_app' */
    channel: text("channel").notNull(),
    /** 'sms' on a push row: the dispatcher inserts the SMS if no ack by `fallbackAfter`. */
    fallbackChannel: text("fallback_channel"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    fallbackAfter: timestamp("fallback_after", { withTimezone: true }),
    state: text("state").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** The phone reported receipt/open through pt-ack-notification. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    /** AT messageId (DLR join key) or Expo ticket id(s). */
    providerMessageId: text("provider_message_id"),
    costAmount: numeric("cost_amount", { precision: 10, scale: 4 }),
    costCurrency: text("cost_currency"),
    /** `${kind}:${related_kind}:${related_id}:${suffix}` — a retried writer ON CONFLICT DO NOTHING. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** 'appointment' | 'waitlist_entry' | 'clinic_session' | 'intake' | 'inbound_sms' | 'patient' */
    relatedKind: text("related_kind").notNull(),
    relatedId: uuid("related_id").notNull(),
    /** Ids only — never a name, never a phone. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "notification_dispatches_kind_check",
      sql`${t.kind} IN ('booking_receipt','confirmation_request','reminder','arrival_window','waitlist_offer','session_cancelled','window_shifted','position_called','payment','deterioration_flag','unconfirmed_release','sms_reply','results_ready','visit_cancelled')`,
    ),
    check(
      "notification_dispatches_recipient_check",
      sql`${t.recipientUserId} IS NOT NULL OR ${t.recipientPhoneEncrypted} IS NOT NULL`,
    ),
    check("notification_dispatches_channel_check", sql`${t.channel} IN ('push','sms','in_app')`),
    check(
      "notification_dispatches_fallback_channel_check",
      sql`${t.fallbackChannel} IS NULL OR ${t.fallbackChannel} IN ('sms')`,
    ),
    check(
      "notification_dispatches_state_check",
      sql`${t.state} IN ('queued','sent','delivered','failed','cancelled','held')`,
    ),
    check(
      "notification_dispatches_related_kind_check",
      sql`${t.relatedKind} IN ('appointment','waitlist_entry','clinic_session','intake','inbound_sms','patient')`,
    ),
    unique("notification_dispatches_idempotency_unique").on(t.idempotencyKey),
    index("notification_dispatches_dispatcher_idx")
      .on(t.state, t.scheduledAt)
      .where(sql`${t.state} IN ('queued','held')`),
    index("notification_dispatches_provider_idx")
      .on(t.providerMessageId)
      .where(sql`${t.providerMessageId} IS NOT NULL`),
    index("notification_dispatches_fallback_idx")
      .on(t.fallbackAfter)
      .where(
        sql`${t.channel} = 'push' AND ${t.fallbackChannel} IS NOT NULL AND ${t.acknowledgedAt} IS NULL`,
      ),
    index("notification_dispatches_hospital_created_idx").on(t.hospitalId, t.createdAt),
    index("notification_dispatches_related_idx").on(t.relatedKind, t.relatedId),
  ],
);

/* ─── push_tokens ─────────────────────────────────────────────────── */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** `ExponentPushToken[…]`. */
    token: text("token").notNull(),
    /** 'ios' | 'android' */
    platform: text("platform").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("push_tokens_token_unique").on(t.token),
    check("push_tokens_platform_check", sql`${t.platform} IN ('ios','android')`),
    check(
      "push_tokens_token_shape",
      sql`${t.token} ~ '^(ExponentPushToken|ExpoPushToken)\\[[A-Za-z0-9_-]+\\]$'`,
    ),
    index("push_tokens_user_idx").on(t.userId),
  ],
);

/* ─── waitlist_entries ────────────────────────────────────────────── */
export const WAITLIST_STATES = ["waiting", "offered", "accepted", "expired", "withdrawn"] as const;
export type WaitlistState = (typeof WAITLIST_STATES)[number];

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    serviceLineId: uuid("service_line_id")
      .notNull()
      .references(() => serviceLines.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id").references(() => authUsers.id, { onDelete: "cascade" }),
    provisionalPatientId: uuid("provisional_patient_id").references(() => provisionalPatients.id, {
      onDelete: "cascade",
    }),
    /** The patient, or the booking agent for a household member (PRD §2.9). */
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** The Appendix A reason the accepted booking will carry. */
    reason: text("reason").notNull(),
    preferredFrom: date("preferred_from").notNull(),
    preferredTo: date("preferred_to"),
    /** 'waiting' | 'offered' | 'accepted' | 'expired' | 'withdrawn' */
    state: text("state").notNull().default("waiting"),
    offeredSessionId: uuid("offered_session_id").references(() => clinicSessions.id, {
      onDelete: "set null",
    }),
    offeredStartsAt: timestamp("offered_starts_at", { withTimezone: true }),
    /** Provisional at offer time; re-stamped to sent + 2 h when the offer goes out. */
    offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
    /** The cancelled/declined row whose capacity is offered (a slot offer books from it). */
    releasedAppointmentId: uuid("released_appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    acceptedAppointmentId: uuid("accepted_appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "waitlist_entries_member_exactly_one",
      sql`(${t.patientUserId} IS NOT NULL)::int + (${t.provisionalPatientId} IS NOT NULL)::int = 1`,
    ),
    check(
      "waitlist_entries_state_check",
      sql`${t.state} IN ('waiting','offered','accepted','expired','withdrawn')`,
    ),
    check(
      "waitlist_entries_window_order",
      sql`${t.preferredTo} IS NULL OR ${t.preferredTo} >= ${t.preferredFrom}`,
    ),
    check(
      "waitlist_entries_reason_check",
      sql`${t.reason} IN ('follow_up','post_discharge','new_concern','refill','test_results','antenatal','immunisation','child_wellness','specialist_review','routine','procedure','counselling','second_opinion','other')`,
    ),
    check(
      "waitlist_entries_offer_pair",
      sql`${t.state} <> 'offered' OR (${t.offeredStartsAt} IS NOT NULL AND ${t.offerExpiresAt} IS NOT NULL)`,
    ),
    index("waitlist_entries_line_state_idx").on(t.serviceLineId, t.state, t.createdAt),
    index("waitlist_entries_offer_expiry_idx")
      .on(t.offerExpiresAt)
      .where(sql`${t.state} = 'offered'`),
    uniqueIndex("waitlist_entries_live_patient_unique")
      .on(t.serviceLineId, t.patientUserId)
      .where(sql`${t.state} IN ('waiting','offered') AND ${t.patientUserId} IS NOT NULL`),
    uniqueIndex("waitlist_entries_live_provisional_unique")
      .on(t.serviceLineId, t.provisionalPatientId)
      .where(sql`${t.state} IN ('waiting','offered') AND ${t.provisionalPatientId} IS NOT NULL`),
  ],
);

export type NotificationDispatch = typeof notificationDispatches.$inferSelect;
export type NewNotificationDispatch = typeof notificationDispatches.$inferInsert;
export type PushToken = typeof pushTokens.$inferSelect;
export type WaitlistEntry = typeof waitlistEntries.$inferSelect;
export type NewWaitlistEntry = typeof waitlistEntries.$inferInsert;
