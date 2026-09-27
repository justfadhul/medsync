/**
 * The PGlite lane (HARMONISATION §2 E1, ADR 0133): a real Postgres, in-process, with every
 * migration replayed over a minimal Supabase bootstrap, so the EMR's triggers, RLS and backfill
 * are tested on the SQL that ships rather than on mocks.
 *
 * On only when EMR_PGLITE=1. PGlite is not a dependency of this repo (8 GB machine, no new deps):
 * it lives in ~/Desktop/emr-harness/pg/node_modules and is symlinked into node_modules locally.
 * Every PGlite import is a dynamic import of a string variable, so tsc and CI never resolve it.
 *
 * Boot replays 70+ migrations (~10 s), so each test file boots once (`bootLane` caches per module,
 * and Vitest isolates modules per file) and every probe runs in a rolled-back transaction.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EmrDb } from "@/lib/emr/db";

import * as schema from "@/db/schema";

export const laneOn = process.env.EMR_PGLITE === "1";

export const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");

/** The slice of PGlite's API the lane uses. */
export interface PgQueryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
}
export interface Pg extends PgQueryable {
  transaction<T>(fn: (tx: PgQueryable & { rollback(): Promise<void> }) => Promise<T>): Promise<T>;
}

/** Copied from ~/Desktop/emr-harness/pg/run.mjs (the Supabase bootstrap), plus the default
 *  privileges Supabase gives anon/authenticated on public, so a missing REVOKE shows up here as it
 *  would in production instead of being hidden by an empty grant table. */
const BOOTSTRAP = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE ROLE supabase_realtime_admin NOLOGIN;
  CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions; CREATE SCHEMA realtime;
  CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, phone text,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_sign_in_at timestamptz,
    email_confirmed_at timestamptz, deleted_at timestamptz, is_anonymous boolean DEFAULT false);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint,
    allowed_mime_types text[], created_at timestamptz DEFAULT now());
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text,
    owner uuid, metadata jsonb, created_at timestamptz DEFAULT now());
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
    $$ SELECT string_to_array(name, '/') $$;
  CREATE TABLE realtime.messages (id bigserial PRIMARY KEY, topic text, extension text, payload jsonb,
    event text, private boolean, inserted_at timestamptz DEFAULT now());
  ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('realtime.topic', true), '') $$;
  CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
    RETURNS void LANGUAGE sql AS
    $$ INSERT INTO realtime.messages (topic, extension, payload, event, private)
       VALUES (topic, 'broadcast', payload, event, private) $$;
  CREATE PUBLICATION supabase_realtime;
  GRANT USAGE ON SCHEMA public, auth, realtime TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8").replace(/--> statement-breakpoint/g, "");
}

/** Replay migrations in order; `upTo`/`from` are inclusive file-name bounds (as run.mjs). */
export async function migrate(
  pg: Pg,
  opts: { upTo?: string; from?: string } = {},
): Promise<string[]> {
  const applied: string[] = [];
  for (const name of migrationFiles()) {
    if (opts.upTo && name > opts.upTo) break;
    if (opts.from && name < opts.from) continue;
    try {
      await pg.exec(readMigration(name));
    } catch (e) {
      throw new Error(`${name}: ${(e as Error).message}`);
    }
    applied.push(name);
  }
  return applied;
}

// Variables, not literals: the specifiers must stay invisible to tsc and the bundler.
const PGLITE = "@electric-sql/pglite";
const PGCRYPTO = "@electric-sql/pglite/contrib/pgcrypto";
const DRIZZLE_PGLITE = "drizzle-orm/pglite";

/** A fresh, uncached instance: bootstrap only (the caller migrates). */
export async function bootEmpty(): Promise<Pg> {
  const { PGlite } = await import(/* @vite-ignore */ PGLITE);
  const { pgcrypto } = await import(/* @vite-ignore */ PGCRYPTO);
  const pg = new PGlite({ extensions: { pgcrypto } }) as Pg;
  await pg.exec(BOOTSTRAP);
  return pg;
}

export async function drizzleFor(pg: Pg): Promise<EmrDb> {
  const { drizzle } = await import(/* @vite-ignore */ DRIZZLE_PGLITE);
  return drizzle(pg, { schema }) as EmrDb;
}

