/**
 * ha-register-intake — register a patient entry into the hospital.
 *
 * Per docs/patient-entry-points-gate-a-proposal.md. The front-door
 * audited create path for the patient_intakes table.
 *
 * KEY RULE — EMERGENCY NEVER BLOCKS. When the entry type is an
 * emergency (entry_types.is_emergency = true) we accept the bare
 * minimum (patient_user_id OR patient_unknown_label) and skip any
 * referral / consent / presenting-complaint requirements. Capture
 * fast, complete later.
 *
 * Auth: superadmin OR hospital_admin (scoped) OR any active clinical
 * affiliation at the hospital (nurse / doctor / other clinician).
 *
 * The write itself — entry-type rules, priority, audit-first, INSERT — is
 * `_shared/intake.ts` (ADR 0098 ruling 10), which a pre-alerted arrival
 * calls too so no door creates a second intake. This file keeps the
 * checks that are the desk's own: the patient and appointment exist, the
 * caller may register here, and the patient holds no live ticket here
 * today (ADR 0101) — a second intake would put them in two lines.
 */
import type { EntryTypeRow } from "../_shared/intake.ts";
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
import { entryTypeRequirementsError, lookupEntryType, registerIntake } from "../_shared/intake.ts";
import { makeLogger } from "../_shared/logger.ts";
import { networkContext } from "../_shared/sa-audit.ts";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "../_shared/slots.ts";

const log = makeLogger("ha-register-intake");

