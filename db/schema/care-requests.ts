import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { admissions } from "./admissions";
import { dutyPosts } from "./duty-rota";
import { clinicalNotes } from "./emr";
import { hospitalDepartments } from "./hospital-departments";
import { hospitalWards } from "./hospital-wards";
import { hospitals } from "./hospitals";
import { encounters } from "./scheduling";

/**
 * Migration 0306 (GATED, ADR 0533): one request record for reviews and consults. Both tables are
 * append-only and audited; the state is derived from the events (lib/requests/engine.ts). RLS (FORCED)
 * lives in the SQL: a SELECT policy for medsync_clinical_reader through private.care_request_visible().
 */
const tz = { withTimezone: true } as const;

export const careRequests = pgTable(
  "care_requests",
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
    admissionId: uuid("admission_id").references(() => admissions.id, { onDelete: "restrict" }),
    wardId: uuid("ward_id").references(() => hospitalWards.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    targetDepartmentId: uuid("target_department_id")
      .notNull()
      .references(() => hospitalDepartments.id, { onDelete: "restrict" }),
    namedUserIds: uuid("named_user_ids").array().notNull().default([]),
    urgency: text("urgency").notNull(),
    helpWanted: text("help_wanted"),
    reasonConditionIds: uuid("reason_condition_ids").array().notNull().default([]),
    questionCiphertext: text("question_ciphertext"),
    phonedUserId: uuid("phoned_user_id").references(() => authUsers.id, { onDelete: "restrict" }),
    phonedAt: timestamp("phoned_at", tz),
    requesterUserId: uuid("requester_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    requesterCadre: text("requester_cadre").notNull(),
    requestedAt: timestamp("requested_at", tz).notNull(),
    placementId: uuid("placement_id").notNull(),
    clientKey: text("client_key").notNull().unique("care_requests_client_key"),
    sensitivity: text("sensitivity").notNull().default("standard"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    /** 0308: the first level's window end from the signed times, set at insert; null when none is signed. */
    dueAt: timestamp("due_at", tz),
  },
  (t) => [
    check("care_requests_kind_check", sql`${t.kind} IN ('review','consult')`),
    check("care_requests_named_max", sql`cardinality(${t.namedUserIds}) <= 5`),
    check("care_requests_sensitivity_check", sql`${t.sensitivity} IN ('standard','restricted')`),
    check(
      "care_requests_urgency_check",
      sql`(${t.kind} = 'review' AND ${t.urgency} IN ('now','within_1h','routine')) OR (${t.kind} = 'consult' AND ${t.urgency} IN ('urgent_today','routine'))`,
    ),
    check(
      "care_requests_help_wanted_check",
      sql`(${t.kind} = 'consult') = (${t.helpWanted} IS NOT NULL) AND (${t.helpWanted} IS NULL OR ${t.helpWanted} IN ('advice','see_patient'))`,
    ),
    check(
      "care_requests_consult_reason",
      sql`${t.kind} = 'review' OR cardinality(${t.reasonConditionIds}) >= 1`,
    ),
    check(
      "care_requests_consult_question",
      sql`${t.kind} = 'review' OR ${t.questionCiphertext} IS NOT NULL`,
    ),
    check("care_requests_phoned_shape", sql`(${t.phonedUserId} IS NULL) = (${t.phonedAt} IS NULL)`),
    index("care_requests_department_time").on(
      t.hospitalId,
      t.targetDepartmentId,
      t.requestedAt.desc(),
    ),
  ],
);

export const careRequestEvents = pgTable(
  "care_request_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => careRequests.id, { onDelete: "restrict" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    at: timestamp("at", tz).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id").references(() => authUsers.id, { onDelete: "restrict" }),
    recipientUserId: uuid("recipient_user_id").references(() => authUsers.id, {
      onDelete: "restrict",
    }),
    level: smallint("level").notNull().default(0),
    step: text("step"),
    /** FK cre_post_fk, added by 0307. */
    postId: uuid("post_id").references(() => dutyPosts.id, { onDelete: "restrict" }),
    reasonCode: text("reason_code"),
    noteCiphertext: text("note_ciphertext"),
    noteId: uuid("note_id").references(() => clinicalNotes.id, { onDelete: "restrict" }),
    redirectDepartmentId: uuid("redirect_department_id").references(() => hospitalDepartments.id, {
      onDelete: "restrict",
    }),
    expectAt: timestamp("expect_at", tz),
    clientKey: text("client_key").unique("care_request_events_client_key"),
    /** Who that routing passed over (inactive, or the requester); routed rows only. */
    skippedUserIds: uuid("skipped_user_ids").array().notNull().default([]),
  },
  (t) => [
    check(
      "care_request_events_kind_check",
      sql`${t.kind} IN ('routed','seen','accepted','declined','redirected','replied','closed','cancelled','escalated')`,
    ),
    check("care_request_events_level_check", sql`${t.level} BETWEEN 0 AND 2`),
    check(
      "care_request_events_step_check",
      sql`(${t.kind} = 'routed') = (${t.step} IS NOT NULL) AND (${t.step} IS NULL OR ${t.step} IN ('named','post','team','supervisor','department_head','hospital_contacts','none'))`,
    ),
    check(
      "care_request_events_reason_check",
      sql`${t.kind} NOT IN ('declined','redirected','cancelled') OR ${t.reasonCode} IS NOT NULL`,
    ),
    check(
      "care_request_events_note_shape",
      sql`(${t.kind} = 'replied') = (${t.noteId} IS NOT NULL)`,
    ),
    check(
      "care_request_events_redirect_shape",
      sql`(${t.kind} = 'redirected') = (${t.redirectDepartmentId} IS NOT NULL)`,
    ),
    check(
      "care_request_events_actor_check",
      sql`${t.kind} NOT IN ('seen','accepted','declined','redirected','replied','closed','cancelled') OR ${t.actorUserId} IS NOT NULL`,
    ),
    check(
      "care_request_events_skipped_shape",
      sql`${t.kind} = 'routed' OR cardinality(${t.skippedUserIds}) = 0`,
    ),
    index("care_request_events_request_time").on(t.requestId, t.at),
    index("care_request_events_recipient_routed")
      .on(t.recipientUserId, t.at.desc())
      .where(sql`${t.kind} = 'routed'`),
  ],
);

