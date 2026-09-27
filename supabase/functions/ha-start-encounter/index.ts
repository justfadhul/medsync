/**
 * ha-start-encounter — clinician calls a queue entry for rooming.
 *
 *   - Flips the appointment status arrived → in_progress.
 *   - Creates an encounters row (minimal seam to the future clinical
 *     module — id, appointment, patient, clinician, hospital, dept,
 *     started_at, state='in_progress').
 *   - Updates the queue_entries row: state='being_seen', called_at,
 *     called_by_user_id, encounter_id.
 *
 * A queue row with NO appointment — a desk walk-in, or a patient who told
 * the app they were coming today — is started from the row itself (ADR
 * 0101): the caller becomes the encounter's clinician, and the patient's
 * open intake in that department is linked to the encounter so ending the
 * visit closes it.
 *
 * Callable by:
 *   - The clinician on their own appointment; for an appointment-less row,
 *     any clinical cadre at the hospital (there is no booked clinician).
 *   - A nurse at the hospital (rooming support).
 *   - Admin / superadmin.
 *
 * One encounter per visit (HARMONISATION R2, ADR 0139): an OPEN encounter
 * (planned or in progress) already linked to this visit — its intake, its
 * booking, or the `visit_id` given — is reused instead of inserting a second.
 * A planned one (a triage assignment) is started; an in-progress one is
 * returned as is, so a retried call is idempotent. EMR v1 callers may also
 * pass `visit_id`, `encounter_type` and `template_id`; without them the old
 * behaviour is unchanged.
 *
 * After this point, scheduling hands off. The clinical module (when
 * it ships) owns the encounter row's vitals, notes, completion, etc.
 */
import { z } from "npm:zod@4.4.3";

import { getCaller, hasRole, serviceClient } from "../_shared/auth.ts";
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
import { requireHospitalAdminScope } from "../_shared/hospital-admin-scope.ts";
import { makeLogger } from "../_shared/logger.ts";
import { networkContext, recordSaAudit } from "../_shared/sa-audit.ts";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "../_shared/slots.ts";

const log = makeLogger("ha-start-encounter");

const InputSchema = z.object({
  /** Either appointment_id (in-person + virtual both supported) or
   * queue_entry_id (walk-in path) must be set. We resolve one from
   * the other server-side. */
  appointment_id: z.string().uuid().optional(),
  queue_entry_id: z.string().uuid().optional(),
  reason: z.string().min(8, "Reason ≥ 8 chars required (audited)."),
  // EMR v1 (optional)
  visit_id: z.string().uuid().optional(),
  encounter_type: z
    .enum([
      "opd",
      "inpatient",
      "emergency",
      "follow_up",
      "tele",
      "antenatal",
      "procedure",
      "virtual",
      "community",
    ])
    .optional(),
  template_id: z.string().max(80).optional(),
});
type Input = z.infer<typeof InputSchema>;

/** The EMR columns a caller asked for; nothing when it asked for none (old behaviour). */
function emrColumns(input: Input): Record<string, string> {
  return {
    ...(input.visit_id ? { visit_id: input.visit_id } : {}),
    ...(input.encounter_type ? { encounter_type: input.encounter_type } : {}),
    ...(input.template_id ? { template_id: input.template_id } : {}),
  };
}

const OPEN_INTAKE = ["arrived", "awaiting_triage", "triaged"];

/**
 * A caller-supplied `visit_id` must be this patient's intake at this hospital. The FK only proves the
 * intake exists; without this a caller could attach another patient's visit and read its complaint.
 */
async function visitBelongs(
  visitId: string | undefined,
  patientUserId: string,
  hospitalId: string,
): Promise<boolean> {
  if (!visitId) return true;
  const { data } = await serviceClient()
    .from("patient_intakes")
    .select("id")
    .eq("id", visitId)
    .eq("patient_user_id", patientUserId)
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  return !!data;
}

/**
 * The open encounter this visit already has, if any: linked by the given visit, by the booking, or
 * through the patient's open intake for this visit (its encounter, or an encounter whose visit it is).
 */
