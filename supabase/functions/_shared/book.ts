/**
 * The booking core — ONE writer of `appointments` for every surface that
 * books a visit (Gate C, ADR 0088; extracted at Gate D, ADR 0089).
 *
 * Callers: `pt-request-appointment` (a patient, for themselves or for a
 * household member) and `ha-book-on-behalf` (the desk, for a caller with or
 * without an account). Each does its OWN authorisation and hands in an
 * already-authorised input; this file does everything after that, exactly
 * as Gate C did — replay → the patient/provisional exists → rate limit →
 * the mode's checks → INSERT with a booking code → the notification rows
 * (receipt, T-24h confirmation request, T-2h arrival window — Gate E,
 * `notification_dispatches`) → audit. Nothing about the allocator, the code,
 * the window or the booking's dispatch rows lives anywhere else (a test
 * greps for that).
 *
 * The patient is EITHER an account (`{ userId }`) OR a provisional record
 * (`{ provisionalId }`, migration 0060). A provisional booking is inserted
 * with `patient_user_id` NULL — always, even when the provisional was
 * reconciled before: `ha-reconcile-identity` is the ONLY writer of
 * `patient_user_id` on a provisional row (PRD §2.8, never automatic), and
 * the desk confirms again at the next visit.
 *
 * Replay and the rate limit key on `created_by_user_id` — "the submissions
 * this ACTOR made" — which for a patient booking for themselves is exactly
 * the (patient_user_id, key) Gate C used, and for a desk user or an agent is
 * the only key that exists (index `appointments_creator_idempotency_unique`).
 *
 * A confidential line (PRD §2.9) is refused when a patient books for
 * someone else; the desk may book it.
 *
 * A MOVE (`reschedule-appointment`'s `to`, ADR 0473) books here like any
 * other booking — capacity, opening hours, the clinic-day number — and only
 * `movedFrom` differs: the new row links back to the one it replaces and
 * carries that row's quote (ADR 0092: a held price is never re-quoted).
 */
import type { CadreFee } from "./fees.ts";
import type { BookingSymptom } from "./symptoms.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.106.1";

import { bookingDispatchRows } from "./dispatches.ts";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  serverError,
  tooManyRequests,
} from "./errors.ts";
import { resolveFee } from "./fees.ts";
import { recordSaAudit } from "./sa-audit.ts";
import {
  arrivalWindow,
  bookingCode,
  checkSlot,
  DEFAULT_TIME_ZONE,
  LIVE_APPOINTMENT_STATUSES,
  resolveSchedulingSettings,
} from "./slots.ts";

/** Retries on `appointments_hospital_booking_code_unique` before giving up. */
const BOOKING_CODE_ATTEMPTS = 5;

/** The columns every 200 body carries, on a fresh insert or a replay. */
const RETURNING =
  "id, status, booking_code, position_number, arrival_window_start, arrival_window_end, provisional_patient_id";

export interface BookedRow {
  id: string;
  status: string;
  booking_code: string | null;
  position_number: number | null;
  arrival_window_start: string | null;
  arrival_window_end: string | null;
  provisional_patient_id: string | null;
}

/** Gate C's response body, plus `provisional_patient_id` (null for an account). */
export const toBookingResponse = (row: BookedRow) => ({
  appointment_id: row.id,
  status: row.status,
  booking_code: row.booking_code ?? null,
  position_number: row.position_number ?? null,
  arrival_window_start: row.arrival_window_start ?? null,
  arrival_window_end: row.arrival_window_end ?? null,
  provisional_patient_id: row.provisional_patient_id ?? null,
});

export interface SlotInput {
  clinician_user_id: string;
  department_id: string;
  starts_at: string;
  ends_at: string;
  type: "in_person" | "virtual";
  service_line_id?: string;
}

export type BookPatient = { userId: string } | { provisionalId: string };

