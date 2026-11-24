-- GATED — applied by the owner (`npm run db:migrate`), never auto-run.
-- 0311: the EU stay, observation that keeps the visit open (ADR 0541).
--
--   1. eu_stays: one row per stay in an emergency observation ward (EU), from the decision to the end; one open
--      per patient. A doctor's stay names its encounter; a triage nurse's names the intake (the encounter is
--      stamped later). awaiting_space ↔ in_space, then ended, once.
--   2. eu_stays_guard: never deleted (a cascade from the hospital or patient row aside); a stay starts open, not
--      arrived, with no admission; only its status, space, arrival, responsible clinician and end move; the
--      encounter, the arrival and the admission are stamped once; an ended stay never changes. updated_at, row
--      audit, and the PHI-free ward-beds:<hospital> broadcast (0090's function).
--   3. bed_assignments.eu_stay_id: an assignment serves an admission or a stay, never both
--      (bed_assignments_one_purpose_check). An EU assignment may be arrived (bed_assignments_arrival_check), and
--      bed_assignments_guard (0091's body) lets an insert for a stay come arrived: a move inside the EU.
--   4. RLS: enabled and forced; clients read only (as admissions_select_scoped), never write; mfa_gate.
--   5. observe_in_eu (send to the EU, the visit stays open) and confirm_bed_arrival widened to an EU space.
--   6. move_eu_space and end_eu_stay (the stay ends with the close of its own encounter).
--   7. Audit verbs and grants: the functions run on the service role only.
--
-- ADDITIVE and re-runnable.
-- Reverse: drop bed_assignments.eu_stay_id (and its check), restore 0091's arrival check and guard; drop eu_stays.

-- ─── 1. eu_stays ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eu_stays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encounter_id uuid REFERENCES public.encounters(id),
  intake_id uuid REFERENCES public.patient_intakes(id),
  ward_id uuid NOT NULL REFERENCES public.hospital_wards(id),
  started_by_kind text NOT NULL,
  decided_by uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  responsible_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_space',
  space_wait_reason text,
  space_wait_note_ciphertext text,
  arrived_at timestamptz,
  arrived_by uuid,
  ended_at timestamptz,
  ended_by uuid,
  end_kind text,
  admission_id uuid REFERENCES public.admissions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eu_stays_started_by_kind_check CHECK (started_by_kind IN ('doctor', 'triage_nurse')),
  CONSTRAINT eu_stays_status_check CHECK (status IN ('awaiting_space', 'in_space', 'ended')),
  CONSTRAINT eu_stays_wait_reason_check CHECK (
    space_wait_reason IS NULL OR space_wait_reason IN ('no_free_bed', 'extra_bed', 'floor', 'other')),
  CONSTRAINT eu_stays_end_kind_check CHECK (
    end_kind IS NULL OR end_kind IN ('admitted', 'home', 'referred_out', 'transferred', 'theatre', 'died',
                                     'left_before_completion', 'left_against_advice')),
  CONSTRAINT eu_stays_who_check CHECK (
    encounter_id IS NOT NULL OR (started_by_kind = 'triage_nurse' AND intake_id IS NOT NULL)),
  CONSTRAINT eu_stays_arrival_check CHECK ((arrived_at IS NULL) = (arrived_by IS NULL)),
  CONSTRAINT eu_stays_end_check CHECK (
    (status = 'ended') = (ended_at IS NOT NULL)
    AND (ended_at IS NULL) = (ended_by IS NULL)
    AND (ended_at IS NULL) = (end_kind IS NULL)),
  CONSTRAINT eu_stays_wait_note_check CHECK (
    space_wait_reason IS DISTINCT FROM 'other' OR space_wait_note_ciphertext IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS eu_stays_one_open_per_patient
  ON public.eu_stays (patient_user_id) WHERE status <> 'ended';
CREATE INDEX IF NOT EXISTS eu_stays_ward_status_idx ON public.eu_stays (ward_id, status);
CREATE INDEX IF NOT EXISTS eu_stays_hospital_decided_idx ON public.eu_stays (hospital_id, decided_at);

-- ─── 2. The guard, updated_at, audit and the board ───────────────────────
CREATE OR REPLACE FUNCTION public.eu_stays_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  moving text[] := ARRAY['status', 'space_wait_reason', 'space_wait_note_ciphertext', 'ward_id', 'arrived_at',
                         'arrived_by', 'responsible_user_id', 'ended_at', 'ended_by', 'end_kind', 'encounter_id',
                         'admission_id', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only a cascade from the hospital or patient row removes one (pg_trigger_depth() > 1), as admissions_guard.
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'An EU stay is kept for good' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('awaiting_space', 'in_space') OR NEW.arrived_at IS NOT NULL
       OR NEW.ended_at IS NOT NULL OR NEW.admission_id IS NOT NULL THEN
      RAISE EXCEPTION 'An EU stay starts open, not arrived, with no admission' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'ended' THEN
    RAISE EXCEPTION 'An ended stay never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - moving) <> (to_jsonb(OLD) - moving) THEN
    RAISE EXCEPTION 'Only an EU stay''s status, space, arrival, responsible clinician and end move'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.encounter_id IS NOT NULL AND NEW.encounter_id IS DISTINCT FROM OLD.encounter_id)
     OR (OLD.arrived_at IS NOT NULL AND (NEW.arrived_at, NEW.arrived_by) IS DISTINCT FROM (OLD.arrived_at, OLD.arrived_by))
     OR (OLD.admission_id IS NOT NULL AND NEW.admission_id IS DISTINCT FROM OLD.admission_id) THEN
    RAISE EXCEPTION 'Encounter, arrival and admission are stamped once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (('awaiting_space', 'in_space'),
     ('in_space', 'awaiting_space'), ('awaiting_space', 'ended'), ('in_space', 'ended'))) THEN
    RAISE EXCEPTION 'An EU stay cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS eu_stays_guard ON public.eu_stays;
CREATE TRIGGER eu_stays_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.eu_stays
  FOR EACH ROW EXECUTE FUNCTION public.eu_stays_guard();
DROP TRIGGER IF EXISTS eu_stays_updated_at ON public.eu_stays;
CREATE TRIGGER eu_stays_updated_at BEFORE UPDATE ON public.eu_stays
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_eu_stays ON public.eu_stays;
CREATE TRIGGER audit_eu_stays AFTER INSERT OR UPDATE OR DELETE ON public.eu_stays
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
-- The board hears a stay start, move, arrive and end (0090's function: PHI-free, ward and hospital only).
DROP TRIGGER IF EXISTS ward_beds_broadcast ON public.eu_stays;
CREATE TRIGGER ward_beds_broadcast AFTER INSERT OR UPDATE OF status, arrived_at, ended_at, ward_id ON public.eu_stays
  FOR EACH ROW EXECUTE FUNCTION public.ward_beds_broadcast();

-- ─── 3. bed_assignments: the stay a space serves ─────────────────────────
ALTER TABLE public.bed_assignments ADD COLUMN IF NOT EXISTS eu_stay_id uuid REFERENCES public.eu_stays(id);
CREATE INDEX IF NOT EXISTS bed_assignments_eu_stay_idx
  ON public.bed_assignments (eu_stay_id) WHERE eu_stay_id IS NOT NULL;
ALTER TABLE public.bed_assignments DROP CONSTRAINT IF EXISTS bed_assignments_arrival_check;
ALTER TABLE public.bed_assignments ADD CONSTRAINT bed_assignments_arrival_check CHECK (
  (arrived_at IS NULL) = (arrived_by IS NULL)
  AND (arrived_at IS NULL OR admission_id IS NOT NULL OR eu_stay_id IS NOT NULL));
ALTER TABLE public.bed_assignments DROP CONSTRAINT IF EXISTS bed_assignments_one_purpose_check;
ALTER TABLE public.bed_assignments ADD CONSTRAINT bed_assignments_one_purpose_check CHECK (
  NOT (admission_id IS NOT NULL AND eu_stay_id IS NOT NULL));

-- 0091's guard, plus: an insert for an EU stay may come arrived (a move inside the EU).
CREATE OR REPLACE FUNCTION public.bed_assignments_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  moving text[] := ARRAY['ended_at', 'ended_by', 'reason', 'arrived_at', 'arrived_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only a cascade from the bed, ward or hospital row removes one (pg_trigger_depth() > 1).
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'A bed assignment is kept for good' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.ended_at IS NOT NULL OR (NEW.arrived_at IS NOT NULL AND NEW.eu_stay_id IS NULL) THEN
      RAISE EXCEPTION 'A bed assignment starts open' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.hospital_beds b
                    WHERE b.id = NEW.bed_id AND b.ward_id = NEW.ward_id AND b.hospital_id = NEW.hospital_id
                      AND b.archived_at IS NULL AND b.closed_at IS NULL) THEN
      RAISE EXCEPTION 'Bed % is not an open bed of ward %', NEW.bed_id, NEW.ward_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.ended_at IS NOT NULL
     OR (to_jsonb(NEW) - moving) <> (to_jsonb(OLD) - moving)
     OR (OLD.arrived_at IS NOT NULL AND NEW.arrived_at IS DISTINCT FROM OLD.arrived_at) THEN
    RAISE EXCEPTION 'A bed assignment only ends, once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. RLS: read as admissions, never written by a client ───────────────
ALTER TABLE public.eu_stays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eu_stays FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.eu_stays FROM anon, authenticated;
GRANT SELECT ON public.eu_stays TO authenticated;
-- A stay names a patient: admins, superadmins and active clinical staff of the hospital (as admissions).
DROP POLICY IF EXISTS eu_stays_select_scoped ON public.eu_stays;
CREATE POLICY eu_stays_select_scoped ON public.eu_stays FOR SELECT TO authenticated USING (
  public.user_has_role('superadmin') OR public.user_has_role('hospital_admin', hospital_id)
  OR public.is_active_clinical_staff(hospital_id));
-- 0288's rule for every RLS table created after it (tests/auth/mfa-below-pages.test.ts).
DROP POLICY IF EXISTS mfa_gate ON public.eu_stays;
CREATE POLICY mfa_gate ON public.eu_stays AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));

