-- 0290 — A cancel by the clinic is never silent (ADR 0473).
--
-- Reception can now cancel a booking (cancel-appointment). When anyone but the patient cancels, the patient gets one
-- `visit_cancelled` message, push and SMS, through the ordinary dispatcher. This migration only lets the kind into
-- notification_dispatches: 0154's list, verbatim, plus 'visit_cancelled'. No row, no policy, no other column changes.
--
-- GATED: owner-applied (`npm run db:migrate`), after 0289. Deploy cancel-appointment only after this, or a staff cancel
-- logs "visit_cancelled dispatch failed" (the cancel itself still lands).

ALTER TABLE public.notification_dispatches DROP CONSTRAINT IF EXISTS notification_dispatches_kind_check;
ALTER TABLE public.notification_dispatches ADD CONSTRAINT notification_dispatches_kind_check CHECK (kind IN (
  'booking_receipt','confirmation_request','reminder','arrival_window','waitlist_offer','session_cancelled',
  'window_shifted','position_called','payment','deterioration_flag','unconfirmed_release','sms_reply',
  'results_ready','visit_cancelled'));
