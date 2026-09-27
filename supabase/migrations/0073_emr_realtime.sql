-- 0073 — EMR realtime: PHI-free chart broadcasts, who may hear them, and the reader's last grants.
--
-- Per docs/emr/HARMONISATION.md §5.8 and PROMPT-ENCOUNTER-EMR §9 (signed with GATE A, 2026-09-26),
-- and the grants STOP 3 carried to P4.
--
-- ADDITIVE. No table, no column, no row; nothing existing changes meaning:
--   1. broadcast triggers on the EMR record tables → the private topics chart:<patient_user_id> and
--      (0069's own function, reused) workspace:<hospital_id>. The payload is { kind, at }: no id, no
--      value, nothing about a patient leaves the database. The client re-reads through a scoped,
--      audited server read; it never renders the payload
--   2. realtime.messages: chart:<patient> may be heard only by a user with a basis for that patient
--      (private.patient_access_basis) at a hospital where they hold an affiliation (guarded, as 0069)
--   3. medsync_clinical_reader: SELECT on encounter_medications and hospitals (policies mirroring
--      0071's), and on patient_profiles only the columns the fact loader reads — never a name,
--      phone or identifier
--
-- Re-runnable: CREATE OR REPLACE, DROP-then-CREATE for triggers and policies.
--
-- GATED: owner-applied (`npm run db:migrate`), after 0071. Until it runs the chart and the
-- workspace re-read every 15 s instead; the fact loader's reader path lacks demographics,
-- legacy medicines and the facility level, so EMR v1 stays off (O-7).


-- ─── 1. PHI-free broadcast: "something on this chart changed" ─────────
-- A missing or failing realtime layer must never block a clinical write (0068, 0069).
CREATE OR REPLACE FUNCTION public.emr_chart_broadcast()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('kind', TG_TABLE_NAME, 'at', now()),
      'change',
      'chart:' || NEW.patient_user_id::text,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$$;

-- Each table fires on what changes the record, never on a draft's autosave: clinical_notes only on
-- a new note or a state change (signing), so typing does not wake every board in the hospital.
-- Insert-only tables fire on INSERT. Legacy rows stay silent: clinical_observations only for CFC
-- rows (concept_id set), encounter_orders only for events-lifecycle orders (hospital_id set).
DO $do$
DECLARE
  t text;
  spec text[][] := ARRAY[
    ARRAY['clinical_notes',            'INSERT OR UPDATE OF state', ''],
    ARRAY['clinical_observations',     'INSERT',                    'WHEN (NEW.concept_id IS NOT NULL)'],
    ARRAY['conditions',                'INSERT',                    ''],
    ARRAY['allergies',                 'INSERT',                    ''],
    ARRAY['allergy_status_assertions', 'INSERT',                    ''],
    ARRAY['encounter_orders',          'INSERT',                    'WHEN (NEW.lifecycle = ''events'')'],
    ARRAY['diagnostic_reports',        'INSERT',                    ''],
    ARRAY['result_acknowledgements',   'INSERT',                    ''],
    ARRAY['specimens',                 'INSERT',                    '']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(spec, 1) LOOP
    t := spec[i][1];
    EXECUTE format('DROP TRIGGER IF EXISTS emr_chart_broadcast ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER emr_chart_broadcast AFTER %s ON public.%I FOR EACH ROW %s EXECUTE FUNCTION public.emr_chart_broadcast()',
      spec[i][2], t, spec[i][3]);
    -- The board's lanes (Critical results, Results to review, To co-sign, unsigned notes) move on these.
    EXECUTE format('DROP TRIGGER IF EXISTS workspace_broadcast ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER workspace_broadcast AFTER %s ON public.%I FOR EACH ROW %s EXECUTE FUNCTION public.workspace_broadcast()',
      spec[i][2], t, spec[i][3]);
  END LOOP;
END
$do$;


-- ─── 2. realtime.messages: who may hear chart:<patient> ──────────────
-- A wrapper rather than granting patient_access_basis itself (the gate-a note): it reads the
-- listener from auth.uid() and takes no user argument, so a signed-in client can ask only about
-- itself. A malformed topic is refused before any cast.
CREATE OR REPLACE FUNCTION private.may_hear_chart(p_topic text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_topic IS NULL OR p_topic !~ '^chart:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.staff_affiliations sa
      WHERE sa.user_id = auth.uid()
        AND sa.state IN ('active','approved')
        AND private.patient_access_basis(auth.uid(), substring(p_topic FROM 7)::uuid, sa.hospital_id) IS NOT NULL)
  END;
$$;
REVOKE ALL ON FUNCTION private.may_hear_chart(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.may_hear_chart(text) TO authenticated;

DO $do$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS chart_realtime_receive ON realtime.messages';
    EXECUTE $p$
      CREATE POLICY chart_realtime_receive ON realtime.messages
        FOR SELECT TO authenticated
        USING (
          realtime.messages.extension = 'broadcast'
          AND (SELECT realtime.topic()) LIKE 'chart:%'
          AND (SELECT private.may_hear_chart((SELECT realtime.topic())))
        )
    $p$;
  END IF;
END
$do$;


-- ─── 3. The reader's remaining grants (STOP 3) ───────────────────────
-- encounter_medications (0040) has no hospital of its own: scoped through its encounter, as 0071
-- scopes encounter_orders. The legacy authenticated policy stays as it is.
DROP POLICY IF EXISTS encounter_medications_select_clinical ON public.encounter_medications;
CREATE POLICY encounter_medications_select_clinical ON public.encounter_medications FOR SELECT TO medsync_clinical_reader
  USING (patient_user_id IN (SELECT private.accessible_patient_ids())
         AND EXISTS (SELECT 1 FROM public.encounters e WHERE e.id = encounter_medications.encounter_id
                     AND e.hospital_id = (SELECT private.current_hospital_id())));
GRANT SELECT ON public.encounter_medications TO medsync_clinical_reader;

-- hospitals: the reader acts for one hospital (ctx.facility_level), so it sees that one row.
DROP POLICY IF EXISTS hospitals_select_clinical ON public.hospitals;
CREATE POLICY hospitals_select_clinical ON public.hospitals FOR SELECT TO medsync_clinical_reader
  USING (id = (SELECT private.current_hospital_id()));
GRANT SELECT ON public.hospitals TO medsync_clinical_reader;

-- patient_profiles: column-limited to what lib/facts/loader.ts reads for demographics — id, sex,
-- date of birth (day precision: the column is a date), the primary facility (the fact's tenant)
-- and created_at (the as-of bound). Names, phone, NIN and address stay out of reach; the safety bar
-- still reveals identity through the audited fetchPatientSummaryAudited.
DROP POLICY IF EXISTS patient_profiles_select_clinical ON public.patient_profiles;
CREATE POLICY patient_profiles_select_clinical ON public.patient_profiles FOR SELECT TO medsync_clinical_reader
  USING (id IN (SELECT private.accessible_patient_ids()));
REVOKE ALL ON public.patient_profiles FROM medsync_clinical_reader;
GRANT SELECT (id, sex, date_of_birth, primary_facility_id, created_at) ON public.patient_profiles
  TO medsync_clinical_reader;


-- ─── Backfilled allergy text for the reader role ─────────────────────
-- 0071 copied backfilled allergies without their text (SQL cannot encrypt; the
-- text stays in its untouched source, named by legacy_ref). The reader role holds
-- no grant on patient_allergies or resus_timeline_events, so without this the
-- chart would name a backfilled allergy as "substance not named". This definer
-- function returns only that one string, and only for a patient the caller has a
-- basis for (accessible_patient_ids reads the transaction's app.user_id).
CREATE OR REPLACE FUNCTION private.allergy_source_text(p_allergy_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT CASE a.legacy_ref->>'table'
    WHEN 'patient_allergies' THEN
      (SELECT pa.substance FROM public.patient_allergies pa
        WHERE pa.id = (a.legacy_ref->>'id')::uuid)
    WHEN 'resus_timeline_events' THEN
      (SELECT e.payload->'allergyCapture'->'substances'->>((a.legacy_ref->>'index')::int)
         FROM public.resus_timeline_events e
        WHERE e.id = (a.legacy_ref->>'id')::uuid)
  END
  FROM public.allergies a
  WHERE a.id = p_allergy_id
    AND a.legacy_ref IS NOT NULL
    AND a.patient_user_id IN (SELECT private.accessible_patient_ids());
$$;
REVOKE ALL ON FUNCTION private.allergy_source_text(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.allergy_source_text(uuid) TO medsync_clinical_reader;
