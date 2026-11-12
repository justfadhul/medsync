-- 0287 — The superadmin loses its standing view of patient data; photos are no longer readable by every account
-- (senior review 2026-11-11: C-3, H-11).
--
-- C-3. 102 policies let `user_has_role('superadmin')` read a table. On the tables that hold a patient's identity or
-- health data that arm was a second, unlogged path around break-glass: one PostgREST GET, no grant, no `sa_audit_log`
-- row, nobody notified. It is removed here, and only that arm: every other arm of each policy (the patient's own,
-- the care team's, the hospital admin's) is kept exactly as it is live, because the edit is made on the stored
-- policy, not on a copy of it.
--
--   A superadmin reads a patient's record only through break-glass: `sa-open-break-glass` writes the grant, the audit
--   row and the hospital admins' notice, and the app's access check (lib/encounter/scope.ts, `break_glass`) honours
--   it server-side. Nothing in the web or the Edge Functions read these tables with a superadmin's own token; they
--   use the service role or the app's database role, so no screen changes.
--
--   `audit_log` holds whole before-and-after rows of those same tables, so its superadmin SELECT goes too. Nobody
--   reads it over the API now; the app (owner role) and the service role still do.
--
--   Kept on purpose: staff, hospital and governance tables (verification needs them), `clinical_phi_access_log` (the
--   record of who opened whose chart, which is how misuse is found), and `sa_break_glass_grants`.
--
--   A new table that holds patient data must not give the superadmin a read arm:
--   tests/auth/superadmin-off-phi.test.ts reads the list below and checks every later migration.
--
-- H-11. `avatars` was readable by any signed-in account, keyed by user id, so a self-signed-up patient could list every
-- face. Reads are now: your own photo, and the photo of an active clinician (the faces patients see when they book,
-- `clinician_directory`). Staff see a patient's photo through the server, which signs it with the service role after
-- its own access check (lib/avatars.ts), so they need no arm here.
--
-- GATED: owner-applied (`npm run db:migrate`), after 0285.

DROP POLICY IF EXISTS audit_log_select_superadmin ON public.audit_log;

DO $$
DECLARE
  phi text[] := ARRAY[
    'users', 'patient_profiles', 'personal_health_logs', 'patient_allergies', 'patient_food_products',
    'patient_intakes', 'patient_reported_history', 'patient_visit_summaries', 'problem_list', 'care_plan',
    'self_medications', 'self_medication_takes', 'provisional_patients', 'consent_records',
    'appointments', 'waitlist_entries', 'queue_entries', 'notification_dispatches', 'visit_ratings',
    'triage_records', 'clinical_observations', 'clinical_documentation', 'clinical_cosign_requests',
    'encounters', 'encounter_diagnoses', 'encounter_events', 'encounter_medications', 'encounter_orders',
    'encounter_results', 'encounter_symptom_observations', 'medication_administration_records',
    'admissions', 'bed_assignments', 'nursing_assignments', 'shift_handovers',
    'resus_episodes', 'resus_arrest_records', 'resus_debriefs', 'resus_timeline_events',
    'resus_mobilisation_alerts', 'resus_after_death_tasks', 'resus_role_assignments'
  ];
  arm constant text := '(public\.)?user_has_role\(''superadmin''::text\)';
  p record;
  q text;
  c text;
  left_over text;
BEGIN
  FOR p IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (phi)
      AND (coalesce(qual, '') || coalesce(with_check, '')) ~ arm
  LOOP
    IF (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ ('NOT \(?' || arm) THEN
      RAISE EXCEPTION 'C-3: %.% negates the superadmin arm; edit it by hand', p.tablename, p.policyname;
    END IF;
    -- Drop the arm from an OR chain; anywhere else it becomes false (no access), never true.
    q := regexp_replace(regexp_replace(regexp_replace(p.qual,
           arm || ' OR ', '', 'g'), ' OR ' || arm, '', 'g'), arm, 'false', 'g');
    c := regexp_replace(regexp_replace(regexp_replace(p.with_check,
           arm || ' OR ', '', 'g'), ' OR ' || arm, '', 'g'), arm, 'false', 'g');
    IF coalesce(q, 'false') = 'false' AND coalesce(c, 'false') = 'false' THEN
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    ELSIF q IS NOT NULL AND c IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', p.policyname, p.tablename, q, c);
    ELSIF q IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', p.policyname, p.tablename, q);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', p.policyname, p.tablename, c);
    END IF;
  END LOOP;

  SELECT string_agg(tablename || '.' || policyname, ', ') INTO left_over
  FROM pg_policies
  WHERE (schemaname = 'public' AND tablename = ANY (phi || ARRAY['audit_log']))
    AND (coalesce(qual, '') || coalesce(with_check, '')) ILIKE '%superadmin%';
  IF left_over IS NOT NULL THEN
    RAISE EXCEPTION 'C-3: still open to the superadmin: %', left_over;
  END IF;
END $$;

DROP POLICY IF EXISTS avatars_select_authenticated ON storage.objects;
DROP POLICY IF EXISTS avatars_select_own_or_clinician ON storage.objects;
CREATE POLICY avatars_select_own_or_clinician
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.clinician_directory d
        WHERE d.id::text = (storage.foldername(name))[1]
      )
    )
  );
