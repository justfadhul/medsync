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
--   4. R65: a triage stay (no encounter, the intake named) is adopted (observe_in_eu, 0311) and ended
--      (end_eu_stay, 0312) only by an encounter of that visit (encounters.visit_id, or its triage's intake, or the
--      intake whose encounter_id names it: the queue start); another visit of the patient leaves it, and the resus
--      space, alone, and admit_from_encounter (0312) boards it only from that visit (else its existing AD409 "on
--      another visit" words). The three bodies are redefined verbatim but for that.
--   5. D7: resus_bay_profiles.bed_id (a resus space of an EU ward of the same hospital; one bay per space) and
--      hospital_care_units.ward_id (a ward of the same hospital), both ON DELETE SET NULL; a trigger refuses a link
--      across hospitals, to a non-resus space or to a non-EU ward ("EU400 " words). Audit verbs 'link_resus_bay'
--      and 'link_care_unit' (the section 3 list kept verbatim). The admin ops in ha-services-hub write them.
--      R66: a link must outlive no rule it was checked against: the guards also refuse an archived space or ward, and
--      triggers on hospital_beds (archived, or no longer a resus space, or moved) and hospital_wards (archived, or no
--      longer an emergency unit) clear the dependent bay/unit link in the same statement (audited by the bay's and
--      the unit's own audit trigger).
--   6. R71: hospital_wards_eu_stays_guard (BEFORE UPDATE OF archived_at, ward_type) refuses archiving a ward, or
--      re-typing it away from an emergency unit, while an open eu_stays row (status not 'ended') names it, waiting
--      for a space or not ("EU409 " words, HINT 'eu_ward_has_stays'; ha-services-hub maps it). The statement aborts
--      before section 5's clearing triggers run.
--
-- ADDITIVE and re-runnable.
-- Reverse: restore 0101's phi_access_basis_check (after removing any 'eu_staff' rows); restore 0295's
-- clinic_floor_events detail list only while no 'eu' row exists (that log is append-only); drop
-- send_to_eu_resus(jsonb) and restore 0311's audit list (after removing any 'send_to_eu_resus' rows); re-run 0311's
-- observe_in_eu and 0312's end_eu_stay and admit_from_encounter definitions; drop the two link guards, the two
-- clearing triggers (eu_links_clear_bed, eu_links_clear_ward), the open-stay guard (hospital_wards_eu_stays_guard
-- and its function) and the columns resus_bay_profiles.bed_id / hospital_care_units.ward_id (after clearing them)
-- and restore the audit list without 'link_resus_bay', 'link_care_unit' (after removing any such rows).

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

-- ─── 4. A triage stay belongs to its visit (R65) ─────────────────────────
-- A triage stay has no encounter, only its intake. 0312's end_eu_stay ended it for ANY encounter of the patient at
-- the hospital, and 0311's observe_in_eu adopted it from any, so an unrelated clinic visit could release the resus
-- space. Both bodies verbatim, except: the triage stay is matched only by an encounter whose visit is the stay's
-- intake (encounters.visit_id, or the intake of its triage record, as observe_in_eu already names the intake), or
-- that the stay's intake names (patient_intakes.encounter_id, stamped by the doctor's queue start).
-- Another visit's close finds no stay; its Send to EU is refused as "already in the EU"; its admission is refused
-- as "on another visit" (admit_from_encounter, below). Grants are kept.

-- 0311's observe_in_eu, plus R65 on the adoption.
CREATE OR REPLACE FUNCTION public.observe_in_eu(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := (p->>'actor')::uuid;
  v_bed uuid := nullif(p->>'bed_id', '')::uuid;
  v_reason text := CASE WHEN nullif(p->>'bed_id', '') IS NULL THEN nullif(p->>'space_wait_reason', '') END;
  v_note text := CASE WHEN nullif(p->>'bed_id', '') IS NULL THEN nullif(p->>'space_wait_note_ciphertext', '') END;
  v_enc public.encounters%ROWTYPE;
  v_ward public.hospital_wards%ROWTYPE;
  v_stay public.eu_stays%ROWTYPE;
  v_cur public.bed_assignments%ROWTYPE;
  v_label text;
  v_intake uuid;
  v_asg uuid;
  v_here boolean;
  v_con text;
BEGIN
  SELECT * INTO v_enc FROM public.encounters WHERE id = (p->>'encounter_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EU404 Visit not found.' USING ERRCODE = 'check_violation', HINT = 'eu_visit_not_found';
  END IF;
  IF v_enc.state <> 'in_progress' THEN
    RAISE EXCEPTION 'EU409 This visit is not in progress.'
      USING ERRCODE = 'check_violation', HINT = 'eu_visit_not_in_progress';
  END IF;
  SELECT * INTO v_ward FROM public.hospital_wards
   WHERE id = (p->>'ward_id')::uuid AND hospital_id = v_enc.hospital_id;
  IF NOT FOUND OR v_ward.archived_at IS NOT NULL OR v_ward.state <> 'active' OR v_ward.closed_at IS NOT NULL
     OR v_ward.ward_type IS DISTINCT FROM 'emergency_observation' THEN
    RAISE EXCEPTION 'EU409 That is not an emergency unit at this hospital.'
      USING ERRCODE = 'check_violation', HINT = 'eu_not_an_eu';
  END IF;
  IF v_bed IS NULL AND v_reason IS NULL THEN
    RAISE EXCEPTION 'EU400 Choose a space, or say why the patient waits for one.'
      USING ERRCODE = 'check_violation', HINT = 'eu_space_or_reason';
  END IF;
  IF v_reason = 'other' AND v_note IS NULL THEN
    RAISE EXCEPTION 'EU400 Say why the patient waits.' USING ERRCODE = 'check_violation', HINT = 'eu_wait_note';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admissions
              WHERE patient_user_id = v_enc.patient_user_id
                AND status IN ('awaiting_bed', 'bed_allocated', 'arrived')) THEN
    RAISE EXCEPTION 'EU409 This patient has an open admission.'
      USING ERRCODE = 'check_violation', HINT = 'eu_open_admission';
  END IF;
  SELECT * INTO v_stay FROM public.eu_stays
   WHERE patient_user_id = v_enc.patient_user_id AND status <> 'ended' FOR UPDATE;
  -- Only a triage stay at this hospital is adopted; any other open stay means the patient is in an EU already.
  -- R65: and only by an encounter of the triage's visit (its visit_id, or its triage's intake, or the intake that
  -- names this encounter: the doctor's queue start).
  IF FOUND AND (v_stay.encounter_id IS NOT NULL OR v_stay.hospital_id <> v_enc.hospital_id
                OR NOT (coalesce(v_stay.intake_id = coalesce(v_enc.visit_id,
                          (SELECT t.intake_id FROM public.triage_records t WHERE t.id = v_enc.triage_record_id)), false)
                        OR EXISTS (SELECT 1 FROM public.patient_intakes i
                                    WHERE i.id = v_stay.intake_id AND i.encounter_id = v_enc.id))) THEN
    RAISE EXCEPTION 'EU409 This patient is already in the EU.'
      USING ERRCODE = 'check_violation', HINT = 'eu_already_in_eu';
  END IF;

  IF v_stay.id IS NOT NULL THEN
    -- Adopt the triage stay: stamp the encounter; a different space chosen moves it, as move_eu_space does.
    SELECT * INTO v_cur FROM public.bed_assignments
     WHERE eu_stay_id = v_stay.id AND ended_at IS NULL FOR UPDATE;
    IF (v_bed IS NOT NULL AND v_bed IS DISTINCT FROM v_cur.bed_id) OR v_ward.id <> v_stay.ward_id THEN
      IF v_bed IS NOT NULL THEN
        v_label := public.admission_free_bed(v_enc.hospital_id, v_ward.id, v_bed);
        IF EXISTS (SELECT 1 FROM public.bed_assignments
                    WHERE patient_user_id = v_enc.patient_user_id AND ended_at IS NULL
                      AND id IS DISTINCT FROM v_cur.id) THEN
          RAISE EXCEPTION 'EU409 This patient is already in a bed. The ward releases it first.'
            USING ERRCODE = 'check_violation', HINT = 'eu_already_in_bed';
        END IF;
      END IF;
      IF v_cur.id IS NOT NULL THEN
        UPDATE public.bed_assignments
           SET ended_at = now(), ended_by = v_actor,
               reason = CASE WHEN v_bed IS NULL THEN 'Moved out of a space' ELSE 'Moved to ' || v_label END
         WHERE id = v_cur.id;
      END IF;
      -- Staff placing a waiting or arrived patient means the patient is here: the new space starts Occupied.
      v_here := v_stay.arrived_at IS NOT NULL OR v_stay.status = 'awaiting_space';
      IF v_bed IS NOT NULL THEN
        INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, encounter_id, eu_stay_id,
                                            started_by, arrived_at, arrived_by)
        VALUES (v_enc.hospital_id, v_ward.id, v_bed, v_enc.patient_user_id, v_enc.id, v_stay.id, v_actor,
                CASE WHEN v_here THEN now() END, CASE WHEN v_here THEN v_actor END)
        RETURNING id INTO v_asg;
      END IF;
      UPDATE public.eu_stays
         SET encounter_id = v_enc.id, ward_id = v_ward.id, responsible_user_id = v_actor,
             status = CASE WHEN v_bed IS NULL THEN 'awaiting_space' ELSE 'in_space' END,
             space_wait_reason = v_reason, space_wait_note_ciphertext = v_note,
             arrived_at = coalesce(arrived_at, CASE WHEN v_bed IS NOT NULL AND v_here THEN now() END),
             arrived_by = coalesce(arrived_by, CASE WHEN v_bed IS NOT NULL AND v_here THEN v_actor END)
       WHERE id = v_stay.id;
    ELSE
      v_asg := v_cur.id;
      SELECT label INTO v_label FROM public.hospital_beds WHERE id = v_cur.bed_id;
      -- Same space (or still waiting on the same EU): the doctor's own wait reason replaces the nurse's.
      UPDATE public.eu_stays
         SET encounter_id = v_enc.id, responsible_user_id = v_actor,
             space_wait_reason = CASE WHEN status = 'awaiting_space' THEN v_reason ELSE space_wait_reason END,
             space_wait_note_ciphertext = CASE WHEN status = 'awaiting_space' THEN v_note
                                               ELSE space_wait_note_ciphertext END
       WHERE id = v_stay.id;
    END IF;
    v_intake := v_stay.intake_id;
  ELSE
    IF v_bed IS NOT NULL THEN
      v_label := public.admission_free_bed(v_enc.hospital_id, v_ward.id, v_bed);
      IF EXISTS (SELECT 1 FROM public.bed_assignments
                  WHERE patient_user_id = v_enc.patient_user_id AND ended_at IS NULL) THEN
        RAISE EXCEPTION 'EU409 This patient is already in a bed. The ward releases it first.'
          USING ERRCODE = 'check_violation', HINT = 'eu_already_in_bed';
      END IF;
    END IF;
    -- The visit's intake, or its triage's; only one of this patient at this hospital is named.
    SELECT i.id INTO v_intake FROM public.patient_intakes i
     WHERE i.id = coalesce(v_enc.visit_id,
                           (SELECT t.intake_id FROM public.triage_records t WHERE t.id = v_enc.triage_record_id))
       AND i.patient_user_id = v_enc.patient_user_id AND i.hospital_id = v_enc.hospital_id;
    BEGIN
      INSERT INTO public.eu_stays (hospital_id, patient_user_id, encounter_id, intake_id, ward_id, started_by_kind,
                                   decided_by, responsible_user_id, status, space_wait_reason,
                                   space_wait_note_ciphertext)
      VALUES (v_enc.hospital_id, v_enc.patient_user_id, v_enc.id, v_intake, v_ward.id, 'doctor', v_actor, v_actor,
              CASE WHEN v_bed IS NULL THEN 'awaiting_space' ELSE 'in_space' END, v_reason, v_note)
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
    IF v_bed IS NOT NULL THEN
      INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, encounter_id, eu_stay_id,
                                          started_by)
      VALUES (v_enc.hospital_id, v_ward.id, v_bed, v_enc.patient_user_id, v_enc.id, v_stay.id, v_actor)
      RETURNING id INTO v_asg;
    END IF;
  END IF;

  INSERT INTO public.encounter_events (encounter_id, kind, label, actor_user_id, recorded_at)
  VALUES (v_enc.id, 'disposition',
          'Sent to ' || v_ward.name || ', ' || coalesce(v_label, 'waiting for a space') || ' (the visit stays open)',
          v_actor, now());

  -- v_stay is the triage stay as locked (no encounter yet) when adopted, the new row otherwise.
  RETURN jsonb_build_object('stay_id', v_stay.id, 'assignment_id', v_asg, 'ward', v_ward.name, 'bed', v_label,
                            'patient_user_id', v_enc.patient_user_id, 'hospital_id', v_enc.hospital_id,
                            'intake_id', v_intake, 'adopted', v_stay.encounter_id IS NULL);
