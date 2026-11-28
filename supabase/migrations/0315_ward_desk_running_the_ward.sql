-- 0315 — Running the ward (ADR 0545, Phase 4).
--
-- ADDITIVE. Six new tables, no row changed. Every table is append-only: a change of state is a new row naming the
-- one it ends (replaces_id), or a decision row against the request.
--   1. ward_calendar_events: activities of a ward or a department (ward meeting, teaching, audit, M&M, ...), who is
--      told (audiences), and whether they are shared with the department. Cancelling is a new row (state cancelled).
--   2. ward_calendar_attendance: a staff member asks to go; the in-charge or head of department decides (going or
--      declined). Each is a row; the latest row per person and event stands.
--   3. staff_leave_requests: any staff member asks for leave; a decision is a new row (approved or declined) naming
--      the request. Approved leave is what the rota reads alongside its own blocks.
--   4. safety_incidents: falls, pressure injuries and other harms on a ward, with the harm level. Entered in error is
--      a new row naming the report.
--   5. handover_patient_notes: SBAR for one patient at one shift change, with the tasks handed on.
--   6. handover_receipts: the next nurse received the patient at the bedside.
--   All: RLS forced; the clinical reader may read the two patient-bearing tables (incidents with a patient, handover
--   notes) for patients it can reach; writes revoked from anon and authenticated (the server writes as the owner);
--   audit triggers.
--
-- Re-runnable: CREATE TABLE / INDEX IF NOT EXISTS, DROP-then-CREATE for triggers and policies.
--
-- GATED: owner-applied (`npm run db:migrate`). Until it runs the calendar, leave, incident and SBAR pages say they are
-- not set up here; NURSE_WARD_V2 decides whether they show at all.


-- ─── 1. ward_calendar_events ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ward_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.hospital_departments(id) ON DELETE RESTRICT,
  ward_id uuid REFERENCES public.hospital_wards(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  title text NOT NULL,
  place text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  lead_name text,
  audiences text[] NOT NULL DEFAULT '{}',
  shared_with_department boolean NOT NULL DEFAULT false,
  asks text,
  state text NOT NULL DEFAULT 'active',
  replaces_id uuid REFERENCES public.ward_calendar_events(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_key text,
  CONSTRAINT wce_kind_check CHECK (kind IN ('ward_meeting','teaching','audit','infection_control','stock','department_meeting','mortality_audit','clinic','other')),
  CONSTRAINT wce_state_check CHECK (state IN ('active','cancelled')),
  CONSTRAINT wce_time_check CHECK (ends_at > starts_at),
  CONSTRAINT wce_place_check CHECK (ward_id IS NOT NULL OR department_id IS NOT NULL),
  CONSTRAINT wce_cancel_check CHECK (state = 'active' OR replaces_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS ward_calendar_events_when ON public.ward_calendar_events (hospital_id, starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS ward_calendar_events_replaces ON public.ward_calendar_events (replaces_id) WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ward_calendar_events_client_key ON public.ward_calendar_events (client_key) WHERE client_key IS NOT NULL;

-- ─── 2. ward_calendar_attendance ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ward_calendar_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.ward_calendar_events(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_key text,
  CONSTRAINT wca_kind_check CHECK (kind IN ('asked','going','declined')));
CREATE INDEX IF NOT EXISTS ward_calendar_attendance_event ON public.ward_calendar_attendance (event_id, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS ward_calendar_attendance_client_key ON public.ward_calendar_attendance (client_key) WHERE client_key IS NOT NULL;

-- ─── 3. staff_leave_requests ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.hospital_departments(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  note text,
  state text NOT NULL DEFAULT 'asked',
  replaces_id uuid REFERENCES public.staff_leave_requests(id) ON DELETE RESTRICT,
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_key text,
  CONSTRAINT slr_kind_check CHECK (kind IN ('annual','sick','study','maternity','compassionate','other')),
  CONSTRAINT slr_state_check CHECK (state IN ('asked','approved','declined','withdrawn')),
  CONSTRAINT slr_dates_check CHECK (ends_on >= starts_on),
  CONSTRAINT slr_decision_check CHECK (state = 'asked' OR replaces_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS staff_leave_requests_user ON public.staff_leave_requests (hospital_id, user_id, starts_on);
CREATE UNIQUE INDEX IF NOT EXISTS staff_leave_requests_replaces ON public.staff_leave_requests (replaces_id) WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_leave_requests_client_key ON public.staff_leave_requests (client_key) WHERE client_key IS NOT NULL;

-- ─── 4. safety_incidents ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  ward_id uuid REFERENCES public.hospital_wards(id) ON DELETE RESTRICT,
  patient_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  harm text NOT NULL,
  occurred_at timestamptz NOT NULL,
  description text NOT NULL,
  state text NOT NULL DEFAULT 'reported',
  replaces_id uuid REFERENCES public.safety_incidents(id) ON DELETE RESTRICT,
  reported_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_key text,
  CONSTRAINT si_kind_check CHECK (kind IN ('fall','pressure_injury','medication','other')),
  CONSTRAINT si_harm_check CHECK (harm IN ('none','low','moderate','severe','death')),
  CONSTRAINT si_state_check CHECK (state IN ('reported','entered_in_error')),
  CONSTRAINT si_error_check CHECK (state = 'reported' OR replaces_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS safety_incidents_ward ON public.safety_incidents (hospital_id, ward_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS safety_incidents_replaces ON public.safety_incidents (replaces_id) WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS safety_incidents_client_key ON public.safety_incidents (client_key) WHERE client_key IS NOT NULL;

-- ─── 5. handover_patient_notes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.handover_patient_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  ward_id uuid REFERENCES public.hospital_wards(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  situation text NOT NULL,
  background text,
  assessment text,
  recommendation text,
  tasks text[] NOT NULL DEFAULT '{}',
  written_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  written_at timestamptz NOT NULL DEFAULT now(),
  client_key text,
  CONSTRAINT hpn_tasks_check CHECK (cardinality(tasks) <= 20));
CREATE INDEX IF NOT EXISTS handover_patient_notes_patient ON public.handover_patient_notes (hospital_id, patient_user_id, written_at);
CREATE UNIQUE INDEX IF NOT EXISTS handover_patient_notes_client_key ON public.handover_patient_notes (client_key) WHERE client_key IS NOT NULL;

-- ─── 6. handover_receipts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.handover_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  note_id uuid NOT NULL REFERENCES public.handover_patient_notes(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  received_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_one_per_note UNIQUE (note_id));

-- ─── 7. Append-only, audit, RLS ──────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ward_calendar_events','ward_calendar_attendance','staff_leave_requests',
                           'safety_incidents','handover_patient_notes','handover_receipts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_mutation', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only()', t || '_no_mutation', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'audit_' || t, t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes()', 'audit_' || t, t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS handover_patient_notes_select_clinical ON public.handover_patient_notes;
CREATE POLICY handover_patient_notes_select_clinical ON public.handover_patient_notes FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
GRANT SELECT ON public.handover_patient_notes TO medsync_clinical_reader;
DROP POLICY IF EXISTS handover_receipts_select_clinical ON public.handover_receipts;
CREATE POLICY handover_receipts_select_clinical ON public.handover_receipts FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
GRANT SELECT ON public.handover_receipts TO medsync_clinical_reader;
