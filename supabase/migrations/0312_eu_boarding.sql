-- GATED — applied by the owner (`npm run db:migrate`), never auto-run; after 0311.
-- 0312: boarding, admit from the EU and keep the EU space until the ward's Arrived (ADR 0542).
--
--   1. bed_assignments: one Occupied plus one Arriving place per patient. 0090's one-open-per-patient index is
--      replaced by bed_assignments_one_occupied_per_patient (arrived, or a direct assignment with no admission
--      and no stay) and bed_assignments_one_arriving_per_patient (not arrived, for an admission or a stay). The
--      new indexes are created before the old one is dropped, so uniqueness never lapses; every live row already
--      satisfies them (the old index allowed one open row per patient). This changes live indexes on a table in
--      production use; proven over live-shaped rows on the PGlite lane (tests/emr-db/eu-boarding-index.test.ts).
--   2. Admit from the EU (a boarder, a patient with an open stay here), each function redefined from its newest
--      body (0091 or 0311) with only these changes:
--      - bed_assignments_guard (R61): an insert takes a per-patient advisory lock and is refused while the patient
--        has another open row, unless the two are the boarding pair (an Occupied space of the open stay and an
--        Arriving ward bed for the admission that stay boards for).
--      - admissions_guard: a boarder's admission is inserted with its inpatient record (D6); the record is stamped
--        once and never changes.
--      - admit_from_encounter: an EU is not a ward to admit to; a boarder keeps their EU space, which must be
--        arrived before a ward bed is held, and is admitted only from the stay's own visit; their inpatient record
--        opens now; the stay is stamped with the admission before the ward bed and the close.
--      - allocate_admission_bed: a boarder on the waiting list keeps the EU space (arrived) when given a ward bed.
--      - confirm_bed_arrival: lock order encounter → stay → assignment; a boarder's Arrived (open stay only) ends
--        the EU space ('Arrived on <ward>') and the stay (admitted) before the ward arrival is stamped, and reuses
--        the inpatient record. release_admission_bed is unchanged: an ended admission leaves the boarder in the EU.
--      - move_eu_space: a boarder's Arriving ward bed is not "already in a bed".
--      - encounters_eu_stay_close_guard: a boarder's inpatient record, while the stay is open, completes only
--        through end_eu_stay.
--      - end_eu_stay (R62): a boarder who leaves the EU before reaching the ward (died, home, ...) has their open
--        admission cancelled and its Arriving ward bed ended in the same transaction (visit → stay → admission →
--        assignment), so the ward cannot arrive them later.
--
-- ADDITIVE and re-runnable.
-- Reverse (section 1): with at most one open assignment per patient, recreate 0090's
-- bed_assignments_one_open_per_patient, then drop the two indexes of section 1.
-- Reverse (section 2): recreate the functions of section 2 from 0311 (guard, confirm_bed_arrival, move_eu_space,
-- close guard, end_eu_stay) and 0091 (admissions_guard, admit_from_encounter, allocate_admission_bed).

