import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Responses to the public `/feedback` form (migration 0081). Superadmin-read only. */
export const testerFeedback = pgTable(
  "tester_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    respondent: text("respondent").notNull(),
    answers: jsonb("answers").$type<Record<string, number | string>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tester_feedback_respondent_created_idx").on(t.respondent, t.createdAt)],
);
