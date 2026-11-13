import type { DispatchRow } from "@/lib/notifications/dispatches";
import { describe, expect, it } from "vitest";

import { parseCost } from "@/lib/notifications/africastalking";
import {
  bookingDispatchRows,
  composeDispatchPush,
  composeDispatchSms,
  DEFAULT_QUIET_HOURS,
  dispatchRows,
  fallbackKey,
  inQuietHours,
  OFFER_WINDOW_MS,
  planDispatch,
  quietHoursEnd,
} from "@/lib/notifications/dispatches";
import { isGsmSafe, MAX_SENDS_PER_RUN, SMS_MAX_BODY_CHARS } from "@/lib/notifications/sink";

/**
 * Gate E (ADR 0090) — the builder every writer uses and the planner the
 * cron runs. Pure: no DB, no network, no phone number anywhere.
 */

// 09:00 UTC = 12:00 EAT — daytime in Kampala.
const NOON = new Date("2026-09-15T09:00:00.000Z");
// 20:00 UTC = 23:00 EAT — inside the default 21:00–07:00 window.
const NIGHT = new Date("2026-09-15T20:00:00.000Z");
const ms = (m: number, from = NOON) => new Date(from.getTime() + m * 60_000).toISOString();

let seq = 0;
const row = (over: Partial<DispatchRow> = {}): DispatchRow => {
  seq += 1;
  const relatedId = over.relatedId ?? `appt-${seq}`;
  const kind = over.kind ?? "confirmation_request";
  const channel = over.channel ?? "push";
  return {
    id: `d-${seq}`,
    hospitalId: "hosp-1",
    kind,
    channel,
    state: "queued",
    scheduledAtIso: ms(-5),
    fallbackChannel: channel === "push" ? "sms" : null,
    fallbackAfterIso: channel === "push" ? ms(240) : null,
    acknowledgedAtIso: null,
    recipientUserId: `user-${seq}`,
    hasPhone: true,
    idempotencyKey: `${kind}:appointment:${relatedId}:${channel}`,
    relatedKind: "appointment",
    relatedId,
    payload: {},
    related: { live: true, status: "confirmed", startsAtIso: ms(60 * 23) },
    ...over,
  };
};

const plan = (
  rows: DispatchRow[],
  over: Partial<Parameters<typeof planDispatch>[0]> = {},
  now = NOON,
) =>
  planDispatch({
    rows,
    now,
    quietHoursByHospital: new Map([["hosp-1", DEFAULT_QUIET_HOURS]]),
    tokensByUser: new Map(
      rows.flatMap((r) =>
        r.recipientUserId ? [[r.recipientUserId, ["ExponentPushToken[x]"]]] : [],
      ),
    ),
    consentByUser: new Map(
      rows.flatMap((r) => (r.recipientUserId ? [[r.recipientUserId, true]] : [])),
    ),
    ...over,
  });

/* ─── the builder ────────────────────────────────────────────────── */

