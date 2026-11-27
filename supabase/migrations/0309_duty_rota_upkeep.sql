-- GATED — applied by the owner (`npm run db:migrate`), never auto-run.
-- 0309: duty rota upkeep: templates, publish and unlock, cover and swap, delegates (ADR 0538).
--
--   1. duty_rota_templates: a week template line (post, weekdays 1–7, shift, maybe a person), as
--      lib/rota/templates.ts. Ended, never edited or deleted (0265's rule); written by a rota maker.
--   2. duty_rota_delegates: the admin or an open head hands a department's rota to a colleague, until a
--      day or until revoked, with or without publish rights, to live staff of the hospital, one active
--      delegation per person per department. Revoked, never deleted. A delegate does not pass it on, and
--      the delegation lapses when its grantor is no longer the admin or a head of that department (R49).
--   3. private.duty_rota_maker() gains p_publish (DEFAULT false) and the active delegate. The three-argument
--      version is DROPPED first (R8): a second overload would make every three-argument call ambiguous.
--      0307's guard, lib/rota/write.ts and the tests keep calling it with three arguments, through the default.
--      private.duty_rota_owner() is 0307's rule (the admin, or an open head), which only an owner passes.
--   4. duty_rota_week_events: publish and unlock per department week (ISO Monday), append-only; a week's
--      state is its latest event (lib/rota/templates.ts weekPublished). Only a rota maker with publish
--      rights writes one; an unlock gives its reason. private.duty_week_published() reads it.
--   5. private.duty_assignment_guard(), replaced: 0307's rules unchanged, plus inserting into or ending a
--      duty in a published week is refused (rota_locked), unless an approved request makes the change
--      (duty.rota_via = 'request', 0273's pattern), and then only for a cover-shaped write: an insert naming
--      the duty it covers, an end with reason 'covered' (R48). That path still passes every other rule. The
--      guard holds the department week's advisory key shared before the check; publishing takes it
--      exclusively (R50).
--   6. duty_swap_requests and duty_swap_request_events: the holder asks a colleague to cover a duty, or to
--      swap it for the colleague's duty on the same post (R35). The colleague accepts or declines, a rota
--      maker approves (only after acceptance) or refuses, the asker may withdraw; the state is the events,
--      both append-only. Approval ends the asked duty ('covered') and writes the colleague's cover or swap
--      in the same statement, and for a swap the mirror pair; all or nothing.
--   7. RLS: staff of the hospital read every new table through medsync_clinical_reader; no client writes
--      (the server writes through asClinicalWriter). mfa_gate and audit on every table.
--
-- ADDITIVE and re-runnable.
-- Reverse: drop the five tables and their guards, private.duty_week_published and private.duty_rota_owner;
-- restore 0307's duty_rota_maker(uuid, uuid, uuid) and duty_assignment_guard.

-- ─── 1. Templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_rota_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.hospital_departments(id) ON DELETE RESTRICT,
  post_id uuid NOT NULL REFERENCES public.duty_posts(id) ON DELETE RESTRICT,
  weekdays smallint[] NOT NULL CONSTRAINT duty_rota_templates_weekdays_check
    CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  shift text NOT NULL CONSTRAINT duty_rota_templates_shift_check CHECK (shift IN ('day','night','day24','week')),
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT duty_rota_templates_end_shape CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);
CREATE INDEX IF NOT EXISTS duty_rota_templates_department ON public.duty_rota_templates (hospital_id, department_id);

-- ─── 2. Delegates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_rota_delegates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.hospital_departments(id) ON DELETE RESTRICT,
  from_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  to_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  can_publish boolean NOT NULL DEFAULT false,
  until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT duty_rota_delegates_self CHECK (from_user <> to_user),
  CONSTRAINT duty_rota_delegates_revoke_shape CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
-- One active delegation per person per department (0273's prd_one); revoke it to hand over anew.
CREATE UNIQUE INDEX IF NOT EXISTS duty_rota_delegates_one
  ON public.duty_rota_delegates (hospital_id, department_id, to_user) WHERE revoked_at IS NULL;

-- ─── 3. Who makes the rota ───────────────────────────────────────────────
-- 0307's rule, unchanged: the hospital admin, or an open head (substantive or acting) of the department.
CREATE OR REPLACE FUNCTION private.duty_rota_owner(p_hospital uuid, p_user uuid, p_department uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r
                  WHERE r.user_id = p_user AND r.role = 'hospital_admin' AND r.hospital_id = p_hospital)
      OR EXISTS (SELECT 1 FROM public.department_heads h
                  WHERE h.user_id = p_user AND h.hospital_id = p_hospital AND h.department_id = p_department
                    AND h.starts_at <= now() AND (h.ends_at IS NULL OR h.ends_at > now()));
$$;
REVOKE ALL ON FUNCTION private.duty_rota_owner(uuid, uuid, uuid) FROM PUBLIC;

-- R8: one function, never two overloads.
DROP FUNCTION IF EXISTS private.duty_rota_maker(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION private.duty_rota_maker(p_hospital uuid, p_user uuid, p_department uuid,
  p_publish boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT private.duty_rota_owner(p_hospital, p_user, p_department)
      OR EXISTS (SELECT 1 FROM public.duty_rota_delegates d
                  WHERE d.hospital_id = p_hospital AND d.department_id = p_department AND d.to_user = p_user
                    AND d.revoked_at IS NULL
                    AND private.duty_rota_owner(d.hospital_id, d.from_user, d.department_id)
                    AND (d.until IS NULL OR d.until >= (now() AT TIME ZONE 'Africa/Kampala')::date)
                    AND (NOT p_publish OR d.can_publish));
$$;
REVOKE ALL ON FUNCTION private.duty_rota_maker(uuid, uuid, uuid, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.duty_delegate_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'duty_rota_delegates: revoked, never deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT private.duty_rota_owner(NEW.hospital_id, NEW.from_user, NEW.department_id) THEN
      RAISE EXCEPTION 'duty_rota_delegates: only the admin or the head hands the rota over'
        USING ERRCODE = 'check_violation', HINT = 'rota_maker';
    END IF;
    IF NEW.until IS NOT NULL AND NEW.until < (now() AT TIME ZONE 'Africa/Kampala')::date THEN
      RAISE EXCEPTION 'duty_rota_delegates: the end date has passed' USING ERRCODE = 'check_violation', HINT = 'rota_delegate_until';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff_affiliations sa
                    WHERE sa.user_id = NEW.to_user AND sa.hospital_id = NEW.hospital_id
                      AND sa.state IN ('active','approved')) THEN
      RAISE EXCEPTION 'duty_rota_delegates: only live staff of this hospital make its rota' USING ERRCODE = 'check_violation', HINT = 'rota_delegate_staff';
    END IF;
    -- The unique index is the backstop; this gives the usual case its words.
    IF EXISTS (SELECT 1 FROM public.duty_rota_delegates d WHERE d.hospital_id = NEW.hospital_id
                AND d.department_id = NEW.department_id AND d.to_user = NEW.to_user AND d.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'duty_rota_delegates: they already have this rota handed over' USING ERRCODE = 'check_violation', HINT = 'rota_delegate_dup';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
     OR (to_jsonb(NEW) - 'revoked_at' - 'revoked_by') <> (to_jsonb(OLD) - 'revoked_at' - 'revoked_by') THEN
    RAISE EXCEPTION 'duty_rota_delegates: only revoking changes it' USING ERRCODE = 'check_violation', HINT = 'rota_changed';
  END IF;
  IF NOT private.duty_rota_owner(NEW.hospital_id, NEW.revoked_by, NEW.department_id) THEN
    RAISE EXCEPTION 'duty_rota_delegates: only the admin or the head revokes'
      USING ERRCODE = 'check_violation', HINT = 'rota_maker';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS duty_rota_delegates_guard ON public.duty_rota_delegates;
CREATE TRIGGER duty_rota_delegates_guard BEFORE INSERT OR UPDATE OR DELETE ON public.duty_rota_delegates
  FOR EACH ROW EXECUTE FUNCTION private.duty_delegate_guard();

-- Templates: written by a rota maker, for a live post of that department; ending is the only change.
CREATE OR REPLACE FUNCTION private.duty_template_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'duty_rota_templates: ended, never deleted'; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
     OR (to_jsonb(NEW) - 'ended_at' - 'ended_by') <> (to_jsonb(OLD) - 'ended_at' - 'ended_by')) THEN
    RAISE EXCEPTION 'duty_rota_templates: only ending a line changes it' USING ERRCODE = 'check_violation', HINT = 'rota_changed';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.duty_posts p
       WHERE p.id = NEW.post_id AND p.hospital_id = NEW.hospital_id AND p.department_id = NEW.department_id
         AND p.archived_at IS NULL) THEN
    RAISE EXCEPTION 'duty_rota_templates: the post is archived or not this department''s' USING ERRCODE = 'check_violation', HINT = 'rota_post';
  END IF;
  IF NOT private.duty_rota_maker(NEW.hospital_id,
       CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by ELSE NEW.ended_by END, NEW.department_id) THEN
    RAISE EXCEPTION 'duty_rota_templates: you are not making this rota' USING ERRCODE = 'check_violation', HINT = 'rota_maker';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS duty_rota_templates_guard ON public.duty_rota_templates;
CREATE TRIGGER duty_rota_templates_guard BEFORE INSERT OR UPDATE OR DELETE ON public.duty_rota_templates
  FOR EACH ROW EXECUTE FUNCTION private.duty_template_guard();

-- ─── 4. Publishing ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_rota_week_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.hospital_departments(id) ON DELETE RESTRICT,
  week_start date NOT NULL CONSTRAINT duty_rota_week_events_week_start_check CHECK (extract(isodow FROM week_start) = 1),
  kind text NOT NULL CONSTRAINT duty_rota_week_events_kind_check CHECK (kind IN ('publish','unlock')),
  reason text CONSTRAINT duty_rota_week_events_reason_length CHECK (char_length(reason) BETWEEN 2 AND 300),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duty_rota_week_events_reason CHECK (kind <> 'unlock' OR reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS duty_rota_week_events_latest
  ON public.duty_rota_week_events (hospital_id, department_id, week_start, at DESC);

-- The week an instant falls in is the Kampala Monday on or before it (a Sunday night is its own week's).
CREATE OR REPLACE FUNCTION private.duty_week_published(p_hospital uuid, p_department uuid, p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT e.kind = 'publish' FROM public.duty_rota_week_events e
                    WHERE e.hospital_id = p_hospital AND e.department_id = p_department
                      AND e.week_start = date_trunc('week', p_at AT TIME ZONE 'Africa/Kampala')::date
                    ORDER BY e.at DESC LIMIT 1), false);
$$;
REVOKE ALL ON FUNCTION private.duty_week_published(uuid, uuid, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.duty_week_event_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE published boolean;
BEGIN
  IF NOT private.duty_rota_maker(NEW.hospital_id, NEW.actor_id, NEW.department_id, true) THEN
    RAISE EXCEPTION 'duty_rota_week_events: only the admin, the head or a delegate who can publish'
      USING ERRCODE = 'check_violation', HINT = 'rota_maker';
  END IF;
  -- One department week's events run one at a time, so the state read below cannot race.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.department_id::text || NEW.week_start::text));
  published := coalesce((SELECT e.kind = 'publish' FROM public.duty_rota_week_events e
                           WHERE e.hospital_id = NEW.hospital_id AND e.department_id = NEW.department_id
                             AND e.week_start = NEW.week_start ORDER BY e.at DESC LIMIT 1), false);
  IF (NEW.kind = 'publish') = published THEN
    RAISE EXCEPTION 'duty_rota_week_events: the week is already %', CASE WHEN published THEN 'published' ELSE 'a draft' END
      USING ERRCODE = 'check_violation', HINT = 'rota_week_state';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS duty_rota_week_events_guard ON public.duty_rota_week_events;
CREATE TRIGGER duty_rota_week_events_guard BEFORE INSERT ON public.duty_rota_week_events
  FOR EACH ROW EXECUTE FUNCTION private.duty_week_event_guard();

-- ─── 5. The assignment guard, with the week lock ─────────────────────────
-- 0307's body verbatim, plus rota_locked after the maker check on both paths.
CREATE OR REPLACE FUNCTION private.duty_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  p public.duty_posts; taken int;
  via boolean := coalesce(current_setting('duty.rota_via', true) = 'request', false);
  wk date := date_trunc('week', NEW.starts_at AT TIME ZONE 'Africa/Kampala')::date;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'duty_assignments: ended, never deleted'; END IF;
  SELECT * INTO p FROM public.duty_posts WHERE id = NEW.post_id;
  -- R50: the department week's key, shared; publishing takes it exclusively, so a publish waits for
  -- writes in flight and no write lands in a week that is being published.
  PERFORM pg_advisory_xact_lock_shared(hashtext(p.department_id::text || wk::text));
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
       OR (to_jsonb(NEW) - 'ended_at' - 'ended_by' - 'end_reason') <> (to_jsonb(OLD) - 'ended_at' - 'ended_by' - 'end_reason') THEN
      RAISE EXCEPTION 'duty_assignments: only ending an assignment changes it' USING ERRCODE = 'check_violation', HINT = 'rota_changed';
    END IF;
    IF NOT private.duty_rota_maker(NEW.hospital_id, NEW.ended_by, p.department_id) THEN
      RAISE EXCEPTION 'duty_assignments: you are not making this rota' USING ERRCODE = 'check_violation', HINT = 'rota_maker';
    END IF;
    -- R48: the request path only ends a duty as covered.
    IF NOT (via AND NEW.end_reason = 'covered')
       AND private.duty_week_published(NEW.hospital_id, p.department_id, NEW.starts_at) THEN
      RAISE EXCEPTION 'duty_assignments: this week is published' USING ERRCODE = 'check_violation', HINT = 'rota_locked';
    END IF;
    RETURN NEW;
  END IF;

  IF p.id IS NULL OR p.hospital_id <> NEW.hospital_id OR p.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'duty_assignments: the post is archived or not this hospital''s' USING ERRCODE = 'check_violation', HINT = 'rota_post';
  END IF;
  IF NEW.covers_assignment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.duty_assignments c WHERE c.id = NEW.covers_assignment_id AND c.post_id = NEW.post_id) THEN
    RAISE EXCEPTION 'duty_assignments: a cover or swap replaces a duty on the same post'
      USING ERRCODE = 'check_violation', HINT = 'rota_cover';
  END IF;
  IF NOT private.duty_rota_maker(NEW.hospital_id, NEW.created_by, p.department_id) THEN
    RAISE EXCEPTION 'duty_assignments: you are not making this rota' USING ERRCODE = 'check_violation', HINT = 'rota_maker';
  END IF;
  -- R48: the request path only writes a cover or swap.
  IF NOT (via AND NEW.covers_assignment_id IS NOT NULL)
     AND private.duty_week_published(NEW.hospital_id, p.department_id, NEW.starts_at) THEN
    RAISE EXCEPTION 'duty_assignments: this week is published' USING ERRCODE = 'check_violation', HINT = 'rota_locked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_affiliations sa JOIN public.cadres c ON c.id = sa.cadre_id
                  WHERE sa.user_id = NEW.user_id AND sa.hospital_id = NEW.hospital_id
                    AND sa.state IN ('active','approved') AND c.code = ANY (p.eligible_cadres)) THEN
    RAISE EXCEPTION 'duty_assignments: their grade does not fit this post' USING ERRCODE = 'check_violation', HINT = 'rota_grade';
  END IF;
  -- shortcut: one-off leave only (recurrence is ignored); upgrade if weekly leave blocks are ever used.
  IF EXISTS (SELECT 1 FROM public.availability_blocks l
              WHERE l.hospital_id = NEW.hospital_id AND l.clinician_user_id = NEW.user_id
                AND l.kind = 'leave' AND l.state = 'active'
                AND l.starts_at < NEW.ends_at AND NEW.starts_at < l.ends_at) THEN
    RAISE EXCEPTION 'duty_assignments: on leave during this duty' USING ERRCODE = 'check_violation', HINT = 'rota_leave';
  END IF;

  -- One post's inserts run one at a time from here, so the counts below cannot race (0273's lock).
  PERFORM pg_advisory_xact_lock(hashtext(NEW.post_id::text));
  -- Overlap is half-open; an assignment holds [starts_at, least(ends_at, ended_at)), and nothing when
  -- that is empty (cancelled before it started). least() ignores a NULL ended_at.
  IF EXISTS (SELECT 1 FROM public.duty_assignments a
              WHERE a.post_id = NEW.post_id AND a.user_id = NEW.user_id
                AND a.starts_at < NEW.ends_at AND NEW.starts_at < least(a.ends_at, a.ended_at)
                AND a.starts_at < least(a.ends_at, a.ended_at)) THEN
    RAISE EXCEPTION 'duty_assignments: they already hold this post at that time' USING ERRCODE = 'check_violation', HINT = 'rota_double';
  END IF;
  SELECT count(*) INTO taken FROM public.duty_assignments a
   WHERE a.post_id = NEW.post_id
     AND a.starts_at < NEW.ends_at AND NEW.starts_at < least(a.ends_at, a.ended_at)
     AND a.starts_at < least(a.ends_at, a.ended_at)
     AND a.id IS DISTINCT FROM NEW.covers_assignment_id;
  IF taken >= p.capacity THEN
    RAISE EXCEPTION 'duty_assignments: this post is full at that time' USING ERRCODE = 'check_violation', HINT = 'rota_full';
  END IF;
  RETURN NEW;
END $$;
-- 0307's trigger (duty_assignments_guard) already calls this function; nothing to re-create.

-- ─── 6. Cover and swap requests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  kind text NOT NULL CONSTRAINT duty_swap_requests_kind_check CHECK (kind IN ('cover','swap')),
  assignment_id uuid NOT NULL REFERENCES public.duty_assignments(id) ON DELETE RESTRICT,
  asked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  colleague_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  swap_assignment_id uuid REFERENCES public.duty_assignments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duty_swap_requests_colleague CHECK (colleague_user_id <> asked_by),
  CONSTRAINT duty_swap_requests_swap_shape CHECK ((kind = 'swap') = (swap_assignment_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS duty_swap_requests_assignment ON public.duty_swap_requests (hospital_id, assignment_id);

CREATE TABLE IF NOT EXISTS public.duty_swap_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.duty_swap_requests(id) ON DELETE RESTRICT,
  kind text NOT NULL CONSTRAINT duty_swap_request_events_kind_check
    CHECK (kind IN ('accepted','declined','approved','refused','withdrawn')),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text CONSTRAINT duty_swap_request_events_reason_check CHECK (char_length(reason) BETWEEN 2 AND 300),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS duty_swap_request_events_request ON public.duty_swap_request_events (request_id, at);

-- Asked by the holder of a live duty; a swap names the colleague's duty on the same post (R35).
CREATE OR REPLACE FUNCTION private.duty_swap_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE a public.duty_assignments;
BEGIN
  SELECT * INTO a FROM public.duty_assignments WHERE id = NEW.assignment_id;
  IF a.id IS NULL OR a.hospital_id <> NEW.hospital_id OR a.user_id <> NEW.asked_by OR a.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'duty_swap_requests: only the holder of a live duty asks' USING ERRCODE = 'check_violation', HINT = 'rota_holder';
  END IF;
  IF NEW.kind = 'swap' AND NEW.swap_assignment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.duty_assignments s
        WHERE s.id = NEW.swap_assignment_id AND s.user_id = NEW.colleague_user_id AND s.post_id = a.post_id
          AND s.ended_at IS NULL) THEN
    RAISE EXCEPTION 'duty_swap_requests: a swap names the colleague''s duty on the same post'
      USING ERRCODE = 'check_violation', HINT = 'rota_cover';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS duty_swap_requests_guard ON public.duty_swap_requests;
CREATE TRIGGER duty_swap_requests_guard BEFORE INSERT ON public.duty_swap_requests
  FOR EACH ROW EXECUTE FUNCTION private.duty_swap_request_guard();

-- The colleague answers first, then a rota maker; the asker may withdraw an open request. Declined,
-- approved, refused and withdrawn are final. Approval changes the rota in this statement.
CREATE OR REPLACE FUNCTION private.duty_swap_event_apply() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r public.duty_swap_requests; a public.duty_assignments; dept uuid;
  accepted boolean; final boolean; ok boolean; x record;
BEGIN
  -- One request's events run one at a time, so the state read below cannot race.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.request_id::text));
  SELECT * INTO r FROM public.duty_swap_requests WHERE id = NEW.request_id;
  SELECT * INTO a FROM public.duty_assignments WHERE id = r.assignment_id;
  SELECT department_id INTO dept FROM public.duty_posts WHERE id = a.post_id;
  SELECT coalesce(bool_or(e.kind = 'accepted'), false),
         coalesce(bool_or(e.kind IN ('declined','approved','refused','withdrawn')), false)
    INTO accepted, final
    FROM public.duty_swap_request_events e WHERE e.request_id = r.id;
  ok := NOT final AND CASE NEW.kind
    WHEN 'accepted' THEN NEW.actor_id = r.colleague_user_id AND NOT accepted
    WHEN 'declined' THEN NEW.actor_id = r.colleague_user_id AND NOT accepted
    WHEN 'approved' THEN accepted AND private.duty_rota_maker(r.hospital_id, NEW.actor_id, dept)
    WHEN 'refused' THEN private.duty_rota_maker(r.hospital_id, NEW.actor_id, dept)
    WHEN 'withdrawn' THEN NEW.actor_id = r.asked_by
    ELSE false END;
  IF NOT ok THEN
    RAISE EXCEPTION 'duty_swap_requests: % is not allowed now, or not by you', NEW.kind
      USING ERRCODE = 'check_violation', HINT = 'request_state';
  END IF;
  IF NEW.kind = 'approved' THEN
    -- The duty guard still checks grade, leave, double booking, room and the same post; only the week lock
    -- gives way. Each old duty ends where the new one starts: its start if still ahead, else now.
    PERFORM set_config('duty.rota_via', 'request', true);
    FOR x IN SELECT d.*, CASE WHEN d.id = r.assignment_id THEN r.colleague_user_id ELSE r.asked_by END AS taker,
                    greatest(d.starts_at, now()) AS cut
               FROM public.duty_assignments d WHERE d.id IN (r.assignment_id, r.swap_assignment_id) LOOP
      IF x.ended_at IS NOT NULL OR x.cut >= x.ends_at THEN
        RAISE EXCEPTION 'duty_swap_requests: the duty has ended' USING ERRCODE = 'check_violation', HINT = 'request_state';
      END IF;
      UPDATE public.duty_assignments SET ended_at = x.cut, ended_by = NEW.actor_id, end_reason = 'covered' WHERE id = x.id;
    END LOOP;
    FOR x IN SELECT d.*, CASE WHEN d.id = r.assignment_id THEN r.colleague_user_id ELSE r.asked_by END AS taker
               FROM public.duty_assignments d WHERE d.id IN (r.assignment_id, r.swap_assignment_id) LOOP
      INSERT INTO public.duty_assignments (hospital_id, post_id, user_id, starts_at, ends_at, kind,
        covers_assignment_id, created_by)
      VALUES (x.hospital_id, x.post_id, x.taker, x.ended_at, x.ends_at, r.kind, x.id, NEW.actor_id);
    END LOOP;
    PERFORM set_config('duty.rota_via', '', true);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS duty_swap_request_events_apply ON public.duty_swap_request_events;
CREATE TRIGGER duty_swap_request_events_apply BEFORE INSERT ON public.duty_swap_request_events
  FOR EACH ROW EXECUTE FUNCTION private.duty_swap_event_apply();

-- ─── 7. Append-only, RLS and audit ───────────────────────────────────────
DROP TRIGGER IF EXISTS duty_rota_week_events_append_only ON public.duty_rota_week_events;
CREATE TRIGGER duty_rota_week_events_append_only BEFORE UPDATE OR DELETE ON public.duty_rota_week_events
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS duty_swap_requests_append_only ON public.duty_swap_requests;
CREATE TRIGGER duty_swap_requests_append_only BEFORE UPDATE OR DELETE ON public.duty_swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();
DROP TRIGGER IF EXISTS duty_swap_request_events_append_only ON public.duty_swap_request_events;
CREATE TRIGGER duty_swap_request_events_append_only BEFORE UPDATE OR DELETE ON public.duty_swap_request_events
  FOR EACH ROW EXECUTE FUNCTION public.block_modify_append_only();

ALTER TABLE public.duty_rota_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_rota_templates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.duty_rota_templates FROM anon, authenticated;
GRANT SELECT ON public.duty_rota_templates TO medsync_clinical_reader;
DROP POLICY IF EXISTS duty_rota_templates_select ON public.duty_rota_templates;
CREATE POLICY duty_rota_templates_select ON public.duty_rota_templates FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id()));

ALTER TABLE public.duty_rota_delegates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_rota_delegates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.duty_rota_delegates FROM anon, authenticated;
GRANT SELECT ON public.duty_rota_delegates TO medsync_clinical_reader;
DROP POLICY IF EXISTS duty_rota_delegates_select ON public.duty_rota_delegates;
CREATE POLICY duty_rota_delegates_select ON public.duty_rota_delegates FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id()));

