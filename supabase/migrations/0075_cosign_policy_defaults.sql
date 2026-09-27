-- 0075 — Co-sign policy defaults for every hospital, now and later.
--
-- Per docs/emr/OWNER-RUNBOOK.md §8 ("seed clinical_cosign_policies for hospitals created after
-- 0030 first; prescribing fails closed without them") and the known Workspace bug: the default
-- matrix was seeded once, by 0030, 0031 and 0036, over the hospitals that were active then. A
-- hospital created later has no rows, so every action resolves to 'blocked' (lib/doctor,
-- lib/nurse capabilities, the triage authority and EMR_PRESCRIBING all fail closed).
--
-- ADDITIVE. No new table, column, action kind or requirement; no existing row changes:
--   1. private.seed_cosign_policy_defaults(hospital_id): the SAME hospital-wide rows 0030 (medical
--      cadres), 0031 (nursing cadres) and 0036 (triage authority) seeded, defined once here.
--      ON CONFLICT DO NOTHING on cosign_policy_unique, so an existing row is never overwritten.
--   2. backfill: every hospital with NO policy row at all gets the defaults. A hospital that has
--      any row (seeded or customised, hospital-wide or department) is left exactly as it is.
--   3. AFTER INSERT trigger on hospitals: a new hospital (sa-create-hospital inserts it as
--      'provisioning') gets the defaults at birth, so they are there when it is activated.
-- Every insert is audited by 0030's audit_clinical_cosign_policies trigger, as the seeds were.
-- The action kinds are all within 0036's cosign_policy_action_check (the Drizzle copy of that
-- CHECK still lists 0030's five kinds; that drift is pinned in tests/emr-db/drizzle-parity).
--
-- Re-runnable: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and the backfill finds nothing to do.
--
-- GATED: owner-applied (`npm run db:migrate`). Independent of 0071–0074. Until it runs, hospitals
-- created after 0030 keep resolving every action to 'blocked'.


-- ─── 1. The default matrix, defined once ─────────────────────────────
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.seed_cosign_policy_defaults(p_hospital_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH inserted AS (
    INSERT INTO public.clinical_cosign_policies
      (hospital_id, department_id, cadre_code, action_kind, requirement, notes)
    SELECT p_hospital_id, NULL, p.cadre_code, p.action_kind, p.requirement,
           'Default seeded by migration 0075 (the 0030/0031/0036 defaults).'
    FROM (
      VALUES
        -- 0030 §5 — INTERN_DOCTOR (intern / JHO)
        ('INTERN_DOCTOR',     'prescription_routine',          'cosign_required'),
        ('INTERN_DOCTOR',     'prescription_controlled',       'blocked'),
        ('INTERN_DOCTOR',     'order_high_cost_imaging',       'cosign_required'),
        ('INTERN_DOCTOR',     'admit_patient',                 'cosign_required'),
        ('INTERN_DOCTOR',     'discharge_patient',             'cosign_required'),
        -- 0030 §5 — CLINICAL_OFFICER
        ('CLINICAL_OFFICER',  'prescription_routine',          'cosign_required'),
        ('CLINICAL_OFFICER',  'prescription_controlled',       'blocked'),
        ('CLINICAL_OFFICER',  'order_high_cost_imaging',       'cosign_required'),
        ('CLINICAL_OFFICER',  'admit_patient',                 'cosign_required'),
        ('CLINICAL_OFFICER',  'discharge_patient',             'cosign_required'),
        -- 0030 §5 — MEDICAL_OFFICER (independent except controlled substances)
        ('MEDICAL_OFFICER',   'prescription_routine',          'allowed'),
        ('MEDICAL_OFFICER',   'prescription_controlled',       'cosign_required'),
        ('MEDICAL_OFFICER',   'order_high_cost_imaging',       'allowed'),
        ('MEDICAL_OFFICER',   'admit_patient',                 'allowed'),
        ('MEDICAL_OFFICER',   'discharge_patient',             'allowed'),
        -- 0030 §5 — MEDICAL_OFFICER_SG + CONSULTANT + SENIOR_CONSULTANT (full)
        ('MEDICAL_OFFICER_SG','prescription_routine',          'allowed'),
        ('MEDICAL_OFFICER_SG','prescription_controlled',       'allowed'),
        ('MEDICAL_OFFICER_SG','order_high_cost_imaging',       'allowed'),
        ('MEDICAL_OFFICER_SG','admit_patient',                 'allowed'),
        ('MEDICAL_OFFICER_SG','discharge_patient',             'allowed'),
        ('CONSULTANT',        'prescription_routine',          'allowed'),
        ('CONSULTANT',        'prescription_controlled',       'allowed'),
        ('CONSULTANT',        'order_high_cost_imaging',       'allowed'),
        ('CONSULTANT',        'admit_patient',                 'allowed'),
        ('CONSULTANT',        'discharge_patient',             'allowed'),
        ('SENIOR_CONSULTANT', 'prescription_routine',          'allowed'),
        ('SENIOR_CONSULTANT', 'prescription_controlled',       'allowed'),
        ('SENIOR_CONSULTANT', 'order_high_cost_imaging',       'allowed'),
        ('SENIOR_CONSULTANT', 'admit_patient',                 'allowed'),
        ('SENIOR_CONSULTANT', 'discharge_patient',             'allowed'),
        -- 0031 §7 — nursing cadres
        ('NURSE',             'high_alert_med_administration', 'allowed'),
        ('NURSE',             'independent_complex_procedure', 'cosign_required'),
        ('MIDWIFE',           'high_alert_med_administration', 'allowed'),
        ('MIDWIFE',           'independent_complex_procedure', 'cosign_required'),
        ('SPECIALIST_NURSE',  'high_alert_med_administration', 'allowed'),
        ('SPECIALIST_NURSE',  'independent_complex_procedure', 'allowed'),
        -- 0036 §7 — triage authority (R1: only doctors and clinical officers down-triage)
        ('NURSE',             'triage_patient',                'allowed'),
        ('MIDWIFE',           'triage_patient',                'allowed'),
        ('SPECIALIST_NURSE',  'triage_patient',                'allowed'),
        ('INTERN_DOCTOR',     'triage_patient',                'allowed'),
        ('MEDICAL_OFFICER',   'triage_patient',                'allowed'),
        ('MEDICAL_OFFICER_SG','triage_patient',                'allowed'),
        ('CONSULTANT',        'triage_patient',                'allowed'),
        ('SENIOR_CONSULTANT', 'triage_patient',                'allowed'),
        ('CLINICAL_OFFICER',  'triage_patient',                'allowed'),
        ('NURSE',             'triage_downgrade',              'blocked'),
        ('MIDWIFE',           'triage_downgrade',              'blocked'),
        ('SPECIALIST_NURSE',  'triage_downgrade',              'blocked'),
        ('INTERN_DOCTOR',     'triage_downgrade',              'allowed'),
        ('MEDICAL_OFFICER',   'triage_downgrade',              'allowed'),
        ('MEDICAL_OFFICER_SG','triage_downgrade',              'allowed'),
        ('CONSULTANT',        'triage_downgrade',              'allowed'),
        ('SENIOR_CONSULTANT', 'triage_downgrade',              'allowed'),
        ('CLINICAL_OFFICER',  'triage_downgrade',              'allowed')
    ) AS p(cadre_code, action_kind, requirement)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer FROM inserted;
$$;

REVOKE ALL ON FUNCTION private.seed_cosign_policy_defaults(uuid) FROM PUBLIC;


-- ─── 2. Backfill: hospitals with no policy row at all ────────────────
SELECT private.seed_cosign_policy_defaults(h.id)
FROM public.hospitals h
WHERE NOT EXISTS (
  SELECT 1 FROM public.clinical_cosign_policies p WHERE p.hospital_id = h.id
);


-- ─── 3. New hospitals get the defaults at insert ─────────────────────
CREATE OR REPLACE FUNCTION private.hospitals_seed_cosign_policy_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM private.seed_cosign_policy_defaults(NEW.id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.hospitals_seed_cosign_policy_defaults() FROM PUBLIC;

DROP TRIGGER IF EXISTS hospitals_seed_cosign_policy_defaults ON public.hospitals;
CREATE TRIGGER hospitals_seed_cosign_policy_defaults
  AFTER INSERT ON public.hospitals
  FOR EACH ROW EXECUTE FUNCTION private.hospitals_seed_cosign_policy_defaults();
