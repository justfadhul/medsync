-- ─────────────────────────────────────────────────────────────────────────
-- 0013_clinician_profiles_and_affiliations
--
-- GATE D — clinical staff signup.
--
-- Two tables:
--   1. `clinician_profiles`  — 1:1 with auth.users; the verification
--      anchor. Holds council + reg. number + uploaded licence path.
--      `verified_at`/`verified_by` flip via the approval Edge Function
--      in GATE F.
--   2. `staff_affiliations`  — per-affiliation row. Permissions attach
--      HERE, not to the user — a clinician can be `active` at hospital
--      A and `pending_approval` at hospital B simultaneously. Approval
--      is per-affiliation, by the hospital admin (or superadmin).
--
-- Permissions / lifecycle wiring is enforced in the application layer:
-- RLS lets the user write their own affiliation row at pending_approval,
-- but the state-transition columns (`approved_*`) are service-role
-- only (state moves through the GATE F Edge Functions).
-- ─────────────────────────────────────────────────────────────────────────

-- ─── clinician_profiles ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clinician_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  council_id uuid NOT NULL REFERENCES public.councils(id) ON DELETE RESTRICT,
  registration_number text NOT NULL,
  registration_expiry date,
  licence_document_path text,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT clinician_profiles_reg_unique UNIQUE (council_id, registration_number)
);

CREATE INDEX IF NOT EXISTS clinician_profiles_verified_idx
  ON public.clinician_profiles (verified_at);

DROP TRIGGER IF EXISTS set_updated_at ON public.clinician_profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.clinician_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS audit_clinician_profiles ON public.clinician_profiles;
CREATE TRIGGER audit_clinician_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.clinician_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

ALTER TABLE public.clinician_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinician_profiles FORCE ROW LEVEL SECURITY;

-- SELECT: own row + superadmin + any hospital_admin who has an
-- affiliation referencing this clinician (allows the approval queue UI
-- to see the clinician's anchor row).
DROP POLICY IF EXISTS clinician_profiles_select_own ON public.clinician_profiles;
CREATE POLICY clinician_profiles_select_own
  ON public.clinician_profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.user_has_role('superadmin')
    OR EXISTS (
      SELECT 1 FROM public.staff_affiliations sa
      WHERE sa.user_id = clinician_profiles.id
        AND public.user_has_role('hospital_admin', sa.hospital_id)
    )
  );

DROP POLICY IF EXISTS clinician_profiles_insert_own ON public.clinician_profiles;
CREATE POLICY clinician_profiles_insert_own
  ON public.clinician_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- UPDATE own — clinician can fix their reg number / expiry / re-upload
-- licence; the verifier-only fields (verified_at/verified_by) are
-- enforced via a column-level deny: we revoke UPDATE on those columns.
DROP POLICY IF EXISTS clinician_profiles_update_own ON public.clinician_profiles;
CREATE POLICY clinician_profiles_update_own
  ON public.clinician_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Column-level: verified_* are service-role only.
REVOKE UPDATE (verified_at, verified_by) ON public.clinician_profiles FROM authenticated;

-- ─── staff_affiliations ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_affiliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.hospital_departments(id) ON DELETE RESTRICT,
  cadre_id uuid NOT NULL REFERENCES public.cadres(id) ON DELETE RESTRICT,
  cadre_grade_id uuid REFERENCES public.cadre_grades(id) ON DELETE SET NULL,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  specialty_id uuid REFERENCES public.specialties(id) ON DELETE SET NULL,
  employment_type text NOT NULL,
  state public.lifecycle_state NOT NULL DEFAULT 'pending_approval',
  rejection_reason text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_affiliations_employment_type_check
    CHECK (employment_type IN ('full_time', 'visiting', 'locum')),
  CONSTRAINT staff_affiliations_unique
    UNIQUE (user_id, hospital_id, department_id, role_id),
  CONSTRAINT staff_affiliations_rejection_requires_reason
    CHECK (state <> 'rejected' OR rejection_reason IS NOT NULL),
  CONSTRAINT staff_affiliations_approval_pair
    CHECK (
      (state IN ('approved', 'active') AND approved_at IS NOT NULL)
      OR (state NOT IN ('approved', 'active'))
    )
);

CREATE INDEX IF NOT EXISTS staff_affiliations_user_idx
  ON public.staff_affiliations (user_id);
CREATE INDEX IF NOT EXISTS staff_affiliations_hospital_state_idx
  ON public.staff_affiliations (hospital_id, state);

DROP TRIGGER IF EXISTS set_updated_at ON public.staff_affiliations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.staff_affiliations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS audit_staff_affiliations ON public.staff_affiliations;
CREATE TRIGGER audit_staff_affiliations
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_affiliations
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

ALTER TABLE public.staff_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_affiliations FORCE ROW LEVEL SECURITY;

-- SELECT: own + hospital_admin of the hospital + superadmin.
DROP POLICY IF EXISTS staff_affiliations_select_scoped ON public.staff_affiliations;
CREATE POLICY staff_affiliations_select_scoped
  ON public.staff_affiliations
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.user_has_role('hospital_admin', hospital_id)
    OR public.user_has_role('superadmin')
  );

-- INSERT: own (the clinician requests the affiliation; state defaults
-- to pending_approval). Hospital admins do NOT pre-add staff.
DROP POLICY IF EXISTS staff_affiliations_insert_own ON public.staff_affiliations;
CREATE POLICY staff_affiliations_insert_own
  ON public.staff_affiliations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND state = 'pending_approval'
    AND approved_at IS NULL
    AND approved_by IS NULL
  );

-- No UPDATE policy for authenticated — state transitions are
-- service-role only (Edge Functions in GATE F).

-- ─── Storage bucket policy stub ──────────────────────────────────────────
--
-- The `clinician-licences` Storage bucket is provisioned out-of-band in
-- GATE G (Storage buckets aren't first-class in the migration runner).
-- This stub-comment exists so the next developer running migrations
-- knows the bucket is expected. Bucket policy (when created):
--   - private (default)
--   - max object size 5MB
--   - object key shape: `<userId>/<uuid>.<ext>`
--   - SELECT/INSERT: object owner ∪ superadmin ∪ hospital_admin of any
--     hospital where the object owner has a staff_affiliations row.