ALTER TABLE public.duty_rota_week_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_rota_week_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.duty_rota_week_events FROM anon, authenticated;
GRANT SELECT ON public.duty_rota_week_events TO medsync_clinical_reader;
DROP POLICY IF EXISTS duty_rota_week_events_select ON public.duty_rota_week_events;
CREATE POLICY duty_rota_week_events_select ON public.duty_rota_week_events FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id()));

ALTER TABLE public.duty_swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_swap_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.duty_swap_requests FROM anon, authenticated;
GRANT SELECT ON public.duty_swap_requests TO medsync_clinical_reader;
DROP POLICY IF EXISTS duty_swap_requests_select ON public.duty_swap_requests;
CREATE POLICY duty_swap_requests_select ON public.duty_swap_requests FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id()));

ALTER TABLE public.duty_swap_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_swap_request_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.duty_swap_request_events FROM anon, authenticated;
GRANT SELECT ON public.duty_swap_request_events TO medsync_clinical_reader;
DROP POLICY IF EXISTS duty_swap_request_events_select ON public.duty_swap_request_events;
CREATE POLICY duty_swap_request_events_select ON public.duty_swap_request_events FOR SELECT TO medsync_clinical_reader
  USING (EXISTS (SELECT 1 FROM public.duty_swap_requests r
                  WHERE r.id = request_id AND r.hospital_id = (SELECT private.current_hospital_id())));

