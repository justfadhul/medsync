import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
 * Migration 0309 (GATED, ADR 0538) adds the upkeep tables at the end of this file.
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
    check("duty_assignments_end_within", sql`${t.endedAt} <= ${t.endsAt}`),
    check(
      "duty_assignments_end_shape",
      sql`(${t.endedAt} IS NULL) = (${t.endedBy} IS NULL) AND (${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`,
    ),
    index("duty_assignments_post_time").on(t.hospitalId, t.postId, t.startsAt),
    index("duty_assignments_user_time").on(t.hospitalId, t.userId, t.startsAt),
  ],
);

/**
 * Migration 0309 (GATED, ADR 0538): week templates, publish/unlock events, delegates, and cover/swap requests
 * with their events. Templates are ended, delegates revoked; the rest are append-only. The guards (maker,
 * publish rights, the week lock rota_locked, who answers a request, approval writing the cover) live in the SQL.
 */
export const dutyRotaTemplates = pgTable(
  "duty_rota_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => hospitalDepartments.id, { onDelete: "restrict" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => dutyPosts.id, { onDelete: "restrict" }),
    weekdays: smallint("weekdays").array().notNull(),
    shift: text("shift").notNull(),
    userId: uuid("user_id").references(() => authUsers.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    endedAt: timestamp("ended_at", tz),
    endedBy: uuid("ended_by").references(() => authUsers.id, { onDelete: "restrict" }),
  },
  (t) => [
    check(
      "duty_rota_templates_weekdays_check",
      sql`cardinality(${t.weekdays}) BETWEEN 1 AND 7 AND ${t.weekdays} <@ ARRAY[1,2,3,4,5,6,7]::smallint[]`,
    ),
    check("duty_rota_templates_shift_check", sql`${t.shift} IN ('day','night','day24','week')`),
    check("duty_rota_templates_end_shape", sql`(${t.endedAt} IS NULL) = (${t.endedBy} IS NULL)`),
    index("duty_rota_templates_department").on(t.hospitalId, t.departmentId),
  ],
);

export const dutyRotaDelegates = pgTable(
  "duty_rota_delegates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => hospitalDepartments.id, { onDelete: "restrict" }),
    fromUser: uuid("from_user")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    toUser: uuid("to_user")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    canPublish: boolean("can_publish").notNull().default(false),
    until: date("until"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", tz),
    revokedBy: uuid("revoked_by").references(() => authUsers.id, { onDelete: "restrict" }),
  },
  (t) => [
    check("duty_rota_delegates_self", sql`${t.fromUser} <> ${t.toUser}`),
    check(
      "duty_rota_delegates_revoke_shape",
      sql`(${t.revokedAt} IS NULL) = (${t.revokedBy} IS NULL)`,
    ),
    index("duty_rota_delegates_to").on(t.hospitalId, t.toUser, t.departmentId),
  ],
);

export const dutyRotaWeekEvents = pgTable(
  "duty_rota_week_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => hospitalDepartments.id, { onDelete: "restrict" }),
    weekStart: date("week_start").notNull(),
    kind: text("kind").notNull(),
    reason: text("reason"),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    at: timestamp("at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("duty_rota_week_events_week_start_check", sql`extract(isodow FROM ${t.weekStart}) = 1`),
    check("duty_rota_week_events_kind_check", sql`${t.kind} IN ('publish','unlock')`),
    check("duty_rota_week_events_reason_length", sql`char_length(${t.reason}) BETWEEN 2 AND 300`),
    check("duty_rota_week_events_reason", sql`${t.kind} <> 'unlock' OR ${t.reason} IS NOT NULL`),
    index("duty_rota_week_events_latest").on(
      t.hospitalId,
      t.departmentId,
      t.weekStart,
      t.at.desc(),
    ),
  ],
);

export const dutySwapRequests = pgTable(
  "duty_swap_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => dutyAssignments.id, { onDelete: "restrict" }),
    askedBy: uuid("asked_by")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    colleagueUserId: uuid("colleague_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    swapAssignmentId: uuid("swap_assignment_id").references(() => dutyAssignments.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("duty_swap_requests_kind_check", sql`${t.kind} IN ('cover','swap')`),
    check("duty_swap_requests_colleague", sql`${t.colleagueUserId} <> ${t.askedBy}`),
    check(
      "duty_swap_requests_swap_shape",
      sql`(${t.kind} = 'swap') = (${t.swapAssignmentId} IS NOT NULL)`,
    ),
    index("duty_swap_requests_assignment").on(t.hospitalId, t.assignmentId),
  ],
);

export const dutySwapRequestEvents = pgTable(
  "duty_swap_request_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => dutySwapRequests.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    reason: text("reason"),
    at: timestamp("at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "duty_swap_request_events_kind_check",
      sql`${t.kind} IN ('accepted','declined','approved','refused','withdrawn')`,
    ),
    check("duty_swap_request_events_reason_check", sql`char_length(${t.reason}) BETWEEN 2 AND 300`),
    index("duty_swap_request_events_request").on(t.requestId, t.at),
  ],
);
