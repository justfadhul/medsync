/**
 * ha-complete-encounter — close out an in-progress encounter.
 *
 * Cascades the closure across the tables that the patient-
 * handling-flow's "presence drops off" rule depends on:
 *   1. encounters.state → 'completed', ended_at = now(),
 *      completion_reason (optional)
 *   2. queue_entries.state → 'done', completed_at = now() for THIS
 *      encounter's queue row, plus the patient's row still waiting in
 *      the encounter's department today — never another department's
 *   3. patient_intakes.status → 'completed' + encounter_id back-link
 *      for THIS visit's open intake: the one already linked to the
 *      encounter, to its triage record, or to its booking — else the
 *      one received into the encounter's department
 *   4. nursing_assignments.ends_at = now() for active assignments of
 *      this patient at this hospital (the "auto-end" semantic)
 *   5. appointments.status → 'completed' for the linked appointment
 *      (encounters.appointment_id) if it is still arrived/in_progress —
 *      before Gate A′ no code path ever wrote that status.
 *
 * Scoped to the encounter (ADR 0101): a patient seen in two clinics the
 * same day keeps their place in the second when the first doctor ends
 * the visit.
 *
 * One write → five boards updated. Per docs/patient-handling-flow-
 * gate-a-proposal.md §6 and docs/booking-app-gate-a-proposal.md §5.13 (c).
 *
 * EMR v1 (ADR 0139, HARMONISATION R2) — this stays the ONE completion path:
 *   - `disposition` (+ `disposition_detail`, `follow_up`) completes a visit
 *     clinically: closure_kind 'clinical', completed_by, 'died' stored as the
 *     existing 'deceased' (ADR 0115 reads it). Warnings are the app's job
 *     (lib/emr/write/encounter.ts), never a refusal here.
 *   - `closure_kind: 'administrative'` + `closure_reason` closes a stale open
 *     encounter (planned or in progress). A reason code is required; nothing
 *     here runs on a timer, so nothing closes itself. 'other' needs the
 *     encrypted note (`closure_note_ciphertext`, encrypted by the app).
 *   - Either way an encounter_events 'disposition' row records who and why.
 *   A caller that sends none of these fields gets exactly the old behaviour.
 *
 * Auth: the clinician on the encounter, hospital_admin (scoped), or
 * superadmin. (Nurses cannot complete a doctor's encounter; if a
 * nurse needs to close an encounter the doctor is the right caller.)
 */
import { z } from "npm:zod@4.4.3";

