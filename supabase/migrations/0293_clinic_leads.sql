-- ─────────────────────────────────────────────────────────────────────────
-- 0293_clinic_leads — owner-applied (npm run db:migrate).
--
-- The Tether landing page's "Register your clinic" form (D-LP-09, ADR 0481): one email per row and
-- nothing else that names a person. The public server action (app/tether/actions.ts) validates,
-- checks a honeypot and a rate limit of 5 per address per hour, then inserts with the service role, so
-- there is no INSERT policy for anon or authenticated. No one reads it through the API but a superadmin.
-- ADDITIVE and idempotent. Numbered 0293: 0287–0292 are held by the booking pilot branches.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clinic_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  -- Where the form sat ('landing'); the action sets it.
  source text NOT NULL DEFAULT 'landing' CHECK (char_length(source) BETWEEN 1 AND 40),
  -- SHA-256 of the browser's user agent, hex, so repeated spam can be seen without storing the string.
  user_agent_hash text CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinic_leads_created_idx ON public.clinic_leads (created_at DESC);

ALTER TABLE public.clinic_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_leads FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.clinic_leads FROM anon;

DROP POLICY IF EXISTS clinic_leads_select_superadmin ON public.clinic_leads;
CREATE POLICY clinic_leads_select_superadmin
  ON public.clinic_leads
  FOR SELECT
  TO authenticated
  USING (public.user_has_role('superadmin'));
