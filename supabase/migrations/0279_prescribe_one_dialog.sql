-- 0279 — One Prescribe dialog from every place that prescribes (prescribing kit P1, F1–F3).
--
-- GATED: owner-applied (`npm run db:migrate`), after 0278.
--
--   1. prescriptions.prescribe_place: where the line was written (clinic visit, clerking plan, ward
--      round, resus, NCD clinic, going home). It names the collect point: resus lines are given from
--      the cart first and only restock it. NULL on every row written before this migration (no
--      backfill: an inferred place would look like a recorded one).
--   2. prescriptions.product_id: the brand the prescriber chose, when one was chosen (NULL = any).
--   3. prescription_drafts: the basket a prescriber closed without sending, one per author, visit and
--      place, so "Resume" brings it back on any device. The lines are the dialog's own (no dose is
--      added here). Written and read only from the server connection; no client grants.
--
-- ADDITIVE and re-runnable. Reverse: drop the table and the two columns.

-- ─── 1–2. prescriptions ─────────────────────────────────────────────
ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS prescribe_place text;
DO $$ BEGIN
  ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_prescribe_place_check
    CHECK (prescribe_place IS NULL
           OR prescribe_place IN ('clinic','clerking','ward','resus','ncd','going_home'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS product_id uuid
  REFERENCES public.pharmacy_products(id) ON DELETE RESTRICT;

-- ─── 3. prescription_drafts ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prescription_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  place text NOT NULL
    CHECK (place IN ('clinic','clerking','ward','resus','ncd','going_home')),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescription_drafts_one UNIQUE (encounter_id, author_user_id, place)
);
CREATE INDEX IF NOT EXISTS prescription_drafts_author_idx
  ON public.prescription_drafts (author_user_id, updated_at DESC);

ALTER TABLE public.prescription_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_drafts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.prescription_drafts FROM anon, authenticated;
