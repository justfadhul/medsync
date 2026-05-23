-- ────────────────────────────────────────────────────────────────────────
--  ROLLBACK: Phase 1 onboarding + Phase 0 interest-signups
--  Paste into Supabase Studio → SQL editor → Run
-- ────────────────────────────────────────────────────────────────────────
--
-- Reverses every migration from 0006 through 0015. After this runs the
-- DB is back to the Phase 0 baseline (migrations 0000-0005 only):
--
--   - auth + public.users (with the 0004 trigger)
--   - public.hospitals, hospital_departments
--   - public.user_roles, consent_records, audit_log
--   - public.set_updated_at() + audit_log_changes() functions
--
-- Drops, in safe order:
--
--   1. Storage policies + buckets (clinician-licences, hospital-authorisations)
--   2. Phase 1 tables (patient_profiles, hospital_applications, signup_drafts,
--      staff_affiliations, clinician_profiles)
--   3. Phase 0 interest-signups table (added in 0006)
--   4. Reference tables (ref_data_versions, ref_regions, ref_districts,
--      ref_subcounties, ref_councils, ref_cadres, ref_cadre_grades,
--      ref_specialties, ref_roles)
--   5. Functions + sequences (issue_patient_code, patient_code_seq)
--   6. Enums (lifecycle_state, patient_sex, patient_id_type, hospital_ownership)
--   7. The `state` column on public.users (added in 0008)
--
-- Idempotent: every DROP uses IF EXISTS, so safe to re-run.
--
-- ────────────────────────────────────────────────────────────────────────

-- ─── 1. Storage policies + buckets ─────────────────────────────────────
DROP POLICY IF EXISTS clinician_licences_owner_read ON storage.objects;
DROP POLICY IF EXISTS clinician_licences_owner_insert ON storage.objects;
DROP POLICY IF EXISTS clinician_licences_owner_update ON storage.objects;
DROP POLICY IF EXISTS clinician_licences_owner_delete ON storage.objects;
DROP POLICY IF EXISTS clinician_licences_superadmin_read ON storage.objects;
DROP POLICY IF EXISTS clinician_licences_hospital_admin_read ON storage.objects;

DROP POLICY IF EXISTS hospital_authorisations_owner_read ON storage.objects;
DROP POLICY IF EXISTS hospital_authorisations_owner_insert ON storage.objects;
DROP POLICY IF EXISTS hospital_authorisations_owner_update ON storage.objects;
DROP POLICY IF EXISTS hospital_authorisations_owner_delete ON storage.objects;
DROP POLICY IF EXISTS hospital_authorisations_superadmin_read ON storage.objects;

-- Buckets last so the policies can drop cleanly first.
DELETE FROM storage.objects WHERE bucket_id IN ('clinician-licences', 'hospital-authorisations');
DELETE FROM storage.buckets WHERE id IN ('clinician-licences', 'hospital-authorisations');

-- ─── 2. Phase 1 tables (drop dependent rows first, then tables) ────────
-- Drop child / referencing tables before parents so FKs don't block.
DROP TABLE IF EXISTS public.patient_profiles CASCADE;
DROP TABLE IF EXISTS public.hospital_applications CASCADE;
DROP TABLE IF EXISTS public.staff_affiliations CASCADE;
DROP TABLE IF EXISTS public.clinician_profiles CASCADE;
DROP TABLE IF EXISTS public.signup_drafts CASCADE;

-- ─── 3. Phase 0 interest-signups (added in 0006) ──────────────────────
DROP TABLE IF EXISTS public.interest_signups CASCADE;

-- ─── 4. Reference catalog ─────────────────────────────────────────────
DROP TABLE IF EXISTS public.ref_roles CASCADE;
DROP TABLE IF EXISTS public.ref_specialties CASCADE;
DROP TABLE IF EXISTS public.ref_cadre_grades CASCADE;
DROP TABLE IF EXISTS public.ref_cadres CASCADE;
DROP TABLE IF EXISTS public.ref_councils CASCADE;
DROP TABLE IF EXISTS public.ref_subcounties CASCADE;
DROP TABLE IF EXISTS public.ref_districts CASCADE;
DROP TABLE IF EXISTS public.ref_regions CASCADE;
DROP TABLE IF EXISTS public.ref_data_versions CASCADE;

-- ─── 5. Functions + sequences ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.issue_patient_code() CASCADE;
DROP SEQUENCE IF EXISTS public.patient_code_seq CASCADE;

-- ─── 6. Enums ─────────────────────────────────────────────────────────
-- Drop the column that uses lifecycle_state before dropping the type.
ALTER TABLE public.users DROP COLUMN IF EXISTS state;

DROP TYPE IF EXISTS public.hospital_ownership;
DROP TYPE IF EXISTS public.patient_id_type;
DROP TYPE IF EXISTS public.patient_sex;
DROP TYPE IF EXISTS public.lifecycle_state;

-- ────────────────────────────────────────────────────────────────────────
-- DONE.
--
-- After this runs:
--   - The dev migrator (scripts/migrate.ts) may flag the old migrations
--     as missing if their entries are still in `supabase_migrations.schema_migrations`.
--     Optional cleanup:
--
--       DELETE FROM supabase_migrations.schema_migrations
--       WHERE version IN ('0006', '0007', '0008', '0009', '0010',
--                         '0011', '0012', '0013', '0014', '0015');
--
--   - The audit_log table (Phase 0) still has all the audit entries from
--     the Phase 1 era. They're harmless but you can purge if you want:
--
--       DELETE FROM public.audit_log WHERE table_name IN (
--         'patient_profiles', 'hospital_applications', 'staff_affiliations',
--         'clinician_profiles', 'signup_drafts', 'interest_signups',
--         'ref_data_versions', 'ref_regions', 'ref_districts', 'ref_subcounties',
--         'ref_councils', 'ref_cadres', 'ref_cadre_grades', 'ref_specialties',
--         'ref_roles'
--       );
-- ────────────────────────────────────────────────────────────────────────
