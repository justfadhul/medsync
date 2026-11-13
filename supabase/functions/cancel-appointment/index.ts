/**
 * cancel-appointment — patient or staff cancels an appointment.
 *
 * Callable by:
 *   - The patient (own appointment).
 *   - The clinician (own appointment).
 *   - Hospital_admin / superadmin at the appointment's hospital.
 *   - Reception at the appointment's hospital (ADR 0473): a RECEPTION-cadre
 *     affiliation there (`isReceptionAt`). Reception elsewhere, or another
 *     staff role here, is refused.
 *
 * Refuses to cancel statuses where cancel doesn't make sense
 * (already cancelled, declined, completed, no_show).
 *
 * Also cancels any queued reminders / dispatches so they don't fire after
 * the appointment is gone, and offers the freed place to the waitlist
 * (`releaseCapacity`, Gate E — PRD §3.2.5: "cancellation immediately offers
 * the released capacity to the waitlist").
 *
 * The reason (Gate H ruling, ADR 0094): staff free text is STAFF ONLY. A
 * patient reads their appointments rows straight through RLS (the phone uses
 * supabase-js), and a booking agent reads the rows they created, so the text
 * must not sit in a column they can select. `cancelled_reason` carries a
 * closed CODE — `patient_cancelled` when the patient cancels their own visit,
 * `staff_cancelled` otherwise — and the free text lives in the
 * `cancel_appointment` sa_audit_log row alone — readable on /admin/audit
 * (superadmin); no hospital surface reads it today, by the ruling's own price.
 * Patient and agent surfaces map the code to one fixed sentence.
 *
 * A cancel by the clinic is never silent (ADR 0473): when anyone but the
 * patient cancels, the patient gets one `visit_cancelled` message, push and
 * SMS, through the ordinary dispatcher — the words come from the kind, never
 * from what staff typed.
 */
import { z } from "npm:zod@4.4.3";

import { getCaller, hasRole, serviceClient } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { dispatchRows } from "../_shared/dispatches.ts";
import {
  badRequest,
  forbidden,
  methodNotAllowed,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "../_shared/errors.ts";
import { isReceptionAt, requireHospitalAdminScope } from "../_shared/hospital-admin-scope.ts";
import { makeLogger } from "../_shared/logger.ts";
import { networkContext, recordSaAudit } from "../_shared/sa-audit.ts";
import { bookingRecipient, cancelPendingDispatches, releaseCapacity } from "../_shared/waitlist.ts";

const log = makeLogger("cancel-appointment");

const InputSchema = z.object({
  appointment_id: z.string().uuid(),
  reason: z.string().min(8, "Reason ≥ 8 chars required."),
});

const CANCELLABLE_STATES = new Set(["requested", "pending_approval", "confirmed", "arrived"]);

/** The closed codes `appointments.cancelled_reason` may carry from here. */
const CANCEL_CODES = { patient: "patient_cancelled", staff: "staff_cancelled" } as const;

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const init = { origin, requestId };
  const pre = preflight(request);
  if (pre) return pre;
  if (request.method !== "POST") return methodNotAllowed(init);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body must be JSON", init);
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return badRequest("Invalid input", init, parsed.error.flatten());
  const input = parsed.data;

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);

  const sb = serviceClient();
  const { data: appt, error } = await sb
    .from("appointments")
    .select(
      "id, hospital_id, clinician_user_id, patient_user_id, provisional_patient_id, status, session_id",
    )
    .eq("id", input.appointment_id)
    .maybeSingle();
  if (error) return serverError(error.message, init);
  if (!appt) return notFound(init, "appointment not found");

  const isSuperadmin = await hasRole(caller.id, "superadmin");
  const isPatient = caller.id === appt.patient_user_id;
  const isClinician = caller.id === appt.clinician_user_id;
  if (!isSuperadmin && !isPatient && !isClinician) {
    if (await hasRole(caller.id, "hospital_admin", appt.hospital_id)) {
      const scope = await requireHospitalAdminScope(caller.id, appt.hospital_id);
      if (!scope.ok) return forbidden(init, scope.reason);
    } else if (!(await isReceptionAt(caller.id, appt.hospital_id))) {
      return forbidden(init, "you can't cancel this appointment");
    }
  }

  if (!CANCELLABLE_STATES.has(appt.status)) {
    return badRequest(
      `Appointment is in '${appt.status}' — already past the cancellable window.`,
      init,
    );
  }

  // The code the row carries; the words go to the audit row only.
  const cancelledReason = isPatient ? CANCEL_CODES.patient : CANCEL_CODES.staff;
  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "cancel_appointment",
      targetKind: "appointment",
      targetId: appt.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { status: appt.status },
      afterData: { status: "cancelled", cancelled_reason: cancelledReason },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  // The status guard is repeated in the UPDATE so two concurrent cancels
  // flip the row once — and release its session place once.
  const { data: flipped, error: updateError } = await sb
    .from("appointments")
    .update({
      status: "cancelled",
      cancelled_reason: cancelledReason,
      cancelled_by_user_id: caller.id,
    })
    .eq("id", appt.id)
    .in("status", [...CANCELLABLE_STATES])
    .select("id")
    .maybeSingle();
  if (updateError) {
    log.error("cancel failed", { requestId, reason: updateError.message });
    return serverError("cancel failed", init);
  }

  // A session booking gives its place back (ADR 0088): booked_count only —
  // next_position is monotonic, so the number is never re-issued.
  if (appt.session_id && flipped) {
    const { error: releaseError } = await sb.rpc("release_session_position", {
      p_session: appt.session_id,
    });
    if (releaseError) {
      log.error("release_session_position failed — a place is leaked", {
        requestId,
        session_id: appt.session_id,
        reason: releaseError.message,
      });
    }
  }

  // Reap queued reminders and dispatches (best-effort).
  await sb
    .from("appointment_reminders")
    .update({ state: "cancelled" })
    .eq("appointment_id", appt.id)
    .eq("state", "queued");
  await cancelPendingDispatches(sb, "appointment", appt.id, "appointment_cancelled");

  // The clinic cancelled: tell the patient (after the reap above, which would take it).
  if (flipped && !isPatient) {
    const recipient = await bookingRecipient(sb, appt);
    if (recipient) {
      const { error: dispatchError } = await sb.from("notification_dispatches").upsert(
        dispatchRows({
          kind: "visit_cancelled",
          hospitalId: appt.hospital_id,
          recipient,
          appointmentId: appt.id,
          nowIso: new Date().toISOString(),
        }),
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      );
      if (dispatchError) {
        log.error("visit_cancelled dispatch failed — the patient is not told", {
          requestId,
          appointment_id: appt.id,
          reason: dispatchError.message,
        });
      }
    }
  }

  // The freed place goes to whoever is waiting (Gate E).
  if (flipped) await releaseCapacity(sb, appt.id, log, requestId);

  log.info("appointment cancelled", { requestId, appointment_id: appt.id });
  return ok({ appointment_id: appt.id, status: "cancelled" }, init);
});