-- 0288's rule for every RLS table created after it (tests/auth/mfa-below-pages.test.ts).
DROP POLICY IF EXISTS mfa_gate ON public.duty_rota_templates;
CREATE POLICY mfa_gate ON public.duty_rota_templates AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));
DROP POLICY IF EXISTS mfa_gate ON public.duty_rota_delegates;
CREATE POLICY mfa_gate ON public.duty_rota_delegates AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));
DROP POLICY IF EXISTS mfa_gate ON public.duty_rota_week_events;
CREATE POLICY mfa_gate ON public.duty_rota_week_events AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));
DROP POLICY IF EXISTS mfa_gate ON public.duty_swap_requests;
CREATE POLICY mfa_gate ON public.duty_swap_requests AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));
DROP POLICY IF EXISTS mfa_gate ON public.duty_swap_request_events;
CREATE POLICY mfa_gate ON public.duty_swap_request_events AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));

DROP TRIGGER IF EXISTS audit_duty_rota_templates ON public.duty_rota_templates;
CREATE TRIGGER audit_duty_rota_templates AFTER INSERT OR UPDATE OR DELETE ON public.duty_rota_templates
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
DROP TRIGGER IF EXISTS audit_duty_rota_delegates ON public.duty_rota_delegates;
CREATE TRIGGER audit_duty_rota_delegates AFTER INSERT OR UPDATE OR DELETE ON public.duty_rota_delegates
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
DROP TRIGGER IF EXISTS audit_duty_rota_week_events ON public.duty_rota_week_events;
CREATE TRIGGER audit_duty_rota_week_events AFTER INSERT OR UPDATE OR DELETE ON public.duty_rota_week_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
DROP TRIGGER IF EXISTS audit_duty_swap_requests ON public.duty_swap_requests;
CREATE TRIGGER audit_duty_swap_requests AFTER INSERT OR UPDATE OR DELETE ON public.duty_swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
DROP TRIGGER IF EXISTS audit_duty_swap_request_events ON public.duty_swap_request_events;
CREATE TRIGGER audit_duty_swap_request_events AFTER INSERT OR UPDATE OR DELETE ON public.duty_swap_request_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
