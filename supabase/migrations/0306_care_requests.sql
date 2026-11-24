-- GATED — applied by the owner (`npm run db:migrate`), never auto-run.
-- 0306: one request record for reviews and consults (ADR 0533).
--
--   1. care_requests: a review or a consult, written once when the Plan is placed and never updated
--      (phoned_user_id / phoned_at are set at placement). care_request_events: its append-only history
--      (routed, seen, accepted, declined, redirected, replied, closed, cancelled, escalated); the state is
--      derived from the events (lib/requests/engine.ts), never stored. Free text is ciphertext. A
--      `routed` row names who that routing skipped (skipped_user_ids: inactive, or the requester).
--   2. clinical_notes.note_type gains 'consult' (the reply note); sa_notifications.kind gains
--      'care_request', 'care_request_update' and 'ward_incoming' (0068's seven kept verbatim).
--   3. private.care_request_visible(): who reads a request through medsync_clinical_reader — the requester,
--      anyone with chart access, anyone an event names, a clinical member of the target department while
--      the request is open, and the department's head. Never anon or authenticated.
--   4. Audit on both tables, and both append-only.
--   5. The care_team access basis (0101's seam made real): a current-round recipient who has not declined,
--      any accepter, or the phoned consultant may open the patient's chart while the request is open, or
--      for 30 days after its reply (DEPARTMENT_WINDOW_DAYS); a cancel ends it at once. Earlier-round
--      recipients and decliners lose it (they still read the request, section 3). Both bodies of the rule
--      call one helper.
--
-- ADDITIVE and re-runnable. No client grants: writes come from the server connection (asClinicalWriter).
-- Reverse: restore 0101's two rule bodies; drop private.care_team_patients, the two tables and the
-- helper; restore the 0071 note_type and 0068 kind CHECKs.

-- ─── 1. Tables ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.care_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE RESTRICT,
  admission_id uuid REFERENCES public.admissions(id) ON DELETE RESTRICT,
  ward_id uuid REFERENCES public.hospital_wards(id) ON DELETE RESTRICT,
  kind text NOT NULL CONSTRAINT care_requests_kind_check CHECK (kind IN ('review','consult')),
  target_department_id uuid NOT NULL REFERENCES public.hospital_departments(id) ON DELETE RESTRICT,
  named_user_ids uuid[] NOT NULL DEFAULT '{}'
    CONSTRAINT care_requests_named_max CHECK (cardinality(named_user_ids) <= 5),
  urgency text NOT NULL,
  help_wanted text,
  reason_condition_ids uuid[] NOT NULL DEFAULT '{}',
  question_ciphertext text,
  phoned_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  phoned_at timestamptz,
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requester_cadre text NOT NULL,
  requested_at timestamptz NOT NULL,
  placement_id uuid NOT NULL,                                  -- the Plan placement that sent it
  client_key text NOT NULL CONSTRAINT care_requests_client_key UNIQUE,
  sensitivity text NOT NULL DEFAULT 'standard'
    CONSTRAINT care_requests_sensitivity_check CHECK (sensitivity IN ('standard','restricted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT care_requests_urgency_check CHECK (
    (kind = 'review' AND urgency IN ('now','within_1h','routine'))
    OR (kind = 'consult' AND urgency IN ('urgent_today','routine'))),
  CONSTRAINT care_requests_help_wanted_check CHECK (
    (kind = 'consult') = (help_wanted IS NOT NULL) AND (help_wanted IS NULL OR help_wanted IN ('advice','see_patient'))),
  CONSTRAINT care_requests_consult_reason CHECK (kind = 'review' OR cardinality(reason_condition_ids) >= 1),
  CONSTRAINT care_requests_consult_question CHECK (kind = 'review' OR question_ciphertext IS NOT NULL),
  CONSTRAINT care_requests_phoned_shape CHECK ((phoned_user_id IS NULL) = (phoned_at IS NULL))
);
CREATE INDEX IF NOT EXISTS care_requests_department_time
  ON public.care_requests (hospital_id, target_department_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.care_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.care_requests(id) ON DELETE RESTRICT,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  kind text NOT NULL CONSTRAINT care_request_events_kind_check CHECK (kind IN
    ('routed','seen','accepted','declined','redirected','replied','closed','cancelled','escalated')),
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  level smallint NOT NULL DEFAULT 0 CONSTRAINT care_request_events_level_check CHECK (level BETWEEN 0 AND 2),
  step text,
  post_id uuid,                                                -- the FK arrives with duty_posts (0307)
  reason_code text,
  note_ciphertext text,
  note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,
  redirect_department_id uuid REFERENCES public.hospital_departments(id) ON DELETE RESTRICT,
  expect_at timestamptz,
  client_key text CONSTRAINT care_request_events_client_key UNIQUE,
  CONSTRAINT care_request_events_step_check CHECK (
    (kind = 'routed') = (step IS NOT NULL)
    AND (step IS NULL OR step IN ('named','post','team','supervisor','department_head','hospital_contacts','none'))),
  CONSTRAINT care_request_events_reason_check CHECK (
    kind NOT IN ('declined','redirected','cancelled') OR reason_code IS NOT NULL),
  CONSTRAINT care_request_events_note_shape CHECK ((kind = 'replied') = (note_id IS NOT NULL)),
  CONSTRAINT care_request_events_redirect_shape CHECK ((kind = 'redirected') = (redirect_department_id IS NOT NULL)),
  CONSTRAINT care_request_events_actor_check CHECK (
    kind NOT IN ('seen','accepted','declined','redirected','replied','closed','cancelled') OR actor_user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS care_request_events_request_time ON public.care_request_events (request_id, at);
CREATE INDEX IF NOT EXISTS care_request_events_recipient_routed
  ON public.care_request_events (recipient_user_id, at DESC) WHERE kind = 'routed';

-- Who a routing step passed over (inactive, or the requester), on every row of that routing.
ALTER TABLE public.care_request_events
  ADD COLUMN IF NOT EXISTS skipped_user_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.care_request_events DROP CONSTRAINT IF EXISTS care_request_events_skipped_shape;
ALTER TABLE public.care_request_events ADD CONSTRAINT care_request_events_skipped_shape
  CHECK (kind = 'routed' OR cardinality(skipped_user_ids) = 0);

-- ─── 2. CHECK widenings (DROP-then-ADD: the earlier lists verbatim, plus the new values) ─────
ALTER TABLE public.clinical_notes DROP CONSTRAINT IF EXISTS clinical_notes_note_type_check;
ALTER TABLE public.clinical_notes ADD CONSTRAINT clinical_notes_note_type_check CHECK (note_type IN
  ('clerking','emergency_clerking','progress','ward_round','procedure',
   'handover','referral','nursing','addendum','cause_of_death','medico_legal',   -- 0071, kept
   'consult'));                                                                   -- 0306

ALTER TABLE public.sa_notifications DROP CONSTRAINT IF EXISTS sa_notifications_kind_check;
ALTER TABLE public.sa_notifications ADD CONSTRAINT sa_notifications_kind_check CHECK (kind IN (
  'break_glass_access', 'admin_action_on_tenant', 'account_security',
  'clinical_triage_alert', 'clinical_resus_mobilisation',
  'clinical_resus_arrest_call', 'clinical_resus_idle',                           -- 0068, kept
  'care_request', 'care_request_update', 'ward_incoming'));                      -- 0306

-- ─── 3. Who reads a request ──────────────────────────────────────────────
-- SECURITY DEFINER: reads both tables as the owner, so neither policy recurses into the other.
CREATE OR REPLACE FUNCTION private.care_request_visible(p_request uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH me AS (SELECT private.current_user_id() AS uid, private.current_hospital_id() AS hid)
  SELECT EXISTS (
    SELECT 1 FROM me JOIN public.care_requests r ON r.id = p_request AND r.hospital_id = me.hid
     WHERE me.uid IS NOT NULL
       AND (r.requester_user_id = me.uid
         OR EXISTS (SELECT 1 FROM public.care_request_events e
                     WHERE e.request_id = r.id AND me.uid IN (e.recipient_user_id, e.actor_user_id))
         OR (NOT EXISTS (SELECT 1 FROM public.care_request_events e
                          WHERE e.request_id = r.id AND e.kind IN ('replied','closed','cancelled'))
             AND EXISTS (SELECT 1 FROM public.staff_affiliations sa
                           JOIN public.cadres c ON c.id = sa.cadre_id
                          WHERE sa.user_id = me.uid AND sa.hospital_id = r.hospital_id
                            AND sa.department_id = r.target_department_id
                            AND sa.state IN ('active','approved') AND c.is_clinical))
         OR EXISTS (SELECT 1 FROM public.department_heads h
                     WHERE h.user_id = me.uid AND h.hospital_id = r.hospital_id
                       AND h.department_id = r.target_department_id
                       AND h.starts_at <= now() AND (h.ends_at IS NULL OR h.ends_at > now()))
         OR r.patient_user_id IN (SELECT private.accessible_patient_ids())));
$$;
REVOKE ALL ON FUNCTION private.care_request_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.care_request_visible(uuid) TO medsync_clinical_reader;

ALTER TABLE public.care_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_requests FROM anon, authenticated;
GRANT SELECT ON public.care_requests TO medsync_clinical_reader;
DROP POLICY IF EXISTS care_requests_select ON public.care_requests;
CREATE POLICY care_requests_select ON public.care_requests FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id()) AND private.care_request_visible(id));

ALTER TABLE public.care_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_request_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_request_events FROM anon, authenticated;
GRANT SELECT ON public.care_request_events TO medsync_clinical_reader;
DROP POLICY IF EXISTS care_request_events_select ON public.care_request_events;
CREATE POLICY care_request_events_select ON public.care_request_events FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id()) AND private.care_request_visible(request_id));

-- 0288's rule for every RLS table created after it (tests/auth/mfa-below-pages.test.ts).
DROP POLICY IF EXISTS mfa_gate ON public.care_requests;
CREATE POLICY mfa_gate ON public.care_requests AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));
DROP POLICY IF EXISTS mfa_gate ON public.care_request_events;
CREATE POLICY mfa_gate ON public.care_request_events AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));

