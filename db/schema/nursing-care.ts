/**
 * The nursing care plan (ADR 0545 Phase 2, migration 0314). Both tables are append-only: resolving or withdrawing a
 * problem is a new row naming the one it replaces; an untick is a new event after the tick. Reads go through the
 * clinical reader (RLS); the server writes as the owner.
 */
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitals } from "./hospitals";
import { encounters } from "./scheduling";

export const nursingCareProblems = pgTable(
  "nursing_care_problems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "restrict" }),
    problem: text("problem").notNull(),
    label: text("label"),
    relatedTo: text("related_to"),
    asShownBy: text("as_shown_by"),
    goal: text("goal").notNull(),
    goalBy: text("goal_by"),
    careItems: text("care_items")
      .array()
      .notNull()
      .default(sql`'{}'`),
    libraryKey: text("library_key"),
    state: text("state").notNull().default("active"),
    replacesId: uuid("replaces_id").references((): AnyPgColumn => nursingCareProblems.id, {
      onDelete: "restrict",
    }),
    reason: text("reason"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    clientKey: text("client_key"),
  },
  (t) => [
    check("ncp_state_check", sql`${t.state} IN ('active','resolved','entered_in_error')`),
    check("ncp_items_check", sql`cardinality(${t.careItems}) <= 20`),
    check("ncp_ends_check", sql`${t.state} = 'active' OR ${t.replacesId} IS NOT NULL`),
    index("nursing_care_problems_encounter").on(t.encounterId, t.recordedAt),
    uniqueIndex("nursing_care_problems_replaces")
      .on(t.replacesId)
      .where(sql`${t.replacesId} IS NOT NULL`),
    uniqueIndex("nursing_care_problems_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);

export const nursingCareEvents = pgTable(
  "nursing_care_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => nursingCareProblems.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    itemIndex: integer("item_index"),
    evaluation: text("evaluation"),
    note: text("note"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    clientKey: text("client_key"),
  },
  (t) => [
    check("nce_kind_check", sql`${t.kind} IN ('tick','untick','evaluation')`),
    check("nce_item_check", sql`(${t.kind} = 'evaluation') = (${t.itemIndex} IS NULL)`),
    check(
      "nce_evaluation_check",
      sql`(${t.kind} = 'evaluation') = (${t.evaluation} IS NOT NULL) AND (${t.evaluation} IS NULL OR ${t.evaluation} IN ('met','progressing','not_met'))`,
    ),
    index("nursing_care_events_problem").on(t.problemId, t.recordedAt),
    uniqueIndex("nursing_care_events_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);
