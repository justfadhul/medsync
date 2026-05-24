-- ─────────────────────────────────────────────────────────────────────────
-- 0016_storage_buckets
--
-- GATE G — provision the two private Storage buckets the onboarding
-- flows need:
--   - `clinician-licences`     — practising certificates (GATE D)
--   - `hospital-authorisations` — authorisation letters (GATE E)
--
-- Both buckets are PRIVATE (no public URLs). Reads are gated by RLS
-- policies on storage.objects (mirrored from the table they relate
-- to). Object key shape: `<userId>/<uuid>.<ext>` — owner is derivable
-- from the first path segment, which we use in the RLS predicates.
--
-- File size cap: 5 MB (kickoff §A.6 default). MIME allow-list is also
-- enforced by the client-side FileUpload primitive AND re-validated
-- in the upload action; this migration sets the bucket-level cap as
-- defence in depth.
--
-- Idempotent — re-running this migration is a no-op once the buckets
-- exist.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── Bucket rows ─────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clinician-licences',
  'clinician-licences',
  false,
  5242880, -- 5 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hospital-authorisations',
  'hospital-authorisations',
  false,
  5242880, -- 5 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- ─── RLS for storage.objects ─────────────────────────────────────────────
--
-- Supabase enables RLS on storage.objects by default; we add scoped
-- policies for these two buckets only. Each policy keys off the
-- owner-segment of the path: `name` like `'<userId>/%'` matches all
-- objects under a user's own directory.

-- ─── clinician-licences ──────────────────────────────────────────────────

-- INSERT: only the authenticated user can write into their own folder.
DROP POLICY IF EXISTS clinician_licences_insert_own ON storage.objects;
CREATE POLICY clinician_licences_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'clinician-licences'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT: object owner + superadmin + scoped hospital_admin (any
-- hospital where the object owner holds a staff_affiliations row).
DROP POLICY IF EXISTS clinician_licences_select_scoped ON storage.objects;
CREATE POLICY clinician_licences_select_scoped
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'clinician-licences'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.user_has_role('superadmin')
      OR EXISTS (
        SELECT 1 FROM public.staff_affiliations sa
        WHERE sa.user_id::text = (storage.foldername(name))[1]
          AND public.user_has_role('hospital_admin', sa.hospital_id)
      )
    )
  );

-- UPDATE / DELETE own (lets the clinician re-upload a fresh licence).
DROP POLICY IF EXISTS clinician_licences_update_own ON storage.objects;
CREATE POLICY clinician_licences_update_own
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'clinician-licences'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS clinician_licences_delete_own ON storage.objects;
CREATE POLICY clinician_licences_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'clinician-licences'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── hospital-authorisations ─────────────────────────────────────────────

DROP POLICY IF EXISTS hospital_auth_insert_own ON storage.objects;
CREATE POLICY hospital_auth_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'hospital-authorisations'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT: applicant + superadmin only. No hospital_admin slot —
-- applicants are pre-approval, no admin exists yet to scope by.
DROP POLICY IF EXISTS hospital_auth_select_scoped ON storage.objects;
CREATE POLICY hospital_auth_select_scoped
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'hospital-authorisations'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.user_has_role('superadmin')
    )
  );

DROP POLICY IF EXISTS hospital_auth_update_own ON storage.objects;
CREATE POLICY hospital_auth_update_own
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'hospital-authorisations'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS hospital_auth_delete_own ON storage.objects;
CREATE POLICY hospital_auth_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'hospital-authorisations'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
