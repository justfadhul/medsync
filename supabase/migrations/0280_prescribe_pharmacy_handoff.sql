-- 0280 — The pharmacy hand-off for the one Prescribe (prescribing kit P2 (a), F4).
--
-- GATED: owner-applied (`npm run db:migrate`), after 0279.
--
--   pharmacy_handovers.explained_attested: the supplier confirmed "I checked who they are, and
--   explained how to take each medicine" at the hand-over. Required by the hand-over action only where
--   PRESCRIBE_V2 is on; false on every row written before this migration and wherever the flag is off
--   (no backfill: an inferred confirmation would look like a recorded one).
--
-- Nothing else is stored: the line states the prescriber sees are folded from the existing record
-- (pharmacy_line_events, pharmacy_queries, co-sign), and resus lines (prescriptions.prescribe_place =
-- 'resus', 0279) are kept out of the dispense queue by the pharmacy's reads.
--
-- ADDITIVE and re-runnable. Reverse: drop the column.

ALTER TABLE public.pharmacy_handovers
  ADD COLUMN IF NOT EXISTS explained_attested boolean NOT NULL DEFAULT false;
