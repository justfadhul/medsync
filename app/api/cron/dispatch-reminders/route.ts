import type { DispatchCopyArgs, DispatchRow, RelatedState } from "@/lib/notifications/dispatches";
import type { ReminderRow, SmsJob, SmsSender } from "@/lib/notifications/sink";
import { NextResponse } from "next/server";
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { smsOptOuts } from "@/db/schema/channels";
import { clinicSessions } from "@/db/schema/clinic-sessions";
import { consentRecords } from "@/db/schema/consent-records";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { notificationDispatches, pushTokens, waitlistEntries } from "@/db/schema/notifications";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { provisionalPatients } from "@/db/schema/provisional-patients";
import {
  appointmentReminders,
  appointments,
  departmentSchedulingPolicy,
} from "@/db/schema/scheduling";
import { serviceLines } from "@/db/schema/service-lines";
import { blindIndex, decrypt } from "@/lib/encryption";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAfricasTalkingSender } from "@/lib/notifications/africastalking";
import {
  composeDispatchPush,
  composeDispatchSms,
  dispatchRows,
  OFFER_WINDOW_MS,
  planDispatch,
  toDispatchInsertRow,
} from "@/lib/notifications/dispatches";
import { fetchExpoReceipts, sendExpoPush } from "@/lib/notifications/expo-push";
import {
  deliverSms,
  MAX_ROWS_SCANNED_PER_RUN,
  planReminderDispatch,
} from "@/lib/notifications/sink";
import { LIVE_APPOINTMENT_STATUSES } from "@/supabase/functions/_shared/slots";

export const dynamic = "force-dynamic";
/** A capped run is ~13 batches of 8 sends per queue; 60s is head-room, not a target. */
export const maxDuration = 60;

/**
 * The notification dispatcher — ONE cron, two queues (Gate E, ADR 0090).
 *
 *   1. `appointment_reminders` — Gate C's queue, drained until empty and
 *      never dropped (rows born before migration 0061). Byte-for-byte the
 *      behaviour it shipped with: `planReminderDispatch`, SMS only.
 *   2. `notification_dispatches` — every event since (proposal §5.11):
 *      push-first with SMS fallback, quiet hours, the consent gate, cost
 *      recorded per row, waitlist offers, session cancellations.
 *
 * Then the housekeeping that must ride the same 15-minute clock: Expo push
 * receipts (delivered / failed, dead tokens dropped), expired waitlist
 * offers cascaded to the next in line, and — only where a facility set
 * `release_unconfirmed_hours` — unconfirmed places released to the line.
 *
 * Same `CRON_SECRET` Bearer auth as the other crons.
 *
 * vercel.json schedules this every 15 minutes (`*∕15 * * * *`). That needs
 * Vercel PRO: Hobby refuses any sub-daily expression at DEPLOY time, so this
 * entry must not be deployed from a Hobby account (docs/booking-pilot/GO-LIVE.md).
 * Safe at that rate: the claim below, quiet-hour holds that move
 * `scheduled_at` to the window's end, and fallback rows keyed `:sms` with
 * ON CONFLICT DO NOTHING. tests/notifications/dispatches.test.ts runs a day
 * of 15-minute runs and fails on any second send.
 *
 * ── Idempotency, and which way it is allowed to fail ──
 * Rows are CLAIMED before the transport is touched: one conditional
 * `UPDATE … SET state='sent' WHERE id = ANY(…) AND state IN ('queued','held')`,
 * and only the ids Postgres returns are sent. Two overlapping runs serialise
 * on the row lock and the loser claims nothing, so no message goes twice.
 * AT-MOST-ONCE, chosen over at-least-once because a missed nudge costs one
 * patient one message while a duplicate costs money and trust on every
 * retry. A send that fails visibly is flipped back to `failed` with the
 * provider's words; a send lost to a crash between claim and provider call
 * reads `sent` and is not, and that is the price.
 *
 * ── PHI ──
 * Phones are ciphertext until the moment of send, decrypted only for rows
 * the planner decided to send, never logged, never returned. The message
 * names a place, a day, a code — no name, no reason, no clinician, and no
 * confidential service line (PRD §2.9). Nothing here writes `sa_audit_log`:
 * the dispatch row is itself the durable record of what was sent, to whom,
 * when, and at what cost.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const supplied = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

  if (!env.CRON_SECRET) {
    logger.error("cron.dispatch-reminders.missing_secret");
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server." },
      { status: 503 },
    );
  }
  if (!supplied || supplied !== env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Both of these are launch-blocking misconfigurations, and both return
  // 503 rather than a green 200-with-zero-sent: a cron that reports
  // success while every patient goes unreminded is the failure that hides
  // itself until the clinic is empty.
  const sender = createAfricasTalkingSender();
  if (!sender) {
    logger.error("cron.dispatch-reminders.sms_not_configured");
    return NextResponse.json(
      { error: "AFRICASTALKING_USERNAME / _API_KEY not configured — no reminder can be sent." },
      { status: 503 },
    );
  }
  if (!env.MEDSYNC_PHI_KEY) {
    logger.error("cron.dispatch-reminders.missing_phi_key");
    return NextResponse.json(
      { error: "MEDSYNC_PHI_KEY not configured — patient phones cannot be read." },
      { status: 503 },
    );
  }

  try {
    const now = new Date();
    const legacy = await drainReminders(sender, now);
    const receipts = await collectPushReceipts(now);
    const dispatches = await drainDispatches(sender, now);
    const waitlist = await expireWaitlistOffers(now);
    const released = await releaseUnconfirmed(now);
    const summary = { legacy, dispatches, receipts, waitlist, released };
    logger.info("cron.dispatch-reminders.ran", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    logger.error("cron.dispatch-reminders.failed", { reason: String(e) });
    return NextResponse.json({ error: "Dispatch failed" }, { status: 500 });
  }
}

/* ─── 1. the legacy queue (Gate C) — drained until empty, never dropped ── */