END;
$$;

-- 0312's end_eu_stay, plus R65 on the triage-stay arm.
CREATE OR REPLACE FUNCTION public.end_eu_stay(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := (p->>'actor')::uuid;
  v_enc public.encounters%ROWTYPE;
  v_stay public.eu_stays%ROWTYPE;
  v_ward text;
  v_adm public.admissions%ROWTYPE;
BEGIN
  IF p->>'end_kind' = 'admitted' THEN
    RAISE EXCEPTION 'EU400 An admission ends the stay when the patient arrives on the ward.'
      USING ERRCODE = 'check_violation', HINT = 'eu_admission_ends_on_arrival';
  END IF;
  SELECT * INTO v_enc FROM public.encounters WHERE id = (p->>'encounter_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EU404 Visit not found.' USING ERRCODE = 'check_violation', HINT = 'eu_visit_not_found';
  END IF;
  SELECT * INTO v_stay FROM public.eu_stays
   WHERE patient_user_id = v_enc.patient_user_id AND hospital_id = v_enc.hospital_id AND status <> 'ended'
     AND (encounter_id = v_enc.id
          -- R65: a triage stay (no encounter) only for an encounter of the triage's visit.
          OR (encounter_id IS NULL
              AND (intake_id = coalesce(v_enc.visit_id,
                     (SELECT t.intake_id FROM public.triage_records t WHERE t.id = v_enc.triage_record_id))
                   OR intake_id IN (SELECT i.id FROM public.patient_intakes i WHERE i.encounter_id = v_enc.id)))
          OR admission_id IN (SELECT id FROM public.admissions WHERE inpatient_encounter_id = v_enc.id))
   FOR UPDATE;
  -- No stay this visit may end (none, another visit's, or already ended): nothing written.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ended', false);
  END IF;
  IF v_enc.state <> 'in_progress' THEN
    RAISE EXCEPTION 'EU409 This visit is not in progress.'
      USING ERRCODE = 'check_violation', HINT = 'eu_visit_not_in_progress';
  END IF;
  SELECT name INTO v_ward FROM public.hospital_wards WHERE id = v_stay.ward_id;
  -- R62: a boarder's open admission (and its Arriving ward bed) ends with the stay. DRAFT wording for the CSO.
  SELECT * INTO v_adm FROM public.admissions
   WHERE id = v_stay.admission_id AND status IN ('awaiting_bed', 'bed_allocated') FOR UPDATE;
  IF FOUND THEN
    UPDATE public.bed_assignments SET ended_at = now(), ended_by = v_actor, reason = 'Left the EU'
     WHERE admission_id = v_adm.id AND ended_at IS NULL AND arrived_at IS NULL;
    UPDATE public.admissions
       SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor,
           cancel_reason = 'Left the EU before reaching the ward'
     WHERE id = v_adm.id;
  END IF;

  UPDATE public.bed_assignments SET ended_at = now(), ended_by = v_actor, reason = 'Left the EU'
   WHERE eu_stay_id = v_stay.id AND ended_at IS NULL;
  UPDATE public.eu_stays
     SET status = 'ended', ended_at = now(), ended_by = v_actor, end_kind = p->>'end_kind',
         encounter_id = coalesce(encounter_id, v_enc.id)
   WHERE id = v_stay.id;
  -- As ha-complete-encounter's clinical close, plus the stay it ended.
  UPDATE public.encounters
     SET state = 'completed', ended_at = now(), completed_by = v_actor, closure_kind = 'clinical',
         disposition = p->>'disposition',
         disposition_detail = coalesce(nullif(p->'disposition_detail', 'null'::jsonb), '{}'::jsonb)
                              || jsonb_build_object('eu_stay_id', v_stay.id, 'eu_ward', v_ward),
         follow_up = nullif(p->'follow_up', 'null'::jsonb),
         completion_reason = coalesce(nullif(p->>'completion_reason', ''), 'ended_by_clinician')
   WHERE id = v_enc.id;
  INSERT INTO public.encounter_events (encounter_id, kind, label, actor_user_id, recorded_at)
  VALUES (v_enc.id, 'disposition', 'Visit completed: ' || (p->>'disposition') || ', left ' || v_ward, v_actor, now());
  RETURN jsonb_build_object('ended', true, 'stay_id', v_stay.id);
END;
$$;

-- 0312's admit_from_encounter, plus R65: a triage stay boards only from its own visit.
CREATE OR REPLACE FUNCTION public.admit_from_encounter(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := (p->>'actor')::uuid;
  v_bed uuid := nullif(p->>'bed_id', '')::uuid;
  v_enc public.encounters%ROWTYPE;
  v_ward public.hospital_wards%ROWTYPE;
  v_stay public.eu_stays%ROWTYPE;
  v_inpatient uuid;
  v_label text;
  v_adm uuid;
  v_asg uuid;
  v_detail jsonb;
BEGIN
  SELECT * INTO v_enc FROM public.encounters WHERE id = (p->>'encounter_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AD404 Visit not found.';
  END IF;
  IF v_enc.state <> 'in_progress' THEN
    RAISE EXCEPTION 'AD409 This visit is not in progress, so it cannot be closed as an admission.';
  END IF;
  SELECT * INTO v_ward FROM public.hospital_wards
   WHERE id = (p->>'ward_id')::uuid AND hospital_id = v_enc.hospital_id;
  IF NOT FOUND OR v_ward.archived_at IS NOT NULL OR v_ward.state <> 'active' OR v_ward.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'AD409 That ward is not taking admissions at this hospital.';
  END IF;
  IF v_ward.ward_type = 'emergency_observation' THEN
    RAISE EXCEPTION 'AD409 An emergency unit is not a ward to admit to.';
  END IF;
  IF v_bed IS NULL AND (p->>'bed_wait_reason') IS NULL THEN
    RAISE EXCEPTION 'AD400 Choose a bed, or say why the patient waits for one.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admissions
              WHERE patient_user_id = v_enc.patient_user_id
                AND status IN ('awaiting_bed', 'bed_allocated', 'arrived')) THEN
    RAISE EXCEPTION 'AD409 This patient already has an open admission.';
  END IF;
  SELECT * INTO v_stay FROM public.eu_stays
   WHERE patient_user_id = v_enc.patient_user_id AND hospital_id = v_enc.hospital_id AND status <> 'ended'
   FOR UPDATE;
  -- R65: a triage stay (no encounter yet) boards only from its own visit, as observe_in_eu adopts it.
  IF v_stay.encounter_id <> v_enc.id
     OR (v_stay.id IS NOT NULL AND v_stay.encounter_id IS NULL
         AND NOT (coalesce(v_stay.intake_id = coalesce(v_enc.visit_id,
                    (SELECT t.intake_id FROM public.triage_records t WHERE t.id = v_enc.triage_record_id)), false)
                  OR EXISTS (SELECT 1 FROM public.patient_intakes i
                              WHERE i.id = v_stay.intake_id AND i.encounter_id = v_enc.id))) THEN
    RAISE EXCEPTION 'AD409 This patient is in the emergency unit on another visit. Admit them from that visit.';
  END IF;
  IF v_bed IS NOT NULL THEN
    v_label := public.admission_free_bed(v_enc.hospital_id, v_ward.id, v_bed);
    IF EXISTS (SELECT 1 FROM public.bed_assignments
                WHERE patient_user_id = v_enc.patient_user_id AND ended_at IS NULL
                  AND (eu_stay_id = v_stay.id) IS NOT TRUE) THEN
      RAISE EXCEPTION 'AD409 This patient is already in a bed. The ward releases it first.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.bed_assignments
                WHERE eu_stay_id = v_stay.id AND ended_at IS NULL AND arrived_at IS NULL) THEN
      RAISE EXCEPTION 'AD409 Mark the patient as arrived in the EU first.';
    END IF;
  END IF;

  -- D6: a boarder's inpatient record opens at the decision to admit (everyone else's on arrival).
  IF v_stay.id IS NOT NULL THEN
    INSERT INTO public.encounters (hospital_id, patient_user_id, clinician_user_id, department_id, state,
                                   encounter_type, started_at, last_activity_at)
    VALUES (v_enc.hospital_id, v_enc.patient_user_id, v_actor, v_ward.department_id, 'in_progress', 'inpatient',
            now(), now())
    RETURNING id INTO v_inpatient;
  END IF;

  INSERT INTO public.admissions (hospital_id, patient_user_id, source_encounter_id, ward_id, leading_condition_id,
                                 status, decided_by, bed_wait_reason, bed_wait_note_ciphertext,
                                 inpatient_encounter_id)
  VALUES (v_enc.hospital_id, v_enc.patient_user_id, v_enc.id, v_ward.id,
          nullif(p->>'leading_condition_id', '')::uuid,
          CASE WHEN v_bed IS NULL THEN 'awaiting_bed' ELSE 'bed_allocated' END, v_actor,
          CASE WHEN v_bed IS NULL THEN p->>'bed_wait_reason' END,
          CASE WHEN v_bed IS NULL THEN p->>'bed_wait_note_ciphertext' END, v_inpatient)
  RETURNING id INTO v_adm;

  -- The stay boards for this admission before the ward bed (the guard's pair) and the close (the close guard).
  IF v_stay.id IS NOT NULL THEN
    UPDATE public.eu_stays SET admission_id = v_adm, encounter_id = coalesce(encounter_id, v_enc.id)
     WHERE id = v_stay.id;
  END IF;

  IF v_bed IS NOT NULL THEN
    INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, encounter_id, admission_id,
                                        started_by)
    VALUES (v_enc.hospital_id, v_ward.id, v_bed, v_enc.patient_user_id, v_enc.id, v_adm, v_actor)
    RETURNING id INTO v_asg;
  END IF;

  v_detail := coalesce(nullif(p->'disposition_detail', 'null'::jsonb), '{}'::jsonb)
    || jsonb_build_object('admission_id', v_adm::text, 'ward_id', v_ward.id::text, 'ward', v_ward.name)
    || CASE WHEN v_bed IS NULL THEN jsonb_build_object('bed', 'waiting')
            ELSE jsonb_build_object('bed_id', v_bed::text, 'bed', v_label) END;
  UPDATE public.encounters
     SET state = 'completed', ended_at = now(), completed_by = v_actor, closure_kind = 'clinical',
         completion_reason = coalesce(p->>'completion_reason', 'ended_by_clinician'),
         disposition = 'admitted', disposition_detail = v_detail
   WHERE id = v_enc.id;
  INSERT INTO public.encounter_events (encounter_id, kind, label, actor_user_id, recorded_at)
  VALUES (v_enc.id, 'disposition',
          'Visit completed: admitted to ' || v_ward.name
            || CASE WHEN v_bed IS NULL THEN ', waiting for a bed' ELSE ', bed ' || v_label END,
          v_actor, now());

  RETURN jsonb_build_object('admission_id', v_adm, 'assignment_id', v_asg, 'ward', v_ward.name, 'bed', v_label,
                            'patient_user_id', v_enc.patient_user_id, 'hospital_id', v_enc.hospital_id);
END;
$$;

-- ─── 5. Resus bays and care units link to the drawn EU (D7) ───────────────
ALTER TABLE public.resus_bay_profiles
  ADD COLUMN IF NOT EXISTS bed_id uuid REFERENCES public.hospital_beds(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rbp_bed_unique ON public.resus_bay_profiles (bed_id) WHERE bed_id IS NOT NULL;
ALTER TABLE public.hospital_care_units
  ADD COLUMN IF NOT EXISTS ward_id uuid REFERENCES public.hospital_wards(id) ON DELETE SET NULL;

-- No client can link across hospitals: the bay's space must be a resus space of an emergency_observation ward of
-- the bay's own hospital; the unit's ward must be of the unit's hospital.
CREATE OR REPLACE FUNCTION public.resus_bay_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.bed_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.hospital_beds b
         JOIN public.hospital_wards w ON w.id = b.ward_id
        WHERE b.id = NEW.bed_id AND b.hospital_id = NEW.hospital_id AND b.bed_type = 'resus' AND b.archived_at IS NULL
          AND w.archived_at IS NULL AND w.hospital_id = NEW.hospital_id AND w.ward_type = 'emergency_observation') THEN
    RAISE EXCEPTION 'EU400 Choose a resus space of an emergency unit.'
      USING ERRCODE = 'check_violation', HINT = 'eu_bay_link';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS resus_bay_link_guard ON public.resus_bay_profiles;
CREATE TRIGGER resus_bay_link_guard BEFORE INSERT OR UPDATE OF bed_id, hospital_id ON public.resus_bay_profiles
  FOR EACH ROW EXECUTE FUNCTION public.resus_bay_link_guard();

CREATE OR REPLACE FUNCTION public.care_unit_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.ward_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.hospital_wards w WHERE w.id = NEW.ward_id AND w.hospital_id = NEW.hospital_id
                AND w.archived_at IS NULL) THEN
    RAISE EXCEPTION 'EU400 Choose a ward of this hospital.'
      USING ERRCODE = 'check_violation', HINT = 'eu_unit_link';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS care_unit_link_guard ON public.hospital_care_units;
