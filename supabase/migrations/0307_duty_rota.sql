-- GATED — applied by the owner (`npm run db:migrate`), never auto-run.
-- 0307: duty rota posts and assignments (ADR 0534).
--
--   1. duty_posts: a named post on a ward or in a department (who may hold it by cadre, its level, whether
--      it takes consults, the post it escalates to, how many hold it at once). Archived, never edited.
--      duty_assignments: one person in one post for one window [starts_at, ends_at), end exclusive, as
--      lib/rota/cover.ts. Rostered, or a cover / swap naming the assignment it replaces. Ended (with a
--      reason), never edited or deleted. The rota is what was planned, never proof of presence.
--   2. private.duty_rota_maker(): the hospital admin, or an open head of the post's department.
--   3. private.duty_assignment_guard(), copied from 0273's roster guard: a new assignment is refused, with
--      the HINTs content/duty-rota.ts words, when the post is archived or another hospital's, the actor is
--      not a rota maker (rota_maker), the person's cadre does not fit the post (rota_grade), they are on
--      approved leave in the window (rota_leave), they already hold the post then (rota_double), or the
--      post is full then (rota_full; a cover or swap does not count the assignment it replaces, which must be
--      on the same post: rota_cover). The post lock is taken before the two counts, so two concurrent
--      inserts cannot both pass. An assignment that ended early holds the post only until it ended
--      (lib/rota/cover.ts endOf); one cancelled before it started holds nothing. An end is never after
--      the planned end.
--   4. care_request_events.post_id gains its FK (0306 left it bare).
--   5. RLS: staff of the hospital read both tables through medsync_clinical_reader; no client writes
--      (the server writes through asClinicalWriter, as the pharmacy roster). mfa_gate and audit on both.
--
-- ADDITIVE and re-runnable.
-- Reverse: drop cre_post_fk, the two tables, the guards and private.duty_rota_maker.

-- ─── 1. Tables ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL REFERENCES public.hospital_departments(id) ON DELETE RESTRICT,
  ward_id uuid REFERENCES public.hospital_wards(id) ON DELETE RESTRICT,
  scope_kind text NOT NULL CONSTRAINT duty_posts_scope_kind_check CHECK (scope_kind IN ('ward','department')),
  name text NOT NULL CONSTRAINT duty_posts_name_check CHECK (char_length(name) BETWEEN 2 AND 80),
  level text NOT NULL CONSTRAINT duty_posts_level_check CHECK (level IN ('junior','senior','consultant','nurse_in_charge','allied')),
  eligible_cadres text[] NOT NULL CONSTRAINT duty_posts_cadres_check CHECK (cardinality(eligible_cadres) >= 1),
  takes_consults boolean NOT NULL DEFAULT false,
  escalates_to_post_id uuid REFERENCES public.duty_posts(id) ON DELETE RESTRICT,
  capacity smallint NOT NULL DEFAULT 1 CONSTRAINT duty_posts_capacity_check CHECK (capacity BETWEEN 1 AND 20),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT duty_posts_scope_ward CHECK ((scope_kind = 'ward') = (ward_id IS NOT NULL)),
  CONSTRAINT duty_posts_archive_shape CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);
CREATE INDEX IF NOT EXISTS duty_posts_department ON public.duty_posts (hospital_id, department_id);

