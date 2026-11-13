import type { notificationDispatches } from "@/db/schema/notifications";
import type { DispatchInsert, DispatchKind } from "@/supabase/functions/_shared/dispatches";

import { DEFAULT_LANGUAGE, t } from "@/lib/channels/strings";
import { composeReceiptSms } from "@/lib/notifications/receipt";
import { MAX_SENDS_PER_RUN, STALE_GRACE_MINUTES } from "@/lib/notifications/sink";
import {
  CAP_EXEMPT,
  fallbackKey,
  HELD_IN_QUIET_HOURS,
  SMS_WITHOUT_CONSENT,
} from "@/supabase/functions/_shared/dispatches";
import {
  DEFAULT_TIME_ZONE,
  localWeekdayAndMinutes,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";

/**
 * The `notification_dispatches` planner — the pure decision layer of the
 * Gate E dispatcher (ADR 0090). No DB, no network, NO PHI: a row carries
 * `hasPhone`, never a number, and the recipient's tokens are opaque.
 *
 * The builder (`dispatchRows`) is re-exported from the zero-import Deno
 * file so the Next side has one import path for both halves.
 */
export {
  bookingDispatchRows,
  BOTH_CHANNELS_ALWAYS,
  CAP_EXEMPT,
  dispatchKey,
  dispatchRows,
  fallbackKey,
  HELD_IN_QUIET_HOURS,
  LEADS,
  OFFER_WINDOW_MS,
  SMS_WITHOUT_CONSENT,
  WINDOW_SHIFT_THRESHOLD_MINUTES,
} from "@/supabase/functions/_shared/dispatches";
export type {
  DispatchChannel,
  DispatchEvent,
  DispatchInsert,
  DispatchKind,
  DispatchRecipient,
  DispatchRelatedKind,
} from "@/supabase/functions/_shared/dispatches";

/** `dispatchRows()` speaks the wire shape (snake_case); Drizzle wants the column names. */
export function toDispatchInsertRow(r: DispatchInsert): typeof notificationDispatches.$inferInsert {
  return {
    hospitalId: r.hospital_id,
    kind: r.kind,
    recipientUserId: r.recipient_user_id,
    recipientPhoneEncrypted: r.recipient_phone_encrypted,
    language: r.language,
    channel: r.channel,
    fallbackChannel: r.fallback_channel,
    scheduledAt: new Date(r.scheduled_at),
    fallbackAfter: r.fallback_after ? new Date(r.fallback_after) : null,
    idempotencyKey: r.idempotency_key,
    relatedKind: r.related_kind,
    relatedId: r.related_id,
    payload: r.payload,
  };
}

/* ─── inputs ─────────────────────────────────────────────────────── */

/** What the related row (appointment / waitlist entry) says about itself. */
export interface RelatedState {
  /** Still worth sending about: a live appointment, an `offered` entry. */
  live: boolean;
  /** `appointments.status`, or the waitlist entry's state. */
  status: string | null;
  /** The visit's start, for the elapsed / stale / cap rules. */
  startsAtIso: string | null;
}

/** One `notification_dispatches` row as the planner sees it. No PHI. */
export interface DispatchRow {
  id: string;
  /** Null (0062): a platform reply — default quiet hours, no facility's "Sent today". */
  hospitalId: string | null;
  kind: string;
  channel: string;
  state: string;
  scheduledAtIso: string;
  fallbackChannel: string | null;
  fallbackAfterIso: string | null;
  acknowledgedAtIso: string | null;
  recipientUserId: string | null;
  /** A reachable phone exists (the row's ciphertext, or the profile's). */
  hasPhone: boolean;
  idempotencyKey: string;
  relatedKind: string;
  relatedId: string;
  payload: Record<string, unknown>;
  related: RelatedState;
}

/** `hospitals.quiet_hours_*` — minutes past local midnight; wraps when start > end. */
export interface QuietHours {
  startMinutes: number;
  endMinutes: number;
}

/** 21:00–07:00, the column DEFAULT. */
export const DEFAULT_QUIET_HOURS: QuietHours = { startMinutes: 1260, endMinutes: 420 };

export interface PlanDispatchArgs {
  rows: ReadonlyArray<DispatchRow>;
  now: Date;
  quietHoursByHospital: ReadonlyMap<string, QuietHours>;
  tokensByUser: ReadonlyMap<string, ReadonlyArray<string>>;
  /** A granted `sms_communication` consent record exists. */
  consentByUser: ReadonlyMap<string, boolean>;
  timeZone?: string;
}

/* ─── outputs ────────────────────────────────────────────────────── */

export interface PushSend {
  dispatchId: string;
  recipientUserId: string;
  tokens: ReadonlyArray<string>;
  kind: string;
  hospitalId: string | null;
  relatedKind: string;
  relatedId: string;
  payload: Record<string, unknown>;
}

export interface SmsSend {
  dispatchId: string;
  recipientUserId: string | null;
  kind: string;
  hospitalId: string | null;
  relatedKind: string;
  relatedId: string;
  payload: Record<string, unknown>;
}

export interface DispatchHold {
  dispatchId: string;
  reason: string;
  /** Set for a quiet-hours hold: the row is re-scheduled to this instant. */
  releaseAtIso?: string;
}

export interface DispatchFallback {
  fromDispatchId: string;
  insert: DispatchInsert;
}

export interface DispatchReap {
  dispatchId: string;
  state: "cancelled" | "failed";
  reason: string;
}

export interface DispatchPlan {
  pushSends: PushSend[];
  smsSends: SmsSend[];
  holds: DispatchHold[];
  fallbacks: DispatchFallback[];
  reaps: DispatchReap[];
}

/* ─── rules ──────────────────────────────────────────────────────── */

/** Kinds whose meaning expires with the visit's start. */
const START_BOUND: ReadonlySet<string> = new Set([
  "confirmation_request",
  "arrival_window",
  "reminder",
  "window_shifted",
]);

/**
 * Kinds that ANNOUNCE the end of a visit: their appointment is cancelled by
 * design, so rule C must not reap them for it (it did, so a cancelled clinic
 * day was never told — ADR 0473).
 */
const ABOUT_AN_ENDED_VISIT: ReadonlySet<string> = new Set([
  "session_cancelled",
  "unconfirmed_release",
  "visit_cancelled",
]);

/** Appointment kinds that wait for the clinician's confirmation of a slot request. */
const NEEDS_CONFIRMED_APPOINTMENT: ReadonlySet<string> = new Set([
  "booking_receipt",
  "confirmation_request",
  "arrival_window",
]);

/** True when `now` falls inside the facility's quiet window. */
export function inQuietHours(now: Date, quiet: QuietHours, timeZone = DEFAULT_TIME_ZONE): boolean {
  if (quiet.startMinutes === quiet.endMinutes) return false;
  const m = localWeekdayAndMinutes(now, timeZone).minutesOfDay;
  return quiet.startMinutes < quiet.endMinutes
    ? m >= quiet.startMinutes && m < quiet.endMinutes
    : m >= quiet.startMinutes || m < quiet.endMinutes;
}

/** The next instant the quiet window ends — today's end, or tomorrow's when it has passed. */
export function quietHoursEnd(now: Date, quiet: QuietHours, timeZone = DEFAULT_TIME_ZONE): Date {
  const midnight = startOfLocalDay(now, timeZone).getTime();
  const todayEnd = midnight + quiet.endMinutes * 60_000;
  if (todayEnd > now.getTime()) return new Date(todayEnd);
  const tomorrowMidnight = startOfLocalDay(new Date(midnight + 36 * 3_600_000), timeZone).getTime();
  return new Date(tomorrowMidnight + quiet.endMinutes * 60_000);
}

/**
 * Decide what this run does. Pure — same inputs, same plan.
 *
 * Rule order is load-bearing:
 *   A. a SENT push row past `fallback_after` with no ack → the SMS fallback
 *      row (only while the related row is still live).
 *   B. not queued/held — never re-sent; the claim UPDATE is the real guard.
 *   C. related row no longer live → reaped `cancelled` — except a kind that
 *      announces that very ending (`ABOUT_AN_ENDED_VISIT`).
 *   D. not due → held.
 *   E. visit already started (start-bound kinds) → reaped; stale past the
 *      grace window (start-bound kinds) → reaped. A receipt, an offer and a
 *      session cancellation are never stale — they go when found.
 *   F. slot request still awaiting the clinician → held (a receipt for a
 *      pending request goes the run after it is confirmed, as before).
 *   G. SMS to an account with no `sms_communication` consent → reaped,
 *      except the receipt (ADR 0090's one exception). A provisional
 *      recipient (no account) is always reachable by SMS.
 *   H. no phone / no push token → reaped `failed`; a token-less push row
 *      with a fallback gets its SMS now rather than at `fallback_after`.
 *   I. quiet hours (facility policy) → held until the window ends.
 *   J. one per (channel, kind, related) per run — the nearest wins.
 *   K. per-(channel, kind) send cap, `session_cancelled` exempt.
 */
export function planDispatch(args: PlanDispatchArgs): DispatchPlan {
  const timeZone = args.timeZone ?? DEFAULT_TIME_ZONE;
  const nowMs = args.now.getTime();
  const nowIso = args.now.toISOString();
  const staleBeforeMs = nowMs - STALE_GRACE_MINUTES * 60_000;
  const plan: DispatchPlan = { pushSends: [], smsSends: [], holds: [], fallbacks: [], reaps: [] };
  const hold = (dispatchId: string, reason: string, releaseAtIso?: string) =>
    plan.holds.push(releaseAtIso ? { dispatchId, reason, releaseAtIso } : { dispatchId, reason });
  const reap = (dispatchId: string, state: "cancelled" | "failed", reason: string) =>
    plan.reaps.push({ dispatchId, state, reason });
  const fallbackFor = (row: DispatchRow): DispatchFallback => ({
    fromDispatchId: row.id,
    insert: {
      hospital_id: row.hospitalId,
      kind: row.kind as DispatchKind,
      recipient_user_id: row.recipientUserId,
      recipient_phone_encrypted: null,
      language: "en",
      channel: "sms",
      fallback_channel: null,
      scheduled_at: nowIso,
      fallback_after: null,
      idempotency_key: fallbackKey(row.idempotencyKey),
      related_kind: row.relatedKind as DispatchInsert["related_kind"],
      related_id: row.relatedId,
      payload: row.payload,
    },
  });

  const candidates: { row: DispatchRow; scheduledMs: number; startsMs: number }[] = [];

  for (const row of args.rows) {
    // A. Fallback: the push went, nobody acknowledged it, the clock ran out.
    if (
      row.channel === "push" &&
      (row.state === "sent" || row.state === "delivered") &&
      row.fallbackChannel === "sms" &&
      row.fallbackAfterIso &&
      new Date(row.fallbackAfterIso).getTime() <= nowMs &&
      !row.acknowledgedAtIso
    ) {
      if (row.related.live) plan.fallbacks.push(fallbackFor(row));
      continue;
    }
    // B.
    if (row.state !== "queued" && row.state !== "held") {
      hold(row.id, "not_queued");
      continue;
    }
    // C.
    if (!row.related.live && !ABOUT_AN_ENDED_VISIT.has(row.kind)) {
      reap(row.id, "cancelled", `related_${row.related.status ?? "gone"}`);
      continue;
    }
    const scheduledMs = new Date(row.scheduledAtIso).getTime();
    const startsMs = row.related.startsAtIso
      ? new Date(row.related.startsAtIso).getTime()
      : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(scheduledMs) || Number.isNaN(startsMs)) {
      reap(row.id, "failed", "unreadable_timestamp");
      continue;
    }
    // D.
    if (scheduledMs > nowMs) {
      hold(row.id, "not_due");
      continue;
    }
    // E.
    if (START_BOUND.has(row.kind)) {
      if (startsMs <= nowMs) {
        reap(row.id, "cancelled", "appointment_elapsed");
        continue;
      }
      if (scheduledMs < staleBeforeMs) {
        reap(row.id, "cancelled", "stale");
        continue;
      }
    }
    // F.
    if (
      row.relatedKind === "appointment" &&
      NEEDS_CONFIRMED_APPOINTMENT.has(row.kind) &&
      row.related.status !== "confirmed"
    ) {
      hold(row.id, "awaiting_confirmation");
      continue;
    }
    // G.
    if (
      row.channel === "sms" &&
      row.recipientUserId &&
      !SMS_WITHOUT_CONSENT.has(row.kind as DispatchKind) &&
      args.consentByUser.get(row.recipientUserId) !== true
    ) {
      reap(row.id, "cancelled", "no_sms_consent");
      continue;
    }
    // H.
    if (row.channel === "sms" && !row.hasPhone) {
      reap(row.id, "failed", "no_reachable_phone");
      continue;
    }
    if (row.channel === "push") {
      const tokens = row.recipientUserId ? (args.tokensByUser.get(row.recipientUserId) ?? []) : [];
      if (tokens.length === 0) {
        reap(row.id, "failed", "no_push_token");
        if (row.fallbackChannel === "sms") plan.fallbacks.push(fallbackFor(row));
        continue;
      }
    }
    if (row.channel === "in_app") {
      // No in-app transport at this gate (sa_notifications has no patient kind).
      hold(row.id, "no_transport");
      continue;
    }
    // I.
    if (HELD_IN_QUIET_HOURS.has(row.kind as DispatchKind)) {
      const quiet =
        (row.hospitalId ? args.quietHoursByHospital.get(row.hospitalId) : undefined) ??
        DEFAULT_QUIET_HOURS;
      if (inQuietHours(args.now, quiet, timeZone)) {
        hold(row.id, "quiet_hours", quietHoursEnd(args.now, quiet, timeZone).toISOString());
        continue;
      }
    }
    candidates.push({ row, scheduledMs, startsMs });
  }

  // J. One per (channel, kind, related) — the nearest scheduled wins.
  const best = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    const key = `${c.row.channel}:${c.row.kind}:${c.row.relatedKind}:${c.row.relatedId}`;
    const incumbent = best.get(key);
    if (!incumbent) {
      best.set(key, c);
      continue;
    }
    const [winner, loser] = c.scheduledMs > incumbent.scheduledMs ? [c, incumbent] : [incumbent, c];
    best.set(key, winner);
    reap(loser.row.id, "cancelled", "superseded");
  }

  // K. Soonest visit first; cap per (channel, kind).
  const ordered = [...best.values()].sort((a, b) => a.startsMs - b.startsMs);
  const sentPer = new Map<string, number>();
  for (const { row } of ordered) {
    const capKey = `${row.channel}:${row.kind}`;
    const n = sentPer.get(capKey) ?? 0;
    if (!CAP_EXEMPT.has(row.kind as DispatchKind) && n >= MAX_SENDS_PER_RUN) {
      hold(row.id, "over_cap");
      continue;
    }
    sentPer.set(capKey, n + 1);
    const common = {
      dispatchId: row.id,
      kind: row.kind,
      hospitalId: row.hospitalId,
      relatedKind: row.relatedKind,
      relatedId: row.relatedId,
      payload: row.payload,
    };
    if (row.channel === "push") {
      const recipientUserId = row.recipientUserId as string;
      plan.pushSends.push({
        ...common,
        recipientUserId,
        tokens: args.tokensByUser.get(recipientUserId) ?? [],
      });
    } else {
      plan.smsSends.push({ ...common, recipientUserId: row.recipientUserId });
    }
  }

  return plan;
}