CREATE TRIGGER care_unit_link_guard BEFORE INSERT OR UPDATE OF ward_id, hospital_id ON public.hospital_care_units
  FOR EACH ROW EXECUTE FUNCTION public.care_unit_link_guard();

-- Section 3's verbs verbatim + this section's.
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
    'send_to_eu_resus',
    -- 0313: resus bays and care units link to the EU
    'link_resus_bay', 'link_care_unit'
  )
);

-- R66: beds are archived, never deleted, so ON DELETE SET NULL never runs. When a space stops being a live resus
-- space of an emergency unit (layout publish archives it or re-types it; the ward is archived or re-typed), the
-- bay's link is cleared in the same statement. SECURITY DEFINER so a publish run by any role can clear it; it never
-- raises, and the bay's own audit trigger records the update.
CREATE OR REPLACE FUNCTION public.eu_links_clear_bed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL OR NEW.bed_type IS DISTINCT FROM 'resus' OR NEW.ward_id IS DISTINCT FROM OLD.ward_id THEN
    UPDATE public.resus_bay_profiles SET bed_id = NULL WHERE bed_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS eu_links_clear_bed ON public.hospital_beds;
CREATE TRIGGER eu_links_clear_bed AFTER UPDATE OF archived_at, bed_type, ward_id ON public.hospital_beds
  FOR EACH ROW EXECUTE FUNCTION public.eu_links_clear_bed();

