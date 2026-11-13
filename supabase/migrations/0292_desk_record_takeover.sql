-- 0292 — Taking over a desk-registered record at sign-up, with a claim code (ADR 0475, built).
--
-- A desk-registered patient (0291) is an `auth.users` row with no credential. When the person later wants an
-- account, they take over THAT row: the server gives it their email and password. No data moves, no id changes, so
-- every booking, intake, encounter and note stays theirs. Proof is a one-time claim code the desk hands over after
-- checking the person in front of it; a name, date of birth and phone are not secret.
--
--   1. desk_claim_codes — one row per desk record: the code's HMAC (never the code), expiry, failed tries, the short
--      permit the claim opens, and when and under which notice the person took the record over. RLS on, no
--      policies, no grants: the service role only.
--   2. desk_issue_claim_code() — the desk (ha-register-patient, action "claim_code"). Staff at the record's hospital
--      only; refuses a record that is already claimed or is someone's own account. A new code replaces the old one
--      and resets the tries. Audited (issue_claim_code; the code is never written).
--   3. desk_claim_begin() — sign-up's takeover (the app, service role): the phone's blind index and the code's HMAC.
--      Wrong code: every live code for that phone counts a failed try (5 spend them). Expired, claimed, spent: refused.
--      Right: opens a 5-minute permit for the auth update that follows. Returns an outcome; never raises, so the
--      count of failed tries is kept.
--   4. desk_claim_finish() — after the auth row has the person's email and password: marks the code used, records
--      the person's own acceptance of the notice, copies the email to public.users, audits (claim_desk_record).
--   5. desk_record_guard — BEFORE UPDATE on auth.users: while a row is desk-registered, its password, email, phone
--      and desk flag cannot change unless a claim permit is open. Password reset, an admin call or any later code
--      path cannot give a desk record a credential; only the takeover can.
--   6. sa_audit_log_action_check — 0291's list verbatim + 'issue_claim_code', 'claim_desk_record'. A later migration
--      that re-issues this CHECK must keep 'register_patient' and these two.
--
-- GATED: owner-applied (`npm run db:migrate`), after 0291. Redeploy `ha-register-patient` after it.

-- ─── 1. The claim codes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_claim_codes (
  patient_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  code_hash text NOT NULL,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  claim_permit_until timestamptz,
  claimed_at timestamptz,
  claim_consent_version text,
  claim_consent_sha256 text
);
CREATE INDEX IF NOT EXISTS desk_claim_codes_hash_idx ON public.desk_claim_codes (code_hash);
ALTER TABLE public.desk_claim_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.desk_claim_codes FROM PUBLIC, anon, authenticated;
-- No client policy, so no client reads it; the MFA gate anyway, as every RLS table since 0288 (review C-2).
DROP POLICY IF EXISTS mfa_gate ON public.desk_claim_codes;
CREATE POLICY mfa_gate ON public.desk_claim_codes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));

-- ─── 2. The desk gives a code ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.desk_issue_claim_code(
  p_hospital_id uuid,
  p_actor_id uuid,
  p_patient_code text,
  p_code_hash text,
  p_request_id uuid,
  p_ip text,
  p_user_agent text
)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_facility uuid;
  v_expires timestamptz := now() + interval '30 days';
BEGIN
  IF NOT public.desk_can_register(p_actor_id, p_hospital_id) THEN
    RAISE EXCEPTION 'not_staff_here' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.primary_facility_id INTO v_user, v_facility
    FROM public.patient_profiles p WHERE p.patient_code = upper(trim(p_patient_code));
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'no_such_patient' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.desk_claim_codes c WHERE c.patient_user_id = v_user AND c.claimed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'already_claimed' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = v_user AND u.raw_app_meta_data ->> 'desk_registered' = 'true'
  ) THEN
    RAISE EXCEPTION 'has_account' USING ERRCODE = '22023';
  END IF;
  -- The record is the registering hospital's: another hospital's desk cannot hand it over.
  IF v_facility IS DISTINCT FROM p_hospital_id THEN
    RAISE EXCEPTION 'other_hospital' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.desk_claim_codes AS c (patient_user_id, hospital_id, code_hash, issued_by, expires_at)
  VALUES (v_user, p_hospital_id, p_code_hash, p_actor_id, v_expires)
  ON CONFLICT (patient_user_id) DO UPDATE
     SET code_hash = EXCLUDED.code_hash, issued_by = EXCLUDED.issued_by, issued_at = now(),
         expires_at = EXCLUDED.expires_at, failed_attempts = 0, claim_permit_until = NULL;

  INSERT INTO public.sa_audit_log (
    actor_id, action, target_kind, target_id, reason, request_id, ip_address, user_agent, after_data
  ) VALUES (
    p_actor_id, 'issue_claim_code', 'patient_profile', v_user::text,
    'Claim code given at the desk.', p_request_id, nullif(p_ip, '')::inet, p_user_agent,
    jsonb_build_object('hospital_id', p_hospital_id, 'patient_code', upper(trim(p_patient_code)),
                       'expires_at', v_expires)
  );
  RETURN v_expires;
END;
$$;

