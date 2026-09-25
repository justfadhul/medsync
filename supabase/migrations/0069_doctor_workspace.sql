-- 0069 — Doctor Workspace: one audit action and PHI-free live updates.
--
-- Per docs/doctor-workspace/gate-a-proposal.md §5 (adopted 2026-09-24 on the
-- owner's "go through all gates"; the CSO signature block is in §9).
--
-- ADDITIVE. No table, no column, no backfill; nothing existing changes meaning:
--   1. sa_audit_log action CHECK + 'retire_assignment' — a superseded planned
--      encounter (an assignment) is retired by a person with a reason (D5)
--   2. broadcast triggers on patient_intakes, triage_records and encounters →
--      the private topic workspace:<hospital_id>. The payload is { kind, at }:
--      no id, no name, nothing about a patient leaves the database
--   3. realtime.messages: active clinical staff of that hospital may listen
--      (guarded, like 0068 §10)
--
-- GATED: owner-applied (`npm run db:migrate`). Until it runs the workspace
-- re-reads every 15 s instead, and "Retire assignment" refuses — its audit row
-- cannot be written, and the retire and the audit share one transaction.


-- ─── 1. sa_audit_log: + retire_assignment ────────────────────────────
-- DROP-then-ADD: 0068's list verbatim plus the one new action.
ALTER TABLE public.sa_audit_log
  DROP CONSTRAINT IF EXISTS sa_audit_log_action_check;
ALTER TABLE public.sa_audit_log
  ADD CONSTRAINT sa_audit_log_action_check CHECK (
    action IN (
      'approve_staff_affiliation', 'reject_staff_affiliation',
      'approve_hospital_application', 'reject_hospital_application',
      'cross_tenant_read', 'cross_tenant_export',
      'elevate_admin', 'create_superadmin', 'demote_admin',
      'break_glass_open', 'break_glass_close',
      'four_eyes_request', 'four_eyes_confirm', 'four_eyes_cancel',
      'activate_hospital', 'suspend_user', 'reset_user_mfa',
      'deactivate_user', 'reactivate_user', 'export_audit_log',
      'sa_create_hospital', 'sa_invite_hospital_admin', 'hospital_admin_claimed',
      'request_staff_info', 'suspend_staff_affiliation',
      'deactivate_staff_affiliation', 'reactivate_staff_affiliation',
      'reset_staff_mfa', 'assign_staff_role',
      'invite_staff', 'revoke_staff_invitation',
      'book_appointment', 'confirm_appointment_request',
      'decline_appointment_request', 'cancel_appointment',
      'reschedule_appointment', 'mark_no_show', 'mark_arrived',
      'start_encounter', 'complete_encounter',
      'propose_urgent_appointment', 'record_walkin',
      'set_clinician_availability', 'cancel_clinician_availability',
      'update_clinician_settings', 'update_department_policy',
      'override_out_of_hours_booking',
      'assign_supervision', 'end_supervision',
      'cosign_request', 'cosign_approve', 'cosign_return',
      'cosign_cancel', 'cosign_expire',
      'update_cosign_policy',
      'phi_access_break_glass',
      'record_observation', 'correct_observation',
      'administer_medication', 'withhold_medication',
      'submit_handover',
      'assign_patient_to_nurse', 'unassign_patient_from_nurse',
      'assign_ward_in_charge', 'end_ward_in_charge',
      'escalate_to_medical_team',
      'register_intake', 'update_intake', 'cancel_intake',
      'check_in_patient',
      'patient_declare_intake',
      'compute_triage', 'assign_triage', 'override_triage',
      'adjust_triage_baseline',
      'open_resus_episode', 'conclude_resus_episode',
      'record_resus_event', 'correct_resus_event',
      'assign_resus_role', 'end_resus_role',
      'mobilise_resus_team', 'detect_resus_arrest',
      'set_emergency_phone',
      'rate_visit',
      'update_service_line', 'update_session_template',
      'cancel_session', 'book_on_behalf',
      'reconcile_identity', 'unreconcile_identity', 'add_booking_agent',
      'join_waitlist', 'accept_waitlist_offer', 'accept_rebooking',
      'confirm_attendance', 'set_session_delay',
      'sms_stop',
      'set_service_line_fee',
      'submit_symptoms', 'emergency_interrupt_shown', 'emergency_declined',
      'emergency_call_tapped', 'request_same_day',
      'create_pre_arrival', 'update_pre_arrival',
      'sign_catalog_version', 'verify_emergency_contact',
      'set_hospital_emergency_settings',
      -- New (resus desk v2, migration 0068)
      'set_resus_phase', 'stop_resuscitation', 'confirm_death',
      'set_resus_disposition', 'cancel_resus_episode',
      'close_resus_administratively', 'reactivate_resus',
      'record_resus_arrest_record', 'submit_resus_debrief',
      'record_resus_after_death_task', 'update_resus_settings',
      -- New (doctor workspace, migration 0069)
      'retire_assignment'
    )
  );


-- ─── 2. PHI-free broadcast: "something on the board changed" ─────────
-- The client re-reads the server on a message; it never renders the payload.
-- A missing or failing realtime layer must never block a clinical write, so
-- errors are caught (as 0068's resus triggers do).
CREATE OR REPLACE FUNCTION public.workspace_broadcast()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('kind', TG_TABLE_NAME, 'at', now()),
      'change',
      'workspace:' || NEW.hospital_id::text,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$$;

-- Only the columns a lane is decided by: a documentation save or an
-- updated_at bump does not move anyone between lanes.
DROP TRIGGER IF EXISTS workspace_broadcast ON public.patient_intakes;
CREATE TRIGGER workspace_broadcast
  AFTER INSERT OR UPDATE OF status, triage_level, receiving_department_id, routed_to
  ON public.patient_intakes
  FOR EACH ROW EXECUTE FUNCTION public.workspace_broadcast();

DROP TRIGGER IF EXISTS workspace_broadcast ON public.triage_records;
CREATE TRIGGER workspace_broadcast
  AFTER INSERT ON public.triage_records
  FOR EACH ROW EXECUTE FUNCTION public.workspace_broadcast();

DROP TRIGGER IF EXISTS workspace_broadcast ON public.encounters;
CREATE TRIGGER workspace_broadcast
  AFTER INSERT OR UPDATE OF state, clinician_user_id, triage_record_id, ended_at
  ON public.encounters
  FOR EACH ROW EXECUTE FUNCTION public.workspace_broadcast();


-- ─── 3. realtime.messages: who may listen ────────────────────────────
-- workspace:<hospitalId> → active clinical staff at that hospital. Reception
-- (a non-clinical cadre), another hospital and anonymous may not. Guarded:
-- environments without the realtime schema skip this block.
DO $do$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS workspace_realtime_receive ON realtime.messages';
    EXECUTE $p$
      CREATE POLICY workspace_realtime_receive ON realtime.messages
        FOR SELECT TO authenticated
        USING (
          realtime.messages.extension = 'broadcast'
          AND (SELECT realtime.topic()) LIKE 'workspace:%'
          AND EXISTS (
            SELECT 1 FROM public.hospitals h
            WHERE h.id::text = substring((SELECT realtime.topic()) FROM 11)
              AND public.is_active_clinical_staff(h.id)
          )
        )
    $p$;
  END IF;
END
$do$;