async function findOpenEncounter(o: {
  hospitalId: string;
  patientUserId: string;
  visitId: string | null;
  appointmentId: string | null;
  departmentId: string | null;
}): Promise<{ id: string; state: string; clinician_user_id: string } | null> {
  const sb = serviceClient();
  let intakes = sb
    .from("patient_intakes")
    .select("id, encounter_id")
    .eq("hospital_id", o.hospitalId)
    .eq("patient_user_id", o.patientUserId)
    .in("status", OPEN_INTAKE);
  if (o.appointmentId) intakes = intakes.eq("appointment_id", o.appointmentId);
  else if (o.departmentId) {
    // Today's visit only, like the intake link below: a stale open encounter from an earlier day
    // belongs in Needs closing and must not be reused or block today's call.
    const startOfDay = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE).toISOString();
    intakes = intakes
      .eq("receiving_department_id", o.departmentId)
      .or(`arrived_at.gte."${startOfDay}",checked_in_at.gte."${startOfDay}"`);
  } else intakes = intakes.eq("id", o.visitId ?? crypto.randomUUID());
  const { data } = await intakes;
  const rows = (data ?? []) as { id: string; encounter_id: string | null }[];
  const visitIds = [...new Set([o.visitId, ...rows.map((r) => r.id)].filter(Boolean))];
  const encounterIds = rows.map((r) => r.encounter_id).filter(Boolean);
  const links = [
    ...(visitIds.length ? [`visit_id.in.(${visitIds.join(",")})`] : []),
    ...(encounterIds.length ? [`id.in.(${encounterIds.join(",")})`] : []),
    ...(o.appointmentId ? [`appointment_id.eq.${o.appointmentId}`] : []),
  ];
  if (!links.length) return null;
  const { data: found } = await sb
    .from("encounters")
    .select("id, state, clinician_user_id")
    .eq("hospital_id", o.hospitalId)
    .eq("patient_user_id", o.patientUserId)
    .in("state", ["planned", "in_progress"])
    .or(links.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (found as { id: string; state: string; clinician_user_id: string } | null) ?? null;
}

/**
 * Reuse an open encounter for this clinician: start a planned one, return an in-progress one.
 * An in-progress encounter held by someone else is refused (the patient is being seen).
 */
