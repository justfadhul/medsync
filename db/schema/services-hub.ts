import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { hospitalDepartments } from "./hospital-departments";
import { hospitalWards } from "./hospital-wards";
import { hospitals } from "./hospitals";
import { serviceLines } from "./service-lines";

/**
 * Departments & services hub — migration 0080 (GATED), ADRs 0150–0160. Mirrors the SQL by hand
 * (the repo's pattern since 0002). Every table: RLS read for the hospital's admins, staff and
 * superadmins; no client writes (ha-services-hub writes with the service role).
 */

export const hospitalPlaces = pgTable("hospital_places", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id")
    .notNull()
    .references(() => hospitals.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  building: text("building"),
  floor: text("floor"),
  room: text("room"),
  /** ≤ 140 characters: it goes out by SMS. */
  directions: text("directions"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /** 0296: blocks and wings, rooms in them. */
  kind: text("kind").notNull().default("room"),
  parentId: uuid("parent_id"),
  tier: text("tier"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** STR-3: effective-dated; one open substantive + one open acting per department. */
export const departmentHeads = pgTable("department_heads", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id")
    .notNull()
    .references(() => hospitals.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => hospitalDepartments.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  acting: boolean("acting").notNull().default(false),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  setByUserId: uuid("set_by_user_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * STR-5: optional register; never more unarchived beds than the ward's count. 0090 (ADR 0192): where
 * each bed stands on the published layout, and `bed_type` checked to the ward builder's four types
 * (NOT VALID in SQL, so a value written before 0090 stays valid); 0310 (ADR 0540) adds chair and resus.
 * For a laid-out ward, publishing the layout writes these rows.
 */
export const hospitalBeds = pgTable(
  "hospital_beds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    wardId: uuid("ward_id")
      .notNull()
      .references(() => hospitalWards.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    bedType: text("bed_type"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** 0090: top-left cell on the plan, rotation, and the room (a key in the layout document). */
    layoutX: integer("layout_x"),
    layoutY: integer("layout_y"),
    rotation: integer("rotation"),
    roomKey: text("room_key"),
  },
  (t) => [
    check(
      "hospital_beds_rotation_check",
      sql`${t.rotation} IS NULL OR ${t.rotation} IN (0, 90, 180, 270)`,
    ),
    check(
      "hospital_beds_bed_type_check",
      sql`${t.bedType} IS NULL OR ${t.bedType} IN ('standard', 'icu', 'cot', 'couch', 'chair', 'resus')`,
    ),
  ],
);

/** DX-1, DX-3: the facility overlay on the ordering catalogue (lab = LOINC code; imaging = A.4). */
export const diagnosticOfferings = pgTable(
  "diagnostic_offerings",
  {
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    /** 'in_house' | 'referred' | 'not_offered'. */
    provision: text("provision").notNull(),
    sectionId: uuid("section_id"),
    hours: text("hours"),
    hoursNote: text("hours_note"),
    /** Operational, never a clinical target. */
    statedTat: text("stated_tat"),
    referredTo: text("referred_to"),
    machines: integer("machines"),
    /** 0171 (TM-3): a lab row's code is the test id; its section is the catalogue's unless overridden. */
    sectionOverride: text("section_override"),
    statedTurnaroundMinutes: integer("stated_turnaround_minutes"),
    /** NULL = Planned (preset / legacy import), not yet confirmed by the hospital. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.hospitalId, t.kind, t.code] })],
);

/** CAP-1, CAP-5: one row per key; `value` verified (or non-routing), `pending*` awaiting a second person. */
export const capabilityValues = pgTable(
  "capability_values",
  {
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value"),
    authoredBy: uuid("authored_by"),
    authoredAt: timestamp("authored_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    pendingValue: jsonb("pending_value"),
    pendingBy: uuid("pending_by"),
    pendingAt: timestamp("pending_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.hospitalId, t.key] })],
);

/** AV-1: append-only (UPDATE/DELETE raise); the state is `projectAvailability` over these. */
export const availabilityEvents = pgTable("availability_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  hospitalId: uuid("hospital_id")
    .notNull()
    .references(() => hospitals.id, { onDelete: "cascade" }),
  problemId: uuid("problem_id").notNull(),
  subjectKind: text("subject_kind").notNull(),
  subjectRef: text("subject_ref").notNull(),
  subjectLabel: text("subject_label").notNull(),
  event: text("event").notNull(),
  state: text("state"),
  reason: text("reason"),
  note: text("note"),
  expectedBackAt: timestamp("expected_back_at", { withTimezone: true }),
  actorUserId: uuid("actor_user_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/** D-SVC-09: reference data, seeded yearly with its source. */
export const publicHolidays = pgTable("public_holidays", {
  id: serial("id").primaryKey(),
  holidayDate: date("holiday_date").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  provisional: boolean("provisional").notNull().default(false),
  source: text("source").notNull(),
  verifiedOn: date("verified_on").notNull(),
});

/** CLN-4: closures always win; the booking engine's cancel flow runs per affected session. */
export const serviceClosures = pgTable("service_closures", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id")
    .notNull()
    .references(() => hospitals.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  departmentId: uuid("department_id").references(() => hospitalDepartments.id, {
    onDelete: "cascade",
  }),
  wardId: uuid("ward_id").references(() => hospitalWards.id, { onDelete: "cascade" }),
  serviceLineId: uuid("service_line_id").references(() => serviceLines.id, { onDelete: "cascade" }),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  liftedBy: uuid("lifted_by"),
  /** 0296: part of a day, and what happens to people already booked. */
  partStartMinutes: smallint("part_start_minutes"),
  partEndMinutes: smallint("part_end_minutes"),
  bookingPolicy: text("booking_policy").notNull().default("offer"),
});

/** S2: the one-time legacy import decision. */
export const hospitalServicesState = pgTable("hospital_services_state", {
  hospitalId: uuid("hospital_id")
    .primaryKey()
    .references(() => hospitals.id, { onDelete: "cascade" }),
  legacyImport: text("legacy_import"),
  legacyDecidedAt: timestamp("legacy_decided_at", { withTimezone: true }),
  legacyDecidedBy: uuid("legacy_decided_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
