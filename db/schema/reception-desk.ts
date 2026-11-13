import {
  boolean,
  date,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitals } from "./hospitals";
import { appointments } from "./scheduling";

/** Migration 0294 / ADR 0486: one row per identity question asked at the desk. Method and result only. */
export const deskIdentityAttempts = pgTable(
  "desk_identity_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "cascade",
    }),
    patientUserId: uuid("patient_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    method: text("method").notNull(),
    matched: boolean("matched").notNull(),
    attemptNo: smallint("attempt_no").notNull(),
    byUserId: uuid("by_user_id")
      .notNull()
      .references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("desk_identity_attempts_appt").on(t.appointmentId, t.createdAt)],
);

/** Migration 0294 / D-RD-12: Close the day; undone the same day. */
export const deskDayClosures = pgTable(
  "desk_day_closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    serviceDate: date("service_date").notNull(),
    appointmentIds: uuid("appointment_ids").array().notNull().default([]),
    closedBy: uuid("closed_by")
      .notNull()
      .references(() => authUsers.id),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    undoneBy: uuid("undone_by").references(() => authUsers.id),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [index("desk_day_closures_day").on(t.hospitalId, t.serviceDate)],
);

/** Migration 0294 / D-RD-13, D-RD-20: a shared desk computer and its Mine clinics. */
export const deskDevices = pgTable(
  "desk_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    mineDepartmentIds: uuid("mine_department_ids").array().notNull().default([]),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.hospitalId, t.label)],
);

/** Migration 0294 / ADR 0489: a user's PIN on one desk device (bcrypt, checked inside the database). */
export const deskPins = pgTable(
  "desk_pins",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => deskDevices.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    pinHash: text("pin_hash").notNull(),
    failedTries: smallint("failed_tries").notNull().default(0),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.userId] })],
);
