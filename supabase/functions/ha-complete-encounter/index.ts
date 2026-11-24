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
 * Admission (0091, ADRs 0198–0200): `disposition: 'admitted'` with `admission` { ward_id, bed_id? or
 *   bed_wait_reason } writes the admission, the bed (Arriving) or the waiting list, and the close in ONE SQL
 *   transaction (`admit_from_encounter`); two callers on one bed get "was just taken" (409). The cascade then runs
 *   as below, except step 4: a patient waiting for a bed is still nursed where they are, so nursing assignments end
 *   on arrival (confirm_bed_arrival), not here. `follow_up` may be `booked` (ADR 0202).
 *
 * EU (0311/0312, ADR 0541): an open EU stay this visit may end (its own, a triage stay with no encounter, or a
 *   boarder's: the stay whose admission's inpatient encounter is this one) ends with a clinical close in ONE SQL
 *   transaction (`end_eu_stay`), then the cascade runs in full. A close with no outcome is refused while the stay
 *   is open, so no stay is orphaned. An admission from the EU is allowed: the patient boards (0312).
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
import { floorFinishEu } from "../_shared/eu-floor.ts";
import { euRefusal } from "../_shared/eu.ts";
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
        z.object({
          kind: z.literal("booked"),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          appointment_id: z.string().uuid(),
        }),
      ])
      .optional(),
    admission: z
      .object({
        ward_id: z.string().uuid(),
        bed_id: z.string().uuid().optional(),
        bed_wait_reason: z.enum(["no_free_bed", "extra_bed", "floor", "other"]).optional(),
        bed_wait_note_ciphertext: z.string().max(20_000).optional(),
        leading_condition_id: z.string().uuid().optional(),
      })
      .refine((a) => !!a.bed_id !== !!a.bed_wait_reason, {
        message: "Send a bed, or why the patient waits for one.",
      })
      .refine((a) => a.bed_wait_reason !== "other" || !!a.bed_wait_note_ciphertext, {
        message: "Waiting for 'other' needs a note.",
      })
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
  })
  .refine((v) => !v.admission || v.disposition === "admitted", {
    message: "An admission closes the visit as admitted.",
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
      "id, hospital_id, patient_user_id, clinician_user_id, state, appointment_id, department_id, triage_record_id, visit_id",
    )
    .eq("id", input.encounter_id)
    .maybeSingle();
  if (encErr) return serverError(encErr.message, init);
  if (!enc) return notFound(init, "encounter not found");
  // An administrative closure may close a planned encounter too; everything else needs in_progress.
  const administrative = input.closure_kind === "administrative";
  const clinical = !administrative && !!input.disposition;
  const admission = clinical ? (input.admission ?? null) : null;
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

  // EU (ADR 0541): the open stay this visit may end, its own or a triage stay with no encounter yet whose intake is
  // this visit's (R65). Another visit's stay is left alone. Before 0311 the table is missing (42P01, or PGRST205 from PostgREST 12.2+): no stay, the close is as before.
  const missingTable = (code?: string) => code === "42P01" || code === "PGRST205";
  const stayLookup = (or: string) =>
    sb
      .from("eu_stays")
      .select("id")
      .eq("patient_user_id", enc.patient_user_id)
      .eq("hospital_id", enc.hospital_id)
      .neq("status", "ended")
      .or(or)
      .maybeSingle();
  const euFail = (code?: string) => {
    log.error("eu stay lookup failed", { requestId, code });
    return serverError("encounter update failed", init);
  };
  // R65: a triage stay is this visit's when its intake is the encounter's visit_id, else its triage's intake, or
  // the intake naming this encounter (the queue start), as end_eu_stay (0313). Looked for only when the patient has
  // an open triage stay here (a non-EU close gains one eu_stays read); a failed link lookup then fails the close
  // rather than leave a resus space held.
  let triageStayId: string | null = null;
  let triageStayIntake: string | null = null;
  const triageStay = await sb
    .from("eu_stays")
    .select("id, intake_id")
    .eq("patient_user_id", enc.patient_user_id)
    .eq("hospital_id", enc.hospital_id)
    .neq("status", "ended")
    .is("encounter_id", null)
    .maybeSingle();
  if (triageStay.error && !missingTable(triageStay.error.code))
    return euFail(triageStay.error.code);
  if (triageStay.data) {
    let mine = enc.visit_id === triageStay.data.intake_id;
    if (!mine && !enc.visit_id && enc.triage_record_id) {
      const tr = await sb
        .from("triage_records")
        .select("id")
        .eq("id", enc.triage_record_id)
        .eq("intake_id", triageStay.data.intake_id)
        .maybeSingle();
      if (tr.error) return euFail(tr.error.code);
      mine = !!tr.data;
    }
    if (!mine) {
      const named = await sb
        .from("patient_intakes")
        .select("id")
        .eq("id", triageStay.data.intake_id)
        .eq("encounter_id", enc.id)
        .maybeSingle();
      if (named.error) return euFail(named.error.code);
      mine = !!named.data;
    }
    if (mine) {
      triageStayId = triageStay.data.id as string;
      triageStayIntake = triageStay.data.intake_id as string;
    }
  }
  // Built from database uuids only.
  let euLookup = await stayLookup(
    triageStayId ? `encounter_id.eq.${enc.id},id.eq.${triageStayId}` : `encounter_id.eq.${enc.id}`,
  );
  if (euLookup.error && !missingTable(euLookup.error.code)) {
    log.error("eu stay lookup failed", { requestId, code: euLookup.error.code });
    return serverError("encounter update failed", init);
  }
  // A boarder's stay belongs to the admission whose inpatient encounter is this one (0312). Looked up only
  // when nothing was found; a failure here is logged and the close goes on without the boarder arm.
  if (!euLookup.error && !euLookup.data) {
    const boardAdm = await sb
      .from("admissions")
      .select("id")
      .eq("inpatient_encounter_id", enc.id)
      .maybeSingle();
    if (boardAdm.error) {
      log.warn("admission lookup failed (non-fatal)", {
        requestId,
        name: boardAdm.error.name,
        code: boardAdm.error.code,
      });
    } else if (boardAdm.data?.id) {
      const boarder = await stayLookup(`admission_id.eq.${boardAdm.data.id}`);
      if (boarder.error) {
        log.error("eu stay lookup failed", { requestId, code: boarder.error.code });
        return serverError("encounter update failed", init);
      }
      euLookup = boarder;
    }
  }
  const euStayId = missingTable(euLookup.error?.code)
    ? null
    : ((euLookup.data?.id as string | undefined) ?? null);
  if (euStayId && !clinical) {
    return badRequest(
      "This patient is in the emergency unit. Close the visit with an outcome; that ends the EU stay.",
      init,
    );
  }
  // Died is stored as the existing 'deceased' (ADR 0115 reads it) [H]; the stay's end_kind keeps 'died'.
  const storedDisposition = input.disposition === "died" ? "deceased" : input.disposition;

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
        ...(admission ? { ward_id: admission.ward_id, bed_id: admission.bed_id ?? null } : {}),
      },
    });
  } catch (e) {
    log.error("sa_audit failed", { requestId, reason: String(e) });
    return serverError("audit write failed", init);
  }

  const now = new Date().toISOString();
  // The hospital's today, not UTC's: a queue row from 01:00 EAT is today's.
  const startOfDay = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);

  // 1a. Admission: the admission, the bed or the waiting list, and the close, in one SQL transaction.
  let admitted: Record<string, unknown> | null = null;
  if (admission) {
    const r = await sb.rpc("admit_from_encounter", {
      p: {
        encounter_id: enc.id,
        actor: caller.id,
        ward_id: admission.ward_id,
        bed_id: admission.bed_id ?? null,
        bed_wait_reason: admission.bed_wait_reason ?? null,
        bed_wait_note_ciphertext: admission.bed_wait_note_ciphertext ?? null,
        leading_condition_id: admission.leading_condition_id ?? null,
        disposition_detail: input.disposition_detail ?? null,
        completion_reason: input.completion_reason ?? null,
      },
    });
    if (r.error) {
      // AD4xx words, and the EU guard's (a stay sent meanwhile, R59); never the database's message.
      const words = euRefusal(r.error);
      if (words) return badRequest(words, init);
      log.error("admission failed", { requestId, name: r.error.name, code: r.error.code });
      return serverError("admission failed", init);
    }
    admitted = r.data as Record<string, unknown>;
    try {
      await recordSaAudit({
        actorId: caller.id,
        action: "admit_patient",
        targetKind: "encounter",
        targetId: enc.id,
        reason: input.reason,
        requestId,
        ipAddress,
        userAgent,
        afterData: admitted,
      });
    } catch (e) {
      // The admission is written; a missing second audit row is logged, never a lost admission.
      log.warn("admit audit failed (non-fatal)", { requestId, reason: String(e) });
    }
  }

  // 1b. EU: the space, the stay, the close and its event, in one SQL transaction (end_eu_stay). It finds no
  //     stay if it ended meanwhile ({ ended: false }); the close below then runs as usual.
  let euEnded = false;
  // An admission keeps the stay open: the patient boards until they arrive on the ward (0312).
  if (euStayId && clinical && !admission) {
    const r = await sb.rpc("end_eu_stay", {
      p: {
        encounter_id: enc.id,
        actor: caller.id,
        end_kind: input.disposition,
        disposition: storedDisposition,
        disposition_detail: input.disposition_detail ?? null,
        follow_up: input.follow_up ?? null,
        completion_reason: input.completion_reason ?? null,
      },
    });
    if (r.error) {
      const words = euRefusal(r.error);
      if (words) return badRequest(words, init);
      log.error("end_eu_stay failed", { requestId, name: r.error.name, code: r.error.code });
      return serverError("encounter update failed", init);
    }
    const ended = r.data as { ended?: boolean; stay_id?: string } | null;
    euEnded = ended?.ended === true;
    if (euEnded) {
      try {
        await recordSaAudit({
          actorId: caller.id,
          action: "end_eu_stay",
          targetKind: "encounter",
          targetId: enc.id,
          reason: input.reason,
          requestId,
          ipAddress,
          userAgent,
          afterData: { stay_id: ended?.stay_id ?? euStayId, end_kind: input.disposition },
        });
      } catch (e) {
        // The stay is ended; a missing second audit row is logged, never a lost close.
        log.warn("end_eu_stay audit failed (non-fatal)", {
          requestId,
          name: e instanceof Error ? e.name : "unknown",
        });
      }
    }
  }

  // R70: triage's send left the floor visit in the doctor's line; this visit has now admitted (adopting the stay) or
  // ended its triage stay, so the floor visit ends as Observed in EU (Task 24). Never fails the close.
  if (triageStayIntake && euStayId === triageStayId && (admitted || euEnded)) {
    const err = await floorFinishEu(
      sb,
      enc.hospital_id,
      triageStayIntake,
      enc.department_id ?? null,
      caller.id,
    );
    if (err) log.error("floor finish failed (non-fatal)", { requestId, code: err.code });
  }

  // 1. Close the encounter. The state guard makes a double submit a no-op, not a second close.
  const emr = clinical
    ? {
        completed_by: caller.id,
        closure_kind: "clinical",
        disposition: storedDisposition,
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
  if (admitted && input.follow_up) {
    // admit_from_encounter wrote everything else; a follow-up rides along when one was booked.
    const { error } = await sb
      .from("encounters")
      .update({ follow_up: input.follow_up })
      .eq("id", enc.id);
    if (error) log.warn("follow-up write failed (non-fatal)", { requestId, reason: error.message });
  }
  if (!admitted && !euEnded) {
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
      // A stay sent meanwhile: the database's EU guard refuses the close in words (0311 section 8, R59).
      const words = euRefusal(e1);
      if (words) return badRequest(words, init);
      log.error("encounter update failed", { requestId, name: e1.name, code: e1.code });
      return serverError("encounter update failed", init);
    }
    if (!closed?.length) return badRequest("The encounter was closed meanwhile.", init);
  }
  if (!admitted && !euEnded && (clinical || administrative)) {
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
    .update({
      status: "completed",
      encounter_id: enc.id,
      // Where the visit went, for the desk's record (ADR 0200 §4).
      ...(admission ? { receiving_ward_id: admission.ward_id } : {}),
    })
    .eq("patient_user_id", enc.patient_user_id)
    .eq("hospital_id", enc.hospital_id)
    .in("status", ["arrived", "awaiting_triage", "triaged"])
    .or(intakeLinks.join(","))
    .select("id", { count: "exact", head: true });
  if (e3) log.warn("intake update failed (non-fatal)", { requestId, reason: e3.message });

  // 4. Auto-end active nursing assignments for this patient at this hospital. Not for an admission: the
  //    patient is nursed where they are until they arrive on the ward (ADR 0200 §3).
  let naCount: number | null = 0;
  if (!admitted) {
    const { error: e4, count } = await sb
      .from("nursing_assignments")
      .update({ ends_at: now })
      .eq("patient_user_id", enc.patient_user_id)
      .eq("hospital_id", enc.hospital_id)
      .is("ends_at", null)
      .select("id", { count: "exact", head: true });
    if (e4)
      log.warn("nursing_assignments close failed (non-fatal)", { requestId, reason: e4.message });
    naCount = count;
  }

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
  return ok({ encounter_id: enc.id, cascade, ...(admitted ? { admission: admitted } : {}) }, init);
});
