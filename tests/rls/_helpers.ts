import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

// vitest.config.ts loads .env / .env.local at config time and passes the
// values through test.env, so process.env is populated when this module is
// evaluated. No loader needed here.

/**
 * Test helpers for live-Supabase RLS testing.
 *
 * Strategy:
 * 1. `createTestUser` provisions an auth.users row via the service-role admin
 *    API, then returns an anon-keyed client signed in as that user. RLS
 *    applies to every query on that client.
 * 2. `serviceSupabase()` is a service-role client for setup/cleanup that
 *    bypasses RLS.
 * 3. `serviceSql` is a raw postgres-js handle for direct INSERTs into seed
 *    data (hospitals, departments) without going through Supabase's REST API.
 * 4. `deleteUser` removes the test user (cascades to public.users, user_roles,
 *    consent_records).
 *
 * Naming convention: every test user email is `rls-<test>-<role>-<rand>@medsync.local`.
 * If a test crashes mid-run, the email pattern makes manual cleanup trivial.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

/** Every value a live-DB suite needs; without them the suites SKIP, they do not error. */
const DB_ENV_PRESENT = !!(
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  SUPABASE_SERVICE_ROLE_KEY &&
  DATABASE_URL
);

/**
 * SAFETY GUARD — RLS tests provision real auth.users + hospitals +
 * agreements rows. Without an opt-in flag they SKIP so a stray
 * `npx vitest run` against a `.env.local` pointed at production
 * doesn't leak rows. The cleanup helpers can't fully roll back when
 * a test crashes mid-flight, and the audit_log is append-only.
 *
 * To allow RLS tests to run, set the env var:
 *   MEDSYNC_ALLOW_RLS_DB_WRITES=1
 *
 * Ideally point .env.local at a separate test Supabase project when
 * doing this; running against prod leaves audit-log rows that can't
 * be cleaned up.
 *
 * Test files use `describe.skipIf(!RLS_TESTS_ENABLED)(...)` so the
 * suites report SKIPPED (green ⊘) instead of ERROR when the flag
 * isn't set — or when there is no database at all (CI without secrets,
 * a fresh clone): this module must never throw at import.
 */
export const RLS_TESTS_ENABLED = process.env.MEDSYNC_ALLOW_RLS_DB_WRITES === "1" && DB_ENV_PRESENT;

const TEST_PASSWORD = "test-password-rls-only-1234567";

export function serviceSupabase(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// postgres.js opens nothing until the first query, so a placeholder URL is
// inert in a skipped run and a real one connects on demand.
const _sql = postgres(DATABASE_URL ?? "postgres://skipped@localhost:1/skipped", {
  prepare: false,
  max: 1,
});
export const serviceSql = _sql;

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

export function makeEmail(suite: string, role: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `rls-${suite}-${role}-${rand}@medsync.local`;
}

export async function createTestUser(suite: string, role: string): Promise<TestUser> {
  const admin = serviceSupabase();
  const email = makeEmail(suite, role);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`createTestUser(${email}): ${createErr?.message ?? "no user"}`);
  }

  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInErr) {
    throw new Error(`signIn(${email}): ${signInErr.message}`);
  }

  return { id: created.user.id, email, client };
}

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
}

export async function deleteUser(userId: string): Promise<void> {
  const admin = serviceSupabase();
  await admin.auth.admin.deleteUser(userId);
}

export async function grantRole(
  userId: string,
  role: string,
  hospitalId: string | null,
): Promise<void> {
  await serviceSql`
    INSERT INTO public.user_roles (user_id, role, hospital_id)
    VALUES (${userId}, ${role}, ${hospitalId})
  `;
}

export async function createTestHospital(slug: string): Promise<{ id: string; slug: string }> {
  const fullSlug = `${slug}-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await serviceSql<{ id: string }[]>`
    INSERT INTO public.hospitals (name, slug, level)
    VALUES (${`Test ${slug}`}, ${fullSlug}, 'national_referral')
    RETURNING id
  `;
  if (!row) throw new Error("createTestHospital returned no row");
  return { id: row.id, slug: fullSlug };
}

export async function deleteHospital(id: string): Promise<void> {
  await serviceSql`DELETE FROM public.hospitals WHERE id = ${id}`;
}

/** Tear down any leftover test rows after the suite. */
/**
 * Sweeps test rows. Catches anything created by `createTestHospital`
 * (slug pattern `<slug>-<6char-rand>`) and `createTestUser` (email
 * `rls-<suite>-<role>-<rand>@medsync.local`). The hospital sweep is
 * keyed off the `Test ` name prefix the helper applies, which is
 * broader than the old `slug LIKE 'test-%-%'` rule and catches the
 * GATE-C+ suite slugs (`agree-*`, `wards-*`, `gate-*`).
 *
 * Safe against the audit-log-prevent-modification trigger because
 * we don't try to update audit rows directly; we delete via cascade
 * (audit row stays — append-only — but the live row is gone).
 */
export async function cleanup(): Promise<void> {
  // One hospital at a time, inside the database (one round trip): a fixture that wrote append-only
  // clinical rows (0040's documentation, the EMR's insert-only facts) can never be deleted, by
  // design. Leave that one, and keep going.
  await serviceSql.unsafe(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT id FROM public.hospitals WHERE name LIKE 'Test %' LOOP
        BEGIN
          DELETE FROM public.hospitals WHERE id = r.id;
        EXCEPTION WHEN others THEN
          IF SQLERRM !~* 'append-only|insert-only|never deleted' THEN RAISE; END IF;
        END;
      END LOOP;
    END $$;`);
  const admin = serviceSupabase();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) {
    if (u.email?.startsWith("rls-") && u.email.endsWith("@medsync.local")) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

export async function closeSql(): Promise<void> {
  await _sql.end({ timeout: 5 });
}
