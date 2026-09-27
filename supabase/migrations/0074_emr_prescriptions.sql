-- 0074 — EMR prescriptions: an outpatient prescription on the 0039 anchor.
--
-- Per docs/emr/PROMPT-ENCOUNTER-EMR.md Phase 7 and D-EMR-14 (signed as recommended by the owner and
-- CSO, 2026-09-26, in session), HARMONISATION §5.5.
--
-- ADDITIVE. No new table, no row changed; 0039's columns, CHECKs and policies keep their meaning.
-- 0039 could not hold an OPD prescription: it has no frequency, duration, quantity or instructions,
-- no idempotency key, no sensitivity and nowhere to record a confirmed safety check. So:
--   1. prescriptions + frequency, duration, quantity, instructions (ciphertext), prescriber cadre,
--      the confirmed checks (flag codes) and their reason (ciphertext; required when a check fired),
--      client_key (unique), sensitivity, and the medication_statements row written with it.
--      An OPD row is is_emergency = false; the column default stays true for the resus path.
--   2. medsync_clinical_reader: SELECT, scoped by the one access rule (as 0071 scopes its tables)
--   3. a RESTRICTIVE policy: 0039 lets a patient read their own prescriptions through the client
--      key; a restricted one stays hidden until Gate CG (as 0071 does for CFC rows)
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, DROP-then-ADD for constraints and policies.
--
-- GATED: owner-applied (`npm run db:migrate`), after 0071. Until it runs, EMR_PRESCRIBING stays off:
-- the write path names these columns.


-- ─── 1. prescriptions: the OPD columns ───────────────────────────────
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS frequency text,
  ADD COLUMN IF NOT EXISTS duration text,
  ADD COLUMN IF NOT EXISTS quantity text,
  ADD COLUMN IF NOT EXISTS instructions_ciphertext text,
  ADD COLUMN IF NOT EXISTS prescriber_cadre text,
  ADD COLUMN IF NOT EXISTS confirmed_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS confirm_reason_ciphertext text,
  ADD COLUMN IF NOT EXISTS client_key text,
  ADD COLUMN IF NOT EXISTS sensitivity text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS medication_statement_id uuid
    REFERENCES public.medication_statements(id) ON DELETE RESTRICT;

ALTER TABLE public.prescriptions DROP CONSTRAINT IF EXISTS prescriptions_sensitivity_check;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_sensitivity_check
  CHECK (sensitivity IN ('standard','restricted'));
-- A check that fired is never a silent pass: its reason is on the row.
ALTER TABLE public.prescriptions DROP CONSTRAINT IF EXISTS prescriptions_confirm_reason;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_confirm_reason
  CHECK (confirmed_flags = '[]'::jsonb OR confirm_reason_ciphertext IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS prescriptions_client_key
  ON public.prescriptions (client_key) WHERE client_key IS NOT NULL;


-- ─── 2. the reader ───────────────────────────────────────────────────
DROP POLICY IF EXISTS prescriptions_select_clinical ON public.prescriptions;
CREATE POLICY prescriptions_select_clinical ON public.prescriptions FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
GRANT SELECT ON public.prescriptions TO medsync_clinical_reader;


-- ─── 3. restricted prescriptions stay off the patient's client ───────
DROP POLICY IF EXISTS prescriptions_restricted_not_client ON public.prescriptions;
CREATE POLICY prescriptions_restricted_not_client ON public.prescriptions
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (sensitivity = 'standard' OR patient_user_id IS DISTINCT FROM auth.uid());