describe("dispatchRows — channel policy per kind", () => {
  const base = { hospitalId: "h", recipient: { userId: "u" }, nowIso: NOON.toISOString() };

  it("a receipt is push AND SMS, both now, no fallback, keyed by channel", () => {
    const rows = dispatchRows({ ...base, kind: "booking_receipt", appointmentId: "a1" });
    expect(rows.map((r) => r.channel)).toEqual(["push", "sms"]);
    expect(rows.every((r) => r.scheduled_at === NOON.toISOString())).toBe(true);
    expect(rows.every((r) => r.fallback_channel === null && r.fallback_after === null)).toBe(true);
    expect(rows.map((r) => r.idempotency_key)).toEqual([
      "booking_receipt:appointment:a1:push",
      "booking_receipt:appointment:a1:sms",
    ]);
  });

  it("a session cancellation is push AND SMS with the next day in the payload", () => {
    const rows = dispatchRows({
      ...base,
      kind: "session_cancelled",
      appointmentId: "a1",
      cancelledSessionId: "s1",
      nextSessionId: "s2",
      nextSessionStartsAtIso: ms(60 * 48),
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.payload).toEqual({
      cancelled_session_id: "s1",
      next_session_id: "s2",
      next_session_starts_at: ms(60 * 48),
    });
  });

  it("a confirmation request is ONE push at T-24h with an SMS fallback at T-20h", () => {
    const startsAt = ms(60 * 48);
    const rows = dispatchRows({
      ...base,
      kind: "confirmation_request",
      appointmentId: "a1",
      startsAtIso: startsAt,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: "push",
      fallback_channel: "sms",
      scheduled_at: ms(60 * 24),
      fallback_after: ms(60 * 28),
      idempotency_key: "confirmation_request:appointment:a1:push",
    });
  });

  it("a lead already in the past yields nothing (born stale)", () => {
    expect(
      dispatchRows({
        ...base,
        kind: "confirmation_request",
        appointmentId: "a1",
        startsAtIso: ms(60 * 12),
      }),
    ).toEqual([]);
    expect(
      dispatchRows({ ...base, kind: "arrival_window", appointmentId: "a1", startsAtIso: ms(60) }),
    ).toEqual([]);
  });

  it("a provisional recipient (phone ciphertext, no account) gets one SMS for every kind", () => {
    const prov = { ...base, recipient: { phoneEncrypted: "iv:tag:ct" } };
    const receipt = dispatchRows({ ...prov, kind: "booking_receipt", appointmentId: "a1" });
    expect(receipt).toHaveLength(1);
    expect(receipt[0]).toMatchObject({
      channel: "sms",
      recipient_user_id: null,
      recipient_phone_encrypted: "iv:tag:ct",
      fallback_channel: null,
    });
    const offer = dispatchRows({
      ...prov,
      kind: "waitlist_offer",
      waitlistEntryId: "w1",
      offeredSessionId: "s1",
    });
    expect(offer).toHaveLength(1);
    expect(offer[0]?.channel).toBe("sms");
    expect(offer[0]?.related_kind).toBe("waitlist_entry");
  });

  it("a window shift is keyed by the delay so re-sending the same value is a no-op", () => {
    const a = dispatchRows({
      ...base,
      kind: "window_shifted",
      appointmentId: "a1",
      delayMinutes: 40,
      shiftMinutes: 40,
    });
    const b = dispatchRows({
      ...base,
      kind: "window_shifted",
      appointmentId: "a1",
      delayMinutes: 90,
      shiftMinutes: 50,
    });
    expect(a[0]?.idempotency_key).toBe("window_shifted:appointment:a1:d40:push");
    expect(b[0]?.idempotency_key).toBe("window_shifted:appointment:a1:d90:push");
    expect(fallbackKey(a[0]?.idempotency_key as string)).toBe(
      "window_shifted:appointment:a1:d40:sms",
    );
  });

  it("bookingDispatchRows: receipt + confirmation request, plus the arrival window for a clinic day", () => {
    const startsAt = ms(60 * 48);
    const slot = bookingDispatchRows({
      ...base,
      appointmentId: "a1",
      startsAtIso: startsAt,
      isSession: false,
    });
    expect(slot.map((r) => `${r.kind}:${r.channel}`)).toEqual([
      "booking_receipt:push",
      "booking_receipt:sms",
      "confirmation_request:push",
    ]);
    const session = bookingDispatchRows({
      ...base,
      appointmentId: "a1",
      startsAtIso: startsAt,
      isSession: true,
    });
    expect(session.map((r) => r.kind)).toContain("arrival_window");
    expect(session.find((r) => r.kind === "arrival_window")).toMatchObject({
      scheduled_at: ms(60 * 46),
      fallback_after: ms(60 * 46 + 30),
    });
  });

  it("never carries PHI: no name, no phone, no reason in any row", () => {
    const rows = bookingDispatchRows({
      ...base,
      appointmentId: "a1",
      startsAtIso: ms(60 * 48),
      isSession: true,
    });
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        [
          "channel",
          "fallback_after",
          "fallback_channel",
          "hospital_id",
          "idempotency_key",
          "kind",
          "language",
          "payload",
          "recipient_phone_encrypted",
          "recipient_user_id",
          "related_id",
          "related_kind",
          "scheduled_at",
        ].sort(),
      );
    }
  });
});

/* ─── the planner ────────────────────────────────────────────────── */

