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
