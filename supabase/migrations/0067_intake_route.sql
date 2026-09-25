-- 0067 — Where reception sent an arrival: triage, or straight to the clinic (ADR 0101).
--
-- ⚠️ GATED — DO NOT APPLY TO PRODUCTION WITHOUT EXPLICIT, NAMED OWNER
-- AUTHORIZATION. Apply via `npm run db:migrate`, AFTER 0066.
--
-- Owner/CSO ruling 2026-09-23 (ADR 0101): at check-in the desk chooses where
-- an arrival goes — to triage (the default, and the only choice for an
-- emergency entry) or straight to the clinic's queue. The choice is recorded
-- on the intake so the triage worklist can leave clinic-routed arrivals out
-- without inventing a triage that never happened, and so the audit trail and
-- the boards can say which door the patient was sent through.
--
-- NULL is every row written before this migration: it keeps today's meaning,
-- which is triage. Purely additive — no rewrite, no new audit verb (the route
-- rides in the existing `check_in_patient` audit row's after_data).
--
-- Sequencing: apply this, then deploy ha-check-in-patient, ha-register-intake,
-- ha-pre-arrival-arrived, ha-start-encounter and ha-complete-encounter, then
-- the web.

ALTER TABLE public.patient_intakes
  ADD COLUMN IF NOT EXISTS routed_to text;

ALTER TABLE public.patient_intakes
  DROP CONSTRAINT IF EXISTS intakes_routed_to_check;
ALTER TABLE public.patient_intakes
  ADD CONSTRAINT intakes_routed_to_check
  CHECK (routed_to IS NULL OR routed_to IN ('triage', 'clinic'));

COMMENT ON COLUMN public.patient_intakes.routed_to IS
  'ADR 0101: where the desk sent this arrival at check-in. NULL = legacy (triage).';
