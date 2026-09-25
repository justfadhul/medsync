/**
 * The intake service — ONE writer of `patient_intakes` for every door a
 * patient comes through (ADR 0098 ruling 10; extracted from
 * `ha-register-intake`, whose behaviour it reproduces exactly).
 *
 * Callers: `ha-register-intake` (the desk's front door) and
 * `ha-pre-arrival-arrived` (a pre-alerted arrival). Each does its OWN
 * authorisation — who may register at this hospital, that the patient and
 * the appointment exist — and hands in an already-authorised input; this
 * file does the rest as the front door always has: the entry type drives
 * the never-block rule and the priority hint, the audit row lands FIRST
 * (fail closed), then the INSERT as `awaiting_triage`, then — when the
 * patient is known and a department was named — their place in that
 * department's clinic line (ADR 0101), so a desk walk-in reaches the
 * doctor's queue rail the way a checked-in booking does.
 *
 * KEY RULE — EMERGENCY NEVER BLOCKS. When the entry type is an emergency
 * (`entry_types.is_emergency`) the bare minimum is accepted (a patient OR
 * an unknown-patient label) and the referral / consent / complaint
 * requirements are skipped. Capture fast, complete later.
 */
import type { SaAuditAction } from "./sa-audit.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.106.1";

import { badRequest, serverError } from "./errors.ts";
import { insertQueueRow } from "./queue.ts";
import { recordSaAudit } from "./sa-audit.ts";

export interface EntryTypeRow {
  code: string;
  is_emergency: boolean;
  default_priority_hint: "routine" | "high" | "urgent" | null;
  requires_referral: boolean;
  allows_unknown_patient: boolean;
}

export type PriorityHint = "routine" | "high" | "urgent";

export interface IntakeInput {
  hospitalId: string;
  entryTypeCode: string;
  /**
   * The row `lookupEntryType` returned, when the caller already needed it
   * (the front door validates the patient and appointment against it
   * before authorising). Looked up here otherwise.
   */
  entryType?: EntryTypeRow;
  entryPoint?: string | null;
  receivingDepartmentId?: string | null;
  receivingWardId?: string | null;
  patientUserId?: string | null;
  patientUnknownLabel?: string | null;
  appointmentId?: string | null;
  referringHospitalId?: string | null;
  referringFacilityOther?: string | null;
  referringClinicianName?: string | null;
  referralReason?: string | null;
  referralDocumentUrl?: string | null;
  referralDate?: string | null;
  presentingComplaint?: string | null;
  broughtBy?: string | null;
  priorityHintOverride?: PriorityHint | null;
  notes?: string | null;
  /** ISO; now when absent. */
  arrivedAt?: string | null;
  registeredByUserId: string;
  /** Migration 0066: the pre-alert this arrival answers, and what the patient reported. */
  preArrivalId?: string | null;
  symptomSubmissionId?: string | null;
  audit: {
    actorId: string;
    /** `register_intake` unless the door has its own word. */
    action?: SaAuditAction;
    reason: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  };
}

export interface IntakeContext {
  sb: SupabaseClient;
  init: { origin: string | null; requestId: string };
  log: { info: LogFn; warn: LogFn; error: LogFn };
}
type LogFn = (msg: string, ctx?: Record<string, unknown>) => void;

export type IntakeResult =
  | {
      ok: true;
      intakeId: string;
      priorityHint: PriorityHint;
      status: string;
      isEmergency: boolean;
    }
  | { ok: false; response: Response };

/** `entry_types` by code — null when the code is unknown; throws on a read error. */
export async function lookupEntryType(
  sb: SupabaseClient,
  code: string,
): Promise<EntryTypeRow | null> {
  const { data, error } = await sb
    .from("entry_types")
    .select("code, is_emergency, default_priority_hint, requires_referral, allows_unknown_patient")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EntryTypeRow | null) ?? null;
}

/**
 * Non-emergency types must identify the patient (unless the type allows an
 * unknown one) and a referral type must name a referring facility. Emergency
 * types skip both — capture-fast. The message to return as a 400, or null.
 * Exported so the front door can ask BEFORE it authorises, as it always has.
 */
export function entryTypeRequirementsError(
  entryType: Pick<
    EntryTypeRow,
    "code" | "is_emergency" | "requires_referral" | "allows_unknown_patient"
  >,
  input: Pick<IntakeInput, "patientUserId" | "referringHospitalId" | "referringFacilityOther">,
): string | null {
  if (entryType.is_emergency) return null;
  if (!input.patientUserId && !entryType.allows_unknown_patient) {
    return `${entryType.code} requires a known patient — search or register first`;
  }
  if (entryType.requires_referral && !input.referringHospitalId && !input.referringFacilityOther) {
    return `${entryType.code} requires a referring facility (in-network or 'other')`;
  }
  return null;
}