/**
 * Migration 0308 (GATED, ADR 0536): the request clock (D4) as a signed, versioned set per hospital, as
 * critical_response_versions (0102). The CHECKs (minutes 1-2880, two signers) and the one-signed index
 * live in the SQL.
 */
export const careRequestResponseVersions = pgTable("care_request_response_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id")
    .notNull()
    .references(() => hospitals.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  reviewNowAcceptMin: integer("review_now_accept_min").notNull(),
  review1hAcceptMin: integer("review_1h_accept_min").notNull(),
  consultUrgentAcceptMin: integer("consult_urgent_accept_min").notNull(),
  routineReplyMin: integer("routine_reply_min").notNull(),
  source: text("source").notNull(),
  authoredBy: uuid("authored_by")
    .notNull()
    .references(() => authUsers.id, { onDelete: "restrict" }),
  adminSignedBy: uuid("admin_signed_by").references(() => authUsers.id, { onDelete: "restrict" }),
  adminSignedAt: timestamp("admin_signed_at", tz),
  csoSignedBy: uuid("cso_signed_by").references(() => authUsers.id, { onDelete: "restrict" }),
  csoSignedAt: timestamp("cso_signed_at", tz),
  exceptionNote: text("exception_note"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  supersededAt: timestamp("superseded_at", tz),
});

export type CareRequestRow = typeof careRequests.$inferSelect;
export type CareRequestEventRow = typeof careRequestEvents.$inferSelect;
