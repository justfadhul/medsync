import { NextResponse } from "next/server";
import { and, eq, isNull, lt, notExists } from "drizzle-orm";

import { db } from "@/db";
import { ussdSessions } from "@/db/schema/channels";
import { onboardingEvents } from "@/db/schema/onboarding";
import { bookingAgents, provisionalPatients } from "@/db/schema/provisional-patients";
import { appointments } from "@/db/schema/scheduling";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { materialiseClinicSessions } from "@/lib/scheduling/materialise-sessions";
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
 *
 * Since ADR 0087 the same 02:00 run also materialises `clinic_sessions`
 * 14 days ahead from every active session template (a fourth Vercel cron
 * slot needs Pro). Idempotent too: UNIQUE (template_id, starts_at).
 * The two jobs are independent — a failure in one is logged and does not
 * stop the other.
 *
 * Since ADR 0089 a third job sweeps `provisional_patients` (migration 0060):
 * rows still `unreconciled` past `expires_at` that hold NO appointment and
 * NO live booking_agents link — a caller the desk booked for who never came
 * and whose booking is gone, never a household member someone still books
 * for. A row that holds a booking is the booking's provenance and stays
 * (the FK is RESTRICT anyway).
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

  let removed: number;
  try {
    removed = await cleanupExpiredDrafts();
    logger.info("cron.cleanup-drafts.ran", { removed });
  } catch (e) {
    logger.error("cron.cleanup-drafts.failed", { reason: String(e) });
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }

  let sessions: Awaited<ReturnType<typeof materialiseClinicSessions>>;
  try {
    sessions = await materialiseClinicSessions();
    logger.info("cron.materialise-sessions.ran", sessions);
  } catch (e) {
    logger.error("cron.materialise-sessions.failed", { reason: String(e) });
    return NextResponse.json({ error: "Session materialisation failed", removed }, { status: 500 });
  }

  try {
    const provisionals = await sweepExpiredProvisionals();
    logger.info("cron.sweep-provisionals.ran", { removed: provisionals });
    // Gate F (0062): USSD session state lives minutes (PRD §5.5); expired rows go.
    const ussd = (
      await db
        .delete(ussdSessions)
        .where(lt(ussdSessions.expiresAt, new Date()))
        .returning({ id: ussdSessions.id })
    ).length;
    logger.info("cron.sweep-ussd-sessions.ran", { removed: ussd });
    const events = await pruneOnboardingEvents();
    return NextResponse.json({ ok: true, removed, sessions, provisionals, ussd, events });
  } catch (e) {
    logger.error("cron.sweep-provisionals.failed", { reason: String(e) });
    return NextResponse.json(
      { error: "Provisional sweep failed", removed, sessions },
      { status: 500 },
    );
  }
}

/**
 * EV-3 (Onboarding v2): the funnel keeps 180 days (ONBOARDING_EVENTS_RETENTION_DAYS overrides).
 * Its own try: a failure here (e.g. before 0070 is applied) never stops the other sweeps.
 */
async function pruneOnboardingEvents(): Promise<number | null> {
  const days = Number(process.env.ONBOARDING_EVENTS_RETENTION_DAYS) || 180;
  try {
    const gone = await db
      .delete(onboardingEvents)
      .where(lt(onboardingEvents.createdAt, new Date(Date.now() - days * 86_400_000)))
      .returning({ id: onboardingEvents.id });
    logger.info("cron.prune-onboarding-events.ran", { removed: gone.length, days });
    return gone.length;
  } catch (e) {
    logger.warn("cron.prune-onboarding-events.failed", { reason: String(e) });
    return null;
  }
}

/** Unreconciled, expired, unbooked, unlinked — see the header. Idempotent. */
async function sweepExpiredProvisionals(): Promise<number> {
  const deleted = await db
    .delete(provisionalPatients)
    .where(
      and(
        eq(provisionalPatients.reconciliationState, "unreconciled"),
        lt(provisionalPatients.expiresAt, new Date()),
        notExists(
          db
            .select({ id: appointments.id })
            .from(appointments)
            .where(eq(appointments.provisionalPatientId, provisionalPatients.id)),
        ),
        notExists(
          db
            .select({ id: bookingAgents.id })
            .from(bookingAgents)
            .where(
              and(
                eq(bookingAgents.provisionalPatientId, provisionalPatients.id),
                isNull(bookingAgents.revokedAt),
              ),
            ),
        ),
      ),
    )
    .returning({ id: provisionalPatients.id });
  return deleted.length;
}