CREATE TABLE IF NOT EXISTS public.duty_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  post_id uuid NOT NULL REFERENCES public.duty_posts(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  kind text NOT NULL CONSTRAINT duty_assignments_kind_check CHECK (kind IN ('rostered','cover','swap')),
  covers_assignment_id uuid REFERENCES public.duty_assignments(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  end_reason text CONSTRAINT duty_assignments_end_reason_check CHECK (char_length(end_reason) BETWEEN 2 AND 200),
  CONSTRAINT duty_assignments_window CHECK (ends_at > starts_at),
  CONSTRAINT duty_assignments_covers_shape CHECK (kind = 'rostered' OR covers_assignment_id IS NOT NULL),
  CONSTRAINT duty_assignments_end_within CHECK (ended_at <= ends_at),
  CONSTRAINT duty_assignments_end_shape CHECK (
    (ended_at IS NULL) = (ended_by IS NULL) AND (ended_at IS NULL) = (end_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS duty_assignments_post_time ON public.duty_assignments (hospital_id, post_id, starts_at);
CREATE INDEX IF NOT EXISTS duty_assignments_user_time ON public.duty_assignments (hospital_id, user_id, starts_at);

-- ─── 2. Who makes the rota ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.duty_rota_maker(p_hospital uuid, p_user uuid, p_department uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r                        -- 0117:35-37
                  WHERE r.user_id = p_user AND r.role = 'hospital_admin' AND r.hospital_id = p_hospital)
      OR EXISTS (SELECT 1 FROM public.department_heads h                  -- 0080, substantive or acting
                  WHERE h.user_id = p_user AND h.hospital_id = p_hospital AND h.department_id = p_department
                    AND h.starts_at <= now() AND (h.ends_at IS NULL OR h.ends_at > now()));
$$;
REVOKE ALL ON FUNCTION private.duty_rota_maker(uuid, uuid, uuid) FROM PUBLIC;

-- ─── 3. The guards ───────────────────────────────────────────────────────
-- Posts: archived, never edited or deleted (0265's rule).
CREATE OR REPLACE FUNCTION private.duty_post_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'duty_posts: archived, never deleted'; END IF;
  IF OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL
     OR (to_jsonb(NEW) - 'archived_at' - 'archived_by') <> (to_jsonb(OLD) - 'archived_at' - 'archived_by') THEN
    RAISE EXCEPTION 'duty_posts: only archiving a post changes it';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS duty_posts_guard ON public.duty_posts;
CREATE TRIGGER duty_posts_guard BEFORE UPDATE OR DELETE ON public.duty_posts
  FOR EACH ROW EXECUTE FUNCTION private.duty_post_guard();

-- Assignments: the rules on insert (0273:384-436), and ending as the only change (0265's rule).
CREATE OR REPLACE FUNCTION private.duty_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  p public.duty_posts; taken int;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'duty_assignments: ended, never deleted'; END IF;
  SELECT * INTO p FROM public.duty_posts WHERE id = NEW.post_id;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
       OR (to_jsonb(NEW) - 'ended_at' - 'ended_by' - 'end_reason') <> (to_jsonb(OLD) - 'ended_at' - 'ended_by' - 'end_reason') THEN
      RAISE EXCEPTION 'duty_assignments: only ending an assignment changes it' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT private.duty_rota_maker(NEW.hospital_id, NEW.ended_by, p.department_id) THEN
      RAISE EXCEPTION 'duty_assignments: you are not making this rota' USING ERRCODE = 'check_violation', HINT = 'rota_maker';
    END IF;
    RETURN NEW;
  END IF;

  IF p.id IS NULL OR p.hospital_id <> NEW.hospital_id OR p.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'duty_assignments: the post is archived or not this hospital''s' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.covers_assignment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.duty_assignments c WHERE c.id = NEW.covers_assignment_id AND c.post_id = NEW.post_id) THEN
    RAISE EXCEPTION 'duty_assignments: a cover or swap replaces a duty on the same post'
      USING ERRCODE = 'check_violation', HINT = 'rota_cover';
  END IF;
  IF NOT private.duty_rota_maker(NEW.hospital_id, NEW.created_by, p.department_id) THEN
    RAISE EXCEPTION 'duty_assignments: you are not making this rota' USING ERRCODE = 'check_violation', HINT = 'rota_maker';
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
DROP TRIGGER IF EXISTS duty_assignments_guard ON public.duty_assignments;
CREATE TRIGGER duty_assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON public.duty_assignments
  FOR EACH ROW EXECUTE FUNCTION private.duty_assignment_guard();

-- ─── 4. care_request_events.post_id → duty_posts ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cre_post_fk') THEN
    ALTER TABLE public.care_request_events ADD CONSTRAINT cre_post_fk
      FOREIGN KEY (post_id) REFERENCES public.duty_posts(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── 5. RLS and audit ────────────────────────────────────────────────────
ALTER TABLE public.duty_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_posts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.duty_posts FROM anon, authenticated;
GRANT SELECT ON public.duty_posts TO medsync_clinical_reader;
DROP POLICY IF EXISTS duty_posts_select ON public.duty_posts;
CREATE POLICY duty_posts_select ON public.duty_posts FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id()));

ALTER TABLE public.duty_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.duty_assignments FROM anon, authenticated;
GRANT SELECT ON public.duty_assignments TO medsync_clinical_reader;
DROP POLICY IF EXISTS duty_assignments_select ON public.duty_assignments;
CREATE POLICY duty_assignments_select ON public.duty_assignments FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id()));

-- 0288's rule for every RLS table created after it (tests/auth/mfa-below-pages.test.ts).
DROP POLICY IF EXISTS mfa_gate ON public.duty_posts;
CREATE POLICY mfa_gate ON public.duty_posts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));
DROP POLICY IF EXISTS mfa_gate ON public.duty_assignments;
CREATE POLICY mfa_gate ON public.duty_assignments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.caller_mfa_ok())) WITH CHECK ((SELECT public.caller_mfa_ok()));

DROP TRIGGER IF EXISTS audit_duty_posts ON public.duty_posts;
CREATE TRIGGER audit_duty_posts AFTER INSERT OR UPDATE OR DELETE ON public.duty_posts
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
DROP TRIGGER IF EXISTS audit_duty_assignments ON public.duty_assignments;
CREATE TRIGGER audit_duty_assignments AFTER INSERT OR UPDATE OR DELETE ON public.duty_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
