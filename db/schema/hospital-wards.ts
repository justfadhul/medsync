import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { hospitalDepartments } from "./hospital-departments";
import { hospitals } from "./hospitals";

/**
 * Wards / units within a hospital + bed counts. Written by the
 * post-approval setup wizard (kickoff §F2). Each row optionally
 * links to a department so a "Med Ward 1" can sit under Internal
 * Medicine.
 */
export const hospitalWards = pgTable(
  "hospital_wards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => hospitalDepartments.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    bedCount: integer("bed_count").notNull().default(0),
    state: text("state").notNull().default("active"),
    /** 0080 (§5.4): A.5 ward type, sex, age group, place, temporary closure, archive. */
    wardType: text("ward_type"),
    sex: text("sex"),
    ageGroup: text("age_group"),
    placeId: uuid("place_id"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    expectedReopenOn: date("expected_reopen_on"), // 0080: a date column; string mode
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("hospital_wards_bed_count_nonneg", sql`${t.bedCount} >= 0`),
    check("hospital_wards_state_check", sql`${t.state} IN ('active','inactive')`),
    uniqueIndex("hospital_wards_unique_slug").on(t.hospitalId, t.slug),
    index("hospital_wards_hospital_idx").on(t.hospitalId),
  ],
);

export type HospitalWard = typeof hospitalWards.$inferSelect;
export type NewHospitalWard = typeof hospitalWards.$inferInsert;
