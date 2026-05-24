import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { cleanupExpiredDrafts } from "@/lib/signup-drafts";

export const dynamic = "force-dynamic";

/**
 * GATE G — sweeper for expired signup_drafts rows.
 *
 * Wired to a Vercel Cron (vercel.json) that runs nightly. Authenticated
 * via `Authorization: Bearer ${CRON_SECRET}` — both the Vercel Cron
 * runner and any manual `curl` for verification must supply this.
 *
 * Why the cleanup matters: signup_drafts.payload holds encrypted PHI
 * for in-flight signups. Leaving expired rows sitting around violates
 * the data-minimisation intent of the 14-day TTL. The TTL itself is
 * enforced at the column level; this route makes the deletion happen.
 *
 * Idempotent — running it twice in a row just deletes nothing the
 * second time.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const supplied = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

  if (!env.CRON_SECRET) {
    logger.error("cron.cleanup-drafts.missing_secret");
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server." },
      { status: 503 },
    );
  }
  if (!supplied || supplied !== env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const removed = await cleanupExpiredDrafts();
    logger.info("cron.cleanup-drafts.ran", { removed });
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    logger.error("cron.cleanup-drafts.failed", { reason: String(e) });
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
