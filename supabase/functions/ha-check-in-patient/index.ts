/**
 * ha-check-in-patient — reception flips an inbound patient to
 * physically-present state. Two modes (exactly one required):
 *
 *   A) appointment_id — booked-arrival check-in (the original path):
 *      1. appointment.status confirmed → arrived (a booking the patient
 *         already marked arrived themselves is accepted as it is)
 *      2. queue_entries row (scheduled_arrival, waiting)  — skip virtual;
 *         the self-arrived row is reused, never doubled
 *      3. patient_intakes row (booked_arrival) on the chosen route
 *
 *   B) intake_id — patient-declared check-in (book-or-queue, mig 0035):
 *      1. patient_intakes.status declared → the route's status + checked_in_at=now()
 *      2. queue_entries row (walk_in, waiting) — same boundary as (A2)
 *      No new intake row; the patient's declared row IS the intake.
 *
 * ADR 0101: the desk picks the route — triage (the default) or straight to
 * the clinic — and may pick another department at the same hospital. An
 * emergency entry type is always triaged. The choice lands in
 * patient_intakes.routed_to and in the audit row's after_data.
 *
 * Auth: reception or hospital_admin at the hospital, or superadmin.
 *
 * Note: ha-mark-arrived already does step (A1)+(A2). This Edge Function
 * adds (A3) + (B), and relaxes auth so a non-clinical reception user
 * (RECEPTION cadre) can call it. Mirrors ha-register-intake's
 * broad-staff auth.
 */
import { z } from "npm:zod@4.4.3";

import { getCaller, serviceClient } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
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
import { authoriseAtHospital } from "../_shared/hospital-admin-scope.ts";
import { lookupEntryType } from "../_shared/intake.ts";
import { makeLogger } from "../_shared/logger.ts";
import { effectiveRoute, insertQueueRow, intakeStatusFor } from "../_shared/queue.ts";
import { networkContext, recordSaAudit } from "../_shared/sa-audit.ts";
import { DEFAULT_TIME_ZONE, localDateKey } from "../_shared/slots.ts";

const log = makeLogger("ha-check-in-patient");

