-- 0283 — Protocol charts (prescribing kit P4, F7–F8): a running protocol for one patient, and its
-- append-only log of what was done on it.
--
-- GATED: owner-applied (`npm run db:migrate`), after 0279–0282. Until it runs, the Protocols area
-- cannot load (PRESCRIBE_V2's other parts are unchanged).
--
--   1. protocol_charts: one row a chart: patient, encounter, the protocol version it runs under,
--      when it started and who started it. `ended_at` / `end_reason` / `reopened_at` mirror the
--      latest end or reopen event so the "Protocols running" lists read one row; the events are the
--      record. One running chart per patient per protocol (partial unique index). A chart starts
--      only from a SIGNED version (P1 [DB], trigger), unless the server opened the transaction with
--      `medsync.protocol_draft_start = 'on'`, which it does only in local development and tests
--      (`canStart`, lib/protocols/quick.ts: never in a production build, never on any Vercel
--      deployment). Never deleted; only the three mirror columns change.
--   2. protocol_chart_events: append-only (P3 [DB]): type, payload, actor (user, role dr/rn/ph,
--      cadre), server time, the version id (P4: on every event), an idempotency key (the offline
--      outbox). A trigger refuses UPDATE and DELETE; a mistake is fixed by a `reverse` event naming
--      the event it undoes, with a reason, at most once. Slot observations, vitals sets, monitoring
--      parameters and notes are event types here (one log, one correction rule); the values with a
--      record concept are also written to clinical_observations, tagged in `context` with
--      `protocolChartId` (FEATURES §5 default: reuse the vitals table, tagged with the chart).
--   3. The DKA seed's named numbers (FEATURES.md §2.1 and the prototype's reference ranges), into
--      the DKA seed version's `seed` (still DRAFT, unsigned: 0282's trigger allows the change). The
--      other nine keep `{}` until their P5 rule modules land.
--
-- RLS: both tables forced; the clinical reader's scoped SELECT (own hospital, accessible patients,
-- as 0281); no client writes (the server writes as the owner, as every EMR table). ADDITIVE and
-- re-runnable. Reverse: drop the two tables and the three trigger functions; set the DKA seed back
-- to '{}'.

-- ─── 1. protocol_charts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.protocol_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  encounter_id uuid REFERENCES public.encounters(id) ON DELETE RESTRICT,
  protocol_id text NOT NULL REFERENCES public.protocols(id) ON DELETE RESTRICT,
  protocol_version_id uuid NOT NULL REFERENCES public.protocol_versions(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  ended_at timestamptz,
  end_reason text CHECK (end_reason IS NULL OR length(end_reason) BETWEEN 2 AND 300),
  reopened_at timestamptz,
  client_key text,
  CONSTRAINT protocol_charts_end_whole CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_charts_client_key
  ON public.protocol_charts (client_key) WHERE client_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS protocol_charts_one_running
  ON public.protocol_charts (patient_user_id, protocol_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS protocol_charts_running
  ON public.protocol_charts (hospital_id, started_at) WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION public.protocol_charts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_protocol text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'protocol charts are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT status, protocol_id INTO v_status, v_protocol
      FROM public.protocol_versions WHERE id = NEW.protocol_version_id;
    IF v_protocol IS DISTINCT FROM NEW.protocol_id THEN
      RAISE EXCEPTION 'the chart names another protocol than its version' USING ERRCODE = 'check_violation';
    END IF;
    IF v_status <> 'signed'
       AND coalesce(current_setting('medsync.protocol_draft_start', true), '') <> 'on' THEN
      RAISE EXCEPTION 'a protocol chart starts only from a signed version' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.hospital_id, NEW.patient_user_id, NEW.encounter_id, NEW.protocol_id,
      NEW.protocol_version_id, NEW.started_at, NEW.started_by_user_id, NEW.client_key)
     IS DISTINCT FROM
     (OLD.id, OLD.hospital_id, OLD.patient_user_id, OLD.encounter_id, OLD.protocol_id,
      OLD.protocol_version_id, OLD.started_at, OLD.started_by_user_id, OLD.client_key) THEN
    RAISE EXCEPTION 'a protocol chart keeps what it started with' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protocol_charts_guard ON public.protocol_charts;
CREATE TRIGGER protocol_charts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.protocol_charts
  FOR EACH ROW EXECUTE FUNCTION public.protocol_charts_guard();
DROP TRIGGER IF EXISTS audit_protocol_charts ON public.protocol_charts;
CREATE TRIGGER audit_protocol_charts AFTER INSERT OR UPDATE OR DELETE ON public.protocol_charts
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

-- ─── 2. protocol_chart_events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.protocol_chart_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id uuid NOT NULL REFERENCES public.protocol_charts(id) ON DELETE RESTRICT,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  patient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  protocol_version_id uuid NOT NULL REFERENCES public.protocol_versions(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN (
    'start','end','reopen','mark','give','set','toggle','inv','value','weight','iv','order','send',
    'slot','vitals','param_add','param_remove','note','reverse')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_role text NOT NULL CHECK (actor_role IN ('dr','rn','ph')),
  actor_cadre text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  reverses_id uuid REFERENCES public.protocol_chart_events(id) ON DELETE RESTRICT,
  reason text,
  client_key text,
  CONSTRAINT protocol_chart_events_reverse_shape CHECK (
    (type = 'reverse') = (reverses_id IS NOT NULL)
    AND (type <> 'reverse' OR length(btrim(coalesce(reason, ''))) >= 3))
);
CREATE INDEX IF NOT EXISTS protocol_chart_events_chart ON public.protocol_chart_events (chart_id, at);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_chart_events_client_key
  ON public.protocol_chart_events (client_key) WHERE client_key IS NOT NULL;
-- An event is reversed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS protocol_chart_events_reversed_once
  ON public.protocol_chart_events (reverses_id) WHERE reverses_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protocol_chart_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'protocol chart events are append-only: reverse an event instead'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT hospital_id, patient_user_id, protocol_version_id INTO c
    FROM public.protocol_charts WHERE id = NEW.chart_id;
  IF (c.hospital_id, c.patient_user_id, c.protocol_version_id)
     IS DISTINCT FROM (NEW.hospital_id, NEW.patient_user_id, NEW.protocol_version_id) THEN
    RAISE EXCEPTION 'an event belongs to its chart''s patient and version' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.protocol_chart_events
        WHERE id = NEW.reverses_id AND chart_id = NEW.chart_id AND type NOT IN ('reverse','start')) THEN
    RAISE EXCEPTION 'a reversal undoes an event of the same chart' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protocol_chart_events_append_only ON public.protocol_chart_events;
