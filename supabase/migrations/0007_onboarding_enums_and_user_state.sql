-- 0007 — onboarding enums + the single Phase 0 column add (GATE A).
--
-- Adds the two enums every onboarding table depends on:
--   - public.lifecycle_state — the state machine in lib/lifecycle.ts
--   - public.facility_level  — Uganda MoH facility taxonomy
--
-- And adds the single Phase 0 schema touch the schema proposal
-- approved: users.state. Existing Phase 0 rows backfill to
-- 'verified' (the realistic state for any seeded / test user from
-- before the onboarding system existed); new rows default to
-- 'unverified' (the normal signup path: account created → verify
-- contact → state advances).

-- ─── Lifecycle state enum ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.lifecycle_state AS ENUM (
    'unverified',
    'verified',
    'pending_approval',
    'approved',
    'active',
    'rejected',
    'suspended',
    'deactivated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Facility level enum (Uganda MoH taxonomy) ──────────────────────────
DO $$ BEGIN
  CREATE TYPE public.facility_level AS ENUM (
    'hc_ii',
    'hc_iii',
    'hc_iv',
    'general',
    'regional_referral',
    'national_referral',
    'private',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── users.state column (Phase 0 backfill, additive) ────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS state public.lifecycle_state NOT NULL DEFAULT 'unverified';

-- Backfill any existing rows (from Phase 0 seed / test fixtures) to
-- 'verified' — they pre-date the onboarding system, so 'unverified'
-- would be a false signal.
UPDATE public.users SET state = 'verified' WHERE state = 'unverified';

-- For NEW rows (post-this-migration), the default 'unverified' is
-- the correct starting state: the signup actions advance it after
-- contact verification.
ALTER TABLE public.users ALTER COLUMN state SET DEFAULT 'unverified';
