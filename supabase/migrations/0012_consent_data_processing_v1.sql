-- ─────────────────────────────────────────────────────────────────────────
-- 0012_consent_data_processing_v1
--
-- Seeds the first row of public.consent_versions for the
-- 'data_processing' consent type so the GATE C patient signup has an
-- active text + body_sha256 to bind acceptance to.
--
-- The body is deliberately a placeholder pending legal review (kickoff
-- §A — Q5 wants the actual approved text). When legal lands the real
-- text, INSERT a new row with supersedes_id pointing at this one;
-- never edit a shipped consent row in place (consent records must be
-- attributable to the exact text the user saw).
--
-- The body_sha256 is computed inline in this migration with
-- `encode(digest(body, 'sha256'), 'hex')` so the value can't drift
-- from the body. pgcrypto is enabled by Supabase by default; if a
-- self-hosted run fails on `digest`, install it first
-- (`CREATE EXTENSION IF NOT EXISTS pgcrypto;`).
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.consent_versions (consent_type, version, effective_date, body, body_sha256)
SELECT
  'data_processing',
  'v1.0',
  '2026-05-23'::date,
  body,
  encode(digest(body, 'sha256'), 'hex')
FROM (VALUES (
  E'PLACEHOLDER — MedSync Data Processing Notice (v1.0)\n\n' ||
  E'This is interim text pending review by counsel. By signing up you ' ||
  E'agree that MedSync may process the personal and health information ' ||
  E'you provide for the purpose of (a) creating and operating your ' ||
  E'account, (b) issuing you a patient code, (c) connecting you to ' ||
  E'partner facilities, and (d) producing aggregate, de-identified ' ||
  E'statistics for service improvement. We will not share identifying ' ||
  E'information with third parties for marketing. You can request a copy ' ||
  E'of your data or its deletion at any time by contacting support.\n\n' ||
  E'A finalised consent notice will supersede this one before any ' ||
  E'patient data is used for purposes beyond the four named above. ' ||
  E'Acceptance of this version is recorded in consent_records with the ' ||
  E'SHA-256 of this exact text so we can prove which version you saw.'
)) AS t(body)
ON CONFLICT (consent_type, version) DO NOTHING;