import { getCaller, hasRole, serviceClient } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import {
  badRequest,
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

const log = makeLogger("ha-complete-encounter");

/** The completion sheet's codes (lib/emr/encounter.ts DISPOSITION_CODES). */
const DISPOSITIONS = [
  "home",
  "admitted",
  "referred_out",
  "transferred",
  "died",
  "left_before_completion",
  "left_against_advice",
] as const;
/** encounters_closure_reason_check (0071). */
const CLOSURE_REASONS = [
  "left_before_seen",
  "duplicate_encounter",
  "documented_elsewhere",
  "opened_in_error",
  "other",
] as const;

const InputSchema = z
  .object({
    encounter_id: z.string().uuid(),
    completion_reason: z.string().max(500).optional(),
    reason: z.string().min(8, "Reason ≥ 8 chars required (audited)."),
    // EMR v1 (optional; absent = the old behaviour)
    disposition: z.enum(DISPOSITIONS).optional(),
    disposition_detail: z.record(z.string(), z.string().max(500)).optional(),
    follow_up: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("none") }),
        z.object({ kind: z.literal("as_needed") }),
        z.object({ kind: z.literal("review_date"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      ])
      .optional(),
    closure_kind: z.enum(["clinical", "administrative"]).optional(),
    closure_reason: z.enum(CLOSURE_REASONS).optional(),
    closure_note_ciphertext: z.string().max(20_000).optional(),
  })
  .refine((v) => v.closure_kind !== "administrative" || !!v.closure_reason, {
    message: "An administrative closure needs a reason code.",
  })
  .refine((v) => v.closure_reason !== "other" || !!v.closure_note_ciphertext, {
    message: "Reason 'other' needs a note.",
  })
  .refine((v) => v.closure_kind !== "clinical" || !!v.disposition, {
    message: "A clinical completion needs a disposition.",
  })
  .refine((v) => v.closure_kind !== "administrative" || !v.disposition, {
    message: "An administrative closure records no disposition.",
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

  const { data: enc, error: encErr } = await sb
    .from("encounters")
    .select(
      "id, hospital_id, patient_user_id, clinician_user_id, state, appointment_id, department_id, triage_record_id",
    )
    .eq("id", input.encounter_id)
    .maybeSingle();
  if (encErr) return serverError(encErr.message, init);
  if (!enc) return notFound(init, "encounter not found");
  // An administrative closure may close a planned encounter too; everything else needs in_progress.
  const administrative = input.closure_kind === "administrative";
  const clinical = !administrative && !!input.disposition;
  const fromStates = administrative ? ["planned", "in_progress"] : ["in_progress"];
  if (!fromStates.includes(enc.state)) {
    return badRequest(`Encounter is in '${enc.state}' — only in-progress can complete.`, init);
  }

  const isSuperadmin = await hasRole(caller.id, "superadmin");
  const isOwner = caller.id === enc.clinician_user_id;
  if (!isSuperadmin && !isOwner) {
    if (!(await hasRole(caller.id, "hospital_admin", enc.hospital_id))) {
      return forbidden(init);
    }
    const scope = await requireHospitalAdminScope(caller.id, enc.hospital_id);
    if (!scope.ok) return forbidden(init, scope.reason);
  }

  const { ipAddress, userAgent } = networkContext(request);
  try {
    await recordSaAudit({
      actorId: caller.id,
      action: "complete_encounter",
      targetKind: "encounter",
      targetId: enc.id,
      reason: input.reason,
      requestId,
      ipAddress,
      userAgent,
      beforeData: { state: enc.state },
      afterData: {
        state: "completed",
        completion_reason: input.completion_reason ?? null,
        appointment_id: enc.appointment_id ?? null,
        ...(clinical ? { closure_kind: "clinical", disposition: input.disposition } : {}),
        ...(administrative
          ? { closure_kind: "administrative", closure_reason: input.closure_reason }
          : {}),
      },
    });
  } catch (e) {
    log.error("sa_audit failed", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  const now = new Date().toISOString();
  // The hospital's today, not UTC's: a queue row from 01:00 EAT is today's.
  const startOfDay = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);

  // 1. Close the encounter. The state guard makes a double submit a no-op, not a second close.
  const emr = clinical
    ? {
        completed_by: caller.id,
        closure_kind: "clinical",
        // Died is stored as the existing 'deceased' (ADR 0115 reads it) [H].
        disposition: input.disposition === "died" ? "deceased" : input.disposition,
        disposition_detail: input.disposition_detail ?? null,
        follow_up: input.follow_up ?? null,
      }
    : administrative
      ? {
          completed_by: caller.id,
          closure_kind: "administrative",
          closure_reason: input.closure_reason,
          closure_note_ciphertext: input.closure_note_ciphertext ?? null,
        }
      : {};
  const { data: closed, error: e1 } = await sb
    .from("encounters")
    .update({
      state: "completed",
      ended_at: now,
      completion_reason: input.completion_reason ?? null,
      ...emr,
    })
    .eq("id", enc.id)
    .in("state", fromStates)
    .select("id");
  if (e1) {
    log.error("encounter update failed", { requestId, reason: e1.message });
    return serverError("encounter update failed", init);
  }
  if (!closed?.length) return badRequest("The encounter was closed meanwhile.", init);
  if (clinical || administrative) {
    const { error: eEv } = await sb.from("encounter_events").insert({
      encounter_id: enc.id,
      kind: "disposition",
      label: clinical
        ? `Visit completed: ${input.disposition}`
        : `Closed administratively: ${input.closure_reason}`,
      actor_user_id: caller.id,
      recorded_at: now,
    });
    if (eEv) log.warn("encounter event failed (non-fatal)", { requestId, reason: eEv.message });
  }

  // 2. Close this encounter's queue row, and a row of the patient's still
  //    waiting in the same department today (a triage-opened encounter never
  //    wrote its encounter_id onto the row). Another department's line is a
  //    different visit and is left alone.
  const { error: e2, count: ownQueueCount } = await sb
    .from("queue_entries")
    .update({ state: "done", completed_at: now })
    .eq("encounter_id", enc.id)
    .in("state", ["waiting", "being_seen"])
    .select("id", { count: "exact", head: true });
  if (e2) log.warn("queue update failed (non-fatal)", { requestId, reason: e2.message });
  let queueCount = ownQueueCount ?? 0;
  if (enc.department_id) {
    const { error: e2b, count } = await sb
      .from("queue_entries")
      .update({ state: "done", completed_at: now })
      .eq("patient_user_id", enc.patient_user_id)
      .eq("hospital_id", enc.hospital_id)
      .eq("department_id", enc.department_id)
      .eq("state", "waiting")
      .gte("arrived_at", startOfDay.toISOString())
      .select("id", { count: "exact", head: true });
    if (e2b) log.warn("queue update failed (non-fatal)", { requestId, reason: e2b.message });
    queueCount += count ?? 0;
  }

  // 3. Close this visit's intake, found by what links it to the encounter
  //    rather than by date: a ticket declared before midnight and seen after
  //    it is still this visit's. The department is the fallback only for an
  //    unbooked visit, so a second clinic's ticket survives a booked one.
  let triageIntakeId: string | null = null;
  if (enc.triage_record_id) {
    const { data: tr } = await sb
      .from("triage_records")
      .select("intake_id")
      .eq("id", enc.triage_record_id)
      .maybeSingle();
    triageIntakeId = (tr?.intake_id as string | null | undefined) ?? null;
  }
  const intakeLinks = [`encounter_id.eq.${enc.id}`];
  if (triageIntakeId) intakeLinks.push(`id.eq.${triageIntakeId}`);
  if (enc.appointment_id) intakeLinks.push(`appointment_id.eq.${enc.appointment_id}`);
  else if (enc.department_id) intakeLinks.push(`receiving_department_id.eq.${enc.department_id}`);
  const { error: e3, count: intakeCount } = await sb
    .from("patient_intakes")
    .update({ status: "completed", encounter_id: enc.id })
    .eq("patient_user_id", enc.patient_user_id)
    .eq("hospital_id", enc.hospital_id)
    .in("status", ["arrived", "awaiting_triage", "triaged"])
    .or(intakeLinks.join(","))
    .select("id", { count: "exact", head: true });
  if (e3) log.warn("intake update failed (non-fatal)", { requestId, reason: e3.message });

  // 4. Auto-end active nursing assignments for this patient at this hospital.
  const { error: e4, count: naCount } = await sb
    .from("nursing_assignments")
    .update({ ends_at: now })
    .eq("patient_user_id", enc.patient_user_id)
    .eq("hospital_id", enc.hospital_id)
    .is("ends_at", null)
    .select("id", { count: "exact", head: true });
  if (e4)
    log.warn("nursing_assignments close failed (non-fatal)", { requestId, reason: e4.message });

  // 5. Complete the linked appointment. Only from the two "in the building"
  //    statuses: a no_show or cancelled row stays what the desk said it was.
  let appointmentCount: number | null = 0;
  if (enc.appointment_id) {
    const { error: e5, count } = await sb
      .from("appointments")
      .update({ status: "completed" })
      .eq("id", enc.appointment_id)
      .in("status", ["arrived", "in_progress"])
      .select("id", { count: "exact", head: true });
    if (e5) log.warn("appointment complete failed (non-fatal)", { requestId, reason: e5.message });
    appointmentCount = count;
  }

  const cascade = {
    queue_closed: queueCount,
    intake_closed: intakeCount ?? 0,
    nursing_closed: naCount ?? 0,
    appointment_completed: appointmentCount ?? 0,
  };
  log.info("encounter completed + cascaded", { requestId, encounter_id: enc.id, ...cascade });
  return ok({ encounter_id: enc.id, cascade }, init);
});
