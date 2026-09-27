-- 0071 — EMR record spine: the clinical fact store, notes, orders → results → acknowledgement,
-- allergies, the one patient-access rule and a non-owner reader role.
--
-- Per docs/emr/gate-a-proposal.md §A (signed as recommended by the owner and CSO, 2026-09-26, in
-- session) and docs/emr/HARMONISATION.md §3. The STOP 1 decision is applied: the SELECT policies on
-- allergies and allergy_status_assertions do not require hospital equality — a legitimate basis for
-- the patient at the reader's own hospital shows that patient's allergies from every hospital, each
-- row keeping its hospital_id for provenance (it keeps today's behaviour; the legacy read had no
-- hospital filter).
--
-- ADDITIVE. No UPDATE or DELETE of an existing row; the backfill (§15) only inserts copies.
--   1. private schema, reader role medsync_clinical_reader, transaction-local identity
--   2. registries (config: mutable, audited): clinical_concepts, drug_class_tags, capabilities,
--      facility_capabilities, devices, test_catalogue, diagnosis_terms
--   3. encounters evolved: visit, template, last activity, completion, closure
--   4. clinical_notes (drafts mutable, signed immutable) + clinical_note_events
--   5. clinical_cosign_requests evolved: + sign_note
--   6. encounter_orders evolved (lifecycle legacy|events) + order events, specimens, specimen events,
--      versioned diagnostic_reports
--   7. clinical_observations evolved into the CFC shape; CFC rows immutable, legacy rows keep only
--      the resus active → corrected move
--   8. conditions, medication_statements, pregnancy_episodes, procedures
--   9. allergies + allergy_status_assertions
--  10. result_acknowledgements, critical_result_communications
--  11. clinical_phi_access_log: + the two new SQL bases
--  12. views (security_invoker): *_current
--  13. the one access rule: private.patient_access_basis() and its set form
--  14. RLS (enabled and FORCED) and grants; nothing for anon, authenticated clients or patients
--      on new clinical tables
--  15. backfill: patient_allergies and resus AMPLE captures → allergies (+ NKDA assertions)
--
-- Re-runnable: IF NOT EXISTS, DROP-then-ADD for constraints, triggers and policies, and the backfill
-- is keyed on legacy_ref, so a second run adds nothing.
--
-- GATED: owner-applied (`npm run db:migrate`). Until it runs, EMR_V1 stays off and every page
-- behaves as before.


-- ─── 1. private schema, reader role, identity ────────────────────────
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medsync_clinical_reader') THEN
    CREATE ROLE medsync_clinical_reader NOLOGIN;       -- no BYPASSRLS: RLS applies after SET LOCAL ROLE
  END IF;
END $$;
GRANT medsync_clinical_reader TO CURRENT_USER;          -- the migrating owner may SET LOCAL ROLE to it
GRANT USAGE ON SCHEMA public, private TO medsync_clinical_reader;

-- Identity: transaction-local GUCs set by lib/emr/db.ts via set_config(…, true). PostgREST sessions
-- (session_user = 'authenticator') can never assert app.* — they always resolve to auth.uid().
CREATE OR REPLACE FUNCTION private.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN session_user = 'authenticator' THEN auth.uid()
              ELSE coalesce(nullif(current_setting('app.user_id', true), '')::uuid, auth.uid()) END;
$$;

CREATE OR REPLACE FUNCTION private.current_hospital_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN session_user = 'authenticator' THEN NULL
              ELSE nullif(current_setting('app.hospital_id', true), '')::uuid END;
$$;


-- ─── 2. Registries (config: mutable, audited, updated_at) ────────────
CREATE TABLE IF NOT EXISTS public.clinical_concepts (
  id                  text PRIMARY KEY,                      -- 'obs.glucose'
  display             text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('observation','finding','condition','medication','pregnancy',
                                                    'procedure','demographic','context','allergy')),
  concept_group       text NOT NULL,
  value_type          text NOT NULL CHECK (value_type IN ('quantity','coded','ordinal','boolean','presence',
                                                          'condition','procedure','date','as_typed')),
  canonical_unit      text,
  accepted_units      jsonb  NOT NULL DEFAULT '[]',
  answers             text[],
  context_required    text[] NOT NULL DEFAULT '{}',
  context_conditional jsonb  NOT NULL DEFAULT '{}',
  context_optional    text[] NOT NULL DEFAULT '{}',
  codes               jsonb  NOT NULL DEFAULT '[]',          -- [{system, code, status, …}]; candidates never exported
  lanes               text[] NOT NULL DEFAULT '{}',
  sensitivity         text   NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  sensitivity_rule    jsonb,                                 -- SR-PREG-MINOR
  symptom_code        text REFERENCES public.symptom_catalog(code) ON DELETE RESTRICT,   -- D-CFC-11 [H]
  phase               text NOT NULL,
  catalogue_version   text NOT NULL,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_concepts_symptom_code_uidx ON public.clinical_concepts (symptom_code)
  WHERE symptom_code IS NOT NULL;                            -- one token, one identity

CREATE TABLE IF NOT EXISTS public.drug_class_tags (
  id text PRIMARY KEY, display text NOT NULL, atc jsonb NOT NULL DEFAULT '[]', lanes text[] NOT NULL DEFAULT '{}',
  sensitivity text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  note text, catalogue_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS public.capabilities (
  id text PRIMARY KEY, display text NOT NULL, catalogue_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS public.facility_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  capability_id text NOT NULL REFERENCES public.capabilities(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('available','intermittent','unavailable')),
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, capability_id));

CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('glucometer','ketone_meter','hba1c_analyser','bp_monitor')),
  model text NOT NULL, serial text,
  calibration text CHECK (calibration IS NULL OR calibration IN ('plasma_equivalent','whole_blood','unknown')),
  measuring_limits jsonb NOT NULL DEFAULT '{}',              -- manufacturer HI/LO per analyte: device data, not a threshold
  validated boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, calibrated_on date,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, kind, serial));

