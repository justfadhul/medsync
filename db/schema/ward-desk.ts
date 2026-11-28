/**
 * Running the ward (ADR 0545 Phase 4, migration 0315): the ward and department calendar with attendance, staff leave
 * requests, safety incidents, and SBAR handover notes with bedside receipts. All append-only; the server writes as
 * the owner. Checks and indexes live in the migration.
 */
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { boolean, date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitalDepartments } from "./hospital-departments";
import { hospitalWards } from "./hospital-wards";
import { hospitals } from "./hospitals";

const hospital = () =>
  uuid("hospital_id")
    .notNull()
    .references(() => hospitals.id, { onDelete: "restrict" });
const user = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => authUsers.id, { onDelete: "restrict" });

export const wardCalendarEvents = pgTable("ward_calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: hospital(),
  departmentId: uuid("department_id").references(() => hospitalDepartments.id, {
    onDelete: "restrict",
  }),
  wardId: uuid("ward_id").references(() => hospitalWards.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  place: text("place"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  leadName: text("lead_name"),
  audiences: text("audiences")
    .array()
    .notNull()
    .default(sql`'{}'`),
  sharedWithDepartment: boolean("shared_with_department").notNull().default(false),
  asks: text("asks"),
  state: text("state").notNull().default("active"),
  replacesId: uuid("replaces_id").references((): AnyPgColumn => wardCalendarEvents.id, {
    onDelete: "restrict",
  }),
  createdByUserId: user("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  clientKey: text("client_key"),
});

export const wardCalendarAttendance = pgTable("ward_calendar_attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: hospital(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => wardCalendarEvents.id, { onDelete: "restrict" }),
  userId: user("user_id"),
  kind: text("kind").notNull(),
  recordedByUserId: user("recorded_by_user_id"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  clientKey: text("client_key"),
});

export const staffLeaveRequests = pgTable("staff_leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: hospital(),
  departmentId: uuid("department_id").references(() => hospitalDepartments.id, {
    onDelete: "restrict",
  }),
  userId: user("user_id"),
  kind: text("kind").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  note: text("note"),
  state: text("state").notNull().default("asked"),
  replacesId: uuid("replaces_id").references((): AnyPgColumn => staffLeaveRequests.id, {
    onDelete: "restrict",
  }),
  recordedByUserId: user("recorded_by_user_id"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  clientKey: text("client_key"),
});

export const safetyIncidents = pgTable("safety_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: hospital(),
  wardId: uuid("ward_id").references(() => hospitalWards.id, { onDelete: "restrict" }),
  patientUserId: uuid("patient_user_id").references(() => authUsers.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  harm: text("harm").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  description: text("description").notNull(),
  state: text("state").notNull().default("reported"),
  replacesId: uuid("replaces_id").references((): AnyPgColumn => safetyIncidents.id, {
    onDelete: "restrict",
  }),
  reportedByUserId: user("reported_by_user_id"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  clientKey: text("client_key"),
});

export const handoverPatientNotes = pgTable("handover_patient_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: hospital(),
  wardId: uuid("ward_id").references(() => hospitalWards.id, { onDelete: "restrict" }),
  patientUserId: user("patient_user_id"),
  situation: text("situation").notNull(),
  background: text("background"),
  assessment: text("assessment"),
  recommendation: text("recommendation"),
  tasks: text("tasks")
    .array()
    .notNull()
    .default(sql`'{}'`),
  writtenByUserId: user("written_by_user_id"),
  writtenAt: timestamp("written_at", { withTimezone: true }).notNull().defaultNow(),
  clientKey: text("client_key"),
});

export const handoverReceipts = pgTable("handover_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: hospital(),
  noteId: uuid("note_id")
    .notNull()
    .references(() => handoverPatientNotes.id, { onDelete: "restrict" }),
  patientUserId: user("patient_user_id"),
  receivedByUserId: user("received_by_user_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