async function reuseOpenEncounter(
  open: { id: string; state: string; clinician_user_id: string },
  clinicianUserId: string,
  input: Input,
  nowIso: string,
): Promise<{ ok: true; id: string } | { ok: false; conflict: string }> {
  if (open.state === "in_progress") {
    return open.clinician_user_id === clinicianUserId
      ? { ok: true, id: open.id }
      : { ok: false, conflict: "This patient is already being seen — the visit is open." };
  }
  const { data } = await serviceClient()
    .from("encounters")
    .update({
      state: "in_progress",
      started_at: nowIso,
      clinician_user_id: clinicianUserId,
      ...emrColumns(input),
    })
    .eq("id", open.id)
    .eq("state", "planned")
    .select("id")
    .maybeSingle();
  return data
    ? { ok: true, id: open.id }
    : { ok: false, conflict: "The encounter changed meanwhile — refresh and try again." };
}

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

  if (!input.appointment_id && !input.queue_entry_id) {
    return badRequest("appointment_id or queue_entry_id required", init);
  }

  const caller = await getCaller(request);
  if (!caller) return unauthorized(init);

  const sb = serviceClient();

  // Resolve appointment + (optional) queue entry.
  let appointmentId = input.appointment_id ?? null;
  const queueEntryId = input.queue_entry_id ?? null;
  if (queueEntryId && !appointmentId) {
    const { data: qe, error: qeErr } = await sb
      .from("queue_entries")
      .select(
        "id, hospital_id, department_id, patient_user_id, appointment_id, state, encounter_id, called_by_user_id",
      )
      .eq("id", queueEntryId)
      .maybeSingle();
    if (qeErr) return serverError(qeErr.message, init);
    if (!qe) return notFound(init, "queue entry not found");
    if (!qe.appointment_id) {
      return await startFromQueueRow(request, init, caller.id, input, qe as QueueRow);
    }
    appointmentId = qe.appointment_id;
  }

  const { data: appt, error: aErr } = await sb
    .from("appointments")
    .select("id, hospital_id, department_id, patient_user_id, clinician_user_id, status, type")
    .eq("id", appointmentId!)
    .maybeSingle();
  if (aErr) return serverError(aErr.message, init);
  if (!appt) return notFound(init, "appointment not found");

  const isSuperadmin = await hasRole(caller.id, "superadmin");
  const isClinician = caller.id === appt.clinician_user_id;
  const isNurse = await hasRole(caller.id, "nurse", appt.hospital_id);
  if (!isSuperadmin && !isClinician && !isNurse) {
    if (!(await hasRole(caller.id, "hospital_admin", appt.hospital_id))) {
      return forbidden(init);
    }
    const scope = await requireHospitalAdminScope(caller.id, appt.hospital_id);
    if (!scope.ok) return forbidden(init, scope.reason);
  }

  // Virtual flow: appointment goes confirmed → in_progress directly
  // (no arrived step, no queue entry).
  const okFromArrived = appt.status === "arrived";
  const okFromConfirmedVirtual = appt.status === "confirmed" && appt.type === "virtual";
  if (!(await visitBelongs(input.visit_id, appt.patient_user_id, appt.hospital_id))) {
    return badRequest("visit_id is not this patient's visit at this hospital", init);
  }
  const open = await findOpenEncounter({
    hospitalId: appt.hospital_id,
    patientUserId: appt.patient_user_id,
    visitId: input.visit_id ?? null,
    appointmentId: appt.id,
    departmentId: appt.department_id,
  });
  // A retried start of a visit already under way returns that encounter.
  if (appt.status === "in_progress" && open?.state === "in_progress") {
    if (open.clinician_user_id !== appt.clinician_user_id)
      return conflict("This patient is already being seen — the visit is open.", init);
    return ok({ appointment_id: appt.id, encounter_id: open.id, status: "in_progress" }, init);
  }
  if (!okFromArrived && !okFromConfirmedVirtual) {
    return badRequest(
      `Appointment is in '${appt.status}' — must be arrived (or confirmed+virtual) to start.`,
      init,
    );
  }

  const { ipAddress, userAgent } = networkContext(request);

  // Audit first.
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "start_encounter",
      targetKind: "appointment",
      targetId: appt.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { status: appt.status },
      afterData: { status: "in_progress" },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  // 1. Reuse this visit's open encounter, or create one.
  const nowIso = new Date().toISOString();
  let encounter: { id: string };
  if (open) {
    const reused = await reuseOpenEncounter(open, appt.clinician_user_id, input, nowIso);
    if (!reused.ok) return conflict(reused.conflict, init);
    encounter = { id: reused.id };
  } else {
    const { data, error: eErr } = await sb
      .from("encounters")
      .insert({
        hospital_id: appt.hospital_id,
        appointment_id: appt.id,
        patient_user_id: appt.patient_user_id,
        clinician_user_id: appt.clinician_user_id,
        department_id: appt.department_id,
        started_at: nowIso,
        state: "in_progress",
        ...emrColumns(input),
      })
      .select("id")
      .single();
    if (eErr || !data) {
      log.error("encounter insert failed", { requestId, reason: eErr?.message });
      return serverError("encounter create failed", init);
    }
    encounter = data;
  }

  // 2. Flip appointment to in_progress.
  const { error: aUpd } = await sb
    .from("appointments")
    .update({ status: "in_progress" })
    .eq("id", appt.id);
  if (aUpd) {
    log.warn("appointment status update failed (encounter created)", {
      requestId,
      appointment_id: appt.id,
      encounter_id: encounter.id,
      reason: aUpd.message,
    });
  }

  // 3. Update queue entry if there is one (resolved or supplied).
  if (queueEntryId) {
    await sb
      .from("queue_entries")
      .update({
        state: "being_seen",
        called_at: nowIso,
        called_by_user_id: caller.id,
        encounter_id: encounter.id,
      })
      .eq("id", queueEntryId);
  } else {
    // For an appointment-driven start, find and update the queue
    // entry if it exists.
    await sb
      .from("queue_entries")
      .update({
        state: "being_seen",
        called_at: nowIso,
        called_by_user_id: caller.id,
        encounter_id: encounter.id,
      })
      .eq("appointment_id", appt.id)
      .eq("state", "waiting");
  }

  log.info("encounter started", {
    requestId,
    appointment_id: appt.id,
    encounter_id: encounter.id,
  });
  return ok(
    {
      appointment_id: appt.id,
      encounter_id: encounter.id,
      status: "in_progress",
    },
    init,
  );
});

/* ─── appointment-less rows ───────────────────────────────────────── */

interface QueueRow {
  id: string;
  hospital_id: string;
  department_id: string;
  patient_user_id: string;
  state: string;
  encounter_id: string | null;
  called_by_user_id: string | null;
}

/**
 * Start an encounter from a queue row alone. The row is claimed (waiting →
 * being_seen) BEFORE the encounter is written, so two clinicians calling the
 * same patient cannot open two encounters: the second claim finds no waiting
 * row and is refused.
 */
