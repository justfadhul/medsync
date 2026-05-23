-- ─────────────────────────────────────────────────────────────────────────
-- 0014_hospital_leads_and_applications
--
-- GATE E — hospital onboarding.
--
-- Two tables:
--   1. `hospital_leads`         — anon landing-page captures, no
--      account. Lighter footprint than applications. Superadmin reads,
--      decides whether to invite to apply.
--   2. `hospital_applications`  — full pilot application by an
--      authenticated applicant. On superadmin approval (GATE F), a
--      row lands in public.hospitals and the applicant's user_roles
--      gets a hospital_admin scoped to the new hospital.
--
-- Anon INSERT on hospital_leads is rate-limited at the action layer
-- via Turnstile (kickoff Q4 default). The migration doesn't enforce
-- the rate limit, just the schema + RLS.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── hospital_leads ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospital_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name text NOT NULL,
  facility_level public.facility_level NOT NULL,
  ownership text NOT NULL,
  district_id uuid NOT NULL REFERENCES public.districts(id) ON DELETE RESTRICT,
  contact_name text NOT NULL,
  contact_role text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  notes text,
  source text,
  state text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hospital_leads_ownership_check
    CHECK (ownership IN ('public_moh','private','pnfp','private_clinic')),
  CONSTRAINT hospital_leads_state_check
    CHECK (state IN ('new','contacted','invited','archived'))
);

CREATE INDEX IF NOT EXISTS hospital_leads_state_created_idx
  ON public.hospital_leads (state, created_at DESC);
CREATE INDEX IF NOT EXISTS hospital_leads_contact_email_idx
  ON public.hospital_leads (contact_email);

DROP TRIGGER IF EXISTS audit_hospital_leads ON public.hospital_leads;
CREATE TRIGGER audit_hospital_leads
  AFTER INSERT OR UPDATE OR DELETE ON public.hospital_leads
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

ALTER TABLE public.hospital_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_leads FORCE ROW LEVEL SECURITY;

-- anon INSERT: landing-page lead form runs unauthenticated. Rate limit
-- is enforced in the application (Turnstile token verified server-side
-- before the INSERT runs).
DROP POLICY IF EXISTS hospital_leads_insert_anon ON public.hospital_leads;
CREATE POLICY hospital_leads_insert_anon
  ON public.hospital_leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (state = 'new');

DROP POLICY IF EXISTS hospital_leads_select_superadmin ON public.hospital_leads;
CREATE POLICY hospital_leads_select_superadmin
  ON public.hospital_leads
  FOR SELECT
  TO authenticated
  USING (public.user_has_role('superadmin'));

DROP POLICY IF EXISTS hospital_leads_update_superadmin ON public.hospital_leads;
CREATE POLICY hospital_leads_update_superadmin
  ON public.hospital_leads
  FOR UPDATE
  TO authenticated
  USING (public.user_has_role('superadmin'))
  WITH CHECK (public.user_has_role('superadmin'));

-- ─── hospital_applications ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospital_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  hospital_name text NOT NULL,
  facility_level public.facility_level NOT NULL,
  ownership text NOT NULL,
  registration_number text NOT NULL,
  registration_authority text,
  district_id uuid NOT NULL REFERENCES public.districts(id) ON DELETE RESTRICT,
  subcounty_id uuid REFERENCES public.subcounties(id) ON DELETE RESTRICT,
  physical_address text NOT NULL,
  institutional_email_domain text NOT NULL,
  applicant_role text NOT NULL,
  authorisation_document_path text,
  state public.lifecycle_state NOT NULL DEFAULT 'pending_approval',
  rejection_reason text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  approved_hospital_id uuid REFERENCES public.hospitals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hospital_applications_ownership_check
    CHECK (ownership IN ('public_moh','private','pnfp','private_clinic')),
  CONSTRAINT hospital_applications_rejection_requires_reason
    CHECK (state <> 'rejected' OR rejection_reason IS NOT NULL),
  CONSTRAINT hospital_applications_approval_pair
    CHECK (
      (state = 'approved' AND approved_hospital_id IS NOT NULL AND reviewed_at IS NOT NULL)
      OR (state <> 'approved')
    )
);

CREATE INDEX IF NOT EXISTS hospital_applications_state_created_idx
  ON public.hospital_applications (state, created_at DESC);
CREATE INDEX IF NOT EXISTS hospital_applications_district_idx
  ON public.hospital_applications (district_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.hospital_applications;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.hospital_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS audit_hospital_applications ON public.hospital_applications;
CREATE TRIGGER audit_hospital_applications
  AFTER INSERT OR UPDATE OR DELETE ON public.hospital_applications
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

ALTER TABLE public.hospital_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_applications FORCE ROW LEVEL SECURITY;

-- SELECT: own + superadmin.
DROP POLICY IF EXISTS hospital_applications_select_scoped ON public.hospital_applications;
CREATE POLICY hospital_applications_select_scoped
  ON public.hospital_applications
  FOR SELECT
  TO authenticated
  USING (
    applicant_user_id = auth.uid()
    OR public.user_has_role('superadmin')
  );

-- INSERT: own, must start at pending_approval, never set review/approval columns.
DROP POLICY IF EXISTS hospital_applications_insert_own ON public.hospital_applications;
CREATE POLICY hospital_applications_insert_own
  ON public.hospital_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    applicant_user_id = auth.uid()
    AND state = 'pending_approval'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND approved_hospital_id IS NULL
  );

-- UPDATE own, only while pending_approval. Applicants can edit a
-- pending application; once it's approved or rejected the row is
-- frozen for non-superadmin actors.
DROP POLICY IF EXISTS hospital_applications_update_own_pending ON public.hospital_applications;
CREATE POLICY hospital_applications_update_own_pending
  ON public.hospital_applications
  FOR UPDATE
  TO authenticated
  USING (
    applicant_user_id = auth.uid()
    AND state = 'pending_approval'
  )
  WITH CHECK (
    applicant_user_id = auth.uid()
    AND state = 'pending_approval'
  );

-- Review/approval columns are service-role only (Edge Functions in
-- GATE F). Defence in depth on top of the UPDATE policies above.
REVOKE UPDATE (
  reviewed_by, reviewed_at, approved_hospital_id, state, rejection_reason
) ON public.hospital_applications FROM authenticated;
