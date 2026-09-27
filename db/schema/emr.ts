import type { AnyPgColumn, ExtraConfigColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUsers } from "./_auth";
import { clinicalCosignRequests } from "./doctor-workspace";
import { encounterOrders } from "./encounter";
import { hospitals } from "./hospitals";
import { clinicalObservations } from "./nurse-workspace";
import { encounters } from "./scheduling";
import { symptomCatalog } from "./symptom-catalog";

/**
 * EMR record spine — migration 0071 (GATED). docs/emr/gate-a-proposal.md §A, HARMONISATION.md §3.
 *
 *   Registries (config: mutable, audited): clinical_concepts, drug_class_tags, capabilities,
 *     facility_capabilities, devices, test_catalogue, diagnosis_terms
 *   Clinical (insert-only unless stated): clinical_notes (drafts mutable), clinical_note_events,
 *     encounter_order_events, specimens, specimen_events, diagnostic_reports, conditions,
 *     medication_statements, pregnancy_episodes, procedures, allergies, allergy_status_assertions,
 *     result_acknowledgements, critical_result_communications
 *
 * Evolved tables live in their own files (encounters, clinical_observations, encounter_orders,
 * clinical_cosign_requests). The SQL is the source of truth for what Drizzle cannot say: the guard
 * and no-mutation triggers, RLS (FORCED; a SELECT policy for medsync_clinical_reader only), the
 * *_current views and the private access functions. Writes run as the owner in lib/emr/write/*,
 * after private.patient_access_basis(); reads go through lib/emr/db.ts asClinicalReader.
 */

const tz = { withTimezone: true } as const;
const SENSITIVITY = sql`('standard','restricted')`;

/* ─── Registries ─────────────────────────────────────────────────── */
export const clinicalConcepts = pgTable(
  "clinical_concepts",
  {
    /** 'obs.glucose' */
    id: text("id").primaryKey(),
    display: text("display").notNull(),
    kind: text("kind").notNull(),
    conceptGroup: text("concept_group").notNull(),
    valueType: text("value_type").notNull(),
    canonicalUnit: text("canonical_unit"),
    acceptedUnits: jsonb("accepted_units").notNull().default([]),
    answers: text("answers").array(),
    contextRequired: text("context_required")
      .array()
      .notNull()
      .default(sql`'{}'`),
    contextConditional: jsonb("context_conditional").notNull().default({}),
    contextOptional: text("context_optional")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** [{system, code, status, …}]; a 'candidate' code is never exported. */
    codes: jsonb("codes").notNull().default([]),
    lanes: text("lanes")
      .array()
      .notNull()
      .default(sql`'{}'`),
    sensitivity: text("sensitivity").notNull().default("standard"),
    /** SR-PREG-MINOR */
    sensitivityRule: jsonb("sensitivity_rule"),
    /** D-CFC-11 [H]: a finding token that is also a clinician symptom has one identity. */
    symptomCode: text("symptom_code").references(() => symptomCatalog.code, {
      onDelete: "restrict",
    }),
    phase: text("phase").notNull(),
    catalogueVersion: text("catalogue_version").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "clinical_concepts_kind_check",
      sql`${t.kind} IN ('observation','finding','condition','medication','pregnancy','procedure','demographic','context','allergy')`,
    ),
    check(
      "clinical_concepts_value_type_check",
      sql`${t.valueType} IN ('quantity','coded','ordinal','boolean','presence','condition','procedure','date','as_typed')`,
    ),
    check("clinical_concepts_sensitivity_check", sql`${t.sensitivity} IN ${SENSITIVITY}`),
    uniqueIndex("clinical_concepts_symptom_code_uidx")
      .on(t.symptomCode)
      .where(sql`${t.symptomCode} IS NOT NULL`),
  ],
);

