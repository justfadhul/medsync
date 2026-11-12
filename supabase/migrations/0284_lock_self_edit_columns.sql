-- 0284 — Lock down what a signed-in person can write directly (senior review 2026-11-11: C-4, M-1, M-2, M-3, L-2).
--
-- A column-level REVOKE does nothing while the table-level grant stands, so the earlier column revokes in
-- 0013, 0014 and 0018 never took effect. Here every table-level write grant comes off, and only the columns
-- the app writes with the person's own token come back:
--   users.full_name, users.avatar_path        (phone app avatar; RLS test for own name)
--   patient_profiles.primary_facility_id      (web and phone "choose my hospital")
--   sa_notifications.read_at, .dismissed_at   (what 0018 meant)
-- Everything else goes through the service role (Edge Functions, server actions), which these grants do not touch.
--
-- GATED: owner-applied (`npm run db:migrate`).

-- C-4: nobody edits their own state, email or suspension back.
REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated;
GRANT UPDATE (full_name, avatar_path) ON public.users TO authenticated;

-- M-2: sex, date of birth, patient code and known conditions are no longer patient-editable.
REVOKE UPDATE, DELETE ON public.patient_profiles FROM anon, authenticated;
GRANT UPDATE (primary_facility_id) ON public.patient_profiles TO authenticated;

-- M-1: verification and review columns, done properly.
REVOKE UPDATE, DELETE ON public.clinician_profiles FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.hospital_applications FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.sa_notifications FROM anon, authenticated;
GRANT UPDATE (read_at, dismissed_at) ON public.sa_notifications TO authenticated;

-- M-3: roles are granted only through Edge Functions (assign-role, invitations), which audit.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;

-- L-2: only issue_patient_code() (SECURITY DEFINER, owner) touches the counter.
ALTER TABLE public.patient_code_seq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_code_seq FROM anon, authenticated;
