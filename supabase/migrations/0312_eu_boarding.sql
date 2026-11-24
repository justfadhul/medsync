-- GATED — applied by the owner (`npm run db:migrate`), never auto-run; after 0311.
-- 0312: boarding, admit from the EU and keep the EU space until the ward's Arrived (ADR 0542).
--
--   1. bed_assignments: one Occupied plus one Arriving place per patient. 0090's one-open-per-patient index is
--      replaced by bed_assignments_one_occupied_per_patient (arrived, or a direct assignment with no admission
--      and no stay) and bed_assignments_one_arriving_per_patient (not arrived, for an admission or a stay). The
--      new indexes are created before the old one is dropped, so uniqueness never lapses; every live row already
--      satisfies them (the old index allowed one open row per patient). This changes live indexes on a table in
--      production use; proven over live-shaped rows on the PGlite lane (tests/emr-db/eu-boarding-index.test.ts).
--   2. Admit from the EU (a boarder): admit_from_encounter, admissions_guard and confirm_bed_arrival; the
--      inpatient record opens at the decision to admit for boarders (D6), and the ward's Arrived ends the EU
--      space and the stay in the same transaction.
--
-- ADDITIVE and re-runnable.
-- Reverse (section 1): with at most one open assignment per patient, recreate 0090's
-- bed_assignments_one_open_per_patient, then drop the two indexes of section 1.

-- ─── 1. One Occupied plus one Arriving per patient ───────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS bed_assignments_one_occupied_per_patient
  ON public.bed_assignments (patient_user_id)
  WHERE ended_at IS NULL AND (arrived_at IS NOT NULL OR (admission_id IS NULL AND eu_stay_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS bed_assignments_one_arriving_per_patient
  ON public.bed_assignments (patient_user_id)
  WHERE ended_at IS NULL AND arrived_at IS NULL AND (admission_id IS NOT NULL OR eu_stay_id IS NOT NULL);
DROP INDEX IF EXISTS public.bed_assignments_one_open_per_patient;
