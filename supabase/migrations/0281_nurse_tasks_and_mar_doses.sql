-- 0281 — Nurse tasks and the medicine chart's Given / Withhold (prescribing kit P2 (b), F5).
--
-- GATED: owner-applied (`npm run db:migrate`), after 0279. Until it runs, PRESCRIBE_V2 stays off
-- (the Drizzle schema names these columns).
--
--   1. nurse_tasks: work for the nurses that a prescription (and later a protocol chart, P4) creates.
--      Generic on purpose: a type, what raised it (source kind + id), when it is due, a payload of
--      what the task needs, and the outcome once done. One way only: open → done | cancelled, then
--      the row is frozen (trigger); never deleted. The first type is "iv_cannula": an IV medicine
--      sent for a patient with no line recorded on this visit.
--   2. medication_administration_records (0031): a dose recorded against a prescription line is an
--      event. `client_key` makes a replay (the offline outbox) land once; `reverses_id` with state
--      'reversed' is the correction: a new row naming the one it undoes, with the reason, at most
--      once. The original stays.
--
-- RLS: nurse_tasks forced, the clinical reader's scoped SELECT (as 0089), no client writes: the
-- server writes as the owner, as every EMR table. ADDITIVE and re-runnable.
-- Reverse: drop the table, the trigger function, the two MAR columns and restore mar_state_check.

-- ─── 1. nurse_tasks ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nurse_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]{1,40}$'),
  source_kind text NOT NULL CHECK (source_kind IN ('prescription','order','protocol_chart','manual')),
  source_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  done_at timestamptz,
  done_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- What was done: {size, site, procedureId} for a cannula, {reportId} for a result, {reason} if cancelled.
  outcome jsonb,
  client_key text,
  CONSTRAINT nurse_tasks_closed CHECK (
    (status = 'open') = (done_at IS NULL AND done_by_user_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS nurse_tasks_client_key
  ON public.nurse_tasks (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS nurse_tasks_open
  ON public.nurse_tasks (hospital_id, status, due_at);
CREATE INDEX IF NOT EXISTS nurse_tasks_patient
  ON public.nurse_tasks (patient_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.nurse_tasks_one_way() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'nurse_tasks rows are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'a closed nurse task is frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.hospital_id, NEW.patient_user_id, NEW.encounter_id, NEW.type, NEW.source_kind,
      NEW.source_id, NEW.payload, NEW.due_at, NEW.created_at, NEW.created_by_user_id, NEW.client_key)
     IS DISTINCT FROM
     (OLD.hospital_id, OLD.patient_user_id, OLD.encounter_id, OLD.type, OLD.source_kind,
      OLD.source_id, OLD.payload, OLD.due_at, OLD.created_at, OLD.created_by_user_id, OLD.client_key) THEN
    RAISE EXCEPTION 'only the status and outcome of a nurse task change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS nurse_tasks_one_way ON public.nurse_tasks;
CREATE TRIGGER nurse_tasks_one_way BEFORE UPDATE OR DELETE ON public.nurse_tasks
  FOR EACH ROW EXECUTE FUNCTION public.nurse_tasks_one_way();
DROP TRIGGER IF EXISTS audit_nurse_tasks ON public.nurse_tasks;
CREATE TRIGGER audit_nurse_tasks AFTER INSERT OR UPDATE OR DELETE ON public.nurse_tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

ALTER TABLE public.nurse_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nurse_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nurse_tasks_select_clinical ON public.nurse_tasks;
CREATE POLICY nurse_tasks_select_clinical ON public.nurse_tasks FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE ALL ON public.nurse_tasks FROM anon, authenticated;
GRANT SELECT ON public.nurse_tasks TO medsync_clinical_reader;

-- ─── 2. the MAR: idempotent doses and reversals ─────────────────────
ALTER TABLE public.medication_administration_records ADD COLUMN IF NOT EXISTS client_key text;
ALTER TABLE public.medication_administration_records ADD COLUMN IF NOT EXISTS reverses_id uuid
  REFERENCES public.medication_administration_records(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS mar_client_key
  ON public.medication_administration_records (client_key) WHERE client_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mar_reverses_once
  ON public.medication_administration_records (reverses_id) WHERE reverses_id IS NOT NULL;

ALTER TABLE public.medication_administration_records DROP CONSTRAINT IF EXISTS mar_state_check;
ALTER TABLE public.medication_administration_records ADD CONSTRAINT mar_state_check
  CHECK (state IN ('administered','withheld','refused','wasted','reversed'));
ALTER TABLE public.medication_administration_records DROP CONSTRAINT IF EXISTS mar_reversal_shape;
ALTER TABLE public.medication_administration_records ADD CONSTRAINT mar_reversal_shape
  CHECK ((state = 'reversed') = (reverses_id IS NOT NULL));