CREATE TRIGGER protocol_chart_events_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.protocol_chart_events
  FOR EACH ROW EXECUTE FUNCTION public.protocol_chart_events_append_only();
DROP TRIGGER IF EXISTS audit_protocol_chart_events ON public.protocol_chart_events;
CREATE TRIGGER audit_protocol_chart_events AFTER INSERT ON public.protocol_chart_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

ALTER TABLE public.protocol_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_charts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_chart_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_chart_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS protocol_charts_select_clinical ON public.protocol_charts;
CREATE POLICY protocol_charts_select_clinical ON public.protocol_charts FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
DROP POLICY IF EXISTS protocol_chart_events_select_clinical ON public.protocol_chart_events;
CREATE POLICY protocol_chart_events_select_clinical ON public.protocol_chart_events FOR SELECT TO medsync_clinical_reader
  USING (hospital_id = (SELECT private.current_hospital_id())
         AND patient_user_id IN (SELECT private.accessible_patient_ids()));
REVOKE ALL ON public.protocol_charts, public.protocol_chart_events FROM anon, authenticated;
GRANT SELECT ON public.protocol_charts, public.protocol_chart_events TO medsync_clinical_reader;

-- ─── 3. the DKA seed's named numbers (FEATURES.md §2.1), still DRAFT ─
UPDATE public.protocol_versions SET seed = $json${
  "phases": [{"id":"imm","from":0,"to":1},{"id":"p2","from":1,"to":6},{"id":"p3","from":6,"to":12},{"id":"p4","from":12,"to":null}],
  "confirm": {"glucoseOver":11,"ketonesOver":3,"urineKetonesFrom":"2+","phUnder":7.3,"hco3Under":15},
  "severe": {"ketonesOver":6,"phUnder":7.1,"hco3Under":5,"kUnder":3.5,"gcsUnder":12,"spo2Under":92,"sbpUnder":90,"pulseOver":100,"pulseUnder":60},
  "anionGapOver": 16,
  "shock": {"sbpUnder":90,"bolusMl":500,"bolusMinutes":15,"repeatUnder":100,"boluses":2},
  "insulin": {"unitsPerKgH":0.1,"maxStartUnitsH":15,"unitsPerMl":1,"raiseUnitsH":1,"raiseLockMinutes":60},
  "kHoldUnder": 3.3,
  "kBands": [{"gt":5.5,"range":"Over 5.5","kclMmolL":0},{"gte":3.5,"lte":5.5,"range":"3.5 to 5.5","kclMmolL":40},{"lt":3.5,"range":"Under 3.5","kclMmolL":40,"senior":true}],
  "kMonitorOverMmolH": 20,
  "bags": [{"from":0,"to":1,"mlH":1000},{"from":1,"to":3,"mlH":500},{"from":3,"to":5,"mlH":500},{"from":5,"to":9,"mlH":250},{"from":9,"to":13,"mlH":250},{"from":13,"to":19,"mlH":166}],
  "glucose": {"addUnder":14,"mlH":125},
  "hypo": {"under":4,"ml":150,"recheckMinutes":15},
  "targets": {"ketonesFallH":0.5,"hco3RiseH":3,"glucoseFallH":3},
  "reassess": {"urineMlKgHUnder":0.5,"spo2Under":94,"phUnder":7.3,"phFromH":6,"gcsUnder":13},
  "monitor": {"gasH":[2,4,6,12,18],"ueH":[6,12,24],"vitalsMinutes":60,"overdueMinutes":10},
  "resolve": {"phOver":7.3,"ketonesUnder":0.3,"hco3Over":15,"byH":24},
  "caution": {"elderlyFrom":65,"youngFrom":16,"youngTo":25,"eskdEgfrUnder":15},
  "hcg": {"minAge":12,"maxAge":55},
  "refs": {
    "k": {"ref":"3.5 to 5.0 mmol/L","bands":[{"lt":2.5,"lvl":"crit","word":"Critically low","text":"Risk of arrhythmia. ECG and senior review now."},{"lt":3.5,"lvl":"abn","word":"Low","text":"Replace potassium; in DKA this changes when insulin can start."},{"lte":5.0,"lvl":"ok","word":"Normal","text":""},{"lt":6.5,"lvl":"abn","word":"High","text":"Usual in DKA before insulin. It falls once insulin starts; total body potassium is still low."},{"lvl":"crit","word":"Critically high","text":"ECG now and treat hyperkalaemia before going on."}]},
    "na": {"ref":"135 to 145 mmol/L","bands":[{"lt":120,"lvl":"crit","word":"Critically low","text":"Risk of seizures. Senior review; correct slowly."},{"lt":135,"lvl":"abn","word":"Low","text":"With high glucose, work out the corrected sodium before acting on it."},{"lte":145,"lvl":"ok","word":"Normal","text":""},{"lte":160,"lvl":"abn","word":"High","text":"Common in HHS. Aim for a fall of no more than 10 mmol/L in 24 hours."},{"lvl":"crit","word":"Critically high","text":"Senior review. Correct slowly: no more than 10 mmol/L in 24 hours."}]},
    "sbp": {"ref":"90 to 139 mmHg","bands":[{"lt":90,"lvl":"crit","word":"Low","text":"Shock range. Fluids and review first."},{"lt":140,"lvl":"ok","word":"Normal","text":""},{"lt":180,"lvl":"abn","word":"Raised","text":"Not a hypertensive emergency on its own."},{"lvl":"crit","word":"Severely raised","text":"Hypertensive emergency range if there is organ damage."}]},
    "dbp": {"ref":"60 to 89 mmHg","bands":[{"lt":60,"lvl":"abn","word":"Low","text":""},{"lt":90,"lvl":"ok","word":"Normal","text":""},{"lt":110,"lvl":"abn","word":"Raised","text":""},{"lvl":"crit","word":"Very high","text":""}]},
    "cbg": {"ref":"4 to 7.8 mmol/L","bands":[{"lt":4,"lvl":"crit","word":"Hypoglycaemia","text":"Treat now."},{"lte":7.8,"lvl":"ok","word":"Normal","text":""},{"lt":11,"lvl":"abn","word":"High","text":""},{"lt":14,"lvl":"abn","word":"High","text":"Over 11: meets the DKA glucose criterion."},{"lvl":"crit","word":"Very high","text":"Over 11: meets the DKA glucose criterion."}]},
    "ket": {"ref":"under 0.6 mmol/L","bands":[{"lt":0.6,"lvl":"ok","word":"Normal","text":""},{"lt":1.5,"lvl":"abn","word":"Raised","text":""},{"lte":3,"lvl":"abn","word":"High","text":"Risk of DKA."},{"lte":6,"lvl":"crit","word":"Over 3","text":"Meets the DKA ketone criterion."},{"lvl":"crit","word":"Over 6","text":"A sign of severe DKA."}]},
    "ph": {"ref":"7.32 to 7.42 (venous)","bands":[{"lt":7.1,"lvl":"crit","word":"Severe acidosis","text":"Under 7.1: a sign of severe DKA."},{"lt":7.3,"lvl":"abn","word":"Acidosis","text":"Under 7.3: meets the DKA criterion."},{"lt":7.32,"lvl":"abn","word":"Slightly low","text":"Over 7.3: part of resolution."},{"lte":7.42,"lvl":"ok","word":"Normal","text":""},{"lvl":"abn","word":"High","text":""}]},
    "hco3": {"ref":"22 to 29 mmol/L","bands":[{"lt":5,"lvl":"crit","word":"Critically low","text":"Under 5: a sign of severe DKA."},{"lt":15,"lvl":"abn","word":"Low","text":"Under 15: meets the DKA criterion."},{"lt":22,"lvl":"abn","word":"Low","text":""},{"lte":29,"lvl":"ok","word":"Normal","text":""},{"lvl":"abn","word":"High","text":""}]},
    "cl": {"ref":"98 to 107 mmol/L","bands":[{"lt":98,"lvl":"abn","word":"Low","text":""},{"lte":107,"lvl":"ok","word":"Normal","text":""},{"lvl":"abn","word":"High","text":"Hyperchloraemic acidosis can follow large volumes of sodium chloride."}]},
    "urea": {"ref":"2.5 to 7.8 mmol/L","bands":[{"lt":2.5,"lvl":"abn","word":"Low","text":""},{"lte":7.8,"lvl":"ok","word":"Normal","text":""},{"lte":20,"lvl":"abn","word":"High","text":"Dehydration or kidney injury."},{"lvl":"crit","word":"Very high","text":"Senior review."}]},
    "lact": {"ref":"under 2 mmol/L","bands":[{"lt":2,"lvl":"ok","word":"Normal","text":""},{"lt":4,"lvl":"abn","word":"Raised","text":"Look for sepsis or poor perfusion."},{"lvl":"crit","word":"High","text":"Sepsis or shock likely. Senior review."}]},
    "lglu": {"ref":"4 to 7.8 mmol/L","bands":[{"lt":4,"lvl":"crit","word":"Low","text":""},{"lte":7.8,"lvl":"ok","word":"Normal","text":""},{"lvl":"abn","word":"High","text":"Use to check the meter reading."}]},
    "gcs": {"ref":"15","bands":[{"lt":12,"lvl":"crit","word":"Reduced","text":"Under 12: a sign of severe DKA. Protect the airway."},{"lt":15,"lvl":"abn","word":"Reduced","text":"Under 13: consider CT head."},{"lvl":"ok","word":"Normal","text":""}]},
    "spo2": {"ref":"94% or more on air","bands":[{"lt":92,"lvl":"crit","word":"Low","text":"Under 92%: a sign of severe DKA."},{"lt":94,"lvl":"abn","word":"Low","text":"Arterial gas and chest X-ray."},{"lvl":"ok","word":"Normal","text":""}]},
    "pulse": {"ref":"60 to 100 a minute","bands":[{"lt":60,"lvl":"crit","word":"Slow","text":"Under 60: a sign of severe DKA."},{"lte":100,"lvl":"ok","word":"Normal","text":""},{"lvl":"abn","word":"Fast","text":"Over 100: a sign of severe DKA."}]},
    "temp": {"ref":"36.0 to 37.5 °C","bands":[{"lt":35,"lvl":"crit","word":"Hypothermia","text":""},{"lt":36,"lvl":"abn","word":"Low","text":""},{"lte":37.5,"lvl":"ok","word":"Normal","text":""},{"lt":39,"lvl":"abn","word":"Fever","text":"Look for infection."},{"lvl":"crit","word":"High fever","text":"Look for sepsis."}]},
    "rr": {"ref":"12 to 20 a minute","bands":[{"lt":8,"lvl":"crit","word":"Very slow","text":"Senior review now."},{"lt":12,"lvl":"abn","word":"Slow","text":""},{"lte":20,"lvl":"ok","word":"Normal","text":""},{"lte":24,"lvl":"abn","word":"Fast","text":"Kussmaul breathing settles as the acidosis clears."},{"lvl":"crit","word":"Very fast","text":"Severe acidosis or a chest cause. Review now."}]},
    "ews": {"ref":"0 to 2","bands":[{"lte":2,"lvl":"ok","word":"Low","text":""},{"lte":4,"lvl":"abn","word":"Medium-low","text":"Increase observations."},{"lvl":"crit","word":"High","text":"Urgent review."}]}
  }
}$json$::jsonb
WHERE protocol_id = 'dka' AND hospital_id IS NULL AND version = 1 AND status = 'draft'
  AND signer1_user_id IS NULL AND seed = '{}'::jsonb;
