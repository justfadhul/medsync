/**
 * ha-set-session-delay — "Running late by N minutes" (Gate E, ADR 0090;
 * PRD §3.6: "a patient whose window has moved by more than a threshold
 * gets a proactive message. Silence here is the thing patients hate most").
 *
 * Inputs: session_id, delay_minutes (0..480; 0 clears a delay).
 *
 * Callable by reception at the session's hospital (D-RD-11, lateness only), a superadmin, a hospital_admin of the
 * session's hospital, or
 * the clinician the session names. The stored arrival windows of every
 * un-arrived position (status 'confirmed') move by the DIFFERENCE between
 * the old delay and the new one, so the window the patient was last told
 * is what shifts. When that shift is ≥ 30 minutes in either direction, a
 * `window_shifted` dispatch goes to each of them (push, SMS if no ack in
 * 15 minutes; keyed by the new delay, so re-sending the same value is a
 * no-op). Live position-called tracking is Gate H.
 */
import { z } from "npm:zod@4.4.3";

import { getCaller, hasRole, serviceClient } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { dispatchRows, WINDOW_SHIFT_THRESHOLD_MINUTES } from "../_shared/dispatches.ts";
import {
  badRequest,
  conflict,
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

const log = makeLogger("ha-set-session-delay");

const InputSchema = z.object({
  session_id: z.string().uuid(),
  delay_minutes: z.number().int().min(0).max(480),
});

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

  const { data: session, error } = await sb
    .from("clinic_sessions")
    .select("id, hospital_id, clinician_user_id, status, delay_minutes, ends_at")
    .eq("id", input.session_id)
    .maybeSingle();
  if (error) return serverError(error.message, init);
  if (!session) return notFound(init, "clinic day not found");

  const isSuperadmin = await hasRole(caller.id, "superadmin");
  const isSessionClinician = !!session.clinician_user_id && caller.id === session.clinician_user_id;
  // D-RD-11 (ADR 0485): the desk may mark its own hospital's clinic day as running late; only lateness.
  const isDesk =
    !isSuperadmin && !isSessionClinician && (await isReceptionAt(caller.id, session.hospital_id));
  if (!isSuperadmin && !isSessionClinician && !isDesk) {
    if (!(await hasRole(caller.id, "hospital_admin", session.hospital_id))) {
      return forbidden(
        init,
        "only the hospital admin or this clinic day's clinician can set a delay",
      );
    }
    const scope = await requireHospitalAdminScope(caller.id, session.hospital_id);
    if (!scope.ok) return forbidden(init, scope.reason);
  }
  if (session.status !== "published") {
    return conflict(`This clinic day is '${session.status}'.`, init);
  }
  if (new Date(session.ends_at).getTime() <= Date.now()) {
    return conflict("This clinic day has already ended.", init);
  }

  const previous = Number(session.delay_minutes ?? 0);
  const shift = input.delay_minutes - previous;
  if (shift === 0) {
    return ok({ session_id: session.id, delay_minutes: previous, shifted: 0, notified: 0 }, init);
  }

  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "set_session_delay",
      targetKind: "clinic_session",
      targetId: session.id,
      reason: `clinic day running ${input.delay_minutes} minutes late`,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { delay_minutes: previous },
      afterData: { delay_minutes: input.delay_minutes },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  const { error: sessionError } = await sb
    .from("clinic_sessions")
    .update({ delay_minutes: input.delay_minutes })
    .eq("id", session.id);
  if (sessionError) return serverError(sessionError.message, init);

  // Un-arrived positions: shift the stored windows by the difference.
  const { data: positions, error: posError } = await sb
    .from("appointments")
    .select(
      "id, patient_user_id, arrival_window_start, arrival_window_end, provisional_patients(phone_encrypted)",
    )
    .eq("session_id", session.id)
    .eq("status", "confirmed");
  if (posError) return serverError(posError.message, init);

  const now = new Date().toISOString();
  let shifted = 0;
  const rows = [];
  for (const p of positions ?? []) {
    if (!p.arrival_window_start || !p.arrival_window_end) continue;
    const start = new Date(new Date(p.arrival_window_start).getTime() + shift * 60_000);
    const end = new Date(new Date(p.arrival_window_end).getTime() + shift * 60_000);
    const { error: winError } = await sb
      .from("appointments")
      .update({
        arrival_window_start: start.toISOString(),
        arrival_window_end: end.toISOString(),
      })
      .eq("id", p.id);
    if (winError) {
      log.warn("window shift failed for one position (continuing)", {
        requestId,
        appointment_id: p.id,
        reason: winError.message,
      });
      continue;
    }
    shifted += 1;
    if (Math.abs(shift) < WINDOW_SHIFT_THRESHOLD_MINUTES) continue;
    const phone = (p.provisional_patients as { phone_encrypted: string } | null)?.phone_encrypted;
    const recipient = p.patient_user_id
      ? { userId: p.patient_user_id as string }
      : phone
        ? { phoneEncrypted: phone }
        : null;
    if (!recipient) continue;
    rows.push(
      ...dispatchRows({
        kind: "window_shifted",
        hospitalId: session.hospital_id,
        recipient,
        nowIso: now,
        appointmentId: p.id,
        delayMinutes: input.delay_minutes,
        shiftMinutes: shift,
      }),
    );
  }
  if (rows.length > 0) {
    const { error: dispatchError } = await sb
      .from("notification_dispatches")
      .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (dispatchError) {
      log.warn("window_shifted dispatch insert failed", {
        requestId,
        reason: dispatchError.message,
      });
    }
  }

  log.info("session delay set", {
    requestId,
    session_id: session.id,
    delay_minutes: input.delay_minutes,
    shifted,
    notified: rows.length,
  });
  return ok(
    { session_id: session.id, delay_minutes: input.delay_minutes, shifted, notified: rows.length },
    init,
  );
});
