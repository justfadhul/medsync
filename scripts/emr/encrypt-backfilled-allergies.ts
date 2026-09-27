/* eslint-disable no-console -- owner CLI */
/**
 * O-5 extended (runbook §9, ADR 0135, [D2]): 0071 could not encrypt, so a backfilled allergy
 * carries `legacy_ref` and no text; its text is read from the untouched source. This writes the
 * next version of each such item — the current version with `legacy_ref` and no ciphertext —
 * carrying every column, with `substance_text_ciphertext` encrypted from the source text as
 * lib/emr/read/allergies.ts resolveAllergyTexts (owner path) reads it. The new version keeps the
 * row's `hospital_id` (where it was recorded) and `legacy_ref` (provenance), and names the owner
 * as `recorded_by`; client_key `o5-allergy-text:<row id>` makes a re-run add nothing. A source
 * that is gone is counted and skipped, never guessed. Must finish before any legacy table retires.
 *
 *   npm run emr:encrypt-allergy-text                                  # dry run: counts
 *   npm run emr:encrypt-allergy-text -- --apply --actor <auth user id>
 */
import { randomUUID } from "node:crypto";
import type { EmrDb } from "@/lib/emr/db";
import { and, asc, gt, isNotNull, isNull, sql } from "drizzle-orm";

import { allergies } from "@/db/schema/emr";
import { resolveAllergyTexts } from "@/lib/emr/read/allergies";
import { encrypt } from "@/lib/encryption";
import { asActor, runCli } from "./_cli";

/** The current version of a backfilled item that still has no text of its own. */
const untexted = and(
  isNotNull(allergies.legacyRef),
  isNull(allergies.substanceTextCiphertext),
  sql`NOT EXISTS (SELECT 1 FROM public.allergies b WHERE b.supersedes_id = ${allergies.id})`,
);

export const o5Key = (rowId: string) => `o5-allergy-text:${rowId}`;

export async function encryptBackfilledAllergies(
  db: EmrDb,
  o: { apply: boolean; actor?: string; batchSize?: number; now?: Date },
): Promise<{ candidates: number; encrypted: number; missingSource: number }> {
  if (o.apply && !o.actor) throw new Error("An actor is required to write (recorded_by, audit).");
  const size = o.batchSize ?? 200;
  const out = { candidates: 0, encrypted: 0, missingSource: 0 };
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    // Keyset by id, so a row whose source is gone is passed once, not re-read forever.
    const n = await db.transaction(async (tx) => {
      await asActor(tx, o.actor);
      const rows = await tx
        .select()
        .from(allergies)
        .where(and(untexted, gt(allergies.id, after)))
        .orderBy(asc(allergies.id))
        .limit(size)
        .for("update");
      const texts = new Map(
        (await resolveAllergyTexts(tx, rows, "owner")).map((r) => [r.id, r.substanceText]),
      );
      for (const prev of rows) {
        const text = texts.get(prev.id);
        if (!text) {
          out.missingSource++;
          continue;
        }
        if (!o.apply) {
          out.encrypted++;
          continue;
        }
        const { id: _id, recordedAt: _at, clientKey: _key, ...carried } = prev;
        const inserted = await tx
          .insert(allergies)
          .values({
            ...carried,
            id: randomUUID(),
            version: prev.version + 1,
            supersedesId: prev.id,
            recordedByUserId: o.actor!,
            authorCadre: null,
            recordedAt: o.now ?? new Date(),
            substanceTextCiphertext: encrypt(text),
            clientKey: o5Key(prev.id),
          })
          .onConflictDoNothing()
          .returning({ id: allergies.id });
        out.encrypted += inserted.length;
      }
      out.candidates += rows.length;
      if (rows.length) after = rows[rows.length - 1]!.id;
      return rows.length;
    });
    if (n < size) break;
  }
  return out;
}

if (process.argv[1]?.endsWith("encrypt-backfilled-allergies.ts"))
  void runCli(
    `
Encrypt the substance text of backfilled allergies as a new version (O-5, runbook §9).
  --apply           write (default: dry run, counts only)
  --actor <uuid>    auth user id recorded as recorded_by and on the audit rows (required with --apply)`,
    async ({ db, apply, actor }) => {
      const r = await encryptBackfilledAllergies(db, { apply, actor });
      console.log(
        `Backfilled items without text: ${r.candidates}. ${apply ? "Encrypted" : "Would encrypt"}: ` +
          `${r.encrypted}. Source text missing (left as is): ${r.missingSource}.`,
      );
    },
  );
