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
import { hospitals } from "./hospitals";
import { encounters } from "./scheduling";

/**
 * Quick protocols (prescribing kit P3, F6; migration 0282, GATED). A protocol and its versions: the
 * version holds every clinical number (`rules`, `seed`), signed by two different clinicians (2
 * consultants, or the DTC chair and a consultant). The CHECKs below and the frozen trigger hold that
 * in the database; `canStart` (lib/protocols/quick.ts) refuses an unsigned version in production.
 */

export const protocols = pgTable(
  "protocols",
  {
    /** "dka", "hhs", … for the seeds; "custom-<uuid>" for a hospital's own (the builder). */
    id: text("id").primaryKey(),
    /** Null: a MedSync seed. */
    hospitalId: uuid("hospital_id").references(() => hospitals.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    groupKey: text("group_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => authUsers.id, {
      onDelete: "restrict",
    }),
  },
  (t) => [
    check("protocols_id_check", sql`${t.id} ~ '^[a-z][a-z0-9_-]{1,60}$'`),
    check("protocols_name_check", sql`length(${t.name}) BETWEEN 3 AND 120`),
    check(
      "protocols_group_key_check",
      sql`${t.groupKey} IN ('endo','cardio','obs','inf','neuro','lytes','tox','custom')`,
    ),
    check(
      "protocols_custom_has_hospital",
      sql`(${t.groupKey} = 'custom') = (${t.hospitalId} IS NOT NULL)`,
    ),
  ],
);

export const protocolVersions = pgTable(
  "protocol_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    protocolId: text("protocol_id")
      .notNull()
      .references(() => protocols.id, { onDelete: "restrict" }),
    /** Null: the seed draft. A hospital signs its own copy. */
    hospitalId: uuid("hospital_id").references(() => hospitals.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    /** The quick definition (lib/protocols/quick.ts `QuickRules`); `module` names the P4 rule module. */
    rules: jsonb("rules").notNull(),
    /** The P4 engine's named numbers (empty until P4). */
    seed: jsonb("seed")
      .notNull()
      .default(sql`'{}'::jsonb`),
    slotMinutes: integer("slot_minutes").notNull(),
    slotCount: integer("slot_count").notNull(),
    source: text("source").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => authUsers.id, {
      onDelete: "restrict",
    }),
    signer1UserId: uuid("signer1_user_id").references(() => authUsers.id, { onDelete: "restrict" }),
    signer1Role: text("signer1_role"),
    signer1At: timestamp("signer1_at", { withTimezone: true }),
    signer2UserId: uuid("signer2_user_id").references(() => authUsers.id, { onDelete: "restrict" }),
    signer2Role: text("signer2_role"),
    signer2At: timestamp("signer2_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
  },
  (t) => [
    check("protocol_versions_version_check", sql`${t.version} >= 1`),
    check("protocol_versions_status_check", sql`${t.status} IN ('draft','signed')`),
    check("protocol_versions_rules_check", sql`jsonb_typeof(${t.rules}) = 'object'`),
    check("protocol_versions_seed_check", sql`jsonb_typeof(${t.seed}) = 'object'`),
    check("protocol_versions_slot_minutes_check", sql`${t.slotMinutes} BETWEEN 1 AND 1440`),
    check("protocol_versions_slot_count_check", sql`${t.slotCount} BETWEEN 1 AND 200`),
    check(
      "protocol_versions_seed_draft",
      sql`${t.hospitalId} IS NOT NULL OR ${t.status} = 'draft'`,
    ),
    check(
      "protocol_versions_signers_distinct",
      sql`${t.signer2UserId} IS NULL OR ${t.signer2UserId} <> ${t.signer1UserId}`,
    ),
    check(
      "protocol_versions_signer_order",
      sql`${t.signer2UserId} IS NULL OR ${t.signer1UserId} IS NOT NULL`,
    ),
  ],
);

/**
 * Protocol charts (prescribing kit P4, F7; migration 0283, GATED). A running protocol for one
 * patient. The events are the record; `endedAt` / `endReason` / `reopenedAt` mirror the latest end or
 * reopen event for the "running" lists. A chart starts only from a signed version (trigger), except
 * where the server marks the transaction for local development (`canStart`).
 */
export const protocolCharts = pgTable(
  "protocol_charts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    encounterId: uuid("encounter_id").references(() => encounters.id, { onDelete: "restrict" }),
    protocolId: text("protocol_id")
      .notNull()
      .references(() => protocols.id, { onDelete: "restrict" }),
    protocolVersionId: uuid("protocol_version_id")
      .notNull()
      .references(() => protocolVersions.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    startedByUserId: uuid("started_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    clientKey: text("client_key"),
  },
  (t) => [
    check(
      "protocol_charts_end_reason_check",
      sql`${t.endReason} IS NULL OR length(${t.endReason}) BETWEEN 2 AND 300`,
    ),
    check("protocol_charts_end_whole", sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`),
    uniqueIndex("protocol_charts_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
    uniqueIndex("protocol_charts_one_running")
      .on(t.patientUserId, t.protocolId)
      .where(sql`${t.endedAt} IS NULL`),
    index("protocol_charts_running")
      .on(t.hospitalId, t.startedAt)
      .where(sql`${t.endedAt} IS NULL`),
  ],
);

/** What was done on a chart: append-only (trigger); a mistake is a `reverse` event with a reason. */
export const protocolChartEvents = pgTable(
  "protocol_chart_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartId: uuid("chart_id")
      .notNull()
      .references(() => protocolCharts.id, { onDelete: "restrict" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    protocolVersionId: uuid("protocol_version_id")
      .notNull()
      .references(() => protocolVersions.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    actorRole: text("actor_role").notNull(),
    actorCadre: text("actor_cadre").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    reversesId: uuid("reverses_id"),
    reason: text("reason"),
    clientKey: text("client_key"),
  },
  (t) => [
    check(
      "protocol_chart_events_type_check",
      sql`${t.type} IN ('start','end','reopen','mark','give','set','toggle','inv','value','weight','iv','order','send','slot','vitals','param_add','param_remove','note','reverse')`,
    ),
    check("protocol_chart_events_payload_check", sql`jsonb_typeof(${t.payload}) = 'object'`),
    check("protocol_chart_events_actor_role_check", sql`${t.actorRole} IN ('dr','rn','ph')`),
    check(
      "protocol_chart_events_reverse_shape",
      sql`(${t.type} = 'reverse') = (${t.reversesId} IS NOT NULL) AND (${t.type} <> 'reverse' OR length(btrim(coalesce(${t.reason}, ''))) >= 3)`,
    ),
    index("protocol_chart_events_chart").on(t.chartId, t.at),
    uniqueIndex("protocol_chart_events_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
    uniqueIndex("protocol_chart_events_reversed_once")
      .on(t.reversesId)
      .where(sql`${t.reversesId} IS NOT NULL`),
  ],
);
