import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Server-side draft persistence for multi-step onboarding forms.
 *
 * Why server-side (not localStorage): mobile-first / variable
 * bandwidth means users may resume on a different device after a
 * dropped connection; PHI fields inside `payload` are encrypted
 * via `lib/encryption.ts` before write, so localStorage would
 * defeat the encryption boundary.
 *
 * Owner-key contract:
 *   - Pre-account: lowercased email (the form's first collected
 *     field).
 *   - Mid-flow with account: `auth.uid()::text`.
 *
 * TTL: 14 days from last touch. Sweeper cron in GATE G.
 *
 * RLS: authenticated own-only; pre-account access via service-role
 * + signed cookie containing the rotating access_token. NOT audited
 * (transient form state, not system-of-record).
 */

export const DRAFT_KINDS = ["patient", "clinical", "hospital"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const signupDrafts = pgTable(
  "signup_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftKind: text("draft_kind").notNull(),
    ownerKey: text("owner_key").notNull(),
    /** Server-issued rotating token; signed-cookie-carried for pre-account resume. */
    accessToken: text("access_token"),
    payload: jsonb("payload").notNull(),
    currentStep: text("current_step"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '14 days'`),
  },
  (t) => [
    check(
      "signup_drafts_kind_check",
      sql.raw(`draft_kind IN (${DRAFT_KINDS.map((k) => `'${k}'`).join(", ")})`),
    ),
    uniqueIndex("signup_drafts_owner_kind_unique").on(t.draftKind, t.ownerKey),
    index("signup_drafts_expires_idx").on(t.expiresAt),
  ],
);

export type SignupDraft = typeof signupDrafts.$inferSelect;
export type NewSignupDraft = typeof signupDrafts.$inferInsert;