const InputSchema = z
  .object({
    appointment_id: z.string().uuid().optional(),
    intake_id: z.string().uuid().optional(),
    /** ADR 0101: where the desk sends the arrival. Triage unless it says otherwise. */
    route: z.enum(["triage", "clinic"]).default("triage"),
    /** Another department at the same hospital; the booked / declared one when absent. */
    department_id: z.string().uuid().optional(),
    reason: z
      .string()
      .min(8, "Reason ≥ 8 chars required (audited).")
      .default("Patient checked in at front desk."),
    /** ADR 0488: the desk's id for this check-in. A replay (offline queue, double press) returns the first result. */
    client_id: z.string().uuid().optional(),
    device_label: z.string().trim().min(1).max(60).optional(),
  })
  .refine((v) => !!v.appointment_id !== !!v.intake_id, {
    message: "Provide exactly one of appointment_id or intake_id.",
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
  const { ipAddress, userAgent } = networkContext(request);

  // ADR 0488: a replayed client id finds its intake and answers as the first call did. Hospital-scoped below.
  if (input.client_id) {
    const { data: done, error: doneErr } = await sb
      .from("patient_intakes")
      .select("id, hospital_id, appointment_id, routed_to")
      .eq("client_id", input.client_id)
      .limit(1)
      .maybeSingle();
    if (doneErr) return serverError(doneErr.message, init);
    if (done) {
      const authError = await authoriseAtHospital(caller.id, done.hospital_id as string);
      if (authError) return forbidden(init, authError);
      return ok(
        {
          appointment_id: done.appointment_id,
          intake_id: done.id,
          route: done.routed_to ?? "triage",
          replayed: true,
        },
        init,
      );
    }
  }

  /* ─── Mode A: appointment_id (booked-arrival path) ───────────── */
  if (input.appointment_id) {
    const { data: appt, error: apptErr } = await sb
      .from("appointments")
      .select(
        "id, hospital_id, department_id, patient_user_id, provisional_patient_id, status, type, starts_at, priority",
      )
      .eq("id", input.appointment_id)
      .maybeSingle();
    if (apptErr) return serverError(apptErr.message, init);
    if (!appt) return notFound(init, "appointment not found");

    // 'arrived' is the patient's own "I have arrived" (ha-mark-arrived): they
    // are in the building but the desk has not routed them yet. Once an
    // intake names this booking, the desk has — a second check-in is refused.
    let selfArrived = false;
    if (appt.status === "arrived") {
      const { data: existing, error: existingErr } = await sb
        .from("patient_intakes")
        .select("id")
        .eq("appointment_id", appt.id)
        .limit(1)
        .maybeSingle();
      if (existingErr) return serverError(existingErr.message, init);
      selfArrived = !existing;
    }
    if (appt.status !== "confirmed" && !selfArrived) {
      return badRequest(
        `Appointment is in '${appt.status}' — only a confirmed booking, or one the patient marked arrived, can check in.`,
        init,
      );
    }
    // Check-in is today's door only: a booking for another day checked in now
    // would put a patient in today's line who is booked for a different one.
    const today = localDateKey(new Date(), DEFAULT_TIME_ZONE);
    if (localDateKey(appt.starts_at as string, DEFAULT_TIME_ZONE) !== today) {
      return badRequest("This booking is not for today — only today's bookings check in.", init);
    }

    const authError = await authoriseAtHospital(caller.id, appt.hospital_id);
    if (authError) return forbidden(init, authError);

    // A provisional booking (migration 0060) is checked in only once the desk
    // has confirmed who it is for — ha-reconcile-identity sets patient_user_id.
    // queue_entries needs a patient, and the intake row would name nobody.
    if (!appt.patient_user_id) {
      return conflict("Confirm who this booking is for before checking in.", init);
    }

    // ADR 0486: the reception desk (it always sends a client id) checks in only after a matching second
    // identifier for this booking in the last 30 minutes (ha-reception-desk op identity_check).
    if (input.client_id) {
      const since = new Date(Date.now() - 30 * 60_000).toISOString();
      const { data: idOk, error: idErr } = await sb
        .from("desk_identity_attempts")
        .select("id")
        .eq("appointment_id", appt.id)
        .eq("matched", true)
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();
      if (idErr) return serverError(idErr.message, init);
      if (!idOk) return conflict("Check it is them before checking in.", init);
    }

    // A booking is never an emergency entry; an urgent one is still triaged.
    const route = effectiveRoute(input.route, appt.priority === "urgent");
    const departmentId: string | null = input.department_id ?? appt.department_id ?? null;
    if (
      input.department_id &&
      !(await departmentAtHospital(sb, input.department_id, appt.hospital_id))
    ) {
      return badRequest("That department is not at this hospital.", init);
    }
    if (route === "clinic" && !departmentId) {
      return badRequest("Choose the clinic to send the patient to.", init);
    }

    try {
      await recordSaAudit({
        actorId: caller.id,
        action: "check_in_patient",
        targetKind: "appointment",
        targetId: appt.id,
        reason: input.reason,
        requestId,
        ipAddress,
        userAgent,
        beforeData: { status: appt.status },
        afterData: { status: "arrived", route, department_id: departmentId },
      });
    } catch (e) {
      log.error("sa_audit failed; aborting", { requestId, reason: String(e) });
      return serverError("audit write failed", init);
    }

    // A self-arrived booking is already 'arrived' — no second flip.
    if (!selfArrived) {
      // Only from 'confirmed': a second desk pressing at the same moment finds no row to change.
      const { data: flipped, error: updateError } = await sb
        .from("appointments")
        .update({ status: "arrived" })
        .eq("id", appt.id)
        .eq("status", "confirmed")
        .select("id");
      if (updateError) {
        log.error("status update failed", { requestId, reason: updateError.message });
        return serverError("check-in failed", init);
      }
      if (!flipped?.length) return conflict("This patient has just been checked in.", init);
    }

    // insertQueueRow reuses a self-arrived patient's row (moved to the chosen
    // department) rather than queueing them twice.
    const queueEntryId =
      appt.type === "virtual"
        ? null
        : await insertQueueRow(sb, {
            hospital_id: appt.hospital_id,
            department_id: departmentId,
            patient_user_id: appt.patient_user_id,
            appointment_id: appt.id,
            kind: "scheduled_arrival",
            requestId,
          });

    const { data: intakeRow, error: intakeError } = await sb
      .from("patient_intakes")
      .insert({
        hospital_id: appt.hospital_id,
        entry_type_code: "booked_arrival",
        entry_point: appt.type === "virtual" ? "virtual" : "opd",
        receiving_department_id: departmentId,
        patient_user_id: appt.patient_user_id,
        // Provenance of a booking made without an account (migration 0060),
        // kept so an un-reconcile can null the patient without orphaning the row.
        provisional_patient_id: appt.provisional_patient_id ?? null,
        appointment_id: appt.id,
        priority_hint: appt.priority === "urgent" ? "urgent" : "routine",
        status: intakeStatusFor(route),
        routed_to: route,
        registered_by_user_id: caller.id,
        client_id: input.client_id ?? null,
        device_label: input.device_label ?? null,
      })
      .select("id")
      .single();
    // Without the intake the patient reaches no triage worklist, so say so. The
    // booking is now 'arrived' with no intake, which a retry treats as self-arrived.
    if (intakeError) {
      log.error("intake insert failed", { requestId, reason: intakeError.message });
      return serverError("Check-in did not finish. Try again.", init);
    }

    log.info("checked in (booked)", {
      requestId,
      appointment_id: appt.id,
      queue_entry_id: queueEntryId,
      intake_id: intakeRow?.id ?? null,
    });
    return ok(
      {
        appointment_id: appt.id,
        queue_entry_id: queueEntryId,
        intake_id: intakeRow?.id ?? null,
        route,
      },
      init,
    );
  }

  /* ─── Mode B: intake_id (declared → here, on the chosen route) ── */
  const intakeId = input.intake_id!;
  const { data: intake, error: intakeErr } = await sb
    .from("patient_intakes")
    .select(
      "id, hospital_id, receiving_department_id, patient_user_id, status, entry_type_code, priority_hint",
    )
    .eq("id", intakeId)
    .maybeSingle();
  if (intakeErr) return serverError(intakeErr.message, init);
  if (!intake) return notFound(init, "intake not found");
  if (intake.status !== "declared") {
    return badRequest(
      `Intake is in '${intake.status}' — only declared intakes need check-in.`,
      init,
    );
  }

  const authError = await authoriseAtHospital(caller.id, intake.hospital_id);
  if (authError) return forbidden(init, authError);

  // The ticket's own entry type decides whether the clinic door is open at all.
  let isEmergency: boolean;
  try {
    isEmergency = (await lookupEntryType(sb, intake.entry_type_code))?.is_emergency ?? false;
  } catch (e) {
    return serverError(e instanceof Error ? e.message : String(e), init);
  }
  const route = effectiveRoute(input.route, isEmergency || intake.priority_hint === "urgent");
  const status = intakeStatusFor(route);
  const departmentId: string | null = input.department_id ?? intake.receiving_department_id ?? null;
  if (
    input.department_id &&
    !(await departmentAtHospital(sb, input.department_id, intake.hospital_id))
  ) {
    return badRequest("That department is not at this hospital.", init);
  }
  if (route === "clinic" && !departmentId) {
    return badRequest("Choose the clinic to send the patient to.", init);
  }

  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "check_in_patient",
      targetKind: "patient_intake",
      targetId: intake.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { status: intake.status },
      afterData: { status, route, department_id: departmentId },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  const checkedInAt = new Date().toISOString();
  const { data: flipped, error: flipErr } = await sb
    .from("patient_intakes")
    .update({
      status,
      routed_to: route,
      checked_in_at: checkedInAt,
      receiving_department_id: departmentId,
      ...(input.client_id
        ? { client_id: input.client_id, device_label: input.device_label ?? null }
        : {}),
    })
    .eq("id", intake.id)
    .eq("status", "declared")
    .select("id");
  if (flipErr) {
    log.error("intake flip failed", { requestId, reason: flipErr.message });
    return serverError("check-in failed", init);
  }
  if (!flipped?.length) return conflict("This patient has just been checked in.", init);

  const queueEntryId = await insertQueueRow(sb, {
    hospital_id: intake.hospital_id,
    department_id: departmentId,
    patient_user_id: intake.patient_user_id,
    appointment_id: null,
    kind: "walk_in",
    requestId,
  });

  log.info("checked in (declared)", {
    requestId,
    intake_id: intake.id,
    queue_entry_id: queueEntryId,
  });
  return ok(
    {
      intake_id: intake.id,
      queue_entry_id: queueEntryId,
      route,
    },
    init,
  );
});

/* ─── helpers ─────────────────────────────────────────────────────── */

/** The desk may only send a patient to a department of the hospital they are at. */
async function departmentAtHospital(
  sb: ReturnType<typeof serviceClient>,
  departmentId: string,
  hospitalId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("hospital_departments")
    .select("id")
    .eq("id", departmentId)
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  return !!data;
}
