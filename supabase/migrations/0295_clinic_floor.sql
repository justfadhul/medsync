-- GATED — applied by the owner (`npm run db:migrate`), never auto-run.
-- 0295: the Tether clinic floor's data gaps (docs/clinic-floor/gate-a-proposal.md §3–4, ADRs 0491–0497).
-- One append-only event log for the floor: calls, here, didn't come, doctor status, tests, finish, running late,
-- end session, user switch and the floor's side of a triage (which re-check band the engine gave). The triage
-- itself stays in triage_records (no change to engine tables). Written and read only by service-role server
-- actions and loaders after the floor scope check: RLS on with no client policy (deny), plus the MFA gate.
-- No name, phone or vital sign is stored here; `note` (nurse → doctor) is read by clinical loaders only.

CREATE TABLE IF NOT EXISTS public.clinic_floor_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  intake_id        uuid REFERENCES public.patient_intakes(id) ON DELETE CASCADE,
  department_id    uuid REFERENCES public.hospital_departments(id) ON DELETE SET NULL,
  doctor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  triage_record_id uuid REFERENCES public.triage_records(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind IN (
                     'triaged', 'rechecked', 'call', 'call_again', 'here', 'didnt_come', 'doctor_status',
                     'sent_for_tests', 'finish', 'running_late', 'end_session', 'moved', 'user_switch')),
  detail           text CHECK (detail IS NULL OR detail IN (
                     'in_room', 'break_10', 'break_15', 'break_30', 'away',
                     'home', 'pharmacy_home', 'tests_back', 'admitted', 'referred', 'didnt_wait',
                     'continuous', 'hourly', '4-6h', '12h', 'short',
                     'next_day', 'other_doctor', 'handed_over')),
  room             text CHECK (room IS NULL OR length(room) <= 40),
  note             text CHECK (note IS NULL OR length(note) <= 280),
  client_id        uuid NOT NULL,
  by_user_id       uuid NOT NULL REFERENCES auth.users(id),
  at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_floor_events_client_unique UNIQUE (hospital_id, client_id),
  CONSTRAINT clinic_floor_events_visit_kinds CHECK (
    kind IN ('doctor_status', 'running_late', 'end_session', 'user_switch') OR intake_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS clinic_floor_events_day
  ON public.clinic_floor_events (hospital_id, at DESC);
CREATE INDEX IF NOT EXISTS clinic_floor_events_intake
  ON public.clinic_floor_events (intake_id, at) WHERE intake_id IS NOT NULL;

ALTER TABLE public.clinic_floor_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_floor_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_gate ON public.clinic_floor_events;
CREATE POLICY mfa_gate ON public.clinic_floor_events AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));
-- Append-only (CF9): no client policy; nobody updates or deletes.
REVOKE UPDATE, DELETE ON public.clinic_floor_events FROM PUBLIC, anon, authenticated, service_role;