async function drainReminders(sender: SmsSender, now: Date) {
  // Hits `appointment_reminders_dispatcher_idx (state, scheduled_at)
  // WHERE state='queued'` head-on, and is bounded so a backlog cannot
  // page the whole queue into the function.
  const rows = await db
    .select({
      reminderId: appointmentReminders.id,
      appointmentId: appointmentReminders.appointmentId,
      channel: appointmentReminders.channel,
      state: appointmentReminders.state,
      kind: appointmentReminders.kind,
      scheduledAt: appointmentReminders.scheduledAt,
      appointmentStartsAt: appointments.startsAt,
      appointmentStatus: appointments.status,
      patientUserId: appointments.patientUserId,
      hospitalName: hospitals.name,
      // What a receipt names (ADR 0088): the service line when the booking
      // holds a session, the department otherwise — and neither when the
      // line is confidential (PRD §2.9): the handset may be shared. A SLOT
      // booking records no line, so its department is masked whenever that
      // department hosts a confidential line at all (conservative).
      serviceName: sql<string>`case when ${serviceLines.confidential} or exists (select 1 from public.service_lines cl where cl.department_id = ${appointments.departmentId} and cl.confidential) then 'Appointment' else coalesce(${serviceLines.name}, ${hospitalDepartments.name}) end`,
      bookingCode: appointments.bookingCode,
      positionNumber: appointments.positionNumber,
      arrivalWindowStart: appointments.arrivalWindowStart,
      arrivalWindowEnd: appointments.arrivalWindowEnd,
      // The patient's own phone; the provisional's when there is no account.
      phoneEncrypted: sql<
        string | null
      >`coalesce(${patientProfiles.phoneEncrypted}, ${provisionalPatients.phoneEncrypted})`,
    })
    .from(appointmentReminders)
    .innerJoin(appointments, eq(appointments.id, appointmentReminders.appointmentId))
    .innerJoin(hospitals, eq(hospitals.id, appointments.hospitalId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, appointments.departmentId))
    .leftJoin(clinicSessions, eq(clinicSessions.id, appointments.sessionId))
    .leftJoin(serviceLines, eq(serviceLines.id, clinicSessions.serviceLineId))
    .leftJoin(patientProfiles, eq(patientProfiles.id, appointments.patientUserId))
    .leftJoin(provisionalPatients, eq(provisionalPatients.id, appointments.provisionalPatientId))
    .where(
      and(eq(appointmentReminders.state, "queued"), lte(appointmentReminders.scheduledAt, now)),
    )
    .orderBy(asc(appointmentReminders.scheduledAt))
    .limit(MAX_ROWS_SCANNED_PER_RUN);

  const planRows: ReminderRow[] = rows.map((r) => ({
    reminderId: r.reminderId,
    appointmentId: r.appointmentId,
    channel: r.channel,
    state: r.state,
    kind: r.kind,
    scheduledAtIso: r.scheduledAt.toISOString(),
    appointmentStartsAtIso: r.appointmentStartsAt.toISOString(),
    appointmentStatus: r.appointmentStatus,
    patientUserId: r.patientUserId,
    hospitalName: r.hospitalName,
    serviceName: r.serviceName,
    bookingCode: r.bookingCode,
    positionNumber: r.positionNumber,
    arrivalWindowStartIso: r.arrivalWindowStart?.toISOString() ?? null,
    arrivalWindowEndIso: r.arrivalWindowEnd?.toISOString() ?? null,
  }));

  const plan = planReminderDispatch({ rows: planRows, now });

  // Reap first — cheap, and it shrinks the queue even if the transport
  // is having a bad day. Grouped so a backlog is a handful of statements.
  const reapGroups = new Map<string, { state: string; reason: string; ids: string[] }>();
  for (const reap of plan.reaps) {
    const key = `${reap.state}:${reap.reason}`;
    const group = reapGroups.get(key) ?? { state: reap.state, reason: reap.reason, ids: [] };
    group.ids.push(reap.reminderId);
    reapGroups.set(key, group);
  }
  for (const group of reapGroups.values()) {
    await db
      .update(appointmentReminders)
      .set({ state: group.state, failureReason: group.reason, updatedAt: now })
      .where(
        and(inArray(appointmentReminders.id, group.ids), eq(appointmentReminders.state, "queued")),
      );
  }

  // Resolve contact BEFORE claiming: a read costs nothing, and a row
  // claimed for a patient we cannot reach would be a reminder burnt for
  // no message. Decryption happens only for rows we decided to send.
  const contactByReminder = new Map<string, string>();
  const unreachable: string[] = [];
  const ciphertextByReminder = new Map(rows.map((r) => [r.reminderId, r.phoneEncrypted]));
  for (const send of plan.sends) {
    const ciphertext = ciphertextByReminder.get(send.reminderId);
    if (!ciphertext) {
      unreachable.push(send.reminderId);
      continue;
    }
    try {
      contactByReminder.set(send.reminderId, decrypt(ciphertext));
    } catch {
      // Never log the payload — a decrypt failure is a key or a
      // corrupt-column problem, and the column is PHI either way.
      unreachable.push(send.reminderId);
    }
  }
  if (unreachable.length > 0) {
    await db
      .update(appointmentReminders)
      .set({ state: "failed", failureReason: "no_reachable_phone", updatedAt: now })
      .where(
        and(
          inArray(appointmentReminders.id, unreachable),
          eq(appointmentReminders.state, "queued"),
        ),
      );
  }

  const claimable = plan.sends.filter((s) => contactByReminder.has(s.reminderId));
  let claimedIds: string[] = [];
  if (claimable.length > 0) {
    // THE CLAIM. `AND state='queued'` is what makes an overlapping run
    // a no-op instead of a second bill.
    const claimed = await db
      .update(appointmentReminders)
      .set({ state: "sent", sentAt: now, failureReason: null, updatedAt: now })
      .where(
        and(
          inArray(
            appointmentReminders.id,
            claimable.map((s) => s.reminderId),
          ),
          eq(appointmentReminders.state, "queued"),
        ),
      )
      .returning({ id: appointmentReminders.id });
    claimedIds = claimed.map((c) => c.id);
  }

  const claimedSet = new Set(claimedIds);
  const jobs: SmsJob[] = claimable
    .filter((s) => claimedSet.has(s.reminderId))
    .map((s) => ({
      reminderId: s.reminderId,
      toE164: contactByReminder.get(s.reminderId) as string,
      body: s.body,
    }));

  const outcomes = await deliverSms({ sender, jobs });
  const failures = outcomes.filter((o) => !o.ok);
  for (const failure of failures) {
    // Back to a re-queueable, explained state. One statement each:
    // failures are rare, and the provider's words differ per row.
    await db
      .update(appointmentReminders)
      .set({
        state: "failed",
        sentAt: null,
        failureReason: (failure.reason ?? "send_failed").slice(0, 300),
        updatedAt: now,
      })
      .where(eq(appointmentReminders.id, failure.reminderId));
  }

  const summary = {
    scanned: rows.length,
    sent: outcomes.length - failures.length,
    failed: failures.length + unreachable.length,
    reaped: plan.reaps.length,
    held: plan.held,
    substituted: plan.sends.filter((s) => s.substitutedFrom).length,
    // A full scan means there is more queue behind this run.
    backlog: rows.length === MAX_ROWS_SCANNED_PER_RUN,
  };
  return summary;
}