export interface BookInput {
  patient: BookPatient;
  /** `created_by_user_id`; the replay and rate-limit key. */
  actorId: string;
  /** 'ussd' (Gate F): the caller is a carrier-verified phone with no account. */
  origin: "patient" | "reception" | "clinician" | "ussd";
  channel: "web" | "app" | "desk" | "ussd";
  hospitalId: string;
  reason: string;
  note: string | null;
  /** What the patient said is bothering them — words for the clinic, never routed (ADR 0095). */
  symptoms?: BookingSymptom[] | null;
  /**
   * ADR 0098 ruling 6: the patient-callable same-day path books `urgent`;
   * every other caller leaves this out and gets `routine`, as before.
   */
  priority?: "routine" | "urgent";
  /** The advisory tier from a signed catalog (ruling 3) — on the row, never on an element. */
  symptomTier?: "E" | "U" | "R" | null;
  symptomSubmissionId?: string | null;
  /** A move: the booking this one replaces, and the quote it carries over verbatim. */
  movedFrom?: {
    appointmentId: string;
    quotedFeeUgx: number | null;
    quotedFeeLabel: string | null;
    quotedFeeAt: string | null;
  };
  idempotencyKey: string;
  slot?: SlotInput;
  session?: { sessionId: string };
  /** Days ahead the actor may hold a booking (ADR 0084 §8: 14 for a patient); null = no horizon. */
  horizonDays: number | null;
  rateLimit: { perHour: number; message: string };
  audit: {
    action: "book_appointment" | "book_on_behalf";
    reason: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  };
}

export interface BookContext {
  sb: SupabaseClient;
  init: { origin: string | null; requestId: string };
  log: { info: LogFn; warn: LogFn; error: LogFn };
}
type LogFn = (msg: string, ctx?: Record<string, unknown>) => void;

export type BookResult =
  | { ok: true; row: BookedRow; replayed: boolean }
  | { ok: false; response: Response };

export const beyondHorizonMessage = (days: number) =>
  `You can ask for a day up to ${days} days from now. Choose from the days the clinic has open.`;

/** A `[0, 1)` source backed by the platform CSPRNG, for `bookingCode`. */
const cryptoRandom = () => (crypto.getRandomValues(new Uint32Array(1))[0] as number) / 2 ** 32;

const violates = (error: { code?: string; message?: string } | null, index: string) =>
  error?.code === "23505" && !!error.message?.includes(index);

/**
 * The same submission, retried, must answer with the booking it already
 * made. Exported so a caller that creates rows BEFORE booking (the desk's
 * provisional insert) can ask first and create nothing twice.
 */
