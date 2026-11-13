import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { hospitalDepartments } from "./hospital-departments";
import { hospitals } from "./hospitals";
import { patientIntakes } from "./patient-intakes";
import { triageRecords } from "./triage";

/** Migration 0295 (ADRs 0491–0497): the clinic floor's append-only event log. No name, phone or vital here. */
export const clinicFloorEvents = pgTable(
  "clinic_floor_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    intakeId: uuid("intake_id").references(() => patientIntakes.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => hospitalDepartments.id, {
      onDelete: "set null",
    }),
    doctorUserId: uuid("doctor_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    triageRecordId: uuid("triage_record_id").references(() => triageRecords.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    detail: text("detail"),
    room: text("room"),
    note: text("note"),
    clientId: uuid("client_id").notNull(),
    byUserId: uuid("by_user_id")
      .notNull()
      .references(() => authUsers.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("clinic_floor_events_client_unique").on(t.hospitalId, t.clientId),
    index("clinic_floor_events_day").on(t.hospitalId, t.at),
  ],
);