export const drugClassTags = pgTable(
  "drug_class_tags",
  {
    id: text("id").primaryKey(),
    display: text("display").notNull(),
    atc: jsonb("atc").notNull().default([]),
    lanes: text("lanes")
      .array()
      .notNull()
      .default(sql`'{}'`),
    sensitivity: text("sensitivity").notNull().default("standard"),
    note: text("note"),
    catalogueVersion: text("catalogue_version").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [check("drug_class_tags_sensitivity_check", sql`${t.sensitivity} IN ${SENSITIVITY}`)],
);

export const capabilities = pgTable("capabilities", {
  id: text("id").primaryKey(),
  display: text("display").notNull(),
  catalogueVersion: text("catalogue_version").notNull(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

export const facilityCapabilities = pgTable(
  "facility_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capabilities.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    updatedByUserId: uuid("updated_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "facility_capabilities_status_check",
      sql`${t.status} IN ('available','intermittent','unavailable')`,
    ),
    unique("facility_capabilities_hospital_id_capability_id_key").on(t.hospitalId, t.capabilityId),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    serial: text("serial"),
    calibration: text("calibration"),
    /** Manufacturer HI/LO per analyte: device data, not a clinical threshold. */
    measuringLimits: jsonb("measuring_limits").notNull().default({}),
    validated: boolean("validated").notNull().default(false),
    active: boolean("active").notNull().default(true),
    calibratedOn: date("calibrated_on"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "devices_kind_check",
      sql`${t.kind} IN ('glucometer','ketone_meter','hba1c_analyser','bp_monitor')`,
    ),
    check(
      "devices_calibration_check",
      sql`${t.calibration} IS NULL OR ${t.calibration} IN ('plasma_equivalent','whole_blood','unknown')`,
    ),
    unique("devices_hospital_id_kind_serial_key").on(t.hospitalId, t.kind, t.serial),
  ],
);

export const testCatalogue = pgTable(
  "test_catalogue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** NULL = the default menu. */
    hospitalId: uuid("hospital_id").references(() => hospitals.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    display: text("display").notNull(),
    kind: text("kind").notNull(),
    /** clinical_concepts ids; more than one = a panel (seed-validated). */
    components: text("components")
      .array()
      .notNull()
      .default(sql`'{}'`),
    specimenType: text("specimen_type"),
    container: text("container"),
    fastingRequired: boolean("fasting_required").notNull().default(false),
    /** D-EMR-12 pregnancy prompt. */
    ionising: boolean("ionising").notNull().default(false),
    /** {conceptId: unit} */
    defaultUnits: jsonb("default_units").notNull().default({}),
    inHouse: boolean("in_house").notNull().default(true),
    capabilityId: text("capability_id").references(() => capabilities.id, { onDelete: "restrict" }),
    /** Operational target, not a clinical number. */
    turnaroundTargetMinutes: integer("turnaround_target_minutes"),
    favouriteRank: integer("favourite_rank"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("test_catalogue_kind_check", sql`${t.kind} IN ('lab','imaging','ecg','procedure')`),
    check("test_catalogue_turnaround_target_minutes_check", sql`${t.turnaroundTargetMinutes} > 0`),
    uniqueIndex("test_catalogue_code_uidx").on(
      sql`coalesce(${t.hospitalId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.code,
    ),
  ],
);

export const diagnosisTerms = pgTable(
  "diagnosis_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    display: text("display").notNull(),
    synonyms: text("synonyms")
      .array()
      .notNull()
      .default(sql`'{}'`),
    icd11Code: text("icd11_code"),
    /** Always null until the WHO licence is recorded (R9/E6, O-3). */
    icd10WhoCode: text("icd10_who_code"),
    cielId: text("ciel_id"),
    conceptId: text("concept_id").references(() => clinicalConcepts.id, { onDelete: "restrict" }),
    chronic: boolean("chronic").notNull().default(false),
    /** "fever, cause not yet known" */
    symptomLevel: boolean("symptom_level").notNull().default(false),
    /** null until REF-HMIS-MAP / REF-IDSR-CLASSES are signed. */
    hmisCategoryId: text("hmis_category_id"),
    idsrClass: text("idsr_class"),
    sensitivity: text("sensitivity").notNull().default("standard"),
    status: text("status").notNull().default("draft"),
    source: text("source").notNull(),
    verifiedOn: date("verified_on"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("diagnosis_terms_icd10_unlicensed", sql`${t.icd10WhoCode} IS NULL`),
    check("diagnosis_terms_sensitivity_check", sql`${t.sensitivity} IN ${SENSITIVITY}`),
    check("diagnosis_terms_status_check", sql`${t.status} IN ('draft','cso_signed')`),
  ],
);

/* ─── Fact envelope (CFC §3): the shared columns of every versioned fact table ─ */
// Version 1 carries logical_id = its own id; a correction is a new row with version + 1 and
// supersedes_id = the row it replaces. Nothing is updated or deleted (trigger).
function factEnvelope(self: () => AnyPgColumn) {
  return {
    id: uuid("id").primaryKey().defaultRandom(),
    logicalId: uuid("logical_id").notNull(),
    version: integer("version").notNull().default(1),
    supersedesId: uuid("supersedes_id").references(self, { onDelete: "restrict" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    encounterId: uuid("encounter_id").references(() => encounters.id, { onDelete: "restrict" }),
    effectiveAt: timestamp("effective_at", tz).notNull(),
    recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    authorCadre: text("author_cadre"),
    source: text("source").notNull(),
    trust: smallint("trust").notNull(),
    status: text("status").notNull().default("final"),
    sensitivity: text("sensitivity").notNull().default("standard"),
    reasonCode: text("reason_code"),
    reasonCiphertext: text("reason_ciphertext"),
    clientKey: text("client_key"),
  };
}

type EnvelopeCols = Record<
  | "logicalId"
  | "version"
  | "supersedesId"
  | "patientUserId"
  | "hospitalId"
  | "effectiveAt"
  | "recordedAt"
  | "source"
  | "trust"
  | "status"
  | "sensitivity"
  | "reasonCode"
  | "reasonCiphertext"
  | "clientKey",
  ExtraConfigColumn
>;

function factEnvelopeExtras(name: string, t: EnvelopeCols) {
  return [
    check(`${name}_version_check`, sql`${t.version} >= 1`),
    check(
      `${name}_source_check`,
      sql`${t.source} IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')`,
    ),
    check(`${name}_trust_check`, sql`${t.trust} BETWEEN 1 AND 4`),
    check(
      `${name}_status_check`,
      sql`${t.status} IN ('preliminary','final','amended','corrected','entered_in_error','cancelled')`,
    ),
    check(`${name}_sensitivity_check`, sql`${t.sensitivity} IN ${SENSITIVITY}`),
    check(`${name}_version_chain`, sql`(${t.version} = 1) = (${t.supersedesId} IS NULL)`),
    check(
      `${name}_eie_reason`,
      sql`${t.status} <> 'entered_in_error' OR ${t.reasonCode} IS NOT NULL OR ${t.reasonCiphertext} IS NOT NULL`,
    ),
    uniqueIndex(`${name}_logical_version`).on(t.logicalId, t.version),
    uniqueIndex(`${name}_client_key`)
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
    index(`${name}_supersedes`)
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} IS NOT NULL`),
    index(`${name}_patient_time`).on(t.patientUserId, t.effectiveAt.desc()),
    index(`${name}_hospital_time`).on(t.hospitalId, t.recordedAt.desc()),
  ];
}

/* ─── Notes ──────────────────────────────────────────────────────── */
/** Per-author drafts (mutable, encrypted, revision-checked); signing is the last mutation. */
export const clinicalNotes = pgTable(
  "clinical_notes",
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
    noteType: text("note_type").notNull(),
    /** data/emr/note-templates.v1.json */
    templateId: text("template_id").notNull(),
    templateVersion: text("template_version").notNull(),
    state: text("state").notNull().default("draft"),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    authorCadre: text("author_cadre").notNull(),
    addendumTo: uuid("addendum_to").references((): AnyPgColumn => clinicalNotes.id, {
      onDelete: "restrict",
    }),
    /** Sections JSON (narrative + structured payload), lib/encryption.ts wire format. */
    contentCiphertext: text("content_ciphertext").notNull(),
    /** Autosave optimistic check. */
    revision: integer("revision").notNull().default(0),
    /** E10: HMAC-SHA-256 over the canonical composition. */
    contentHmac: text("content_hmac"),
    hmacKeyId: text("hmac_key_id"),
    signedAt: timestamp("signed_at", tz),
    effectiveAt: timestamp("effective_at", tz).notNull(),
    recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
    lateEntry: boolean("late_entry").notNull().default(false),
    sensitivity: text("sensitivity").notNull().default("standard"),
    clientKey: text("client_key"),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "clinical_notes_note_type_check",
      sql`${t.noteType} IN ('clerking','emergency_clerking','progress','ward_round','procedure','handover','referral','nursing','addendum','cause_of_death','medico_legal')`,
    ),
    check("clinical_notes_state_check", sql`${t.state} IN ('draft','signed')`),
    check("clinical_notes_sensitivity_check", sql`${t.sensitivity} IN ${SENSITIVITY}`),
    check(
      "clinical_notes_signed_shape",
      sql`(${t.state} = 'signed') = (${t.signedAt} IS NOT NULL AND ${t.contentHmac} IS NOT NULL AND ${t.hmacKeyId} IS NOT NULL)`,
    ),
    check(
      "clinical_notes_addendum_shape",
      sql`(${t.noteType} = 'addendum') = (${t.addendumTo} IS NOT NULL)`,
    ),
    uniqueIndex("clinical_notes_one_draft")
      .on(t.encounterId, t.authorUserId, t.noteType)
      .where(sql`${t.state} = 'draft' AND ${t.addendumTo} IS NULL`),
    uniqueIndex("clinical_notes_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
    index("clinical_notes_patient_time").on(t.patientUserId, t.effectiveAt.desc()),
    index("clinical_notes_encounter").on(t.encounterId, t.state),
    index("clinical_notes_addendum")
      .on(t.addendumTo)
      .where(sql`${t.addendumTo} IS NOT NULL`),
    index("clinical_notes_hospital_time").on(t.hospitalId, t.recordedAt.desc()),
  ],
);

export const clinicalNoteEvents = pgTable(
  "clinical_note_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => clinicalNotes.id, { onDelete: "restrict" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    actorCadre: text("actor_cadre").notNull(),
    cosignRequestId: uuid("cosign_request_id").references(() => clinicalCosignRequests.id, {
      onDelete: "restrict",
    }),
    /** The addendum. */
    relatedNoteId: uuid("related_note_id").references(() => clinicalNotes.id, {
      onDelete: "restrict",
    }),
    reasonCode: text("reason_code"),
    reasonCiphertext: text("reason_ciphertext"),
    recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
    clientKey: text("client_key"),
  },
  (t) => [
    check(
      "clinical_note_events_kind_check",
      sql`${t.kind} IN ('cosign_requested','cosigned','addendum_added','entered_in_error')`,
    ),
    check(
      "cne_eie_reason",
      sql`${t.kind} <> 'entered_in_error' OR ${t.reasonCode} IS NOT NULL OR ${t.reasonCiphertext} IS NOT NULL`,
    ),
    check("cne_addendum", sql`${t.kind} <> 'addendum_added' OR ${t.relatedNoteId} IS NOT NULL`),
    check(
      "cne_cosign_link",
      sql`${t.kind} NOT IN ('cosign_requested','cosigned') OR ${t.cosignRequestId} IS NOT NULL`,
    ),
    index("clinical_note_events_note").on(t.noteId, t.recordedAt),
    uniqueIndex("clinical_note_events_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);

/* ─── Orders, specimens, reports ─────────────────────────────────── */
export const encounterOrderEvents = pgTable(
  "encounter_order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => encounterOrders.id, { onDelete: "restrict" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    actorCadre: text("actor_cadre").notNull(),
    reasonCode: text("reason_code"),
    reasonCiphertext: text("reason_ciphertext"),
    recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
    clientKey: text("client_key"),
  },
  (t) => [
    check(
      "encounter_order_events_kind_check",
      sql`${t.kind} IN ('proposed','placed','dismissed','cancelled','on_hold','resumed')`,
    ),
    check(
      "eoe_reason",
      sql`${t.kind} NOT IN ('dismissed','cancelled','on_hold') OR ${t.reasonCode} IS NOT NULL OR ${t.reasonCiphertext} IS NOT NULL`,
    ),
    index("encounter_order_events_order").on(t.orderId, t.recordedAt),
    uniqueIndex("encounter_order_events_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);

export const specimens = pgTable(
  "specimens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => encounterOrders.id, { onDelete: "restrict" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    specimenType: text("specimen_type").notNull(),
    container: text("container").notNull(),
    collectedAt: timestamp("collected_at", tz).notNull(),
    collectedByUserId: uuid("collected_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    collectorCadre: text("collector_cadre").notNull(),
    /** The writer requires it when the test is fasting_required. */
    fastingState: text("fasting_state"),
    fastingHours: numeric("fasting_hours"),
    /** Two identifiers, confirmed at the bedside. */
    identifiersConfirmed: boolean("identifiers_confirmed").notNull(),
    labelNo: text("label_no"),
    recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
    clientKey: text("client_key"),
  },
  (t) => [
    check(
      "specimens_specimen_type_check",
      sql`${t.specimenType} IN ('venous_plasma','venous_serum','venous_whole_blood','capillary_whole_blood','arterial_blood','urine_spot','urine_first_morning','urine_24h','interstitial_fluid','unknown')`,
    ),
    check(
      "specimens_container_check",
      sql`${t.container} IN ('fluoride_oxalate','serum_plain','lithium_heparin','edta','capillary_direct','unknown')`,
    ),
    check(
      "specimens_fasting_state_check",
      sql`${t.fastingState} IS NULL OR ${t.fastingState} IN ('fasting','non_fasting','unknown')`,
    ),
    check(
      "specimens_fasting_hours_check",
      sql`${t.fastingHours} IS NULL OR ${t.fastingHours} >= 0`,
    ),
    check("specimens_identifiers_confirmed_check", sql`${t.identifiersConfirmed}`),
    index("specimens_order").on(t.orderId),
    uniqueIndex("specimens_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);

export const specimenEvents = pgTable(
  "specimen_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specimenId: uuid("specimen_id")
      .notNull()
      .references(() => specimens.id, { onDelete: "restrict" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    reasonCode: text("reason_code"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    actorCadre: text("actor_cadre").notNull(),
    recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
    clientKey: text("client_key"),
  },
  (t) => [
    check("specimen_events_kind_check", sql`${t.kind} IN ('received','rejected')`),
    check(
      "specimen_events_reason_code_check",
      sql`${t.reasonCode} IS NULL OR ${t.reasonCode} IN ('haemolysed','clotted','insufficient','unlabelled_or_mislabelled','wrong_container','delayed')`,
    ),
    check("se_reject_reason", sql`(${t.kind} = 'rejected') = (${t.reasonCode} IS NOT NULL)`),
    index("specimen_events_specimen").on(t.specimenId, t.recordedAt),
    uniqueIndex("specimen_events_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);

/** Versioned: release, amendment and correction are new rows. Result values are
 *  clinical_observations rows with report_id. */
export const diagnosticReports = pgTable(
  "diagnostic_reports",
  {
    ...factEnvelope((): AnyPgColumn => diagnosticReports.id),
    orderId: uuid("order_id").references(() => encounterOrders.id, { onDelete: "restrict" }),
    specimenId: uuid("specimen_id").references(() => specimens.id, { onDelete: "restrict" }),
    testId: uuid("test_id").references(() => testCatalogue.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    issuedAt: timestamp("issued_at", tz).notNull(),
    performer: text("performer").notNull(),
    performerLabName: text("performer_lab_name"),
    /** 'interface' is reserved. */
    entryMode: text("entry_mode").notNull(),
    enteredByUserId: uuid("entered_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    verifiedByUserId: uuid("verified_by_user_id").references(() => authUsers.id, {
      onDelete: "restrict",
    }),
    conclusionCode: text("conclusion_code"),
    conclusionCiphertext: text("conclusion_ciphertext"),
    /** Signed REF-CRIT-* entries only; none signed yet. */
    critical: boolean("critical").notNull().default(false),
    uncatalogued: boolean("uncatalogued").notNull().default(false),
  },
  (t) => [
    ...factEnvelopeExtras("diagnostic_reports", t),
    check("diagnostic_reports_kind_check", sql`${t.kind} IN ('lab','imaging','ecg')`),
    check("diagnostic_reports_performer_check", sql`${t.performer} IN ('in_house','external')`),
    check(
      "diagnostic_reports_entry_mode_check",
      sql`${t.entryMode} IN ('direct','transcribed','interface')`,
    ),
    check(
      "diagnostic_reports_conclusion_code_check",
      sql`${t.conclusionCode} IS NULL OR ${t.conclusionCode} IN ('normal','abnormal','indeterminate')`,
    ),
    check(
      "dr_order_or_transcribed",
      sql`${t.orderId} IS NOT NULL OR ${t.entryMode} = 'transcribed'`,
    ),
    check(
      "dr_conclusion",
      sql`${t.kind} = 'lab' OR ${t.status} = 'preliminary' OR ${t.conclusionCode} IS NOT NULL`,
    ),
    check(
      "dr_transcribed_trust",
      sql`${t.entryMode} <> 'transcribed' OR ${t.verifiedByUserId} IS NOT NULL OR ${t.trust} <= 3`,
    ),
    index("diagnostic_reports_order")
      .on(t.orderId)
      .where(sql`${t.orderId} IS NOT NULL`),
  ],
);

/* ─── Conditions, medicines, pregnancy, procedures ───────────────── */
export const conditions = pgTable(
  "conditions",
  {
    ...factEnvelope((): AnyPgColumn => conditions.id),
    category: text("category").notNull(),
    /** Family history is a condition with a relation other than self. */
    subjectRelation: text("subject_relation").notNull().default("self"),
    termId: uuid("term_id").references(() => diagnosisTerms.id, { onDelete: "restrict" }),
    conceptId: text("concept_id").references(() => clinicalConcepts.id, { onDelete: "restrict" }),
    /** Uncoded term: shown, never HMIS-counted or engine-read. */
    textCiphertext: text("text_ciphertext"),
    rank: text("rank"),
    clinicalStatus: text("clinical_status").notNull(),
    verification: text("verification").notNull(),
    assertedBy: text("asserted_by").notNull(),
    onset: jsonb("onset"),
    abatementAt: timestamp("abatement_at", tz),
    stage: jsonb("stage"),
    icd11Code: text("icd11_code"),
    icd10WhoCode: text("icd10_who_code"),
    cielId: text("ciel_id"),
    hmisCategoryId: text("hmis_category_id"),
    idsrClass: text("idsr_class"),
  },
  (t) => [
    ...factEnvelopeExtras("conditions", t),
    check(
      "conditions_category_check",
      sql`${t.category} IN ('problem_list_item','encounter_diagnosis')`,
    ),
    check(
      "conditions_subject_relation_check",
      sql`${t.subjectRelation} IN ('self','mother','father','sibling','child','other_first_degree','second_degree')`,
    ),
    check("conditions_rank_check", sql`${t.rank} IS NULL OR ${t.rank} IN ('primary','secondary')`),
    check(
      "conditions_clinical_status_check",
      sql`${t.clinicalStatus} IN ('active','recurrence','relapse','inactive','remission','resolved')`,
    ),
    check(
      "conditions_verification_check",
      sql`${t.verification} IN ('unconfirmed','provisional','differential','confirmed','refuted')`,
    ),
    check(
      "conditions_asserted_by_check",
      sql`${t.assertedBy} IN ('clinician','patient_reported','referral_document','engine_proposal_accepted')`,
    ),
    check("conditions_icd10_who_code_check", sql`${t.icd10WhoCode} IS NULL`),
    check("cond_term_or_text", sql`${t.termId} IS NOT NULL OR ${t.textCiphertext} IS NOT NULL`),
    check("cond_rank_dx_only", sql`${t.rank} IS NULL OR ${t.category} = 'encounter_diagnosis'`),
    check(
      "cond_dx_encounter",
      sql`${t.category} <> 'encounter_diagnosis' OR ${t.encounterId} IS NOT NULL`,
    ),
    check(
      "cond_resolve_reason",
      sql`(${t.clinicalStatus} <> 'resolved' AND ${t.verification} <> 'refuted') OR ${t.reasonCode} IS NOT NULL OR ${t.reasonCiphertext} IS NOT NULL`,
    ),
  ],
);

export const medicationStatements = pgTable(
  "medication_statements",
  {
    ...factEnvelope((): AnyPgColumn => medicationStatements.id),
    /** lib/prescribing formulary drugKey where known. */
    drugCode: text("drug_code"),
    /** As typed (herbal, OTC, unlisted). */
    drugTextCiphertext: text("drug_text_ciphertext"),
    productKind: text("product_kind").notNull().default("medicine"),
    /** drug_class_tags ids; a restricted tag makes the row restricted. */
    classTags: text("class_tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    atcCode: text("atc_code"),
    medicationStatus: text("medication_status").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    route: text("route"),
    medicationSource: text("medication_source").notNull(),
    reconciliation: text("reconciliation"),
  },
  (t) => [
    ...factEnvelopeExtras("medication_statements", t),
    check(
      "medication_statements_product_kind_check",
      sql`${t.productKind} IN ('medicine','otc','herbal_traditional')`,
    ),
    check(
      "medication_statements_medication_status_check",
      sql`${t.medicationStatus} IN ('active','completed','stopped','on_hold','intended','unknown')`,
    ),
    check(
      "medication_statements_route_check",
      sql`${t.route} IS NULL OR ${t.route} IN ('oral','iv','im','sc','inhaled','topical','other')`,
    ),
    check(
      "medication_statements_medication_source_check",
      sql`${t.medicationSource} IN ('prescribed_here','dispensed_here','patient_reported','external_record')`,
    ),
    check(
      "medication_statements_reconciliation_check",
      sql`${t.reconciliation} IS NULL OR ${t.reconciliation} IN ('continued','stopped','changed')`,
    ),
    check("ms_drug", sql`${t.drugCode} IS NOT NULL OR ${t.drugTextCiphertext} IS NOT NULL`),
    check(
      "ms_stop_reason",
      sql`${t.reconciliation} IS DISTINCT FROM 'stopped' OR ${t.reasonCode} IS NOT NULL OR ${t.reasonCiphertext} IS NOT NULL`,
    ),
  ],
);

/** logical_id = the episode. Gestational age is derived, never stored. */
export const pregnancyEpisodes = pgTable(
  "pregnancy_episodes",
  {
    ...factEnvelope((): AnyPgColumn => pregnancyEpisodes.id),
    pregnancyState: text("pregnancy_state").notNull(),
    lnmp: date("lnmp"),
    lnmpCertainty: text("lnmp_certainty"),
    edd: date("edd"),
    eddBasis: text("edd_basis"),
    testObservationId: uuid("test_observation_id").references(() => clinicalObservations.id, {
      onDelete: "restrict",
    }),
    gravida: smallint("gravida"),
    parity: smallint("parity"),
    deliveredAt: timestamp("delivered_at", tz),
    outcome: text("outcome"),
    birthWeightGrams: integer("birth_weight_grams"),
    hyperglycaemia: boolean("hyperglycaemia"),
  },
  (t) => [
    ...factEnvelopeExtras("pregnancy_episodes", t),
    check(
      "pregnancy_episodes_pregnancy_state_check",
      sql`${t.pregnancyState} IN ('pregnant','postpartum','not_pregnant','unknown')`,
    ),
    check(
      "pregnancy_episodes_lnmp_certainty_check",
      sql`${t.lnmpCertainty} IS NULL OR ${t.lnmpCertainty} IN ('sure','unsure')`,
    ),
    check(
      "pregnancy_episodes_edd_basis_check",
      sql`${t.eddBasis} IS NULL OR ${t.eddBasis} IN ('lmp','ultrasound','fundal_height','unknown')`,
    ),
    check("pregnancy_episodes_gravida_check", sql`${t.gravida} >= 0`),
    check("pregnancy_episodes_parity_check", sql`${t.parity} >= 0`),
    check(
      "pregnancy_episodes_outcome_check",
      sql`${t.outcome} IS NULL OR ${t.outcome} IN ('live_birth','stillbirth','miscarriage','termination','ectopic','unknown')`,
    ),
    check("pregnancy_episodes_birth_weight_grams_check", sql`${t.birthWeightGrams} > 0`),
  ],
);

export const procedures = pgTable(
  "procedures",
  {
    ...factEnvelope((): AnyPgColumn => procedures.id),
    conceptId: text("concept_id").references(() => clinicalConcepts.id, { onDelete: "restrict" }),
    textCiphertext: text("text_ciphertext"),
    outcome: text("outcome").notNull(),
    laterality: text("laterality"),
    noteId: uuid("note_id").references(() => clinicalNotes.id, { onDelete: "restrict" }),
  },
  (t) => [
    ...factEnvelopeExtras("procedures", t),
    check(
      "procedures_outcome_check",
      sql`${t.outcome} IN ('completed','not_done','declined','unable')`,
    ),
    check(
      "procedures_laterality_check",
      sql`${t.laterality} IS NULL OR ${t.laterality} IN ('left','right','bilateral')`,
    ),
    check(
      "proc_concept_or_text",
      sql`${t.conceptId} IS NOT NULL OR ${t.textCiphertext} IS NOT NULL`,
    ),
  ],
);

/* ─── Allergies ──────────────────────────────────────────────────── */
/** Readable across hospitals by a reader with a basis at their own hospital (STOP 1);
 *  hospital_id is where it was recorded. */
export const allergies = pgTable(
  "allergies",
  {
    ...factEnvelope((): AnyPgColumn => allergies.id),
    // Nullable here only: backfilled rows (legacy_ref) may have no named recorder.
    recordedByUserId: uuid("recorded_by_user_id").references(() => authUsers.id, {
      onDelete: "restrict",
    }),
    substanceKind: text("substance_kind"),
    /** Formulary drugKey / drugClass (lib/prescribing) [H]. */
    substanceCode: text("substance_code"),
    /** As typed; still name-matched by prescribing [H]. */
    substanceTextCiphertext: text("substance_text_ciphertext"),
    category: text("category"),
    allergyType: text("allergy_type"),
    criticality: text("criticality"),
    manifestations: text("manifestations")
      .array()
      .notNull()
      .default(sql`'{}'`),
    severity: text("severity"),
    clinicalStatus: text("clinical_status").notNull().default("active"),
    verification: text("verification").notNull().default("unconfirmed"),
    onset: jsonb("onset"),
    informant: text("informant").notNull(),
    /** {table, id[, index]}: backfilled rows only. */
    legacyRef: jsonb("legacy_ref"),
  },
  (t) => [
    ...factEnvelopeExtras("allergies", t),
    check(
      "allergies_substance_kind_check",
      sql`${t.substanceKind} IS NULL OR ${t.substanceKind} IN ('drug_ingredient','drug_class','food','environmental','other')`,
    ),
    check(
      "allergies_category_check",
      sql`${t.category} IS NULL OR ${t.category} IN ('medication','food','environment','biologic')`,
    ),
    check(
      "allergies_allergy_type_check",
      sql`${t.allergyType} IS NULL OR ${t.allergyType} IN ('allergy','intolerance')`,
    ),
    check(
      "allergies_criticality_check",
      sql`${t.criticality} IS NULL OR ${t.criticality} IN ('low','high','unable_to_assess')`,
    ),
    check(
      "allergies_manifestations_check",
      sql`${t.manifestations} <@ ARRAY['rash','urticaria','angioedema','anaphylaxis','bronchospasm','sjs_ten','other']::text[]`,
    ),
    check(
      "allergies_severity_check",
      sql`${t.severity} IS NULL OR ${t.severity} IN ('mild','moderate','severe')`,
    ),
    check(
      "allergies_clinical_status_check",
      sql`${t.clinicalStatus} IN ('active','inactive','resolved')`,
    ),
    check(
      "allergies_verification_check",
      sql`${t.verification} IN ('unconfirmed','confirmed','refuted')`,
    ),
    check(
      "allergies_informant_check",
      sql`${t.informant} IN ('patient','relative','record','clinician_observed','resus_ample_migration')`,
    ),
    check(
      "allergies_substance",
      sql`${t.substanceCode} IS NOT NULL OR ${t.substanceTextCiphertext} IS NOT NULL OR ${t.legacyRef} IS NOT NULL`,
    ),
    check("allergies_kind_code", sql`(${t.substanceCode} IS NULL) = (${t.substanceKind} IS NULL)`),
    check(
      "allergies_refute",
      sql`${t.verification} <> 'refuted' OR ${t.reasonCode} IS NOT NULL OR ${t.reasonCiphertext} IS NOT NULL`,
    ),
    check("allergies_author", sql`${t.recordedByUserId} IS NOT NULL OR ${t.legacyRef} IS NOT NULL`),
    uniqueIndex("allergies_legacy_ref_uidx")
      .on(
        sql`(${t.legacyRef}->>'table')`,
        sql`(${t.legacyRef}->>'id')`,
        sql`(coalesce(${t.legacyRef}->>'index', ''))`,
      )
      .where(sql`${t.legacyRef} IS NOT NULL AND ${t.version} = 1`),
  ],
);

/** NKDA / unable to assess. Insert-only; the newest non-voided row is current, and an active
 *  allergy always outranks it. */
export const allergyStatusAssertions = pgTable(
  "allergy_status_assertions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    encounterId: uuid("encounter_id").references(() => encounters.id, { onDelete: "restrict" }),
    assertion: text("assertion").notNull(),
    assertedByUserId: uuid("asserted_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    asserterCadre: text("asserter_cadre"),
    /** Clinical time. */
    assertedAt: timestamp("asserted_at", tz).notNull(),
    recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
    source: text("source").notNull().default("clinician"),
    status: text("status").notNull().default("final"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => allergyStatusAssertions.id, {
      onDelete: "restrict",
    }),
    reasonCode: text("reason_code"),
    reasonCiphertext: text("reason_ciphertext"),
    legacyRef: jsonb("legacy_ref"),
    clientKey: text("client_key"),
  },
  (t) => [
    check(
      "allergy_status_assertions_assertion_check",
      sql`${t.assertion} IN ('no_known_drug_allergies','unable_to_assess')`,
    ),
    check(
      "allergy_status_assertions_source_check",
      sql`${t.source} IN ('clinician','resus_ample_migration')`,
    ),
    check(
      "allergy_status_assertions_status_check",
      sql`${t.status} IN ('final','entered_in_error')`,
    ),
    check(
      "asa_eie",
      sql`${t.status} <> 'entered_in_error' OR (${t.supersedesId} IS NOT NULL AND (${t.reasonCode} IS NOT NULL OR ${t.reasonCiphertext} IS NOT NULL))`,
    ),
    uniqueIndex("asa_legacy_ref_uidx")
      .on(sql`(${t.legacyRef}->>'table')`, sql`(${t.legacyRef}->>'id')`)
      .where(sql`${t.legacyRef} IS NOT NULL`),
    index("asa_patient_time").on(t.patientUserId, t.assertedAt.desc()),
    uniqueIndex("asa_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);

/* ─── Acknowledgement and critical communication ─────────────────── */
/** Per report VERSION: an amended report needs a fresh acknowledgement (D-EMR-07). */
export const resultAcknowledgements = pgTable(
  "result_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => diagnosticReports.id, { onDelete: "restrict" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    acknowledgedByUserId: uuid("acknowledged_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    acknowledgerCadre: text("acknowledger_cadre").notNull(),
    action: text("action").notNull(),
    forwardedToUserId: uuid("forwarded_to_user_id").references(() => authUsers.id, {
      onDelete: "restrict",
    }),
    noteCiphertext: text("note_ciphertext"),
    recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
    clientKey: text("client_key"),
  },
  (t) => [
    check("result_acknowledgements_action_check", sql`${t.action} IN ('seen','acted','forwarded')`),
    check("ra_forward", sql`(${t.action} = 'forwarded') = (${t.forwardedToUserId} IS NOT NULL)`),
    index("result_ack_report").on(t.reportId),
    index("result_ack_user").on(t.acknowledgedByUserId, t.recordedAt.desc()),
    uniqueIndex("result_ack_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);

export const criticalResultCommunications = pgTable(
  "critical_result_communications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => diagnosticReports.id, { onDelete: "restrict" }),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "restrict" }),
    patientUserId: uuid("patient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    communicatedByUserId: uuid("communicated_by_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    communicatedToUserId: uuid("communicated_to_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    communicatedToRole: text("communicated_to_role").notNull(),
    method: text("method").notNull(),
    readBack: boolean("read_back").notNull(),
    communicatedAt: timestamp("communicated_at", tz).notNull(),
    recordedAt: timestamp("recorded_at", tz).notNull().defaultNow(),
    clientKey: text("client_key"),
  },
  (t) => [
    check(
      "critical_result_communications_communicated_to_role_check",
      sql`${t.communicatedToRole} IN ('orderer','covering_clinician','in_charge')`,
    ),
    check(
      "critical_result_communications_method_check",
      sql`${t.method} IN ('in_app','phone','in_person')`,
    ),
    index("crit_comm_report").on(t.reportId),
    uniqueIndex("crit_comm_client_key")
      .on(t.clientKey)
      .where(sql`${t.clientKey} IS NOT NULL`),
  ],
);

export type ClinicalConcept = typeof clinicalConcepts.$inferSelect;
export type TestCatalogueEntry = typeof testCatalogue.$inferSelect;
export type DiagnosisTerm = typeof diagnosisTerms.$inferSelect;
export type ClinicalNote = typeof clinicalNotes.$inferSelect;
export type NewClinicalNote = typeof clinicalNotes.$inferInsert;
export type ClinicalNoteEvent = typeof clinicalNoteEvents.$inferSelect;
export type EncounterOrderEvent = typeof encounterOrderEvents.$inferSelect;
export type Specimen = typeof specimens.$inferSelect;
export type SpecimenEvent = typeof specimenEvents.$inferSelect;
export type DiagnosticReport = typeof diagnosticReports.$inferSelect;
export type Condition = typeof conditions.$inferSelect;
export type MedicationStatement = typeof medicationStatements.$inferSelect;
export type PregnancyEpisode = typeof pregnancyEpisodes.$inferSelect;
export type Procedure = typeof procedures.$inferSelect;
export type Allergy = typeof allergies.$inferSelect;
export type NewAllergy = typeof allergies.$inferInsert;
export type AllergyStatusAssertion = typeof allergyStatusAssertions.$inferSelect;
export type ResultAcknowledgement = typeof resultAcknowledgements.$inferSelect;
export type CriticalResultCommunication = typeof criticalResultCommunications.$inferSelect;