-- ─── 1. One Occupied plus one Arriving per patient ───────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS bed_assignments_one_occupied_per_patient
  ON public.bed_assignments (patient_user_id)
  WHERE ended_at IS NULL AND (arrived_at IS NOT NULL OR (admission_id IS NULL AND eu_stay_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS bed_assignments_one_arriving_per_patient
  ON public.bed_assignments (patient_user_id)
  WHERE ended_at IS NULL AND arrived_at IS NULL AND (admission_id IS NOT NULL OR eu_stay_id IS NOT NULL);
DROP INDEX IF EXISTS public.bed_assignments_one_open_per_patient;

-- ─── 2. Admit from the EU: boarding (D6), and the ward's Arrived ends the stay ─
-- Lock order as 0311: encounter → stay → assignment (then the bed, in admission_free_bed).

-- 0311's guard, plus (R61): one open bed per patient, or the boarding pair. The two indexes of section 1 each see
-- one kind of row, so two paths inserting at once could each pass one; the per-patient advisory lock serialises
-- them and the check sees the other's committed row.
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
    IF NEW.eu_stay_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.eu_stays s
          WHERE s.id = NEW.eu_stay_id AND s.patient_user_id = NEW.patient_user_id
            AND s.hospital_id = NEW.hospital_id) THEN
      RAISE EXCEPTION 'An EU space is for its stay''s patient, at its hospital' USING ERRCODE = 'check_violation';
    END IF;
    -- The boarding pair: an Occupied space of the patient's open stay and an Arriving ward bed for the admission
    -- that stay boards for. Every other open row of the patient must pair with this one.
    PERFORM pg_advisory_xact_lock(hashtext(NEW.patient_user_id::text));
    IF EXISTS (
         SELECT 1 FROM public.bed_assignments a
          WHERE a.patient_user_id = NEW.patient_user_id AND a.ended_at IS NULL
            AND NOT EXISTS (
                  SELECT 1 FROM public.eu_stays s
                   WHERE s.patient_user_id = NEW.patient_user_id AND s.status <> 'ended'
                     AND s.admission_id IS NOT NULL
                     AND ((a.eu_stay_id = s.id AND a.arrived_at IS NOT NULL
                           AND NEW.admission_id = s.admission_id AND NEW.arrived_at IS NULL)
                       OR (a.admission_id = s.admission_id AND a.arrived_at IS NULL
                           AND NEW.eu_stay_id = s.id AND NEW.arrived_at IS NOT NULL)))) THEN
      RAISE EXCEPTION 'A patient holds one open bed, or their EU space and the ward bed they board for'
        USING ERRCODE = 'unique_violation';
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

-- 0091's guard, plus D6: a boarder's admission is inserted with its inpatient record (only while the patient has
-- an open stay here); the record is stamped once, at insert or with the move to arrived, and never changes.
CREATE OR REPLACE FUNCTION public.admissions_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  moving text[] := ARRAY['status', 'inpatient_encounter_id', 'arrived_at', 'arrived_by', 'cancelled_at',
                         'cancelled_by', 'cancel_reason', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only a cascade from the hospital or patient row removes one (pg_trigger_depth() > 1).
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'An admission is kept for good' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('awaiting_bed', 'bed_allocated') OR NEW.arrived_at IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL
       OR (NEW.inpatient_encounter_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.eu_stays s
              WHERE s.patient_user_id = NEW.patient_user_id AND s.hospital_id = NEW.hospital_id
                AND s.status <> 'ended')) THEN
      RAISE EXCEPTION 'An admission starts waiting for a bed or with a bed allocated'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - moving) <> (to_jsonb(OLD) - moving) THEN
    RAISE EXCEPTION 'Only an admission''s status moves' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.inpatient_encounter_id IS NOT NULL
     AND NEW.inpatient_encounter_id IS DISTINCT FROM OLD.inpatient_encounter_id THEN
    RAISE EXCEPTION 'The inpatient record is stamped once' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((OLD.status, NEW.status) IN (('awaiting_bed', 'bed_allocated'), ('awaiting_bed', 'cancelled'),
          ('bed_allocated', 'awaiting_bed'), ('bed_allocated', 'arrived'), ('bed_allocated', 'cancelled'))) THEN
    RAISE EXCEPTION 'An admission cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.status <> 'arrived' AND (NEW.arrived_at IS NOT NULL
        OR NEW.inpatient_encounter_id IS DISTINCT FROM OLD.inpatient_encounter_id))
     OR (NEW.status <> 'cancelled' AND NEW.cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Arrival and cancellation are stamped with their own move'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 0091's admit_from_encounter, plus: an EU is not a ward to admit to; a patient with an open stay here (a boarder)
-- keeps their own EU space, which must be arrived before a ward bed is held, and is admitted only from the stay's
-- own visit (or any visit, for a triage stay); a boarder's inpatient record opens now (D6) and the stay is stamped
-- with the admission before the ward bed and the close. Payload as 0091.
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
  IF v_stay.encounter_id <> v_enc.id THEN
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

-- 0091's allocate_admission_bed, plus: a boarder on the waiting list keeps the EU space of the stay that boards for
-- this admission, which must be arrived before a ward bed is held.
CREATE OR REPLACE FUNCTION public.allocate_admission_bed(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_adm public.admissions%ROWTYPE;
  v_label text;
  v_asg uuid;
BEGIN
  SELECT * INTO v_adm FROM public.admissions
   WHERE id = (p->>'admission_id')::uuid AND hospital_id = (p->>'hospital_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AD404 That admission is not at this hospital.';
  END IF;
  IF v_adm.status <> 'awaiting_bed' THEN
    RAISE EXCEPTION 'AD409 This patient is no longer waiting for a bed.';
  END IF;
  v_label := public.admission_free_bed(v_adm.hospital_id, v_adm.ward_id, (p->>'bed_id')::uuid);
  IF EXISTS (SELECT 1 FROM public.bed_assignments a
              WHERE a.patient_user_id = v_adm.patient_user_id AND a.ended_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.eu_stays s
                                 WHERE s.id = a.eu_stay_id AND s.admission_id = v_adm.id)) THEN
    RAISE EXCEPTION 'AD409 This patient is already in a bed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bed_assignments a JOIN public.eu_stays s ON s.id = a.eu_stay_id
              WHERE s.admission_id = v_adm.id AND a.ended_at IS NULL AND a.arrived_at IS NULL) THEN
    RAISE EXCEPTION 'AD409 Mark the patient as arrived in the EU first.';
  END IF;
  INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, encounter_id, admission_id,
                                      started_by)
  VALUES (v_adm.hospital_id, v_adm.ward_id, (p->>'bed_id')::uuid, v_adm.patient_user_id, v_adm.source_encounter_id,
          v_adm.id, (p->>'actor')::uuid)
  RETURNING id INTO v_asg;
  UPDATE public.admissions SET status = 'bed_allocated' WHERE id = v_adm.id;
  RETURN jsonb_build_object('assignment_id', v_asg, 'bed', v_label);
