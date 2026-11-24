-- GATED — applied by the owner (`npm run db:migrate`), never auto-run.
-- 0310: EU space types, chair and resus, and the ward an EU is attached to (ADRs 0539, 0540).
--
--   1. hospital_beds_bed_type_check gains 'chair' and 'resus' (0090's 'standard','icu','cot','couch' kept
--      verbatim). NOT VALID as in 0090: new and changed rows are checked; a value written before stays valid.
--   2. hospital_wards.parent_ward_id: the ward an emergency observation ward (EU) sits under, for display
--      only (D3). Only an EU has one, and never itself (hospital_wards_parent_check); deleting the parent
--      clears it. RLS on hospital_wards is unchanged: the column is read and written as the row is.
--   3. hospital_wards_parent_guard (BEFORE INSERT OR UPDATE): refuses (check_violation, HINT
--      'ward_parent_not_ordinary') a parent that is an EU, archived, of another hospital or the ward itself,
--      and (HINT 'ward_has_units') a ward becoming an EU while unarchived EUs point at it. It locks the parent
--      (FOR SHARE) or the ward itself (FOR UPDATE), so two concurrent saves cannot leave an EU under an EU.
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

-- ─── 3. The guard: an EU's parent is an ordinary, live ward of the same hospital ──
CREATE OR REPLACE FUNCTION public.hospital_wards_parent_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  IF NEW.parent_ward_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.parent_ward_id IS DISTINCT FROM OLD.parent_ward_id) THEN
    IF NEW.parent_ward_id = NEW.id THEN
      RAISE EXCEPTION 'A ward is not attached to itself' USING ERRCODE = 'check_violation', HINT = 'ward_parent_not_ordinary';
    END IF;
    SELECT hospital_id, ward_type, archived_at INTO p
      FROM public.hospital_wards WHERE id = NEW.parent_ward_id FOR SHARE;
    IF NOT FOUND OR p.hospital_id <> NEW.hospital_id OR p.archived_at IS NOT NULL
       OR p.ward_type = 'emergency_observation' THEN
      RAISE EXCEPTION 'Attach it to an ordinary ward of this hospital' USING ERRCODE = 'check_violation', HINT = 'ward_parent_not_ordinary';
    END IF;
  END IF;
  IF NEW.ward_type = 'emergency_observation'
     AND (TG_OP = 'INSERT' OR OLD.ward_type IS DISTINCT FROM NEW.ward_type) THEN
    -- Take our own row first: a concurrent attach holds it FOR SHARE until it commits, and we then see it.
    IF TG_OP = 'UPDATE' THEN
      PERFORM 1 FROM public.hospital_wards WHERE id = NEW.id FOR UPDATE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.hospital_wards WHERE parent_ward_id = NEW.id AND archived_at IS NULL) THEN
      RAISE EXCEPTION 'Detach its emergency units before making it one' USING ERRCODE = 'check_violation', HINT = 'ward_has_units';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hospital_wards_parent_guard ON public.hospital_wards;
CREATE TRIGGER hospital_wards_parent_guard
  BEFORE INSERT OR UPDATE ON public.hospital_wards
  FOR EACH ROW EXECUTE FUNCTION public.hospital_wards_parent_guard();