export type Lane = { pg: Pg; db: EmrDb; applied: string[] };
let cached: Promise<Lane> | undefined;

/** The full replay, booted once per test file. */
export function bootLane(): Promise<Lane> {
  cached ??= (async () => {
    const pg = await bootEmpty();
    const applied = await migrate(pg);
    return { pg, db: await drizzleFor(pg), applied };
  })();
  return cached;
}

/* ─── Acting as someone ─────────────────────────────────────────── */
export type ActorRole = "medsync_clinical_reader" | "authenticated" | "anon";
export type Actor = { userId: string | null; role: ActorRole; hospitalId?: string | null };

/**
 * Run `fn` as `actor` inside a transaction that is always rolled back.
 * - medsync_clinical_reader: identity by set_config (app.user_id / app.hospital_id), as lib/emr/db.ts.
 * - authenticated / anon: identity by JWT claim, as PostgREST does.
 */
export async function actAs<T>(
  pg: Pg,
  actor: Actor,
  fn: (tx: PgQueryable) => Promise<T>,
): Promise<T> {
  return pg.transaction(async (tx) => {
    if (actor.role === "medsync_clinical_reader") {
      await tx.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.hospital_id', $2, true)",
        [actor.userId ?? "", actor.hospitalId ?? ""],
      );
    } else if (actor.userId) {
      await tx.query(
        `SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true),
                set_config('request.jwt.claims', $3, true)`,
        [actor.userId, actor.role, JSON.stringify({ sub: actor.userId, role: actor.role })],
      );
    }
    await tx.exec(`SET LOCAL ROLE ${actor.role}`);
    const result = await fn(tx);
    await tx.rollback();
    return result;
  });
}

/** One statement as `actor`: its rows, or the error message. Never persists. */
export async function probe(
  pg: Pg,
  actor: Actor,
  sql: string,
  params?: unknown[],
): Promise<
  { ok: true; rows: Record<string, unknown>[]; affected: number } | { ok: false; error: string }
