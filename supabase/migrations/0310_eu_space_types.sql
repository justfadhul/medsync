-- GATED — applied by the owner (`npm run db:migrate`), never auto-run.
-- 0310: EU space types, chair and resus, and the ward an EU is attached to (ADRs 0539, 0540).
--
--   1. hospital_beds_bed_type_check gains 'chair' and 'resus' (0090's 'standard','icu','cot','couch' kept
--      verbatim). NOT VALID as in 0090: new and changed rows are checked; a value written before stays valid.
--   2. hospital_wards.parent_ward_id: the ward an emergency observation ward (EU) sits under, for display
--      only (D3). Only an EU has one, and never itself (hospital_wards_parent_check); deleting the parent
--      clears it. RLS on hospital_wards is unchanged: the column is read and written as the row is.
--
-- ADDITIVE and re-runnable.
-- Reverse: drop hospital_wards.parent_ward_id (and its check); restore 0090's bed type CHECK.

-- ─── 1. Chair and resus spaces ───────────────────────────────────────────
ALTER TABLE public.hospital_beds DROP CONSTRAINT IF EXISTS hospital_beds_bed_type_check;
ALTER TABLE public.hospital_beds ADD CONSTRAINT hospital_beds_bed_type_check
  CHECK (bed_type IS NULL OR bed_type IN ('standard', 'icu', 'cot', 'couch', 'chair', 'resus')) NOT VALID;

-- ─── 2. The ward an EU is attached to ────────────────────────────────────
ALTER TABLE public.hospital_wards
  ADD COLUMN IF NOT EXISTS parent_ward_id uuid REFERENCES public.hospital_wards(id) ON DELETE SET NULL;
ALTER TABLE public.hospital_wards DROP CONSTRAINT IF EXISTS hospital_wards_parent_check;
ALTER TABLE public.hospital_wards ADD CONSTRAINT hospital_wards_parent_check
  CHECK (parent_ward_id IS NULL OR (parent_ward_id <> id AND ward_type = 'emergency_observation'));
