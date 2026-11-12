import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { labHmisReports } from "@/db/schema";
import { secretMatches } from "@/lib/channels/webhook-auth";
import { env } from "@/lib/env";
import { labHmisLiveFor } from "@/lib/lab/feature";
import { changedSinceSigning } from "@/lib/lab/hmis-store";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * HM-11's nightly run (Vercel cron, CRON_SECRET bearer): every signed HMIS 105 compared with a fresh count, per
 * hospital with labHmis on. Aggregates only: it logs how many cells changed, never a record. The report page
 * computes the same on every view, so a missed night loses nothing (budget: under 1 min per hospital).
 */
async function run(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!env.CRON_SECRET)
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server." },
      { status: 503 },
    );
  if (!supplied || !secretMatches(supplied, env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const signed = await db
    .selectDistinct({ hospitalId: labHmisReports.hospitalId, month: labHmisReports.month })
    .from(labHmisReports)
    .where(inArray(labHmisReports.state, ["signed", "exported"]));
  let changed = 0;
  for (const s of signed.filter((x) => labHmisLiveFor(x.hospitalId))) {
    const month = s.month.slice(0, 7);
    const started = Date.now();
    const diff = await db.transaction((t) => changedSinceSigning(t as never, s.hospitalId, month));
    if (diff?.changes.length) {
      changed++;
      logger.warn("cron.hmis-changes.changed", {
        hospital_id: s.hospitalId,
        month,
        revision: diff.revision,
        cells: diff.changes.length,
        ms: Date.now() - started,
      });
    }
  }
  return NextResponse.json({ reports: signed.length, changed });
}

export const POST = run;
export const GET = run;