const InputSchema = z
  .object({
    hospital_id: z.string().uuid(),
    entry_type_code: z.string().min(1).max(64),
    entry_point: z.string().max(40).optional(),
    receiving_department_id: z.string().uuid().optional(),
    receiving_ward_id: z.string().uuid().optional(),

    patient_user_id: z.string().uuid().optional(),
    patient_unknown_label: z.string().max(240).optional(),

    appointment_id: z.string().uuid().optional(),

    referring_hospital_id: z.string().uuid().optional(),
    referring_facility_other: z.string().max(240).optional(),
    referring_clinician_name: z.string().max(240).optional(),
    referral_reason: z.string().max(2000).optional(),
    referral_document_url: z.string().url().max(2000).optional(),
    referral_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),

    presenting_complaint: z.string().max(2000).optional(),
    brought_by: z.string().max(240).optional(),
    priority_hint_override: z.enum(["routine", "high", "urgent"]).optional(),

    notes: z.string().max(2000).optional(),
    arrived_at: z.string().datetime({ offset: true }).optional(),
    /** ADR 0098: the desk's catalog report (pt-submit-symptoms), linked on the intake. */
    symptom_submission_id: z.string().uuid().optional(),

    reason: z.string().min(8, "Reason ≥ 8 chars required (audited)."),
  })
  .refine((v) => v.patient_user_id || v.patient_unknown_label, {
    message: "Either patient_user_id or patient_unknown_label is required.",
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

  // Look up entry type — drives priority + the never-block rule.
  let entryType: EntryTypeRow | null;
  try {
    entryType = await lookupEntryType(sb, input.entry_type_code);
  } catch (e) {
    return serverError(e instanceof Error ? e.message : String(e), init);
  }
  if (!entryType) return badRequest(`Unknown entry_type_code: ${input.entry_type_code}`, init);

  // Non-emergency types: validate the type-specific requirements.
  // Emergency types skip — capture-fast.
  const unmet = entryTypeRequirementsError(entryType, {
    patientUserId: input.patient_user_id,
    referringHospitalId: input.referring_hospital_id,
    referringFacilityOther: input.referring_facility_other,
  });
  if (unmet) return badRequest(unmet, init);

  // Verify patient exists if supplied.
  if (input.patient_user_id) {
    const { data: patient } = await sb
      .from("patient_profiles")
      .select("id")
      .eq("id", input.patient_user_id)
      .maybeSingle();
    if (!patient) return notFound(init, "patient not found");
  }

  // Verify appointment belongs to this hospital + patient if supplied.
  if (input.appointment_id) {
    const { data: appt } = await sb
      .from("appointments")
      .select("id, hospital_id, patient_user_id, department_id")
      .eq("id", input.appointment_id)
      .maybeSingle();
    if (!appt) return notFound(init, "appointment not found");
    if (appt.hospital_id !== input.hospital_id) {
      return badRequest("appointment is at a different hospital", init);
    }
    if (input.patient_user_id && appt.patient_user_id !== input.patient_user_id) {
      return badRequest("appointment does not belong to this patient", init);
    }
  }

  // Authorisation: any active clinical affiliation OR hospital_admin OR superadmin.
  const isSuperadmin = await hasRole(caller.id, "superadmin");
  if (!isSuperadmin) {
    if (await hasRole(caller.id, "hospital_admin", input.hospital_id)) {
      const scope = await requireHospitalAdminScope(caller.id, input.hospital_id);
      if (!scope.ok) return forbidden(init, scope.reason);
    } else {
      const { data: aff } = await sb
        .from("staff_affiliations")
        .select("id")
        .eq("user_id", caller.id)
        .eq("hospital_id", input.hospital_id)
        .in("state", ["active", "approved"])
        .limit(1)
        .maybeSingle();
      if (!aff) return forbidden(init, "no active affiliation at this hospital");
    }
  }

  // One live ticket per patient per hospital day. A declared "coming today",
  // a checked-in booking or an earlier registration is checked in (or found)
  // where it is, not registered over. An emergency never blocks: it is
  // captured, and the desk reconciles the older ticket after.
  if (input.patient_user_id && !entryType.is_emergency) {
    const { data: live, error: liveError } = await sb
      .from("patient_intakes")
      .select("id, status")
      .eq("hospital_id", input.hospital_id)
      .eq("patient_user_id", input.patient_user_id)
      .in("status", ["declared", "arrived", "awaiting_triage", "triaged"])
      .gte("arrived_at", startOfLocalDay(new Date(), DEFAULT_TIME_ZONE).toISOString())
      .limit(1)
      .maybeSingle();
    if (liveError) return serverError(liveError.message, init);
    if (live) {
      return conflict(
        live.status === "declared"
          ? "This patient said they are coming today — check in their existing ticket instead."
          : "This patient already has an open ticket here today — find it on the queue instead.",
        init,
        { intake_id: live.id, status: live.status },
      );
    }
  }

  const { ipAddress, userAgent } = networkContext(request);
  const result = await registerIntake(
    { sb, init, log },
    {
      hospitalId: input.hospital_id,
      entryTypeCode: input.entry_type_code,
      entryType,
      entryPoint: input.entry_point,
      receivingDepartmentId: input.receiving_department_id,
      receivingWardId: input.receiving_ward_id,
      patientUserId: input.patient_user_id,
      patientUnknownLabel: input.patient_unknown_label,
      appointmentId: input.appointment_id,
      referringHospitalId: input.referring_hospital_id,
      referringFacilityOther: input.referring_facility_other,
      referringClinicianName: input.referring_clinician_name,
      referralReason: input.referral_reason,
      referralDocumentUrl: input.referral_document_url,
      referralDate: input.referral_date,
      presentingComplaint: input.presenting_complaint,
      broughtBy: input.brought_by,
      priorityHintOverride: input.priority_hint_override,
      notes: input.notes,
      arrivedAt: input.arrived_at,
      registeredByUserId: caller.id,
      symptomSubmissionId: input.symptom_submission_id,
      audit: { actorId: caller.id, reason: input.reason, requestId, ipAddress, userAgent },
    },
  );
  if (!result.ok) return result.response;

  return ok(
    {
      intake_id: result.intakeId,
      priority_hint: result.priorityHint,
      status: result.status,
      is_emergency: result.isEmergency,
    },
    init,
  );
});
