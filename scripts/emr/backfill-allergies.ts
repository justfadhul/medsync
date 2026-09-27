/* eslint-disable no-console -- owner CLI */
/**
 * Proposal §H.3, runbook §8: re-run 0071's allergy backfill — `patient_allergies` → `allergies`,
 * and resus AMPLE captures → `allergies` plus NKDA assertions — for captures made while `EMR_V1`
 * was off. The SQL is read from 0071 itself at run time (one source, so the two cannot drift). It
 * is keyed on `legacy_ref`, as is the AMPLE write-through (lib/emr/write/ample.ts), so a re-run
 * copies nothing twice. The dry run executes it in a transaction, counts, and rolls back.
 *
 *   npm run emr:backfill-allergies                                  # dry run: would copy
 *   npm run emr:backfill-allergies -- --apply --actor <auth user id>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import { count, isNotNull, sql } from "drizzle-orm";

import { allergies, allergyStatusAssertions } from "@/db/schema/emr";
import { asActor, DryRun, runCli } from "./_cli";

const FROM = "-- (a) patient_allergies";
const END = "DROP TABLE _emr_resus_caps;";

/** 0071 §15, verbatim (the same slice tests/emr-db/prescribing-allergy.test.ts replays). */
export function backfillSection(): string {
  const text = readFileSync(
    join(process.cwd(), "supabase/migrations/0071_emr_record_spine.sql"),
    "utf8",
  );
  const from = text.indexOf(FROM);
  const end = text.indexOf(END, from);
  if (from < 0 || end < 0) throw new Error("0071 backfill section not found");
  return text.slice(from, end + END.length);
}

/** One statement per call: PGlite's query protocol takes no multi-statement strings. The section
 *  has no `--` or `;` inside a string literal, so stripping comments and splitting is exact. */
export function backfillStatements(): string[] {
  return backfillSection()
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function backfillAllergies(
  db: EmrDb,
  o: { apply: boolean; actor?: string },
): Promise<{ allergies: number; nkdaAssertions: number }> {
  const statements = backfillStatements();
  const counts = async (tx: EmrTx) => {
    const [a] = await tx
      .select({ n: count() })
      .from(allergies)
      .where(isNotNull(allergies.legacyRef));
    const [s] = await tx
      .select({ n: count() })
      .from(allergyStatusAssertions)
      .where(isNotNull(allergyStatusAssertions.legacyRef));
    return { a: a!.n, s: s!.n };
  };
  let out = { allergies: 0, nkdaAssertions: 0 };
  try {
    await db.transaction(async (tx) => {
      await asActor(tx, o.actor);
      const before = await counts(tx);
      for (const s of statements) await tx.execute(sql.raw(s));
      const after = await counts(tx);
      out = { allergies: after.a - before.a, nkdaAssertions: after.s - before.s };
      if (!o.apply) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return out;
}

if (process.argv[1]?.endsWith("backfill-allergies.ts"))
  void runCli(
    `
Re-run the 0071 allergy backfill (runbook §8). Keyed on legacy_ref: a re-run adds nothing.
  --apply           write (default: dry run in a rolled-back transaction, counts only)
  --actor <uuid>    auth user id stamped on the audit identity (required with --apply)`,
    async ({ db, apply, actor }) => {
      const r = await backfillAllergies(db, { apply, actor });
      console.log(
        `${apply ? "Copied" : "Would copy"}: ${r.allergies} allergies, ${r.nkdaAssertions} NKDA assertions.`,
      );
    },
  );
