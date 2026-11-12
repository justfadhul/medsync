import { NextResponse } from "next/server";
import { and, isNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { saBreakGlassGrants } from "@/db/schema/sa-break-glass-grants";
import { secretMatches } from "@/lib/channels/webhook-auth";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Sweep expired `sa_break_glass_grants` rows — marks `revoked_at`,
 * leaves `revoked_by` NULL (system), `revocation_reason='auto-expired'`.
 *
 * Wired to Vercel Cron via `vercel.json` (daily at 03:00 UTC; Hobby
 * plan caps cron to daily granularity). This is COSMETIC cleanup
 * only — the real PHI gate reads `expires_at` live on every access,
 * so a grant whose timer ran out is non-functional immediately, not
 * when this sweep runs. Worst case the operator's "active grants"
 * UI shows an expired row for up to ~24h before it gets revoked_at-
 * stamped. When the project moves to Pro this can drop back to
 * `*∕5 * * * *` for near-real-time UI freshness.
 *
 * Same `CRON_SECRET` Bearer auth as the drafts sweeper. Idempotent.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const supplied = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

  if (!env.CRON_SECRET) {
    logger.error("cron.sweep-break-glass.missing_secret");
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server." },
      { status: 503 },
    );
  }
  if (!supplied || !secretMatches(supplied, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const expired = await db
      .update(saBreakGlassGrants)
      .set({
        revokedAt: now,
        revokedBy: null,
        revocationReason: "auto-expired",
      })
      .where(and(lte(saBreakGlassGrants.expiresAt, now), isNull(saBreakGlassGrants.revokedAt)))
      .returning({ id: saBreakGlassGrants.id });

    logger.info("cron.sweep-break-glass.ran", { revoked: expired.length });
    return NextResponse.json({ ok: true, revoked: expired.length });
  } catch (e) {
    logger.error("cron.sweep-break-glass.failed", { reason: String(e) });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
