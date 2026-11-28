-- 0314 — The nursing care plan (ADR 0545, Phase 2).
--
-- ADDITIVE. Two new tables, no row changed.
--   1. nursing_care_problems: one row per nursing problem of a visit: the problem, its nursing
--      diagnosis label, related to, as shown by, a measurable goal and when, and the care items the
--      nurse will do. Append-only: resolving or withdrawing is a new row naming the one it replaces
--      (replaces_id, at most once); the problem's items never change.
--   2. nursing_care_events: append-only ticks, unticks and shift evaluations against a problem. An
--      item's state is its latest tick or untick; an untick never erases the tick before it.
--   3. both: RLS forced, the clinical reader's scoped SELECT, writes revoked from anon and
--      authenticated (the server writes as the owner, as every EMR table), audit triggers.
--
-- Re-runnable: CREATE TABLE / INDEX IF NOT EXISTS, DROP-then-CREATE for triggers and policies.
--
-- GATED: owner-applied (`npm run db:migrate`). Until it runs the care plan tab says the plan is not
-- set up here; NURSE_WARD_V2 decides whether it shows at all.


-- ─── 1. nursing_care_problems ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nursing_care_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE RESTRICT,
  problem text NOT NULL,
  label text,
  related_to text,
  as_shown_by text,
  goal text NOT NULL,
  goal_by text,
  care_items text[] NOT NULL DEFAULT '{}',
  library_key text,
  state text NOT NULL DEFAULT 'active',
  replaces_id uuid REFERENCES public.nursing_care_problems(id) ON DELETE RESTRICT,
  reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  client_key text,
  CONSTRAINT ncp_state_check CHECK (state IN ('active','resolved','entered_in_error')),
  CONSTRAINT ncp_items_check CHECK (cardinality(care_items) <= 20),
  -- Resolving or withdrawing names the problem it ends.
  CONSTRAINT ncp_ends_check CHECK (state = 'active' OR replaces_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS nursing_care_problems_encounter
  ON public.nursing_care_problems (encounter_id, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS nursing_care_problems_replaces
  ON public.nursing_care_problems (replaces_id) WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nursing_care_problems_client_key
  ON public.nursing_care_problems (client_key) WHERE client_key IS NOT NULL;
DROP TRIGGER IF EXISTS nursing_care_problems_no_mutation ON public.nursing_care_problems;
CREATE TRIGGER nursing_care_problems_no_mutation BEFORE UPDATE OR DELETE ON public.nursing_care_problems
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_nursing_care_problems ON public.nursing_care_problems;
CREATE TRIGGER audit_nursing_care_problems AFTER INSERT OR UPDATE OR DELETE ON public.nursing_care_problems
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();


-- ─── 2. nursing_care_events ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nursing_care_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  problem_id uuid NOT NULL REFERENCES public.nursing_care_problems(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  item_index integer,
  evaluation text,
  note text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  client_key text,
  CONSTRAINT nce_kind_check CHECK (kind IN ('tick','untick','evaluation')),
  CONSTRAINT nce_item_check CHECK ((kind = 'evaluation') = (item_index IS NULL)),
  CONSTRAINT nce_evaluation_check CHECK ((kind = 'evaluation') = (evaluation IS NOT NULL)
    AND (evaluation IS NULL OR evaluation IN ('met','progressing','not_met'))));
CREATE INDEX IF NOT EXISTS nursing_care_events_problem
  ON public.nursing_care_events (problem_id, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS nursing_care_events_client_key
  ON public.nursing_care_events (client_key) WHERE client_key IS NOT NULL;
DROP TRIGGER IF EXISTS nursing_care_events_no_mutation ON public.nursing_care_events;
CREATE TRIGGER nursing_care_events_no_mutation BEFORE UPDATE OR DELETE ON public.nursing_care_events
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_nursing_care_events ON public.nursing_care_events;
CREATE TRIGGER audit_nursing_care_events AFTER INSERT OR UPDATE OR DELETE ON public.nursing_care_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();


-- ─── 3. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.nursing_care_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_care_problems FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nursing_care_problems_select_clinical ON public.nursing_care_problems;
CREATE POLICY nursing_care_problems_select_clinical ON public.nursing_care_problems FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.nursing_care_problems FROM anon, authenticated;
GRANT SELECT ON public.nursing_care_problems TO medsync_clinical_reader;

ALTER TABLE public.nursing_care_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nursing_care_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nursing_care_events_select_clinical ON public.nursing_care_events;
CREATE POLICY nursing_care_events_select_clinical ON public.nursing_care_events FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.nursing_care_events FROM anon, authenticated;
GRANT SELECT ON public.nursing_care_events TO medsync_clinical_reader;
