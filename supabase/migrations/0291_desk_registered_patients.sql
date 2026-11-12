-- 0291 — Walk-in patients registered at the desk, with no login account (ADR 0475).
--
-- A desk-registered patient is an ordinary `patient_profiles` row on an `auth.users` row that has no credential: no
-- password, an undeliverable `@patients.medsync.invalid` address, `app_metadata.desk_registered = true`. Every table
-- that names a patient keys on the auth user, so the walk-in is booked, checked in and seen exactly like an account
-- patient. The Edge Function `ha-register-patient` creates the auth user (service role) and then calls the two
-- functions below; nothing else may.
--
--   1. consent_records.recorded_by_user_id — who recorded an agreement the patient gave at the desk. NULL = the person
--      ticked the box themself (sign-up). The notice, version and hash are the sign-up's own.
--   2. desk_patient_candidates() — the duplicate check: this hospital's patients (primary facility here, or a booking
--      or intake here) with the same phone, or born the same year (the caller compares names after decrypting).
--   3. desk_register_patient() — one transaction: the profile (primary facility = this hospital, code from the
--      sequence), the consent record, the user's state, and the audit row. Refuses a caller who is not staff at this
--      hospital, a child, a notice that does not match, and any auth user not made by the desk.
--   4. sa_audit_log_action_check — 0091's list verbatim + 'register_patient'. A later migration that re-issues this
--      CHECK must keep 'register_patient'.
--
-- GATED: owner-applied (`npm run db:migrate`), after 0289. Deploy `ha-register-patient` after it.

-- ─── 1. Consent recorded by staff ────────────────────────────────────
ALTER TABLE public.consent_records
  ADD COLUMN IF NOT EXISTS recorded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ─── Who may register here: active staff at the hospital, or its admin. Not a superadmin (0289: off PHI).
CREATE OR REPLACE FUNCTION public.desk_can_register(p_actor_id uuid, p_hospital_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.staff_affiliations s
       WHERE s.user_id = p_actor_id AND s.hospital_id = p_hospital_id
         AND s.state IN ('active', 'approved'))
    OR EXISTS (
      SELECT 1 FROM public.user_roles r
       WHERE r.user_id = p_actor_id AND r.hospital_id = p_hospital_id AND r.role = 'hospital_admin');
$$;

-- ─── 2. The duplicate check's candidates ─────────────────────────────
-- ponytail: rows with no phone blind index yet (written before 0062 and not backfilled) come back too, so the caller
-- can decrypt their phone; capped at the newest 500. Once the backfill has run everywhere, drop the IS NULL arm.
CREATE OR REPLACE FUNCTION public.desk_patient_candidates(
  p_hospital_id uuid,
  p_actor_id uuid,
  p_phone_hmac text,
  p_birth_year integer
)
  RETURNS TABLE (
    patient_user_id uuid,
    patient_code text,
    sex text,
    date_of_birth date,
    first_name_encrypted text,
    surname_encrypted text,
    phone_encrypted text,
    phone_hmac text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.desk_can_register(p_actor_id, p_hospital_id) THEN
    RAISE EXCEPTION 'not_staff_here' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.patient_code, p.sex, p.date_of_birth, p.first_name_encrypted, p.surname_encrypted,
           p.phone_encrypted, p.phone_hmac
      FROM public.patient_profiles p
     WHERE (p.phone_hmac = p_phone_hmac
            OR p.phone_hmac IS NULL
            OR extract(year FROM p.date_of_birth)::integer = p_birth_year)
       AND (p.primary_facility_id = p_hospital_id
            OR EXISTS (SELECT 1 FROM public.appointments a
                        WHERE a.patient_user_id = p.id AND a.hospital_id = p_hospital_id)
            OR EXISTS (SELECT 1 FROM public.patient_intakes i
                        WHERE i.patient_user_id = p.id AND i.hospital_id = p_hospital_id))
     ORDER BY p.created_at DESC
     LIMIT 500;
END;
$$;

-- ─── 3. The record, the consent and the audit, in one transaction ────
CREATE OR REPLACE FUNCTION public.desk_register_patient(
  p_user_id uuid,
  p_hospital_id uuid,
  p_actor_id uuid,
  p_first_name_encrypted text,
  p_surname_encrypted text,
  p_sex text,
  p_date_of_birth date,
  p_phone_encrypted text,
  p_phone_hmac text,
  p_district_id uuid,
  p_subcounty_id uuid,
  p_village_encrypted text,
  p_consent_version text,
  p_consent_sha text,
  p_despite_codes text[],
  p_request_id uuid,
  p_ip text,
  p_user_agent text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT public.desk_can_register(p_actor_id, p_hospital_id) THEN
    RAISE EXCEPTION 'not_staff_here' USING ERRCODE = '42501';
  END IF;
  -- Adults only, as at sign-up (DPPA s.8): a child's record needs a parent or guardian's consent (not built).
  IF p_date_of_birth > current_date - interval '18 years' THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.consent_versions v
     WHERE v.consent_type = 'data_processing' AND v.version = p_consent_version
       AND lower(v.body_sha256) = lower(p_consent_sha)
  ) THEN
    RAISE EXCEPTION 'consent_mismatch' USING ERRCODE = '22023';
  END IF;
  -- Never attach a desk record to someone's real login account.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = p_user_id AND u.raw_app_meta_data ->> 'desk_registered' = 'true'
  ) THEN
    RAISE EXCEPTION 'not_a_desk_account' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.patient_profiles (
    id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type, id_number_encrypted,
    phone_encrypted, phone_hmac, district_id, subcounty_id, village_address_encrypted, primary_facility_id
  ) VALUES (
    p_user_id, p_first_name_encrypted, p_surname_encrypted, p_sex, p_date_of_birth, 'none', NULL,
    p_phone_encrypted, p_phone_hmac, p_district_id, p_subcounty_id, p_village_encrypted, p_hospital_id
  )
  RETURNING patient_code INTO v_code;

  INSERT INTO public.consent_records (
    user_id, consent_type, version, consent_text_sha256, accepted_at, recorded_by_user_id
  ) VALUES (
    p_user_id, 'data_processing', p_consent_version, lower(p_consent_sha), now(), p_actor_id
  );

  UPDATE public.users SET state = 'verified' WHERE id = p_user_id;

  INSERT INTO public.sa_audit_log (
    actor_id, action, target_kind, target_id, reason, request_id, ip_address, user_agent, after_data
  ) VALUES (
    p_actor_id, 'register_patient', 'patient_profile', p_user_id::text,
    'Walk-in patient registered at the desk.', p_request_id, nullif(p_ip, '')::inet, p_user_agent,
    jsonb_build_object(
      'hospital_id', p_hospital_id,
      'patient_code', v_code,
      'consent_version', p_consent_version,
      -- The likely matches the desk was shown and said were someone else.
      'registered_despite', to_jsonb(coalesce(p_despite_codes, ARRAY[]::text[]))
    )
  );

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.desk_can_register(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desk_patient_candidates(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desk_register_patient(
  uuid, uuid, uuid, text, text, text, date, text, text, uuid, uuid, text, text, text, text[], uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_can_register(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.desk_patient_candidates(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.desk_register_patient(
  uuid, uuid, uuid, text, text, text, date, text, text, uuid, uuid, text, text, text, text[], uuid, text, text
) TO service_role;

-- ─── 4. Audit verb (0091's list verbatim + 'register_patient') ───────
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
    'register_patient'
  )
);