async function startFromQueueRow(
  request: Request,
  init: { origin: string | null; requestId: string },
  callerId: string,
  input: Input,
  qe: QueueRow,
): Promise<Response> {
  const reason = input.reason;
  const requestId = init.requestId;
  const sb = serviceClient();

  // The function's rule for a booked row, with "the booked clinician" read as
  // any clinical cadre here — nobody was booked, so whoever calls is it.
  const isSuperadmin = await hasRole(callerId, "superadmin");
  const isNurse = await hasRole(callerId, "nurse", qe.hospital_id);
  if (!isSuperadmin && !isNurse) {
    const { data: aff } = await sb
      .from("staff_affiliations")
      .select("id, cadres!inner(is_clinical)")
      .eq("user_id", callerId)
      .eq("hospital_id", qe.hospital_id)
      .in("state", ["active", "approved"])
      .eq("cadres.is_clinical", true)
      .limit(1)
      .maybeSingle();
    if (!aff) {
      if (!(await hasRole(callerId, "hospital_admin", qe.hospital_id))) return forbidden(init);
      const scope = await requireHospitalAdminScope(callerId, qe.hospital_id);
      if (!scope.ok) return forbidden(init, scope.reason);
    }
  }

  // A retried call of a patient this caller already called returns that encounter.
  if (qe.state === "being_seen" && qe.called_by_user_id === callerId && qe.encounter_id) {
    return ok(
      { queue_entry_id: qe.id, encounter_id: qe.encounter_id, status: "in_progress" },
      init,
    );
  }
  if (qe.state !== "waiting") {
    return badRequest(`Queue entry is '${qe.state}' — only a waiting patient can be called.`, init);
  }
  if (!(await visitBelongs(input.visit_id, qe.patient_user_id, qe.hospital_id))) {
    return badRequest("visit_id is not this patient's visit at this hospital", init);
  }

  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: callerId,
      action: "start_encounter",
      targetKind: "queue_entry",
      targetId: qe.id,
      reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { state: qe.state },
      afterData: { state: "being_seen", clinician_user_id: callerId },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  // 1. Claim the row.
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await sb
    .from("queue_entries")
    .update({ state: "being_seen", called_at: nowIso, called_by_user_id: callerId })
    .eq("id", qe.id)
    .eq("state", "waiting")
    .select("id")
    .maybeSingle();
  if (claimErr) return serverError(claimErr.message, init);
  if (!claimed) return conflict("This patient has already been called.", init);

  // 2. Reuse this visit's open encounter (a triage assignment's planned one), or create one;
  //    on failure, hand the patient back to the line.
  const open = await findOpenEncounter({
    hospitalId: qe.hospital_id,
    patientUserId: qe.patient_user_id,
    visitId: input.visit_id ?? null,
    appointmentId: null,
    departmentId: qe.department_id,
  });
  let encounter: { id: string } | null = null;
  let eErr: { message: string } | null = null;
  if (open) {
    const reused = await reuseOpenEncounter(open, callerId, input, nowIso);
    if (reused.ok) encounter = { id: reused.id };
    else {
      await sb
        .from("queue_entries")
        .update({ state: "waiting", called_at: null, called_by_user_id: null })
        .eq("id", qe.id);
      return conflict(reused.conflict, init);
    }
  } else {
    const r = await sb
      .from("encounters")
      .insert({
        hospital_id: qe.hospital_id,
        appointment_id: null,
        patient_user_id: qe.patient_user_id,
        clinician_user_id: callerId,
        department_id: qe.department_id,
        encounter_type: "opd",
        started_at: nowIso,
        state: "in_progress",
        ...emrColumns(input),
      })
      .select("id")
      .single();
    encounter = r.data;
    eErr = r.error;
  }
  if (eErr || !encounter) {
    log.error("encounter insert failed", { requestId, reason: eErr?.message });
    await sb
      .from("queue_entries")
      .update({ state: "waiting", called_at: null, called_by_user_id: null })
      .eq("id", qe.id);
    return serverError("encounter create failed", init);
  }

  // 3. Link the row and the patient's open intake in this department today —
  //    by check-in time too, so a ticket declared last night still links.
  await sb.from("queue_entries").update({ encounter_id: encounter.id }).eq("id", qe.id);
  const startOfDay = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE).toISOString();
  const { error: linkErr } = await sb
    .from("patient_intakes")
    .update({ encounter_id: encounter.id })
    .eq("hospital_id", qe.hospital_id)
    .eq("patient_user_id", qe.patient_user_id)
    .eq("receiving_department_id", qe.department_id)
    .in("status", ["arrived", "awaiting_triage", "triaged"])
    .is("encounter_id", null)
    .or(`arrived_at.gte."${startOfDay}",checked_in_at.gte."${startOfDay}"`);
  if (linkErr) log.warn("intake link failed (non-fatal)", { requestId, reason: linkErr.message });

  log.info("encounter started (no appointment)", {
    requestId,
    queue_entry_id: qe.id,
    encounter_id: encounter.id,
  });
  return ok({ queue_entry_id: qe.id, encounter_id: encounter.id, status: "in_progress" }, init);
}
