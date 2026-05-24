-- 0010 — signup_drafts (onboarding GATE A).
--
-- Server-side persistence for multi-step onboarding forms. Per
-- kickoff §A.8, progress is saved so a dropped connection doesn't
-- lose a half-filled form.
--
-- Owner-key contract (lib/signup-drafts.ts):
--   - Pre-account: lowercased email (the form's first collected field)
--   - Mid-flow with account: auth.uid()::text
--
-- Sensitive fields inside `payload`:
--   - The caller MUST encrypt PHI (NIN, phone, names) via
--     lib/encryption.ts BEFORE handing the payload to saveDraft.
--   - The drafts table treats `payload` as opaque JSONB.
--
-- TTL: 14 days from last touch. Sweeper cron lands in GATE G.
--
-- RLS:
--   - Authenticated: own-only (owner_key = auth.uid()::text)
--   - Pre-account: no anon policy. The server-issued rotating
--     access_token in a signed cookie authorises later resumes
--     via the service-role client; RLS is the second line.

CREATE TABLE IF NOT EXISTS public.signup_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_kind    text NOT NULL,
  owner_key     text NOT NULL,
  -- Server-issued rotating token; signed-cookie-carried for pre-
  -- account resume. Null once the draft is owned by an
  -- authenticated user.
  access_token  text,
  payload       jsonb NOT NULL,
  current_step  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  CONSTRAINT signup_drafts_kind_check
    CHECK (draft_kind IN ('patient', 'clinical', 'hospital'))
);

CREATE UNIQUE INDEX IF NOT EXISTS signup_drafts_owner_kind_unique
  ON public.signup_drafts(draft_kind, owner_key);
CREATE INDEX IF NOT EXISTS signup_drafts_expires_idx
  ON public.signup_drafts(expires_at);

-- ─── set_updated_at trigger (Phase 0 helper from 0001) ──────────────────
DROP TRIGGER IF EXISTS signup_drafts_set_updated_at ON public.signup_drafts;
CREATE TRIGGER signup_drafts_set_updated_at
  BEFORE UPDATE ON public.signup_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_drafts TO authenticated;

ALTER TABLE public.signup_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_drafts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signup_drafts_owner ON public.signup_drafts;
CREATE POLICY signup_drafts_owner ON public.signup_drafts
  FOR ALL TO authenticated
  USING (owner_key = (SELECT auth.uid())::text)
  WITH CHECK (owner_key = (SELECT auth.uid())::text);

-- Anon-tier drafts (pre-account flows) are written/read by the
-- server action via service-role only — there is NO anon RLS path.
-- The access_token in the signed cookie is what authorises the
-- server action; this RLS denial is the second line.

-- NOT audited (per schema proposal): transient form state, not
-- system-of-record. Auditing every keystroke would balloon
-- audit_log with no forensic value.