describe("planDispatch — what goes out", () => {
  it("a due push row for a live, confirmed visit with a token is a push send", () => {
    const { pushSends, smsSends, reaps } = plan([row()]);
    expect(pushSends).toHaveLength(1);
    expect(pushSends[0]?.tokens).toEqual(["ExponentPushToken[x]"]);
    expect(smsSends).toHaveLength(0);
    expect(reaps).toHaveLength(0);
  });

  it("a row not yet due is held; a claimed row is never re-sent", () => {
    const p = plan([
      row({ scheduledAtIso: ms(30) }),
      row({ state: "sent", fallbackAfterIso: ms(60) }),
    ]);
    expect(p.pushSends).toHaveLength(0);
    expect(p.holds.map((h) => h.reason).sort()).toEqual(["not_due", "not_queued"]);
  });

  it("a `held` row whose release instant has passed goes out", () => {
    const { pushSends } = plan([row({ state: "held", scheduledAtIso: ms(-1) })]);
    expect(pushSends).toHaveLength(1);
  });

  it("reaps a row whose related visit is no longer live, or has started", () => {
    const p = plan([
      row({ related: { live: false, status: "cancelled", startsAtIso: ms(60) } }),
      row({
        kind: "arrival_window",
        related: { live: true, status: "confirmed", startsAtIso: ms(-1) },
      }),
    ]);
    expect(p.reaps.map((r) => r.reason).sort()).toEqual([
      "appointment_elapsed",
      "related_cancelled",
    ]);
  });

  it("holds a receipt while the slot request awaits the clinician; sends it once confirmed", () => {
    const pending = row({
      kind: "booking_receipt",
      channel: "sms",
      related: { live: true, status: "pending_approval", startsAtIso: ms(60 * 30) },
    });
    expect(plan([pending]).holds.map((h) => h.reason)).toEqual(["awaiting_confirmation"]);
    expect(
      plan([{ ...pending, related: { ...pending.related, status: "confirmed" } }]).smsSends,
    ).toHaveLength(1);
  });
});

describe("planDispatch — push-first, SMS fallback", () => {
  it("a sent push past fallback_after with NO ack yields the SMS fallback row, keyed :sms", () => {
    const sent = row({ state: "sent", fallbackAfterIso: ms(-1) });
    const { fallbacks } = plan([sent]);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toMatchObject({
      fromDispatchId: sent.id,
      insert: {
        channel: "sms",
        kind: "confirmation_request",
        recipient_user_id: sent.recipientUserId,
        idempotency_key: `confirmation_request:appointment:${sent.relatedId}:sms`,
        scheduled_at: NOON.toISOString(),
        fallback_channel: null,
      },
    });
  });

  it("an ACKNOWLEDGED push never falls back; nor does one whose fallback instant is still ahead", () => {
    expect(
      plan([row({ state: "sent", fallbackAfterIso: ms(-1), acknowledgedAtIso: ms(-30) })])
        .fallbacks,
    ).toHaveLength(0);
    expect(plan([row({ state: "sent", fallbackAfterIso: ms(30) })]).fallbacks).toHaveLength(0);
  });

  it("no fallback for a visit that stopped being live", () => {
    expect(
      plan([
        row({
          state: "sent",
          fallbackAfterIso: ms(-1),
          related: { live: false, status: "cancelled", startsAtIso: null },
        }),
      ]).fallbacks,
    ).toHaveLength(0);
  });

  it("a push row for a recipient with no token fails and falls back to SMS at once", () => {
    const r = row();
    const p = plan([r], { tokensByUser: new Map() });
    expect(p.pushSends).toHaveLength(0);
    expect(p.reaps).toEqual([{ dispatchId: r.id, state: "failed", reason: "no_push_token" }]);
    expect(p.fallbacks).toHaveLength(1);
    expect(p.fallbacks[0]?.insert.channel).toBe("sms");
  });
});

describe("planDispatch — the SMS consent gate", () => {
  it("an SMS to an account with no sms_communication consent is reaped, not sent", () => {
    const r = row({ kind: "confirmation_request", channel: "sms" });
    const p = plan([r], { consentByUser: new Map() });
    expect(p.smsSends).toHaveLength(0);
    expect(p.reaps).toEqual([{ dispatchId: r.id, state: "cancelled", reason: "no_sms_consent" }]);
  });

  it("the receipt is the ONE exception — sent regardless of consent", () => {
    const r = row({ kind: "booking_receipt", channel: "sms" });
    expect(plan([r], { consentByUser: new Map() }).smsSends).toHaveLength(1);
  });

  it("a session cancellation SMS still needs consent (the push goes regardless)", () => {
    const sms = row({ kind: "session_cancelled", channel: "sms" });
    const push = row({
      kind: "session_cancelled",
      channel: "push",
      fallbackChannel: null,
      fallbackAfterIso: null,
    });
    const p = plan([sms, push], { consentByUser: new Map() });
    expect(p.smsSends).toHaveLength(0);
    expect(p.pushSends).toHaveLength(1);
  });

  it("a provisional recipient (no account) is always reachable by SMS — their phone was given for this", () => {
    const r = row({
      kind: "waitlist_offer",
      channel: "sms",
      recipientUserId: null,
      relatedKind: "waitlist_entry",
      relatedId: "w1",
      idempotencyKey: "waitlist_offer:waitlist_entry:w1:sms",
      related: { live: true, status: "offered", startsAtIso: ms(60 * 48) },
    });
    const p = plan([r], { consentByUser: new Map(), tokensByUser: new Map() });
    expect(p.smsSends).toHaveLength(1);
    expect(p.smsSends[0]?.recipientUserId).toBeNull();
  });

  it("an SMS with no reachable phone fails visibly", () => {
    const r = row({ kind: "booking_receipt", channel: "sms", hasPhone: false });
    expect(plan([r]).reaps).toEqual([
      { dispatchId: r.id, state: "failed", reason: "no_reachable_phone" },
    ]);
  });
});