export async function findReplay(
  sb: SupabaseClient,
  actorId: string,
  idempotencyKey: string,
): Promise<BookedRow | null> {
  return (
    (
      await sb
        .from("appointments")
        .select(RETURNING)
        .eq("created_by_user_id", actorId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
    ).data ?? null
  );
}

export async function bookAppointment(ctx: BookContext, input: BookInput): Promise<BookResult> {
  const { sb, init, log } = ctx;
  const fail = (response: Response): BookResult => ({ ok: false, response });
  const horizonMs = input.horizonDays == null ? null : Date.now() + input.horizonDays * 86_400_000;
  const beyondHorizon = () =>
    fail(badRequest(beyondHorizonMessage(input.horizonDays as number), init));

  if ((input.slot ? 1 : 0) + (input.session ? 1 : 0) !== 1) {
    return fail(badRequest("Send exactly one of `slot` or `session`.", init));
  }
  if (input.slot) {
    if (new Date(input.slot.ends_at) <= new Date(input.slot.starts_at)) {
      return fail(badRequest("ends_at must be > starts_at.", init));
    }
    if (horizonMs !== null && new Date(input.slot.starts_at).getTime() > horizonMs) {
      return beyondHorizon();
    }
  }

  // 0. Replay? Before the rate limit counts it and before the slot engine
  //    sees that booking as "taken".
  const prior = await findReplay(sb, input.actorId, input.idempotencyKey);
  if (prior) return { ok: true, row: prior, replayed: true };

  // 1. The person the booking is for exists. The provisional's phone
  //    ciphertext is carried to the dispatch rows as-is (never decrypted here).
  const forSelf = "userId" in input.patient && input.patient.userId === input.actorId;
  let provisionalPhoneEncrypted: string | null = null;
  if ("userId" in input.patient) {
    const { data: patient, error: patientError } = await sb
      .from("patient_profiles")
      .select("id")
      .eq("id", input.patient.userId)
      .maybeSingle();
    if (patientError) return fail(serverError(patientError.message, init));
    if (!patient) {
      return fail(
        input.origin === "patient"
          ? forbidden(init, "only patients can request appointments through this surface")
          : notFound(init, "That person is not a registered patient."),
      );
    }
  } else {
    const { data: prov, error: provError } = await sb
      .from("provisional_patients")
      .select("id, hospital_id, reconciliation_state, phone_encrypted")
      .eq("id", input.patient.provisionalId)
      .maybeSingle();
    if (provError) return fail(serverError(provError.message, init));
    provisionalPhoneEncrypted = prov?.phone_encrypted ?? null;
    // A desk-created record is tenant-scoped; a household member's (NULL) may book anywhere.
    if (!prov || (prov.hospital_id !== null && prov.hospital_id !== input.hospitalId)) {
      return fail(notFound(init, "That person is not on this hospital's list."));
    }
    if (prov.reconciliation_state === "rejected") {
      return fail(
        conflict("The desk could not confirm who this person is. Ask them to register.", init),
      );
    }
  }

  // 2. Rate limit: submissions this actor MADE in the last hour, whatever
  //    became of them. Counted after the replay so a retry never trips it.
  const { count: recent, error: rateError } = await sb
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("created_by_user_id", input.actorId)
    .gt("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if (rateError) return fail(serverError(rateError.message, init));
  if ((recent ?? 0) >= input.rateLimit.perHour) {
    return fail(tooManyRequests(input.rateLimit.message, init));
  }

  // PRD §2.9: a confidential line is never bookable for someone else by a patient.
  const refuseConfidential = input.origin === "patient" && !forSelf;
  const confidentialRefusal = () =>
    fail(forbidden(init, "This clinic cannot be booked for someone else."));

  const who =
    "userId" in input.patient
      ? { patient_user_id: input.patient.userId, provisional_patient_id: null }
      : { patient_user_id: null, provisional_patient_id: input.patient.provisionalId };

  // 3. The mode decides what goes in the row and who may confirm it.
  //    `release` is the compensating step for a session allocation that an
  //    INSERT then failed to use.
  let row: Record<string, unknown>;
  let startsAtIso: string;
  let release: (() => Promise<void>) | null = null;

  if (input.session) {
    // ── Session path ──────────────────────────────────────────────
    const { data: session, error: sessionError } = await sb
      .from("clinic_sessions")
      .select(
        "id, hospital_id, department_id, service_line_id, clinician_user_id, starts_at, ends_at, " +
          "capacity_booked, overbooking_factor, " +
          "service_lines!inner(id, name, active, capacity_mode, reason_codes, confidential, " +
          "payment_posture, fee_ugx), hospitals!inner(state)",
      )
      .eq("id", input.session.sessionId)
      .eq("hospital_id", input.hospitalId)
      .eq("status", "published")
      .gt("starts_at", new Date().toISOString())
      .eq("service_lines.active", true)
      .eq("service_lines.capacity_mode", "session")
      // ADR 0086: a suspended hospital's published days are not bookable.
      .eq("hospitals.state", "active")
      .maybeSingle();
    if (sessionError) return fail(serverError(sessionError.message, init));
    if (!session) {
      return fail(
        notFound(init, "That clinic day is not open for booking — refresh and pick again."),
      );
    }
    if (horizonMs !== null && new Date(session.starts_at).getTime() > horizonMs) {
      return beyondHorizon();
    }

    const line = session.service_lines as {
      id: string;
      name: string;
      reason_codes: string[];
      confidential: boolean;
      payment_posture: string;
      fee_ugx: number | null;
    };
    if (!line.reason_codes.includes(input.reason)) {
      return fail(badRequest("That clinic does not take this reason.", init));
    }
    if (refuseConfidential && line.confidential) return confidentialRefusal();
    // appointments.clinician_user_id is NOT NULL; a clinic day with no
    // clinician yet (the console's T-12h rule) cannot hold a booking.
    if (!session.clinician_user_id) {
      return fail(conflict("This clinic day has no clinician assigned yet.", init));
    }

    // The allocator: one UPDATE, guard in the WHERE, NULL when full.
    const { data: position, error: allocError } = await sb.rpc("allocate_session_position", {
      p_session: session.id,
    });
    if (allocError) return fail(serverError(allocError.message, init));
    if (position == null) {
      const { data: next } = await sb.rpc("next_sessions_of_line", {
        p_line: session.service_line_id,
        p_after: new Date().toISOString(),
      });
      return fail(
        conflict("This clinic day is full — here are the next two.", init, {
          next_sessions: next ?? [],
        }),
      );
    }
    release = async () => {
      const { error } = await sb.rpc("release_session_position", { p_session: session.id });
      if (error) {
        log.error("compensating release failed — a place is leaked", {
          requestId: init.requestId,
          session_id: session.id,
          reason: error.message,
        });
      }
    };

    const window = arrivalWindow({
      sessionStartsAt: session.starts_at,
      sessionEndsAt: session.ends_at,
      capacityBooked: session.capacity_booked,
      overbookingFactor: Number(session.overbooking_factor),
      position,
    });

    // The cadre — and so the fee — is knowable precisely because the 409
    // above guarantees a named clinician. One extra read, only when the line
    // charges at all.
    const quote = await quoteFor(sb, {
      posture: line.payment_posture,
      baseFeeUgx: line.fee_ugx,
      lineName: line.name,
      lineId: line.id,
      clinicianUserId: session.clinician_user_id as string,
      hospitalId: input.hospitalId,
      departmentId: session.department_id as string,
    });

    startsAtIso = session.starts_at;
    row = {
      hospital_id: input.hospitalId,
      department_id: session.department_id,
      ...who,
      clinician_user_id: session.clinician_user_id,
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      reason: input.reason,
      reason_note: input.note ?? null,
      symptoms: input.symptoms?.length ? input.symptoms : null,
      symptom_tier: input.symptomTier ?? null,
      symptom_submission_id: input.symptomSubmissionId ?? null,
      origin: input.origin,
      status: "confirmed",
      priority: input.priority ?? "routine",
      type: "in_person",
      created_by_user_id: input.actorId,
      session_id: session.id,
      position_number: position,
      arrival_window_start: window.start.toISOString(),
      arrival_window_end: window.end.toISOString(),
      channel: input.channel,
      idempotency_key: input.idempotencyKey,
      // Snapshotted, never joined back to — the same rule the arrival window
      // follows, so a facility editing its price never moves a held booking.
      quoted_fee_ugx: quote.feeUgx,
      quoted_fee_label: quote.label,
      quoted_fee_at: quote.feeUgx === null ? null : new Date().toISOString(),
    };
  } else {
    // ── Slot path ─────────────────────────────────────────────────
    const slot = input.slot as SlotInput;

    // The clinician's active affiliation at (hospital, department) is the
    // whole boundary since ADR 0086: a CLINICAL cadre at an ACTIVE hospital.
    const { data: aff, error: affError } = await sb
      .from("staff_affiliations")
      .select("id, state, cadre_id, hospitals!inner(state), cadres!inner(is_clinical, name)")
      .eq("user_id", slot.clinician_user_id)
      .eq("hospital_id", input.hospitalId)
      .eq("department_id", slot.department_id)
      .in("state", ["active", "approved"])
      .eq("hospitals.state", "active")
      .eq("cadres.is_clinical", true)
      .limit(1)
      .maybeSingle();
    if (affError) return fail(serverError(affError.message, init));
    if (!aff) {
      return fail(
        notFound(init, "clinician isn't active at this department — refresh and pick again"),
      );
    }

    // A slot booked without a named line (the phone's path) carries no fee:
    // nothing priced it, and inventing one would be worse than silence.
    let slotQuote: { feeUgx: number | null; label: string | null } = {
      feeUgx: null,
      label: null,
    };

    // A line, when the wizard named one, restricts the reason. The phone's
    // slot path names none and is accepted as before.
    if (slot.service_line_id) {
      const { data: line, error: lineError } = await sb
        .from("service_lines")
        .select("id, name, reason_codes, confidential, payment_posture, fee_ugx")
        .eq("id", slot.service_line_id)
        .eq("hospital_id", input.hospitalId)
        .eq("department_id", slot.department_id)
        .eq("active", true)
        .maybeSingle();
      if (lineError) return fail(serverError(lineError.message, init));
      if (!line) return fail(notFound(init, "That clinic is not open for booking."));
      if (!(line.reason_codes as string[]).includes(input.reason)) {
        return fail(badRequest("That clinic does not take this reason.", init));
      }
      if (refuseConfidential && line.confidential) return confidentialRefusal();
      // The cadre came free with the affiliation read above; only the
      // override table is an extra query, and only when the line charges.
      slotQuote = await quoteFor(sb, {
        posture: line.payment_posture as string,
        baseFeeUgx: (line.fee_ugx as number | null) ?? null,
        lineName: line.name as string,
        lineId: line.id as string,
        cadreId: (aff.cadre_id as string | null) ?? null,
        cadreName: (aff.cadres as { name?: string } | null)?.name ?? null,
      });
    }

    // Is this a slot the engine would have offered? Four reads, then one
    // `checkSlot` — the same arithmetic the read surfaces offer slots with.
    const [blocksRes, apptsRes, { data: settings }, { data: deptPolicy }] = await Promise.all([
      sb
        .from("availability_blocks")
        // No kind/state filter: "bookable" is the engine's definition, and it
        // also needs every overlapping window to suppress a double offer.
        // Aliased to the camelCase the engine reads.
        .select(
          "kind, state, startsAt:starts_at, endsAt:ends_at, recurrence, " +
            "recurrenceWeekday:recurrence_weekday, recurrenceUntil:recurrence_until",
        )
        .eq("clinician_user_id", slot.clinician_user_id)
        .eq("hospital_id", input.hospitalId)
        .or(`department_id.eq.${slot.department_id},department_id.is.null`)
        .lt("starts_at", slot.ends_at)
        .or(`ends_at.gt.${slot.starts_at},recurrence.eq.weekly`),
      sb
        .from("appointments")
        // Not scoped to the hospital: a clinician booked at their other
        // hospital is still one person.
        .select("startsAt:starts_at, endsAt:ends_at")
        .eq("clinician_user_id", slot.clinician_user_id)
        .in("status", [...LIVE_APPOINTMENT_STATUSES])
        .lt("starts_at", slot.ends_at)
        .gt("ends_at", slot.starts_at),
      sb
        .from("clinician_scheduling_settings")
        .select("default_slot_minutes, buffer_minutes, auto_confirm, allow_virtual")
        .eq("clinician_user_id", slot.clinician_user_id)
        .eq("hospital_id", input.hospitalId)
        .maybeSingle(),
      sb
        .from("department_scheduling_policy")
        .select(
          "default_slot_minutes, default_buffer_minutes, default_auto_confirm, allow_virtual, " +
            "bookable_weekdays, bookable_start_minutes_local, bookable_end_minutes_local",
        )
        .eq("department_id", slot.department_id)
        .maybeSingle(),
    ]);
    // Fail closed: an unread block list rejects a legitimate booking, and an
    // unread appointment list accepts one on top of an existing patient.
    if (blocksRes.error) return fail(serverError(blocksRes.error.message, init));
    if (apptsRes.error) return fail(serverError(apptsRes.error.message, init));

    const clinicianSettings = settings && {
      defaultSlotMinutes: settings.default_slot_minutes,
      bufferMinutes: settings.buffer_minutes,
      autoConfirm: settings.auto_confirm,
      allowVirtual: settings.allow_virtual,
    };
    const departmentPolicy = deptPolicy && {
      defaultSlotMinutes: deptPolicy.default_slot_minutes,
      defaultBufferMinutes: deptPolicy.default_buffer_minutes,
      defaultAutoConfirm: deptPolicy.default_auto_confirm,
      allowVirtual: deptPolicy.allow_virtual,
      bookableWeekdays: deptPolicy.bookable_weekdays,
      bookableStartMinutesLocal: deptPolicy.bookable_start_minutes_local,
      bookableEndMinutesLocal: deptPolicy.bookable_end_minutes_local,
    };

    const notOfferable = checkSlot({
      blocks: blocksRes.data ?? [],
      appointments: apptsRes.data ?? [],
      clinicianSettings,
      departmentPolicy,
      timeZone: DEFAULT_TIME_ZONE,
      now: new Date(),
      startsAt: new Date(slot.starts_at),
      endsAt: new Date(slot.ends_at),
    });
    if (notOfferable) return fail(badRequest(notOfferable, init));

    // Virtual is refused unless something GRANTS it — ADR 0029 §2's chain.
    if (
      slot.type === "virtual" &&
      !resolveSchedulingSettings(clinicianSettings, departmentPolicy).allowVirtual
    ) {
      return fail(badRequest("This clinician doesn't accept virtual appointments.", init));
    }

    // The clinician's own row alone, NOT the resolved chain — reading the
    // department's default here would start auto-confirming at clinicians
    // who never configured it, a product decision ADR 0084 does not make.
    startsAtIso = slot.starts_at;
    row = {
      hospital_id: input.hospitalId,
      department_id: slot.department_id,
      ...who,
      clinician_user_id: slot.clinician_user_id,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      reason: input.reason,
      reason_note: input.note ?? null,
      symptoms: input.symptoms?.length ? input.symptoms : null,
      symptom_tier: input.symptomTier ?? null,
      symptom_submission_id: input.symptomSubmissionId ?? null,
      origin: input.origin,
      status: settings?.auto_confirm ? "confirmed" : "pending_approval",
      priority: input.priority ?? "routine",
      type: slot.type,
      created_by_user_id: input.actorId,
      channel: input.channel,
      idempotency_key: input.idempotencyKey,
      quoted_fee_ugx: slotQuote.feeUgx,
      quoted_fee_label: slotQuote.label,
      quoted_fee_at: slotQuote.feeUgx === null ? null : new Date().toISOString(),
    };
  }

  if (input.movedFrom) {
    row.rescheduled_from_appointment_id = input.movedFrom.appointmentId;
    row.quoted_fee_ugx = input.movedFrom.quotedFeeUgx;
    row.quoted_fee_label = input.movedFrom.quotedFeeLabel;
    row.quoted_fee_at = input.movedFrom.quotedFeeAt;
  }

  // 4. INSERT, with a fresh booking code per attempt. Uniqueness per
  //    hospital is the index's job; a collision at 32^6 is rare enough that
  //    five tries is generous.
  let inserted: BookedRow | null = null;
  let insertError: { code?: string; message?: string } | null = null;
  for (let attempt = 0; attempt < BOOKING_CODE_ATTEMPTS && !inserted; attempt++) {
    const res = await sb
      .from("appointments")
      .insert({ ...row, booking_code: bookingCode(cryptoRandom) })
      .select(RETURNING)
      .single();
    insertError = res.error;
    if (res.data) inserted = res.data as BookedRow;
    else if (!violates(res.error, "appointments_hospital_booking_code_unique")) break;
  }
  if (!inserted) {
    if (release) await release();
    if (violates(insertError, "appointments_no_double_booking")) {
      return fail(conflict("Someone just took this slot — pick another and try again.", init));
    }
    if (
      violates(insertError, "appointments_idempotency_unique") ||
      violates(insertError, "appointments_creator_idempotency_unique")
    ) {
      // Two retries of one submission raced past step 0; the other one won.
      const winner = await findReplay(sb, input.actorId, input.idempotencyKey);
      if (winner) return { ok: true, row: winner, replayed: true };
    }
    log.error("appointment insert failed", {
      requestId: init.requestId,
      reason: insertError?.message,
    });
    return fail(serverError("could not create appointment", init));
  }
  const created: BookedRow = inserted;

  // 5. The notification rows (Gate E, ADR 0090): the receipt now (push +
  //    SMS, the durable proof), the confirmation request at T-24h (push,
  //    SMS if no ack by T-20h) and, for a clinic-day position, the arrival
  //    window at T-2h. One insert, ON CONFLICT DO NOTHING on the idempotency
  //    key, drained by the every-15-minute dispatcher. Best-effort.
  const recipient =
    "userId" in input.patient
      ? { userId: input.patient.userId }
      : provisionalPhoneEncrypted
        ? { phoneEncrypted: provisionalPhoneEncrypted }
        : null;
  if (recipient) {
    const dispatchInserts = bookingDispatchRows({
      hospitalId: input.hospitalId,
      recipient,
      appointmentId: created.id,
      startsAtIso,
      isSession: !!input.session,
      nowIso: new Date().toISOString(),
    });
    const { error: dispatchError } = await sb
      .from("notification_dispatches")
      .upsert(dispatchInserts, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (dispatchError) {
      log.warn("dispatch queue failed (continuing)", {
        requestId: init.requestId,
        reason: dispatchError.message,
      });
    }
  } else {
    log.warn("booking has no reachable recipient — no receipt queued", {
      requestId: init.requestId,
      appointment_id: created.id,
    });
  }

  // 6. Audit.
  try {
    await recordSaAudit({
      actorId: input.actorId,
      action: input.audit.action,
      targetKind: "appointment",
      targetId: created.id,
      reason: input.audit.reason,
      requestId: input.audit.requestId,
      ipAddress: input.audit.ipAddress,
      userAgent: input.audit.userAgent,
      beforeData: null,
      afterData: {
        clinician_user_id: row.clinician_user_id,
        hospital_id: input.hospitalId,
        patient_user_id: who.patient_user_id,
        provisional_patient_id: who.provisional_patient_id,
        starts_at: startsAtIso,
        status: created.status,
        type: row.type,
        origin: input.origin,
        channel: input.channel,
        session_id: (row.session_id as string | undefined) ?? null,
        position_number: created.position_number,
        booking_code: created.booking_code,
        // A count, never the words: free text in sa_audit_log is PHI-adjacent.
        symptom_count: input.symptoms?.length ?? 0,
        priority: row.priority,
        symptom_tier: row.symptom_tier ?? null,
      },
    });
  } catch (e) {
    log.warn("sa_audit failed (booking already created)", {
      requestId: init.requestId,
      appointment_id: created.id,
      reason: String(e),
    });
  }

  log.info("appointment created", {
    requestId: init.requestId,
    appointment_id: created.id,
    status: created.status,
    mode: input.session ? "session" : "slot",
    for: who.provisional_patient_id ? "provisional" : forSelf ? "self" : "other",
  });
  return { ok: true, row: created, replayed: false };
}

/** Wrap a core result as the HTTP body every booking surface answers with. */
export function bookingResponse(result: BookResult, init: BookContext["init"]): Response {
  return result.ok ? ok(toBookingResponse(result.row), init) : result.response;
}

/**
 * The quote for one booking: the line's posture and base, plus any cadre
 * override, resolved by the shared `resolveFee` (ADR 0092). Reads
 * `service_line_fees` only when the line charges at all, so a free line and a
 * facility that never sets an override both cost zero extra queries.
 *
 * Fails OPEN to the base fee: a price that cannot be refined is still a price
 * the facility published, and refusing a booking over a fee lookup would put
 * money in front of care — which this product does not do.
 */
async function quoteFor(
  sb: SupabaseClient,
  args: {
    posture: string;
    baseFeeUgx: number | null;
    lineName: string;
    lineId: string;
    /** Slot path: the cadre came free with the affiliation read. */
    cadreId?: string | null;
    cadreName?: string | null;
    /** Session path: look the cadre up from the named clinician. */
    clinicianUserId?: string;
    hospitalId?: string;
    departmentId?: string;
  },
): Promise<{ feeUgx: number | null; label: string | null }> {
  if (args.posture === "none" || args.baseFeeUgx === null) {
    return { feeUgx: null, label: null };
  }

  let cadreId = args.cadreId ?? null;
  if (!cadreId && args.clinicianUserId) {
    const { data: aff, error: affError } = await sb
      .from("staff_affiliations")
      .select("cadre_id")
      .eq("user_id", args.clinicianUserId)
      .eq("hospital_id", args.hospitalId as string)
      .eq("department_id", args.departmentId as string)
      .in("state", ["active", "approved"])
      .limit(1)
      .maybeSingle();
    if (affError) {
      // Fail open to the base fee — but never silently: an override this
      // patient should have been quoted may be lost, and someone must know.
      console.warn("quoteFor: cadre read failed, quoting the base fee", {
        line_id: args.lineId,
        reason: affError.message,
      });
    }
    cadreId = (aff?.cadre_id as string | null) ?? null;
  }

  const { data: rows, error: feesError } = await sb
    .from("service_line_fees")
    .select("cadre_id, fee_ugx, cadres!inner(name)")
    .eq("service_line_id", args.lineId);
  if (feesError) {
    console.warn("quoteFor: override read failed, quoting the base fee", {
      line_id: args.lineId,
      reason: feesError.message,
    });
  }

  const cadreFees: CadreFee[] = (
    (rows ?? []) as Array<{
      cadre_id: string;
      fee_ugx: number;
      cadres: { name: string } | null;
    }>
  ).map((r) => ({
    cadreId: r.cadre_id,
    cadreName: r.cadres?.name ?? args.lineName,
    feeUgx: r.fee_ugx,
  }));

  return resolveFee(
    {
      posture: args.posture,
      baseFeeUgx: args.baseFeeUgx,
      lineName: args.lineName,
      cadreFees,
    },
    cadreId,
  );
}