/* ─── composition (no PHI: names of places, dates, a code) ───────── */

/** Everything a message may say. Nulls where the kind has no use for it. */
export interface DispatchCopyArgs {
  kind: string;
  hospitalName: string;
  /** The service line's name, the department's, or "Appointment" for a confidential line. */
  serviceName: string;
  startsAtIso: string | null;
  bookingCode: string | null;
  positionNumber: number | null;
  arrivalWindowStartIso: string | null;
  arrivalWindowEndIso: string | null;
  /** waitlist_offer: the offered day, and when the offer closes. */
  offeredStartsAtIso: string | null;
  offerExpiresAtIso: string | null;
  /** session_cancelled: the pre-selected next day, if any. */
  nextSessionStartsAtIso: string | null;
  /** window_shifted */
  delayMinutes: number | null;
  /** sms_reply (Gate F): the reply key, rendered from lib/channels/strings.ts. */
  replyKey?: string | null;
}

const MAX_CHARS = 160;

/**
 * The SMS for a dispatch row. GSM-7, ASCII, one part: the facility name
 * is cut before anything that identifies the visit. CSO-provisional copy.
 * Plain sentences, never a threat — a patient who does not confirm loses
 * nothing by default (PRD §3.3.4).
 */
export function composeDispatchSms(a: DispatchCopyArgs): string {
  const code = a.bookingCode ? ` Code ${a.bookingCode.toUpperCase()}.` : "";
  const fit = (before: string, after: string) => {
    let name = ascii(a.hospitalName);
    while (before.length + name.length + after.length > MAX_CHARS && name) {
      name = name.slice(0, -1).trimEnd();
    }
    return `${before}${name}${after}`;
  };
  switch (a.kind) {
    case "booking_receipt":
      return composeReceiptSms({
        hospitalName: a.hospitalName,
        serviceName: a.serviceName,
        startsAtIso: a.startsAtIso ?? "",
        bookingCode: a.bookingCode ?? "",
        positionNumber: a.positionNumber,
        arrivalWindowStartIso: a.arrivalWindowStartIso,
        arrivalWindowEndIso: a.arrivalWindowEndIso,
      });
    case "confirmation_request":
      return fit(
        "MedSync: your visit at ",
        ` is on ${day(a.startsAtIso)}${a.positionNumber == null ? `, ${clock(a.startsAtIso)}` : ""}.${code} Open MedSync to confirm you are coming, or to free the place.`,
      );
    case "arrival_window":
      return fit(
        "MedSync: ",
        ` today.${a.positionNumber != null ? ` Position ${a.positionNumber},` : ""} arrive ${range(a.arrivalWindowStartIso, a.arrivalWindowEndIso)}.${code}`,
      );
    case "waitlist_offer":
      return fit(
        "MedSync: a place has opened at ",
        ` on ${day(a.offeredStartsAtIso)}. Open MedSync to take it. The offer stays open until ${clock(a.offerExpiresAtIso)}.`,
      );
    case "session_cancelled":
      return fit(
        "MedSync: ",
        ` has cancelled the clinic day of ${day(a.startsAtIso)}. We are sorry. ${
          a.nextSessionStartsAtIso
            ? `Open MedSync to book ${day(a.nextSessionStartsAtIso)} in one tap.`
            : "Open MedSync to choose another day."
        }`,
      );
    case "unconfirmed_release":
      return fit(
        "MedSync: your place at ",
        ` on ${day(a.startsAtIso)} was released because it was not confirmed. If you still need a visit, open MedSync to book again.`,
      );
    case "visit_cancelled":
      return fit(
        "MedSync: ",
        ` has cancelled your visit on ${day(a.startsAtIso)}.${code} We are sorry. To book another day, open MedSync or call the clinic.`,
      );
    case "window_shifted":
      return fit(
        "MedSync: ",
        ` is running ${a.delayMinutes ?? 0} minutes late. Arrive ${range(a.arrivalWindowStartIso, a.arrivalWindowEndIso)} instead.${code}`,
      );
    case "sms_reply":
      return composeSmsReply(a.replyKey ?? null, a.bookingCode);
    default:
      return fit("MedSync: ", ` has an update about your visit. Open MedSync.${code}`);
  }
}

