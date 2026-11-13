import { serviceClient } from "./auth.ts";

/**
 * Insert a row into public.sa_audit_log (GATE F).
 *
 * Use INSIDE Edge Functions that perform god-mode actions or
 * sensitive elevations. The free-text `reason` is required by the
 * CHECK constraint at the DB layer (≥ 8 chars). Best practice:
 *
 *   - actorId         caller.id (from getCaller())
 *   - action          one of the action enum values (see migration 0015)
 *   - targetKind      one of the target_kind enum values
 *   - targetId        the row id of the thing being acted on (string)
 *   - reason          required free-text — pulled from request body so
 *                     the auditor knows WHY this action happened
 *   - requestId       request-correlation id (defaults to x-request-id)
 *   - ip / ua         captured at the Edge Function entry
 *   - before/after    optional snapshots — encode just the changed
 *                     columns to keep size down
 *
 * Never log this from app-server code paths; this table is gated to
 * service-role writes so app-side INSERT would fail on RLS anyway.
 */
/**
 * Allowed action / targetKind values — kept in sync with the
 * sa_audit_log CHECK constraint (currently set by migration 0066).
 * When you add a value here, ALSO add it to the migration; the union
 * is here so typecheck catches typos before they hit the DB.
 */
export type SaAuditAction =
  | "approve_staff_affiliation"
  | "reject_staff_affiliation"
  | "approve_hospital_application"
  | "reject_hospital_application"
  // Onboarding v2 (D7): the verify step before the applicant signs. NEEDS the
  // sa_audit_log_action_check constraint to list it (migration 0070).
  | "verify_hospital_application"
  | "cross_tenant_read"
  | "cross_tenant_export"
  | "elevate_admin"
  | "create_superadmin"
  | "demote_admin"
  | "break_glass_open"
  | "break_glass_close"
  | "four_eyes_request"
  | "four_eyes_confirm"
  | "four_eyes_cancel"
  | "activate_hospital"
  | "suspend_user"
  | "reset_user_mfa"
  | "deactivate_user"
  | "reactivate_user"
  | "export_audit_log"
  | "sa_create_hospital"
  | "sa_invite_hospital_admin"
  | "hospital_admin_claimed"
  // Hospital-admin staff-management actions (migration 0027).
  | "request_staff_info"
  | "suspend_staff_affiliation"
  | "deactivate_staff_affiliation"
  | "reactivate_staff_affiliation"
  | "reset_staff_mfa"
  | "assign_staff_role"
  | "invite_staff"
  | "revoke_staff_invitation"
  // Scheduling actions (migration 0028).
  | "book_appointment"
  | "confirm_appointment_request"
  | "decline_appointment_request"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "mark_no_show"
  | "mark_arrived"
  | "start_encounter"
  | "complete_encounter"
  | "propose_urgent_appointment"
  | "record_walkin"
  | "set_clinician_availability"
  | "cancel_clinician_availability"
  | "update_clinician_settings"
  | "update_department_policy"
  | "override_out_of_hours_booking"
  // Doctor workspace (migration 0030).
  | "assign_supervision"
  | "end_supervision"
  | "cosign_request"
  | "cosign_approve"
  | "cosign_return"
  | "cosign_cancel"
  | "cosign_expire"
  | "update_cosign_policy"
  | "phi_access_break_glass"
  // Nurse workspace (migration 0031).
  | "record_observation"
  | "correct_observation"
  | "administer_medication"
  | "withhold_medication"
  | "submit_handover"
  | "assign_patient_to_nurse"
  | "unassign_patient_from_nurse"
  | "assign_ward_in_charge"
  | "end_ward_in_charge"
  | "escalate_to_medical_team"
  // Patient entry points (migration 0032).
  | "register_intake"
  | "update_intake"
  | "cancel_intake"
  // Reception + lifecycle (migration 0033)
  | "check_in_patient"
  // Book-or-queue: patient-declared intake (migration 0035)
  | "patient_declare_intake"
  // Emergency phone (ADR 0084 §3, migration 0054 — GATED, and until the owner
  // applies it sa-set-emergency-phone fails closed on the audit write).
  | "set_emergency_phone"
  // Visit ratings (migration 0056, ADR 0085).
  | "rate_visit"
  // Capacity model: service lines + sessions (migration 0058 — GATED, ADR 0087).
  | "update_service_line"
  | "update_session_template"
  | "cancel_session"
  | "book_on_behalf"
  // Identity: provisional patients + booking agents (migration 0060 — GATED, ADR 0089).
  | "reconcile_identity"
  | "unreconcile_identity"
  | "add_booking_agent"
  // Notifications + waitlist (migration 0061 — GATED, ADR 0090).
  | "join_waitlist"
  | "accept_waitlist_offer"
  | "accept_rebooking"
  | "confirm_attendance"
  | "set_session_delay"
  // Low-bandwidth channels (migration 0062 — GATED, ADR 0091).
  | "sms_stop"
  // Cadre fees (migration 0063 — GATED, ADR 0092).
  | "set_service_line_fee"
  // Symptom catalog + Emergency Pathway (migration 0066 — GATED, ADR 0098).
  | "submit_symptoms"
  | "emergency_interrupt_shown"
  | "emergency_declined"
  | "emergency_call_tapped"
  | "request_same_day"
  | "create_pre_arrival"
  | "update_pre_arrival"
  | "sign_catalog_version"
  | "verify_emergency_contact"
  | "set_hospital_emergency_settings"
  // Departments & services hub (migration 0080 — GATED, ADRs 0150–0160).
  | "update_department"
  | "set_department_live"
  | "set_start_department"
  | "assign_department_head"
  | "end_department_head"
  | "archive_structure"
  | "unarchive_structure"
  | "update_ward"
  | "update_beds"
  | "update_place"
  | "update_diagnostics"
  | "set_capability"
  | "verify_capability"
  | "reject_capability"
  | "report_availability"
  | "add_closure"
  | "lift_closure"
  | "apply_service_preset"
  | "import_legacy_services"
  // 0090: the ward builder and the bed board (ADRs 0191–0196)
  | "save_ward_layout"
  | "publish_ward_layout"
  | "set_bed_state"
  | "assign_bed"
  | "release_bed"
  // 0091: admission with a bed
  | "admit_patient"
  | "allocate_bed"
  | "confirm_arrival"
  | "cancel_allocation"
  // 0291: a walk-in registered at the desk (written in SQL by migration 0291, ADR 0475)
  | "register_patient"
  // 0292: the desk's claim code, and the patient taking the record over (written in SQL, ADR 0475)
  | "issue_claim_code"
  | "claim_desk_record"
  // 0294: the reception desk (ADRs 0486, 0489; D-RD-12)
  | "desk_identity_check"
  | "close_day"
  | "undo_close_day"
  | "desk_switch_user"
  | "desk_set_pin"
  | "desk_pin_locked";