/* ─── 2. notification_dispatches (Gate E) ─────────────────────────── */

/** What a message may say about its related row. Ciphertext stays ciphertext until send. */
interface RelatedDetails {
  state: RelatedState;
  copy: Omit<
    DispatchCopyArgs,
    "kind" | "offerExpiresAtIso" | "nextSessionStartsAtIso" | "delayMinutes"
  >;
  /** The provisional's phone, when the booking names one. */
  phoneEncrypted: string | null;
}

const NEVER: RelatedState = { live: false, status: null, startsAtIso: null };

async function drainDispatches(sender: SmsSender, now: Date) {
  // Hits notification_dispatches_dispatcher_idx head-on; bounded.
  const due = await db
    .select()
    .from(notificationDispatches)
    .where(
      and(
        inArray(notificationDispatches.state, ["queued", "held"]),
        lte(notificationDispatches.scheduledAt, now),
        // Lab Phase 5: results-ready rows have their own sender (lib/notify/results-ready-store.ts).
        sql`${notificationDispatches.kind} <> 'results_ready'`,
      ),
    )
    .orderBy(asc(notificationDispatches.scheduledAt))
    .limit(MAX_ROWS_SCANNED_PER_RUN);

  // Sent push rows past their fallback instant with no ack and no SMS row
  // yet. Bounded to a day: after that the visit is over or the SMS went.
  const fallbackCandidates = await db
    .select()
    .from(notificationDispatches)
    .where(
      and(
        eq(notificationDispatches.channel, "push"),
        inArray(notificationDispatches.state, ["sent", "delivered"]),
        eq(notificationDispatches.fallbackChannel, "sms"),
        isNull(notificationDispatches.acknowledgedAt),
        lte(notificationDispatches.fallbackAfter, now),
        gt(notificationDispatches.fallbackAfter, new Date(now.getTime() - 24 * 3_600_000)),
        sql`not exists (select 1 from public.notification_dispatches f where f.idempotency_key = regexp_replace(${notificationDispatches.idempotencyKey}, ':push$', ':sms'))`,
      ),
    )
    .limit(200);

  const all = [...due, ...fallbackCandidates];
  if (all.length === 0) {
    return { scanned: 0, push: 0, sms: 0, fallbacks: 0, held: {}, reaped: 0, failed: 0 };
  }

  const appointmentIds = [
    ...new Set(all.filter((r) => r.relatedKind === "appointment").map((r) => r.relatedId)),
  ];
  const entryIds = [
    ...new Set(all.filter((r) => r.relatedKind === "waitlist_entry").map((r) => r.relatedId)),
  ];
  const userIds = [...new Set(all.flatMap((r) => (r.recipientUserId ? [r.recipientUserId] : [])))];
  const hospitalIds = [...new Set(all.flatMap((r) => (r.hospitalId ? [r.hospitalId] : [])))];

  const related = new Map<string, RelatedDetails>();
  if (appointmentIds.length > 0) {
    const rows = await db
      .select({
        id: appointments.id,
        status: appointments.status,
        startsAt: appointments.startsAt,
        hospitalName: hospitals.name,
        serviceName: sql<string>`case when ${serviceLines.confidential} or exists (select 1 from public.service_lines cl where cl.department_id = ${appointments.departmentId} and cl.confidential) then 'Appointment' else coalesce(${serviceLines.name}, ${hospitalDepartments.name}) end`,
        bookingCode: appointments.bookingCode,
        positionNumber: appointments.positionNumber,
        arrivalWindowStart: appointments.arrivalWindowStart,
        arrivalWindowEnd: appointments.arrivalWindowEnd,
        provisionalPhone: provisionalPatients.phoneEncrypted,
      })
      .from(appointments)
      .innerJoin(hospitals, eq(hospitals.id, appointments.hospitalId))
      .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, appointments.departmentId))
      .leftJoin(clinicSessions, eq(clinicSessions.id, appointments.sessionId))
      .leftJoin(serviceLines, eq(serviceLines.id, clinicSessions.serviceLineId))
      .leftJoin(provisionalPatients, eq(provisionalPatients.id, appointments.provisionalPatientId))
      .where(inArray(appointments.id, appointmentIds));
    for (const a of rows) {
      related.set(`appointment:${a.id}`, {
        state: {
          live: (LIVE_APPOINTMENT_STATUSES as readonly string[]).includes(a.status),
          status: a.status,
          startsAtIso: a.startsAt.toISOString(),
        },
        copy: {
          hospitalName: a.hospitalName,
          serviceName: a.serviceName,
          startsAtIso: a.startsAt.toISOString(),
          bookingCode: a.bookingCode,
          positionNumber: a.positionNumber,
          arrivalWindowStartIso: a.arrivalWindowStart?.toISOString() ?? null,
          arrivalWindowEndIso: a.arrivalWindowEnd?.toISOString() ?? null,
          offeredStartsAtIso: null,
        },
        phoneEncrypted: a.provisionalPhone,
      });
    }
  }
  if (entryIds.length > 0) {
    const rows = await db
      .select({
        id: waitlistEntries.id,
        state: waitlistEntries.state,
        offeredStartsAt: waitlistEntries.offeredStartsAt,
        hospitalName: hospitals.name,
        serviceName: sql<string>`case when ${serviceLines.confidential} then 'Appointment' else ${serviceLines.name} end`,
        provisionalPhone: provisionalPatients.phoneEncrypted,
      })
      .from(waitlistEntries)
      .innerJoin(hospitals, eq(hospitals.id, waitlistEntries.hospitalId))
      .innerJoin(serviceLines, eq(serviceLines.id, waitlistEntries.serviceLineId))
      .leftJoin(
        provisionalPatients,
        eq(provisionalPatients.id, waitlistEntries.provisionalPatientId),
      )
      .where(inArray(waitlistEntries.id, entryIds));
    for (const w of rows) {
      related.set(`waitlist_entry:${w.id}`, {
        state: {
          live: w.state === "offered",
          status: w.state,
          startsAtIso: w.offeredStartsAt?.toISOString() ?? null,
        },
        copy: {
          hospitalName: w.hospitalName,
          serviceName: w.serviceName,
          startsAtIso: null,
          bookingCode: null,
          positionNumber: null,
          arrivalWindowStartIso: null,
          arrivalWindowEndIso: null,
          offeredStartsAtIso: w.offeredStartsAt?.toISOString() ?? null,
        },
        phoneEncrypted: w.provisionalPhone,
      });
    }
  }

  // Gate F: a reply to an inbound SMS relates to nothing that can expire —
  // it is live until sent, and says what its payload key says.
  for (const r of all) {
    if (r.relatedKind !== "inbound_sms") continue;
    related.set(`inbound_sms:${r.relatedId}`, {
      state: { live: true, status: "received", startsAtIso: null },
      copy: {
        hospitalName: "",
        serviceName: "",
        startsAtIso: null,
        bookingCode: ((r.payload as { booking_code?: string | null }).booking_code ?? null) as
          | string
          | null,
        positionNumber: null,
        arrivalWindowStartIso: null,
        arrivalWindowEndIso: null,
        offeredStartsAtIso: null,
      },
      phoneEncrypted: null,
    });
  }

  const tokensByUser = new Map<string, string[]>();
  const consentByUser = new Map<string, boolean>();
  const profilePhoneByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const [tokens, consents, profiles] = await Promise.all([
      db
        .select({ userId: pushTokens.userId, token: pushTokens.token })
        .from(pushTokens)
        .where(inArray(pushTokens.userId, userIds)),
      db
        .selectDistinct({ userId: consentRecords.userId })
        .from(consentRecords)
        .where(
          and(
            inArray(consentRecords.userId, userIds),
            eq(consentRecords.consentType, "sms_communication"),
            isNull(consentRecords.revokedAt),
          ),
        ),
      db
        .select({ id: patientProfiles.id, phone: patientProfiles.phoneEncrypted })
        .from(patientProfiles)
        .where(inArray(patientProfiles.id, userIds)),
    ]);
    for (const t of tokens)
      tokensByUser.set(t.userId, [...(tokensByUser.get(t.userId) ?? []), t.token]);
    for (const c of consents) consentByUser.set(c.userId, true);
    for (const p of profiles) profilePhoneByUser.set(p.id, p.phone);
  }
  const quietHoursByHospital = new Map(
    hospitalIds.length === 0
      ? []
      : (
          await db
            .select({
              id: hospitals.id,
              start: hospitals.quietHoursStartMinutesLocal,
              end: hospitals.quietHoursEndMinutesLocal,
            })
            .from(hospitals)
            .where(inArray(hospitals.id, hospitalIds))
        ).map((h) => [h.id, { startMinutes: h.start, endMinutes: h.end }]),
  );

  const ciphertextFor = (r: (typeof all)[number]) =>
    r.recipientPhoneEncrypted ??
    (r.recipientUserId ? profilePhoneByUser.get(r.recipientUserId) : undefined) ??
    related.get(`${r.relatedKind}:${r.relatedId}`)?.phoneEncrypted ??
    null;

  const planRows: DispatchRow[] = all.map((r) => ({
    id: r.id,
    hospitalId: r.hospitalId,
    kind: r.kind,
    channel: r.channel,
    state: r.state,
    scheduledAtIso: r.scheduledAt.toISOString(),
    fallbackChannel: r.fallbackChannel,
    fallbackAfterIso: r.fallbackAfter?.toISOString() ?? null,
    acknowledgedAtIso: r.acknowledgedAt?.toISOString() ?? null,
    recipientUserId: r.recipientUserId,
    hasPhone: ciphertextFor(r) !== null,
    idempotencyKey: r.idempotencyKey,
    relatedKind: r.relatedKind,
    relatedId: r.relatedId,
    payload: r.payload,
    related: related.get(`${r.relatedKind}:${r.relatedId}`)?.state ?? NEVER,
  }));

  const plan = planDispatch({
    rows: planRows,
    now,
    quietHoursByHospital,
    tokensByUser,
    consentByUser,
  });

  // Reap first — cheap, and it shrinks the queue whatever the transport does.
  const reapGroups = new Map<string, { state: string; reason: string; ids: string[] }>();
  for (const reap of plan.reaps) {
    const key = `${reap.state}:${reap.reason}`;
    const group = reapGroups.get(key) ?? { state: reap.state, reason: reap.reason, ids: [] };
    group.ids.push(reap.dispatchId);
    reapGroups.set(key, group);
  }
  for (const group of reapGroups.values()) {
    await db
      .update(notificationDispatches)
      .set({ state: group.state, failureReason: group.reason, updatedAt: now })
      .where(
        and(
          inArray(notificationDispatches.id, group.ids),
          inArray(notificationDispatches.state, ["queued", "held"]),
        ),
      );
  }

  // Quiet hours: park the row until the window ends.
  for (const h of plan.holds) {
    if (!h.releaseAtIso) continue;
    await db
      .update(notificationDispatches)
      .set({ state: "held", scheduledAt: new Date(h.releaseAtIso), updatedAt: now })
      .where(
        and(
          eq(notificationDispatches.id, h.dispatchId),
          inArray(notificationDispatches.state, ["queued", "held"]),
        ),
      );
  }

  // Fallback SMS rows — idempotent on the key; sent next run.
  if (plan.fallbacks.length > 0) {
    await db
      .insert(notificationDispatches)
      .values(plan.fallbacks.map((f) => toDispatchInsertRow(f.insert)))
      .onConflictDoNothing({ target: notificationDispatches.idempotencyKey });
  }

  const heldByReason: Record<string, number> = {};
  for (const h of plan.holds) heldByReason[h.reason] = (heldByReason[h.reason] ?? 0) + 1;

  // Resolve contact BEFORE claiming; decrypt only what we send.
  const byId = new Map(all.map((r) => [r.id, r]));
  const phoneByDispatch = new Map<string, string>();
  const unreachable: string[] = [];
  for (const s of plan.smsSends) {
    const ciphertext = ciphertextFor(byId.get(s.dispatchId) as (typeof all)[number]);
    if (!ciphertext) {
      unreachable.push(s.dispatchId);
      continue;
    }
    try {
      phoneByDispatch.set(s.dispatchId, decrypt(ciphertext));
    } catch {
      unreachable.push(s.dispatchId);
    }
  }
  if (unreachable.length > 0) {
    await db
      .update(notificationDispatches)
      .set({ state: "failed", failureReason: "no_reachable_phone", updatedAt: now })
      .where(
        and(
          inArray(notificationDispatches.id, unreachable),
          inArray(notificationDispatches.state, ["queued", "held"]),
        ),
      );
  }

  // Gate F: "Reply STOP to opt out" — by phone, stronger than consent, the
  // receipt included. The one SMS an opted-out phone still gets is the
  // reply that confirms the STOP itself.
  if (phoneByDispatch.size > 0) {
    const hmacByDispatch = new Map(
      [...phoneByDispatch].map(([id, phone]) => [id, blindIndex(phone)] as const),
    );
    const stopped = new Set(
      (
        await db
          .select({ phoneHmac: smsOptOuts.phoneHmac })
          .from(smsOptOuts)
          .where(inArray(smsOptOuts.phoneHmac, [...new Set(hmacByDispatch.values())]))
      ).map((r) => r.phoneHmac),
    );
    const optedOut = [...hmacByDispatch]
      .filter(([id, hmac]) => {
        if (!stopped.has(hmac)) return false;
        const r = byId.get(id);
        return !(r?.kind === "sms_reply" && (r.payload as { reply?: string }).reply === "stopped");
      })
      .map(([id]) => id);
    if (optedOut.length > 0) {
      for (const id of optedOut) phoneByDispatch.delete(id);
      await db
        .update(notificationDispatches)
        .set({ state: "cancelled", failureReason: "sms_opted_out", updatedAt: now })
        // Conditional like the claim: an overlapping run may already have sent it.
        .where(
          and(
            inArray(notificationDispatches.id, optedOut),
            inArray(notificationDispatches.state, ["queued", "held"]),
          ),
        );
    }
  }

  const copyFor = (dispatchId: string): DispatchCopyArgs => {
    const r = byId.get(dispatchId) as (typeof all)[number];
    const d = related.get(`${r.relatedKind}:${r.relatedId}`);
    const p = r.payload as {
      next_session_starts_at?: string | null;
      delay_minutes?: number;
      reply?: string;
    };
    return {
      kind: r.kind,
      hospitalName: d?.copy.hospitalName ?? "",
      serviceName: d?.copy.serviceName ?? "",
      startsAtIso: d?.copy.startsAtIso ?? null,
      bookingCode: d?.copy.bookingCode ?? null,
      positionNumber: d?.copy.positionNumber ?? null,
      arrivalWindowStartIso: d?.copy.arrivalWindowStartIso ?? null,
      arrivalWindowEndIso: d?.copy.arrivalWindowEndIso ?? null,
      offeredStartsAtIso: d?.copy.offeredStartsAtIso ?? null,
      offerExpiresAtIso:
        r.kind === "waitlist_offer"
          ? new Date(now.getTime() + OFFER_WINDOW_MS).toISOString()
          : null,
      nextSessionStartsAtIso: p.next_session_starts_at ?? null,
      delayMinutes: p.delay_minutes ?? null,
      replyKey: p.reply ?? null,
    };
  };

  // THE CLAIM — both channels in one statement.
  const claimable = [
    ...plan.pushSends.map((s) => s.dispatchId),
    ...plan.smsSends.filter((s) => phoneByDispatch.has(s.dispatchId)).map((s) => s.dispatchId),
  ];
  const claimed = new Set(
    claimable.length === 0
      ? []
      : (
          await db
            .update(notificationDispatches)
            .set({ state: "sent", sentAt: now, failureReason: null, updatedAt: now })
            .where(
              and(
                inArray(notificationDispatches.id, claimable),
                inArray(notificationDispatches.state, ["queued", "held"]),
              ),
            )
            .returning({ id: notificationDispatches.id })
        ).map((c) => c.id),
  );

  // Push: one message per device; ticket ids recorded for the receipt pass.
  let pushSent = 0;
  let pushFailed = 0;
  const pushJobs = plan.pushSends.filter((s) => claimed.has(s.dispatchId));
  if (pushJobs.length > 0) {
    const messages = pushJobs.flatMap((s) => {
      const { title, body } = composeDispatchPush(copyFor(s.dispatchId));
      return s.tokens.map((to) => ({
        to,
        title,
        body,
        data: {
          dispatch_id: s.dispatchId,
          kind: s.kind,
          related_kind: s.relatedKind,
          related_id: s.relatedId,
          ...s.payload,
        },
      }));
    });
    const tickets = await sendExpoPush(messages);
    let i = 0;
    for (const s of pushJobs) {
      const own = tickets.slice(i, i + s.tokens.length);
      i += s.tokens.length;
      const ok = own.filter((t) => t.status === "ok");
      const dead = own.filter((t) => t.status === "error" && t.error === "DeviceNotRegistered");
      if (dead.length > 0) {
        await db.delete(pushTokens).where(
          inArray(
            pushTokens.token,
            dead.map((t) => t.to),
          ),
        );
      }
      if (ok.length > 0) {
        pushSent += 1;
        await db
          .update(notificationDispatches)
          .set({
            providerMessageId: ok.map((t) => (t.status === "ok" ? t.id : "")).join(","),
            updatedAt: now,
          })
          .where(eq(notificationDispatches.id, s.dispatchId));
      } else {
        pushFailed += 1;
        const reason = own.map((t) => (t.status === "error" ? t.message : "")).join("; ");
        await db
          .update(notificationDispatches)
          .set({
            state: "failed",
            sentAt: null,
            failureReason: (reason || "push_failed").slice(0, 300),
            updatedAt: now,
          })
          .where(eq(notificationDispatches.id, s.dispatchId));
      }
    }
  }

  // SMS: the same transport as the legacy queue, cost recorded per row.
  const smsJobs: SmsJob[] = plan.smsSends
    .filter((s) => claimed.has(s.dispatchId))
    .map((s) => ({
      reminderId: s.dispatchId,
      toE164: phoneByDispatch.get(s.dispatchId) as string,
      body: composeDispatchSms(copyFor(s.dispatchId)),
    }));
  const outcomes = await deliverSms({ sender, jobs: smsJobs });
  let smsSent = 0;
  const offeredEntries: string[] = [];
  for (const o of outcomes) {
    if (o.ok) {
      smsSent += 1;
      await db
        .update(notificationDispatches)
        .set({
          providerMessageId: o.providerMessageId ?? null,
          costAmount: o.cost?.amount ?? null,
          costCurrency: o.cost?.currency ?? null,
          updatedAt: now,
        })
        .where(eq(notificationDispatches.id, o.reminderId));
    } else {
      await db
        .update(notificationDispatches)
        .set({
          state: "failed",
          sentAt: null,
          failureReason: (o.reason ?? "send_failed").slice(0, 300),
          updatedAt: now,
        })
        .where(eq(notificationDispatches.id, o.reminderId));
    }
  }
  // The offer's clock starts when it is SENT (either channel).
  for (const s of [...pushJobs, ...plan.smsSends]) {
    if (s.kind === "waitlist_offer" && claimed.has(s.dispatchId)) offeredEntries.push(s.relatedId);
  }
  if (offeredEntries.length > 0) {
    await db
      .update(waitlistEntries)
      .set({ offerExpiresAt: new Date(now.getTime() + OFFER_WINDOW_MS) })
      .where(
        and(
          inArray(waitlistEntries.id, [...new Set(offeredEntries)]),
          eq(waitlistEntries.state, "offered"),
        ),
      );
  }

  return {
    scanned: all.length,
    push: pushSent,
    sms: smsSent,
    fallbacks: plan.fallbacks.length,
    held: heldByReason,
    reaped: plan.reaps.length,
    failed: pushFailed + (outcomes.length - smsSent) + unreachable.length,
    backlog: due.length === MAX_ROWS_SCANNED_PER_RUN,
  };
}

