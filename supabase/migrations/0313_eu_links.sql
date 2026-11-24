-- GATED — applied by the owner (`npm run db:migrate`), never auto-run; after 0312.
-- 0313: EU links (ADRs 0543, 0544).
--
--   1. phi_access_basis_check gains 'eu_staff' (0101's list kept verbatim): the true basis for a name on the EU
--      list (D10) shown to EU staff (the ward's nurses and in-charge, the rota's EU doctor, the hospital admin)
--      who hold no chart basis for that patient. 'assigned' stays a nursing assignment for the patient.
--   Later sections come from Tasks 24–26.
--
-- ADDITIVE and re-runnable.
-- Reverse: restore 0101's phi_access_basis_check (after removing any 'eu_staff' rows).

-- ─── 1. Log an EU list name truthfully ───────────────────────────────────
ALTER TABLE public.clinical_phi_access_log DROP CONSTRAINT IF EXISTS phi_access_basis_check;
ALTER TABLE public.clinical_phi_access_log ADD CONSTRAINT phi_access_basis_check CHECK (access_basis IN
  ('care_team','active_encounter','department_recent','break_glass',     -- 0030, kept
   'assigned','open_intake',                                             -- 0071, kept
   'lab_work',                                                           -- 0101, kept
   'eu_staff'));                                                         -- 0313
