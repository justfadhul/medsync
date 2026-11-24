-- GATED — applied by the owner (`npm run db:migrate`), never auto-run; after 0312.
-- 0313: EU links (ADRs 0543, 0544).
--
--   1. phi_access_basis_check gains 'eu_staff' (0101's list kept verbatim): the true basis for a name on the EU
--      list (D10) shown to EU staff (the ward's nurses and in-charge, the rota's EU doctor, the hospital admin)
--      who hold no chart basis for that patient. 'assigned' stays a nursing assignment for the patient.
--   2. clinic_floor_events_detail_check (0295's inline CHECK, Postgres's name) gains 'eu' (0295's list kept
--      verbatim): a floor visit the doctor sent to the EU ends as "Observed in EU". ha-eu-stay writes that finish,
--      keyed by the stay's intake; the floor's own Finish dialog never offers it (D8).
--   3. send_to_eu_resus (D4): triage sends a Level 1–2 patient (the intake's latest triage) at this hospital to a
--      free resus space of an active, open EU. The stay is the triage nurse's (no encounter, the intake named), in
--      the space as Arriving; the doctor's Send to EU later adopts it (observe_in_eu, 0311). Service role only
--      (ha-eu-stay); audit verb 'send_to_eu_resus' (0311's sa_audit_log_action_check list kept verbatim).
--   Later sections come from Task 26.
--
-- ADDITIVE and re-runnable.
-- Reverse: restore 0101's phi_access_basis_check (after removing any 'eu_staff' rows); restore 0295's
-- clinic_floor_events detail list only while no 'eu' row exists (that log is append-only); drop
-- send_to_eu_resus(jsonb) and restore 0311's audit list (after removing any 'send_to_eu_resus' rows).

-- ─── 1. Log an EU list name truthfully ───────────────────────────────────
ALTER TABLE public.clinical_phi_access_log DROP CONSTRAINT IF EXISTS phi_access_basis_check;
ALTER TABLE public.clinical_phi_access_log ADD CONSTRAINT phi_access_basis_check CHECK (access_basis IN
  ('care_team','active_encounter','department_recent','break_glass',     -- 0030, kept
   'assigned','open_intake',                                             -- 0071, kept
   'lab_work',                                                           -- 0101, kept
   'eu_staff'));                                                         -- 0313

-- ─── 2. The floor's Observed in EU outcome ───────────────────────────────
ALTER TABLE public.clinic_floor_events DROP CONSTRAINT IF EXISTS clinic_floor_events_detail_check;
ALTER TABLE public.clinic_floor_events ADD CONSTRAINT clinic_floor_events_detail_check CHECK (
  detail IS NULL OR detail IN (
    'in_room', 'break_10', 'break_15', 'break_30', 'away',                -- 0295, kept
    'home', 'pharmacy_home', 'tests_back', 'admitted', 'referred', 'didnt_wait',
    'continuous', 'hourly', '4-6h', '12h', 'short',
    'next_day', 'other_doctor', 'handed_over',
    'eu'));                                                               -- 0313

-- ─── 3. Triage sends a Level 1–2 patient to EU resus (D4) ────────────────
-- Payload: hospital_id, intake_id, bed_id, actor (the triage nurse; ha-eu-stay sets it). The stay is the nurse's:
-- no encounter, the intake named; the doctor's Send to EU (observe_in_eu) later adopts it. Refusals start "EU4xx "
-- (admission_free_bed's "AD409 " words pass through). Lock order as observe_in_eu after its encounter: the stay
-- (the one-open index), the bed (admission_free_bed), then the assignment.
CREATE OR REPLACE FUNCTION public.send_to_eu_resus(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hospital uuid := (p->>'hospital_id')::uuid;
  v_actor uuid := (p->>'actor')::uuid;
  v_bed uuid := (p->>'bed_id')::uuid;
  v_intake public.patient_intakes%ROWTYPE;
  v_level smallint;
  v_ward public.hospital_wards%ROWTYPE;
  v_stay public.eu_stays%ROWTYPE;
  v_label text;
  v_asg uuid;
  v_con text;
BEGIN
  SELECT * INTO v_intake FROM public.patient_intakes
   WHERE id = (p->>'intake_id')::uuid AND hospital_id = v_hospital
     AND status IN ('arrived', 'awaiting_triage', 'triaged');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EU404 That visit is not at this hospital.'
      USING ERRCODE = 'check_violation', HINT = 'eu_visit_not_found';
  END IF;
  SELECT assigned_level INTO v_level FROM public.triage_records
   WHERE intake_id = v_intake.id ORDER BY triaged_at DESC LIMIT 1;
  IF v_level IS NULL OR v_level > 2 THEN
    RAISE EXCEPTION 'EU409 Only a Level 1 or 2 patient goes straight to EU resus.'
      USING ERRCODE = 'check_violation', HINT = 'eu_resus_level';
  END IF;
  -- An EU stay names its patient (eu_stays.patient_user_id): an unregistered patient goes by resus, not here.
  IF v_intake.patient_user_id IS NULL THEN
    RAISE EXCEPTION 'EU409 Register the patient at the desk first, or take them to resus.'
      USING ERRCODE = 'check_violation', HINT = 'eu_resus_no_patient';
  END IF;
  SELECT w.* INTO v_ward FROM public.hospital_beds b JOIN public.hospital_wards w ON w.id = b.ward_id
   WHERE b.id = v_bed AND b.hospital_id = v_hospital AND b.bed_type = 'resus'
     AND b.archived_at IS NULL AND b.closed_at IS NULL
     AND w.hospital_id = v_hospital AND w.ward_type = 'emergency_observation' AND w.state = 'active'
     AND w.archived_at IS NULL AND w.closed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EU409 Choose a resus space.' USING ERRCODE = 'check_violation', HINT = 'eu_resus_space';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admissions
              WHERE patient_user_id = v_intake.patient_user_id
                AND status IN ('awaiting_bed', 'bed_allocated', 'arrived')) THEN
    RAISE EXCEPTION 'EU409 This patient has an open admission.'
      USING ERRCODE = 'check_violation', HINT = 'eu_open_admission';
  END IF;
  PERFORM 1 FROM public.eu_stays
   WHERE patient_user_id = v_intake.patient_user_id AND status <> 'ended' FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'EU409 This patient is already in the EU.'
      USING ERRCODE = 'check_violation', HINT = 'eu_already_in_eu';
  END IF;
  v_label := public.admission_free_bed(v_hospital, v_ward.id, v_bed);
  IF EXISTS (SELECT 1 FROM public.bed_assignments
              WHERE patient_user_id = v_intake.patient_user_id AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'EU409 This patient is already in a bed. The ward releases it first.'
      USING ERRCODE = 'check_violation', HINT = 'eu_already_in_bed';
  END IF;
  BEGIN
    INSERT INTO public.eu_stays (hospital_id, patient_user_id, encounter_id, intake_id, ward_id, started_by_kind,
                                 decided_by, responsible_user_id, status)
    VALUES (v_hospital, v_intake.patient_user_id, NULL, v_intake.id, v_ward.id, 'triage_nurse', v_actor, v_actor,
            'in_space')
    RETURNING * INTO v_stay;
  EXCEPTION WHEN unique_violation THEN
    -- Two sends at once: the one-open-stay index decides, in words.
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'eu_stays_one_open_per_patient' THEN
      RAISE EXCEPTION 'EU409 This patient is already in the EU.'
        USING ERRCODE = 'check_violation', HINT = 'eu_already_in_eu';
    END IF;
    RAISE;
  END;
  -- Arriving until the EU's Arrived (confirm_bed_arrival).
  INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, encounter_id, eu_stay_id,
                                      started_by)
  VALUES (v_hospital, v_ward.id, v_bed, v_intake.patient_user_id, NULL, v_stay.id, v_actor)
  RETURNING id INTO v_asg;
  RETURN jsonb_build_object('stay_id', v_stay.id, 'assignment_id', v_asg, 'ward', v_ward.name, 'bed', v_label,
                            'intake_id', v_intake.id, 'hospital_id', v_hospital);
END;
$$;

REVOKE ALL ON FUNCTION public.send_to_eu_resus(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_to_eu_resus(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_to_eu_resus(jsonb) TO service_role;

-- 0311's verbs verbatim + this section's.
ALTER TABLE public.sa_audit_log DROP CONSTRAINT IF EXISTS sa_audit_log_action_check;
ALTER TABLE public.sa_audit_log ADD CONSTRAINT sa_audit_log_action_check CHECK (
  action IN (
    'approve_staff_affiliation', 'reject_staff_affiliation', 'approve_hospital_application',
    'reject_hospital_application', 'cross_tenant_read', 'cross_tenant_export', 'elevate_admin',
    'create_superadmin', 'demote_admin', 'break_glass_open', 'break_glass_close',
    'four_eyes_request', 'four_eyes_confirm', 'four_eyes_cancel', 'activate_hospital',
    'suspend_user', 'reset_user_mfa', 'deactivate_user', 'reactivate_user', 'export_audit_log',
    'sa_create_hospital', 'sa_invite_hospital_admin', 'hospital_admin_claimed',
    'request_staff_info', 'suspend_staff_affiliation', 'deactivate_staff_affiliation',
    'reactivate_staff_affiliation', 'reset_staff_mfa', 'assign_staff_role', 'invite_staff',
    'revoke_staff_invitation', 'book_appointment', 'confirm_appointment_request',
    'decline_appointment_request', 'cancel_appointment', 'reschedule_appointment',
    'mark_no_show', 'mark_arrived', 'start_encounter', 'complete_encounter',
    'propose_urgent_appointment', 'record_walkin', 'set_clinician_availability',
    'cancel_clinician_availability', 'update_clinician_settings', 'update_department_policy',
    'override_out_of_hours_booking', 'assign_supervision', 'end_supervision', 'cosign_request',
    'cosign_approve', 'cosign_return', 'cosign_cancel', 'cosign_expire', 'update_cosign_policy',
    'phi_access_break_glass', 'record_observation', 'correct_observation',
    'administer_medication', 'withhold_medication', 'submit_handover', 'assign_patient_to_nurse',
    'unassign_patient_from_nurse', 'assign_ward_in_charge', 'end_ward_in_charge',
    'escalate_to_medical_team', 'register_intake', 'update_intake', 'cancel_intake',
    'check_in_patient', 'patient_declare_intake', 'compute_triage', 'assign_triage',
    'override_triage', 'adjust_triage_baseline', 'open_resus_episode', 'conclude_resus_episode',
    'record_resus_event', 'correct_resus_event', 'assign_resus_role', 'end_resus_role',
    'mobilise_resus_team', 'detect_resus_arrest', 'set_emergency_phone', 'rate_visit',
    'update_service_line', 'update_session_template', 'cancel_session', 'book_on_behalf',
    'reconcile_identity', 'unreconcile_identity', 'add_booking_agent', 'join_waitlist',
    'accept_waitlist_offer', 'accept_rebooking', 'confirm_attendance', 'set_session_delay',
    'sms_stop', 'set_service_line_fee', 'submit_symptoms', 'emergency_interrupt_shown',
    'emergency_declined', 'emergency_call_tapped', 'request_same_day', 'create_pre_arrival',
    'update_pre_arrival', 'sign_catalog_version', 'verify_emergency_contact',
    'set_hospital_emergency_settings', 'set_resus_phase', 'stop_resuscitation', 'confirm_death',
    'set_resus_disposition', 'cancel_resus_episode', 'close_resus_administratively',
    'reactivate_resus', 'record_resus_arrest_record', 'submit_resus_debrief',
    'record_resus_after_death_task', 'update_resus_settings', 'retire_assignment',
    'verify_hospital_application',
    -- 0080: the Departments & services hub
    'update_department', 'set_department_live', 'set_start_department', 'assign_department_head',
    'end_department_head', 'archive_structure', 'unarchive_structure', 'update_ward', 'update_beds',
    'update_place', 'update_diagnostics', 'set_capability', 'verify_capability', 'reject_capability',
    'report_availability', 'add_closure', 'lift_closure', 'apply_service_preset',
    'import_legacy_services',
    -- 0090: the ward builder and the bed board
    'save_ward_layout', 'publish_ward_layout', 'set_bed_state', 'assign_bed', 'release_bed',
    -- 0091: admission with a bed
    'admit_patient', 'allocate_bed', 'confirm_arrival', 'cancel_allocation',
    -- 0291: a walk-in registered at the desk
    'register_patient',
    -- 0292: the desk's claim code, and the patient taking the record over
    'issue_claim_code', 'claim_desk_record',
    -- 0294: the reception desk
    'desk_identity_check', 'close_day', 'undo_close_day', 'desk_switch_user', 'desk_set_pin', 'desk_pin_locked',
    -- 0296: clinics and schedule
    'cs_draft', 'cs_undo', 'cs_publish', 'cs_schedule', 'cs_cancel_schedule', 'cs_restore', 'cs_pause',
    'cs_leave_decision', 'cs_pair_device', 'cs_unpair_device', 'cs_switch_user',
    -- 0311: the EU stay
    'send_to_eu', 'move_eu_space', 'end_eu_stay',
    -- 0313: triage sends to EU resus
    'send_to_eu_resus'
  )
);