/* ─── 3. Expo push receipts (the previous run's tickets) ──────────── */

async function collectPushReceipts(now: Date) {
  const rows = await db
    .select({ id: notificationDispatches.id, ids: notificationDispatches.providerMessageId })
    .from(notificationDispatches)
    .where(
      and(
        eq(notificationDispatches.channel, "push"),
        eq(notificationDispatches.state, "sent"),
        isNotNull(notificationDispatches.providerMessageId),
        // Expo keeps receipts for a day; older tickets are unknowable.
        gte(notificationDispatches.sentAt, new Date(now.getTime() - 24 * 3_600_000)),
      ),
    )
    .limit(1000);
  if (rows.length === 0) return { checked: 0, delivered: 0, failed: 0, tokensDropped: 0 };

  const receipts = await fetchExpoReceipts(
    rows.flatMap((r) => (r.ids ?? "").split(",").filter(Boolean)),
  );
  let delivered = 0;
  let failed = 0;
  let tokensDropped = 0;
  for (const r of rows) {
    const own = (r.ids ?? "")
      .split(",")
      .filter(Boolean)
      .map((id) => receipts.get(id));
    if (own.some((x) => x === undefined)) continue; // not processed yet
    const dead = own.flatMap((x) =>
      x?.error === "DeviceNotRegistered" && x.expoPushToken ? [x.expoPushToken] : [],
    );
    if (dead.length > 0) {
      await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
      tokensDropped += dead.length;
    }
    if (own.some((x) => x?.status === "ok")) {
      delivered += 1;
      await db
        .update(notificationDispatches)
        .set({ state: "delivered", deliveredAt: now, updatedAt: now })
        .where(and(eq(notificationDispatches.id, r.id), eq(notificationDispatches.state, "sent")));
    } else {
      failed += 1;
      await db
        .update(notificationDispatches)
        .set({
          state: "failed",
          failureReason: own
            .map((x) => x?.error ?? x?.message ?? "push_receipt_error")
            .join("; ")
            .slice(0, 300),
          updatedAt: now,
        })
        .where(and(eq(notificationDispatches.id, r.id), eq(notificationDispatches.state, "sent")));
    }
  }
  return { checked: rows.length, delivered, failed, tokensDropped };
}

