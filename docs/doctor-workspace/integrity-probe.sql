-- Doctor Workspace — Phase 0 integrity probe (READ ONLY).
--
-- The STOP 0 baseline asks for Test Hospital-1's integrity counts and the
-- W1–W4 root causes in data. The session could not read production (the
-- auto-mode classifier refused it), so this is the owner's to run:
--
--   psql "$DATABASE_URL" -v hospital="'Test Hospital-1'" -f docs/doctor-workspace/integrity-probe.sql
--
-- Codes, states and timestamps only — nothing is decrypted, nothing is written.

BEGIN READ ONLY;

WITH h AS (SELECT id FROM public.hospitals WHERE name = :hospital LIMIT 1),
dead AS (
  SELECT DISTINCT r.patient_user_id AS pid
    FROM public.resus_episodes r, h
   WHERE r.hospital_id = h.id AND r.patient_user_id IS NOT NULL
     AND (r.death_confirmed_at IS NOT NULL
          OR r.outcome_code IN ('died_after_cpr', 'died_cpr_not_attempted')
          OR r.disposition IN ('mortuary', 'deceased'))
  UNION
  SELECT DISTINCT e.patient_user_id FROM public.encounters e, h
   WHERE e.hospital_id = h.id AND e.disposition = 'deceased'
)
SELECT
  (SELECT count(*) FROM dead) AS deceased_patients,
  (SELECT count(DISTINCT pid) FROM (
      SELECT i.patient_user_id AS pid FROM public.patient_intakes i, h
       WHERE i.hospital_id = h.id AND i.status IN ('arrived', 'awaiting_triage', 'triaged')
      UNION ALL
      SELECT e.patient_user_id FROM public.encounters e, h
       WHERE e.hospital_id = h.id AND e.state IN ('planned', 'in_progress')
      UNION ALL
      SELECT r.patient_user_id FROM public.resus_episodes r, h
       WHERE r.hospital_id = h.id AND r.state = 'active'
    ) o WHERE pid IN (SELECT pid FROM dead)) AS deceased_with_open_items,
  (SELECT count(*) FROM (
      SELECT e.patient_user_id FROM public.encounters e, h
       WHERE e.hospital_id = h.id AND e.state = 'planned'
       GROUP BY e.patient_user_id HAVING count(*) > 1) d) AS patients_with_duplicate_assignments,
  (SELECT count(*) FROM public.triage_records t, h
    WHERE t.hospital_id = h.id AND t.assigned_level = 1
      AND t.triaged_at < now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM public.resus_episodes r WHERE r.triage_record_id = t.id)
      AND EXISTS (SELECT 1 FROM public.patient_intakes i
                   WHERE i.id = t.intake_id AND i.status IN ('arrived', 'awaiting_triage', 'triaged'))
  ) AS stale_l1_without_resus,
  (SELECT count(*) FROM public.encounters e, h
    WHERE e.hospital_id = h.id AND e.state = 'in_progress'
      AND greatest(e.updated_at, coalesce(
            (SELECT max(d.created_at) FROM public.clinical_documentation d WHERE d.encounter_id = e.id),
            e.started_at)) < now() - interval '24 hours') AS encounters_idle_24h,
  (SELECT count(*) FROM public.resus_episodes r, h
    WHERE r.hospital_id = h.id AND r.state = 'active'
      AND coalesce(r.last_activity_at, r.started_at) < now() - interval '2 hours') AS resus_idle_2h;

-- W1–W4: the two patients from the 24 Sep screenshots, every row that lists them.
WITH h AS (SELECT id FROM public.hospitals WHERE name = :hospital LIMIT 1),
p AS (SELECT id, patient_code FROM public.patient_profiles
       WHERE patient_code IN ('MS-2026-00003', 'MS-2026-00004'))
SELECT 'intake' AS kind, p.patient_code, i.id, i.status AS state, i.triage_level::text AS detail,
       coalesce(i.checked_in_at, i.arrived_at) AS at
  FROM public.patient_intakes i JOIN p ON p.id = i.patient_user_id, h WHERE i.hospital_id = h.id
UNION ALL
SELECT 'triage', p.patient_code, t.id, 'L' || t.assigned_level, t.intake_id::text, t.triaged_at
  FROM public.triage_records t JOIN p ON p.id = t.patient_user_id, h WHERE t.hospital_id = h.id
UNION ALL
SELECT 'encounter', p.patient_code, e.id, e.state, e.triage_record_id::text, e.created_at
  FROM public.encounters e JOIN p ON p.id = e.patient_user_id, h WHERE e.hospital_id = h.id
UNION ALL
SELECT 'resus', p.patient_code, r.id, r.state || '/' || r.phase,
       coalesce(r.outcome_code, '') || ' ' || coalesce(r.disposition, ''), r.started_at
  FROM public.resus_episodes r JOIN p ON p.id = r.patient_user_id, h WHERE r.hospital_id = h.id
ORDER BY 2, 6;

ROLLBACK;
