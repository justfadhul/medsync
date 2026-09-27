/* eslint-disable no-console -- owner CLI */
/**
 * O-5 (runbook §9, ADR 0132): re-encrypt the NCD drafts saved before E4. Each `clerkship_drafts`
 * row whose payload has no `enc` key is rewritten as `{ enc: encrypt(JSON.stringify(payload)) }`,
 * exactly the shape lib/ncd/draft.ts saves and reads. One transaction per batch, rows locked, the
 * predicate re-checked in the UPDATE, `updated_at` left alone (it is the author's save time).
 * Idempotent: an encrypted row no longer matches. Prints counts only, never a payload.
 *
 *   npm run emr:reencrypt-drafts                                  # dry run: count
 *   npm run emr:reencrypt-drafts -- --apply --actor <auth user id>
 */
import type { EmrDb } from "@/lib/emr/db";
import { and, asc, count, eq, sql } from "drizzle-orm";

import { clerkshipDrafts } from "@/db/schema/clerkship-drafts";
import { encrypt } from "@/lib/encryption";
import { asActor, runCli } from "./_cli";

const plaintext = sql`NOT (${clerkshipDrafts.payload} ? 'enc')`;

export async function reencryptNcdDrafts(
  db: EmrDb,
  o: { apply: boolean; actor?: string; batchSize?: number },
): Promise<{ plaintext: number; encrypted: number }> {
  const [{ n }] = (await db.select({ n: count() }).from(clerkshipDrafts).where(plaintext)) as [
    { n: number },
  ];
  if (!o.apply) return { plaintext: n, encrypted: 0 };

  const size = o.batchSize ?? 200;
  let encrypted = 0;
  for (;;) {
    const done = await db.transaction(async (tx) => {
      await asActor(tx, o.actor);
      const rows = await tx
        .select({ id: clerkshipDrafts.id, payload: clerkshipDrafts.payload })
        .from(clerkshipDrafts)
        .where(plaintext)
        .orderBy(asc(clerkshipDrafts.id))
        .limit(size)
        .for("update");
      for (const r of rows)
        await tx
          .update(clerkshipDrafts)
          .set({ payload: { enc: encrypt(JSON.stringify(r.payload)) } })
          .where(and(eq(clerkshipDrafts.id, r.id), plaintext));
      return rows.length;
    });
    encrypted += done;
    if (done < size) break;
  }
  return { plaintext: n, encrypted };
}

if (process.argv[1]?.endsWith("reencrypt-ncd-drafts.ts"))
  void runCli(
    `
Re-encrypt plaintext NCD drafts (O-5, runbook §9).
  --apply           write (default: dry run, counts only)
  --actor <uuid>    auth user id stamped on the audit identity (required with --apply)`,
    async ({ db, apply, actor }) => {
      const r = await reencryptNcdDrafts(db, { apply, actor });
      console.log(`Plaintext drafts: ${r.plaintext}. Encrypted now: ${r.encrypted}.`);
    },
  );