/* ─── 4. waitlist offers: expire and cascade ──────────────────────── */

/**
 * The next in line, offered through the same SQL the Edge hooks use
 * (`offer_released_capacity`, migration 0061), plus the `waitlist_offer`
 * dispatch rows from the same builder. The Node twin of
 * `_shared/waitlist.ts`'s `releaseCapacity`.
 */
async function offerToNext(appointmentId: string, now: Date): Promise<string | null> {
  const offered = await db.execute<{
    entry_id: string;
    patient_user_id: string | null;
    phone_encrypted: string | null;
    hospital_id: string;
    offered_session_id: string | null;
  }>(sql`select * from public.offer_released_capacity(${appointmentId}::uuid)`);
  const offer = offered[0];
  if (!offer) return null;
  const recipient = offer.patient_user_id
    ? { userId: offer.patient_user_id }
    : offer.phone_encrypted
      ? { phoneEncrypted: offer.phone_encrypted }
      : null;
  if (!recipient) return offer.entry_id;
  const rows = dispatchRows({
    kind: "waitlist_offer",
    hospitalId: offer.hospital_id,
    recipient,
    nowIso: now.toISOString(),
    waitlistEntryId: offer.entry_id,
    offeredSessionId: offer.offered_session_id,
  });
  await db
    .insert(notificationDispatches)
    .values(rows.map(toDispatchInsertRow))
    .onConflictDoNothing({ target: notificationDispatches.idempotencyKey });
  return offer.entry_id;
}

