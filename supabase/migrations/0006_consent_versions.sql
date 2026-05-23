-- 0006 — consent_versions lookup (onboarding GATE A, Q5 answer).
--
-- First-class consent text. Phase 0's `consent_records` already
-- captures who agreed to what + when, with a SHA-256 of the exact
-- text they saw. This adds a queryable record of the text itself so
-- regulators asking "show me the exact text the patient agreed to
-- on 2026-05-23" becomes a single join, not a git-history walk.
--
-- The existing `consent_records.version` (text) is the link — at
-- consent time, the action looks up the active row in
-- `consent_versions` for that (consent_type, effective_date) and
-- the SHA-256 of `consent_versions.text` MUST match what gets
-- written to `consent_records.consent_text_sha256`. The hash
-- mechanism Phase 0 designed remains the proof; this table just
-- holds the text alongside it.
--
-- consent_versions is append-only by convention (you don't edit
-- a shipped version — you supersede it by inserting a new one
-- pointing at the prior via `supersedes_id`).

CREATE TABLE IF NOT EXISTS public.consent_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_type    text NOT NULL,
  version         text NOT NULL,
  effective_date  date NOT NULL,
  -- Optional pointer to the prior version this one replaces.
  supersedes_id   uuid REFERENCES public.consent_versions(id) ON DELETE SET NULL,
  -- The actual legal text the user is asked to agree to.
  body            text NOT NULL,
  -- Sha256 of `body` — cross-validates against
  -- consent_records.consent_text_sha256 at write time.
  body_sha256     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_versions_type_check
    CHECK (consent_type IN ('data_processing', 'sms_communication', 'research_use', 'third_party_share'))
);

CREATE UNIQUE INDEX IF NOT EXISTS consent_versions_unique
  ON public.consent_versions(consent_type, version);
CREATE INDEX IF NOT EXISTS consent_versions_type_effective_idx
  ON public.consent_versions(consent_type, effective_date DESC);

-- ─── RLS — public read (the text is legally surfaced anyway) ─────────
GRANT SELECT ON public.consent_versions TO anon, authenticated;
ALTER TABLE public.consent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_versions_select_public ON public.consent_versions;
CREATE POLICY consent_versions_select_public ON public.consent_versions
  FOR SELECT TO anon, authenticated
  USING (true);

-- Mutations go through migrations / service-role only.

-- ─── Audit trigger (Phase 0 pattern) ────────────────────────────────────
DROP TRIGGER IF EXISTS consent_versions_audit ON public.consent_versions;
CREATE TRIGGER consent_versions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.consent_versions
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