describe("planDispatch — quiet hours (facility policy)", () => {
  it("23:00 EAT is inside the default 21:00–07:00 window; 12:00 is not", () => {
    expect(inQuietHours(NIGHT, DEFAULT_QUIET_HOURS)).toBe(true);
    expect(inQuietHours(NOON, DEFAULT_QUIET_HOURS)).toBe(false);
    expect(inQuietHours(NIGHT, { startMinutes: 0, endMinutes: 0 })).toBe(false);
  });

  it("an offer due at night is HELD and re-scheduled to 07:00 EAT the next morning", () => {
    const r = row({
      kind: "waitlist_offer",
      relatedKind: "waitlist_entry",
      relatedId: "w1",
      related: { live: true, status: "offered", startsAtIso: ms(60 * 48, NIGHT) },
      scheduledAtIso: ms(-5, NIGHT),
    });
    const p = plan([r], {}, NIGHT);
    expect(p.pushSends).toHaveLength(0);
    expect(p.holds).toEqual([
      { dispatchId: r.id, reason: "quiet_hours", releaseAtIso: "2026-09-16T04:00:00.000Z" },
    ]);
    expect(quietHoursEnd(NIGHT, DEFAULT_QUIET_HOURS).toISOString()).toBe(
      "2026-09-16T04:00:00.000Z",
    );
  });

  it("a receipt and a session cancellation are exempt from quiet hours", () => {
    const receipt = row({ kind: "booking_receipt", channel: "sms", scheduledAtIso: ms(-5, NIGHT) });
    const cancelled = row({
      kind: "session_cancelled",
      channel: "push",
      fallbackChannel: null,
      fallbackAfterIso: null,
      scheduledAtIso: ms(-5, NIGHT),
    });
    const p = plan([receipt, cancelled], {}, NIGHT);
    expect(p.smsSends).toHaveLength(1);
    expect(p.pushSends).toHaveLength(1);
    expect(p.holds).toHaveLength(0);
  });

  it("honours a facility's own window", () => {
    const r = row({ scheduledAtIso: ms(-5, NIGHT) });
    const open = plan(
      [r],
      { quietHoursByHospital: new Map([["hosp-1", { startMinutes: 60, endMinutes: 300 }]]) },
      NIGHT,
    );
    expect(open.pushSends).toHaveLength(1);
  });

  it("the offer's clock starts when it is SENT: the window is two hours from send", () => {
    expect(OFFER_WINDOW_MS).toBe(2 * 3_600_000);
  });
});

describe("planDispatch — one per (kind, related) per run, and the cap", () => {
  it("two due rows of one kind for one visit on one channel: the nearest wins, the other is superseded", () => {
    const older = row({
      kind: "reminder",
      channel: "sms",
      relatedId: "a1",
      scheduledAtIso: ms(-90),
    });
    const nearer = row({
      kind: "reminder",
      channel: "sms",
      relatedId: "a1",
      scheduledAtIso: ms(-5),
    });
    const p = plan([older, nearer]);
    expect(p.smsSends.map((s) => s.dispatchId)).toEqual([nearer.id]);
    expect(p.reaps).toEqual([{ dispatchId: older.id, state: "cancelled", reason: "superseded" }]);
  });

  it("the cap applies per kind: 150 confirmation requests send 100, hold 50 — soonest visits first", () => {
    const rows = Array.from({ length: 150 }, (_, i) =>
      row({
        channel: "sms",
        related: { live: true, status: "confirmed", startsAtIso: ms(60 * 24 + i) },
      }),
    );
    const p = plan(rows);
    expect(p.smsSends).toHaveLength(MAX_SENDS_PER_RUN);
    expect(p.holds.filter((h) => h.reason === "over_cap")).toHaveLength(50);
    expect(p.smsSends[0]?.dispatchId).toBe(rows[0]?.id);
  });

  it("300 patients on a cancelled clinic day ALL hear in one run — push and SMS, cap exempt", () => {
    const base = { hospitalId: "h", nowIso: NOON.toISOString() };
    const inserts = Array.from({ length: 300 }, (_, i) =>
      dispatchRows({
        ...base,
        recipient: { userId: `u${i}` },
        kind: "session_cancelled",
        appointmentId: `a${i}`,
        cancelledSessionId: "s1",
        nextSessionId: "s2",
        nextSessionStartsAtIso: ms(60 * 48),
      }),
    ).flat();
    expect(inserts).toHaveLength(600);
    const rows = inserts.map((ins, i) =>
      row({
        id: `d${i}`,
        kind: "session_cancelled",
        channel: ins.channel,
        recipientUserId: ins.recipient_user_id,
        relatedId: ins.related_id,
        idempotencyKey: ins.idempotency_key,
        fallbackChannel: null,
        fallbackAfterIso: null,
        payload: ins.payload,
        related: { live: true, status: "cancelled", startsAtIso: ms(60 * 5) },
      }),
    );
    const p = plan(rows);
    expect(p.pushSends).toHaveLength(300);
    expect(p.smsSends).toHaveLength(300);
    expect(p.holds).toHaveLength(0);
    expect(p.reaps).toHaveLength(0);
    expect(new Set(p.pushSends.map((s) => s.relatedId)).size).toBe(300);
  });
});

