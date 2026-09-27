/* eslint-disable no-console -- owner CLI */
/**
 * O-4 (runbook §4): the legacy EMR row counts, run in a READ ONLY transaction. The queries are read
 * from docs/emr/OWNER-RUNBOOK.md §4 at run time, so the script and the runbook cannot disagree:
 * the first block always, the second ("after 0071 is applied") only where 0071's `allergies`
 * exists. Counts only; no row content is read.
 *
 *   npm run emr:legacy-counts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmrDb } from "@/lib/emr/db";
import { sql } from "drizzle-orm";

import { rowsOf, runCli } from "./_cli";

/** The ```sql blocks of runbook §4, in order. */
export function runbookQueries(): string[] {
  const doc = readFileSync(join(process.cwd(), "docs/emr/OWNER-RUNBOOK.md"), "utf8");
  const from = doc.indexOf("## 4.");
  const section = doc.slice(from, doc.indexOf("\n## ", from + 1));
  const blocks = [...section.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]!.trim());
  if (from < 0 || blocks.length !== 2) throw new Error("runbook §4 queries not found");
  return blocks;
}

export async function legacyCounts(db: EmrDb): Promise<{ tbl: string; count: number }[]> {
  const [always, after0071] = runbookQueries() as [string, string];
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const has0071 = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`SELECT to_regclass('public.allergies') IS NOT NULL AS ok`),
    )[0]!.ok;
    const out: { tbl: string; count: number }[] = [];
    for (const q of has0071 ? [always, after0071] : [always])
      for (const r of rowsOf<{ tbl: string; count: string | number }>(await tx.execute(sql.raw(q))))
        out.push({ tbl: r.tbl, count: Number(r.count) });
    return out;
  });
}

if (process.argv[1]?.endsWith("legacy-counts.ts"))
  void runCli(
    `
Count the legacy EMR rows (O-4, runbook §4). Read only; keep the output with the release notes.`,
    async ({ db }) => {
      console.table(await legacyCounts(db));
    },
    { writes: false },
  );
