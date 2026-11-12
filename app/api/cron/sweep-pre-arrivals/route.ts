import { NextResponse } from "next/server";
import { and, inArray, isNotNull, lte, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  emergencyPreArrivals,
  patientSymptomCatalogVersions,
  preArrivalOutbox,
  symptomSubmissions,
} from "@/db/schema/emergency";
import { secretMatches } from "@/lib/channels/webhook-auth";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const HOURS = 60 * 60 * 1000;
const LOCATION_TTL_MS = 72 * HOURS;
/** ADR 0098 Gate A item 8: non-arrived pre-alerts keep their PHI for 30 days. */
const PHI_RETENTION_MS = 30 * 24 * HOURS;

/**
 * The Emergency Pathway's jobs (PRD MS-PRD-SYM-001 §9.5; ADR 0098 ruling 5):
 *   1. sent/seen/ready rows past `expires_at` → `expired`;
 *   2. `location_enc` nulled 72 h after creation (district stays);
 *   3. non-arrived rows older than 30 days lose callback phone, location and
 *      the submission's free text — the row itself stays for the audit trail;
 *   4. nightly integrity: every submission's `catalog_version` is registered,
 *      and in production is `signed` (Gate CS). Counts are reported, never
 *      "fixed" — an unsigned version in production is an owner conversation.
 *
 * ponytail: vercel.json schedules this DAILY (`0 4 * * *`) — Vercel's Hobby
 * plan refuses any sub-daily expression at deploy time, as dispatch-reminders
 * notes. The 6-hour expiry is therefore honoured within ~24 h on the row; the
 * status screen's ack timeout is client-side and the board hides nothing on
 * `expires_at`, so a late sweep costs cosmetic staleness only. Upgrade path:
 * Vercel Pro `0 * * * *`, or Supabase pg_cron + pg_net hitting this route.
 *
 * Same `CRON_SECRET` Bearer auth as the other crons. Idempotent.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const supplied = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

  if (!env.CRON_SECRET) {
    logger.error("cron.sweep-pre-arrivals.missing_secret");
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
      .update(emergencyPreArrivals)
      .set({ status: "expired", closedAt: now })
      .where(
        and(
          inArray(emergencyPreArrivals.status, ["sent", "seen", "ready"]),
          lte(emergencyPreArrivals.expiresAt, now),
        ),
      )
      .returning({ id: emergencyPreArrivals.id });

    const locationsCleared = await db
      .update(emergencyPreArrivals)
      .set({ locationEnc: null })
      .where(
        and(
          isNotNull(emergencyPreArrivals.locationEnc),
          lte(emergencyPreArrivals.createdAt, new Date(now.getTime() - LOCATION_TTL_MS)),
        ),
      )
      .returning({ id: emergencyPreArrivals.id });

    const retentionCutoff = new Date(now.getTime() - PHI_RETENTION_MS);
    const purged = await db
      .update(emergencyPreArrivals)
      .set({ callbackPhoneEnc: null, locationEnc: null })
      .where(
        and(
          notInArray(emergencyPreArrivals.status, ["arrived"]),
          lte(emergencyPreArrivals.createdAt, retentionCutoff),
          or(
            isNotNull(emergencyPreArrivals.callbackPhoneEnc),
            isNotNull(emergencyPreArrivals.locationEnc),
          ),
        ),
      )
      .returning({ id: emergencyPreArrivals.id });
    // The outbox body is the encrypted SMS (it names the callback number):
    // it goes with the same purge.
    const outboxPurged = purged.length
      ? await db
          .delete(preArrivalOutbox)
          .where(
            inArray(
              preArrivalOutbox.preArrivalId,
              purged.map((p) => p.id),
            ),
          )
          .returning({ id: preArrivalOutbox.id })
      : [];
    const freeTextPurged = purged.length
      ? await db
          .update(symptomSubmissions)
          .set({ freeTextEnc: null })
          .where(
            and(
              isNotNull(symptomSubmissions.freeTextEnc),
              inArray(
                symptomSubmissions.preArrivalId,
                purged.map((p) => p.id),
              ),
            ),
          )
          .returning({ id: symptomSubmissions.id })
      : [];

    // Integrity: distinct catalog versions on submissions vs the provenance table.
    const strict = (process.env.MEDSYNC_ENV ?? process.env.VERCEL_ENV) === "production";
    const [used, registered] = await Promise.all([
      db
        .select({
          version: symptomSubmissions.catalogVersion,
          n: sql<number>`count(*)::int`,
        })
        .from(symptomSubmissions)
        .groupBy(symptomSubmissions.catalogVersion),
      db
        .select({
          version: patientSymptomCatalogVersions.version,
          status: patientSymptomCatalogVersions.status,
        })
        .from(patientSymptomCatalogVersions),
    ]);
    const statusOf = new Map(registered.map((r) => [r.version, r.status]));
    const unregistered = used.filter((u) => !statusOf.has(u.version));
    const unsigned = strict
      ? used.filter((u) => statusOf.has(u.version) && statusOf.get(u.version) !== "signed")
      : [];
    const integrity = {
      strict,
      versionsInUse: used.length,
      unregisteredVersions: unregistered.map((u) => u.version),
      unregisteredSubmissions: unregistered.reduce((a, u) => a + u.n, 0),
      unsignedVersions: unsigned.map((u) => u.version),
      unsignedSubmissions: unsigned.reduce((a, u) => a + u.n, 0),
    };

    const summary = {
      ok: true,
      expired: expired.length,
      locationsCleared: locationsCleared.length,
      purged: purged.length,
      freeTextPurged: freeTextPurged.length,
      outboxPurged: outboxPurged.length,
      integrity,
    };
    if (integrity.unregisteredVersions.length || integrity.unsignedVersions.length) {
      logger.error("cron.sweep-pre-arrivals.integrity", integrity);
    }
    logger.info("cron.sweep-pre-arrivals.ran", summary);
    return NextResponse.json(summary);
  } catch (e) {
    logger.error("cron.sweep-pre-arrivals.failed", { reason: String(e) });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
