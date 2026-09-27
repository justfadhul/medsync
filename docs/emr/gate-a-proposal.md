# EMR GATE A proposal pack (Phase 1)

> **What** PROMPT-ENCOUNTER-EMR §11 Phase 1, harmonised per `HARMONISATION.md` (binding). Branch `feat/emr-engine`.
> **Status** SIGNED as recommended by Fadhul (owner, CSO), 2026-09-26, in session (§G). **[H]** marks a harmonised
> mechanism; **[D#]** marks a deviation this pack makes from HARMONISATION wording, with its reason (§H).
> **Evidence** `docs/emr/discovery/*.md` (Phase 0, file:line). The repo wins over every spec.
> **Companions** `cfc-v1.1-addendum.md` · `data/emr/note-templates.v1.json` (10 templates + 2 modules, 27 required and
> 4 prompted sign rules) · `data/emr/clinical-fact-concepts.v1.1.json` (59 concepts, 57 candidate LOINC codes, 8 conversions).
> **Rule** No clinical number appears here. Critical limits, plausibility bounds, HMIS, IDSR, REF-PREG-AGE and the fasting
> definition ship as `RefEntry` files with `status: 'pending_cso'` and the value withheld.

| §   | Contents                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Schema diff for `0071_emr_record_spine.sql`: conventions, SQL table by table, guards, views, indexes, private functions, RLS and grants, backfill |
| B   | Evolve versus new, and the legacy-data plan                                                                                                       |
| C   | ADR drafts 0130–0139                                                                                                                              |
| D   | Permission matrix (cadre × action)                                                                                                                |
| E   | Annotated wireframes                                                                                                                              |
| F   | Test plan                                                                                                                                         |
| G   | Decision table and signature block                                                                                                                |
| H   | Deviations, operational defaults, owner actions, open confirmations                                                                               |

---

## A. Schema diff — `0071_emr_record_spine.sql`

### A.0 Conventions (apply to every statement below)

| Rule                     | Applied as                                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header                   | `-- GATED: owner-applied (npm run db:migrate)` + "until it runs, `EMR_V1` stays off and every page behaves as before" (0069:15)                                                                                                                     |
| Enum style               | text + CHECK. A CHECK change is DROP-then-ADD of the whole prior list, verbatim (0069:21-27)                                                                                                                                                        |
| Names                    | `hospital_id`, `patient_user_id`, `*_user_id`; ciphertext is `text` in the `lib/encryption.ts` wire format (`iv:tag:ct`), like `resus_timeline_events.narrative_encrypted` (0038:107)                                                               |
| FKs from new tables      | `ON DELETE RESTRICT`. A CASCADE or SET NULL into an immutable row would fire the guard; clinical rows are never deleted (PROMPT §10)                                                                                                                |
| Two clocks               | `effective_at` (clinical) NOT NULL; `recorded_at` (knowledge) DEFAULT now()                                                                                                                                                                         |
| Idempotency              | `client_key text`, unique per table where not null                                                                                                                                                                                                  |
| Audit                    | `public.audit_log_changes()` (0003:20) AFTER INSERT OR UPDATE OR DELETE on every new and evolved table                                                                                                                                              |
| Insert-only              | `public.block_modify_append_only()` (0040:118) BEFORE UPDATE OR DELETE **[D1]**                                                                                                                                                                     |
| RLS                      | ENABLE + FORCE on every new table. One SELECT policy `TO medsync_clinical_reader`. No policy for `anon`/`authenticated`, so patient, reception and anonymous reads are denied; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE … FROM anon, authenticated` |
| Nothing existing altered | No UPDATE or DELETE of an existing row. `ADD COLUMN … DEFAULT <constant>` is catalogue-only (PG ≥ 11), rewrites nothing and fires no trigger                                                                                                        |

Statement order in the file: §A.1 private + role → A.2 registries → A.3 encounters → A.4 notes → A.5 co-sign →
A.6 orders, specimens, reports → A.7 observations → A.8 conditions, medicines, pregnancy, procedures → A.9 allergies →
A.10 acknowledgements, critical communications → A.11 PHI log → A.12 views → A.13 access functions → A.14 RLS and
grants → A.15 backfill.

**Pre-check (2026-09-26, PGlite harness, scratch only).** The 15 complete SQL blocks below (all but the envelope
template and the per-table A.14 template) ran in order over a 0000–0070 replay. With fixtures, the backfill copied
2 `patient_allergies` rows (anaphylaxis → severity severe, criticality high) and the 2 substances of an episode's latest
capture (the earlier capture skipped), wrote 1 NKDA assertion, skipped a malformed capture without aborting, and added
0 rows on re-run. Both access functions executed. The observation guard allowed `active→corrected` and refused another
legacy UPDATE, a DELETE, and a legacy row tagged `fact`. Phase 2 writes the per-table `no_mutation`/audit triggers the
comments name, then replays 0000–0073.

### A.1 `private` schema, reader role, identity

```sql
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medsync_clinical_reader') THEN
    CREATE ROLE medsync_clinical_reader NOLOGIN;              -- no BYPASSRLS: RLS applies after SET LOCAL ROLE
  END IF;
END $$;
GRANT medsync_clinical_reader TO CURRENT_USER;              -- the migrating owner may SET LOCAL ROLE to it
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
```

`lib/emr/db.ts`: `asClinicalReader(scope, fn)` = `db.transaction` → `set_config('app.user_id', uid, true)`,
`set_config('app.hospital_id', hid, true)` → `SET LOCAL ROLE medsync_clinical_reader` → `fn(tx)`.
`asClinicalWriter(scope, patient, fn)` = `db.transaction` → same `set_config` → `SELECT private.patient_access_basis(uid,
patient, hid)`; null → throw `NoAccess` → `fn(tx)` as owner (bypasses RLS; the check above is the gate) → audit row.

### A.2 Registries (config: mutable, audited, `updated_at` trigger)

```sql
CREATE TABLE public.clinical_concepts (
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
CREATE UNIQUE INDEX clinical_concepts_symptom_code_uidx ON public.clinical_concepts (symptom_code)
  WHERE symptom_code IS NOT NULL;                            -- one token, one identity

CREATE TABLE public.drug_class_tags (
  id text PRIMARY KEY, display text NOT NULL, atc jsonb NOT NULL DEFAULT '[]', lanes text[] NOT NULL DEFAULT '{}',
  sensitivity text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  note text, catalogue_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.capabilities (
  id text PRIMARY KEY, display text NOT NULL, catalogue_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.facility_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  capability_id text NOT NULL REFERENCES public.capabilities(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('available','intermittent','unavailable')),
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, capability_id));

CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('glucometer','ketone_meter','hba1c_analyser','bp_monitor')),
  model text NOT NULL, serial text,
  calibration text CHECK (calibration IS NULL OR calibration IN ('plasma_equivalent','whole_blood','unknown')),
  measuring_limits jsonb NOT NULL DEFAULT '{}',              -- manufacturer HI/LO per analyte: device data, not a threshold
  validated boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, calibrated_on date,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, kind, serial));

