/**
 * `notification_dispatches` rows — the builder every writer uses (Gate E,
 * ADR 0090, proposal §5.11 / §7.2, PRD §4.6).
 *
 * ZERO imports, like `slots.ts`: the Next app takes it as
 * `@/supabase/functions/_shared/dispatches`, a Deno Edge Function as
 * `./dispatches.ts`. The planner that DRAINS these rows lives on the Next
 * side (`lib/notifications/dispatches.ts`) because only the cron sends.
 *
 * One event in, the rows to insert out. The channel policy is decided HERE
 * and nowhere else:
 *
 *   booking_receipt        push + SMS, both, now         (the durable proof)
 *   session_cancelled      push + SMS, both, now         (nobody dropped silently)
 *   confirmation_request   push at T-24h; SMS if no ack by T-20h
 *   arrival_window         push at T-2h;  SMS if no ack by T-90m (session rows only)
 *   waitlist_offer         push now;      SMS if no ack in 15 min
 *   window_shifted         push now;      SMS if no ack in 15 min
 *   unconfirmed_release    push + SMS, both, now         (a release is never silent)
 *   visit_cancelled        push + SMS, both, now         (the clinic cancelled one visit, ADR 0473)
 *
 * A PROVISIONAL recipient (no account, a phone ciphertext) has nothing to
 * push to, so every kind collapses to one SMS row for them — their phone
 * was given for exactly this (PRD §2.8).
 *
 * The idempotency key is `${kind}:${related_kind}:${related_id}:${suffix}`,
 * suffix = the channel (or `${variant}:${channel}` when one event can
 * legitimately recur, e.g. a second delay on the same clinic day). A
 * retried Edge Function inserts ON CONFLICT DO NOTHING. The dispatcher's
 * fallback SMS row takes the push row's key with `:push` → `:sms`, so it
 * is idempotent too and — for the two both-always kinds — collides with
 * nothing because they never fall back.
 *
 * NO PHI: no name, no phone number, no reason text ever enters a row. The
 * provisional's phone travels as ciphertext the writer already holds.
 */

export type DispatchKind =
  | "booking_receipt"
  | "confirmation_request"
  | "reminder"
  | "arrival_window"
  | "waitlist_offer"
  | "session_cancelled"
  | "window_shifted"
  | "position_called"
  | "payment"
  | "deterioration_flag"
  | "unconfirmed_release"
  /** ADR 0473 (0290): staff cancelled one booking. */
  | "visit_cancelled"
  /** Gate F (0062): the one reply to an inbound SMS keyword. */
  | "sms_reply";

export type DispatchChannel = "push" | "sms" | "in_app";

export type DispatchRelatedKind =
  | "appointment"
  | "waitlist_entry"
  | "clinic_session"
  | "intake"
  | "inbound_sms";

/** What an `sms_reply` says — a KEY rendered from `lib/channels/strings.ts`, never free text. */
export type SmsReplyKey =
  | "confirmed"
  | "cancelled"
  | "stopped"
  | "help"
  | "unknown_code"
  | "not_confirmable"
  | "not_cancellable"
  | "too_many";

/** Who receives it: an account, or a provisional patient's phone ciphertext. */
export type DispatchRecipient = { userId: string } | { phoneEncrypted: string };

/** Exactly the `notification_dispatches` INSERT shape (snake_case, as supabase-js takes it). */
export interface DispatchInsert {
  /** NULL (0062) = a platform reply with no facility to bill. */
  hospital_id: string | null;
  kind: DispatchKind;
  recipient_user_id: string | null;
  recipient_phone_encrypted: string | null;
  language: string;
  channel: DispatchChannel;
  fallback_channel: "sms" | null;
  scheduled_at: string;
  fallback_after: string | null;
  idempotency_key: string;
  related_kind: DispatchRelatedKind;
  related_id: string;
  payload: Record<string, unknown>;
}

interface EventBase {
  hospitalId: string | null;
  recipient: DispatchRecipient;
  /** ISO instant "now" — passed in so the builder stays pure. */
  nowIso: string;
  language?: string;
}

