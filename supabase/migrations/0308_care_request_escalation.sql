-- GATED — applied by the owner (`npm run db:migrate`), never auto-run.
-- 0308: care request escalation, the signed response times (ADR 0536).
--
--   1. care_request_response_versions: the request clock (D4) as a signed, versioned set per hospital,
--      copied from 0102's critical_response_versions: a draft, then the hospital admin's signature, then the
--      CSO's, which puts it in force and supersedes the set before. Two different signers, or a recorded
--      exception note; at most one signed set per hospital. Minutes are whole, 1 to 2880. No number ships:
--      the set-up screen prefills a draft with D4, and nothing is in force until both have signed. With no
--      signed set there is no automatic escalation (ADR 0244 §1).
--   2. care_requests.due_at: when the first level's window ends, set at insert from the signed set
--      (lib/requests/escalation.ts clockFor); null when nothing is signed. care_requests stays append-only.
--   3. escalation_heartbeats.source gains 'care_requests' (0102:151's 'scheduler','lazy' kept verbatim): the
--      care-request run joins the lab escalation tick and records its own heartbeat.
--   4. RLS: staff of the hospital read the response times through medsync_clinical_reader; no client
--      writes (the server writes through asClinicalWriter). mfa_gate and audit.
--
-- ADDITIVE and re-runnable.
-- Reverse: drop care_request_response_versions and care_requests.due_at; restore 0102's heartbeat CHECK.

-- ─── 1. Response times: a signed, versioned set per hospital ─────────────
CREATE TABLE IF NOT EXISTS public.care_request_response_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed','superseded')),
  review_now_accept_min integer NOT NULL CHECK (review_now_accept_min BETWEEN 1 AND 2880),
  review_1h_accept_min integer NOT NULL CHECK (review_1h_accept_min BETWEEN 1 AND 2880),
  consult_urgent_accept_min integer NOT NULL CHECK (consult_urgent_accept_min BETWEEN 1 AND 2880),
  routine_reply_min integer NOT NULL CHECK (routine_reply_min BETWEEN 1 AND 2880),
  source text NOT NULL CHECK (char_length(source) BETWEEN 3 AND 500),
  authored_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  admin_signed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  admin_signed_at timestamptz,
  cso_signed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  cso_signed_at timestamptz,
  exception_note text CHECK (exception_note IS NULL OR char_length(exception_note) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CONSTRAINT crrv_version_unique UNIQUE (hospital_id, version),
  -- Signed means both signatures, by two different people; one person may sign both only with a recorded
  -- exception (as 0102's crv_signed_by_two).
  CONSTRAINT crrv_signed_by_two CHECK (status = 'draft' OR (admin_signed_by IS NOT NULL AND cso_signed_by IS NOT NULL
    AND (admin_signed_by <> cso_signed_by OR exception_note IS NOT NULL)))
);
CREATE UNIQUE INDEX IF NOT EXISTS crrv_one_signed ON public.care_request_response_versions (hospital_id)
  WHERE status = 'signed';

-- ─── 2. The request's first due time ─────────────────────────────────────
ALTER TABLE public.care_requests ADD COLUMN IF NOT EXISTS due_at timestamptz;

-- ─── 3. The heartbeat learns the care-request run ────────────────────────
ALTER TABLE public.escalation_heartbeats DROP CONSTRAINT IF EXISTS escalation_heartbeats_source_check;
ALTER TABLE public.escalation_heartbeats ADD CONSTRAINT escalation_heartbeats_source_check
  CHECK (source IN ('scheduler','lazy','care_requests'));

-- ─── 4. RLS and audit ────────────────────────────────────────────────────
ALTER TABLE public.care_request_response_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_request_response_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_request_response_versions FROM anon, authenticated;
GRANT SELECT ON public.care_request_response_versions TO medsync_clinical_reader;
DROP POLICY IF EXISTS crrv_select ON public.care_request_response_versions;
CREATE POLICY crrv_select ON public.care_request_response_versions FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id()));

-- 0288's rule for every RLS table created after it (tests/auth/mfa-below-pages.test.ts).
DROP POLICY IF EXISTS mfa_gate ON public.care_request_response_versions;
CREATE POLICY mfa_gate ON public.care_request_response_versions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));

DROP TRIGGER IF EXISTS audit_care_request_response_versions ON public.care_request_response_versions;
CREATE TRIGGER audit_care_request_response_versions AFTER INSERT OR UPDATE OR DELETE
  ON public.care_request_response_versions
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