CREATE TABLE public.test_catalogue (
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
CREATE UNIQUE INDEX test_catalogue_code_uidx
  ON public.test_catalogue (coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

CREATE TABLE public.diagnosis_terms (
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
-- each registry: set_updated_at() BEFORE UPDATE (capabilities has no updated_at), audit_log_changes() AFTER.
```

### A.3 `encounters` (evolve; 0028:262, 0033:88, 0040:40-60)

```sql
ALTER TABLE public.encounters
  ADD COLUMN visit_id uuid REFERENCES public.patient_intakes(id) ON DELETE SET NULL,
  ADD COLUMN template_id text,
  ADD COLUMN last_activity_at timestamptz,
  ADD COLUMN completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- completed_at = existing ended_at
  ADD COLUMN disposition_detail jsonb,                       -- Zod: {admittedTo?, referredTo?, transferredTo?, diedAt?}
  ADD COLUMN follow_up jsonb,                                -- Zod: {kind: 'none'|'review_date'|'as_needed', date?}
  ADD COLUMN attendance_type text NOT NULL DEFAULT 'unknown',
  ADD COLUMN referral_in jsonb,                              -- Zod: {source: 'intake'|'appointment'|'letter', facility?, date?, reference?}
  ADD COLUMN closure_kind text,
  ADD COLUMN closure_reason text,
  ADD COLUMN closure_note_ciphertext text;

ALTER TABLE public.encounters ADD CONSTRAINT encounters_attendance_type_check
  CHECK (attendance_type IN ('new','re_attendance','unknown'));
ALTER TABLE public.encounters ADD CONSTRAINT encounters_closure_kind_check
  CHECK (closure_kind IS NULL OR closure_kind IN ('clinical','administrative'));
ALTER TABLE public.encounters ADD CONSTRAINT encounters_closure_reason_check
  CHECK (closure_reason IS NULL OR closure_reason IN
         ('left_before_seen','duplicate_encounter','documented_elsewhere','opened_in_error','other'));
ALTER TABLE public.encounters ADD CONSTRAINT encounters_closure_shape CHECK (
      (closure_kind IS DISTINCT FROM 'clinical'       OR disposition IS NOT NULL)
  AND (closure_kind IS DISTINCT FROM 'administrative' OR closure_reason IS NOT NULL)
  AND (state <> 'entered_in_error'                    OR closure_reason IS NOT NULL)
  AND (closure_reason IS DISTINCT FROM 'other'        OR closure_note_ciphertext IS NOT NULL));

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

CREATE INDEX encounters_visit_idx ON public.encounters (visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX encounters_open_activity_idx ON public.encounters (hospital_id, last_activity_at)
  WHERE state IN ('planned','in_progress');
CREATE TRIGGER audit_encounters AFTER INSERT OR UPDATE OR DELETE ON public.encounters
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();   -- none today; "one audit row per change" (§7.1)
```

Lifecycle (derived in `lib/emr/encounter.ts`): open = `planned|in_progress`; completed = `completed` +
`closure_kind='clinical'`; administratively closed = `completed` + `closure_kind='administrative'`; legacy completed =
`completed` + `closure_kind IS NULL` (flagged, never altered); `cancelled`; `entered_in_error`.

### A.4 Notes

```sql
CREATE TABLE public.clinical_notes (
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
CREATE UNIQUE INDEX clinical_notes_one_draft ON public.clinical_notes (encounter_id, author_user_id, note_type)
  WHERE state = 'draft' AND addendum_to IS NULL;             -- one per-author draft (§9 concurrency)
CREATE UNIQUE INDEX clinical_notes_client_key ON public.clinical_notes (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX clinical_notes_patient_time  ON public.clinical_notes (patient_user_id, effective_at DESC);
CREATE INDEX clinical_notes_encounter     ON public.clinical_notes (encounter_id, state);
CREATE INDEX clinical_notes_addendum      ON public.clinical_notes (addendum_to) WHERE addendum_to IS NOT NULL;
CREATE INDEX clinical_notes_hospital_time ON public.clinical_notes (hospital_id, recorded_at DESC);

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
CREATE TRIGGER clinical_notes_guard BEFORE UPDATE OR DELETE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION private.clinical_notes_guard();
CREATE TRIGGER clinical_notes_updated_at BEFORE UPDATE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_clinical_notes AFTER INSERT OR UPDATE OR DELETE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

CREATE TABLE public.clinical_note_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('cosign_requested','cosigned','addendum_added','entered_in_error')),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_cadre text NOT NULL,
  cosign_request_id uuid,                                    -- FK added in A.5 (table order)
  related_note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,   -- the addendum
  reason_code text, reason_ciphertext text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  client_key text,
  CONSTRAINT cne_eie_reason   CHECK (kind <> 'entered_in_error' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
  CONSTRAINT cne_addendum     CHECK (kind <> 'addendum_added' OR related_note_id IS NOT NULL),
  CONSTRAINT cne_cosign_link  CHECK (kind NOT IN ('cosign_requested','cosigned') OR cosign_request_id IS NOT NULL));
CREATE INDEX clinical_note_events_note ON public.clinical_note_events (note_id, recorded_at);
CREATE UNIQUE INDEX clinical_note_events_client_key ON public.clinical_note_events (client_key) WHERE client_key IS NOT NULL;
-- + no_mutation (block_modify_append_only) and audit triggers.
```

### A.5 `clinical_cosign_requests` (evolve; 0030:163, 0036:260)

```sql
ALTER TABLE public.clinical_cosign_requests
  ADD COLUMN note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT;
ALTER TABLE public.clinical_cosign_requests DROP CONSTRAINT IF EXISTS cosign_action_kind_check;
ALTER TABLE public.clinical_cosign_requests ADD CONSTRAINT cosign_action_kind_check CHECK (action_kind IN (
  'prescription_routine','prescription_controlled','order_high_cost_imaging','admit_patient','discharge_patient',
  'high_alert_med_administration','independent_complex_procedure','triage_patient','triage_downgrade',  -- 0036, kept
  'sign_note'));                                                                                         -- new
ALTER TABLE public.clinical_cosign_requests ADD CONSTRAINT cosign_note_link
  CHECK ((action_kind = 'sign_note') = (note_id IS NOT NULL));
CREATE INDEX cosign_note_idx ON public.clinical_cosign_requests (note_id) WHERE note_id IS NOT NULL;
ALTER TABLE public.clinical_note_events ADD CONSTRAINT cne_cosign_request_fk
  FOREIGN KEY (cosign_request_id) REFERENCES public.clinical_cosign_requests(id) ON DELETE RESTRICT;
```

`action_payload` for `sign_note` is PHI-free: `{noteId, noteType, encounterId}`. The requirement comes from
`clerkshipWriteAuthority().requiresCosign` (`lib/encounter/access.ts:42`; HARMONISATION calls it `mustCosign`), not
from `clinical_cosign_policies`, so the policies CHECK is unchanged. Drizzle drift fixed in
`db/schema/doctor-workspace.ts:88-89,134-135` (+ the 0036 four + `sign_note`).

### A.6 Orders, specimens, reports

```sql
-- encounter_orders (evolve; 0040:268). lifecycle tags every existing row 'legacy' (catalogue-only default).
ALTER TABLE public.encounter_orders
  ADD COLUMN lifecycle text NOT NULL DEFAULT 'legacy',
  ADD COLUMN hospital_id uuid REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  ADD COLUMN test_id uuid REFERENCES public.test_catalogue(id) ON DELETE RESTRICT,
  ADD COLUMN priority text,
  ADD COLUMN reason_condition_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN reason_text_ciphertext text,
  ADD COLUMN fasting_required boolean,
  ADD COLUMN requester_cadre text,                            -- requester = existing authored_by_user_id
  ADD COLUMN performer text,
  ADD COLUMN intent_source text,
  ADD COLUMN source_intent_id text,                           -- triage recommendation code or resus event id
  ADD COLUMN requisition_no text,
  ADD COLUMN sensitivity text NOT NULL DEFAULT 'standard',
  ADD COLUMN client_key text,
  ADD COLUMN effective_at timestamptz;
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
ALTER TABLE public.encounter_orders DROP CONSTRAINT IF EXISTS enc_order_kind_check;
ALTER TABLE public.encounter_orders ADD CONSTRAINT enc_order_kind_check CHECK (kind IN
  ('bloods','imaging','bedside','special','other',            -- 0040, kept
   'lab','ecg','procedure','referral'));                      -- new
CREATE UNIQUE INDEX enc_order_client_key ON public.encounter_orders (client_key) WHERE client_key IS NOT NULL;
CREATE INDEX enc_order_events_patient  ON public.encounter_orders (patient_user_id, created_at DESC) WHERE lifecycle = 'events';
CREATE INDEX enc_order_events_hospital ON public.encounter_orders (hospital_id, created_at DESC)     WHERE lifecycle = 'events';

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
CREATE TRIGGER encounter_orders_guard BEFORE UPDATE OR DELETE ON public.encounter_orders
  FOR EACH ROW EXECUTE FUNCTION private.encounter_orders_guard();
CREATE TRIGGER audit_encounter_orders AFTER INSERT OR UPDATE OR DELETE ON public.encounter_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
-- The legacy status column stays 'ordered' on events rows and is never read for them (status is derived).

CREATE TABLE public.encounter_order_events (
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
CREATE INDEX encounter_order_events_order ON public.encounter_order_events (order_id, recorded_at);

CREATE TABLE public.specimens (
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
CREATE INDEX specimens_order ON public.specimens (order_id);

CREATE TABLE public.specimen_events (
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
CREATE INDEX specimen_events_specimen ON public.specimen_events (specimen_id, recorded_at);
-- encounter_order_events, specimens, specimen_events: + client_key unique index, no_mutation and audit triggers.
```

**Fact envelope** — written out in full on each fact table (`diagnostic_reports`, `conditions`,
`medication_statements`, `pregnancy_episodes`, `procedures`, `allergies`):

```sql
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_id          uuid NOT NULL,                        -- = id of version 1 (the writer sets it)
  version             integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id       uuid REFERENCES public.<t>(id) ON DELETE RESTRICT,
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id        uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  effective_at        timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,   -- allergies: nullable, see A.9
  author_cadre        text,
  source              text NOT NULL CHECK (source IN ('lab','poc_staff','clinician','patient_reported','device_synced','imported')),
  trust               smallint NOT NULL CHECK (trust BETWEEN 1 AND 4),
  status              text NOT NULL DEFAULT 'final' CHECK (status IN
                        ('preliminary','final','amended','corrected','entered_in_error','cancelled')),
  sensitivity         text NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard','restricted')),
  reason_code         text,
  reason_ciphertext   text,
  client_key          text,
  CONSTRAINT <t>_version_chain CHECK ((version = 1) = (supersedes_id IS NULL)),
  CONSTRAINT <t>_eie_reason    CHECK (status <> 'entered_in_error' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
-- indexes: UNIQUE (logical_id, version); UNIQUE (client_key) WHERE NOT NULL; (supersedes_id) WHERE NOT NULL;
--          (patient_user_id, effective_at DESC); (hospital_id, recorded_at DESC)
-- triggers: <t>_no_mutation BEFORE UPDATE OR DELETE → block_modify_append_only(); audit_<t> → audit_log_changes()
```

```sql
CREATE TABLE public.diagnostic_reports (
  <fact envelope>,
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
  CONSTRAINT dr_order_or_transcribed CHECK (order_id IS NOT NULL OR entry_mode = 'transcribed'),
  CONSTRAINT dr_conclusion CHECK (kind = 'lab' OR status = 'preliminary' OR conclusion_code IS NOT NULL),
  CONSTRAINT dr_transcribed_trust CHECK (entry_mode <> 'transcribed' OR verified_by_user_id IS NOT NULL OR trust <= 3));
CREATE INDEX diagnostic_reports_order ON public.diagnostic_reports (order_id) WHERE order_id IS NOT NULL;
```

### A.7 `clinical_observations` (evolve; 0031:139, 0036:229, 0038:367) — E3 **[H]**

```sql
ALTER TABLE public.clinical_observations
  ADD COLUMN concept_id text REFERENCES public.clinical_concepts(id) ON DELETE RESTRICT,
  ADD COLUMN logical_id uuid,
  ADD COLUMN version integer,
  ADD COLUMN supersedes_id uuid REFERENCES public.clinical_observations(id) ON DELETE RESTRICT,
  ADD COLUMN category text,
  ADD COLUMN value_type text,
  ADD COLUMN value_num numeric,
  ADD COLUMN value_comparator text,
  ADD COLUMN value_unit text,                                 -- UCUM, as reported
  ADD COLUMN value_canonical numeric,
  ADD COLUMN value_code text,
  ADD COLUMN value_bool boolean,
  ADD COLUMN presence text,
  ADD COLUMN specimen text, ADD COLUMN calibration text, ADD COLUMN fasting_state text,
  ADD COLUMN challenge text, ADD COLUMN challenge_minutes integer, ADD COLUMN method text,
  ADD COLUMN certification text, ADD COLUMN point_of_care boolean,
  ADD COLUMN device_id uuid REFERENCES public.devices(id) ON DELETE RESTRICT,
  ADD COLUMN context jsonb NOT NULL DEFAULT '{}',             -- concept-specific context incl. elicitedBy, referenceRange, labInterpretation
  ADD COLUMN source text, ADD COLUMN trust smallint, ADD COLUMN status text, ADD COLUMN sensitivity text,
  ADD COLUMN effective_at timestamptz,                        -- knowledge time = created_at; legacy effective = recorded_at
  ADD COLUMN author_cadre text,
  ADD COLUMN note_ciphertext text,
  ADD COLUMN report_id uuid REFERENCES public.diagnostic_reports(id) ON DELETE RESTRICT,
  ADD COLUMN order_id uuid REFERENCES public.encounter_orders(id) ON DELETE RESTRICT,
  ADD COLUMN entry_mode text,
  ADD COLUMN client_key text;

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
CREATE INDEX obs_cfc_patient_concept_time ON public.clinical_observations (patient_user_id, concept_id, effective_at DESC)
  WHERE concept_id IS NOT NULL;
CREATE INDEX obs_cfc_supersedes ON public.clinical_observations (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX obs_cfc_sweep ON public.clinical_observations (concept_id, effective_at)
  INCLUDE (patient_user_id, value_canonical, fasting_state, specimen, trust)
  WHERE status IN ('final','amended','corrected');
CREATE INDEX obs_cfc_hospital_time ON public.clinical_observations (hospital_id, effective_at DESC) WHERE concept_id IS NOT NULL;
CREATE INDEX obs_cfc_report ON public.clinical_observations (report_id) WHERE report_id IS NOT NULL;
CREATE UNIQUE INDEX obs_cfc_logical_version ON public.clinical_observations (logical_id, version) WHERE logical_id IS NOT NULL;
CREATE UNIQUE INDEX obs_cfc_client_key ON public.clinical_observations (client_key) WHERE client_key IS NOT NULL;

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
CREATE TRIGGER clinical_observations_guard BEFORE UPDATE OR DELETE ON public.clinical_observations
  FOR EACH ROW EXECUTE FUNCTION private.clinical_observations_guard();
```

Drizzle drift fixed in `db/schema/nurse-workspace.ts:153` (+ `etco2`, `urine_output`, `fact`). Note: the guard makes
`ON DELETE SET NULL` from `encounters` and `ON DELETE CASCADE` from `auth.users`/`hospitals` fail while observations
exist. Nothing deletes those today; clinical retention wants exactly that.

### A.8 Conditions, medicines, pregnancy, procedures (new; fact envelope + columns below)

```sql
CREATE TABLE public.conditions (
  <fact envelope>,
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
  CONSTRAINT cond_term_or_text   CHECK (term_id IS NOT NULL OR text_ciphertext IS NOT NULL),
  CONSTRAINT cond_rank_dx_only   CHECK (rank IS NULL OR category = 'encounter_diagnosis'),
  CONSTRAINT cond_dx_encounter   CHECK (category <> 'encounter_diagnosis' OR encounter_id IS NOT NULL),
  CONSTRAINT cond_resolve_reason CHECK ((clinical_status <> 'resolved' AND verification <> 'refuted')
                                        OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL));
-- one primary per visit: enforced by recordEncounterDiagnosis in the tx + a PGlite test (versions share rank).

CREATE TABLE public.medication_statements (
  <fact envelope>,
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
  CONSTRAINT ms_drug CHECK (drug_code IS NOT NULL OR drug_text_ciphertext IS NOT NULL),
  CONSTRAINT ms_stop_reason CHECK (reconciliation IS DISTINCT FROM 'stopped' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL));

CREATE TABLE public.pregnancy_episodes (
  <fact envelope>,                                            -- logical_id = the episode
  pregnancy_state text NOT NULL CHECK (pregnancy_state IN ('pregnant','postpartum','not_pregnant','unknown')),
  lnmp date, lnmp_certainty text CHECK (lnmp_certainty IS NULL OR lnmp_certainty IN ('sure','unsure')),
  edd date, edd_basis text CHECK (edd_basis IS NULL OR edd_basis IN ('lmp','ultrasound','fundal_height','unknown')),
  test_observation_id uuid REFERENCES public.clinical_observations(id) ON DELETE RESTRICT,
  gravida smallint CHECK (gravida >= 0), parity smallint CHECK (parity >= 0),
  delivered_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('live_birth','stillbirth','miscarriage','termination','ectopic','unknown')),
  birth_weight_grams integer CHECK (birth_weight_grams > 0),
  hyperglycaemia boolean);                                    -- 2.4 / CFC 4.8; gestational age is derived, never stored
-- sensitivity: SR-PREG-MINOR at insert; outcome 'termination' → restricted (SRH class, D-CFC-09).

CREATE TABLE public.procedures (
  <fact envelope>,
  concept_id text REFERENCES public.clinical_concepts(id) ON DELETE RESTRICT,
  text_ciphertext text,
  outcome text NOT NULL CHECK (outcome IN ('completed','not_done','declined','unable')),
  laterality text CHECK (laterality IS NULL OR laterality IN ('left','right','bilateral')),
  note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,
  CONSTRAINT proc_concept_or_text CHECK (concept_id IS NOT NULL OR text_ciphertext IS NOT NULL));
```

### A.9 Allergies (new; PROMPT §7.5 harmonised)

```sql
CREATE TABLE public.allergies (
  <fact envelope, except recorded_by_user_id uuid NULL>,
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
  CONSTRAINT allergies_substance    CHECK (substance_code IS NOT NULL OR substance_text_ciphertext IS NOT NULL OR legacy_ref IS NOT NULL),
  CONSTRAINT allergies_kind_code    CHECK ((substance_code IS NULL) = (substance_kind IS NULL)),
  CONSTRAINT allergies_refute       CHECK (verification <> 'refuted' OR reason_code IS NOT NULL OR reason_ciphertext IS NOT NULL),
  CONSTRAINT allergies_author       CHECK (recorded_by_user_id IS NOT NULL OR legacy_ref IS NOT NULL));
CREATE UNIQUE INDEX allergies_legacy_ref_uidx ON public.allergies
  ((legacy_ref->>'table'), (legacy_ref->>'id'), (coalesce(legacy_ref->>'index', '')))
  WHERE legacy_ref IS NOT NULL AND version = 1;               -- copied once; the backfill is re-runnable

CREATE TABLE public.allergy_status_assertions (             -- insert-only; the newest non-voided row is current
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
CREATE UNIQUE INDEX asa_legacy_ref_uidx ON public.allergy_status_assertions ((legacy_ref->>'table'), (legacy_ref->>'id'))
  WHERE legacy_ref IS NOT NULL;
CREATE INDEX asa_patient_time ON public.allergy_status_assertions (patient_user_id, asserted_at DESC);
-- + client_key unique index, no_mutation and audit triggers on both tables.
```

Backfilled text **[D2]**: SQL cannot produce `lib/encryption.ts` ciphertext, so backfilled rows carry `legacy_ref` and
no ciphertext; the projection reads the display text from the untouched source (already plaintext there, never
copied). O-5 (extended) inserts version 2 of each with ciphertext, before O-4 retires any legacy table.

### A.10 Acknowledgement and critical communication (new, insert-only)

```sql
CREATE TABLE public.result_acknowledgements (
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
CREATE INDEX result_ack_report ON public.result_acknowledgements (report_id);
CREATE INDEX result_ack_user   ON public.result_acknowledgements (acknowledged_by_user_id, recorded_at DESC);

CREATE TABLE public.critical_result_communications (
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
CREATE INDEX crit_comm_report ON public.critical_result_communications (report_id);
-- both: + client_key unique index, no_mutation and audit triggers.
```

### A.11 `clinical_phi_access_log` basis (evolve; 0030:249)

```sql
ALTER TABLE public.clinical_phi_access_log DROP CONSTRAINT IF EXISTS phi_access_basis_check;
ALTER TABLE public.clinical_phi_access_log ADD CONSTRAINT phi_access_basis_check CHECK (access_basis IN
  ('care_team','active_encounter','department_recent','break_glass',     -- 0030, kept
   'assigned','open_intake'));                                           -- the two new SQL bases, logged truly
```

### A.12 Views (`security_invoker`, so RLS applies as the reader)

```sql
CREATE VIEW public.clinical_observations_current WITH (security_invoker = true) AS
  SELECT o.* FROM public.clinical_observations o
  WHERE o.concept_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.clinical_observations s WHERE s.supersedes_id = o.id);
-- Identical shape: conditions_current, medication_statements_current, allergies_current.
-- "Current" = the newest version of each logical item, any status; the chart shows entered-in-error struck
-- through, and the loader drops entered_in_error/cancelled (CFC §3.3). Legacy rows are loader projections.

CREATE VIEW public.clinical_notes_current WITH (security_invoker = true) AS
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
```

### A.13 The one access rule — `private` functions

```sql
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
```

Supporting index (new): `CREATE INDEX patient_intakes_patient_hospital_day ON public.patient_intakes (patient_user_id,
hospital_id, arrived_at DESC) WHERE status IN ('arrived','awaiting_triage','triaged');` The other probes are served by
`encounters_clinician_idx`, `nursing_assignments_*_active_idx`, `staff_affiliations_user_idx`.

### A.14 RLS and grants

```sql
-- (1) New clinical tables: one predicate (written out per table).
--     clinical_notes, clinical_note_events, conditions, medication_statements, pregnancy_episodes, procedures,
--     allergies, allergy_status_assertions, encounter_order_events, specimens, specimen_events, diagnostic_reports,
--     result_acknowledgements, critical_result_communications
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_select_clinical ON public.<t> FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.<t> FROM anon, authenticated;
GRANT SELECT ON public.<t> TO medsync_clinical_reader;

-- (2) Evolved / projected legacy tables: ADD a reader policy; their authenticated policies stay as they are.
--     Same predicate on encounters, clinical_observations, triage_records, clinical_cosign_requests, problem_list.
CREATE POLICY encounter_orders_select_clinical ON public.encounter_orders FOR SELECT TO medsync_clinical_reader
  USING (patient_user_id IN (SELECT private.accessible_patient_ids())
         AND EXISTS (SELECT 1 FROM public.encounters e WHERE e.id = encounter_orders.encounter_id
                     AND e.hospital_id = (SELECT private.current_hospital_id())));
--     encounter_diagnoses: same EXISTS on encounter_id. encounter_results: EXISTS via encounter_orders → encounters.
GRANT SELECT ON public.encounters, public.clinical_observations, public.triage_records, public.clinical_cosign_requests,
  public.problem_list, public.encounter_orders, public.encounter_diagnoses, public.encounter_results
  TO medsync_clinical_reader;

-- (3) Views
GRANT SELECT ON public.clinical_observations_current, public.conditions_current, public.medication_statements_current,
  public.allergies_current, public.clinical_notes_current TO medsync_clinical_reader;

-- (4) Registries (non-PHI config): readable by staff clients and the reader; no client writes.
--     clinical_concepts, drug_class_tags, capabilities, facility_capabilities, devices, test_catalogue, diagnosis_terms
CREATE POLICY <r>_select ON public.<r> FOR SELECT TO authenticated, medsync_clinical_reader USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.<r> FROM anon, authenticated;
GRANT SELECT ON public.<r> TO medsync_clinical_reader;
```

Demographics for the safety bar come through the existing audited `fetchPatientSummaryAudited` after the same
`patient_access_basis` check; the reader gets no grant on profile tables. Patient-facing and export views are not
built: patient access waits for Gate CG and FHIR is test-only (the projection filters restricted facts; property-tested).

### A.15 Backfill (insert-only copies; sources never altered; re-runnable)

```sql
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
```

| Backfill consequence                                             | Handling                                                                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Episode 1 lists penicillin, a later episode records NKDA         | Both copied; the resolver shows penicillin (an active allergy outranks an assertion). Safe direction; CSO reviews migrated items (`verification='unconfirmed'`) |
| Earlier captures within one episode                              | Not copied (they were superseded at the bedside, exactly as prescribing read them). Count reported at STOP 2                                                    |
| Unknown-patient episodes; NKDA with no recorder                  | Skipped; counted at STOP 2                                                                                                                                      |
| Duplicate rows (re-clerked `patient_allergies`, repeat episodes) | Kept with provenance; the resolver groups by coded substance, else normalised text                                                                              |
| Captures written after 0071 while `EMR_V1` is off                | `scripts/emr/backfill-allergies.ts` re-runs these statements (idempotent on `legacy_ref`) when the flag goes on (O-7)                                           |

---

## B. Evolve versus new, and the legacy-data plan

**Rule: flag, never alter.** 0071 issues no UPDATE or DELETE against an existing row. Legacy rows are tagged by a
catalogue-only default or recognised by a null column, and are _projected_ read-only by the loader, so the chart shows
one list per fact kind while the old rows stay byte-identical.

| Object                                                                   | Decision                                   | Legacy rows                                                                                                                                                                              | Existing readers and writers                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `encounters`                                                             | **Evolve** (§A.3)                          | New columns null; `attendance_type='unknown'`; completed rows keep `closure_kind` null ("legacy completed"). Open encounters stay open and surface in Needs closing; nothing auto-closes | Unchanged; `ha-start-encounter` gains the open-encounter reuse, `ha-complete-encounter` gains disposition + follow-up (P4) |
| `clinical_observations`                                                  | **Evolve** (E3 **[H]**)                    | Untouched; guard allows only `active→corrected`; projected by `lib/facts/project/legacy-observation.ts`                                                                                  | NCD prefill, triage worklist, nurse page, resus mirror unchanged                                                           |
| `triage_records.vitals_snapshot`                                         | **Project**, never copy                    | Untouched                                                                                                                                                                                | `lib/facts/project/triage-vitals.ts`                                                                                       |
| `encounter_orders`                                                       | **Evolve** (`lifecycle`)                   | Tagged `legacy`; mutable status kept for `/lab` with `EMR_V1` off                                                                                                                        | `/lab` re-pointed to reports under `EMR_V1` (P4)                                                                           |
| `encounter_results`                                                      | **Legacy, projected**                      | Untouched                                                                                                                                                                                | Read-only projection into observation facts                                                                                |
| `clinical_cosign_requests`                                               | **Evolve** (`sign_note`)                   | Untouched                                                                                                                                                                                | `/doctor/cosign-queue` gains note rows                                                                                     |
| `clinical_phi_access_log`                                                | **Evolve** (basis CHECK)                   | Untouched                                                                                                                                                                                | The nurse resolver's `#basis` workaround can log the true basis                                                            |
| `patient_allergies`                                                      | **Copy once**, then frozen                 | Untouched; copied with `legacy_ref`                                                                                                                                                      | `loadPersistentAllergiesForEpisode` re-pointed to `lib/emr/allergy.ts` in P4                                               |
| Resus timeline captures                                                  | **Copy once** (latest per episode)         | Untouched (append-only)                                                                                                                                                                  | Resus UI unchanged; AMPLE writes through `recordAllergy` from P4                                                           |
| `problem_list`, `encounter_diagnoses`                                    | **Legacy, projected** into condition facts | Untouched; they have no live writer                                                                                                                                                      | New writes go to `conditions` only                                                                                         |
| `encounter_medications`                                                  | **Legacy, projected** (`patient_reported`) | Untouched                                                                                                                                                                                | New writes go to `medication_statements`                                                                                   |
| `clinical_documentation`                                                 | **Legacy**, append-only already            | Plaintext `section_data` recorded as a known gap (R8)                                                                                                                                    | Shown read-only under Notes as "Earlier clerking (legacy)"                                                                 |
| `clerkship_drafts`                                                       | **Legacy**                                 | Old plaintext drafts stay until O-5                                                                                                                                                      | New drafts written `{ "enc": … }` and read both shapes (E4)                                                                |
| `encounter_events`                                                       | **Reused** as-is                           | —                                                                                                                                                                                        | Records suggestion dismissals (kind `order`) and state events                                                              |
| `care_plan`                                                              | Untouched, unused                          | —                                                                                                                                                                                        | —                                                                                                                          |
| 14 clinical tables, 7 registries, 5 views, `private` schema, reader role | **New**                                    | —                                                                                                                                                                                        | —                                                                                                                          |

Retirement of legacy tables waits for O-4 (row counts) and O-5 (re-materialised allergy text); until then their
projections keep old data readable (§7 convergence).

---

## C. ADR drafts (0130–0139)

ADRs are immutable once merged; these are drafts for P8. Each mirrors into `CHANGELOG.md`.

### 0130 — Clinical fact store: CFC adoption and harmonisation

- **Context.** Four engines needed one truth; the repo already had half an EMR (0040, 0050/51) with no writers, a mutable
  observation table and no results model. Five specs assumed a different stack.
- **Decision.** Adopt MS-DATA-CFC-001 with the v1.1 addendum. Evolve `encounters`, `clinical_observations`,
  `encounter_orders` and `clinical_cosign_requests`; add 14 insert-only clinical tables and 7 registries (0071), seeds
  (0072), broadcasts (0073). Record every harmonisation (**[H]**) and the deviations D1–D3 here.
- **Consequences.** One vital-sign series, one allergy record, one problem list. Legacy rows are projected, never
  mutated; retirement is a later owner decision. Engines read `loadFactSnapshot` only.

### 0131 — RLS identity propagation (E2)

- **Context.** Clinical reads ran as the Drizzle owner and bypassed RLS; four TS resolvers disagreed and none checked the
  hospital.
- **Decision.** `private.current_user_id()`/`current_hospital_id()` read transaction-local GUCs (never honoured for
  PostgREST sessions). One SQL rule, `private.patient_access_basis()`, and its set form `accessible_patient_ids()`.
  Reads: `asClinicalReader` sets the GUCs and `SET LOCAL ROLE medsync_clinical_reader` (no BYPASSRLS). Writes:
  `asClinicalWriter` runs the same rule, then writes as owner. New tables deny `anon`/`authenticated` entirely.
- **Consequences.** Patient, reception, other-hospital and anonymous reads are denied in the database. Legacy surfaces
  keep their resolvers until convergence. Two SQL bodies of one rule are held equal by a probe (F.3). 0040 still lets a
  patient read their own legacy rows; recorded as a known gap.

### 0132 — Encryption boundary and the note HMAC key (E4, E10)

- **Context.** Encrypting every column blocks sweeps and trends; `section_data` and NCD drafts are plaintext today; the
  only HMAC is derived from the PHI key.
- **Decision.** Structured coded values are plaintext under RLS and at-rest encryption; identifiers, narrative, free
  text and uncoded allergen text use `lib/encryption.ts`. Signed notes carry HMAC-SHA-256 over the canonical composition
  with `MEDSYNC_NOTE_HMAC_KEY` (32 bytes, base64; O-2) and `hmac_key_id='v1'`. Signing refuses with a clear message
  when the key is missing. Rotation: add `v2`, sign new notes with it, verify old ones with the id they carry; never
  re-sign.
- **Consequences.** Sweep indexes work. Two keys in Vercel. Old plaintext stays until O-5; `clinical_documentation`
  stays plaintext (append-only; recorded).

### 0133 — Database runtime and the PGlite lane (E1)

- **Context.** Only a hosted, production-like database exists; RLS suites skip without env; the machine has 8 GB.
- **Decision.** E1 stands (a hosted Supabase dev project, O-1). Until it exists, `tests/emr-db/**` runs on PGlite
  when `EMR_PGLITE_MODULES` points at the harness `node_modules`, booting the harness Supabase bootstrap and replaying
  0000–0073. PGlite is never added to `package.json`.
- **Consequences.** Migrations, RLS probes, write paths and A1–A9 are testable today. Realtime delivery and the pooler
  are proven only on the dev project (O-1).

### 0134 — The note model

- **Context.** No note store; the NCD clerking writes drafts only; `recordClerkshipVersion` is not transactional.
- **Decision.** `clinical_notes`: per-author drafts (updatable, encrypted, revision-checked autosave); signing
  validates the template minimum, composes canonically, HMACs, and writes the note plus note-born facts in one
  transaction (D-EMR-01). Afterwards the row is immutable (trigger). Co-sign, addenda and entered-in-error are
  `clinical_note_events`; note co-sign reuses `clinical_cosign_requests` (`sign_note`). Templates are data
  (`note-templates.v1.json`).
- **Consequences.** Care is never blocked by signing. Late entries are labelled from a hospital setting. The NCD capture
  becomes a note section whose values commit as facts through `lib/ncd/cfc-map.ts`.

### 0135 — The allergy record as the single source

- **Context.** R1, worse than stated: resus allergies were invisible even to the next episode; `patient_allergies` had
  no live writer; the resus emergency administration checked only on the client.
- **Decision.** `allergies` + `allergy_status_assertions`, four statuses, an active allergy always outranks an
  assertion. 0071 copies both old stores with provenance. Every prescribe path reads `lib/emr/allergy.ts`, whose input
  is the record plus, until the timeline writer retires, the current episode's captures (no gap). Uncoded text is
  still name-matched **[H]**. The server re-runs the check on emergency administration.
- **Consequences.** R1 test turns green in P4. Migrated items arrive `unconfirmed`. Allergies are hospital-scoped like
  every row; cross-facility sharing is an open owner decision (H.4).

### 0136 — Results acknowledgement and critical results

- **Context.** Results had entry and release but no acknowledgement, no transaction and abnormal ≡ critical.
- **Decision.** Versioned `diagnostic_reports`; values are observation rows; release is a new final version in one
  transaction. `result_acknowledgements` per version (an amendment needs re-acknowledgement).
  `critical_result_communications` records who told whom, how, when, read-back. MedSync flags critical only from a
  signed REF-CRIT entry (none yet); the laboratory's own flag shows as text. Lanes: Critical results, Results to review.
- **Consequences.** Red appears on a result value only when a signed entry says so; everything awaiting is amber. The
  escalation timer shows no number until REF-CRIT-TIMEFRAME is signed.

### 0137 — Coding and terminology licensing (E6)

- **Context.** 0041 and `reference-codes.ts` already commit WHO ICD-10 content without a licence; no notices file.
- **Decision.** ICD-11 first (CC BY-ND 3.0 IGO: unmodified, attributed). `icd10_who_code` is CHECK-constrained to null
  on terms and conditions until O-3 records the WHO licence. `THIRD-PARTY-NOTICES.md` records ICD-11 attribution, the
  LOINC notice and ICD-10 as "licence pending: present, unused by every surface, never exported". LOINC codes are
  candidates until verified; a CI check blocks exporting any candidate.
- **Consequences.** Dropping the ICD-10 CHECK is a deliberate future migration after O-3.

### 0138 — FHIR R4 projection (E7)

- **Context.** Uganda uses FHIR R4; no DPA/MoU exists for sharing.
- **Decision.** `lib/emr/fhir.ts` projects 12 resources for export tests only; no endpoint. Restricted facts and
  candidate codes never appear in output (property-tested).
- **Consequences.** An endpoint is a later decision behind the DPA/MoU.

### 0139 — Encounter completion and administrative closure

- **Context.** End visit wrote no disposition; emergency encounters stayed open; a second encounter could open for one
  visit.
- **Decision.** One completion path, `ha-complete-encounter`, now takes disposition and follow-up; warnings (unsigned
  notes, no diagnosis, uncollected orders) are returned, not thrown. Administrative closure needs a reason code and is
  audited; nothing auto-closes. Died is stored as `deceased` (ADR 0115 reads it) **[H]**. `ha-start-encounter` reuses an
  open encounter for the visit.
- **Consequences.** Two Edge Functions change (O-7 deploys them). Legacy completed encounters stay "legacy completed".

---

## D. Permission matrix (D-EMR-16)

Derived from `clerkshipWriteAuthority` (`lib/encounter/access.ts:42`: clerkers = 5 medical + CLINICAL_OFFICER; co-sign =
INTERN_DOCTOR; `canWriteFinalDiagnosis` = clerker and not intern; `canRecordAllergies` = any clinical), the doctor
scope (`lib/doctor/scope.ts:33,36`: senior = MO, MO_SG, CONSULTANT, SENIOR_CONSULTANT, who review co-signs), the
co-sign policy seeds (0030:313, 0031:362, 0036:272) and the lab scope (`lib/lab-tech/scope.ts:27`). Every action also
needs AAL2, an active clinical affiliation at the hospital and a non-null `patient_access_basis`.

Legend: ✓ allowed · ✓c allowed, co-sign surfaced (never blocks) · P per `clinical_cosign_policies` · ✗ denied.

| Actor (cadre)                                                                      | Start                                                               | Document / sign        | Co-sign | Complete                                      | Order                            | Collect specimen | Enter results        | Release | Acknowledge     | Resolve problem / final dx | Entered in error            | Prescribe (P7)                         | Allergy / NKDA         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------- | ------- | --------------------------------------------- | -------------------------------- | ---------------- | -------------------- | ------- | --------------- | -------------------------- | --------------------------- | -------------------------------------- | ---------------------- |
| INTERN_DOCTOR                                                                      | ✓                                                                   | ✓c (all doctor notes)  | ✗       | ✓                                             | ✓ (high-cost imaging P: co-sign) | ✓                | ✓ transcribed        | ✗       | ✓ own / covered | ✗ (working only)           | ✓ own items                 | P: routine co-sign, controlled blocked | ✓                      |
| CLINICAL_OFFICER                                                                   | ✓                                                                   | ✓                      | ✗       | ✓                                             | ✓ (imaging P: co-sign)           | ✓                | ✓ transcribed        | ✗       | ✓ own / covered | ✓                          | ✓ own items                 | P: routine co-sign, controlled blocked | ✓                      |
| MEDICAL_OFFICER                                                                    | ✓                                                                   | ✓                      | ✓       | ✓                                             | ✓                                | ✓                | ✓ transcribed        | ✗       | ✓ own / covered | ✓                          | ✓ own; supervisor of others | P: routine ✓, controlled co-sign       | ✓                      |
| MO_SG, CONSULTANT, SENIOR_CONSULTANT                                               | ✓                                                                   | ✓                      | ✓       | ✓                                             | ✓                                | ✓                | ✓ transcribed        | ✗       | ✓ own / covered | ✓                          | ✓ own; supervisor of others | P: ✓                                   | ✓                      |
| NURSE, MIDWIFE                                                                     | ✓ on behalf of the booked clinician (as `ha-start-encounter` today) | ✓ nursing, handover    | ✗       | ✗                                             | ✗                                | ✓                | ✓ point-of-care only | ✗       | ✗               | ✗                          | ✓ own items                 | ✗                                      | ✓                      |
| SPECIALIST_NURSE                                                                   | as NURSE                                                            | as NURSE               | ✗       | ✗                                             | ✗                                | ✓                | ✓ point-of-care only | ✗       | ✗               | ✗                          | ✓ own items                 | ✗                                      | ✓                      |
| LAB_TECH, LAB_TECHNOLOGIST                                                         | ✗                                                                   | ✗ (reports, not notes) | ✗       | ✗                                             | ✗                                | ✓                | ✓ direct             | ✓       | ✗               | ✗                          | ✓ own reports (new version) | ✗                                      | ✗                      |
| Dental, allied (RADIOGRAPHER, PHYSIO, OT, NUTRITIONIST), PHARMACIST, PHARMACY_TECH | walk-in queue only (as today)                                       | ✗ in v1 (seam)         | ✗       | ✗                                             | ✗                                | ✗                | ✗                    | ✗       | ✗               | ✗                          | ✗                           | ✗                                      | ✓ (any clinical cadre) |
| RECEPTION (`is_clinical=false`)                                                    | ✗                                                                   | ✗                      | ✗       | ✗                                             | ✗                                | ✗                | ✗                    | ✗       | ✗               | ✗                          | ✗                           | ✗                                      | ✗                      |
| hospital_admin (role, non-clinical)                                                | ✗                                                                   | ✗                      | ✗       | administrative closure only (reason required) | ✗                                | ✗                | ✗                    | ✗       | ✗               | ✗                          | ✗                           | ✗                                      | ✗                      |
| superadmin                                                                         | break-glass read only (logged); no writes                           |                        |         |                                               |                                  |                  |                      |         |                 |                            |                             |                                        |                        |

Notes. "Supervisor" = a senior (MO and above) at the same hospital with access. "Covered" = the orderer's cover
(forwarded to, or the in-charge after escalation). Nurses may view results but do not acknowledge them (D-EMR-07 puts
responsibility with the orderer). The cause-of-death record needs a clerker; an intern's is surfaced for co-sign. The
junior definition differs between `lib/doctor/scope.ts` (INTERN + CO) and `access.ts` (INTERN): note co-sign follows
`access.ts` (one function, D-EMR-03); CO co-sign stays policy-driven for prescriptions and imaging.

---

## E. Annotated wireframes (improving PROMPT §5)

Illustrative patients and values. `‹…›` = a value that comes from a signed reference or the laboratory and is shown
only when it exists. **Colour marks** (every colour ships with a word or an icon plus a word; DESIGN-medsync.md wins):

| Mark  | Token                                         | Meaning — and the only places it appears                                                                       |
| ----- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `[T]` | `bg-primary` / teal-600, `shadow-focus`       | an action: buttons, links, the focus ring, checked controls                                                    |
| `[P]` | `bg-plum-50 text-plum-800` + plum-500 dot     | place: the current chart section, the current note section, active nav. A fill and a dot, **never a left bar** |
| `[A]` | `bg-status-caution-bg text-status-caution-fg` | awaiting, overdue, unsigned, offline, not recorded, unable to assess                                           |
| `[R]` | `text-status-critical-fg font-bold font-mono` | **only** a critical result value (signed REF-CRIT entry) and the Emergency affordance                          |
| `[N]` | `<Pill>` default gray-100/700                 | record states: draft, signed, completed, entered in error, late entry                                          |

Headings are weight 500 (`font-medium`), the patient name is Fraunces, everything else Geist, numbers and MRN
Geist Mono with tabular numerals. No motion on the clerking desk (seen 100+ times a day); sheets and dialogs use
250 ms `ease-expo-out`; reduced motion drops movement.

### E.1 Safety bar (every clinical page about a patient; sticky)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ / doctor → patients → chart                                            [R] ⚠ Emergency       │ ①
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Amina Nakato      52 y · Female · MRN-2024-04812                           🔒 Restricted      │ ② ③
│ Allergies   [Penicillin — anaphylaxis, high, confirmed]  [Sulfa drugs — rash · by name only]  │ ④
│ Pregnancy   Not pregnant — test 12 Mar 2026                                                   │ ⑤
│ Active      [Hypertension]  [Type 2 diabetes]  [Chronic kidney disease]   +2 more [T]         │ ⑥
│ [A] ▲ 1 critical result awaiting acknowledgement — Potassium, released 10:31   Review [T]    │ ⑦
└──────────────────────────────────────────────────────────────────────────────────────────────┘
Allergy-line variants:
│ Allergies   No known drug allergies — confirmed by Dr S. Okello, 12 Mar 2026    Re-confirm [T] │
│ Allergies   [A] Allergy status not recorded                                     Record [T]     │
│ Allergies   [A] Unable to assess — recorded 09:12                               Update [T]     │
Deceased:  │ Amina Nakato  52 y · Female · MRN-2024-04812   [N] Died 11:06, 12 Mar 2026 │  (Review/Record removed)

Phone (390 px)
┌────────────────────────────────────┐
│ Amina Nakato          [R] Emergency│
│ 52 y · F · MRN-2024-04812      🔒  │
│ Allergy  Penicillin — anaphylaxis  │ ④ wraps, never truncated
│ [A] ▲ 1 critical result   Review[T]│
│ Details ▾ [T]                      │ ⑧
└────────────────────────────────────┘
```

① The Emergency affordance stays in the page header, far right, as on every doctor page. ② Two identifiers, age and
sex in words; accessible summary read first ("Amina Nakato, 52, female, MRN 2024-04812. Allergy: penicillin,
anaphylaxis. One critical result awaiting acknowledgement."). ③ The lock plus the word; it reveals nothing. ④ Worst
criticality first; an uncoded item carries "by name only" (full text in the editor: "Matched by name only — code it
for class checks") **[H]**. ⑤ Only when sex at birth is female and age is within REF-PREG-AGE; while that reference is
pending the line is absent (§H.4). ⑥ Top three active problems as chips. ⑦ Amber and words; the red is on the value
in Results only. ⑧ **Improvement:** on phones, pregnancy and problems fold into Details; allergies and the critical line
never fold.

### E.2 The chart (patient level) — left section index

```
┌ Safety bar (sticky) ─────────────────────────────────────────────────────────────────────────┐
├ Chart ────────────────┬ Summary ──────────────────────────────────────────────────────────────┤
│ [P] ● Summary         │ Active problems            Allergies                Current medicines │
│      Timeline         │ Hypertension     2019      Penicillin — anaphyl.    Metformin         │
│      Results      1▲  │ Type 2 diabetes  2021      Sulfa drugs — rash       Amlodipine        │
│      Notes            │                                                                        │
│      Orders       2   │ Last three encounters                Recent results (abnormal first)   │
│      Medicines        │ 12 Mar  OPD  Malaria, uncomplicated  Potassium   [R] 6.9 mmol/L Critical│
│      Problems and     │ 02 Feb  OPD  Hypertension review     Creatinine  148 umol/L  H (lab)   │
│      allergies        │ 10 Jan  ED   Fever                   mRDT        Positive  A (lab)     │
│                       │                                                                        │
│                       │ Pending orders                                                         │
│                       │ Full blood count   Urgent   [A] Awaiting collection — ordered 10:40    │
└───────────────────────┴────────────────────────────────────────────────────────────────────────┘

Results (flowsheet: concepts down, dates across)
│ Analyte        Unit     10 Mar    11 Mar       12 Mar                   Trend   │
│ Haemoglobin    g/dL     11.2      —            10.8                     ╲_      │
│ Potassium      mmol/L   4.1       5.2 H (lab)  [R] 6.9 Critical          _╱     │
│ Creatinine     umol/L   132       148 H (lab)  —                         ‾      │
│ mRDT           —        —         —            Positive                         │
tap a value → provenance sheet
┌ Potassium 6.9 mmol/L ───────────────────────────────────────────────┐
│ Status        Final, version 2 (amended 10:52)                      │
│ Laboratory    In-house · range ‹as reported by the laboratory›      │
│ Specimen      Venous serum · collected 09:40 by Sr. J. Auma         │
│ Entry         Direct, laboratory staff · trust T4                    │
│ Effective     09:40 · recorded 10:31                                 │
│ Communicated  to Dr S. Okello (orderer), phone, 10:34, read back ✓   │
└─────────────────────────────────────────────────────────────────────┘

Notes
│ 12 Mar 10:52  Adult outpatient clerking   Dr S. Okello (MO)       [N] Signed               │
│   └ 12 Mar 14:05  Addendum — "Result reviewed; plan unchanged"   Dr S. Okello               │
│ 11 Mar 09:10  N̶u̶r̶s̶i̶n̶g̶ ̶n̶o̶t̶e̶   Sr. J. Auma    [N] Entered in error — wrong patient          │
│ 10 Mar 16:40  Adult outpatient clerking   Dr P. Mugisha (Intern)  [A] Awaiting co-signature │
│ 02 Feb        Earlier clerking (legacy, read-only)                                          │
```

The index is `<nav>` with `aria-current="page"`; the current item is plum fill + dot (DESIGN §Plum: active nav).
**Improvements:** a count badge (neutral) on Orders and a `▲` with the word in its tooltip on Results; the lab's own
flag is always text ("H (lab)"); legacy clerkings are shown, labelled, never merged. Timeline: reverse order, kind
filter chips (Encounters, Notes, Results, Orders, Procedures, State), paged by 50.

### E.3 The clerking desk (encounter level)

Desktop ≥ 1280 px

```
┌ Safety bar (sticky) ──────────────────────────────────────────────────────────────────────────────────────┐
├ Workspace ────────┬ Adult outpatient clerking ─────────────── [N] Draft · Saved 10:42 ┬ Context ──────────────┤
│ Waiting       3   │ Historian Patient · Language Luganda · Interpreter — (none)       │ Triage          10:31 │
│ In progress   2   │                                                                    │ L3 ‹level word›       │
│ To co-sign    1   │ [01] Presenting complaint                                          │ Fever, 3 days         │
│ ───────────────── │      [Fever — 3 days ᵀ]  [Headache — 2 days]      + Add  (or /)    │ Vital signs     10:31 │
│ [P] ● 01 Complaint│ [02] History of presenting complaint                               │ T 38.9  HR 104   ᵀ    │
│   02 History      │      Three days of fever with chills, worse at night…              │ BP 128/82  RR 20      │
│   03 Systems      │      Chills           (●Present) ( Absent ) ( Not asked )          │ Results               │
│   04 Past history │      Neck stiffness   ( Present ) (●Absent ) ( Not asked )         │ mRDT [A] Awaiting     │
│   06 Medicines ✓  │      Rash             ( Present ) (●Absent ) ( Not asked )         │      collection       │
│   07 Allergies [A]│ [05] Past surgical history and transfusions   Not asked   Add [T]  │ Medicines             │
│   11 Examination  │ …                                                                  │ Metformin — continue? │
│   13 Impression * │ [13] Impression                                                    │ Problems              │
│   14 Plan *       │      [Malaria, uncomplicated — Working · Primary]                  │ Type 2 diabetes       │
│                   │ [14] Plan                                                          │ Suggested by triage   │
│                   │      [mRDT — Ordered 10:40]  [Plan: review with result]            │ [Blood glucose] Accept│
│                   ├────────────────────────────────────────────────────────────────────┤                       │
│                   │ [ Sign note  ⌘↵ ] [T]   Required 3/3 ✓           Complete visit [T]│                       │
└───────────────────┴────────────────────────────────────────────────────────────────────┴───────────────────────┘
```

Rail: the Workspace rail sits above the section index; the current section is plum; `*` marks required-to-sign; the
allergy section shows `[A]` with "Not recorded" in its accessible name. `ᵀ` is the source mark (from triage; projected,
never copied; 0 taps). Narrative column ~68 ch, line height 1.6, bracket numbers per DESIGN §Section numbering. Keys
(off inside text fields): `/` insert menu at an empty line start, `j`/`k` sections, `⌘/Ctrl+Enter` sign, `?` help.

Tablet portrait 834 px

```
┌ Safety bar ────────────────────────────────────────────┐
├ 01 02 03 … 14 ▸ (index strip; [P] on current) ─────────┤
│ [02] History of presenting complaint                    │
│      …narrative…                                        │
│      Chills   (●Present) ( Absent ) ( Not asked )  44px │
├─────────────────────────────────────────────────────────┤
│ ▴ Context — Triage L3 · T 38.9 · mRDT awaiting          │ ← bottom sheet, labelled "Context"
└─────────────────────────────────────────────────────────┘
```

Phone 390 px

```
┌ Safety bar (compact) ──────────────┐
│ 02 of 14 · History ▾ [T]           │ ← opens the section index as a sheet
│ …one section at a time…            │
│ [A] Offline — changes kept on this │ ← only when offline
│     page (3 entries waiting)        │
├────────────────────────────────────┤
│ [‹ Prev]   [ Sign ] [T]   [Next ›] │ ← fixed action bar
└────────────────────────────────────┘
```

**Improvements:** the required-to-sign count lives beside Sign, so the doctor sees what is missing before pressing;
suggestions from triage sit in Context, labelled, never inserted; the offline banner names the count.

### E.4 Findings: tri-state chips and review of systems

```
Chills            (●Present)  ( Absent )  ( Not asked )     Onset ▾  Duration ▾  More ▾
Neck stiffness    ( Present )  (●Absent )  ( Not asked )
Review of systems — Respiratory                                  Mark all as absent [T]
  Cough            ( Present ) ( Absent ) (●Not asked )
  Haemoptysis      ( Present ) ( Absent ) (●Not asked )
```

A `role="radiogroup"` per finding; accessible name "Chills, present". Selected = teal fill with a check and the word
(DESIGN: checked controls are teal, never plum). Not asked is the default and leaves no fact (C3). Search uses the
token catalogue `symptom_catalog ∪ clinical_concepts(finding)` **[H]**. "Mark all as absent" is an explicit act, one
tap per system. Differential suggestions, when present, render in Context as "Suggestions" and are never inserted.

### E.5 Diagnosis picker and notifiable confirm

```
┌ Add diagnosis ───────────────────────────────────────────────────────────────┐
│ malar▌                                                                         │
│ ▸ Malaria, uncomplicated           ICD-11 ‹code›     Notifiable               │
│   Malaria, severe                  ICD-11 ‹code›     Notifiable               │
│   Fever, cause not yet known       ICD-11 ‹code›     Symptom                  │
│ ↑↓ then Enter · not in the list? Record as typed [T] (not HMIS-counted)       │
├────────────────────────────────────────────────────────────────────────────────┤
│ Status     (●Working)  ( Final )  ( Differential )                            │
│ [✓] Primary diagnosis for this visit                                          │
│ [✓] Add to problem list   (on by default for chronic terms)                   │
└────────────────────────────────────────────────────────────────────────────────┘
┌ Notifiable disease ──────────────────────────────┐
│ ‹term› is on the IDSR list (‹class›).            │
│ Action: ‹signed IDSR action text›                │
│ This creates a notification task and an IPC      │
│ prompt. It does not block care.                  │
│ [ Confirm and continue ] [T]      Cancel         │
└──────────────────────────────────────────────────┘
```

Term, then code, then flags as words. Four keystrokes + Enter for a top-50 term (client term index, no dependency).
Final is disabled for an intern with the words "Final needs a senior — it will be surfaced for co-sign". Resolving or
refuting a problem opens reason chips. Until REF-IDSR-CLASSES is signed no term carries a class, so the sheet never
opens; until REF-DX-TESTFIRST is signed there is no "test expected" prompt.

### E.6 Allergy editor

```
┌ Allergies — Amina Nakato · MRN-2024-04812 ─────────────────────────────────────────┐
│ Status  [A] Allergy status not recorded                                             │
│ ( No known drug allergies ) [T]   ( Unable to assess ) [T]    or add an allergy ↓   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Substance     penic▌  → Penicillins (class) · Amoxicillin · Benzylpenicillin          │
│               Not listed? Record as typed → "Matched by name only — code it for class │
│               checks"                                                                 │
│ Category      (●Medication) ( Food ) ( Environment ) ( Biologic )                     │
│ Type          (●Allergy) ( Intolerance )                                              │
│ Reaction      [Rash] [Urticaria] [Angioedema] [●Anaphylaxis] [Bronchospasm] [SJS/TEN] │
│ Severity      ( Mild ) ( Moderate ) (●Severe )                                        │
│ Criticality   (●High ) ( Low ) ( Unable to assess )                                   │
│ Verification  (●Confirmed ) ( Unconfirmed )                                           │
│ Onset ‹date or age›      Informant ( Patient ) ( Relative ) ( Record ) ( Observed )   │
│ [ Save allergy ] [T]                                                                  │
├ History ─────────────────────────────────────────────────────────────────────────────┤
│ Penicillin — from resus E step, 02 Feb 2026   [N] Unconfirmed        Confirm [T]      │
│ C̶o̶-̶t̶r̶i̶m̶o̶x̶a̶z̶o̶l̶e̶ ̶—̶ ̶r̶a̶s̶h̶   Refuted 03 Jan 2026 — "tolerated a full course since"          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Saving an active allergy supersedes NKDA automatically (resolver, not an update). Refuting needs a reason. The resus
AMPLE editor keeps its look and writes through the same `recordAllergy` action (P4). **Improvement:** migrated items
are listed with their provenance and a one-tap Confirm, so the CSO's review of the backfill happens in the flow.

### E.7 Order entry

```
┌ Order — Amina Nakato · MRN-2024-04812 ────────────────────────────────────────────┐
│ Favourites  [mRDT] [FBC] [RBS] [Urinalysis] [Chest X-ray]          Search ▌        │
│ Suggested by triage   [Blood glucose]   Accept [T]   Dismiss (reason) [T]          │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Full blood count   panel ▾  WBC · Haemoglobin · Platelets · MCV · Neutrophils      │
│ Priority   (●Routine) ( Urgent ) ( Immediate )                                      │
│ Reason *   [Malaria, uncomplicated ✓] (primary diagnosis)   or short text           │
│ Fasting    Not required (test menu)                                                 │
│ Where      In-house laboratory · [A] Intermittent — stock-out reported 10 Mar       │
│ [ Place order ] [T]                                                                 │
└────────────────────────────────────────────────────────────────────────────────────┘
Ionising imaging, female within REF-PREG-AGE:
│ [A] Pregnancy status not recorded — ( Pregnant ) ( Not pregnant ) ( Not known ) before ordering │
```

A favourite plus the pre-filled primary-diagnosis reason is two taps. Capability status comes from
`facility_capabilities`; intermittent is amber and words, never a block.

### E.8 Specimen collection and label

```
┌ Collect — Full blood count · Urgent ─────────────────────────────────────┐
│ Confirm with the patient:  Amina Nakato · MRN-2024-04812 · 52 y F        │
│ [ ] Name and MRN confirmed with the patient (required)                   │
│ Specimen   Venous whole blood · EDTA (test menu)                         │
│ Fasting    ( Fasting ) ( Not fasting ) ( Not sure )   ‹signed definition›│ ← only if a component needs it
│ Collected  10:44 (now) ✎      by Sr. J. Auma (Nurse)                      │
│ [ Save and print label ] [T]                                             │
└──────────────────────────────────────────────────────────────────────────┘
Label (print CSS)                    Rejection (laboratory)
┌──────────────────────────────┐     Haemolysed · Clotted · Insufficient · Unlabelled or
│ NAKATO, Amina  MRN-2024-04812 │     mislabelled · Wrong container · Delayed
│ 52 y F   DOB 03 Feb 1974      │     → order back to "To collect":
│ FBC · EDTA   12 Mar 10:44     │       [A] Rejected: haemolysed — recollect
│ Req R-0001234   Urgent        │
└──────────────────────────────┘
```

"Not sure" is stored as `unknown` and never read as fasting. While REF-DM-FASTING-DEF is pending the chip shows no
definition text.

### E.9 Result entry (laboratory; one screen per panel)

```
┌ Enter results — FBC · Amina Nakato · MRN-2024-04812 · Req R-0001234 ───────────────────────┐
│ Entry   (●Direct, laboratory)  ( Transcribed from a paper report )                          │
│ Analyte        Value      Unit         Laboratory range         Lab flag                     │
│ WBC            [ 12.4  ]  10⁹/L        [‹low›] – [‹high›]        ( H ▾ )                      │
│ Haemoglobin    [ 108   ]  g/dL ▾       [‹low›] – [‹high›]        (   ▾ )                      │
│   [A] Is this g/L?   ( Keep g/dL )   ( It is g/L → 10.8 g/dL ) [T]                            │
│ Platelets      [ <20   ]  10⁹/L        …                                                      │
│ MCV            [ 78    ]  fL           …                                                      │
│ Neutrophils    [ 9.1   ]  10⁹/L        …                                                      │
│ [ Save preliminary ] [T]    [ Release final ] [T]         Uncatalogued test? Enter as typed   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Five analytes on one screen. The mismatch prompt is a signed D-CFC-14 rule: it asks and never rejects; the trigger
value is not shown. `<` and `>` are comparators, never lost. Release writes a new final version in one transaction.
An amendment later asks the orderer to acknowledge again.

### E.10 Results review and critical communication

```
┌ Results to review (4) ──────────────────────────────────────────────────────────────────┐
│ Amina Nakato · MRN-2024-04812 · 52 F     Potassium   [R] 6.9 mmol/L  Critical            │
│   Released 10:31 · [A] Awaiting acknowledgement              ( Seen ) ( Acted ) ( Forward… ) [T] │
│ John Okot · MRN-2024-05110 · 34 M        mRDT        Positive · A (lab)                  │
│   Released 10:20                                            ( Seen ) ( Acted ) ( Forward… ) [T] │
│ Grace Apio · MRN-2024-03377 · 61 F       Creatinine  148 umol/L · H (lab)                │
│   [A] Amended 11:02 — acknowledge again                     ( Seen ) ( Acted ) ( Forward… ) [T] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
┌ Record critical communication — Potassium · Amina Nakato · MRN-2024-04812 ─┐
│ Told        [Dr S. Okello ▾]   as (●Orderer) ( Covering ) ( In-charge )    │
│ How         ( In app ) (●Phone ) ( In person )                             │
│ Read back   (●Yes ) ( No )                                                 │
│ When        10:34                                                          │
│ [ Save ] [T]                                                               │
│ Escalates to the in-charge after ‹REF-CRIT-TIMEFRAME›                       │
└────────────────────────────────────────────────────────────────────────────┘
```

Only the value is red, and only for a signed definition; the row and the lane stay amber. "Critical results" lane
sits after Resus; "Results to review" after In progress; "To co-sign" after it (E8). Live region: polite for new
results, assertive once per critical result.

### E.11 Sign, co-sign, addendum, entered in error

```
┌ Sign note ──────────────────────────────────────────────────┐   ┌ Signed note header ───────────────────────────┐
│ Required                                                    │   │ [N] Signed 10:52 · Dr S. Okello (MO) · integrity ✓ │
│  ✓ Presenting complaint                                     │   │ [A] Signed 16:40 · awaiting co-signature       │
│  ✓ Impression — Malaria, uncomplicated (primary)            │   │     (intern; orders were not held)             │
│  ✓ Plan — mRDT ordered                                      │   │ [N] Late entry — effective 08:00, recorded 16:20│
│ Warnings — you can still sign                               │   └─────────────────────────────────────────────────┘
│  [A] ▲ No examination recorded                              │   Co-signer (/doctor/cosign-queue, To co-sign lane):
│ Committed with this note: 3 findings, 7 examination signs   │   [ Co-sign ] [T]   [ Add addendum and co-sign ] [T]
│ [ Sign ] [T]    Cancel                                      │   Entered in error: reason chips + text → stays
└─────────────────────────────────────────────────────────────┘   visible, struck through, reason shown
```

A missing required item reads "[A] ▲ Impression missing — add a diagnosis or 'diagnosis deferred'" and Sign stays
disabled until it is added; orders and prescriptions never wait for signing. An intern sees "This note will await
co-signature by a senior. Your orders are not held." One tap + confirm to sign.

### E.12 Completion sheet and administrative closure

```
┌ Complete visit — Amina Nakato · MRN-2024-04812 ──────────────────────────┐
│ Disposition *                                                            │
│ (●Home) ( Admitted ) ( Referred out ) ( Transferred ) ( Died )           │
│ ( Left before completion ) ( Left against medical advice )               │
│ Follow-up   ( None ) ( Review on [26 Mar 2026] ) (●As needed )            │
│ Before you complete — warnings, not blocks                               │
│  [A] ▲ 1 unsigned note — your clerking             Sign now [T]          │
│  [A] ▲ 1 order not yet collected — Full blood count                      │
│  Pending results move to "Results to review".                            │
│ [ Complete visit ] [T]                                                   │
└──────────────────────────────────────────────────────────────────────────┘
┌ Close without completing (Needs closing) ────────────────────────────────┐
│ Reason * ( Left before seen ) ( Duplicate encounter ) ( Documented        │
│          elsewhere ) ( Opened in error ) ( Other: … )                     │
│ Recorded and audited. Nothing closes automatically.                      │
│ [ Close encounter ] [T]                                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

Died stores `deceased` and opens the cause-of-death record; Referred out opens the referral note; Admitted is the ward
seam. "Died" uses neutral styling (a record state), never red.

### E.13 Printouts (print CSS only; black on white; two identifiers in header and footer; "Page x of y")

```
Visit summary (for the patient)                 Referral note (HMIS 032 fields)          Laboratory request
┌───────────────────────────────────────┐      ┌──────────────────────────────────┐     ┌──────────────────────────────┐
│ ‹Hospital›               Visit summary │      │ ‹Hospital› — Referral note        │     │ ‹Hospital› — Lab request      │
│ Amina Nakato · MRN-2024-04812 · 52 F   │      │ Amina Nakato · MRN · 52 F · date  │     │ Amina Nakato · MRN · 52 F     │
│ 12 Mar 2026                            │      │ Reason · Urgency · Transport      │     │ Req R-0001234 · Urgent        │
│ What we found   Malaria                │      │ History summary · Examination     │     │ Tests  FBC · mRDT             │
│ Your medicines  ‹reconciled list›      │      │ Investigations and results        │     │ Specimen  EDTA · 10:44        │
│ Allergies       Penicillin             │      │ Treatment given · Diagnoses       │     │ Fasting  n/a                  │
│ Next visit      As needed              │      │ Current medicines (reconciled)    │     │ Reason  Malaria (working)     │
│                                        │      │ Receiving facility, department    │     │ Requested by Dr S. Okello, MO │
│                                        │      │ Clinician, cadre, council reg. no.│     │                               │
│                                        │      │ ── Return feedback ──             │     │                               │
├───────────────────────────────────────┤      ├──────────────────────────────────┤     ├──────────────────────────────┤
│ Amina Nakato · MRN-2024-04812  Page 1/1│      │ Amina Nakato · MRN   Page 1 of 2  │     │ Amina Nakato · MRN  Page 1/1 │
└───────────────────────────────────────┘      └──────────────────────────────────┘     └──────────────────────────────┘
```

Plain-language diagnoses on the patient summary. Restricted items are excluded unless the clinician includes them item
by item in the print dialog ("2 restricted items not printed — include…"); the printout itself never says that
anything was withheld.

---

## F. Test plan

Two lanes (ADR 0133): `tests/emr/**` pure, always run; `tests/emr-db/**` PGlite, run only when
`EMR_PGLITE_MODULES` points at `~/Desktop/emr-harness/pg/node_modules`. Property tests use a seeded generator in the
style of `tests/workspace/flow-property.test.ts` (no new dependency). Agents run `npx vitest run <files>` only.

### F.1 Pure tests (minimums from PROMPT §6, raised where the data says so)

| Module                     | Minimum          | Must cover                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/units`                | 40               | ≥ 30 known pairs over the 14 v1 + 8 v1.1 conversions, both directions (126 mg/dL ↔ 7.0 mmol/L; 6.5 % ↔ 48 mmol/mol; bilirubin, calcium, magnesium, phosphate, uric acid, lactate, albumin); every D-CFC-14 rule prompts and does not prompt on either side; a prompt never rejects                                                                                                                                                    |
| `lib/facts`                | 204 + 30         | round-trip for every concept (145 v1 + 59 v1.1); legacy projection per legacy kind and snapshot key (A6 table), ACVPU quarantined with a reason; as-of reproducibility (same asOf → same hash); quarantine path; correction propagation; manifest least privilege (C10); `obs.uncatalogued` never in a snapshot; SR-PREG-MINOR incl. imprecise DOB                                                                                    |
| `lib/emr/encounter.ts`     | every transition | valid: planned→in_progress, planned→cancelled, in_progress→completed (clinical, needs disposition), open→completed (administrative, needs reason), open→entered_in_error (reason); every invalid one (from completed, cancelled, entered_in_error; clinical without disposition); legacy disposition mapping (admit→admitted, discharge→home, refer→referred_out, transfer→transferred, deceased→died); the three completion warnings |
| `lib/emr/notes.ts`         | 40               | template JSON schema; each of the 27 required and 4 prompted rules passing and failing; canonical composition stable under key order and whitespace; HMAC input bytes; addendum threading; late entry at the setting's boundary; commit plan lists note-born facts only                                                                                                                                                               |
| `lib/emr/carry-forward.ts` | 20               | triage prefill (0 taps; source mark), problems, allergies, medicines with "still true?" states; narrative never carried                                                                                                                                                                                                                                                                                                               |
| `lib/emr/allergy.ts`       | 25               | four statuses; an active allergy outranks NKDA; refuted and entered-in-error excluded; voided assertion; migrated rows; duplicates grouped; prescribing input includes uncoded text **[H]**; "by name only" label                                                                                                                                                                                                                     |
| `lib/emr/orders.ts`        | 30 + property    | proposed → placed/dismissed → collected → rejected → recollect → in progress → resulted → acknowledged; cancelled with reason; on hold/resumed                                                                                                                                                                                                                                                                                        |
| `lib/emr/results.ts`       | 40               | preliminary/final/amended/corrected; lab flag as text; critical only from a signed entry (none signed → never); acknowledgement per version; amendment needs re-acknowledgement; escalation state with an unsigned timeframe; D-EMR-08 trust table                                                                                                                                                                                    |
| `lib/emr/hmis.ts`          | 20               | attendance type, age band, HMIS category, IDSR class: each returns `unknown` while its reference is `pending_cso`                                                                                                                                                                                                                                                                                                                     |
| `lib/emr/chart.ts`         | 25               | safety-bar payload variants (E.1), restricted flag, deceased, pregnancy line absent while REF-PREG-AGE pending, top three problems                                                                                                                                                                                                                                                                                                    |
| `lib/emr/fhir.ts`          | 12               | round-trip per resource (Patient, Encounter, Condition, Observation, AllergyIntolerance, MedicationStatement, MedicationRequest, ServiceRequest, Specimen, DiagnosticReport, Procedure, Composition)                                                                                                                                                                                                                                  |
| Data files                 | 6                | the generator assertions as Vitest: concept ids unique and disjoint from v1; LOINC candidates only; `symptomCode` unique and present in the 0042/0045 seed; every accepted unit has a conversion; every sign rule names a real, non-optional section; every template concept exists                                                                                                                                                   |
| Red scarcity               | per component    | extend the invariant to `components/emr/**`: `#DC2626`/`status-critical` only on a critical value and Emergency                                                                                                                                                                                                                                                                                                                       |

### F.2 Property tests

| Property                                                                                            | Where                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------ |
| A signed note's canonical content and HMAC never change                                             | pure + PGlite (UPDATE refused) |
| Nothing ordered disappears: every order ends acknowledged, cancelled with a reason, or visibly open | pure                           |
| Allergy status is never NKDA while an active allergy exists                                         | pure                           |
| A restricted fact never appears in a patient-facing payload (visit summary, FHIR export)            | pure                           |
| The same snapshot always gives the same hash                                                        | pure                           |
| `patient_access_basis(u,p,h) IS NOT NULL` ⟺ `p ∈ accessible_patient_ids()` for random fixtures      | PGlite                         |

### F.3 PGlite lane

| Suite            | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migration replay | 0000 → 0073 green on the harness bootstrap; 0071 adds 0 rows to and changes 0 rows in any existing table (row hashes before/after)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Guards           | signed note UPDATE/DELETE refused; draft identity change refused; CFC observation UPDATE refused; legacy `active→corrected` allowed, any other legacy change and every DELETE refused; events order refused, legacy order status update allowed; every insert-only table refuses UPDATE/DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| RLS probe matrix | every object (14 new clinical tables, 5 views, 8 evolved or projected tables, 7 registries = 34) × every actor below × SELECT/INSERT/UPDATE/DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Write paths      | each §8 write function `(tx, input, actor)`: expected rows, exactly one audit row, idempotent on `client_key` (second call: same id, 0 new rows), refused without a basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Backfill         | fixtures for four `patient_allergies` severities and resus captures (latest wins, NKDA, superseded, unknown patient, null recorder); re-run gives the same counts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Scenarios A1–A9  | integration tests over the real write functions **[H]**: A1 walk-in → triage → start → dx + mRDT → collect (fasting chip) → result → ack → complete home; A2 OPD allergy blocks resus prescribing and a resus AMPLE allergy shows in the OPD safety bar; A3 critical path (runs with a test-signed REF-CRIT fixture, never a real value); A4 signed note immutable, addendum threaded, entered-in-error visible and reversing; A5 resus handover → encounter + ISBAR note + proposed orders, flag cleared; A6 administrative closure with reason, nothing auto-closes; A7 reception and other hospital denied, intern note awaits co-sign and orders go through; A8 offline drill (queue model pure + ordered flush on PGlite); A9 notifiable dx → confirm sheet → notification intent + IPC prompt (test-signed IDSR fixture) |

RLS actors: same-hospital clinician holding each basis in turn (active_encounter, assigned, open_intake,
department_recent) · same-hospital clinician with no basis · other-hospital clinician with a basis there · reception
at the same hospital with the patient present · lab tech with a department basis · break-glass grantee · patient
(own record, JWT) · clinician via JWT without GUCs · anonymous. Expected: the four bases, the lab tech and break-glass
read; everyone else reads nothing from new tables; no actor writes from a client role. The `authenticator`
impersonation guard in `current_user_id()` needs a second login role, so that one probe runs on the dev project (O-1).

### F.4 UI checks (P5, P6)

axe-core over server-rendered fixture pages of the pure `*View` components (the doctor-workspace harness method):
0 serious or critical. CDP screenshots from the scratch harness at 390×844, 834×1194, 1440×900, light and dark, flag on
and off (flag off must match the baseline). Budgets (§13) measured in P8.

---

## G. Decision table and signature

Every row below was signed as recommended. "Realised as" names the harmonised mechanism.

**Engineering (PROMPT §15)**

| ID  | Decision (recommendation signed)                                                       | Realised as                                                                                                  |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| E1  | Hosted Supabase dev project, synthetic data                                            | **[H]** O-1; meanwhile the PGlite lane (ADR 0133)                                                            |
| E2  | Transaction-local identity, one helper, FORCE RLS, non-owner reads                     | **[H]** `private.*`, `medsync_clinical_reader`, `asClinicalReader`/`asClinicalWriter` (§A.1, A.13; ADR 0131) |
| E3  | Evolve `clinical_observations`, no second table                                        | **[H]** guard trigger, no backfill mutation, projection (§A.7)                                               |
| E4  | Plaintext structured values; identifiers and free text encrypted                       | ADR 0132; NCD drafts `{enc}`; O-5                                                                            |
| E5  | Server autosave + in memory; IndexedDB only on DPPA acceptance                         | in memory (not accepted)                                                                                     |
| E6  | ICD-11 first; ICD-10 empty until licensed; LOINC notice; confirm CIEL                  | CHECK on `icd10_who_code`; `THIRD-PARTY-NOTICES.md`; O-3 (ADR 0137)                                          |
| E7  | FHIR projection for export tests only                                                  | ADR 0138                                                                                                     |
| E8  | Critical results after Resus; Results to review after In progress; To co-sign after it | **[H]** `LaneId` + `LANES` + FW-2 branch + loader (no registry exists)                                       |
| E9  | Print CSS only                                                                         | §E.13                                                                                                        |
| E10 | HMAC-SHA-256, dedicated key                                                            | `MEDSYNC_NOTE_HMAC_KEY` (O-2), `hmac_key_id`                                                                 |

**Clinical (PROMPT §15)**

| ID       | Decision (recommendation signed)                                                                              | Realised as                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| D-EMR-01 | Chart actions commit at once; narrative and note-born findings at signing                                     | NCD capture commits via `lib/ncd/cfc-map.ts` at signing                                   |
| D-EMR-02 | Signed is immutable; addenda; late entry labelled; entered in error with reason by author or supervisor       | notes guard; `clinical_note_events`; §D                                                   |
| D-EMR-03 | Co-sign mechanism now; sets follow the co-sign decision; never blocks care                                    | reuses `clinical_cosign_requests` (`sign_note`); set = `clerkshipWriteAuthority` (intern) |
| D-EMR-04 | One allergy record; NKDA an assertion; unable to assess a state; resus migrated; prescribing reads the record | **[H]** uncoded text still name-matched (safety-positive)                                 |
| D-EMR-05 | Problem list and diagnoses separate; one primary; symptom dx allowed; reason to resolve or refute             | `conditions`; legacy projected                                                            |
| D-EMR-06 | Critical definitions signed with the lab lead; read-back; escalation; red on the value only                   | none signed yet → nothing flagged; lab flag shown as text                                 |
| D-EMR-07 | Orderer or cover acknowledges; amended needs re-acknowledgement                                               | ack per report version                                                                    |
| D-EMR-08 | Trust T4 direct final / interface; T3 transcribed until verified; T3 POC                                      | addendum A7                                                                               |
| D-EMR-09 | Disposition required; warnings not blocks; administrative closure needs a reason; nothing auto-closes         | **[H]** died stored as `deceased` (ADR 0115 reads it); one path `ha-complete-encounter`   |
| D-EMR-10 | Capture attendance type, primary dx category, referrals now                                                   | `attendance_type`, `referral_in`, `hmis_category_id` (null until signed)                  |
| D-EMR-11 | IDSR flag → confirm sheet, pending notification intent, IPC prompt; never blocks                              | §E.5                                                                                      |
| D-EMR-12 | Pregnancy status within a signed age range; imaging and prescribing triggers                                  | `ionising` on the test menu; line hidden while REF-PREG-AGE pending                       |
| D-EMR-13 | Restricted content excluded from patient prints and channels; item-by-item inclusion                          | §E.13; FHIR filter                                                                        |
| D-EMR-14 | Include prescription records (Phase 7)                                                                        | `EMR_PRESCRIBING`                                                                         |
| D-EMR-15 | Templates and minimum-to-sign as reference 2.1–2.11                                                           | `data/emr/note-templates.v1.json`                                                         |
| D-EMR-16 | Permission matrix by cadre                                                                                    | §D                                                                                        |

**Clinical Fact Contract (MS-DATA-CFC-001 §11)**

| ID       | Decision (signed)                                               | Realised as                                                                        |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D-CFC-01 | MedSync concept ids primary; codes are verified mappings        | `clinical_concepts.codes` with status                                              |
| D-CFC-02 | One insert-only observation store; CGM separate                 | **[H]** via E3                                                                     |
| D-CFC-03 | Versioned, bitemporal tables with as-of snapshots               | fact envelope; `created_at` is knowledge time on `clinical_observations`           |
| D-CFC-04 | Encryption boundary                                             | = E4                                                                               |
| D-CFC-05 | Canonical units as §5                                           | `lib/units`                                                                        |
| D-CFC-06 | eGFR by one signed equation (interim CKD-EPI 2021, ARK caveat)  | NCD scope; nothing built here                                                      |
| D-CFC-07 | Trust T1–T4; rules declare a minimum                            | envelope `trust`                                                                   |
| D-CFC-08 | Location out of the read contract                               | loader                                                                             |
| D-CFC-09 | Restricted classes; pregnancy restricted for minors             | `sensitivity`; SR-PREG-MINOR                                                       |
| D-CFC-10 | WHO ICD-10 + ICD-11 now; CIEL mapping                           | narrowed by E6: ICD-10 empty until O-3; CIEL column present, terms confirmed first |
| D-CFC-11 | Finding concepts join the shared token catalogue                | **[H]** `symptom_catalog ∪ clinical_concepts(finding)`, `symptom_code`             |
| D-CFC-12 | Imprecise DOB handled conservatively                            | SR-PREG-MINOR; HMIS age bands                                                      |
| D-CFC-13 | `facility_capabilities` with intermittent                       | §A.2; hospital setup                                                               |
| D-CFC-14 | Unit-mismatch triggers as proposed                              | the five v1 rules; none added                                                      |
| D-CFC-15 | Plausibility bounds per quantity concept, signed in the dossier | mechanism ships; `RefEntry` pending_cso                                            |

**NCD engine (MS-NCD-ENG-001) — context only; nothing of the engine is built here**

| ID       | Decision (signed)                                             | Touches this build                                  |
| -------- | ------------------------------------------------------------- | --------------------------------------------------- |
| D-NCD-01 | Intended-use statement                                        | —                                                   |
| D-NCD-02 | Logic in code, numbers in signed catalogues; no rules DSL     | templates' sign checks are a closed list, not a DSL |
| D-NCD-03 | State ownership; engine never enters clinician-owned states   | —                                                   |
| D-NCD-04 | Acute routing: in-facility to triage recommendations          | recommendation intents render in Plan               |
| D-NCD-05 | Engines exchange facts and confirmed states only              | `loadFactSnapshot`                                  |
| D-NCD-06 | Proposal eligibility by cadre incl. clinical officers         | §D                                                  |
| D-NCD-07 | Decline reasons and snooze windows                            | —                                                   |
| D-NCD-08 | Workspace badge plus a Tasks source, one row per patient      | FW-2 respected by the new lanes                     |
| D-NCD-09 | "With complications" = clinician-confirmed components         | —                                                   |
| D-NCD-10 | Shadow mode and go-live gates                                 | —                                                   |
| D-NCD-11 | Default criteria set: UCG 2023                                | —                                                   |
| D-NCD-12 | Under-16 scope: recognition, classification support, referral | paediatric module has no dosing                     |
| D-NCD-13 | Patient-facing output only after confirmation; neutral SMS    | restricted exclusion                                |
| D-NCD-14 | Small-cell suppression threshold for registries (proposed 5)  | —                                                   |
| D-NCD-15 | Dev-only fixture preview for design review                    | the P5 fixture harness is the same exception        |
| D-NCD-16 | Roadmap insertion Tier 3 item 4                               | —                                                   |
| D-NCD-17 | Four-eyes pack signing                                        | —                                                   |

**Clinical reference register (MS-EMR-CLIN-001 [12]).** Structure signed; reference _values_ are separate
`RefEntry` files, `pending_cso`, value withheld, and each mechanism shows no number until its entry is signed.

| Item                                                                                 | Structure                                   | Values                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ |
| Principles 1–9; templates 2.1–2.10; minimum to sign 2.11; script 2.12                | signed                                      | —                                                                              |
| Findings rules                                                                       | signed                                      | REF-IDSR-SCREEN pending                                                        |
| Diagnosis rules                                                                      | signed                                      | REF-DX-TERMS (starter terms, ICD-11), REF-DX-TESTFIRST pending                 |
| Allergy model; medicines reconciliation; orders, specimens, results, acknowledgement | signed                                      | —                                                                              |
| Critical-results policy                                                              | signed                                      | REF-CRIT-\*, REF-CRIT-TIMEFRAME pending (with the laboratory lead)             |
| Concept extension and conversions                                                    | signed (`clinical-fact-concepts.v1.1.json`) | codes candidate                                                                |
| Pregnancy                                                                            | signed                                      | REF-PREG-AGE, postpartum window pending                                        |
| Restricted classes; minors default                                                   | signed                                      | —                                                                              |
| HMIS and IDSR capture                                                                | signed                                      | REF-HMIS-ATTENDANCE, REF-HMIS-AGEBANDS, REF-HMIS-MAP, REF-IDSR-CLASSES pending |
| Fasting definition (CFC 4.1)                                                         | —                                           | REF-DM-FASTING-DEF pending                                                     |

### Signature

> **Signed as recommended by Fadhul (owner, CSO), 2026-09-26, in session; harmonisations marked [H] in
> HARMONISATION.md apply**
>
> Covers: E1–E10, D-EMR-01 to D-EMR-16, D-CFC-01 to D-CFC-15, D-NCD-01 to D-NCD-17; the CFC v1.1 addendum; the
> permission matrix (§D); `note-templates.v1.json`; `clinical-fact-concepts.v1.1.json`. Not covered: the `pending_cso`
> reference values above, and the §H.2 operational defaults and §H.4 confirmations.

---

## H. Deviations, defaults, owner actions, open confirmations

### H.1 Deviations from HARMONISATION wording (intent unchanged)

| #   | HARMONISATION says                                | This pack does                                                                                                                                                  | Why                                                                                    |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| D1  | `private.block_mutation()`                        | reuses `public.block_modify_append_only()` (0040:118)                                                                                                           | the same function already exists; no second copy                                       |
| D2  | 0071 copies allergies                             | copies rows but not the text: backfilled rows carry `legacy_ref`; the projection reads the untouched source; O-5 (extended) inserts version 2 with ciphertext   | SQL cannot produce `lib/encryption.ts` ciphertext, and a plaintext copy would break E4 |
| D3  | `closure_reason`; allergy `source`; `recorded_by` | `closure_reason` is a code + `closure_note_ciphertext`; the §7.5 informant list is `informant` (the table also carries the CFC `source`); `recorded_by_user_id` | E4 (free text encrypted); one column cannot hold two vocabularies; repo naming         |

### H.2 Operational defaults proposed here (hospital settings; not in the signed list)

| Setting                             | Default                                                                                    | Basis                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Note autosave debounce              | 1,500 ms after typing pauses, plus on section change and `visibilitychange`                | today's page saves only on section change and loses the last section on close               |
| Draft idle → Needs closing          | 24 h                                                                                       | existing `ENCOUNTER_IDLE_MS` (`lib/workspace/queries.ts:54`)                                |
| Late-entry window                   | 24 h between effective and signed time                                                     | notes are routinely written after the patient leaves; resus keeps its own 60 s bedside rule |
| Server-clock skew warning           | 30 s; offset refetch every 5 min                                                           | PROMPT §9                                                                                   |
| Realtime fallback poll              | 15 s while visible                                                                         | PROMPT §9, 0069 precedent                                                                   |
| Administrative-closure reason chips | left before seen, duplicate encounter, documented elsewhere, opened in error, other (text) | administrative, not clinical                                                                |

### H.3 Owner actions (HARMONISATION §8, extended)

| #   | Action                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-1 | Create the hosted Supabase dev project; apply 0000–0073; run the RLS suites and the `authenticator` probe there                                                                                                      |
| O-2 | Set `MEDSYNC_NOTE_HMAC_KEY` in Vercel (32 random bytes, base64)                                                                                                                                                      |
| O-3 | Apply for the WHO ICD-10 commercial licence                                                                                                                                                                          |
| O-4 | Count legacy rows (queries in the final report) before any retirement                                                                                                                                                |
| O-5 | Re-encrypt old plaintext NCD drafts (script, dry-run first). **Extended:** insert version 2 with ciphertext for every backfilled allergy, before O-4 retires a legacy table                                          |
| O-6 | Decide on Playwright                                                                                                                                                                                                 |
| O-7 | Apply 0071–0073 in prod, deploy `ha-start-encounter` and `ha-complete-encounter`, set `EMR_V1`. **Extended:** run `scripts/emr/backfill-allergies.ts` once when the flag goes on (captures written while it was off) |

### H.4 Open confirmations (outside the signature; none blocks P2)

| Item                                                                                                                   | Needed for                                                                  | Proposed handling until confirmed                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All `pending_cso` reference values (§G register)                                                                       | the mechanisms that use them                                                | mechanisms ship and show no number                                                                                                                                                               |
| Pregnancy line while REF-PREG-AGE is pending                                                                           | safety bar, imaging prompt                                                  | module offered collapsed for female patients; bar line and imaging prompt off                                                                                                                    |
| Cross-facility allergy visibility                                                                                      | prescribing safety at a second hospital                                     | rows are hospital-scoped like every row; the prescribing input could read the patient's allergies across hospitals server-side (safety-positive) — owner and CSO decide with the DPA/MoU in view |
| HMIS 032 field list; national cause-of-death form and MPDSR pathway; PF3/PF3A forms; UCG 2023 malaria wording and page | referral print, cause-of-death record, medico-legal seam, test-first prompt | fields as in reference 2.8/2.9; medico-legal is a note type with no template                                                                                                                     |
| Minor and guardian model                                                                                               | restricted content for minors                                               | conservative default (reference [10])                                                                                                                                                            |
| ACVPU "C" has no AVPU answer                                                                                           | projecting triage consciousness                                             | quarantined with a reason, never dropped                                                                                                                                                         |
| Dipstick answer sets, Xpert result wording (concept JSON `openConfirmations`)                                          | result entry                                                                | v1 dipstick scale reused                                                                                                                                                                         |
| Q18 baseline (TTFB, JS size, timings)                                                                                  | budgets                                                                     | taken once in the P5 harness before the new UI is switched on                                                                                                                                    |
| CIEL dictionary shipped by UgandaEMR                                                                                   | `ciel_id` values                                                            | column present, empty                                                                                                                                                                            |
