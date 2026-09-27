import "server-only";

import type * as schema from "@/db/schema";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The EMR's two ways into the database (ADR 0131, E2).
 *
 * Identity travels as transaction-local GUCs (`set_config(…, true)`), read back in SQL by
 * `private.current_user_id()` / `private.current_hospital_id()`. Being transaction-local they are
 * safe on the transaction pooler: nothing leaks to the next borrower of the connection.
 *
 * - `asClinicalReader` also `SET LOCAL ROLE medsync_clinical_reader` (no BYPASSRLS), so the FORCED
 *   RLS policies decide what the read returns: a patient with no basis simply has no rows.
 * - `asClinicalWriter` stays the owner (RLS bypassed, so the write functions must call
 *   `resolveEmrAccess` first) and also sets `request.jwt.claim.sub`, so `audit_log_changes()` stamps
 *   the real author on every audit row instead of null.
 *
 * Both take an optional database so the PGlite lane (tests/emr-db) can inject its own; the app
 * default is loaded lazily, keeping this module importable without DATABASE_URL.
 */

type Schema = typeof schema;
export type EmrDb = PgDatabase<PgQueryResultHKT, Schema>;
export type EmrTx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export type EmrScope = { userId: string; hospitalId: string };

async function withIdentity<T>(
  scope: EmrScope,
  reader: boolean,
  fn: (tx: EmrTx) => Promise<T>,
  database?: EmrDb,
): Promise<T> {
  const conn = database ?? ((await import("@/db")).db as unknown as EmrDb);
  return conn.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.user_id', ${scope.userId}, true),
                 set_config('app.hospital_id', ${scope.hospitalId}, true)`,
    );
    if (reader) {
      await tx.execute(sql`SET LOCAL ROLE medsync_clinical_reader`);
    } else {
      await tx.execute(sql`SELECT set_config('request.jwt.claim.sub', ${scope.userId}, true)`);
    }
    return fn(tx);
  });
}

/** Read as the clinician: RLS applies (medsync_clinical_reader). */
export function asClinicalReader<T>(
  scope: EmrScope,
  fn: (tx: EmrTx) => Promise<T>,
  database?: EmrDb,
): Promise<T> {
  return withIdentity(scope, true, fn, database);
}

/** Write as the owner, audited as the clinician. The caller checks access first. */
export function asClinicalWriter<T>(
  scope: EmrScope,
  fn: (tx: EmrTx) => Promise<T>,
  database?: EmrDb,
): Promise<T> {
  return withIdentity(scope, false, fn, database);
}

/**
 * Inside a writer transaction, run a read under RLS as the clinician (the reader role), then return
 * to the owner. For a write that needs hospital-scoped facts: the owner would see every hospital's.
 * No finally: if `fn` throws, the transaction aborts and the role ends with it.
 */
export async function readAsClinician<T>(tx: EmrTx, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`SET LOCAL ROLE medsync_clinical_reader`);
  const out = await fn();
  await tx.execute(sql`SET LOCAL ROLE NONE`);
  return out;
}
