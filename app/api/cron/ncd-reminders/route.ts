import type { DispatchSummary } from "@/lib/ncdreg/recall/dispatcher";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { ncdFacilitySettings } from "@/db/schema";
import { secretMatches } from "@/lib/channels/webhook-auth";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { resolveContext } from "@/lib/ncdreg/context";
import { dispatchReminders } from "@/lib/ncdreg/recall/dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * NCD registry reminders (E3). Same `CRON_SECRET` Bearer auth as the other crons. Runs the
 * dispatcher as the `system` principal for each facility named by `NCD_REGISTRY` (a list of hospital
 * ids, or "1" for every facility with registry settings). Each run re-checks every reminder at send
 * time; outside a facility's send window nothing is decided. Not scheduled in vercel.json yet: the
 * owner adds the schedule when the registry goes live (docs/ncd/lanes/C.md).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const supplied = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!env.CRON_SECRET) {
    logger.error("cron.ncd-reminders.missing_secret");
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server." },
      { status: 503 },
    );
  }
  if (!supplied || !secretMatches(supplied, env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const flag = process.env.NCD_REGISTRY?.trim();
  if (!flag) return NextResponse.json({ ok: true, facilities: [] });
  const facilityIds =
    flag === "1"
      ? (await db.select({ id: ncdFacilitySettings.facilityId }).from(ncdFacilitySettings)).map(
          (r) => r.id,
        )
      : flag
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  const results: (DispatchSummary | { facilityId: string; error: string })[] = [];
  for (const facilityId of facilityIds) {
    try {
      const ctx = await resolveContext({ userId: null, facilityId, principal: "system" });
      results.push(await dispatchReminders(ctx));
    } catch (e) {
      logger.error("cron.ncd-reminders.facility_failed", {
        facilityId,
        error: e instanceof Error ? e.message : String(e),
      });
      results.push({ facilityId, error: "failed" });
    }
  }
  return NextResponse.json({ ok: true, facilities: results });
}
