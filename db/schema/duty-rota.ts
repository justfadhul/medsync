import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitalDepartments } from "./hospital-departments";
import { hospitalWards } from "./hospital-wards";
import { hospitals } from "./hospitals";

/**
 * Migration 0307 (GATED, ADR 0534): duty posts and who holds them when. Posts are archived, never edited;
 * assignments are ended, never edited or deleted. The guard trigger (grade, leave, double booking,
 * capacity, rota maker) and RLS (FORCED, SELECT for medsync_clinical_reader) live in the SQL.
 * Windows are half-open, as lib/rota/cover.ts.
 */
const tz = { withTimezone: true } as const;

export const dutyPosts = pgTable(
  "duty_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => hospitalDepartments.id, { onDelete: "restrict" }),
    wardId: uuid("ward_id").references(() => hospitalWards.id, { onDelete: "restrict" }),
    scopeKind: text("scope_kind").notNull(),
    name: text("name").notNull(),
    level: text("level").notNull(),
    eligibleCadres: text("eligible_cadres").array().notNull(),
    takesConsults: boolean("takes_consults").notNull().default(false),
    escalatesToPostId: uuid("escalates_to_post_id").references((): AnyPgColumn => dutyPosts.id, {
      onDelete: "restrict",
    }),
    capacity: smallint("capacity").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", tz),
    archivedBy: uuid("archived_by").references(() => authUsers.id, { onDelete: "restrict" }),
  },
  (t) => [
    check("duty_posts_scope_kind_check", sql`${t.scopeKind} IN ('ward','department')`),
    check("duty_posts_name_check", sql`char_length(${t.name}) BETWEEN 2 AND 80`),
    check(
      "duty_posts_level_check",
      sql`${t.level} IN ('junior','senior','consultant','nurse_in_charge','allied')`,
    ),
    check("duty_posts_cadres_check", sql`cardinality(${t.eligibleCadres}) >= 1`),
    check("duty_posts_capacity_check", sql`${t.capacity} BETWEEN 1 AND 20`),
    check("duty_posts_scope_ward", sql`(${t.scopeKind} = 'ward') = (${t.wardId} IS NOT NULL)`),
    check("duty_posts_archive_shape", sql`(${t.archivedAt} IS NULL) = (${t.archivedBy} IS NULL)`),
    index("duty_posts_department").on(t.hospitalId, t.departmentId),
  ],
);

export const dutyAssignments = pgTable(
  "duty_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => dutyPosts.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", tz).notNull(),
    endsAt: timestamp("ends_at", tz).notNull(),
    kind: text("kind").notNull(),
    coversAssignmentId: uuid("covers_assignment_id").references(
      (): AnyPgColumn => dutyAssignments.id,
      { onDelete: "restrict" },
    ),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    endedAt: timestamp("ended_at", tz),
    endedBy: uuid("ended_by").references(() => authUsers.id, { onDelete: "restrict" }),
    endReason: text("end_reason"),
  },
  (t) => [
    check("duty_assignments_kind_check", sql`${t.kind} IN ('rostered','cover','swap')`),
    check("duty_assignments_end_reason_check", sql`char_length(${t.endReason}) BETWEEN 2 AND 200`),
    check("duty_assignments_window", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "duty_assignments_covers_shape",
      sql`${t.kind} = 'rostered' OR ${t.coversAssignmentId} IS NOT NULL`,
    ),
    check(
      "duty_assignments_end_shape",
      sql`(${t.endedAt} IS NULL) = (${t.endedBy} IS NULL) AND (${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`,
    ),
    index("duty_assignments_post_time").on(t.hospitalId, t.postId, t.startsAt),
    index("duty_assignments_user_time").on(t.hospitalId, t.userId, t.startsAt),
  ],
);
