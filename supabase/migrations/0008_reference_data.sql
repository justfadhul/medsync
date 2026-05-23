-- 0008 — reference data layer (onboarding GATE A).
--
-- Nine tables, all public-read RLS (the signup forms hit them
-- pre-auth):
--
--   reference_data_versions   provenance log (dataset × source × date)
--   regions                   Uganda statistical regions (4)
--   districts                 Uganda districts (cascading from region)
--   subcounties               Uganda subcounties (cascading from district)
--   councils                  4 statutory clinical councils
--   cadres                    Council-mapped professional ladder rungs
--   cadre_grades              Career grades within a cadre
--   specialties               Clinical specialties (self-referential parent_id)
--   roles                     Position within a department (cadre + optional specialty)
--
-- Per the schema proposal:
--   - All seed UUIDs are fixed in 0009 so FKs from later domain
--     tables (patient_profiles.district_id, staff_affiliations.cadre_id
--     etc.) stay stable across re-seeds.
--   - All tables get the Phase 0 audit trigger and the
--     set_updated_at() trigger where they carry updated_at.
--   - Mutations are migrations-only (no anon/authenticated write
--     policy). Catalog updates ship as new migrations + a new
--     reference_data_versions row.

-- ─── Provenance log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reference_data_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset       text NOT NULL,
  source        text NOT NULL,
  source_url    text,
  version_date  text NOT NULL,
  row_count     integer,
  notes         text,
  applied_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reference_data_versions_unique
  ON public.reference_data_versions(dataset, version_date);
CREATE INDEX IF NOT EXISTS reference_data_versions_dataset_idx
  ON public.reference_data_versions(dataset);

-- ─── Geography ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.regions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS regions_code_unique ON public.regions(code);

CREATE TABLE IF NOT EXISTS public.districts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id   uuid NOT NULL REFERENCES public.regions(id) ON DELETE RESTRICT,
  code        text NOT NULL,
  name        text NOT NULL,
  is_city     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS districts_code_unique ON public.districts(code);
CREATE INDEX IF NOT EXISTS districts_region_idx ON public.districts(region_id);
CREATE INDEX IF NOT EXISTS districts_name_idx ON public.districts(name);

CREATE TABLE IF NOT EXISTS public.subcounties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id   uuid NOT NULL REFERENCES public.districts(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subcounties_district_code_unique
  ON public.subcounties(district_id, code);
CREATE INDEX IF NOT EXISTS subcounties_district_idx ON public.subcounties(district_id);

-- ─── Clinical catalog ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.councils (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  name          text NOT NULL,
  short_name    text NOT NULL,
  register_url  text,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS councils_code_unique ON public.councils(code);

CREATE TABLE IF NOT EXISTS public.cadres (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  council_id    uuid NOT NULL REFERENCES public.councils(id) ON DELETE RESTRICT,
  code          text NOT NULL,
  name          text NOT NULL,
  description   text,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cadres_code_unique ON public.cadres(code);
CREATE INDEX IF NOT EXISTS cadres_council_idx ON public.cadres(council_id);

CREATE TABLE IF NOT EXISTS public.cadre_grades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cadre_id      uuid NOT NULL REFERENCES public.cadres(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cadre_grades_cadre_code_unique
  ON public.cadre_grades(cadre_id, code);
CREATE INDEX IF NOT EXISTS cadre_grades_cadre_idx ON public.cadre_grades(cadre_id);

CREATE TABLE IF NOT EXISTS public.specialties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name        text NOT NULL,
  parent_id   uuid REFERENCES public.specialties(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS specialties_code_unique ON public.specialties(code);
CREATE INDEX IF NOT EXISTS specialties_parent_idx ON public.specialties(parent_id);

CREATE TABLE IF NOT EXISTS public.roles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cadre_id            uuid NOT NULL REFERENCES public.cadres(id) ON DELETE RESTRICT,
  specialty_id        uuid REFERENCES public.specialties(id) ON DELETE SET NULL,
  code                text NOT NULL,
  name                text NOT NULL,
  department_family   text NOT NULL,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_code_unique ON public.roles(code);
CREATE INDEX IF NOT EXISTS roles_cadre_idx ON public.roles(cadre_id);
CREATE INDEX IF NOT EXISTS roles_specialty_idx ON public.roles(specialty_id);
CREATE INDEX IF NOT EXISTS roles_dept_family_idx ON public.roles(department_family);

-- ─── RLS — public read for every reference table ────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.reference_data_versions  TO anon, authenticated;
GRANT SELECT ON public.regions                  TO anon, authenticated;
GRANT SELECT ON public.districts                TO anon, authenticated;
GRANT SELECT ON public.subcounties              TO anon, authenticated;
GRANT SELECT ON public.councils                 TO anon, authenticated;
GRANT SELECT ON public.cadres                   TO anon, authenticated;
GRANT SELECT ON public.cadre_grades             TO anon, authenticated;
GRANT SELECT ON public.specialties              TO anon, authenticated;
GRANT SELECT ON public.roles                    TO anon, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'reference_data_versions','regions','districts','subcounties',
      'councils','cadres','cadre_grades','specialties','roles'
    ]) AS t
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', r.t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select_public ON public.%I;', r.t, r.t);
    EXECUTE format(
      'CREATE POLICY %I_select_public ON public.%I FOR SELECT TO anon, authenticated USING (true);',
      r.t, r.t
    );
  END LOOP;
END $$;

-- ─── Audit triggers (Phase 0 pattern) ───────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'reference_data_versions','regions','districts','subcounties',
      'councils','cadres','cadre_grades','specialties','roles'
    ]) AS t
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON public.%I;', r.t, r.t);
    EXECUTE format(
      'CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();',
      r.t, r.t
    );
  END LOOP;
END $$;