export type SaAuditTargetKind =
  | "staff_affiliation"
  | "hospital_application"
  | "hospital"
  | "user"
  | "patient_profile"
  | "break_glass_grant"
  | "audit_log_export"
  | "hospital_admin_invitation"
  // Hospital-admin staff-management target (migration 0027).
  | "staff_invitation"
  // Scheduling targets (migration 0028).
  | "appointment"
  | "availability_block"
  | "queue_entry"
  | "encounter"
  | "clinician_scheduling_settings"
  | "department_scheduling_policy"
  // Doctor workspace (migration 0030).
  | "clinical_supervision"
  | "clinical_cosign_request"
  | "clinical_cosign_policy"
  | "clinical_phi_access"
  // Nurse workspace (migration 0031).
  | "nursing_assignment"
  | "ward_in_charge_assignment"
  | "clinical_observation"
  | "medication_administration_record"
  | "shift_handover"
  // Patient entry points (migration 0032).
  | "patient_intake"
  // Capacity model (migration 0058 — GATED, ADR 0087).
  | "service_line"
  | "session_template"
  | "clinic_session"
  // Identity (migration 0060 — GATED, ADR 0089).
  | "provisional_patient"
  | "booking_agent"
  // Notifications + waitlist (migration 0061 — GATED, ADR 0090).
  | "waitlist_entry"
  | "notification_dispatch"
  // Cadre fees (migration 0063 — GATED, ADR 0092).
  | "service_line_fee"
  // Symptom catalog + Emergency Pathway (migration 0066 — GATED, ADR 0098).
  | "symptom_submission"
  | "emergency_pre_arrival"
  | "emergency_contact"
  | "patient_symptom_catalog_version";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordSaAudit(params: {
  actorId: string;
  action: SaAuditAction;
  targetKind: SaAuditTargetKind;
  targetId: string;
  reason: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb.from("sa_audit_log").insert({
    actor_id: params.actorId,
    action: params.action,
    target_kind: params.targetKind,
    target_id: params.targetId,
    reason: params.reason,
    // The column is a uuid: a client's correlation id in another shape (the phone sent
    // `mob-…` until 19 Oct 2026) must not fail the audit, and so the action, for a log key.
    request_id: params.requestId && UUID.test(params.requestId) ? params.requestId : null,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
    before_data: params.beforeData ?? null,
    after_data: params.afterData ?? null,
  });
  if (error) {
    // sa_audit failure should NOT silently swallow — re-throw so the
    // Edge Function returns a 500 and the caller knows the audit
    // trail didn't land. The action it logged about must NOT be
    // considered committed in that case (Edge Functions should
    // ideally write the audit BEFORE the mutation, or wrap both in
    // a transaction; see specific function bodies).
    throw new Error(`sa_audit insert failed: ${error.message}`);
  }
}

/** Convenience for pulling network metadata off the incoming request. */
export function networkContext(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;
  return {
    ipAddress: ip,
    userAgent: request.headers.get("user-agent"),
  };
}
