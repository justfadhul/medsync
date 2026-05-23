-- ─────────────────────────────────────────────────────────────────────────
-- 0011_patient_profiles
--
-- GATE C — patient signup. 1:1 with auth.users for the patient role.
-- DOB is plaintext (kickoff Q3) so age-range queries stay possible;
-- everything else identifying is AES-256-GCM ciphertext written by
-- lib/encryption.ts BEFORE the row reaches the DB.
--
-- Patient code: human-readable, DB-issued via `issue_patient_code()` —
-- format `MS-YYYY-NNNNN`. The next number is taken from a per-year
-- sequence so codes are dense within a year and roll over cleanly at
-- midnight Jan 1.
--
-- RLS deny-by-default + FORCE; SELECT own + superadmin; INSERT/UPDATE
-- own. Hospital-side care-team read access is Phase 1.5 (formal
-- care-team membership doesn't exist yet).
-- ─────────────────────────────────────────────────────────────────────────

-- Per-year patient-code sequence. Lives in a dedicated table so the
-- "next N for year Y" is a single UPDATE … RETURNING (atomic, no
-- sequence drift if a year has no signups).
CREATE TABLE IF NOT EXISTS public.patient_code_seq (
  year integer PRIMARY KEY,
  last_n integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.issue_patient_code()
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM now())::integer;
  v_n integer;
BEGIN
  INSERT INTO public.patient_code_seq (year, last_n)
  VALUES (v_year, 1)
  ON CONFLICT (year)
  DO UPDATE SET last_n = public.patient_code_seq.last_n + 1
  RETURNING last_n INTO v_n;

  RETURN format('MS-%s-%s', v_year, lpad(v_n::text, 5, '0'));
END;
$$;

REVOKE ALL ON FUNCTION public.issue_patient_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_patient_code() TO authenticated;

-- ─── patient_profiles ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.patient_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_code text NOT NULL UNIQUE DEFAULT public.issue_patient_code(),

  title_code text,
  first_name_encrypted text NOT NULL,
  surname_encrypted text NOT NULL,

  sex text NOT NULL,
  date_of_birth date NOT NULL,

  id_type text NOT NULL,
  id_number_encrypted text,
  phone_encrypted text NOT NULL,

  district_id uuid NOT NULL REFERENCES public.districts(id) ON DELETE RESTRICT,
  subcounty_id uuid REFERENCES public.subcounties(id) ON DELETE RESTRICT,
  village_address_encrypted text,
  preferred_language text,

  primary_facility_id uuid REFERENCES public.hospitals(id) ON DELETE SET NULL,

  known_conditions text[],

  nok_name_encrypted text,
  nok_relationship text,
  nok_phone_encrypted text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT patient_profiles_title_check
    CHECK (title_code IS NULL OR title_code IN ('mr','ms','mrs','dr','other')),
  CONSTRAINT patient_profiles_sex_check
    CHECK (sex IN ('male','female','intersex','prefer_not_say')),
  CONSTRAINT patient_profiles_id_type_check
    CHECK (id_type IN ('nin','passport','none')),
  -- id_number_encrypted required iff id_type ≠ 'none'
  CONSTRAINT patient_profiles_id_number_match
    CHECK (
      (id_type = 'none'  AND id_number_encrypted IS NULL)
      OR
      (id_type <> 'none' AND id_number_encrypted IS NOT NULL)
    ),
  CONSTRAINT patient_profiles_nok_relationship_check
    CHECK (
      nok_relationship IS NULL
      OR nok_relationship IN (
        'spouse','parent','child','sibling','guardian','friend','other'
      )
    )
);

CREATE INDEX IF NOT EXISTS patient_profiles_district_idx
  ON public.patient_profiles (district_id);
CREATE INDEX IF NOT EXISTS patient_profiles_primary_facility_idx
  ON public.patient_profiles (primary_facility_id);

-- updated_at trigger (function lives from migration 0001).
DROP TRIGGER IF EXISTS set_updated_at ON public.patient_profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.patient_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Audit (function lives from migration 0003).
DROP TRIGGER IF EXISTS audit_patient_profiles ON public.patient_profiles;
CREATE TRIGGER audit_patient_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.patient_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_log_changes();

-- ─── RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.patient_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_profiles FORCE ROW LEVEL SECURITY;

-- SELECT: own row + superadmin.
DROP POLICY IF EXISTS patient_profiles_select_own ON public.patient_profiles;
CREATE POLICY patient_profiles_select_own
  ON public.patient_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.user_has_role('superadmin'));

-- INSERT: only for self. The action layer also enforces this, but
-- defence-in-depth.
DROP POLICY IF EXISTS patient_profiles_insert_own ON public.patient_profiles;
CREATE POLICY patient_profiles_insert_own
  ON public.patient_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- UPDATE: own row. No DELETE policy → users can't delete a profile;
-- account-deletion cascades via auth.users.id FK.
DROP POLICY IF EXISTS patient_profiles_update_own ON public.patient_profiles;
CREATE POLICY patient_profiles_update_own
  ON public.patient_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
