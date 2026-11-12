-- 0288 — Staff need MFA (aal2) below the web pages too (senior review 2026-11-11: C-2).
--
-- The web scopes already refuse a staff session that has not passed MFA. PostgREST, Realtime and the Edge Functions did
-- not, so a phished password alone reached them. One rule now serves both layers:
--
--   public.caller_mfa_ok() is true when the caller's token is aal2, or the caller is not staff, or the development switch
--   is on. Staff = a non-patient row in user_roles, or an approved or active staff affiliation (what the web scopes treat
--   as staff). Edge Functions call it through `getCaller`, with the caller's own token.
--
--   Every table with RLS in public and pharmacy_practice gets a RESTRICTIVE policy, for `authenticated` only, that
--   requires it. The app's own roles (Drizzle as owner, medsync_clinical_reader, the NCD roles) are not `authenticated`,
--   so their paths are unchanged.
--
-- Development: the web skips MFA with DEV_SKIP_MFA=1. To let those aal1 sessions through here as well, on a development
-- database only:   INSERT INTO private.dev_switches (name) VALUES ('skip_mfa');
-- Never on production. Remove it with DELETE ... WHERE name = 'skip_mfa'.
--
-- A table created after this migration needs its own `mfa_gate` policy; tests/auth/mfa-below-pages.test.ts names the rule.
--
-- GATED: owner-applied (`npm run db:migrate`), after 0287.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.dev_switches (
  name text PRIMARY KEY CHECK (name IN ('skip_mfa'))
);
ALTER TABLE private.dev_switches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.dev_switches FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.caller_mfa_ok()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NULL
      OR coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      OR EXISTS (SELECT 1 FROM private.dev_switches WHERE name = 'skip_mfa')
      OR NOT (
        EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role <> 'patient')
        OR EXISTS (SELECT 1 FROM public.staff_affiliations
                   WHERE user_id = auth.uid() AND state IN ('active', 'approved'))
      );
$$;

REVOKE ALL ON FUNCTION public.caller_mfa_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_mfa_ok() TO anon, authenticated;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND n.nspname IN ('public', 'pharmacy_practice')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_gate ON %I.%I', t.schema_name, t.table_name);
    EXECUTE format(
      'CREATE POLICY mfa_gate ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()))',
      t.schema_name, t.table_name);
  END LOOP;
END
$$;