/** The caller's override, else the entry type's default, else routine. */
export function derivePriorityHint(
  entryType: Pick<EntryTypeRow, "default_priority_hint">,
  override: PriorityHint | null | undefined,
): PriorityHint {
  return override ?? entryType.default_priority_hint ?? "routine";
}

export async function registerIntake(
  ctx: IntakeContext,
  input: IntakeInput,
): Promise<IntakeResult> {
  const { sb, init, log } = ctx;
  const fail = (response: Response): IntakeResult => ({ ok: false, response });
  const requestId = init.requestId;

  // Look up entry type — drives priority + the never-block rule.
  let entryType = input.entryType ?? null;
  if (!entryType) {
    try {
      entryType = await lookupEntryType(sb, input.entryTypeCode);
    } catch (e) {
      return fail(serverError(e instanceof Error ? e.message : String(e), init));
    }
    if (!entryType) {
      return fail(badRequest(`Unknown entry_type_code: ${input.entryTypeCode}`, init));
    }
  }

  const unmet = entryTypeRequirementsError(entryType, input);
  if (unmet) return fail(badRequest(unmet, init));

  const priorityHint = derivePriorityHint(entryType, input.priorityHintOverride);
  const arrivedAt = input.arrivedAt ?? new Date().toISOString();

  try {
    await recordSaAudit({
      actorId: input.audit.actorId,
      action: input.audit.action ?? "register_intake",
      targetKind: "patient_intake",
      targetId: input.patientUserId ?? input.hospitalId,
      reason: input.audit.reason,
      requestId: input.audit.requestId,
      ipAddress: input.audit.ipAddress,
      userAgent: input.audit.userAgent,
      beforeData: null,
      afterData: {
        entry_type_code: input.entryTypeCode,
        is_emergency: entryType.is_emergency,
        priority_hint: priorityHint,
        arrived_at: arrivedAt,
        // Ids only — the pre-alert's red flags and the submission's words stay on their rows.
        ...(input.preArrivalId ? { pre_arrival_id: input.preArrivalId } : {}),
        ...(input.symptomSubmissionId ? { symptom_submission_id: input.symptomSubmissionId } : {}),
      },
    });
  } catch (e) {
    log.error("sa_audit failed; aborting", { requestId, reason: String(e) });
    return fail(serverError("audit write failed", init));
  }

  const { data: intake, error: insertError } = await sb
    .from("patient_intakes")
    .insert({
      hospital_id: input.hospitalId,
      entry_type_code: input.entryTypeCode,
      entry_point: input.entryPoint ?? null,
      receiving_department_id: input.receivingDepartmentId ?? null,
      receiving_ward_id: input.receivingWardId ?? null,
      patient_user_id: input.patientUserId ?? null,
      patient_unknown_label: input.patientUnknownLabel ?? null,
      appointment_id: input.appointmentId ?? null,
      referring_hospital_id: input.referringHospitalId ?? null,
      referring_facility_other: input.referringFacilityOther ?? null,
      referring_clinician_name: input.referringClinicianName ?? null,
      referral_reason: input.referralReason ?? null,
      referral_document_url: input.referralDocumentUrl ?? null,
      referral_date: input.referralDate ?? null,
      presenting_complaint: input.presentingComplaint ?? null,
      brought_by: input.broughtBy ?? null,
      priority_hint: priorityHint,
      status: "awaiting_triage",
      arrived_at: arrivedAt,
      registered_by_user_id: input.registeredByUserId,
      notes: input.notes ?? null,
      // Migration 0066 — written only when a door supplies them, so the
      // front door's INSERT stays byte-identical on a database without them.
      ...(input.preArrivalId ? { pre_arrival_id: input.preArrivalId } : {}),
      ...(input.symptomSubmissionId ? { symptom_submission_id: input.symptomSubmissionId } : {}),
    })
    .select("id, priority_hint, status")
    .single();
  if (insertError) {
    log.error("intake insert failed", { requestId, reason: insertError.message });
    return fail(serverError("intake insert failed", init));
  }

  // No department or no known patient → no line to join; insertQueueRow says so.
  const queueEntryId = await insertQueueRow(sb, {
    hospital_id: input.hospitalId,
    department_id: input.receivingDepartmentId ?? null,
    patient_user_id: input.patientUserId ?? null,
    appointment_id: input.appointmentId ?? null,
    kind: entryType.is_emergency ? "urgent_walk_in" : "walk_in",
    requestId,
  });

  log.info("intake registered", {
    requestId,
    intake_id: intake.id,
    queue_entry_id: queueEntryId,
    entry_type_code: input.entryTypeCode,
    is_emergency: entryType.is_emergency,
    priority_hint: intake.priority_hint,
  });
  return {
    ok: true,
    intakeId: intake.id as string,
    priorityHint: intake.priority_hint as PriorityHint,
    status: intake.status as string,
    isEmergency: entryType.is_emergency,
  };
}