/** The push notification: a short title, the SMS as the body. */
export function composeDispatchPush(a: DispatchCopyArgs): { title: string; body: string } {
  const titles: Record<string, string> = {
    booking_receipt: "Your visit is booked",
    confirmation_request: "Are you coming tomorrow?",
    arrival_window: "Your arrival window today",
    waitlist_offer: "A place has opened",
    session_cancelled: "Clinic day cancelled",
    window_shifted: "Your arrival window has moved",
    unconfirmed_release: "Your place was released",
    visit_cancelled: "Visit cancelled",
  };
  return {
    title: titles[a.kind] ?? "MedSync",
    body: composeDispatchSms(a).replace(/^MedSync: /, ""),
  };
}

/**
 * The one reply to an inbound keyword (Gate F, ADR 0091). Keys map onto
 * `lib/channels/strings.ts`; an unknown key gets the help line so nobody
 * receives an empty SMS.
 */
export function composeSmsReply(replyKey: string | null, bookingCode: string | null): string {
  const code = bookingCode ? bookingCode.toUpperCase() : null;
  switch (replyKey) {
    case "confirmed":
      return `MedSync: ${t(DEFAULT_LANGUAGE, "confirmed", { code })}`;
    case "cancelled":
      return `MedSync: ${t(DEFAULT_LANGUAGE, "cancelled", { code })}`;
    case "not_confirmable":
      return `MedSync: ${t(DEFAULT_LANGUAGE, "not_confirmable", { code })}`;
    case "not_cancellable":
      return `MedSync: ${t(DEFAULT_LANGUAGE, "not_cancellable", { code })}`;
    case "unknown_code":
      return `MedSync: ${t(DEFAULT_LANGUAGE, "code_unknown")} ${t(DEFAULT_LANGUAGE, "sms_help").replace(/^MedSync: /, "")}`;
    case "stopped":
      return t(DEFAULT_LANGUAGE, "sms_stopped");
    case "too_many":
      return t(DEFAULT_LANGUAGE, "sms_too_many");
    default:
      return t(DEFAULT_LANGUAGE, "sms_help");
  }
}

/** "Tue 22 Sep" — East Africa Time. */
function day(iso: string | null): string {
  if (!iso) return "";
  const p = parts(iso, { weekday: "short", day: "numeric", month: "short" });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "9:30 AM" */
function clock(iso: string | null): string {
  if (!iso) return "";
  const p = parts(iso, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "9:30-11:00 AM", or across noon "11:30 AM-1:00 PM". */
function range(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return "";
  const a = parts(startIso, { hour: "numeric", minute: "2-digit", hour12: true });
  const b = parts(endIso, { hour: "numeric", minute: "2-digit", hour12: true });
  return a.dayPeriod === b.dayPeriod
    ? `${a.hour}:${a.minute}-${b.hour}:${b.minute} ${b.dayPeriod}`
    : `${a.hour}:${a.minute} ${a.dayPeriod}-${b.hour}:${b.minute} ${b.dayPeriod}`;
}

function parts(iso: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const bag: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIME_ZONE,
    ...options,
  }).formatToParts(new Date(iso))) {
    bag[part.type] = part.value;
  }
  if (bag.dayPeriod) bag.dayPeriod = /p/i.test(bag.dayPeriod) ? "PM" : "AM";
  return bag;
}

function ascii(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