END;
$$;

-- 0311's confirm_bed_arrival, plus: the stay's encounter is locked first (encounter → stay → assignment), and a
-- boarder's ward Arrived first ends their EU space ('Arrived on <ward>') and the stay (admitted, stamped with the
-- admission in that same update), then stamps the ward arrival (the Occupied index), reusing the inpatient record
-- opened at admission. Payload: hospital_id, assignment_id, actor.
CREATE OR REPLACE FUNCTION public.confirm_bed_arrival(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := (p->>'actor')::uuid;
  v_asg public.bed_assignments%ROWTYPE;
  v_adm public.admissions%ROWTYPE;
  v_stay uuid;
  v_dept uuid;
  v_ward text;
  v_enc uuid;
  v_ended integer;
BEGIN
  -- The stay: an EU space's own, or the one that boards for this ward bed's admission; neither link ever changes,
  -- so this read holds.
  SELECT coalesce(a.eu_stay_id, s.id) INTO v_stay
    FROM public.bed_assignments a
    LEFT JOIN public.eu_stays s ON s.admission_id = a.admission_id AND s.status <> 'ended'
   WHERE a.id = (p->>'assignment_id')::uuid;
  PERFORM 1 FROM public.encounters
   WHERE id = (SELECT encounter_id FROM public.eu_stays WHERE id = v_stay)
   FOR UPDATE;
  PERFORM 1 FROM public.eu_stays WHERE id = v_stay FOR UPDATE;
  -- Locked now, so the checks below see the space's current state.
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
  SELECT department_id, name INTO v_dept, v_ward FROM public.hospital_wards WHERE id = v_adm.ward_id;

  -- A boarder: the EU space and the stay end before the ward bed is Occupied.
  IF v_stay IS NOT NULL THEN
    UPDATE public.bed_assignments SET ended_at = now(), ended_by = v_actor, reason = 'Arrived on ' || v_ward
     WHERE eu_stay_id = v_stay AND ended_at IS NULL;
    UPDATE public.eu_stays
       SET status = 'ended', ended_at = now(), ended_by = v_actor, end_kind = 'admitted', admission_id = v_adm.id
     WHERE id = v_stay AND status <> 'ended';
  END IF;

  -- The stay's encounter: one per admission (the guard stamps inpatient_encounter_id once); a boarder's is open.
  v_enc := v_adm.inpatient_encounter_id;
  IF v_enc IS NULL THEN
    INSERT INTO public.encounters (hospital_id, patient_user_id, clinician_user_id, department_id, state,
                                   encounter_type, started_at, last_activity_at)
    VALUES (v_adm.hospital_id, v_adm.patient_user_id, v_adm.decided_by, v_dept, 'in_progress', 'inpatient', now(),
            now())
    RETURNING id INTO v_enc;
  END IF;
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

-- 0311's move_eu_space, plus: a boarder's Arriving ward bed is not "another bed" (the new space starts Occupied,
-- as the stay is arrived or waiting, so the pair holds).
CREATE OR REPLACE FUNCTION public.move_eu_space(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := (p->>'actor')::uuid;
  v_bed uuid := nullif(p->>'bed_id', '')::uuid;
  v_reason text := CASE WHEN nullif(p->>'bed_id', '') IS NULL THEN nullif(p->>'space_wait_reason', '') END;
  v_note text := CASE WHEN nullif(p->>'bed_id', '') IS NULL THEN nullif(p->>'space_wait_note_ciphertext', '') END;
  v_stay public.eu_stays%ROWTYPE;
  v_ward public.hospital_wards%ROWTYPE;
  v_cur public.bed_assignments%ROWTYPE;
  v_label text;
  v_asg uuid;
  v_here boolean;
BEGIN
  -- The stay's encounter first (the lock order above). Stamped once: if adoption stamps it while we wait for the
  -- stay, that adoption has committed and nothing else is held, so we go on without it.
  PERFORM 1 FROM public.encounters
   WHERE id = (SELECT encounter_id FROM public.eu_stays WHERE id = (p->>'stay_id')::uuid)
   FOR UPDATE;
  SELECT * INTO v_stay FROM public.eu_stays
   WHERE id = (p->>'stay_id')::uuid AND hospital_id = (p->>'hospital_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EU404 That stay is not at this hospital.'
      USING ERRCODE = 'check_violation', HINT = 'eu_stay_not_found';
  END IF;
  IF v_stay.status = 'ended' THEN
    RAISE EXCEPTION 'EU409 This stay has ended.' USING ERRCODE = 'check_violation', HINT = 'eu_stay_ended';
  END IF;
  SELECT * INTO v_ward FROM public.hospital_wards
   WHERE id = coalesce(nullif(p->>'ward_id', '')::uuid, v_stay.ward_id) AND hospital_id = v_stay.hospital_id;
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

  SELECT * INTO v_cur FROM public.bed_assignments
   WHERE eu_stay_id = v_stay.id AND ended_at IS NULL FOR UPDATE;
  IF v_bed IS NOT NULL THEN
    v_label := public.admission_free_bed(v_stay.hospital_id, v_ward.id, v_bed);
    IF EXISTS (SELECT 1 FROM public.bed_assignments
                WHERE patient_user_id = v_stay.patient_user_id AND ended_at IS NULL
                  AND id IS DISTINCT FROM v_cur.id
                  AND (admission_id = v_stay.admission_id) IS NOT TRUE) THEN
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
  v_here := v_bed IS NOT NULL AND (v_stay.arrived_at IS NOT NULL OR v_stay.status = 'awaiting_space');
  IF v_bed IS NOT NULL THEN
    INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, encounter_id, eu_stay_id,
                                        started_by, arrived_at, arrived_by)
    VALUES (v_stay.hospital_id, v_ward.id, v_bed, v_stay.patient_user_id, v_stay.encounter_id, v_stay.id, v_actor,
            CASE WHEN v_here THEN now() END, CASE WHEN v_here THEN v_actor END)
    RETURNING id INTO v_asg;
  END IF;
  UPDATE public.eu_stays
     SET ward_id = v_ward.id,
         status = CASE WHEN v_bed IS NULL THEN 'awaiting_space' ELSE 'in_space' END,
         space_wait_reason = v_reason, space_wait_note_ciphertext = v_note,
         arrived_at = coalesce(arrived_at, CASE WHEN v_here THEN now() END),
         arrived_by = coalesce(arrived_by, CASE WHEN v_here THEN v_actor END)
   WHERE id = v_stay.id;
  RETURN jsonb_build_object('stay_id', v_stay.id, 'assignment_id', v_asg, 'bed', v_label);
END;
$$;

-- 0311's encounters_eu_stay_close_guard, plus: a boarder's inpatient record, while their stay is open (an admission
-- ended before arrival), also completes only through end_eu_stay (its second arm), never leaving the stay open.
CREATE OR REPLACE FUNCTION public.encounters_eu_stay_close_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF NEW.state = 'completed' AND OLD.state IS DISTINCT FROM 'completed'
     AND (EXISTS (SELECT 1 FROM public.eu_stays
                   WHERE encounter_id = NEW.id AND status <> 'ended' AND admission_id IS NULL)
          OR EXISTS (SELECT 1 FROM public.eu_stays s JOIN public.admissions a ON a.id = s.admission_id
                      WHERE s.patient_user_id = NEW.patient_user_id AND s.status <> 'ended'
                        AND a.inpatient_encounter_id = NEW.id)) THEN
    RAISE EXCEPTION 'EU409 This patient is in the emergency unit. Close the visit with an outcome; that ends the EU stay.'
      USING ERRCODE = 'check_violation', HINT = 'eu_close_with_outcome';
  END IF;
  RETURN NEW;
END;
$$;

-- 0311's end_eu_stay, plus (R62): a boarder who leaves the EU (died, home, ...) before reaching the ward ends their
-- open admission and its Arriving ward bed in the same transaction, so no bed is held and the ward cannot "arrive"
-- them later. Lock order: visit → stay → admission → assignment.
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
     AND (encounter_id = v_enc.id OR encounter_id IS NULL
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