-- ─── 5. observe_in_eu, and Arrived for an EU space (service role only) ───
-- Refusals the user can act on start "EU4xx " (the Edge Function returns the words after the code), raised as
-- check_violation with a HINT the app can map; admission_free_bed's "AD409 " words pass through unchanged.

-- Send to the EU: the visit stays open (ADR 0541). Payload: encounter_id, actor, ward_id, bed_id?,
-- space_wait_reason?, space_wait_note_ciphertext?. An open triage stay of the patient's is adopted.
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
  IF FOUND AND (v_stay.encounter_id IS NOT NULL OR v_stay.hospital_id <> v_enc.hospital_id) THEN
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
         SET encounter_id = v_enc.id, ward_id = v_ward.id,
             status = CASE WHEN v_bed IS NULL THEN 'awaiting_space' ELSE 'in_space' END,
             space_wait_reason = v_reason, space_wait_note_ciphertext = v_note,
             arrived_at = coalesce(arrived_at, CASE WHEN v_bed IS NOT NULL AND v_here THEN now() END),
             arrived_by = coalesce(arrived_by, CASE WHEN v_bed IS NOT NULL AND v_here THEN v_actor END)
       WHERE id = v_stay.id;
    ELSE
      v_asg := v_cur.id;
      SELECT label INTO v_label FROM public.hospital_beds WHERE id = v_cur.bed_id;
      UPDATE public.eu_stays SET encounter_id = v_enc.id WHERE id = v_stay.id;
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