/* ─── the copy ───────────────────────────────────────────────────── */

describe("composeDispatchSms — one GSM-7 part, plain, never punitive", () => {
  const args = {
    hospitalName: "Mulago National Referral Hospital — St Mary's Wing",
    serviceName: "Medical Outpatients",
    startsAtIso: "2026-09-22T06:30:00.000Z",
    bookingCode: "abc123",
    positionNumber: 23,
    arrivalWindowStartIso: "2026-09-22T06:30:00.000Z",
    arrivalWindowEndIso: "2026-09-22T08:00:00.000Z",
    offeredStartsAtIso: "2026-09-24T06:00:00.000Z",
    offerExpiresAtIso: "2026-09-15T11:00:00.000Z",
    nextSessionStartsAtIso: "2026-09-24T06:00:00.000Z",
    delayMinutes: 40,
  };
  const kinds = [
    "booking_receipt",
    "confirmation_request",
    "arrival_window",
    "waitlist_offer",
    "session_cancelled",
    "window_shifted",
    "unconfirmed_release",
    "visit_cancelled",
  ];

  it.each(kinds)("%s fits in 160 GSM-7 characters", (kind) => {
    const body = composeDispatchSms({ ...args, kind });
    expect(body.length).toBeLessThanOrEqual(SMS_MAX_BODY_CHARS);
    expect(isGsmSafe(body)).toBe(true);
    expect(body.startsWith("MedSync: ")).toBe(true);
  });

  it("says the thing that matters, in words the patient can act on", () => {
    expect(composeDispatchSms({ ...args, kind: "confirmation_request" })).toContain(
      "confirm you are coming",
    );
    expect(composeDispatchSms({ ...args, kind: "arrival_window" })).toContain(
      "Position 23, arrive 9:30-11:00 AM",
    );
    expect(composeDispatchSms({ ...args, kind: "waitlist_offer" })).toContain("open until 2:00 PM");
    expect(composeDispatchSms({ ...args, kind: "session_cancelled" })).toContain(
      "book Thu 24 Sep in one tap",
    );
    expect(
      composeDispatchSms({ ...args, kind: "session_cancelled", nextSessionStartsAtIso: null }),
    ).toContain("choose another day");
    expect(composeDispatchSms({ ...args, kind: "window_shifted" })).toContain(
      "running 40 minutes late",
    );
    expect(composeDispatchSms({ ...args, kind: "unconfirmed_release" })).toContain("book again");
  });

  it("carries no punitive language", () => {
    for (const kind of kinds) {
      const body = composeDispatchSms({ ...args, kind }).toLowerCase();
      for (const word of ["penalty", "fee", "banned", "blocked", "warning", "strike", "fine"]) {
        expect(body, kind).not.toContain(word);
      }
    }
  });

  it("the push shares the body and has a short title", () => {
    const push = composeDispatchPush({ ...args, kind: "waitlist_offer" });
    expect(push.title).toBe("A place has opened");
    expect(push.body.startsWith("MedSync: ")).toBe(false);
  });
});

describe("parseCost — Africa's Talking's cost string", () => {
  it("reads 'UGX 35.0000' and refuses anything else", () => {
    expect(parseCost("UGX 35.0000")).toEqual({ currency: "UGX", amount: "35.0000" });
    expect(parseCost("KES 0.8")).toEqual({ currency: "KES", amount: "0.8" });
    expect(parseCost(undefined)).toBeUndefined();
    expect(parseCost("free")).toBeUndefined();
  });
});