export type DispatchEvent =
  | (EventBase & { kind: "booking_receipt"; appointmentId: string })
  | (EventBase & { kind: "confirmation_request"; appointmentId: string; startsAtIso: string })
  | (EventBase & { kind: "arrival_window"; appointmentId: string; startsAtIso: string })
  | (EventBase & {
      kind: "waitlist_offer";
      waitlistEntryId: string;
      offeredSessionId: string | null;
    })
  | (EventBase & {
      kind: "session_cancelled";
      appointmentId: string;
      cancelledSessionId: string;
      nextSessionId: string | null;
      nextSessionStartsAtIso: string | null;
    })
  | (EventBase & {
      kind: "window_shifted";
      appointmentId: string;
      delayMinutes: number;
      shiftMinutes: number;
    })
  | (EventBase & { kind: "unconfirmed_release"; appointmentId: string })
  | (EventBase & { kind: "visit_cancelled"; appointmentId: string })
  | (EventBase & {
      kind: "sms_reply";
      inboundSmsId: string;
      reply: SmsReplyKey;
      bookingCode: string | null;
    });

/** Kinds sent by BOTH channels up front (PRD §1.5, §3.2.6). */
export const BOTH_CHANNELS_ALWAYS: ReadonlySet<DispatchKind> = new Set([
  "booking_receipt",
  "session_cancelled",
  "unconfirmed_release",
  "visit_cancelled",
]);

/** Kinds the dispatcher HOLDS inside a facility's quiet hours (PRD §3.3.3, §3.6). */
export const HELD_IN_QUIET_HOURS: ReadonlySet<DispatchKind> = new Set([
  "waitlist_offer",
  "confirmation_request",
  "arrival_window",
  "window_shifted",
  "reminder",
]);

/**
 * The SMS consent gate's ONE exception (ADR 0090): the receipt is the
 * booking's proof and was requested by the act of booking, so it goes
 * regardless of `sms_communication` consent. Everything else needs a
 * granted record — or a provisional recipient, whose phone was given for
 * exactly these messages.
 */
export const SMS_WITHOUT_CONSENT: ReadonlySet<DispatchKind> = new Set(["booking_receipt"]);

/** `MAX_SENDS_PER_RUN` applies per kind, except these (300 patients must hear within one run). */
export const CAP_EXEMPT: ReadonlySet<DispatchKind> = new Set(["session_cancelled"]);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long before the visit a lead is due, and when its push falls back to SMS. */
export const LEADS = {
  confirmation_request: { beforeMs: 24 * HOUR, fallbackAfterMs: 4 * HOUR },
  arrival_window: { beforeMs: 2 * HOUR, fallbackAfterMs: 30 * MINUTE },
  waitlist_offer: { fallbackAfterMs: 15 * MINUTE },
  window_shifted: { fallbackAfterMs: 15 * MINUTE },
} as const;

/** A waitlist offer's acceptance window, from the instant it is SENT. */
export const OFFER_WINDOW_MS = 2 * HOUR;

/** A shifted window is worth a message from this far (PRD §3.6). */
export const WINDOW_SHIFT_THRESHOLD_MINUTES = 30;

export function dispatchKey(
  kind: DispatchKind,
  relatedKind: DispatchRelatedKind,
  relatedId: string,
  suffix: string,
): string {
  return `${kind}:${relatedKind}:${relatedId}:${suffix}`;
}

/** The fallback SMS row's key, from its push row's. */
export function fallbackKey(pushKey: string): string {
  return pushKey.replace(/:push$/, ":sms");
}

/**
 * The rows to insert for one event. Pure; same inputs, same rows.
 *
 * Returns [] when the lead is already in the past (a 24-hour lead on a
 * booking made this morning) — a row born stale would only be reaped.
 */