async function expireWaitlistOffers(now: Date) {
  // An offer whose dispatch has not gone out yet (quiet hours) is not
  // expired: its clock starts when it is sent.
  const expired = await db
    .update(waitlistEntries)
    .set({ state: "expired" })
    .where(
      and(
        eq(waitlistEntries.state, "offered"),
        lte(waitlistEntries.offerExpiresAt, now),
        sql`not exists (select 1 from public.notification_dispatches d where d.related_kind = 'waitlist_entry' and d.related_id = ${waitlistEntries.id} and d.state in ('queued','held'))`,
      ),
    )
    .returning({
      id: waitlistEntries.id,
      releasedAppointmentId: waitlistEntries.releasedAppointmentId,
    });
  let cascaded = 0;
  for (const e of expired) {
    await db
      .update(notificationDispatches)
      .set({ state: "cancelled", failureReason: "offer_expired", updatedAt: now })
      .where(
        and(
          eq(notificationDispatches.relatedKind, "waitlist_entry"),
          eq(notificationDispatches.relatedId, e.id),
          inArray(notificationDispatches.state, ["queued", "held"]),
        ),
      );
    if (e.releasedAppointmentId && (await offerToNext(e.releasedAppointmentId, now))) cascaded += 1;
  }
  return { expired: expired.length, cascaded };
}