-- 0091's confirm_bed_arrival, plus: Arrived on an EU space stamps the space and the stay (no encounter opens,
-- no nursing ends). Payload: hospital_id, assignment_id, actor.
CREATE OR REPLACE FUNCTION public.confirm_bed_arrival(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := (p->>'actor')::uuid;
  v_asg public.bed_assignments%ROWTYPE;
  v_adm public.admissions%ROWTYPE;
  v_dept uuid;
  v_enc uuid;
  v_ended integer;
BEGIN
  SELECT * INTO v_asg FROM public.bed_assignments
   WHERE id = (p->>'assignment_id')::uuid AND hospital_id = (p->>'hospital_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AD404 That bed assignment is not at this hospital.';
  END IF;
  IF v_asg.ended_at IS NOT NULL OR (v_asg.admission_id IS NULL AND v_asg.eu_stay_id IS NULL)
     OR v_asg.arrived_at IS NOT NULL THEN
    RAISE EXCEPTION 'AD409 Nobody is arriving in this bed.';
  END IF;
  IF v_asg.eu_stay_id IS NOT NULL THEN
    UPDATE public.bed_assignments SET arrived_at = now(), arrived_by = v_actor WHERE id = v_asg.id;
    UPDATE public.eu_stays
       SET arrived_at = coalesce(arrived_at, now()), arrived_by = coalesce(arrived_by, v_actor), status = 'in_space'
     WHERE id = v_asg.eu_stay_id;
    RETURN jsonb_build_object('stay_id', v_asg.eu_stay_id, 'eu', true);
  END IF;
  SELECT * INTO v_adm FROM public.admissions WHERE id = v_asg.admission_id FOR UPDATE;
  IF v_adm.status <> 'bed_allocated' THEN
    RAISE EXCEPTION 'AD409 This admission is not waiting for arrival.';
  END IF;
  SELECT department_id INTO v_dept FROM public.hospital_wards WHERE id = v_adm.ward_id;

  -- The stay's encounter: one per admission (the guard stamps inpatient_encounter_id once).
  INSERT INTO public.encounters (hospital_id, patient_user_id, clinician_user_id, department_id, state,
                                 encounter_type, started_at, last_activity_at)
  VALUES (v_adm.hospital_id, v_adm.patient_user_id, v_adm.decided_by, v_dept, 'in_progress', 'inpatient', now(),
          now())
  RETURNING id INTO v_enc;
  UPDATE public.bed_assignments SET arrived_at = now(), arrived_by = v_actor WHERE id = v_asg.id;
  UPDATE public.admissions
     SET status = 'arrived', arrived_at = now(), arrived_by = v_actor, inpatient_encounter_id = v_enc
   WHERE id = v_adm.id;
  -- Nursing elsewhere (EU, another ward) ends now that the ward has the patient.
  UPDATE public.nursing_assignments SET ends_at = now()
   WHERE patient_user_id = v_adm.patient_user_id AND hospital_id = v_adm.hospital_id
     AND (ends_at IS NULL OR ends_at > now()) AND ward_id IS DISTINCT FROM v_adm.ward_id;
  GET DIAGNOSTICS v_ended = ROW_COUNT;
  RETURN jsonb_build_object('inpatient_encounter_id', v_enc, 'admission_id', v_adm.id,
                            'nursing_ended', v_ended);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['observe_in_eu(jsonb)', 'confirm_bed_arrival(jsonb)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
