-- ─────────────────────────────────────────────────────────────────────────
-- 0081_tester_feedback — owner-applied (npm run db:migrate).
--
-- Responses to the public /feedback form: the co-founders and Dr. Ahabwe Alvin testing the
-- landing page, the four onboarding flows and department setup. No clinical or patient data.
-- ADDITIVE and idempotent. The public server action inserts with the service role (after its own
-- validation + rate limit), so there is no client INSERT policy; only superadmins can read.
--
-- Numbered 0081: feat/emr-engine holds 0071–0073, the services hub is 0080.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tester_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A slug from content/feedback.ts FEEDBACK_RESPONDENTS, checked by the action.
  respondent text NOT NULL CHECK (char_length(respondent) BETWEEN 1 AND 60),
  -- { "<question id>": 1–5 | "<option>" | "<text>" }
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tester_feedback_respondent_created_idx
  ON public.tester_feedback (respondent, created_at DESC);

ALTER TABLE public.tester_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tester_feedback FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tester_feedback_select_superadmin ON public.tester_feedback;
CREATE POLICY tester_feedback_select_superadmin
  ON public.tester_feedback
  FOR SELECT
  TO authenticated
  USING (public.user_has_role('superadmin'));
