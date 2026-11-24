-- GATED — applied by the owner (`npm run db:migrate`), never auto-run; after 0312.
-- 0313: EU links (ADRs 0543, 0544).
--
--   1. phi_access_basis_check gains 'eu_staff' (0101's list kept verbatim): the true basis for a name on the EU
--      list (D10) shown to EU staff (the ward's nurses and in-charge, the rota's EU doctor, the hospital admin)
--      who hold no chart basis for that patient. 'assigned' stays a nursing assignment for the patient.
--   2. clinic_floor_events_detail_check (0295's inline CHECK, Postgres's name) gains 'eu' (0295's list kept
--      verbatim): a floor visit the doctor sent to the EU ends as "Observed in EU". ha-eu-stay writes that finish,
--      keyed by the stay's intake; the floor's own Finish dialog never offers it (D8).
--   Later sections come from Tasks 25–26.
--
-- ADDITIVE and re-runnable.
-- Reverse: restore 0101's phi_access_basis_check (after removing any 'eu_staff' rows); restore 0295's
-- clinic_floor_events detail list only while no 'eu' row exists (that log is append-only).

-- ─── 1. Log an EU list name truthfully ───────────────────────────────────
ALTER TABLE public.clinical_phi_access_log DROP CONSTRAINT IF EXISTS phi_access_basis_check;
ALTER TABLE public.clinical_phi_access_log ADD CONSTRAINT phi_access_basis_check CHECK (access_basis IN
  ('care_team','active_encounter','department_recent','break_glass',     -- 0030, kept
   'assigned','open_intake',                                             -- 0071, kept
   'lab_work',                                                           -- 0101, kept
   'eu_staff'));                                                         -- 0313

-- ─── 2. The floor's Observed in EU outcome ───────────────────────────────
ALTER TABLE public.clinic_floor_events DROP CONSTRAINT IF EXISTS clinic_floor_events_detail_check;
ALTER TABLE public.clinic_floor_events ADD CONSTRAINT clinic_floor_events_detail_check CHECK (
  detail IS NULL OR detail IN (
    'in_room', 'break_10', 'break_15', 'break_30', 'away',                -- 0295, kept
    'home', 'pharmacy_home', 'tests_back', 'admitted', 'referred', 'didnt_wait',
    'continuous', 'hourly', '4-6h', '12h', 'short',
    'next_day', 'other_doctor', 'handed_over',
    'eu'));                                                               -- 0313