CREATE OR REPLACE FUNCTION public.eu_links_clear_ward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    UPDATE public.hospital_care_units SET ward_id = NULL WHERE ward_id = NEW.id;
  END IF;
  IF NEW.archived_at IS NOT NULL OR NEW.ward_type IS DISTINCT FROM 'emergency_observation' THEN
    UPDATE public.resus_bay_profiles SET bed_id = NULL
     WHERE bed_id IN (SELECT id FROM public.hospital_beds WHERE ward_id = NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS eu_links_clear_ward ON public.hospital_wards;
CREATE TRIGGER eu_links_clear_ward AFTER UPDATE OF archived_at, ward_type ON public.hospital_wards
  FOR EACH ROW EXECUTE FUNCTION public.eu_links_clear_ward();

-- ─── 6. An EU with open stays is not archived or re-typed (R71) ─────────
-- A stay waiting for a space holds no bed, so the hub's occupied-bed count misses it; archiving the ward or re-typing
-- it away from an emergency unit would drop the patient from every EU list. BEFORE UPDATE, so a refusal aborts the
-- statement before eu_links_clear_ward (AFTER) clears anything. SECURITY DEFINER so RLS on eu_stays never hides a stay.
-- shortcut: a send racing the archive is not locked out (the stay's foreign key takes only KEY SHARE on the ward);
-- close it if sends and archives ever meet in practice.
CREATE OR REPLACE FUNCTION public.hospital_wards_eu_stays_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ((OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
      OR (OLD.ward_type = 'emergency_observation' AND NEW.ward_type IS DISTINCT FROM 'emergency_observation'))
     AND EXISTS (SELECT 1 FROM public.eu_stays WHERE ward_id = NEW.id AND status <> 'ended') THEN
    RAISE EXCEPTION 'EU409 Patients are in this emergency unit or waiting for a space in it. End or move their stays first.'
      USING ERRCODE = 'check_violation', HINT = 'eu_ward_has_stays';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hospital_wards_eu_stays_guard ON public.hospital_wards;
CREATE TRIGGER hospital_wards_eu_stays_guard BEFORE UPDATE OF archived_at, ward_type ON public.hospital_wards
  FOR EACH ROW EXECUTE FUNCTION public.hospital_wards_eu_stays_guard();