/* ─── 5. unconfirmed release — facility policy, OFF by default ────── */

async function releaseUnconfirmed(now: Date) {
  // Only where the department set release_unconfirmed_hours, only visits a
  // confirmation request was actually SENT for, only inside the window.
  const due = await db
    .select({
      id: appointments.id,
      hospitalId: appointments.hospitalId,
      sessionId: appointments.sessionId,
      patientUserId: appointments.patientUserId,
      provisionalPhone: provisionalPatients.phoneEncrypted,
    })
    .from(appointments)
    .innerJoin(
      departmentSchedulingPolicy,
      eq(departmentSchedulingPolicy.departmentId, appointments.departmentId),
    )
    .leftJoin(provisionalPatients, eq(provisionalPatients.id, appointments.provisionalPatientId))
    .where(
      and(
        isNotNull(departmentSchedulingPolicy.releaseUnconfirmedHours),
        eq(appointments.status, "confirmed"),
        isNull(appointments.confirmedByPatientAt),
        gt(appointments.startsAt, now),
        sql`${appointments.startsAt} <= ${now} + make_interval(hours => ${departmentSchedulingPolicy.releaseUnconfirmedHours})`,
        sql`exists (select 1 from public.notification_dispatches d where d.related_kind = 'appointment' and d.related_id = ${appointments.id} and d.kind = 'confirmation_request' and d.state in ('sent','delivered'))`,
      ),
    )
    .limit(100);

  let released = 0;
  for (const a of due) {
    const flipped = await db
      .update(appointments)
      .set({ status: "cancelled", cancelledReason: "unconfirmed_release", updatedAt: now })
      .where(and(eq(appointments.id, a.id), eq(appointments.status, "confirmed")))
      .returning({ id: appointments.id });
    if (flipped.length === 0) continue;
    released += 1;
    if (a.sessionId) {
      await db.execute(sql`select public.release_session_position(${a.sessionId}::uuid)`);
    }
    await db
      .update(notificationDispatches)
      .set({ state: "cancelled", failureReason: "unconfirmed_release", updatedAt: now })
      .where(
        and(
          eq(notificationDispatches.relatedKind, "appointment"),
          eq(notificationDispatches.relatedId, a.id),
          inArray(notificationDispatches.state, ["queued", "held"]),
        ),
      );
    const recipient = a.patientUserId
      ? { userId: a.patientUserId }
      : a.provisionalPhone
        ? { phoneEncrypted: a.provisionalPhone }
        : null;
    if (recipient) {
      const rows = dispatchRows({
        kind: "unconfirmed_release",
        hospitalId: a.hospitalId,
        recipient,
        nowIso: now.toISOString(),
        appointmentId: a.id,
      });
      await db
        .insert(notificationDispatches)
        .values(rows.map(toDispatchInsertRow))
        .onConflictDoNothing({ target: notificationDispatches.idempotencyKey });
    }
    await offerToNext(a.id, now);
  }
  return { released };
}