-- ─── 3. Sign-up checks the code and opens a short permit ─────────────
CREATE OR REPLACE FUNCTION public.desk_claim_begin(p_phone_hmac text, p_code_hash text)
  RETURNS TABLE (outcome text, user_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v public.desk_claim_codes%ROWTYPE;
BEGIN
  SELECT c.* INTO v
    FROM public.desk_claim_codes c
    JOIN public.patient_profiles p ON p.id = c.patient_user_id
   WHERE p.phone_hmac = p_phone_hmac AND c.code_hash = p_code_hash
   FOR UPDATE OF c;

  IF NOT FOUND THEN
    -- Count the try against every live code for this phone: five wrong tries spend them.
    UPDATE public.desk_claim_codes c SET failed_attempts = c.failed_attempts + 1
      FROM public.patient_profiles p
     WHERE p.id = c.patient_user_id AND p.phone_hmac = p_phone_hmac AND c.claimed_at IS NULL;
    RETURN QUERY SELECT 'wrong_code'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v.claimed_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = v.patient_user_id AND u.raw_app_meta_data ->> 'desk_registered' = 'true'
  ) THEN
    RETURN QUERY SELECT 'already_claimed'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v.failed_attempts >= 5 THEN
    RETURN QUERY SELECT 'too_many_tries'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.desk_claim_codes SET claim_permit_until = now() + interval '5 minutes'
   WHERE desk_claim_codes.patient_user_id = v.patient_user_id;
  RETURN QUERY SELECT 'ok'::text, v.patient_user_id;
END;
$$;

-- ─── 4. After the auth row has the person's credential ───────────────
CREATE OR REPLACE FUNCTION public.desk_claim_finish(
  p_user_id uuid,
  p_email text,
  p_consent_version text,
  p_consent_sha text,
  p_ip text,
  p_user_agent text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_hospital uuid;
  v_code text;
BEGIN
  SELECT c.hospital_id INTO v_hospital FROM public.desk_claim_codes c
   WHERE c.patient_user_id = p_user_id AND c.claimed_at IS NULL AND c.claim_permit_until > now()
   FOR UPDATE;
  IF v_hospital IS NULL THEN
    RAISE EXCEPTION 'no_permit' USING ERRCODE = '42501';
  END IF;
  -- The auth update must have happened: the person's email on the row, the desk flag gone.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = p_user_id AND lower(u.email) = lower(p_email)
       AND coalesce(u.raw_app_meta_data ->> 'desk_registered', 'false') <> 'true'
  ) THEN
    RAISE EXCEPTION 'not_taken_over' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.consent_versions v
     WHERE v.consent_type = 'data_processing' AND v.version = p_consent_version
       AND lower(v.body_sha256) = lower(p_consent_sha)
  ) THEN
    RAISE EXCEPTION 'consent_mismatch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.desk_claim_codes
     SET claimed_at = now(), claim_permit_until = NULL,
         claim_consent_version = p_consent_version, claim_consent_sha256 = lower(p_consent_sha)
   WHERE patient_user_id = p_user_id;

  -- The person's own acceptance. Under the notice the desk recorded, the desk's row stands (one row per version)
  -- and the acceptance is the claim row above; under a newer notice it is a row of its own.
  INSERT INTO public.consent_records (user_id, consent_type, version, consent_text_sha256, accepted_at,
                                      accepted_ip, accepted_user_agent)
  VALUES (p_user_id, 'data_processing', p_consent_version, lower(p_consent_sha), now(),
          nullif(p_ip, '')::inet, p_user_agent)
  ON CONFLICT (user_id, consent_type, version) DO NOTHING;

  UPDATE public.users SET email = lower(p_email) WHERE id = p_user_id;

  SELECT patient_code INTO v_code FROM public.patient_profiles WHERE id = p_user_id;
  INSERT INTO public.sa_audit_log (
    actor_id, action, target_kind, target_id, reason, ip_address, user_agent, after_data
  ) VALUES (
    p_user_id, 'claim_desk_record', 'patient_profile', p_user_id::text,
    'The patient took over the record the desk registered.', nullif(p_ip, '')::inet, p_user_agent,
    jsonb_build_object('hospital_id', v_hospital, 'patient_code', v_code, 'consent_version', p_consent_version)
  );
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.desk_issue_claim_code(uuid, uuid, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desk_claim_begin(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desk_claim_finish(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_issue_claim_code(uuid, uuid, text, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.desk_claim_begin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.desk_claim_finish(uuid, text, text, text, text, text) TO service_role;

-- ─── 5. No credential on a desk record, except through a claim ───────
CREATE OR REPLACE FUNCTION public.desk_record_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.raw_app_meta_data ->> 'desk_registered' = 'true'
     AND (NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
          OR NEW.email IS DISTINCT FROM OLD.email
          OR NEW.phone IS DISTINCT FROM OLD.phone
          OR NEW.raw_app_meta_data ->> 'desk_registered' IS DISTINCT FROM 'true')
     AND NOT EXISTS (
       SELECT 1 FROM public.desk_claim_codes c
        WHERE c.patient_user_id = OLD.id AND c.claimed_at IS NULL AND c.claim_permit_until > now())
  THEN
    RAISE EXCEPTION 'desk_record_locked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.desk_record_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS desk_record_guard ON auth.users;
CREATE TRIGGER desk_record_guard
  BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.desk_record_guard();

-- ─── 6. Audit verbs (0291's list verbatim + the two) ─────────────────
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
    'issue_claim_code', 'claim_desk_record'
  )
);