-- ─── 4. Audit and append-only ────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_care_requests ON public.care_requests;
CREATE TRIGGER audit_care_requests AFTER INSERT OR UPDATE OR DELETE ON public.care_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
DROP TRIGGER IF EXISTS audit_care_request_events ON public.care_request_events;
CREATE TRIGGER audit_care_request_events AFTER INSERT OR UPDATE OR DELETE ON public.care_request_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

DROP TRIGGER IF EXISTS care_requests_append_only ON public.care_requests;
CREATE TRIGGER care_requests_append_only BEFORE UPDATE OR DELETE ON public.care_requests
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS care_request_events_append_only ON public.care_request_events;
CREATE TRIGGER care_request_events_append_only BEFORE UPDATE OR DELETE ON public.care_request_events
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();

-- ─── 5. The care_team access basis ──────────────────────────────────────
-- Patients of this hospital's requests where the user is (R23, least privilege) a routed recipient of the
-- current round who has not declined in it, any accepter, or the phoned consultant; while the request is
-- open (no replied, closed or cancelled event), or replied within the last 30 days (DEPARTMENT_WINDOW_DAYS,
-- lib/encounter/scope.ts:43) and not cancelled. A cancel ends access at once. The current round is every
-- event at or after the last `redirected` event's `at` (a redirect and its new routing share one now()).
CREATE OR REPLACE FUNCTION private.care_team_patients(p_user uuid, p_hospital uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT r.patient_user_id
  FROM public.care_requests r
  CROSS JOIN LATERAL (
    SELECT coalesce(max(e.at), '-infinity'::timestamptz) AS since
    FROM public.care_request_events e WHERE e.request_id = r.id AND e.kind = 'redirected') round
  WHERE r.hospital_id = p_hospital
    AND (r.phoned_user_id = p_user
      OR EXISTS (SELECT 1 FROM public.care_request_events e
                  WHERE e.request_id = r.id AND e.kind = 'accepted' AND e.actor_user_id = p_user)
      OR (EXISTS (SELECT 1 FROM public.care_request_events e
                   WHERE e.request_id = r.id AND e.kind = 'routed' AND e.recipient_user_id = p_user
                     AND e.at >= round.since)
          AND NOT EXISTS (SELECT 1 FROM public.care_request_events e
                           WHERE e.request_id = r.id AND e.kind = 'declined' AND e.actor_user_id = p_user
                             AND e.at >= round.since)))
    AND NOT EXISTS (SELECT 1 FROM public.care_request_events e
                     WHERE e.request_id = r.id AND e.kind = 'cancelled')
    AND (NOT EXISTS (SELECT 1 FROM public.care_request_events e
                      WHERE e.request_id = r.id AND e.kind IN ('replied','closed'))
      OR EXISTS (SELECT 1 FROM public.care_request_events e
                  WHERE e.request_id = r.id AND e.kind = 'replied' AND e.at >= now() - interval '30 days'));
$$;
REVOKE ALL ON FUNCTION private.care_team_patients(uuid, uuid) FROM PUBLIC;

-- The two bodies of the rule, copied verbatim from 0101 (0101_lab_work_access_basis.sql:23-140) but for
-- the care_team arm, which calls the helper above in both, so they agree by construction.
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
  ),
  lab AS (
    SELECT 1
    FROM public.staff_affiliations sa
    JOIN public.cadres c ON c.id = sa.cadre_id
    WHERE sa.user_id = p_user
      AND sa.hospital_id = p_hospital
      AND sa.state IN ('active','approved')
      AND c.code IN ('LAB_TECH', 'LAB_TECHNOLOGIST')
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
    -- 4b. lab_work (0101) — a laboratory cadre, and a lab order for the patient at this hospital within the
    --     same 30-day window: the specimens the lab holds, whatever the visit's state or the date.
    WHEN EXISTS (SELECT 1 FROM lab) AND EXISTS (
      SELECT 1 FROM public.encounter_orders o
      WHERE o.patient_user_id = p_patient AND o.hospital_id = p_hospital
        AND o.kind = 'lab' AND o.created_at >= now() - interval '30 days')
      THEN 'lab_work'
    -- 5. care_team (0306) — a routed recipient or the accepter of an open, or recently replied, request.
    WHEN EXISTS (SELECT 1 FROM clin) AND p_patient IN (SELECT private.care_team_patients(p_user, p_hospital))
      THEN 'care_team'
    -- 6. break_glass — sa_break_glass_grants (0018:194): actor_id, patient_id, hospital_id (nullable), revoked_at, expires_at
    WHEN EXISTS (
      SELECT 1 FROM public.sa_break_glass_grants g
      WHERE g.actor_id = p_user AND g.patient_id = p_patient
        AND g.revoked_at IS NULL AND g.expires_at > now()
        AND (g.hospital_id IS NULL OR g.hospital_id = p_hospital))
      THEN 'break_glass'
  END;
$$;

-- ─── 2. The same rule as a set (RLS) ─────────────────────────────────────
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
  lab AS (
    SELECT 1 FROM me
    JOIN public.staff_affiliations sa ON sa.user_id = me.uid AND sa.hospital_id = me.hid
    JOIN public.cadres c ON c.id = sa.cadre_id
    WHERE sa.state IN ('active','approved') AND c.code IN ('LAB_TECH', 'LAB_TECHNOLOGIST')
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
  SELECT o.patient_user_id FROM me JOIN public.encounter_orders o
    ON o.hospital_id = me.hid AND o.kind = 'lab' AND o.created_at >= now() - interval '30 days'
   WHERE EXISTS (SELECT 1 FROM lab)
  UNION
  SELECT private.care_team_patients(me.uid, me.hid) FROM me WHERE EXISTS (SELECT 1 FROM clin)  -- 0306
  UNION
  SELECT g.patient_id FROM me JOIN public.sa_break_glass_grants g
    ON g.actor_id = me.uid AND g.revoked_at IS NULL AND g.expires_at > now()
   AND (g.hospital_id IS NULL OR g.hospital_id = me.hid);
$$;
