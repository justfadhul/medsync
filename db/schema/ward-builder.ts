/* ─── The ward builder and the live bed board (migration 0090 — GATED) ──
 * ADRs 0191–0196, docs/wards/ward-builder/.
 *
 * ward_layouts: one JSON document per version; one draft and one published per ward; published and
 * superseded rows are append-only (a trigger). hospital_bed_services: the services at each bed, written
 * only by publish. bed_assignments (patient ↔ bed; one open per bed and per patient; ends once) and
 * bed_state_events (append-only) give the board its states. Every write goes through ha-services-hub on
 * the service role; clients read under RLS.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitalWards } from "./hospital-wards";
import { hospitals } from "./hospitals";
import { encounters } from "./scheduling";
import { hospitalBeds } from "./services-hub";

export const wardLayouts = pgTable(
  "ward_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    wardId: uuid("ward_id")
      .notNull()
      .references(() => hospitalWards.id, { onDelete: "cascade" }),
    /** The layout's number in the ward's history; a new draft takes the next one. */
    version: integer("version").notNull(),
    /** Bumps on every draft save; a save naming a stale revision is refused (ADR 0191 §3). */
    revision: integer("revision").notNull().default(1),
    state: text("state").notNull().default("draft"),
    floorWCells: integer("floor_w_cells").notNull(),
    floorHCells: integer("floor_h_cells").notNull(),
    cellMm: integer("cell_mm").notNull().default(500),
    /** The WardLayout document (supabase/functions/_shared/ward-layout.ts). */
    document: jsonb("document").notNull(),
    /** The check texts shown at publish. */
    warnings: jsonb("warnings").notNull().default([]),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    check("ward_layouts_state_check", sql`${t.state} IN ('draft', 'published', 'superseded')`),
    uniqueIndex("ward_layouts_one_draft")
      .on(t.wardId)
      .where(sql`${t.state} = 'draft'`),
    uniqueIndex("ward_layouts_one_published")
      .on(t.wardId)
      .where(sql`${t.state} = 'published'`),
    uniqueIndex("ward_layouts_ward_version").on(t.wardId, t.version),
    index("ward_layouts_hospital_idx").on(t.hospitalId),
  ],
);

export const hospitalBedServices = pgTable(
  "hospital_bed_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bedId: uuid("bed_id")
      .notNull()
      .references(() => hospitalBeds.id, { onDelete: "cascade" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    /** ADR 0193's catalogue: SERVICE_CODES. */
    serviceCode: text("service_code").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "hospital_bed_services_code_check",
      sql`${t.serviceCode} IN ('o2', 'suction', 'air', 'monitor', 'call', 'power', 'pump', 'iv_pole', 'locker', 'overbed_table', 'pressure_mattress', 'curtain_track')`,
    ),
    uniqueIndex("hospital_bed_services_bed_code").on(t.bedId, t.serviceCode),
    index("hospital_bed_services_hospital_code").on(t.hospitalId, t.serviceCode),
  ],
);

export const bedAssignments = pgTable(
  "bed_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    wardId: uuid("ward_id")
      .notNull()
      .references(() => hospitalWards.id, { onDelete: "cascade" }),
    bedId: uuid("bed_id")
      .notNull()
      .references(() => hospitalBeds.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id").references(() => encounters.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startedBy: uuid("started_by").notNull(),
    endedBy: uuid("ended_by"),
    /** Why the patient left the bed (set once, when the assignment ends). */
    reason: text("reason"),
    /** 0091 (ADR 0199): the admission this bed was allocated for; with no arrived_at it is Arriving. FK in SQL. */
    admissionId: uuid("admission_id"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    arrivedBy: uuid("arrived_by"),
    /** 0311 (ADR 0541): the EU stay this space serves; never with admission_id. FK in SQL. */
    euStayId: uuid("eu_stay_id"),
  },
  (t) => [
    uniqueIndex("bed_assignments_one_open_per_bed")
      .on(t.bedId)
      .where(sql`${t.endedAt} IS NULL`),
    // 0312 (ADR 0542): one Occupied plus one Arriving place per patient (a boarder holds both).
    uniqueIndex("bed_assignments_one_occupied_per_patient")
      .on(t.patientUserId)
      .where(
        sql`${t.endedAt} IS NULL AND (${t.arrivedAt} IS NOT NULL OR (${t.admissionId} IS NULL AND ${t.euStayId} IS NULL))`,
      ),
    uniqueIndex("bed_assignments_one_arriving_per_patient")
      .on(t.patientUserId)
      .where(
        sql`${t.endedAt} IS NULL AND ${t.arrivedAt} IS NULL AND (${t.admissionId} IS NOT NULL OR ${t.euStayId} IS NOT NULL)`,
      ),
    index("bed_assignments_ward_idx").on(t.wardId, t.endedAt),
    index("bed_assignments_hospital_idx").on(t.hospitalId),
  ],
);

export const bedStateEvents = pgTable(
  "bed_state_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    bedId: uuid("bed_id")
      .notNull()
      .references(() => hospitalBeds.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    reason: text("reason"),
    setBy: uuid("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("bed_state_events_state_check", sql`${t.state} IN ('cleaning', 'reserved', 'free')`),
    index("bed_state_events_bed_idx").on(t.bedId, t.setAt.desc()),
    index("bed_state_events_hospital_idx").on(t.hospitalId),
  ],
);

export type WardLayoutRow = typeof wardLayouts.$inferSelect;
export type BedAssignment = typeof bedAssignments.$inferSelect;
export type BedStateEvent = typeof bedStateEvents.$inferSelect;
