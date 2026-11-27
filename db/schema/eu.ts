/* ─── The EU stay (migration 0311 — GATED) ────────────────────────────────
 * ADR 0541. One row per stay in an emergency observation ward (EU), from the decision to the end; one open per
 * patient; awaiting_space ↔ in_space, then ended, once (the guard trigger eu_stays_guard). Written only by the SQL
 * functions of 0311 on the service role; clients read as admissions. bed_assignments.eu_stay_id is in
 * ward-builder.ts (FK in SQL).
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { admissions } from "./admissions";
import { hospitalWards } from "./hospital-wards";
import { hospitals } from "./hospitals";
import { patientIntakes } from "./patient-intakes";
import { encounters } from "./scheduling";

export const EU_STAY_STATUSES = ["awaiting_space", "in_space", "ended"] as const;
export type EuStayStatus = (typeof EU_STAY_STATUSES)[number];
/** Who decided the stay: a doctor from the visit, or a triage nurse from the intake. */
export const EU_STARTED_BY_KINDS = ["doctor", "triage_nurse"] as const;
/** Why a patient in the EU waits for a space (as BED_WAIT_REASONS). */
export const SPACE_WAIT_REASONS = ["no_free_bed", "extra_bed", "floor", "other"] as const;
export type SpaceWaitReason = (typeof SPACE_WAIT_REASONS)[number];
export const EU_END_KINDS = [
  "admitted",
  "home",
  "referred_out",
  "transferred",
  "theatre",
  "died",
  "left_before_completion",
  "left_against_advice",
] as const;
export type EuEndKind = (typeof EU_END_KINDS)[number];

export const euStays = pgTable(
  "eu_stays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** Stamped once; null only for a triage nurse's stay until a doctor adopts it. */
    encounterId: uuid("encounter_id").references(() => encounters.id),
    intakeId: uuid("intake_id").references(() => patientIntakes.id),
    wardId: uuid("ward_id")
      .notNull()
      .references(() => hospitalWards.id),
    startedByKind: text("started_by_kind").notNull(),
    decidedBy: uuid("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    responsibleUserId: uuid("responsible_user_id").notNull(),
    status: text("status").notNull().default("awaiting_space"),
    spaceWaitReason: text("space_wait_reason"),
    spaceWaitNoteCiphertext: text("space_wait_note_ciphertext"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    arrivedBy: uuid("arrived_by"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: uuid("ended_by"),
    endKind: text("end_kind"),
    admissionId: uuid("admission_id").references(() => admissions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("eu_stays_started_by_kind_check", sql`${t.startedByKind} IN ('doctor', 'triage_nurse')`),
    check("eu_stays_status_check", sql`${t.status} IN ('awaiting_space', 'in_space', 'ended')`),
    check(
      "eu_stays_wait_reason_check",
      sql`${t.spaceWaitReason} IS NULL OR ${t.spaceWaitReason} IN ('no_free_bed', 'extra_bed', 'floor', 'other')`,
    ),
    check(
      "eu_stays_end_kind_check",
      sql`${t.endKind} IS NULL OR ${t.endKind} IN ('admitted', 'home', 'referred_out', 'transferred', 'theatre', 'died', 'left_before_completion', 'left_against_advice')`,
    ),
    check(
      "eu_stays_who_check",
      sql`${t.encounterId} IS NOT NULL OR (${t.startedByKind} = 'triage_nurse' AND ${t.intakeId} IS NOT NULL)`,
    ),
    check("eu_stays_arrival_check", sql`(${t.arrivedAt} IS NULL) = (${t.arrivedBy} IS NULL)`),
    check(
      "eu_stays_end_check",
      sql`(${t.status} = 'ended') = (${t.endedAt} IS NOT NULL) AND (${t.endedAt} IS NULL) = (${t.endedBy} IS NULL) AND (${t.endedAt} IS NULL) = (${t.endKind} IS NULL)`,
    ),
    check(
      "eu_stays_wait_note_check",
      sql`${t.spaceWaitReason} IS DISTINCT FROM 'other' OR ${t.spaceWaitNoteCiphertext} IS NOT NULL`,
    ),
    uniqueIndex("eu_stays_one_open_per_patient")
      .on(t.patientUserId)
      .where(sql`${t.status} <> 'ended'`),
    index("eu_stays_ward_status_idx").on(t.wardId, t.status),
    index("eu_stays_hospital_decided_idx").on(t.hospitalId, t.decidedAt),
  ],
);

export type EuStay = typeof euStays.$inferSelect;