CREATE TABLE IF NOT EXISTS public.test_catalogue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE,   -- NULL = the default menu
  code text NOT NULL, display text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lab','imaging','ecg','procedure')),
  components text[] NOT NULL DEFAULT '{}',                   -- clinical_concepts ids; >1 = a panel (seed-validated)
  specimen_type text, container text,
  fasting_required boolean NOT NULL DEFAULT false,
  ionising boolean NOT NULL DEFAULT false,                   -- D-EMR-12 pregnancy prompt
  default_units jsonb NOT NULL DEFAULT '{}',                 -- {conceptId: unit}
  in_house boolean NOT NULL DEFAULT true,
  capability_id text REFERENCES public.capabilities(id) ON DELETE RESTRICT,
  turnaround_target_minutes integer CHECK (turnaround_target_minutes > 0),   -- operational target
  favourite_rank integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS test_catalogue_code_uidx
  ON public.test_catalogue (coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

CREATE TABLE IF NOT EXISTS public.diagnosis_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display text NOT NULL, synonyms text[] NOT NULL DEFAULT '{}',
  icd11_code text,
  icd10_who_code text CONSTRAINT diagnosis_terms_icd10_unlicensed CHECK (icd10_who_code IS NULL),  -- R9/E6 until O-3
  ciel_id text,
  concept_id text REFERENCES public.clinical_concepts(id) ON DELETE RESTRICT,
  chronic boolean NOT NULL DEFAULT false,
  symptom_level boolean NOT NULL DEFAULT false,              -- "fever, cause not yet known"
  hmis_category_id text, idsr_class text,                    -- null until REF-HMIS-MAP / REF-IDSR-CLASSES are signed
  sensitivity text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','cso_signed')),
  source text NOT NULL, verified_on date, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

-- Registries are config: an edit is allowed, and every edit leaves an audit row.
DROP TRIGGER IF EXISTS clinical_concepts_updated_at ON public.clinical_concepts;
CREATE TRIGGER clinical_concepts_updated_at BEFORE UPDATE ON public.clinical_concepts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_clinical_concepts ON public.clinical_concepts;
CREATE TRIGGER audit_clinical_concepts AFTER INSERT OR UPDATE OR DELETE ON public.clinical_concepts
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

DROP TRIGGER IF EXISTS drug_class_tags_updated_at ON public.drug_class_tags;
CREATE TRIGGER drug_class_tags_updated_at BEFORE UPDATE ON public.drug_class_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_drug_class_tags ON public.drug_class_tags;
CREATE TRIGGER audit_drug_class_tags AFTER INSERT OR UPDATE OR DELETE ON public.drug_class_tags
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- capabilities has no updated_at (a capability is renamed by a new id, not edited).
DROP TRIGGER IF EXISTS audit_capabilities ON public.capabilities;
CREATE TRIGGER audit_capabilities AFTER INSERT OR UPDATE OR DELETE ON public.capabilities
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

DROP TRIGGER IF EXISTS facility_capabilities_updated_at ON public.facility_capabilities;
CREATE TRIGGER facility_capabilities_updated_at BEFORE UPDATE ON public.facility_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_facility_capabilities ON public.facility_capabilities;
CREATE TRIGGER audit_facility_capabilities AFTER INSERT OR UPDATE OR DELETE ON public.facility_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

DROP TRIGGER IF EXISTS devices_updated_at ON public.devices;
CREATE TRIGGER devices_updated_at BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_devices ON public.devices;
CREATE TRIGGER audit_devices AFTER INSERT OR UPDATE OR DELETE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

DROP TRIGGER IF EXISTS test_catalogue_updated_at ON public.test_catalogue;
CREATE TRIGGER test_catalogue_updated_at BEFORE UPDATE ON public.test_catalogue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_test_catalogue ON public.test_catalogue;
CREATE TRIGGER audit_test_catalogue AFTER INSERT OR UPDATE OR DELETE ON public.test_catalogue
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

DROP TRIGGER IF EXISTS diagnosis_terms_updated_at ON public.diagnosis_terms;
CREATE TRIGGER diagnosis_terms_updated_at BEFORE UPDATE ON public.diagnosis_terms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_diagnosis_terms ON public.diagnosis_terms;
CREATE TRIGGER audit_diagnosis_terms AFTER INSERT OR UPDATE OR DELETE ON public.diagnosis_terms
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();


-- ─── 3. encounters (evolve; 0028:262, 0033:88, 0040:40-60) ───────────
ALTER TABLE public.encounters
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.patient_intakes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- completed_at = existing ended_at
  ADD COLUMN IF NOT EXISTS disposition_detail jsonb,         -- Zod: {admittedTo?, referredTo?, transferredTo?, diedAt?}
  ADD COLUMN IF NOT EXISTS follow_up jsonb,                  -- Zod: {kind: 'none'|'review_date'|'as_needed', date?}
  ADD COLUMN IF NOT EXISTS attendance_type text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS referral_in jsonb,                -- Zod: {source: 'intake'|'appointment'|'letter', facility?, date?, reference?}
  ADD COLUMN IF NOT EXISTS closure_kind text,
  ADD COLUMN IF NOT EXISTS closure_reason text,
  ADD COLUMN IF NOT EXISTS closure_note_ciphertext text;

ALTER TABLE public.encounters DROP CONSTRAINT IF EXISTS encounters_attendance_type_check;
ALTER TABLE public.encounters ADD CONSTRAINT encounters_attendance_type_check
  CHECK (attendance_type IN ('new','re_attendance','unknown'));
ALTER TABLE public.encounters DROP CONSTRAINT IF EXISTS encounters_closure_kind_check;
ALTER TABLE public.encounters ADD CONSTRAINT encounters_closure_kind_check
  CHECK (closure_kind IS NULL OR closure_kind IN ('clinical','administrative'));
ALTER TABLE public.encounters DROP CONSTRAINT IF EXISTS encounters_closure_reason_check;
ALTER TABLE public.encounters ADD CONSTRAINT encounters_closure_reason_check
  CHECK (closure_reason IS NULL OR closure_reason IN
         ('left_before_seen','duplicate_encounter','documented_elsewhere','opened_in_error','other'));
ALTER TABLE public.encounters DROP CONSTRAINT IF EXISTS encounters_closure_shape;
ALTER TABLE public.encounters ADD CONSTRAINT encounters_closure_shape CHECK (
      (closure_kind IS DISTINCT FROM 'clinical'       OR disposition IS NOT NULL)
  AND (closure_kind IS DISTINCT FROM 'administrative' OR closure_reason IS NOT NULL)
  AND (state <> 'entered_in_error'                    OR closure_reason IS NOT NULL)
  AND (closure_reason IS DISTINCT FROM 'other'        OR closure_note_ciphertext IS NOT NULL));

-- DROP-then-ADD: 0040's lists verbatim plus the new values.
ALTER TABLE public.encounters DROP CONSTRAINT IF EXISTS encounters_type_check;
ALTER TABLE public.encounters ADD CONSTRAINT encounters_type_check CHECK (encounter_type IN
  ('opd','inpatient','emergency','follow_up','tele',                                   -- 0040, kept
   'antenatal','procedure','virtual','community'));                                     -- new ("class")
ALTER TABLE public.encounters DROP CONSTRAINT IF EXISTS encounters_disposition_check;
ALTER TABLE public.encounters ADD CONSTRAINT encounters_disposition_check CHECK (disposition IS NULL OR disposition IN
  ('admit','discharge','refer','observe','transfer','deceased',                         -- 0040, kept (legacy readers)
   'home','admitted','referred_out','transferred','left_before_completion','left_against_advice'));  -- died = 'deceased' [H]
ALTER TABLE public.encounters DROP CONSTRAINT IF EXISTS encounters_state_check;
ALTER TABLE public.encounters ADD CONSTRAINT encounters_state_check CHECK (state IN
  ('planned','in_progress','completed','cancelled','entered_in_error'));

CREATE INDEX IF NOT EXISTS encounters_visit_idx ON public.encounters (visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS encounters_open_activity_idx ON public.encounters (hospital_id, last_activity_at)
  WHERE state IN ('planned','in_progress');
-- None today; "one audit row per change" (PROMPT §7.1).
DROP TRIGGER IF EXISTS audit_encounters ON public.encounters;
CREATE TRIGGER audit_encounters AFTER INSERT OR UPDATE OR DELETE ON public.encounters
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();


-- ─── 4. Notes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinical_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE RESTRICT,
  note_type text NOT NULL CHECK (note_type IN ('clerking','emergency_clerking','progress','ward_round','procedure',
    'handover','referral','nursing','addendum','cause_of_death','medico_legal')),       -- medico_legal: seam, ref [10]
  template_id text NOT NULL, template_version text NOT NULL,   -- data/emr/note-templates.v1.json
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','signed')),
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_cadre text NOT NULL,
  addendum_to uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,
  content_ciphertext text NOT NULL,                          -- sections JSON (narrative + structured payload)
  revision integer NOT NULL DEFAULT 0,                       -- autosave optimistic check
  content_hmac text, hmac_key_id text,                       -- E10: HMAC-SHA-256 over the canonical composition
  signed_at timestamptz,
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  late_entry boolean NOT NULL DEFAULT false,
  sensitivity text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  client_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_notes_signed_shape CHECK
    ((state = 'signed') = (signed_at IS NOT NULL AND content_hmac IS NOT NULL AND hmac_key_id IS NOT NULL)),
  CONSTRAINT clinical_notes_addendum_shape CHECK ((note_type = 'addendum') = (addendum_to IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS clinical_notes_one_draft ON public.clinical_notes (encounter_id, author_user_id, note_type)
  WHERE state = 'draft' AND addendum_to IS NULL;             -- one per-author draft (§9 concurrency)
CREATE UNIQUE INDEX IF NOT EXISTS clinical_notes_client_key ON public.clinical_notes (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS clinical_notes_patient_time  ON public.clinical_notes (patient_user_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS clinical_notes_encounter     ON public.clinical_notes (encounter_id, state);
CREATE INDEX IF NOT EXISTS clinical_notes_addendum      ON public.clinical_notes (addendum_to) WHERE addendum_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS clinical_notes_hospital_time ON public.clinical_notes (hospital_id, recorded_at DESC);

-- Drafts are the only mutable clinical rows; signing is the last mutation (Law 4).
CREATE OR REPLACE FUNCTION private.clinical_notes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state <> 'draft' THEN
    RAISE EXCEPTION 'clinical_notes: % of a % note refused (addendum or entered-in-error instead)', TG_OP, OLD.state;
  END IF;
  IF (NEW.id, NEW.hospital_id, NEW.patient_user_id, NEW.encounter_id, NEW.note_type, NEW.author_user_id,
      NEW.addendum_to, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.id, OLD.hospital_id, OLD.patient_user_id, OLD.encounter_id, OLD.note_type, OLD.author_user_id,
      OLD.addendum_to, OLD.recorded_at) THEN
    RAISE EXCEPTION 'clinical_notes: identity columns of a draft are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clinical_notes_guard ON public.clinical_notes;
CREATE TRIGGER clinical_notes_guard BEFORE UPDATE OR DELETE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION private.clinical_notes_guard();
DROP TRIGGER IF EXISTS clinical_notes_updated_at ON public.clinical_notes;
CREATE TRIGGER clinical_notes_updated_at BEFORE UPDATE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_clinical_notes ON public.clinical_notes;
CREATE TRIGGER audit_clinical_notes AFTER INSERT OR UPDATE OR DELETE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

CREATE TABLE IF NOT EXISTS public.clinical_note_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('cosign_requested','cosigned','addendum_added','entered_in_error')),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_cadre text NOT NULL,
  cosign_request_id uuid,                                    -- FK added in §5 (table order)
  related_note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,   -- the addendum
  reason_code text, reason_ciphertext text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_key text,
  CONSTRAINT cne_eie_reason   CHECK (kind <> 'entered_in_error' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
  CONSTRAINT cne_addendum     CHECK (kind <> 'addendum_added' OR related_note_id IS NOT NULL),
  CONSTRAINT cne_cosign_link  CHECK (kind NOT IN ('cosign_requested','cosigned') OR cosign_request_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS clinical_note_events_note ON public.clinical_note_events (note_id, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS clinical_note_events_client_key ON public.clinical_note_events (client_key) WHERE client_key IS NOT NULL;
DROP TRIGGER IF EXISTS clinical_note_events_no_mutation ON public.clinical_note_events;
CREATE TRIGGER clinical_note_events_no_mutation BEFORE UPDATE OR DELETE ON public.clinical_note_events
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_clinical_note_events ON public.clinical_note_events;
CREATE TRIGGER audit_clinical_note_events AFTER INSERT OR UPDATE OR DELETE ON public.clinical_note_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();


-- ─── 5. clinical_cosign_requests (evolve; 0030:163, 0036:260) ────────
ALTER TABLE public.clinical_cosign_requests
  ADD COLUMN IF NOT EXISTS note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT;
-- DROP-then-ADD: 0036's list verbatim plus sign_note.
ALTER TABLE public.clinical_cosign_requests DROP CONSTRAINT IF EXISTS cosign_action_kind_check;
ALTER TABLE public.clinical_cosign_requests ADD CONSTRAINT cosign_action_kind_check CHECK (action_kind IN (
  'prescription_routine','prescription_controlled','order_high_cost_imaging','admit_patient','discharge_patient',
  'high_alert_med_administration','independent_complex_procedure','triage_patient','triage_downgrade',  -- 0036, kept
  'sign_note'));                                                                                         -- new
ALTER TABLE public.clinical_cosign_requests DROP CONSTRAINT IF EXISTS cosign_note_link;
ALTER TABLE public.clinical_cosign_requests ADD CONSTRAINT cosign_note_link
  CHECK ((action_kind = 'sign_note') = (note_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS cosign_note_idx ON public.clinical_cosign_requests (note_id) WHERE note_id IS NOT NULL;
ALTER TABLE public.clinical_note_events DROP CONSTRAINT IF EXISTS cne_cosign_request_fk;
ALTER TABLE public.clinical_note_events ADD CONSTRAINT cne_cosign_request_fk
  FOREIGN KEY (cosign_request_id) REFERENCES public.clinical_cosign_requests(id) ON DELETE RESTRICT;


-- ─── 6. Orders, specimens, reports ───────────────────────────────────
-- encounter_orders (evolve; 0040:268). lifecycle tags every existing row 'legacy' (catalogue-only default).
ALTER TABLE public.encounter_orders
  ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS test_id uuid REFERENCES public.test_catalogue(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS reason_condition_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reason_text_ciphertext text,
  ADD COLUMN IF NOT EXISTS fasting_required boolean,
  ADD COLUMN IF NOT EXISTS requester_cadre text,             -- requester = existing authored_by_user_id
  ADD COLUMN IF NOT EXISTS performer text,
  ADD COLUMN IF NOT EXISTS intent_source text,
  ADD COLUMN IF NOT EXISTS source_intent_id text,            -- triage recommendation code or resus event id
  ADD COLUMN IF NOT EXISTS requisition_no text,
  ADD COLUMN IF NOT EXISTS sensitivity text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS client_key text,
  ADD COLUMN IF NOT EXISTS effective_at timestamptz;
ALTER TABLE public.encounter_orders
  DROP CONSTRAINT IF EXISTS enc_order_lifecycle_check,
  DROP CONSTRAINT IF EXISTS enc_order_priority_check,
  DROP CONSTRAINT IF EXISTS enc_order_performer_check,
  DROP CONSTRAINT IF EXISTS enc_order_intent_check,
  DROP CONSTRAINT IF EXISTS enc_order_sensitivity_check,
  DROP CONSTRAINT IF EXISTS enc_order_events_shape;
ALTER TABLE public.encounter_orders
  ADD CONSTRAINT enc_order_lifecycle_check   CHECK (lifecycle IN ('legacy','events')),
  ADD CONSTRAINT enc_order_priority_check    CHECK (priority IS NULL OR priority IN ('routine','urgent','immediate')),
  ADD CONSTRAINT enc_order_performer_check   CHECK (performer IS NULL OR performer IN ('in_house','external','referral')),
  ADD CONSTRAINT enc_order_intent_check      CHECK (intent_source IS NULL OR intent_source IN
                                                    ('clinician','triage_recommendation','resus_handover')),
  ADD CONSTRAINT enc_order_sensitivity_check CHECK (sensitivity IN ('standard','restricted')),
  ADD CONSTRAINT enc_order_events_shape CHECK (lifecycle = 'legacy' OR (
        hospital_id IS NOT NULL AND priority IS NOT NULL AND performer IS NOT NULL AND intent_source IS NOT NULL
    AND requester_cadre IS NOT NULL AND effective_at IS NOT NULL
    AND kind IN ('lab','imaging','ecg','procedure','referral')
    AND (kind <> 'lab' OR test_id IS NOT NULL)
    AND (cardinality(reason_condition_ids) > 0 OR reason_text_ciphertext IS NOT NULL)));   -- a reason is required
-- DROP-then-ADD: 0040's list verbatim plus the new kinds.
ALTER TABLE public.encounter_orders DROP CONSTRAINT IF EXISTS enc_order_kind_check;
ALTER TABLE public.encounter_orders ADD CONSTRAINT enc_order_kind_check CHECK (kind IN
  ('bloods','imaging','bedside','special','other',            -- 0040, kept
   'lab','ecg','procedure','referral'));                      -- new
CREATE UNIQUE INDEX IF NOT EXISTS enc_order_client_key ON public.encounter_orders (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS enc_order_events_patient  ON public.encounter_orders (patient_user_id, created_at DESC) WHERE lifecycle = 'events';
CREATE INDEX IF NOT EXISTS enc_order_events_hospital ON public.encounter_orders (hospital_id, created_at DESC)     WHERE lifecycle = 'events';

-- Events-lifecycle rows are immutable; legacy rows keep the /lab status UPDATE while EMR_V1 is off.
CREATE OR REPLACE FUNCTION private.encounter_orders_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.lifecycle = 'events' THEN
    RAISE EXCEPTION 'encounter_orders: events-lifecycle orders are immutable (%); append an order event', TG_OP;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
      RAISE EXCEPTION 'encounter_orders: a legacy order cannot become an events order';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS encounter_orders_guard ON public.encounter_orders;
CREATE TRIGGER encounter_orders_guard BEFORE UPDATE OR DELETE ON public.encounter_orders
  FOR EACH ROW EXECUTE FUNCTION private.encounter_orders_guard();
DROP TRIGGER IF EXISTS audit_encounter_orders ON public.encounter_orders;
CREATE TRIGGER audit_encounter_orders AFTER INSERT OR UPDATE OR DELETE ON public.encounter_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
-- The legacy status column stays 'ordered' on events rows and is never read for them (status is derived).

CREATE TABLE IF NOT EXISTS public.encounter_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.encounter_orders(id) ON DELETE RESTRICT,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('proposed','placed','dismissed','cancelled','on_hold','resumed')),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_cadre text NOT NULL,
  reason_code text, reason_ciphertext text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_key text,
  CONSTRAINT eoe_reason CHECK (kind NOT IN ('dismissed','cancelled','on_hold')
                               OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL));
CREATE INDEX IF NOT EXISTS encounter_order_events_order ON public.encounter_order_events (order_id, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS encounter_order_events_client_key ON public.encounter_order_events (client_key) WHERE client_key IS NOT NULL;
DROP TRIGGER IF EXISTS encounter_order_events_no_mutation ON public.encounter_order_events;
CREATE TRIGGER encounter_order_events_no_mutation BEFORE UPDATE OR DELETE ON public.encounter_order_events
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_encounter_order_events ON public.encounter_order_events;
CREATE TRIGGER audit_encounter_order_events AFTER INSERT OR UPDATE OR DELETE ON public.encounter_order_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

CREATE TABLE IF NOT EXISTS public.specimens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.encounter_orders(id) ON DELETE RESTRICT,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  specimen_type text NOT NULL CHECK (specimen_type IN ('venous_plasma','venous_serum','venous_whole_blood',
    'capillary_whole_blood','arterial_blood','urine_spot','urine_first_morning','urine_24h','interstitial_fluid','unknown')),
  container text NOT NULL CHECK (container IN ('fluoride_oxalate','serum_plain','lithium_heparin','edta',
    'capillary_direct','unknown')),
  collected_at timestamptz NOT NULL,
  collected_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  collector_cadre text NOT NULL,
  fasting_state text CHECK (fasting_state IS NULL OR fasting_state IN ('fasting','non_fasting','unknown')),  -- writer: required when the test is fasting_required
  fasting_hours numeric CHECK (fasting_hours IS NULL OR fasting_hours >= 0),
  identifiers_confirmed boolean NOT NULL CHECK (identifiers_confirmed),                 -- two identifiers, at the bedside
  label_no text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_key text);
CREATE INDEX IF NOT EXISTS specimens_order ON public.specimens (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS specimens_client_key ON public.specimens (client_key) WHERE client_key IS NOT NULL;
DROP TRIGGER IF EXISTS specimens_no_mutation ON public.specimens;
CREATE TRIGGER specimens_no_mutation BEFORE UPDATE OR DELETE ON public.specimens
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_specimens ON public.specimens;
CREATE TRIGGER audit_specimens AFTER INSERT OR UPDATE OR DELETE ON public.specimens
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

CREATE TABLE IF NOT EXISTS public.specimen_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  specimen_id uuid NOT NULL REFERENCES public.specimens(id) ON DELETE RESTRICT,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('received','rejected')),
  reason_code text CHECK (reason_code IS NULL OR reason_code IN ('haemolysed','clotted','insufficient',
    'unlabelled_or_mislabelled','wrong_container','delayed')),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, actor_cadre text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), client_key text,
  CONSTRAINT se_reject_reason CHECK ((kind = 'rejected') = (reason_code IS NOT NULL)));
CREATE INDEX IF NOT EXISTS specimen_events_specimen ON public.specimen_events (specimen_id, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS specimen_events_client_key ON public.specimen_events (client_key) WHERE client_key IS NOT NULL;
DROP TRIGGER IF EXISTS specimen_events_no_mutation ON public.specimen_events;
CREATE TRIGGER specimen_events_no_mutation BEFORE UPDATE OR DELETE ON public.specimen_events
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_specimen_events ON public.specimen_events;
CREATE TRIGGER audit_specimen_events AFTER INSERT OR UPDATE OR DELETE ON public.specimen_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- Versioned: a release, an amendment or a correction is a new row that supersedes the last.
CREATE TABLE IF NOT EXISTS public.diagnostic_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id          uuid NOT NULL,                        -- = id of version 1 (the writer sets it)
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id       uuid REFERENCES public.diagnostic_reports(id) ON DELETE RESTRICT,
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id        uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  effective_at        timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_cadre        text,
  source              text NOT NULL CHECK (source IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')),
  trust               smallint NOT NULL CHECK (trust BETWEEN 1 AND 4),
  status              text NOT NULL DEFAULT 'final' CHECK (status IN
                        ('preliminary','final','amended','corrected','entered_in_error','cancelled')),
  sensitivity         text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  reason_code         text,
  reason_ciphertext   text,
  client_key          text,
  order_id uuid REFERENCES public.encounter_orders(id) ON DELETE RESTRICT,
  specimen_id uuid REFERENCES public.specimens(id) ON DELETE RESTRICT,
  test_id uuid REFERENCES public.test_catalogue(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('lab','imaging','ecg')),
  issued_at timestamptz NOT NULL,
  performer text NOT NULL CHECK (performer IN ('in_house','external')),
  performer_lab_name text,
  entry_mode text NOT NULL CHECK (entry_mode IN ('direct','transcribed','interface')),   -- interface reserved
  entered_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  verified_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  conclusion_code text CHECK (conclusion_code IS NULL OR conclusion_code IN ('normal','abnormal','indeterminate')),
  conclusion_ciphertext text,
  critical boolean NOT NULL DEFAULT false,                    -- signed REF-CRIT-* entries only; none signed yet
  uncatalogued boolean NOT NULL DEFAULT false,
  CONSTRAINT diagnostic_reports_version_chain CHECK ((version = 1) = (supersedes_id IS NULL)),
  CONSTRAINT diagnostic_reports_eie_reason    CHECK (status <> 'entered_in_error' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
  CONSTRAINT dr_order_or_transcribed CHECK (order_id IS NOT NULL OR entry_mode = 'transcribed'),
  CONSTRAINT dr_conclusion CHECK (kind = 'lab' OR status = 'preliminary' OR conclusion_code IS NOT NULL),
  CONSTRAINT dr_transcribed_trust CHECK (entry_mode <> 'transcribed' OR verified_by_user_id IS NOT NULL OR trust <= 3));
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_reports_logical_version ON public.diagnostic_reports (logical_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_reports_client_key ON public.diagnostic_reports (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS diagnostic_reports_supersedes ON public.diagnostic_reports (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS diagnostic_reports_patient_time ON public.diagnostic_reports (patient_user_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS diagnostic_reports_hospital_time ON public.diagnostic_reports (hospital_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS diagnostic_reports_order ON public.diagnostic_reports (order_id) WHERE order_id IS NOT NULL;
DROP TRIGGER IF EXISTS diagnostic_reports_no_mutation ON public.diagnostic_reports;
CREATE TRIGGER diagnostic_reports_no_mutation BEFORE UPDATE OR DELETE ON public.diagnostic_reports
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_diagnostic_reports ON public.diagnostic_reports;
CREATE TRIGGER audit_diagnostic_reports AFTER INSERT OR UPDATE OR DELETE ON public.diagnostic_reports
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();


-- ─── 7. clinical_observations (evolve; 0031:139, 0036:229, 0038:367) — E3 [H] ─
ALTER TABLE public.clinical_observations
  ADD COLUMN IF NOT EXISTS concept_id text REFERENCES public.clinical_concepts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS logical_id uuid,
  ADD COLUMN IF NOT EXISTS version integer,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES public.clinical_observations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS value_type text,
  ADD COLUMN IF NOT EXISTS value_num numeric,
  ADD COLUMN IF NOT EXISTS value_comparator text,
  ADD COLUMN IF NOT EXISTS value_unit text,                   -- UCUM, as reported
  ADD COLUMN IF NOT EXISTS value_canonical numeric,
  ADD COLUMN IF NOT EXISTS value_code text,
  ADD COLUMN IF NOT EXISTS value_bool boolean,
  ADD COLUMN IF NOT EXISTS presence text,
  ADD COLUMN IF NOT EXISTS specimen text,
  ADD COLUMN IF NOT EXISTS calibration text,
  ADD COLUMN IF NOT EXISTS fasting_state text,
  ADD COLUMN IF NOT EXISTS challenge text,
  ADD COLUMN IF NOT EXISTS challenge_minutes integer,
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS certification text,
  ADD COLUMN IF NOT EXISTS point_of_care boolean,
  ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES public.devices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}',   -- concept-specific context incl. elicitedBy, referenceRange, labInterpretation
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS trust smallint,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS sensitivity text,
  ADD COLUMN IF NOT EXISTS effective_at timestamptz,          -- knowledge time = created_at; legacy effective = recorded_at
  ADD COLUMN IF NOT EXISTS author_cadre text,
  ADD COLUMN IF NOT EXISTS note_ciphertext text,
  ADD COLUMN IF NOT EXISTS report_id uuid REFERENCES public.diagnostic_reports(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.encounter_orders(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS entry_mode text,
  ADD COLUMN IF NOT EXISTS client_key text;

ALTER TABLE public.clinical_observations
  DROP CONSTRAINT IF EXISTS obs_category_check,
  DROP CONSTRAINT IF EXISTS obs_value_type_check,
  DROP CONSTRAINT IF EXISTS obs_comparator_check,
  DROP CONSTRAINT IF EXISTS obs_presence_check,
  DROP CONSTRAINT IF EXISTS obs_fasting_check,
  DROP CONSTRAINT IF EXISTS obs_source_check,
  DROP CONSTRAINT IF EXISTS obs_trust_check,
  DROP CONSTRAINT IF EXISTS obs_status_check,
  DROP CONSTRAINT IF EXISTS obs_sensitivity_check,
  DROP CONSTRAINT IF EXISTS obs_entry_mode_check,
  DROP CONSTRAINT IF EXISTS obs_fact_tagging,
  DROP CONSTRAINT IF EXISTS obs_cfc_shape,
  DROP CONSTRAINT IF EXISTS obs_value_matches_type;
ALTER TABLE public.clinical_observations
  ADD CONSTRAINT obs_category_check   CHECK (category IS NULL OR category IN ('laboratory','vital_sign','anthropometric',
                                             'symptom','sign','exam','history','social','event','derived')),
  ADD CONSTRAINT obs_value_type_check CHECK (value_type IS NULL OR value_type IN ('quantity','coded','ordinal','boolean','presence','as_typed')),
  ADD CONSTRAINT obs_comparator_check CHECK (value_comparator IS NULL OR value_comparator IN ('<','<=','>','>=')),
  ADD CONSTRAINT obs_presence_check   CHECK (presence IS NULL OR presence IN ('present','absent','unknown')),
  ADD CONSTRAINT obs_fasting_check    CHECK (fasting_state IS NULL OR fasting_state IN ('fasting','non_fasting','unknown')),
  ADD CONSTRAINT obs_source_check     CHECK (source IS NULL OR source IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')),
  ADD CONSTRAINT obs_trust_check      CHECK (trust IS NULL OR trust BETWEEN 1 AND 4),
  ADD CONSTRAINT obs_status_check     CHECK (status IS NULL OR status IN ('preliminary','final','amended','corrected','entered_in_error','cancelled')),
  ADD CONSTRAINT obs_sensitivity_check CHECK (sensitivity IS NULL OR sensitivity IN ('standard','restricted')),
  ADD CONSTRAINT obs_entry_mode_check CHECK (entry_mode IS NULL OR entry_mode IN ('direct','transcribed','interface')),
  -- A CFC row is tagged three ways at once, so no legacy reader can mistake it for a legacy row.
  ADD CONSTRAINT obs_fact_tagging     CHECK ((concept_id IS NOT NULL) = (observation_kind = 'fact')
                                         AND (concept_id IS NOT NULL) = (state = 'fact')),
  ADD CONSTRAINT obs_cfc_shape CHECK (concept_id IS NULL OR (
        logical_id IS NOT NULL AND version IS NOT NULL AND (version = 1) = (supersedes_id IS NULL)
    AND category IS NOT NULL AND value_type IS NOT NULL AND source IS NOT NULL AND trust IS NOT NULL
    AND status IS NOT NULL AND sensitivity IS NOT NULL AND effective_at IS NOT NULL
    AND numeric_value_1 IS NULL AND numeric_value_2 IS NULL AND unit IS NULL AND notes IS NULL AND pain_scale IS NULL
    AND (report_id IS NULL OR entry_mode IS NOT NULL)
    AND (status <> 'entered_in_error' OR note_ciphertext IS NOT NULL))),        -- the reason travels encrypted
  ADD CONSTRAINT obs_value_matches_type CHECK (concept_id IS NULL
    OR (value_type = 'quantity' AND value_num IS NOT NULL AND value_unit IS NOT NULL AND value_canonical IS NOT NULL)
    OR (value_type IN ('coded','ordinal') AND value_code IS NOT NULL)
    OR (value_type = 'boolean' AND value_bool IS NOT NULL)
    OR (value_type = 'presence' AND presence IS NOT NULL)
    OR (value_type = 'as_typed' AND concept_id = 'obs.uncatalogued' AND note_ciphertext IS NOT NULL));

-- DROP-then-ADD: 0038's list verbatim plus 'fact'.
ALTER TABLE public.clinical_observations DROP CONSTRAINT IF EXISTS obs_kind_check;
ALTER TABLE public.clinical_observations ADD CONSTRAINT obs_kind_check CHECK (observation_kind IN (
  'bp','hr','temperature','rr','spo2','glucose','pain','weight','height','intake','output','gcs','other','acvpu',
  'etco2','urine_output',                                     -- 0038, kept
  'fact'));                                                   -- new: every CFC row
-- CFC rows carry state = 'fact' (their status lives in `status`). The three legacy readers all filter
-- state = 'active' (lib/triage/worklist.ts:294, lib/ncd/vitals.ts:144, app/nurse/patients/[patientId]/page.tsx:87),
-- so they can never render a CFC row as a blank legacy one; P4 re-points them to the loader under EMR_V1.
ALTER TABLE public.clinical_observations DROP CONSTRAINT IF EXISTS obs_state_check;
ALTER TABLE public.clinical_observations ADD CONSTRAINT obs_state_check CHECK (state IN
  ('active','corrected',                                      -- 0031, kept
   'fact'));                                                  -- new

-- CFC §3.4 equivalents (+ result and idempotency indexes)
CREATE INDEX IF NOT EXISTS obs_cfc_patient_concept_time ON public.clinical_observations (patient_user_id, concept_id, effective_at DESC)
  WHERE concept_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS obs_cfc_supersedes ON public.clinical_observations (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS obs_cfc_sweep ON public.clinical_observations (concept_id, effective_at)
  INCLUDE (patient_user_id, value_canonical, fasting_state, specimen, trust)
  WHERE status IN ('final','amended','corrected');
CREATE INDEX IF NOT EXISTS obs_cfc_hospital_time ON public.clinical_observations (hospital_id, effective_at DESC) WHERE concept_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS obs_cfc_report ON public.clinical_observations (report_id) WHERE report_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS obs_cfc_logical_version ON public.clinical_observations (logical_id, version) WHERE logical_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS obs_cfc_client_key ON public.clinical_observations (client_key) WHERE client_key IS NOT NULL;

-- CFC rows immutable; legacy rows allow only the resus retractMirror move (actions-survey.ts:346-363).
CREATE OR REPLACE FUNCTION private.clinical_observations_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clinical_observations: DELETE refused (clinical rows are never deleted)';
  END IF;
  IF OLD.concept_id IS NOT NULL THEN
    RAISE EXCEPTION 'clinical_observations: CFC rows are insert-only; correct with a superseding version';
  END IF;
  IF OLD.state = 'active' AND NEW.state = 'corrected'
     AND (to_jsonb(NEW) - 'state' - 'corrected_by_observation_id' - 'updated_at')
       = (to_jsonb(OLD) - 'state' - 'corrected_by_observation_id' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'clinical_observations: a legacy row allows only active → corrected';
END $$;
DROP TRIGGER IF EXISTS clinical_observations_guard ON public.clinical_observations;
CREATE TRIGGER clinical_observations_guard BEFORE UPDATE OR DELETE ON public.clinical_observations
  FOR EACH ROW EXECUTE FUNCTION private.clinical_observations_guard();
-- The guard makes ON DELETE SET NULL from encounters and ON DELETE CASCADE from auth.users/hospitals fail
-- while observations exist. Nothing deletes those today; clinical retention wants exactly that.


-- ─── 8. Conditions, medicines, pregnancy, procedures (fact envelope) ─
CREATE TABLE IF NOT EXISTS public.conditions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id       uuid REFERENCES public.conditions(id) ON DELETE RESTRICT,
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id        uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  effective_at        timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_cadre        text,
  source              text NOT NULL CHECK (source IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')),
  trust               smallint NOT NULL CHECK (trust BETWEEN 1 AND 4),
  status              text NOT NULL DEFAULT 'final' CHECK (status IN
                        ('preliminary','final','amended','corrected','entered_in_error','cancelled')),
  sensitivity         text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  reason_code         text,
  reason_ciphertext   text,
  client_key          text,
  category text NOT NULL CHECK (category IN ('problem_list_item','encounter_diagnosis')),
  subject_relation text NOT NULL DEFAULT 'self' CHECK (subject_relation IN
    ('self','mother','father','sibling','child','other_first_degree','second_degree')),     -- family history
  term_id uuid REFERENCES public.diagnosis_terms(id) ON DELETE RESTRICT,
  concept_id text REFERENCES public.clinical_concepts(id) ON DELETE RESTRICT,
  text_ciphertext text,                                       -- uncoded term: shown, never HMIS-counted or engine-read
  rank text CHECK (rank IS NULL OR rank IN ('primary','secondary')),
  clinical_status text NOT NULL CHECK (clinical_status IN ('active','recurrence','relapse','inactive','remission','resolved')),
  verification text NOT NULL CHECK (verification IN ('unconfirmed','provisional','differential','confirmed','refuted')),
  asserted_by text NOT NULL CHECK (asserted_by IN ('clinician','patient_reported','referral_document','engine_proposal_accepted')),
  onset jsonb, abatement_at timestamptz, stage jsonb,
  icd11_code text,
  icd10_who_code text CHECK (icd10_who_code IS NULL),         -- R9/E6 until O-3
  ciel_id text,
  hmis_category_id text, idsr_class text,                     -- derived at write from signed mappings; null until signed
  CONSTRAINT conditions_version_chain CHECK ((version = 1) = (supersedes_id IS NULL)),
  CONSTRAINT conditions_eie_reason    CHECK (status <> 'entered_in_error' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
  CONSTRAINT cond_term_or_text   CHECK (term_id IS NOT NULL OR text_ciphertext IS NOT NULL),
  CONSTRAINT cond_rank_dx_only   CHECK (rank IS NULL OR category = 'encounter_diagnosis'),
  CONSTRAINT cond_dx_encounter   CHECK (category <> 'encounter_diagnosis' OR encounter_id IS NOT NULL),
  CONSTRAINT cond_resolve_reason CHECK ((clinical_status <> 'resolved' AND verification <> 'refuted')
                                        OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL));
-- One primary per visit: enforced by recordEncounterDiagnosis in the tx + a PGlite test (versions share rank).
CREATE UNIQUE INDEX IF NOT EXISTS conditions_logical_version ON public.conditions (logical_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS conditions_client_key ON public.conditions (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS conditions_supersedes ON public.conditions (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conditions_patient_time ON public.conditions (patient_user_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS conditions_hospital_time ON public.conditions (hospital_id, recorded_at DESC);
DROP TRIGGER IF EXISTS conditions_no_mutation ON public.conditions;
CREATE TRIGGER conditions_no_mutation BEFORE UPDATE OR DELETE ON public.conditions
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_conditions ON public.conditions;
CREATE TRIGGER audit_conditions AFTER INSERT OR UPDATE OR DELETE ON public.conditions
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

CREATE TABLE IF NOT EXISTS public.medication_statements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id       uuid REFERENCES public.medication_statements(id) ON DELETE RESTRICT,
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id        uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  effective_at        timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_cadre        text,
  source              text NOT NULL CHECK (source IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')),
  trust               smallint NOT NULL CHECK (trust BETWEEN 1 AND 4),
  status              text NOT NULL DEFAULT 'final' CHECK (status IN
                        ('preliminary','final','amended','corrected','entered_in_error','cancelled')),
  sensitivity         text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  reason_code         text,
  reason_ciphertext   text,
  client_key          text,
  drug_code text,                                             -- lib/prescribing formulary drugKey where known
  drug_text_ciphertext text,                                  -- as typed (herbal, OTC, unlisted)
  product_kind text NOT NULL DEFAULT 'medicine' CHECK (product_kind IN ('medicine','otc','herbal_traditional')),
  class_tags text[] NOT NULL DEFAULT '{}',                    -- drug_class_tags ids; restricted tag → restricted row
  atc_code text,
  medication_status text NOT NULL CHECK (medication_status IN ('active','completed','stopped','on_hold','intended','unknown')),
  period_start date, period_end date,
  route text CHECK (route IS NULL OR route IN ('oral','iv','im','sc','inhaled','topical','other')),
  medication_source text NOT NULL CHECK (medication_source IN ('prescribed_here','dispensed_here','patient_reported','external_record')),
  reconciliation text CHECK (reconciliation IS NULL OR reconciliation IN ('continued','stopped','changed')),
  CONSTRAINT medication_statements_version_chain CHECK ((version = 1) = (supersedes_id IS NULL)),
  CONSTRAINT medication_statements_eie_reason    CHECK (status <> 'entered_in_error' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
  CONSTRAINT ms_drug CHECK (drug_code IS NOT NULL OR drug_text_ciphertext IS NOT NULL),
  CONSTRAINT ms_stop_reason CHECK (reconciliation IS DISTINCT FROM 'stopped' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS medication_statements_logical_version ON public.medication_statements (logical_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS medication_statements_client_key ON public.medication_statements (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS medication_statements_supersedes ON public.medication_statements (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS medication_statements_patient_time ON public.medication_statements (patient_user_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS medication_statements_hospital_time ON public.medication_statements (hospital_id, recorded_at DESC);
DROP TRIGGER IF EXISTS medication_statements_no_mutation ON public.medication_statements;
CREATE TRIGGER medication_statements_no_mutation BEFORE UPDATE OR DELETE ON public.medication_statements
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_medication_statements ON public.medication_statements;
CREATE TRIGGER audit_medication_statements AFTER INSERT OR UPDATE OR DELETE ON public.medication_statements
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

CREATE TABLE IF NOT EXISTS public.pregnancy_episodes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id          uuid NOT NULL,                        -- = the episode
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id       uuid REFERENCES public.pregnancy_episodes(id) ON DELETE RESTRICT,
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id        uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  effective_at        timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_cadre        text,
  source              text NOT NULL CHECK (source IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')),
  trust               smallint NOT NULL CHECK (trust BETWEEN 1 AND 4),
  status              text NOT NULL DEFAULT 'final' CHECK (status IN
                        ('preliminary','final','amended','corrected','entered_in_error','cancelled')),
  sensitivity         text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  reason_code         text,
  reason_ciphertext   text,
  client_key          text,
  pregnancy_state text NOT NULL CHECK (pregnancy_state IN ('pregnant','postpartum','not_pregnant','unknown')),
  lnmp date, lnmp_certainty text CHECK (lnmp_certainty IS NULL OR lnmp_certainty IN ('sure','unsure')),
  edd date, edd_basis text CHECK (edd_basis IS NULL OR edd_basis IN ('lmp','ultrasound','fundal_height','unknown')),
  test_observation_id uuid REFERENCES public.clinical_observations(id) ON DELETE RESTRICT,
  gravida smallint CHECK (gravida >= 0), parity smallint CHECK (parity >= 0),
  delivered_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('live_birth','stillbirth','miscarriage','termination','ectopic','unknown')),
  birth_weight_grams integer CHECK (birth_weight_grams > 0),
  hyperglycaemia boolean,                                     -- 2.4 / CFC 4.8; gestational age is derived, never stored
  CONSTRAINT pregnancy_episodes_version_chain CHECK ((version = 1) = (supersedes_id IS NULL)),
  CONSTRAINT pregnancy_episodes_eie_reason    CHECK (status <> 'entered_in_error' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL));
-- sensitivity: SR-PREG-MINOR at insert; outcome 'termination' → restricted (SRH class, D-CFC-09).
CREATE UNIQUE INDEX IF NOT EXISTS pregnancy_episodes_logical_version ON public.pregnancy_episodes (logical_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS pregnancy_episodes_client_key ON public.pregnancy_episodes (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS pregnancy_episodes_supersedes ON public.pregnancy_episodes (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pregnancy_episodes_patient_time ON public.pregnancy_episodes (patient_user_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS pregnancy_episodes_hospital_time ON public.pregnancy_episodes (hospital_id, recorded_at DESC);
DROP TRIGGER IF EXISTS pregnancy_episodes_no_mutation ON public.pregnancy_episodes;
CREATE TRIGGER pregnancy_episodes_no_mutation BEFORE UPDATE OR DELETE ON public.pregnancy_episodes
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_pregnancy_episodes ON public.pregnancy_episodes;
CREATE TRIGGER audit_pregnancy_episodes AFTER INSERT OR UPDATE OR DELETE ON public.pregnancy_episodes
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

CREATE TABLE IF NOT EXISTS public.procedures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id       uuid REFERENCES public.procedures(id) ON DELETE RESTRICT,
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id        uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  effective_at        timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  author_cadre        text,
  source              text NOT NULL CHECK (source IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')),
  trust               smallint NOT NULL CHECK (trust BETWEEN 1 AND 4),
  status              text NOT NULL DEFAULT 'final' CHECK (status IN
                        ('preliminary','final','amended','corrected','entered_in_error','cancelled')),
  sensitivity         text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  reason_code         text,
  reason_ciphertext   text,
  client_key          text,
  concept_id text REFERENCES public.clinical_concepts(id) ON DELETE RESTRICT,
  text_ciphertext text,
  outcome text NOT NULL CHECK (outcome IN ('completed','not_done','declined','unable')),
  laterality text CHECK (laterality IS NULL OR laterality IN ('left','right','bilateral')),
  note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,
  CONSTRAINT procedures_version_chain CHECK ((version = 1) = (supersedes_id IS NULL)),
  CONSTRAINT procedures_eie_reason    CHECK (status <> 'entered_in_error' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
  CONSTRAINT proc_concept_or_text CHECK (concept_id IS NOT NULL OR text_ciphertext IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS procedures_logical_version ON public.procedures (logical_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS procedures_client_key ON public.procedures (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS procedures_supersedes ON public.procedures (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS procedures_patient_time ON public.procedures (patient_user_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS procedures_hospital_time ON public.procedures (hospital_id, recorded_at DESC);
DROP TRIGGER IF EXISTS procedures_no_mutation ON public.procedures;
CREATE TRIGGER procedures_no_mutation BEFORE UPDATE OR DELETE ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_procedures ON public.procedures;
CREATE TRIGGER audit_procedures AFTER INSERT OR UPDATE OR DELETE ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();


-- ─── 9. Allergies (PROMPT §7.5 harmonised) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.allergies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id          uuid NOT NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id       uuid REFERENCES public.allergies(id) ON DELETE RESTRICT,
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,   -- where it was recorded (provenance)
  patient_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id        uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  effective_at        timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,   -- nullable: backfilled rows (allergies_author)
  author_cadre        text,
  source              text NOT NULL CHECK (source IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')),
  trust               smallint NOT NULL CHECK (trust BETWEEN 1 AND 4),
  status              text NOT NULL DEFAULT 'final' CHECK (status IN
                        ('preliminary','final','amended','corrected','entered_in_error','cancelled')),
  sensitivity         text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  reason_code         text,
  reason_ciphertext   text,
  client_key          text,
  substance_kind text CHECK (substance_kind IS NULL OR substance_kind IN
    ('drug_ingredient','drug_class','food','environmental','other')),
  substance_code text,                                        -- formulary drugKey / drugClass (lib/prescribing) [H]
  substance_text_ciphertext text,                             -- as typed; still name-matched by prescribing [H]
  category text CHECK (category IS NULL OR category IN ('medication','food','environment','biologic')),
  allergy_type text CHECK (allergy_type IS NULL OR allergy_type IN ('allergy','intolerance')),
  criticality text CHECK (criticality IS NULL OR criticality IN ('low','high','unable_to_assess')),
  manifestations text[] NOT NULL DEFAULT '{}' CHECK (manifestations <@ ARRAY
    ['rash','urticaria','angioedema','anaphylaxis','bronchospasm','sjs_ten','other']::text[]),
  severity text CHECK (severity IS NULL OR severity IN ('mild','moderate','severe')),
  clinical_status text NOT NULL DEFAULT 'active' CHECK (clinical_status IN ('active','inactive','resolved')),
  verification text NOT NULL DEFAULT 'unconfirmed' CHECK (verification IN ('unconfirmed','confirmed','refuted')),
  onset jsonb,
  informant text NOT NULL CHECK (informant IN ('patient','relative','record','clinician_observed','resus_ample_migration')),
  legacy_ref jsonb,                                           -- {table, id[, index]}: backfilled rows only
  CONSTRAINT allergies_version_chain CHECK ((version = 1) = (supersedes_id IS NULL)),
  CONSTRAINT allergies_eie_reason    CHECK (status <> 'entered_in_error' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
  CONSTRAINT allergies_substance    CHECK (substance_code IS NOT NULL OR substance_text_ciphertext IS NOT NULL OR legacy_ref IS NOT NULL),
  CONSTRAINT allergies_kind_code    CHECK ((substance_code IS NULL) = (substance_kind IS NULL)),
  CONSTRAINT allergies_refute       CHECK (verification <> 'refuted' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
  CONSTRAINT allergies_author       CHECK (recorded_by_user_id IS NOT NULL OR legacy_ref IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS allergies_logical_version ON public.allergies (logical_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS allergies_client_key ON public.allergies (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS allergies_supersedes ON public.allergies (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS allergies_patient_time ON public.allergies (patient_user_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS allergies_hospital_time ON public.allergies (hospital_id, recorded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS allergies_legacy_ref_uidx ON public.allergies
  ((legacy_ref->>'table'), (legacy_ref->>'id'), (coalesce(legacy_ref->>'index', '')))
  WHERE legacy_ref IS NOT NULL AND version = 1;               -- copied once; the backfill is re-runnable
DROP TRIGGER IF EXISTS allergies_no_mutation ON public.allergies;
CREATE TRIGGER allergies_no_mutation BEFORE UPDATE OR DELETE ON public.allergies
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_allergies ON public.allergies;
CREATE TRIGGER audit_allergies AFTER INSERT OR UPDATE OR DELETE ON public.allergies
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

CREATE TABLE IF NOT EXISTS public.allergy_status_assertions (   -- insert-only; the newest non-voided row is current
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  assertion text NOT NULL CHECK (assertion IN ('no_known_drug_allergies','unable_to_assess')),
  asserted_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  asserter_cadre text,
  asserted_at timestamptz NOT NULL,                           -- clinical time
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'clinician' CHECK (source IN ('clinician','resus_ample_migration')),
  status text NOT NULL DEFAULT 'final' CHECK (status IN ('final','entered_in_error')),
  supersedes_id uuid REFERENCES public.allergy_status_assertions(id) ON DELETE RESTRICT,
  reason_code text, reason_ciphertext text, legacy_ref jsonb, client_key text,
  CONSTRAINT asa_eie CHECK (status <> 'entered_in_error'
    OR (supersedes_id IS NOT NULL AND (reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL))));
CREATE UNIQUE INDEX IF NOT EXISTS asa_legacy_ref_uidx ON public.allergy_status_assertions ((legacy_ref->>'table'), (legacy_ref->>'id'))
  WHERE legacy_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS asa_patient_time ON public.allergy_status_assertions (patient_user_id, asserted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS asa_client_key ON public.allergy_status_assertions (client_key) WHERE client_key IS NOT NULL;
DROP TRIGGER IF EXISTS allergy_status_assertions_no_mutation ON public.allergy_status_assertions;
CREATE TRIGGER allergy_status_assertions_no_mutation BEFORE UPDATE OR DELETE ON public.allergy_status_assertions
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_allergy_status_assertions ON public.allergy_status_assertions;
CREATE TRIGGER audit_allergy_status_assertions AFTER INSERT OR UPDATE OR DELETE ON public.allergy_status_assertions
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();


-- ─── 10. Acknowledgement and critical communication ──────────────────
CREATE TABLE IF NOT EXISTS public.result_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.diagnostic_reports(id) ON DELETE RESTRICT,   -- a version: amended → re-ack (D-EMR-07)
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  acknowledged_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  acknowledger_cadre text NOT NULL,
  action text NOT NULL CHECK (action IN ('seen','acted','forwarded')),
  forwarded_to_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  note_ciphertext text,
  recorded_at timestamptz NOT NULL DEFAULT now(), client_key text,
  CONSTRAINT ra_forward CHECK ((action = 'forwarded') = (forwarded_to_user_id IS NOT NULL)));
CREATE INDEX IF NOT EXISTS result_ack_report ON public.result_acknowledgements (report_id);
CREATE INDEX IF NOT EXISTS result_ack_user   ON public.result_acknowledgements (acknowledged_by_user_id, recorded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS result_ack_client_key ON public.result_acknowledgements (client_key) WHERE client_key IS NOT NULL;
DROP TRIGGER IF EXISTS result_acknowledgements_no_mutation ON public.result_acknowledgements;
CREATE TRIGGER result_acknowledgements_no_mutation BEFORE UPDATE OR DELETE ON public.result_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_result_acknowledgements ON public.result_acknowledgements;
CREATE TRIGGER audit_result_acknowledgements AFTER INSERT OR UPDATE OR DELETE ON public.result_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

CREATE TABLE IF NOT EXISTS public.critical_result_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.diagnostic_reports(id) ON DELETE RESTRICT,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  communicated_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  communicated_to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  communicated_to_role text NOT NULL CHECK (communicated_to_role IN ('orderer','covering_clinician','in_charge')),
  method text NOT NULL CHECK (method IN ('in_app','phone','in_person')),
  read_back boolean NOT NULL,
  communicated_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), client_key text);
CREATE INDEX IF NOT EXISTS crit_comm_report ON public.critical_result_communications (report_id);
CREATE UNIQUE INDEX IF NOT EXISTS crit_comm_client_key ON public.critical_result_communications (client_key) WHERE client_key IS NOT NULL;
DROP TRIGGER IF EXISTS critical_result_communications_no_mutation ON public.critical_result_communications;
CREATE TRIGGER critical_result_communications_no_mutation BEFORE UPDATE OR DELETE ON public.critical_result_communications
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS audit_critical_result_communications ON public.critical_result_communications;
CREATE TRIGGER audit_critical_result_communications AFTER INSERT OR UPDATE OR DELETE ON public.critical_result_communications
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();


-- ─── 11. clinical_phi_access_log basis (evolve; 0030:249) ────────────
-- DROP-then-ADD: 0030's list verbatim plus the two new SQL bases, so they are logged truly.
ALTER TABLE public.clinical_phi_access_log DROP CONSTRAINT IF EXISTS phi_access_basis_check;
ALTER TABLE public.clinical_phi_access_log ADD CONSTRAINT phi_access_basis_check CHECK (access_basis IN
  ('care_team','active_encounter','department_recent','break_glass',     -- 0030, kept
   'assigned','open_intake'));                                           -- new


-- ─── 12. Views (security_invoker, so RLS applies as the reader) ──────
-- "Current" = the newest version of each logical item, any status; the chart shows entered-in-error
-- struck through, and the loader drops entered_in_error/cancelled (CFC §3.3). Legacy rows are loader
-- projections.
CREATE OR REPLACE VIEW public.clinical_observations_current WITH (security_invoker = true) AS
  SELECT o.* FROM public.clinical_observations o
  WHERE o.concept_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.clinical_observations s WHERE s.supersedes_id = o.id);

CREATE OR REPLACE VIEW public.conditions_current WITH (security_invoker = true) AS
  SELECT c.* FROM public.conditions c
  WHERE NOT EXISTS (SELECT 1 FROM public.conditions s WHERE s.supersedes_id = c.id);

CREATE OR REPLACE VIEW public.medication_statements_current WITH (security_invoker = true) AS
  SELECT m.* FROM public.medication_statements m
  WHERE NOT EXISTS (SELECT 1 FROM public.medication_statements s WHERE s.supersedes_id = m.id);

CREATE OR REPLACE VIEW public.allergies_current WITH (security_invoker = true) AS
  SELECT a.* FROM public.allergies a
  WHERE NOT EXISTS (SELECT 1 FROM public.allergies s WHERE s.supersedes_id = a.id);

CREATE OR REPLACE VIEW public.clinical_notes_current WITH (security_invoker = true) AS
  SELECT n.*,
    CASE WHEN x.eie_at IS NOT NULL THEN 'entered_in_error'
         WHEN n.state = 'draft' THEN 'draft'
         WHEN x.cosigned_at IS NOT NULL THEN 'cosigned'
         WHEN x.cosign_requested_at IS NOT NULL THEN 'awaiting_cosign'
         ELSE 'signed' END AS status,
    x.cosigned_at, x.cosigned_by_user_id, x.eie_at, x.addenda
  FROM public.clinical_notes n
  LEFT JOIN LATERAL (
    SELECT max(e.recorded_at) FILTER (WHERE e.kind = 'entered_in_error')  AS eie_at,
           max(e.recorded_at) FILTER (WHERE e.kind = 'cosigned')          AS cosigned_at,
           (array_agg(e.actor_user_id ORDER BY e.recorded_at DESC) FILTER (WHERE e.kind = 'cosigned'))[1] AS cosigned_by_user_id,
           max(e.recorded_at) FILTER (WHERE e.kind = 'cosign_requested')  AS cosign_requested_at,
           count(*)           FILTER (WHERE e.kind = 'addendum_added')    AS addenda
    FROM public.clinical_note_events e WHERE e.note_id = n.id) x ON true;


-- ─── 13. The one access rule — private functions ─────────────────────
-- One patient-access rule (HARMONISATION §2), hospital-scoped. Bases strongest first. Every basis except
-- break_glass requires an active clinical affiliation at THIS hospital, so reception (cadres.is_clinical=false,
-- 0033:23) never matches and a suspended clinician's stale assignment grants nothing.
CREATE OR REPLACE FUNCTION private.patient_access_basis(p_user uuid, p_patient uuid, p_hospital uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH clin AS (
    SELECT sa.department_id
    FROM public.staff_affiliations sa              -- 0013:82  user_id, hospital_id, department_id, cadre_id, state
    JOIN public.cadres c ON c.id = sa.cadre_id     -- 0008:86 + 0033:23  is_clinical
    JOIN public.hospital_departments d             -- 0000:33  hospital_id: the department really is this hospital's
      ON d.id = sa.department_id AND d.hospital_id = p_hospital
    WHERE sa.user_id = p_user
      AND sa.hospital_id = p_hospital
      AND sa.state IN ('active','approved')
      AND c.is_clinical
  )
  SELECT CASE
    WHEN p_user IS NULL OR p_patient IS NULL OR p_hospital IS NULL THEN NULL
    -- 1. active_encounter — encounters (0028:262): clinician_user_id, patient_user_id, hospital_id, state
    WHEN EXISTS (SELECT 1 FROM clin) AND EXISTS (
      SELECT 1 FROM public.encounters e
      WHERE e.clinician_user_id = p_user AND e.patient_user_id = p_patient
        AND e.hospital_id = p_hospital AND e.state = 'in_progress')
      THEN 'active_encounter'
    -- 2. assigned — nursing_assignments (0031:21): nurse_user_id, patient_user_id, hospital_id, starts_at, ends_at
    WHEN EXISTS (SELECT 1 FROM clin) AND EXISTS (
      SELECT 1 FROM public.nursing_assignments na
      WHERE na.nurse_user_id = p_user AND na.patient_user_id = p_patient
        AND na.hospital_id = p_hospital AND na.ends_at IS NULL AND na.starts_at <= now())
      THEN 'assigned'
    -- 3. open_intake — patient_intakes (0032:56, 0035:25): patient_user_id, hospital_id, status, arrived_at.
    --    Present at this hospital today (hospital day in Africa/Kampala = DEFAULT_TIME_ZONE, _shared/slots.ts:191).
    WHEN EXISTS (SELECT 1 FROM clin) AND EXISTS (
      SELECT 1 FROM public.patient_intakes pi
      WHERE pi.patient_user_id = p_patient AND pi.hospital_id = p_hospital
        AND pi.status IN ('arrived','awaiting_triage','triaged')
        AND pi.arrived_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Kampala') AT TIME ZONE 'Africa/Kampala'))
      THEN 'open_intake'
    -- 4. department_recent — appointments (0028:175): department_id, patient_user_id, hospital_id, starts_at;
    --    encounters: department_id, started_at. 30 days = DEPARTMENT_WINDOW_DAYS (lib/encounter/scope.ts:43).
    WHEN EXISTS (
      SELECT 1 FROM clin JOIN public.appointments a ON a.department_id = clin.department_id
      WHERE a.patient_user_id = p_patient AND a.hospital_id = p_hospital
        AND a.starts_at >= now() - interval '30 days')
      OR EXISTS (
      SELECT 1 FROM clin JOIN public.encounters e ON e.department_id = clin.department_id
      WHERE e.patient_user_id = p_patient AND e.hospital_id = p_hospital
        AND e.started_at >= now() - interval '30 days')
      THEN 'department_recent'
    -- 5. care_team — seam: no care-team table yet, so it never matches.
    -- 6. break_glass — sa_break_glass_grants (0018:194): actor_id, patient_id, hospital_id (nullable), revoked_at, expires_at
    WHEN EXISTS (
      SELECT 1 FROM public.sa_break_glass_grants g
      WHERE g.actor_id = p_user AND g.patient_id = p_patient
        AND g.revoked_at IS NULL AND g.expires_at > now()
        AND (g.hospital_id IS NULL OR g.hospital_id = p_hospital))
      THEN 'break_glass'
  END;
$$;

-- The same rule as a set, for RLS (evaluated once per statement as an initPlan).
-- ponytail: two bodies of one rule; the PGlite equivalence probe (F.3) fails on any drift. Upgrade path: one SRF
-- both call, if the per-patient form ever measures fast enough over it.
CREATE OR REPLACE FUNCTION private.accessible_patient_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH me AS (SELECT private.current_user_id() AS uid, private.current_hospital_id() AS hid),
  clin AS (
    SELECT sa.department_id FROM me
    JOIN public.staff_affiliations sa ON sa.user_id = me.uid AND sa.hospital_id = me.hid
    JOIN public.cadres c ON c.id = sa.cadre_id
    JOIN public.hospital_departments d ON d.id = sa.department_id AND d.hospital_id = me.hid
    WHERE sa.state IN ('active','approved') AND c.is_clinical
  ),
  by_affiliation AS (
    SELECT e.patient_user_id FROM me JOIN public.encounters e
      ON e.clinician_user_id = me.uid AND e.hospital_id = me.hid AND e.state = 'in_progress'
    UNION
    SELECT na.patient_user_id FROM me JOIN public.nursing_assignments na
      ON na.nurse_user_id = me.uid AND na.hospital_id = me.hid AND na.ends_at IS NULL AND na.starts_at <= now()
    UNION
    SELECT pi.patient_user_id FROM me JOIN public.patient_intakes pi
      ON pi.hospital_id = me.hid AND pi.patient_user_id IS NOT NULL
     AND pi.status IN ('arrived','awaiting_triage','triaged')
     AND pi.arrived_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Kampala') AT TIME ZONE 'Africa/Kampala')
    UNION
    SELECT a.patient_user_id FROM me, clin JOIN public.appointments a ON a.department_id = clin.department_id
      WHERE a.hospital_id = me.hid AND a.starts_at >= now() - interval '30 days'
    UNION
    SELECT e.patient_user_id FROM me, clin JOIN public.encounters e ON e.department_id = clin.department_id
      WHERE e.hospital_id = me.hid AND e.started_at >= now() - interval '30 days'
  )
  SELECT patient_user_id FROM by_affiliation WHERE EXISTS (SELECT 1 FROM clin)
  UNION
  SELECT g.patient_id FROM me JOIN public.sa_break_glass_grants g
    ON g.actor_id = me.uid AND g.revoked_at IS NULL AND g.expires_at > now()
   AND (g.hospital_id IS NULL OR g.hospital_id = me.hid);
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_user_id(), private.current_hospital_id(), private.accessible_patient_ids()
  TO medsync_clinical_reader;
-- patient_access_basis: owner only here (asClinicalWriter and the TS check run as owner). 0073 grants it to
-- authenticated for the realtime receive policy on chart:<patient> (private is not a PostgREST-exposed schema).

-- The open_intake probe: patient present at this hospital today.
CREATE INDEX IF NOT EXISTS patient_intakes_patient_hospital_day ON public.patient_intakes (patient_user_id,
  hospital_id, arrived_at DESC) WHERE status IN ('arrived','awaiting_triage','triaged');


-- ─── 14. RLS and grants ──────────────────────────────────────────────
-- (1) New clinical tables: ENABLE + FORCE, one SELECT policy for the reader role, nothing for anon or
--     authenticated (so patient, reception and anonymous reads are denied) and no client write anywhere.
--     Writes happen as the owner in lib/emr/write/*, after private.patient_access_basis().
ALTER TABLE public.clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinical_notes_select_clinical ON public.clinical_notes;
CREATE POLICY clinical_notes_select_clinical ON public.clinical_notes FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.clinical_notes FROM anon, authenticated;
GRANT SELECT ON public.clinical_notes TO medsync_clinical_reader;

ALTER TABLE public.clinical_note_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_note_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinical_note_events_select_clinical ON public.clinical_note_events;
CREATE POLICY clinical_note_events_select_clinical ON public.clinical_note_events FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.clinical_note_events FROM anon, authenticated;
GRANT SELECT ON public.clinical_note_events TO medsync_clinical_reader;

ALTER TABLE public.conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conditions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conditions_select_clinical ON public.conditions;
CREATE POLICY conditions_select_clinical ON public.conditions FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.conditions FROM anon, authenticated;
GRANT SELECT ON public.conditions TO medsync_clinical_reader;

ALTER TABLE public.medication_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_statements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS medication_statements_select_clinical ON public.medication_statements;
CREATE POLICY medication_statements_select_clinical ON public.medication_statements FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.medication_statements FROM anon, authenticated;
GRANT SELECT ON public.medication_statements TO medsync_clinical_reader;

ALTER TABLE public.pregnancy_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pregnancy_episodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pregnancy_episodes_select_clinical ON public.pregnancy_episodes;
CREATE POLICY pregnancy_episodes_select_clinical ON public.pregnancy_episodes FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pregnancy_episodes FROM anon, authenticated;
GRANT SELECT ON public.pregnancy_episodes TO medsync_clinical_reader;

ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS procedures_select_clinical ON public.procedures;
CREATE POLICY procedures_select_clinical ON public.procedures FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.procedures FROM anon, authenticated;
GRANT SELECT ON public.procedures TO medsync_clinical_reader;

-- STOP 1 [H, safety-positive]: allergies cross hospitals. A basis for the patient at the reader's own
-- hospital (accessible_patient_ids is hospital-scoped) shows the patient's allergies from every hospital;
-- hospital_id stays on the row as provenance ("recorded at …"). No hospital equality here, by decision.
ALTER TABLE public.allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allergies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allergies_select_clinical ON public.allergies;
CREATE POLICY allergies_select_clinical ON public.allergies FOR SELECT TO medsync_clinical_reader
  USING (patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.allergies FROM anon, authenticated;
GRANT SELECT ON public.allergies TO medsync_clinical_reader;

ALTER TABLE public.allergy_status_assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allergy_status_assertions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allergy_status_assertions_select_clinical ON public.allergy_status_assertions;
CREATE POLICY allergy_status_assertions_select_clinical ON public.allergy_status_assertions FOR SELECT TO medsync_clinical_reader
  USING (patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.allergy_status_assertions FROM anon, authenticated;
GRANT SELECT ON public.allergy_status_assertions TO medsync_clinical_reader;

ALTER TABLE public.encounter_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encounter_order_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS encounter_order_events_select_clinical ON public.encounter_order_events;
CREATE POLICY encounter_order_events_select_clinical ON public.encounter_order_events FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.encounter_order_events FROM anon, authenticated;
GRANT SELECT ON public.encounter_order_events TO medsync_clinical_reader;

ALTER TABLE public.specimens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specimens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS specimens_select_clinical ON public.specimens;
CREATE POLICY specimens_select_clinical ON public.specimens FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.specimens FROM anon, authenticated;
GRANT SELECT ON public.specimens TO medsync_clinical_reader;

ALTER TABLE public.specimen_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specimen_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS specimen_events_select_clinical ON public.specimen_events;
CREATE POLICY specimen_events_select_clinical ON public.specimen_events FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.specimen_events FROM anon, authenticated;
GRANT SELECT ON public.specimen_events TO medsync_clinical_reader;

ALTER TABLE public.diagnostic_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS diagnostic_reports_select_clinical ON public.diagnostic_reports;
CREATE POLICY diagnostic_reports_select_clinical ON public.diagnostic_reports FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.diagnostic_reports FROM anon, authenticated;
GRANT SELECT ON public.diagnostic_reports TO medsync_clinical_reader;

ALTER TABLE public.result_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_acknowledgements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS result_acknowledgements_select_clinical ON public.result_acknowledgements;
CREATE POLICY result_acknowledgements_select_clinical ON public.result_acknowledgements FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.result_acknowledgements FROM anon, authenticated;
GRANT SELECT ON public.result_acknowledgements TO medsync_clinical_reader;

ALTER TABLE public.critical_result_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.critical_result_communications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS critical_result_communications_select_clinical ON public.critical_result_communications;
CREATE POLICY critical_result_communications_select_clinical ON public.critical_result_communications FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.critical_result_communications FROM anon, authenticated;
GRANT SELECT ON public.critical_result_communications TO medsync_clinical_reader;

-- (2) Evolved / projected legacy tables: ADD a reader policy; their authenticated policies stay as they are
--     (0040 still lets a patient read their own legacy rows: a known gap, recorded in ADR 0131).
DROP POLICY IF EXISTS encounters_select_clinical ON public.encounters;
CREATE POLICY encounters_select_clinical ON public.encounters FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
DROP POLICY IF EXISTS clinical_observations_select_clinical ON public.clinical_observations;
CREATE POLICY clinical_observations_select_clinical ON public.clinical_observations FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
-- The 0031/0033 policy lets a patient read their own rows through the client key.
-- CFC rows can be restricted (HIV, TB, SRH — C9) and patient access waits for
-- Gate CG, so a RESTRICTIVE policy hides every CFC row from `authenticated`.
-- Legacy rows are untouched; EMR reads use medsync_clinical_reader, not this role.
DROP POLICY IF EXISTS clinical_observations_cfc_not_client ON public.clinical_observations;
CREATE POLICY clinical_observations_cfc_not_client ON public.clinical_observations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (concept_id IS NULL);
-- Same reason for orders: 0040's enc_order_select_scoped lets a patient read their own orders, and an
-- events-lifecycle order can be restricted (an HIV viral load names the workup). Legacy rows are 'standard'.
DROP POLICY IF EXISTS encounter_orders_restricted_not_client ON public.encounter_orders;
CREATE POLICY encounter_orders_restricted_not_client ON public.encounter_orders
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (sensitivity = 'standard' OR patient_user_id IS DISTINCT FROM auth.uid());
DROP POLICY IF EXISTS triage_records_select_clinical ON public.triage_records;
CREATE POLICY triage_records_select_clinical ON public.triage_records FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
DROP POLICY IF EXISTS clinical_cosign_requests_select_clinical ON public.clinical_cosign_requests;
CREATE POLICY clinical_cosign_requests_select_clinical ON public.clinical_cosign_requests FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
DROP POLICY IF EXISTS problem_list_select_clinical ON public.problem_list;
CREATE POLICY problem_list_select_clinical ON public.problem_list FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
-- These three carry no reliable hospital_id of their own (legacy orders have none): scope via the encounter.
DROP POLICY IF EXISTS encounter_orders_select_clinical ON public.encounter_orders;
CREATE POLICY encounter_orders_select_clinical ON public.encounter_orders FOR SELECT TO medsync_clinical_reader
  USING (patient_user_id IN (SELECT private.accessible_patient_ids())
         AND EXISTS (SELECT 1 FROM public.encounters e WHERE e.id = encounter_orders.encounter_id
                     AND e.hospital_id = (SELECT private.current_hospital_id())));
DROP POLICY IF EXISTS encounter_diagnoses_select_clinical ON public.encounter_diagnoses;
CREATE POLICY encounter_diagnoses_select_clinical ON public.encounter_diagnoses FOR SELECT TO medsync_clinical_reader
  USING (patient_user_id IN (SELECT private.accessible_patient_ids())
         AND EXISTS (SELECT 1 FROM public.encounters e WHERE e.id = encounter_diagnoses.encounter_id
                     AND e.hospital_id = (SELECT private.current_hospital_id())));
DROP POLICY IF EXISTS encounter_results_select_clinical ON public.encounter_results;
CREATE POLICY encounter_results_select_clinical ON public.encounter_results FOR SELECT TO medsync_clinical_reader
  USING (EXISTS (SELECT 1 FROM public.encounter_orders o JOIN public.encounters e ON e.id = o.encounter_id
                 WHERE o.id = encounter_results.order_id
                   AND o.patient_user_id IN (SELECT private.accessible_patient_ids())
                   AND e.hospital_id = (SELECT private.current_hospital_id())));
GRANT SELECT ON public.encounters, public.clinical_observations, public.triage_records, public.clinical_cosign_requests,
  public.problem_list, public.encounter_orders, public.encounter_diagnoses, public.encounter_results
  TO medsync_clinical_reader;

-- (3) Views: the reader only. Revoked from the client roles explicitly: Supabase's default privileges
--     would grant them, and clinical_observations_current reads through a legacy table whose
--     authenticated policy lets a patient see their own rows.
REVOKE ALL ON public.clinical_observations_current, public.conditions_current, public.medication_statements_current,
  public.allergies_current, public.clinical_notes_current FROM anon, authenticated;
GRANT SELECT ON public.clinical_observations_current, public.conditions_current, public.medication_statements_current,
  public.allergies_current, public.clinical_notes_current TO medsync_clinical_reader;

-- (4) Registries (non-PHI config): readable by staff clients and the reader; no client writes.
ALTER TABLE public.clinical_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_concepts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinical_concepts_select ON public.clinical_concepts;
CREATE POLICY clinical_concepts_select ON public.clinical_concepts FOR SELECT TO authenticated, medsync_clinical_reader USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.clinical_concepts FROM anon, authenticated;
GRANT SELECT ON public.clinical_concepts TO authenticated, medsync_clinical_reader;

ALTER TABLE public.drug_class_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drug_class_tags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drug_class_tags_select ON public.drug_class_tags;
CREATE POLICY drug_class_tags_select ON public.drug_class_tags FOR SELECT TO authenticated, medsync_clinical_reader USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.drug_class_tags FROM anon, authenticated;
GRANT SELECT ON public.drug_class_tags TO authenticated, medsync_clinical_reader;

ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capabilities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capabilities_select ON public.capabilities;
CREATE POLICY capabilities_select ON public.capabilities FOR SELECT TO authenticated, medsync_clinical_reader USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.capabilities FROM anon, authenticated;
GRANT SELECT ON public.capabilities TO authenticated, medsync_clinical_reader;

ALTER TABLE public.facility_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_capabilities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facility_capabilities_select ON public.facility_capabilities;
CREATE POLICY facility_capabilities_select ON public.facility_capabilities FOR SELECT TO authenticated, medsync_clinical_reader USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.facility_capabilities FROM anon, authenticated;
GRANT SELECT ON public.facility_capabilities TO authenticated, medsync_clinical_reader;

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS devices_select ON public.devices;
CREATE POLICY devices_select ON public.devices FOR SELECT TO authenticated, medsync_clinical_reader USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.devices FROM anon, authenticated;
GRANT SELECT ON public.devices TO authenticated, medsync_clinical_reader;

ALTER TABLE public.test_catalogue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_catalogue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS test_catalogue_select ON public.test_catalogue;
CREATE POLICY test_catalogue_select ON public.test_catalogue FOR SELECT TO authenticated, medsync_clinical_reader USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.test_catalogue FROM anon, authenticated;
GRANT SELECT ON public.test_catalogue TO authenticated, medsync_clinical_reader;

ALTER TABLE public.diagnosis_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnosis_terms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS diagnosis_terms_select ON public.diagnosis_terms;
CREATE POLICY diagnosis_terms_select ON public.diagnosis_terms FOR SELECT TO authenticated, medsync_clinical_reader USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.diagnosis_terms FROM anon, authenticated;
GRANT SELECT ON public.diagnosis_terms TO authenticated, medsync_clinical_reader;


-- ─── 15. Backfill (insert-only copies; sources never altered; re-runnable) ─
-- Backfilled text [D2]: SQL cannot produce lib/encryption.ts ciphertext, so copied rows carry legacy_ref and
-- no ciphertext; the projection reads the display text from the untouched source. O-5 (extended) inserts
-- version 2 of each with ciphertext.

-- (a) patient_allergies (0040:211; writer lib/encounter/record.ts:116) → allergies, informant 'record'.
INSERT INTO public.allergies
  (id, logical_id, version, hospital_id, patient_user_id, category, criticality, manifestations, severity,
   clinical_status, verification, informant, source, trust, status, sensitivity,
   effective_at, recorded_at, recorded_by_user_id, legacy_ref)
SELECT x.new_id, x.new_id, 1, x.hospital_id, x.patient_user_id,
       NULL,                                                   -- the source does not say medication or food
       CASE WHEN x.severity = 'anaphylaxis' THEN 'high' END,   -- reference [05]: high after anaphylaxis
       CASE WHEN x.severity = 'anaphylaxis' THEN ARRAY['anaphylaxis'] ELSE '{}'::text[] END,
       CASE WHEN x.severity IN ('mild','moderate','severe') THEN x.severity
            WHEN x.severity = 'anaphylaxis' THEN 'severe' END, -- 'unknown'/NULL → NULL
       'active', 'unconfirmed', 'record', 'clinician', 3, 'final', 'standard',
       x.recorded_at, x.created_at, x.recorded_by_user_id,
       jsonb_build_object('table', 'patient_allergies', 'id', x.src_id)
FROM (SELECT gen_random_uuid() AS new_id, pa.id AS src_id, pa.hospital_id, pa.patient_user_id, pa.severity,
             pa.recorded_at, pa.created_at, pa.recorded_by_user_id
      FROM public.patient_allergies pa) x
ON CONFLICT ((legacy_ref->>'table'), (legacy_ref->>'id'), (coalesce(legacy_ref->>'index', '')))
  WHERE legacy_ref IS NOT NULL AND version = 1 DO NOTHING;

-- (b) resus AMPLE captures: resus_timeline_events (0038:98; 0068:84) kind 'note', payload.allergyCapture
--     {substances: text[], nkda: boolean} (buildAllergyNote, lib/resus/v2-payloads.ts:181; recordResusAllergies,
--     app/nurse/resus/actions.ts:1104; AMPLE via recordExposureFindings :999). Mirror the reader
--     (recordedAllergiesFromTimeline, lib/prescribing/administration.ts:61): per episode the latest capture by
--     bedside time wins and nkda clears it. Superseded events are skipped. Unknown patients cannot be copied.
CREATE TEMP TABLE _emr_resus_caps AS
SELECT DISTINCT ON (t.episode_id)
       t.id AS event_id, t.recorded_at, t.created_at, t.recorded_by_user_id,
       ep.hospital_id, ep.patient_user_id, ep.encounter_id,
       (t.payload->'allergyCapture'->>'nkda') IS NOT DISTINCT FROM 'true'  AS nkda,   -- no cast: bad data cannot abort 0071
       CASE WHEN jsonb_typeof(t.payload->'allergyCapture'->'substances') = 'array'
            THEN t.payload->'allergyCapture'->'substances' ELSE '[]'::jsonb END AS substances
FROM public.resus_timeline_events t
JOIN public.resus_episodes ep ON ep.id = t.episode_id             -- 0038:26 hospital_id, patient_user_id, encounter_id
WHERE t.kind = 'note'
  AND t.payload ? 'allergyCapture'
  AND ep.patient_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.resus_timeline_events s WHERE s.supersedes_event_id = t.id)
ORDER BY t.episode_id, t.recorded_at DESC, t.created_at DESC;

INSERT INTO public.allergies
  (id, logical_id, version, hospital_id, patient_user_id, encounter_id, category, manifestations,
   clinical_status, verification, informant, source, trust, status, sensitivity,
   effective_at, recorded_at, recorded_by_user_id, legacy_ref)
SELECT x.new_id, x.new_id, 1, x.hospital_id, x.patient_user_id, x.encounter_id, NULL, '{}'::text[],
       'active', 'unconfirmed', 'resus_ample_migration', 'clinician', 3, 'final', 'standard',
       x.recorded_at, x.created_at, x.recorded_by_user_id,
       jsonb_build_object('table', 'resus_timeline_events', 'id', x.event_id, 'index', x.idx)
FROM (SELECT gen_random_uuid() AS new_id, c.*, (s.ord - 1)::text AS idx
      FROM _emr_resus_caps c
      CROSS JOIN LATERAL jsonb_array_elements_text(c.substances) WITH ORDINALITY AS s(substance, ord)
      WHERE NOT c.nkda AND length(trim(s.substance)) > 0) x
ON CONFLICT ((legacy_ref->>'table'), (legacy_ref->>'id'), (coalesce(legacy_ref->>'index', '')))
  WHERE legacy_ref IS NOT NULL AND version = 1 DO NOTHING;

INSERT INTO public.allergy_status_assertions
  (hospital_id, patient_user_id, encounter_id, assertion, asserted_by_user_id, asserted_at, recorded_at, source, legacy_ref)
SELECT c.hospital_id, c.patient_user_id, c.encounter_id, 'no_known_drug_allergies', c.recorded_by_user_id,
       c.recorded_at, c.created_at, 'resus_ample_migration',
       jsonb_build_object('table', 'resus_timeline_events', 'id', c.event_id)
FROM _emr_resus_caps c
WHERE c.nkda AND c.recorded_by_user_id IS NOT NULL                -- an assertion needs a named person (ref [05])
ON CONFLICT ((legacy_ref->>'table'), (legacy_ref->>'id')) WHERE legacy_ref IS NOT NULL DO NOTHING;

DROP TABLE _emr_resus_caps;                                       -- explicit: the harness replays outside a tx
