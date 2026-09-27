/* eslint-disable no-console -- owner CLI: it reports to the terminal */
/**
 * The shared shell of the EMR owner scripts (runbook §4, §8, §9): `--help` exits before any env or
 * database is touched; otherwise DATABASE_URL is required, the target host is printed (never the
 * credentials), and a write needs `--apply` plus `--actor <auth user id>` so the audit rows name
 * the person who ran it. Each script's core takes an `EmrDb`, so the PGlite lane drives it directly.
 *
 * Run through the npm scripts: `NODE_PATH=node_modules/next/dist/compiled tsx
 * --conditions=react-server` resolves Next's own `server-only` to its no-op build, so the scripts
 * can reuse lib/encryption.ts and lib/emr/read/allergies.ts unchanged.
 */
import { existsSync } from "node:fs";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse argv, connect, run `main`, close. Exits non-zero on any failure. */
export async function runCli(
  usage: string,
  main: (o: { db: EmrDb; apply: boolean; actor: string | undefined }) => Promise<void>,
  opts: { writes: boolean } = { writes: true },
): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage.trim());
    return;
  }
  const apply = opts.writes && args.includes("--apply");
  const i = args.indexOf("--actor");
  const actor = i >= 0 ? args[i + 1] : undefined;
  if (apply && (!actor || !UUID.test(actor))) {
    console.error("--apply needs --actor <auth user id> (a uuid): the audit rows name who ran it.");
    process.exit(1);
  }

  for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set: refusing to run.");
    process.exit(1);
  }
  let host = "(unparseable URL)";
  try {
    const u = new URL(url);
    host = `${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {}
  console.log(`Target database: ${host}`);
  console.log(
    opts.writes
      ? apply
        ? "Mode: APPLY"
        : "Mode: dry run (add --apply to write)"
      : "Mode: read only",
  );

  const client = postgres(url, { prepare: false, max: 1 });
  try {
    await main({ db: drizzle(client, { schema }) as unknown as EmrDb, apply, actor });
  } catch (e) {
    console.error(`Failed: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** Audit identity for this transaction, as lib/emr/db.ts asClinicalWriter sets it. */
export async function asActor(tx: EmrTx, actor: string | undefined): Promise<void> {
  if (!actor) return;
  await tx.execute(
    sql`SELECT set_config('app.user_id', ${actor}, true),
               set_config('request.jwt.claim.sub', ${actor}, true)`,
  );
}

/** Raw-SQL rows from either driver: postgres-js returns an array, PGlite `{ rows }`. */
export function rowsOf<T>(r: unknown): T[] {
  return (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
}

/** Rolls a dry run back after it has counted. */
export class DryRun extends Error {}