export function dispatchRows(event: DispatchEvent): DispatchInsert[] {
  const who =
    "userId" in event.recipient
      ? { recipient_user_id: event.recipient.userId, recipient_phone_encrypted: null }
      : { recipient_user_id: null, recipient_phone_encrypted: event.recipient.phoneEncrypted };
  const provisional = who.recipient_user_id === null;
  const language = event.language ?? "en";
  const nowMs = new Date(event.nowIso).getTime();

  const base = (
    relatedKind: DispatchRelatedKind,
    relatedId: string,
    payload: Record<string, unknown>,
    variant?: string,
  ) => {
    const suffix = (channel: DispatchChannel) => (variant ? `${variant}:${channel}` : channel);
    const row = (
      channel: DispatchChannel,
      scheduledMs: number,
      fallbackAfterMs: number | null,
    ): DispatchInsert => ({
      hospital_id: event.hospitalId,
      kind: event.kind,
      ...who,
      language,
      channel,
      fallback_channel: channel === "push" && fallbackAfterMs !== null ? "sms" : null,
      scheduled_at: new Date(scheduledMs).toISOString(),
      fallback_after:
        channel === "push" && fallbackAfterMs !== null
          ? new Date(fallbackAfterMs).toISOString()
          : null,
      idempotency_key: dispatchKey(event.kind, relatedKind, relatedId, suffix(channel)),
      related_kind: relatedKind,
      related_id: relatedId,
      payload,
    });
    /** Both channels now (receipt, session_cancelled). */
    const both = (scheduledMs: number): DispatchInsert[] =>
      provisional
        ? [row("sms", scheduledMs, null)]
        : [row("push", scheduledMs, null), row("sms", scheduledMs, null)];
    /** SMS alone, now — the reply to someone who wrote to us by SMS. */
    const smsOnly = (scheduledMs: number): DispatchInsert[] => [row("sms", scheduledMs, null)];
    /** Push-first with an SMS fallback; one SMS for a provisional. */
    const pushFirst = (scheduledMs: number, fallbackDelayMs: number): DispatchInsert[] =>
      provisional
        ? [row("sms", scheduledMs, null)]
        : [row("push", scheduledMs, scheduledMs + fallbackDelayMs)];
    return { both, pushFirst, smsOnly };
  };

  switch (event.kind) {
    case "booking_receipt":
      return base("appointment", event.appointmentId, {}).both(nowMs);

    case "session_cancelled":
      return base("appointment", event.appointmentId, {
        cancelled_session_id: event.cancelledSessionId,
        next_session_id: event.nextSessionId,
        next_session_starts_at: event.nextSessionStartsAtIso,
      }).both(nowMs);

    case "confirmation_request": {
      const due = new Date(event.startsAtIso).getTime() - LEADS.confirmation_request.beforeMs;
      if (due <= nowMs) return [];
      return base("appointment", event.appointmentId, {}).pushFirst(
        due,
        LEADS.confirmation_request.fallbackAfterMs,
      );
    }

    case "arrival_window": {
      const due = new Date(event.startsAtIso).getTime() - LEADS.arrival_window.beforeMs;
      if (due <= nowMs) return [];
      return base("appointment", event.appointmentId, {}).pushFirst(
        due,
        LEADS.arrival_window.fallbackAfterMs,
      );
    }

    case "waitlist_offer":
      return base("waitlist_entry", event.waitlistEntryId, {
        offered_session_id: event.offeredSessionId,
      }).pushFirst(nowMs, LEADS.waitlist_offer.fallbackAfterMs);

    case "unconfirmed_release":
    case "visit_cancelled":
      return base("appointment", event.appointmentId, {}).both(nowMs);

    case "sms_reply":
      // The caller wrote to us by SMS: the answer goes the same way, once.
      return base("inbound_sms", event.inboundSmsId, {
        reply: event.reply,
        booking_code: event.bookingCode,
      }).smsOnly(nowMs);

    case "window_shifted":
      return base(
        "appointment",
        event.appointmentId,
        { delay_minutes: event.delayMinutes, shift_minutes: event.shiftMinutes },
        `d${event.delayMinutes}`,
      ).pushFirst(nowMs, LEADS.window_shifted.fallbackAfterMs);
  }
}

/**
 * The rows a fresh booking queues — the receipt, the T-24h confirmation
 * request and (session rows only) the T-2h arrival window. Called by the
 * booking core and by reschedule-appointment's new row.
 */
export function bookingDispatchRows(args: {
  hospitalId: string;
  recipient: DispatchRecipient;
  appointmentId: string;
  startsAtIso: string;
  isSession: boolean;
  nowIso: string;
}): DispatchInsert[] {
  const common = { hospitalId: args.hospitalId, recipient: args.recipient, nowIso: args.nowIso };
  return [
    ...dispatchRows({ ...common, kind: "booking_receipt", appointmentId: args.appointmentId }),
    ...dispatchRows({
      ...common,
      kind: "confirmation_request",
      appointmentId: args.appointmentId,
      startsAtIso: args.startsAtIso,
    }),
    ...(args.isSession
      ? dispatchRows({
          ...common,
          kind: "arrival_window",
          appointmentId: args.appointmentId,
          startsAtIso: args.startsAtIso,
        })
      : []),
  ];
}
