import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";

/**
 * 1:1 profile row with `auth.users`. Created either by a trigger on
 * `auth.users` insert (Phase 0.9) or directly by the seed script.
 *
 * PHI columns (NIN, encrypted clinical fields) land in Phase 1+ tables, not
 * here. `full_name` is plaintext for operational queries; encryption of the
 * stored-name copy is a Phase 1 decision once we know which surfaces need it.
 *
 * `state` (added in onboarding migration 0007) follows the lifecycle
 * machine in lib/lifecycle.ts. Defaults to 'unverified' for new
 * signups; advances through verify → active for patients, through
 * verify → pending_approval → approved → active for staff + hospital
 * applicants.
 */
export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  /**
   * Lifecycle state — Postgres enum `public.lifecycle_state`. Drizzle
   * sees it as text; runtime validation lives in lib/lifecycle.ts.
   */
  state: text("state").notNull().default("unverified"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