> {
  try {
    return await actAs(pg, actor, async (tx) => {
      const r = await tx.query(sql, params);
      return { ok: true as const, rows: r.rows, affected: r.affectedRows ?? 0 };
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function one<T = Record<string, unknown>>(
  pg: PgQueryable,
  sql: string,
  params?: unknown[],
): Promise<T> {
  try {
    return (await pg.query<T>(sql, params)).rows[0] as T;
  } catch (e) {
    throw new Error(`${(e as Error).message} — in: ${sql.trim().slice(0, 80)}`);
  }
}

/* ─── Fixture builders (owner inserts, with every column the real tables require) ─── */
const short = () => randomUUID().slice(0, 8);

export async function hospital(pg: Pg, name = "Lane hospital"): Promise<string> {
  const s = short();
  return (
    await one<{ id: string }>(
      pg,
      `INSERT INTO public.hospitals (name, slug, level) VALUES ($1, $2, 'national_referral') RETURNING id`,
      [`${name} ${s}`, `lane-${s}`],
    )
  ).id;
}

export async function department(pg: Pg, hospitalId: string, name = "Medicine"): Promise<string> {
  const s = short();
  return (
    await one<{ id: string }>(
      pg,
      `INSERT INTO public.hospital_departments (hospital_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [hospitalId, `${name} ${s}`, `dept-${s}`],
    )
  ).id;
}

export async function authUser(pg: Pg, label = "user"): Promise<string> {
  return (
    await one<{ id: string }>(pg, `INSERT INTO auth.users (email) VALUES ($1) RETURNING id`, [
      `${label}-${short()}@lane.test`,
    ])
  ).id;
}

/** A staff member with an affiliation in `cadre` (clinical or not, per cadres.is_clinical). */
export async function staff(
  pg: Pg,
  opts: {
    hospitalId: string;
    departmentId: string;
    cadre?: string;
    state?: "active" | "approved" | "suspended";
  },
): Promise<{ userId: string; affiliationId: string }> {
  const cadre = opts.cadre ?? "MEDICAL_OFFICER";
  const userId = await authUser(pg, cadre.toLowerCase());
  const { cadre_id, role_id } = await one<{ cadre_id: string; role_id: string }>(
    pg,
    `SELECT c.id AS cadre_id,
            coalesce((SELECT r.id FROM public.roles r WHERE r.cadre_id = c.id LIMIT 1),
                     (SELECT r.id FROM public.roles r LIMIT 1)) AS role_id
       FROM public.cadres c WHERE c.code = $1`,
    [cadre],
  );
  if (!cadre_id) throw new Error(`no cadre ${cadre}`);
  const state = opts.state ?? "active";
  const affiliationId = (
    await one<{ id: string }>(
      pg,
      `INSERT INTO public.staff_affiliations
         (user_id, hospital_id, department_id, cadre_id, role_id, employment_type, state, approved_at)
       VALUES ($1, $2, $3, $4, $5, 'full_time', $6::lifecycle_state,
               CASE WHEN $6::text IN ('active','approved') THEN now() END)
       RETURNING id`,
      [userId, opts.hospitalId, opts.departmentId, cadre_id, role_id, state],
    )
  ).id;
  const role =
    cadre === "NURSE" || cadre === "MIDWIFE"
      ? "nurse"
      : cadre === "RECEPTION"
        ? "reception"
        : "clinician";
  await pg.query(`INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, $2, $3)`, [
    userId,
    role,
    opts.hospitalId,
  ]);
  return { userId, affiliationId };
}

export const clinician = (
  pg: Pg,
  o: { hospitalId: string; departmentId: string; cadre?: string },
) => staff(pg, o);
export const reception = (pg: Pg, o: { hospitalId: string; departmentId: string }) =>
  staff(pg, { ...o, cadre: "RECEPTION" });

export async function patient(pg: Pg): Promise<string> {
  return authUser(pg, "patient");
}

export async function superadmin(pg: Pg): Promise<string> {
  const id = await authUser(pg, "superadmin");
  await pg.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'superadmin')`, [id]);
  return id;
}

export async function intake(
  pg: Pg,
  o: { hospitalId: string; patientUserId: string; status?: string; arrivedAt?: string },
): Promise<string> {
  return (
    await one<{ id: string }>(
      pg,
      `INSERT INTO public.patient_intakes (hospital_id, entry_type_code, patient_user_id, status, arrived_at)
       VALUES ($1, 'walk_in', $2, $3, coalesce($4::timestamptz, now())) RETURNING id`,
      [o.hospitalId, o.patientUserId, o.status ?? "arrived", o.arrivedAt ?? null],
    )
  ).id;
}

export async function encounter(
  pg: Pg,
  o: {
    hospitalId: string;
    patientUserId: string;
    clinicianUserId: string;
    departmentId?: string | null;
    state?: "planned" | "in_progress" | "completed" | "cancelled";
    startedAt?: string;
  },
): Promise<string> {
  const state = o.state ?? "in_progress";
  return (
    await one<{ id: string }>(
      pg,
      `INSERT INTO public.encounters (hospital_id, patient_user_id, clinician_user_id, department_id, state, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()),
               CASE WHEN $5 = 'completed' THEN coalesce($6::timestamptz, now()) END)
       RETURNING id`,
      [
        o.hospitalId,
        o.patientUserId,
        o.clinicianUserId,
        o.departmentId ?? null,
        state,
        o.startedAt ?? null,
      ],
    )
  ).id;
}

export async function nursingAssignment(
  pg: Pg,
  o: {
    hospitalId: string;
    departmentId: string;
    nurseUserId: string;
    patientUserId: string;
    ended?: boolean;
  },
): Promise<string> {
  return (
    await one<{ id: string }>(
      pg,
      `INSERT INTO public.nursing_assignments (hospital_id, department_id, nurse_user_id, patient_user_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, now() - interval '1 hour', CASE WHEN $5 THEN now() END) RETURNING id`,
      [o.hospitalId, o.departmentId, o.nurseUserId, o.patientUserId, o.ended ?? false],
    )
  ).id;
}

/** A department appointment in the last 30 days: the other half of department_recent. */
export async function appointmentFixture(
  pg: Pg,
  o: {
    hospitalId: string;
    departmentId: string;
    patientUserId: string;
    clinicianUserId: string;
    daysAgo?: number;
  },
): Promise<string> {
  return (
    await one<{ id: string }>(
      pg,
      `INSERT INTO public.appointments (hospital_id, department_id, patient_user_id, clinician_user_id, starts_at, ends_at,
         reason, origin, status)
       VALUES ($1, $2, $3, $4, now() - make_interval(days => $5), now() - make_interval(days => $5) + interval '20 minutes',
               'follow_up', 'clinician', 'completed') RETURNING id`,
      [o.hospitalId, o.departmentId, o.patientUserId, o.clinicianUserId, o.daysAgo ?? 5],
    )
  ).id;
}

export async function breakGlass(
  pg: Pg,
  o: { actorId: string; patientId: string; hospitalId: string | null; expired?: boolean },
): Promise<string> {
  const auditId = (
    await one<{ id: string }>(
      pg,
      `INSERT INTO public.sa_audit_log (actor_id, action, target_kind, target_id, reason)
       VALUES ($1, 'break_glass_open', 'break_glass_grant', $2, 'lane fixture: emergency access')
       RETURNING id`,
      [o.actorId, o.patientId],
    )
  ).id;
  return (
    await one<{ id: string }>(
      pg,
      `INSERT INTO public.sa_break_glass_grants
         (actor_id, patient_id, purpose, category, hospital_id, sa_audit_log_id, granted_at, expires_at)
       VALUES ($1, $2, 'lane fixture: emergency clinical access', 'emergency', $3, $4,
               now() - interval '2 hours', CASE WHEN $5 THEN now() - interval '1 hour' ELSE now() + interval '1 hour' END)
       RETURNING id`,
      [o.actorId, o.patientId, o.hospitalId, auditId, o.expired ?? false],
    )
  ).id;
}

/** One row in each registry (0072 may seed them too; these are the lane's own, keyed to be re-runnable). */
export async function seedRegistries(pg: Pg, hospitalId: string): Promise<void> {
  await pg.exec(`
    INSERT INTO public.capabilities (id, display, catalogue_version) VALUES ('cap.lane', 'Lane capability', 'lane')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.clinical_concepts (id, display, kind, concept_group, value_type, canonical_unit, phase, catalogue_version)
      VALUES ('lane.quantity', 'Lane quantity', 'observation', 'lane', 'quantity', 'mmol/L', 'lane', 'lane')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.drug_class_tags (id, display, catalogue_version) VALUES ('lane.class', 'Lane class', 'lane')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.diagnosis_terms (display, source) VALUES ('Lane term', 'lane');
  `);
  await pg.query(
    `INSERT INTO public.facility_capabilities (hospital_id, capability_id, status) VALUES ($1, 'cap.lane', 'available')
       ON CONFLICT DO NOTHING`,
    [hospitalId],
  );
  await pg.query(
    `INSERT INTO public.devices (hospital_id, kind, model, serial) VALUES ($1, 'glucometer', 'Lane', $2)`,
    [hospitalId, short()],
  );
  await pg.query(
    `INSERT INTO public.test_catalogue (hospital_id, code, display, kind) VALUES ($1, $2, 'Lane test', 'lab')`,
    [hospitalId, `lane-${short()}`],
  );
}

export const RECORD_KEYS = [
  "clinical_notes",
  "clinical_note_events",
  "conditions",
  "medication_statements",
  "pregnancy_episodes",
  "procedures",
  "allergies",
  "allergy_status_assertions",
  "encounter_order_events",
  "specimens",
  "specimen_events",
  "diagnostic_reports",
  "result_acknowledgements",
  "critical_result_communications",
  "clinical_observations_current",
  "conditions_current",
  "medication_statements_current",
  "allergies_current",
  "clinical_notes_current",
  "encounters",
  "clinical_observations",
  "triage_records",
  "clinical_cosign_requests",
  "problem_list",
  "encounter_orders",
  "encounter_diagnoses",
  "encounter_results",
] as const;
export type RecordKey = (typeof RECORD_KEYS)[number];
/** Row ids per table/view; encounter_orders is [events order, legacy order]. */
export type RecordIds = Record<RecordKey, [string, ...string[]]>;

/**
 * One row in every EMR clinical table (and the evolved legacy tables) for a patient at a hospital,
 * written as the owner. Returns the ids per table/view name so a probe can count exactly these rows.
 * Needs seedRegistries() first (the CFC observation uses concept 'lane.quantity').
 */
export async function seedRecord(
  pg: Pg,
  o: {
    hospitalId: string;
    patientUserId: string;
    encounterId: string;
    authorId: string;
    authorAffiliationId: string;
  },
): Promise<RecordIds> {
  const p = [o.hospitalId, o.patientUserId, o.encounterId, o.authorId];
  // Postgres rejects a bound parameter the statement never uses, so encounter-less rows bind q.
  const q = [o.hospitalId, o.patientUserId, o.authorId];
  const id = async (sql: string, params: unknown[] = p) =>
    (await one<{ id: string }>(pg, sql, params)).id;
  const envelope = `logical_id, hospital_id, patient_user_id, encounter_id, recorded_by_user_id, effective_at, source, trust`;
  const envVals = `$1, $2, $3, $4, now(), 'clinician', 3`;
  const fact = (table: string, cols: string, vals: string) =>
    id(
      `WITH n AS (SELECT gen_random_uuid() AS id)
       INSERT INTO public.${table} (id, ${envelope}, ${cols}) SELECT n.id, n.id, ${envVals}, ${vals} FROM n RETURNING id`,
    );

  const note = await id(
    `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id, template_version,
       author_user_id, author_cadre, content_ciphertext, effective_at)
     VALUES ($1, $2, $3, 'clerking', 'lane', '1', $4, 'MEDICAL_OFFICER', 'iv:tag:ct', now()) RETURNING id`,
  );
  const noteEvent = await id(
    `INSERT INTO public.clinical_note_events (note_id, hospital_id, patient_user_id, kind, actor_user_id, actor_cadre, reason_code)
     VALUES ($4, $1, $2, 'entered_in_error', $3, 'MEDICAL_OFFICER', 'lane') RETURNING id`,
    [...q, note],
  );
  const cosign = await id(
    `INSERT INTO public.clinical_cosign_requests (hospital_id, patient_user_id, requested_by_user_id, requested_by_affiliation_id,
       requested_by_cadre_code, action_kind, action_payload, note_id)
     VALUES ($1, $2, $3, $4, 'INTERN_DOCTOR', 'sign_note', '{}'::jsonb, $5) RETURNING id`,
    [...q, o.authorAffiliationId, note],
  );
  const order = await id(
    `INSERT INTO public.encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id, lifecycle, hospital_id,
       priority, performer, intent_source, requester_cadre, effective_at, reason_text_ciphertext)
     VALUES ($3, $2, 'ecg', 'ECG', $4, 'events', $1, 'routine', 'in_house', 'clinician', 'MEDICAL_OFFICER', now(), 'iv:tag:ct')
     RETURNING id`,
  );
  const legacyOrder = await id(
    `INSERT INTO public.encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id)
     VALUES ($1, $2, 'bloods', 'FBC', $3) RETURNING id`,
    [o.encounterId, o.patientUserId, o.authorId],
  );
  const orderEvent = await id(
    `INSERT INTO public.encounter_order_events (order_id, hospital_id, patient_user_id, kind, actor_user_id, actor_cadre)
     VALUES ($4, $1, $2, 'placed', $3, 'MEDICAL_OFFICER') RETURNING id`,
    [...q, order],
  );
  const specimen = await id(
    `INSERT INTO public.specimens (order_id, hospital_id, patient_user_id, specimen_type, container, collected_at,
       collected_by_user_id, collector_cadre, identifiers_confirmed)
     VALUES ($4, $1, $2, 'venous_plasma', 'edta', now(), $3, 'NURSE', true) RETURNING id`,
    [...q, order],
  );
  const specimenEvent = await id(
    `INSERT INTO public.specimen_events (specimen_id, hospital_id, patient_user_id, kind, actor_user_id, actor_cadre)
     VALUES ($4, $1, $2, 'received', $3, 'LAB_TECH') RETURNING id`,
    [...q, specimen],
  );
  const report = await fact(
    "diagnostic_reports",
    "order_id, specimen_id, kind, issued_at, performer, entry_mode, entered_by_user_id, conclusion_code",
    `'${order}', '${specimen}', 'ecg', now(), 'in_house', 'direct', $4, 'normal'`,
  );
  const ack = await id(
    `INSERT INTO public.result_acknowledgements (report_id, hospital_id, patient_user_id, acknowledged_by_user_id, acknowledger_cadre, action)
     VALUES ($4, $1, $2, $3, 'MEDICAL_OFFICER', 'seen') RETURNING id`,
    [...q, report],
  );
  const crit = await id(
    `INSERT INTO public.critical_result_communications (report_id, hospital_id, patient_user_id, communicated_by_user_id,
       communicated_to_user_id, communicated_to_role, method, read_back, communicated_at)
     VALUES ($4, $1, $2, $3, $3, 'orderer', 'phone', true, now()) RETURNING id`,
    [...q, report],
  );
  const observation = await id(
    `WITH n AS (SELECT gen_random_uuid() AS id)
     INSERT INTO public.clinical_observations (id, hospital_id, patient_user_id, encounter_id, recorded_by_user_id,
       observation_kind, state, concept_id, logical_id, version, category, value_type, value_num, value_unit, value_canonical,
       source, trust, status, sensitivity, effective_at)
     SELECT n.id, $1, $2, $3, $4, 'fact', 'fact', 'lane.quantity', n.id, 1, 'laboratory', 'quantity', 5.5, 'mmol/L', 5.5,
            'lab', 1, 'final', 'standard', now() FROM n RETURNING id`,
  );
  const condition = await fact(
    "conditions",
    "category, text_ciphertext, clinical_status, verification, asserted_by",
    `'problem_list_item', 'iv:tag:ct', 'active', 'confirmed', 'clinician'`,
  );
  const medication = await fact(
    "medication_statements",
    "drug_code, medication_status, medication_source",
    `'metformin', 'active', 'patient_reported'`,
  );
  const pregnancy = await fact("pregnancy_episodes", "pregnancy_state", `'unknown'`);
  const procedure = await fact(
    "procedures",
    "text_ciphertext, outcome",
    `'iv:tag:ct', 'completed'`,
  );
  const allergy = await fact(
    "allergies",
    "substance_kind, substance_code, informant",
    `'drug_ingredient', 'penicillin', 'patient'`,
  );
  const assertion = await id(
    `INSERT INTO public.allergy_status_assertions (hospital_id, patient_user_id, encounter_id, assertion, asserted_by_user_id, asserted_at)
     VALUES ($1, $2, $3, 'unable_to_assess', $4, now()) RETURNING id`,
  );
  const triage = await id(
    `INSERT INTO public.triage_records (hospital_id, patient_user_id, ruleset, vitals_snapshot, computed_level,
       computed_breakdown, assigned_level)
     VALUES ($1, $2, 'adult_news2', '{}'::jsonb, 3, '{}'::jsonb, 3) RETURNING id`,
    [o.hospitalId, o.patientUserId],
  );
  const problem = await id(
    `INSERT INTO public.problem_list (patient_user_id, hospital_id, item) VALUES ($2, $1, 'lane problem') RETURNING id`,
    [o.hospitalId, o.patientUserId],
  );
  const diagnosis = await id(
    `INSERT INTO public.encounter_diagnoses (encounter_id, patient_user_id, text) VALUES ($2, $1, 'lane dx') RETURNING id`,
    [o.patientUserId, o.encounterId],
  );
  const result = await id(
    `INSERT INTO public.encounter_results (order_id, value) VALUES ($1, '5.0') RETURNING id`,
    [legacyOrder],
  );

  return {
    clinical_notes: [note],
    clinical_note_events: [noteEvent],
    conditions: [condition],
    medication_statements: [medication],
    pregnancy_episodes: [pregnancy],
    procedures: [procedure],
    allergies: [allergy],
    allergy_status_assertions: [assertion],
    encounter_order_events: [orderEvent],
    specimens: [specimen],
    specimen_events: [specimenEvent],
    diagnostic_reports: [report],
    result_acknowledgements: [ack],
    critical_result_communications: [crit],
    clinical_observations_current: [observation],
    conditions_current: [condition],
    medication_statements_current: [medication],
    allergies_current: [allergy],
    clinical_notes_current: [note],
    encounters: [o.encounterId],
    clinical_observations: [observation],
    triage_records: [triage],
    clinical_cosign_requests: [cosign],
    problem_list: [problem],
    encounter_orders: [order, legacyOrder],
    encounter_diagnoses: [diagnosis],
    encounter_results: [result],
  };
}
