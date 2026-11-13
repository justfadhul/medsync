-- GATED — applied by the owner (`npm run db:migrate`), never auto-run.
-- 0294: the Tether reception desk's engine gaps (ADRs 0485–0489, docs/reception/gate-a-proposal.md §3).
-- New tables are written and read only by service-role Edge Functions and server loaders after the reception
-- scope check: RLS on with no client policy (deny), plus the MFA gate. No clinical-note columns anywhere here.

-- ─── 1. Idempotent check-in (RD10, ADR 0488) ──────────────────────────
ALTER TABLE public.patient_intakes
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS device_label text CHECK (device_label IS NULL OR length(device_label) <= 60);
CREATE UNIQUE INDEX IF NOT EXISTS patient_intakes_hospital_client_id_unique
  ON public.patient_intakes (hospital_id, client_id) WHERE client_id IS NOT NULL;

-- ─── 2. Identity to confirm (walk-in or new caller not yet checked in person) ──
ALTER TABLE public.patient_profiles
  ADD COLUMN IF NOT EXISTS identity_to_confirm boolean NOT NULL DEFAULT false;

-- ─── 3. Identity attempts (RD5, ADR 0486): method and result only, never the answer ──
CREATE TABLE IF NOT EXISTS public.desk_identity_attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  appointment_id   uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  method           text NOT NULL CHECK (method IN ('yob', 'phone3', 'photo')),
  matched          boolean NOT NULL,
  attempt_no       smallint NOT NULL CHECK (attempt_no BETWEEN 1 AND 10),
  by_user_id       uuid NOT NULL REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS desk_identity_attempts_appt ON public.desk_identity_attempts (appointment_id, created_at DESC);
ALTER TABLE public.desk_identity_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_identity_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_gate ON public.desk_identity_attempts;
CREATE POLICY mfa_gate ON public.desk_identity_attempts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));
-- Append-only: no client policy; service role never updates or deletes (no grant).
REVOKE UPDATE, DELETE ON public.desk_identity_attempts FROM PUBLIC, anon, authenticated, service_role;

-- ─── 4. A pre-alert is acknowledged before it can arrive (D-RD-19) ──────
CREATE OR REPLACE FUNCTION public.pre_arrival_ack_guard()
  RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.arrived_at IS NOT NULL AND NEW.acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'pre_alert_not_acknowledged' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pre_arrival_ack_guard ON public.emergency_pre_arrivals;
CREATE TRIGGER pre_arrival_ack_guard
  BEFORE INSERT OR UPDATE ON public.emergency_pre_arrivals
  FOR EACH ROW EXECUTE FUNCTION public.pre_arrival_ack_guard();

-- ─── 5. Close the day (D-RD-12): reversible the same day ─────────────────
CREATE TABLE IF NOT EXISTS public.desk_day_closures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  service_date     date NOT NULL,
  appointment_ids  uuid[] NOT NULL DEFAULT '{}',
  closed_by        uuid NOT NULL REFERENCES auth.users(id),
  closed_at        timestamptz NOT NULL DEFAULT now(),
  undone_by        uuid REFERENCES auth.users(id),
  undone_at        timestamptz,
  CHECK ((undone_at IS NULL) = (undone_by IS NULL))
);
CREATE INDEX IF NOT EXISTS desk_day_closures_day ON public.desk_day_closures (hospital_id, service_date);
ALTER TABLE public.desk_day_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_day_closures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_gate ON public.desk_day_closures;
CREATE POLICY mfa_gate ON public.desk_day_closures AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));

-- ─── 6. Shared desk devices and PINs (D-RD-13, D-RD-20, ADR 0489) ─────────
CREATE TABLE IF NOT EXISTS public.desk_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id        uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  label              text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  mine_department_ids uuid[] NOT NULL DEFAULT '{}',
  created_by         uuid NOT NULL REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, label)
);
CREATE TABLE IF NOT EXISTS public.desk_pins (
  device_id     uuid NOT NULL REFERENCES public.desk_devices(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash      text NOT NULL CHECK (pin_hash LIKE '$2%'),
  failed_tries  smallint NOT NULL DEFAULT 0 CHECK (failed_tries BETWEEN 0 AND 5),
  set_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, user_id)
);
ALTER TABLE public.desk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.desk_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_pins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_gate ON public.desk_devices;
CREATE POLICY mfa_gate ON public.desk_devices AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));
DROP POLICY IF EXISTS mfa_gate ON public.desk_pins;
CREATE POLICY mfa_gate ON public.desk_pins AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));

-- PIN check in the database: the hash never leaves it. 5 wrong tries end the PIN (full sign-in to set a new one).
CREATE OR REPLACE FUNCTION public.desk_pin_check(p_device_id uuid, p_user_id uuid, p_pin text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE r public.desk_pins%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.desk_pins WHERE device_id = p_device_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'no_pin'; END IF;
  IF r.failed_tries >= 5 THEN RETURN 'locked'; END IF;
  IF r.pin_hash = crypt(p_pin, r.pin_hash) THEN
    UPDATE public.desk_pins SET failed_tries = 0 WHERE device_id = p_device_id AND user_id = p_user_id;
    RETURN 'ok';
  END IF;
  UPDATE public.desk_pins SET failed_tries = failed_tries + 1 WHERE device_id = p_device_id AND user_id = p_user_id;
  RETURN CASE WHEN r.failed_tries + 1 >= 5 THEN 'locked' ELSE 'wrong' END;
END;
$$;
CREATE OR REPLACE FUNCTION public.desk_pin_set(p_device_id uuid, p_user_id uuid, p_pin text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'pin_format' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.desk_pins (device_id, user_id, pin_hash)
  VALUES (p_device_id, p_user_id, crypt(p_pin, gen_salt('bf', 10)))
  ON CONFLICT (device_id, user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_tries = 0, set_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.desk_pin_check(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desk_pin_set(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_pin_check(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.desk_pin_set(uuid, uuid, text) TO service_role;

-- ─── 7. Audit verbs (0292's list verbatim + the desk's) ─────────────────
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
    'desk_identity_check', 'close_day', 'undo_close_day', 'desk_switch_user', 'desk_set_pin', 'desk_pin_locked'
  )
);
