-- 0282 — Quick protocols inside Prescribe (prescribing kit P3, F6): protocols and their versions.
--
-- GATED: owner-applied (`npm run db:migrate`), after 0279–0281. Until it runs, the Protocols mode of
-- Prescribe cannot load (the rest of PRESCRIBE_V2 is unchanged).
--
--   1. protocols: one row a protocol. `hospital_id` NULL = a MedSync seed (the 10 of FEATURES.md §2);
--      a hospital's own protocol (the builder) carries its hospital.
--   2. protocol_versions: what a protocol says. `rules` is the definition the quick mode reads (start
--      values and their bands, steps, checks, supply) with `module` naming the P4 rule module; `seed`
--      is reserved for the P4 engine's named numbers; the chart's time slot (minutes × count).
--      Every clinical number is here, never in code (P4). A version is signed only with two
--      different signers, each with the role they signed as (2 consultants, or the DTC chair and a
--      consultant; FEATURES §5): CHECKs below. A signed version is frozen; a version is never
--      deleted; once the first signer has signed, its content cannot change (trigger). A seed
--      (hospital NULL) is never signed: a hospital signs its own copy ("local sign-off").
--      Starting a protocol (sending its supply) is refused in production unless the version is
--      signed: `canStart` in lib/protocols/quick.ts, checked in the server action (P1).
--   3. prescriptions: `protocol_version_id` names the version a line was sent under, and
--      `protocol_start` what the prescriber saw (starting values with source and time, holds, the
--      answers to the protocol checks). P4's charts link to the same version.
--   4. The 10 seed protocols as DRAFT version 1 each (FEATURES.md §2 numbers; P3's part of each rule
--      sheet: starting values, checks, the step list and the first supply). P4/P5 complete them.
--
-- RLS: both tables forced; the clinical reader sees the seeds and its own hospital's rows; no client
-- writes (the server writes as the owner, as every EMR table). ADDITIVE and re-runnable.
-- Reverse: drop the two prescriptions columns, the two tables and the trigger function.

-- ─── 1. protocols ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.protocols (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{1,60}$'),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
  group_key text NOT NULL CHECK (group_key IN ('endo','cardio','obs','inf','neuro','lytes','tox','custom')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT protocols_custom_has_hospital CHECK ((group_key = 'custom') = (hospital_id IS NOT NULL))
);

-- ─── 2. protocol_versions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.protocol_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id text NOT NULL REFERENCES public.protocols(id) ON DELETE RESTRICT,
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed')),
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  seed jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(seed) = 'object'),
  slot_minutes integer NOT NULL CHECK (slot_minutes BETWEEN 1 AND 1440),
  slot_count integer NOT NULL CHECK (slot_count BETWEEN 1 AND 200),
  source text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer1_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer1_role text,
  signer1_at timestamptz,
  signer2_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  signer2_role text,
  signer2_at timestamptz,
  signed_at timestamptz,
  -- A seed is never signed: a hospital signs its own copy.
  CONSTRAINT protocol_versions_seed_draft CHECK (hospital_id IS NOT NULL OR status = 'draft'),
  -- Each signature is whole: who, as what, when.
  CONSTRAINT protocol_versions_signer1_whole CHECK (
    (signer1_user_id IS NULL) = (signer1_role IS NULL) AND (signer1_user_id IS NULL) = (signer1_at IS NULL)),
  CONSTRAINT protocol_versions_signer2_whole CHECK (
    (signer2_user_id IS NULL) = (signer2_role IS NULL) AND (signer2_user_id IS NULL) = (signer2_at IS NULL)),
  CONSTRAINT protocol_versions_signer_order CHECK (signer2_user_id IS NULL OR signer1_user_id IS NOT NULL),
  -- Two different people.
  CONSTRAINT protocol_versions_signers_distinct CHECK (signer2_user_id IS NULL OR signer2_user_id <> signer1_user_id),
  -- 2 consultants, or the DTC chair and a consultant (FEATURES §5).
  CONSTRAINT protocol_versions_signer_roles CHECK (
    (signer1_role IS NULL OR signer1_role IN ('CONSULTANT','SENIOR_CONSULTANT','DTC_CHAIR'))
    AND (signer2_role IS NULL OR signer2_role IN ('CONSULTANT','SENIOR_CONSULTANT','DTC_CHAIR'))
    AND NOT (signer1_role = 'DTC_CHAIR' AND signer2_role = 'DTC_CHAIR')),
  -- Signed if and only if both have signed.
  CONSTRAINT protocol_versions_signed_two CHECK (
    (status = 'signed') = (signer2_user_id IS NOT NULL) AND (status = 'signed') = (signed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_versions_number
  ON public.protocol_versions (protocol_id, coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
CREATE INDEX IF NOT EXISTS protocol_versions_hospital
  ON public.protocol_versions (hospital_id, protocol_id);

CREATE OR REPLACE FUNCTION public.protocol_versions_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'protocol versions are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'a signed protocol version is frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.protocol_id, NEW.hospital_id, NEW.version, NEW.created_at, NEW.created_by_user_id)
     IS DISTINCT FROM (OLD.id, OLD.protocol_id, OLD.hospital_id, OLD.version, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'a protocol version keeps its identity' USING ERRCODE = 'check_violation';
  END IF;
  -- What the first signer signed cannot change under them; a signature is never taken back.
  IF OLD.signer1_user_id IS NOT NULL AND (
       (NEW.rules, NEW.seed, NEW.slot_minutes, NEW.slot_count, NEW.source)
         IS DISTINCT FROM (OLD.rules, OLD.seed, OLD.slot_minutes, OLD.slot_count, OLD.source)
       OR (NEW.signer1_user_id, NEW.signer1_role, NEW.signer1_at)
         IS DISTINCT FROM (OLD.signer1_user_id, OLD.signer1_role, OLD.signer1_at)) THEN
    RAISE EXCEPTION 'a protocol version being signed cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protocol_versions_frozen ON public.protocol_versions;
CREATE TRIGGER protocol_versions_frozen BEFORE UPDATE OR DELETE ON public.protocol_versions
  FOR EACH ROW EXECUTE FUNCTION public.protocol_versions_frozen();
DROP TRIGGER IF EXISTS audit_protocol_versions ON public.protocol_versions;
CREATE TRIGGER audit_protocol_versions AFTER INSERT OR UPDATE OR DELETE ON public.protocol_versions
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();
DROP TRIGGER IF EXISTS audit_protocols ON public.protocols;
CREATE TRIGGER audit_protocols AFTER INSERT OR UPDATE OR DELETE ON public.protocols
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_changes();

ALTER TABLE public.protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocols FORCE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS protocols_select_clinical ON public.protocols;
CREATE POLICY protocols_select_clinical ON public.protocols FOR SELECT TO medsync_clinical_reader
  USING (hospital_id IS NULL OR hospital_id = (SELECT private.current_hospital_id()));
DROP POLICY IF EXISTS protocol_versions_select_clinical ON public.protocol_versions;
CREATE POLICY protocol_versions_select_clinical ON public.protocol_versions FOR SELECT TO medsync_clinical_reader
  USING (hospital_id IS NULL OR hospital_id = (SELECT private.current_hospital_id()));
REVOKE ALL ON public.protocols, public.protocol_versions FROM anon, authenticated;
GRANT SELECT ON public.protocols, public.protocol_versions TO medsync_clinical_reader;

-- ─── 3. prescriptions sent under a protocol ─────────────────────────
ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS protocol_version_id uuid
  REFERENCES public.protocol_versions(id) ON DELETE RESTRICT;
ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS protocol_start jsonb;
ALTER TABLE public.prescriptions DROP CONSTRAINT IF EXISTS prescriptions_protocol_start_shape;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_protocol_start_shape
  CHECK ((protocol_version_id IS NULL) = (protocol_start IS NULL)
         AND (protocol_start IS NULL OR jsonb_typeof(protocol_start) = 'object'));
CREATE INDEX IF NOT EXISTS prescriptions_protocol
  ON public.prescriptions (patient_user_id, protocol_version_id) WHERE protocol_version_id IS NOT NULL;

-- ─── 4. the 10 seed protocols, DRAFT (FEATURES.md §2) ───────────────
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('dka', NULL, 'Diabetic ketoacidosis (DKA)', 'endo') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'dka', NULL, 1, 'draft', $json${"module":"dka","intro":"Fluids by the hour, fixed-rate IV insulin by weight, potassium by level, 10% glucose once glucose is under 14.","who":{"label":"Adults","minAge":12},"confirm":["Glucose over 11, or known diabetes","Blood ketones over 3, or urine ketones 2+ or more","Venous pH under 7.3 and/or bicarbonate under 15"],"start":[{"key":"k","label":"Potassium","unit":"mmol/L","fact":"obs.potassium","test":"test.urea_electrolytes","bands":[{"gt":5.5,"range":"Over 5.5","text":"Start insulin. No potassium chloride in the fluids."},{"gte":3.5,"lte":5.5,"range":"3.5 to 5.5","text":"Start insulin. 40 mmol potassium chloride in each litre from bag 2."},{"gte":3.3,"lt":3.5,"range":"3.3 to 3.4","text":"Start insulin. Senior advice: more potassium is needed."},{"lt":3.3,"range":"Under 3.3","text":"Hold the insulin and put potassium in bag 1. Senior advice.","stop":true,"hold":["ins"],"change":{"ins":{"note":"On hold until potassium is 3.3 or more."},"f1":{"title":"Bag 1: sodium chloride 0.9% with potassium","note":"Potassium under 3.3: potassium goes in bag 1. Senior advice for how much."}}}]}],"steps":[{"id":"shock","kind":"rule","title":"If systolic BP is under 90","text":"500 ml 0.9% sodium chloride over 15 minutes; repeat if still under 100. Inform the senior."},{"id":"f1","kind":"infusion","title":"Bag 1: sodium chloride 0.9%","drug":"sodium_chloride_0_9","vol":1000,"over":60,"at":0},{"id":"ins","kind":"infusion","title":"Soluble insulin, fixed rate","drug":"insulin_soluble","dose":{"amt":0.1,"unit":"units/kg/h","max":15},"conc":{"amt":1,"label":"50 units in 49.5 ml = 1 unit/ml"},"at":0,"text":"No more than 15 units/h to start. Continue long-acting insulin. IV access and weight first."},{"id":"f2","kind":"infusion","title":"Bag 2: sodium chloride 0.9% + potassium by level","drug":"sodium_chloride_0_9","vol":1000,"over":120,"at":60},{"id":"f3","kind":"infusion","title":"Bag 3: sodium chloride 0.9% + potassium by level","drug":"sodium_chloride_0_9","vol":1000,"over":120,"at":180},{"id":"f4","kind":"infusion","title":"Bag 4: sodium chloride 0.9% + potassium by level","drug":"sodium_chloride_0_9","vol":1000,"over":240,"at":300},{"id":"f5","kind":"infusion","title":"Bag 5: sodium chloride 0.9% + potassium by level","drug":"sodium_chloride_0_9","vol":1000,"over":240,"at":540},{"id":"f6","kind":"infusion","title":"Bag 6: sodium chloride 0.9% + potassium by level","drug":"sodium_chloride_0_9","vol":1000,"over":360,"at":780},{"id":"kr","kind":"result","title":"U&Es: potassium chloride in each litre","times":[360,720,1440],"input":{"label":"Potassium","unit":"mmol/L"},"bands":[{"gt":5.5,"range":"Over 5.5","text":"No potassium chloride in the fluids."},{"gte":3.5,"lte":5.5,"range":"3.5 to 5.5","text":"40 mmol potassium chloride in each litre."},{"lt":3.5,"range":"Under 3.5","text":"Senior advice: more potassium is needed."}],"text":"Over 20 mmol an hour of potassium: cardiac monitor. Anuric: no potassium chloride."},{"id":"gl","kind":"result","title":"Capillary glucose","at":0,"every":60,"count":24,"input":{"label":"Glucose","unit":"mmol/L"},"bands":[{"gte":14,"range":"14 or more","text":"Continue."},{"gte":4,"lt":14,"range":"4 to under 14","text":"Add 10% glucose at 125 ml/h."},{"lt":4,"range":"Under 4","text":"Hypoglycaemia: 150 ml 10% glucose over 15 minutes, recheck in 15 minutes."}]},{"id":"hourly","kind":"check","title":"Ketones, fluids and urine","at":0,"every":60,"count":24},{"id":"gas","kind":"check","title":"Venous gas (pH, bicarbonate)","times":[120,240,360,720,1080]},{"id":"targets","kind":"rule","title":"Targets","text":"Ketones fall at least 0.5 an hour; bicarbonate rises at least 3 an hour; glucose falls at least 3 an hour (until under 14). Off target: the nurse checks the lines and pumps, then the doctor can raise the insulin by 1 unit/h. No second rise within 1 h."},{"id":"end","kind":"rule","title":"Resolution","text":"pH over 7.3 and blood ketones under 0.3 (urine ketones: bicarbonate over 15): SC insulin if eating, or a variable-rate infusion, then end. Not resolved by 24 h: senior review."}],"supply":[{"drug":"sodium_chloride_0_9","route":"iv","qty":6,"unit":"bags of 1,000 ml","steps":["f1"]},{"drug":"insulin_soluble","route":"infusion","qty":1,"unit":"vial","steps":["ins"]},{"drug":"potassium_chloride","route":"iv","qty":8,"unit":"ampoules"},{"drug":"glucose_10","route":"iv","qty":3,"unit":"bags"}]}$json$::jsonb, '{}'::jsonb, 60, 24, 'JBDS, UCG 2023'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'dka' AND hospital_id IS NULL);
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('hhs', NULL, 'Hyperosmolar hyperglycaemic state (HHS)', 'endo') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'hhs', NULL, 1, 'draft', $json${"module":"hhs","intro":"Fluids first. Insulin only if ketones are over 1.5 or the glucose stops falling on fluids. Watch sodium and osmolality.","who":{"label":"Adults","minAge":12},"confirm":["Hypovolaemia","Glucose 30 or more","Osmolality (2Na + glucose + urea) 320 or more","Ketones under 3, pH 7.3 or more, and bicarbonate 15 or more"],"start":[{"key":"na","label":"Sodium","unit":"mmol/L","fact":"obs.sodium","test":"test.urea_electrolytes"},{"key":"k","label":"Potassium","unit":"mmol/L","fact":"obs.potassium","test":"test.urea_electrolytes","bands":[{"gt":5.5,"range":"Over 5.5","text":"No potassium chloride in the fluids."},{"gte":3.5,"lte":5.5,"range":"3.5 to 5.5","text":"40 mmol potassium chloride in each litre."},{"lt":3.5,"range":"Under 3.5","text":"Senior advice: more potassium is needed."}]}],"steps":[{"id":"shock","kind":"rule","title":"If systolic BP is under 90","text":"500 ml boluses."},{"id":"f1","kind":"infusion","title":"Bag 1: sodium chloride 0.9%","drug":"sodium_chloride_0_9","vol":1000,"over":60,"at":0},{"id":"f2","kind":"infusion","title":"Bag 2: sodium chloride 0.9%","drug":"sodium_chloride_0_9","vol":1000,"over":120,"at":60},{"id":"f3","kind":"infusion","title":"Bag 3: sodium chloride 0.9%","drug":"sodium_chloride_0_9","vol":1000,"over":120,"at":180},{"id":"f4","kind":"infusion","title":"Bag 4: sodium chloride 0.9%","drug":"sodium_chloride_0_9","vol":1000,"over":240,"at":300},{"id":"f5","kind":"infusion","title":"Bag 5: sodium chloride 0.9%","drug":"sodium_chloride_0_9","vol":1000,"over":240,"at":540},{"id":"f6","kind":"infusion","title":"Bag 6: sodium chloride 0.9%","drug":"sodium_chloride_0_9","vol":1000,"over":360,"at":780},{"id":"f7","kind":"infusion","title":"Bag 7: sodium chloride 0.9%","drug":"sodium_chloride_0_9","vol":1000,"over":360,"at":1140},{"id":"ins","kind":"infusion","title":"Soluble insulin, only if ketones are over 1.5 or the glucose falls under 1 an hour on fluids","drug":"insulin_soluble","dose":{"amt":0.05,"unit":"units/kg/h"},"text":"The doctor prescribes it; the nurse starts it."},{"id":"kcl","kind":"rule","title":"Potassium","text":"As DKA, no more than 10 mmol an hour."},{"id":"hourly","kind":"check","title":"Glucose, fluids and urine","at":0,"every":60,"count":24},{"id":"lytes","kind":"check","title":"Na, K and urea (osmolality derived)","times":[60,120,240,360,720,1440]},{"id":"targets","kind":"rule","title":"Targets","text":"Glucose falls no more than 5 an hour (too fast: halve the insulin, or slow the fluids). Osmolality falls 3 to 8 an hour. Sodium falls no more than 10 in 24 h. Aim for +2 to 3 L by 6 h and +3 to 6 L by 12 h. Glucose under 14: 10% glucose at 125 ml/h; keep it at 10 to 15."},{"id":"end","kind":"rule","title":"Resolution","text":"Osmolality under 300, urine at least 0.5 ml/kg/h, mental state back to usual, glucose under 15: SC insulin or tablets, then end."}],"supply":[{"drug":"sodium_chloride_0_9","route":"iv","unit":"bags of 1,000 ml","steps":["f1","f2","f3","f4","f5","f6","f7"]},{"drug":"insulin_soluble","route":"infusion","qty":1,"unit":"vial","steps":["ins"]}]}$json$::jsonb, '{}'::jsonb, 60, 24, 'JBDS-IP, UCG 2023'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'hhs' AND hospital_id IS NULL);
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('hyperk', NULL, 'Hyperkalaemia', 'lytes') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'hyperk', NULL, 1, 'draft', $json${"module":"hyperk","intro":"Protect the heart, shift potassium into cells, then remove it.","who":{"label":"Adults","minAge":12},"confirm":["Potassium 6.5 or more, or ECG changes"],"start":[{"key":"k","label":"Potassium","unit":"mmol/L","fact":"obs.potassium","test":"test.urea_electrolytes","bands":[{"gte":6.5,"range":"6.5 or more","text":"Severe."},{"gte":6,"lt":6.5,"range":"6.0 to 6.4","text":"Moderate."},{"gte":5.5,"lt":6,"range":"5.5 to 5.9","text":"Mild."}]}],"steps":[{"id":"ca","kind":"give","title":"Calcium gluconate 10% IV over 5 to 10 minutes, only with ECG changes","drug":"calcium_gluconate","dose":{"amt":1,"unit":"g"},"at":0,"every":10,"count":3,"checks":["ECG changes still present"],"text":"10 ml (1 g). Repeat every 10 minutes while the changes last, up to 3 g. With digoxin, give it over 30 minutes."},{"id":"ig","kind":"give","title":"Soluble insulin 10 units in 50 ml of 50% glucose over 15 minutes, if 6.0 or more or ECG changes","drug":"insulin_soluble","dose":{"amt":10,"unit":"units"},"at":0,"text":"If the glucose before was under 7, add 10% glucose at 50 ml/h for 5 h."},{"id":"sb","kind":"give","title":"Salbutamol nebulised","drug":"salbutamol","dose":{"amt":10,"unit":"mg"},"at":0,"text":"10 or 20 mg, or not suitable (the doctor picks). A fast pulse: warning."},{"id":"gl","kind":"check","title":"Glucose (under 4: treat)","times":[15,30,60,90,120,180,240,300,360]},{"id":"kr","kind":"result","title":"Potassium recheck","times":[60,120,240,360],"input":{"label":"Potassium","unit":"mmol/L"},"bands":[{"gte":6.5,"range":"6.5 or more","text":"Repeat insulin with glucose and call the renal team."},{"gte":6,"lt":6.5,"range":"6.0 to 6.4","text":"Repeat insulin with glucose."},{"lt":6,"range":"Under 6","text":"Keep checking."}]},{"id":"remove","kind":"rule","title":"Remove","text":"Stop ACEi/ARB, spironolactone, potassium supplements, NSAIDs, trimethoprim and beta-blockers. Potassium binder, low-potassium diet. Renal team if eGFR is under 30 or the potassium stays high."},{"id":"end","kind":"rule","title":"Resolution","text":"Under 5.5 with a normal ECG: recheck within 24 h, then end."}],"supply":[{"drug":"calcium_gluconate","route":"iv","unit":"ampoules of 1 g","steps":["ca"],"per":1},{"drug":"insulin_soluble","route":"iv","qty":1,"unit":"vial","steps":["ig"]},{"drug":"glucose_50","route":"iv","qty":1,"unit":"50 ml"},{"drug":"salbutamol","route":"nebulised","qty":4,"unit":"nebules","steps":["sb"]}]}$json$::jsonb, '{}'::jsonb, 15, 24, 'UK Kidney Association, UCG 2023'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'hyperk' AND hospital_id IS NULL);
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('htn', NULL, 'Hypertensive emergency: IV labetalol', 'cardio') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'htn', NULL, 1, 'draft', $json${"module":"htn","intro":"Severe BP with new organ damage. First hour: about −15% of the mean pressure, never below −25%.","who":{"label":"Adults","minAge":12},"confirm":["BP 180/120 or more with new organ damage","Safe for labetalol: no asthma or COPD, heart block, acute heart failure, cocaine or amphetamine"],"start":[{"key":"sbp","label":"Systolic BP","unit":"mmHg","fact":"obs.bp_systolic"},{"key":"dbp","label":"Diastolic BP","unit":"mmHg","fact":"obs.bp_diastolic"},{"key":"pulse","label":"Pulse","unit":"/min","fact":"obs.heart_rate","bands":[{"lt":60,"range":"Under 60","text":"Not safe for labetalol: the senior picks another drug.","stop":true,"hold":["l0","l1","l2"]},{"gte":60,"range":"60 or more","text":"Pulse allows labetalol."}]}],"steps":[{"id":"l0","kind":"give","title":"Labetalol IV over 2 minutes","drug":"labetalol","dose":{"amt":20,"unit":"mg"},"at":0},{"id":"l1","kind":"give","title":"Labetalol IV, while the MAP is above the aim","drug":"labetalol","dose":{"amt":40,"unit":"mg"},"at":10,"checks":["MAP above the aim","Pulse 60 or more","No wheeze"]},{"id":"l2","kind":"give","title":"Labetalol IV, while the MAP is above the aim","drug":"labetalol","dose":{"amt":80,"unit":"mg"},"at":20,"every":10,"count":3,"checks":["MAP above the aim","Pulse 60 or more","No wheeze"],"text":"Total no more than 300 mg. The doctor can switch to an infusion of 1 to 2 mg/min (1 mg/ml)."},{"id":"bp","kind":"check","title":"Systolic, diastolic and pulse (MAP derived)","at":0,"every":10,"count":18},{"id":"target","kind":"rule","title":"Target","text":"MAP0 = (systolic + 2 × diastolic) / 3. First hour: about −15% (the aim), never below −25% (the floor). Then 160/100 by 2 to 6 h."},{"id":"stop","kind":"rule","title":"Stop if","text":"MAP under the floor (lie flat, call the senior), pulse under 60, or wheeze."},{"id":"end","kind":"rule","title":"Controlled","text":"160/100 or less after at least 1 h: step down to oral treatment, then end. BP every 30 minutes for 6 h."}],"supply":[{"drug":"labetalol","route":"iv","qty":3,"unit":"ampoules","steps":["l0"]}]}$json$::jsonb, '{}'::jsonb, 10, 18, 'UCG 2023'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'htn' AND hospital_id IS NULL);
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('mgso4', NULL, 'Magnesium sulphate, Pritchard', 'obs') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'mgso4', NULL, 1, 'draft', $json${"module":"mgso4","intro":"Loading dose IV and IM, then 5 g IM every 4 hours. Check before every dose.","who":{"label":"Pregnant women 12 to 55","minAge":12,"maxAge":55,"sex":"female","pregnant":true},"confirm":["Eclampsia (a fit), or severe pre-eclampsia: 160/110 or more, or 140/90 with a severe feature"],"start":[],"steps":[{"id":"ld1","kind":"give","title":"Magnesium sulphate IV over 5 to 10 minutes","drug":"magnesium_sulfate","dose":{"amt":4,"unit":"g"},"at":0,"text":"8 ml of 50% + 12 ml water for injection."},{"id":"ld2","kind":"give","title":"Magnesium sulphate deep IM, 5 g in each buttock","drug":"magnesium_sulfate","dose":{"amt":10,"unit":"g"},"at":0,"text":"1 ml 2% lidocaine in each syringe."},{"id":"mt","kind":"give","title":"Magnesium sulphate IM, alternating buttocks","drug":"magnesium_sulfate","dose":{"amt":5,"unit":"g"},"at":240,"every":240,"count":6,"checks":["Breathing 16 a minute or more","Knee reflexes present","Urine 100 ml or more in the last 4 h"],"text":"If any check fails: withhold and call the doctor. Stop 24 h after the delivery or the last fit, whichever is later."},{"id":"fit","kind":"rule","title":"If she fits again","text":"2 g IV over 5 minutes."},{"id":"tox","kind":"rule","title":"Toxicity: breathing under 12","text":"Stop the magnesium, give calcium gluconate 1 g IV over 10 minutes, ventilate if needed."},{"id":"bp","kind":"rule","title":"BP 160/110 or more","text":"Treat (the labetalol protocol, or nifedipine/hydralazine). Aim for 140–150 / 90–100."},{"id":"hourly","kind":"check","title":"Breathing, reflexes, urine, BP","at":0,"every":60,"count":24}],"supply":[{"drug":"magnesium_sulfate","route":"im","unit":"ampoules of 5 g","steps":["ld1","ld2","mt"],"per":5},{"drug":"calcium_gluconate","route":"iv","qty":1,"unit":"ampoule of 1 g"}]}$json$::jsonb, '{}'::jsonb, 60, 24, 'UCG 2023'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'mgso4' AND hospital_id IS NULL);
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('art', NULL, 'Severe malaria: IV artesunate', 'inf') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'art', NULL, 1, 'draft', $json${"module":"art","intro":"Doses at 0, 12 and 24 hours, then every 24 hours while the patient cannot swallow.","who":{"label":"Any age"},"confirm":["A positive mRDT or smear (not done yet: give dose 1 now and send the test)","At least one danger sign"],"start":[],"steps":[{"id":"a","kind":"give","title":"Artesunate IV or IM","drug":"artesunate","dose":{"amt":2.4,"unit":"mg/kg","child":{"belowKg":20,"amt":3,"unit":"mg/kg"}},"at":0,"every":720,"count":3,"text":"Make up each 60 mg vial with 1 ml bicarbonate, then +5 ml for IV (10 mg/ml) or +2 ml for IM (20 mg/ml)."},{"id":"a2","kind":"rule","title":"Then every 24 h while the patient cannot swallow","text":"At least 3 doses."},{"id":"obs","kind":"check","title":"Glucose, temperature, consciousness, urine","at":0,"every":240,"count":18},{"id":"dangers","kind":"rule","title":"Treat the dangers","text":"Glucose under 3: child 10% glucose 5 ml/kg; adult 50 ml 50%. Fits: seizure protocol. Hb under 5 (child) or under 7 (adult): transfuse. Antibiotics if sepsis or meningitis is possible. Maintenance fluids only."},{"id":"end","kind":"rule","title":"Switch","text":"At least 3 doses and able to swallow: full 3-day artemether/lumefantrine by weight, then end. Check Hb at day 7 and day 14."}],"supply":[{"drug":"artesunate","route":"iv","unit":"vials of 60 mg","steps":["a"],"per":60}]}$json$::jsonb, '{}'::jsonb, 240, 18, 'UCG 2023, WHO'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'art' AND hospital_id IS NULL);
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('se', NULL, 'Status epilepticus', 'neuro') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'se', NULL, 1, 'draft', $json${"module":"se","intro":"Time-critical ladder. Check the glucose first.","who":{"label":"Any age"},"confirm":[],"start":[],"steps":[{"id":"gl","kind":"check","title":"Check the glucose","at":0,"text":"Child under 3: 10% glucose 5 ml/kg. Adult under 4: 50 ml of 50% glucose (thiamine first if alcohol is likely). Pregnant: the magnesium protocol."},{"id":"d1","kind":"give","title":"Diazepam IV slowly","drug":"diazepam","dose":{"amt":10,"unit":"mg","child":{"belowAge":12,"amt":0.3,"unit":"mg/kg","max":10}},"at":0,"text":"Or rectally: adult 10–20 mg; child 0.5 mg/kg (max 10 mg)."},{"id":"d2","kind":"give","title":"Diazepam again, if still fitting","drug":"diazepam","dose":{"amt":10,"unit":"mg","child":{"belowAge":12,"amt":0.3,"unit":"mg/kg","max":10}},"at":10,"checks":["Still fitting after 10 minutes"],"text":"At most 2 doses."},{"id":"pb","kind":"give","title":"Phenobarbital IV over at least 20 minutes, if still fitting","drug":"phenobarbital","dose":{"amt":20,"unit":"mg/kg","max":1000},"at":20,"checks":["Still fitting 10 minutes after the 2nd diazepam","Ventilation ready"],"text":"Diluted 1 in 10."},{"id":"ref","kind":"rule","title":"Still fitting at 30 to 40 minutes","text":"Refractory: anaesthetist and ICU."}],"supply":[{"drug":"diazepam","route":"iv","unit":"ampoules of 10 mg","steps":["d1","d2"],"per":10},{"drug":"phenobarbital","route":"iv","unit":"ampoules of 200 mg","steps":["pb"],"per":200}]}$json$::jsonb, '{}'::jsonb, 5, 12, 'UCG 2023, WHO'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'se' AND hospital_id IS NULL);
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('op', NULL, 'Organophosphate poisoning: atropine', 'tox') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'op', NULL, 1, 'draft', $json${"module":"op","intro":"Double the atropine every 5 minutes until atropinised, then an infusion.","who":{"label":"Any age"},"confirm":["2 or more signs: small pupils, sweating, secretions, wheeze, slow pulse, vomiting or diarrhoea, twitching, drowsiness"],"start":[],"steps":[{"id":"a","kind":"give","title":"Atropine IV, doubling every 5 minutes until atropinised","drug":"atropine","dose":{"amt":2,"unit":"mg","child":{"belowAge":12,"amt":0.02,"unit":"mg/kg","min":0.1}},"double":true,"at":0,"every":5,"count":6},{"id":"ar","kind":"rule","title":"Atropinised = all 5","text":"Chest clear, pulse over 80, systolic over 80, dry armpits, pupils not pinpoint. The doctor may call it at 3 or more if the chest is clear."},{"id":"inf","kind":"rule","title":"Once atropinised: infusion","text":"10–20% of the total atropine needed, every hour (the doctor picks the %)."},{"id":"much","kind":"rule","title":"Too much atropine","text":"Confusion, fever, no bowel sounds, a full bladder: stop for 30 minutes, then restart at 80%."},{"id":"weak","kind":"check","title":"Neck flexion and breathing (late weakness)","at":0,"every":240,"count":6}],"supply":[{"drug":"atropine","route":"iv","qty":50,"unit":"ampoules","steps":["a"]}]}$json$::jsonb, '{}'::jsonb, 5, 24, 'UCG 2023, WHO'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'op' AND hospital_id IS NULL);
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('nac', NULL, 'Paracetamol overdose: acetylcysteine (21 hours)', 'tox') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'nac', NULL, 1, 'draft', $json${"module":"nac","intro":"Three bags by weight (weight capped at 110 kg).","who":{"label":"Any age"},"confirm":["Level on or above the treatment line, staggered or unknown time, 8 h or more since 150 mg/kg or more, or abnormal LFTs"],"start":[],"steps":[{"id":"b1","kind":"infusion","title":"Bag 1: acetylcysteine","drug":"acetylcysteine","dose":{"amt":150,"unit":"mg/kg","wcap":110},"vol":200,"over":60,"at":0},{"id":"b2","kind":"infusion","title":"Bag 2: acetylcysteine","drug":"acetylcysteine","dose":{"amt":50,"unit":"mg/kg","wcap":110},"vol":500,"over":240,"at":60},{"id":"b3","kind":"infusion","title":"Bag 3: acetylcysteine","drug":"acetylcysteine","dose":{"amt":100,"unit":"mg/kg","wcap":110},"vol":1000,"over":960,"at":300},{"id":"lab","kind":"check","title":"INR, ALT, creatinine, pH and glucose at the end of bag 3","at":1260},{"id":"rx","kind":"rule","title":"Reaction","text":"Flushing, itch, wheeze or low BP is not an allergy. Pause, give an antihistamine, and restart when settled."},{"id":"end","kind":"rule","title":"End of bag 3","text":"INR over 1.3 or ALT 100 or more: continue at the bag 3 rate and repeat every 12 h. Liver unit: pH under 7.3, INR over 3, creatinine over 200. Otherwise medically fit: mental health review, then end."}],"supply":[{"drug":"acetylcysteine","route":"infusion","unit":"ampoules of 2 g","steps":["b1","b2","b3"],"per":2000}]}$json$::jsonb, '{}'::jsonb, 60, 24, 'UCG 2023, UK MHRA'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'nac' AND hospital_id IS NULL);
INSERT INTO public.protocols (id, hospital_id, name, group_key) VALUES ('ssi', NULL, 'Correctional (sliding-scale) insulin', 'endo') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.protocol_versions (protocol_id, hospital_id, version, status, rules, seed, slot_minutes, slot_count, source)
  SELECT 'ssi', NULL, 1, 'draft', $json${"module":"ssi","intro":"Soluble insulin under the skin before meals and at bedtime, by the glucose. The seed bands are an example: replace with your hospital's signed scale.","who":{"label":"Adults","minAge":12},"confirm":["The patient is eating (nil by mouth: variable-rate infusion)"],"start":[{"key":"scale","label":"Scale","unit":"","options":["Low","Medium","High"]}],"steps":[{"id":"g","kind":"result","title":"Glucose before breakfast, lunch, supper and bedtime","at":0,"every":360,"count":8,"input":{"label":"Glucose","unit":"mmol/L"},"bandsBy":"scale","bands":{"Low":[{"lt":4,"range":"Under 4","text":"None: hypoglycaemia."},{"gte":4,"lte":10,"range":"4 to 10","text":"None."},{"gt":10,"lte":14,"range":"10.1 to 14","text":"2 units."},{"gt":14,"lte":18,"range":"14.1 to 18","text":"4 units."},{"gt":18,"lte":22,"range":"18.1 to 22","text":"6 units."},{"gt":22,"range":"Over 22","text":"8 units; check ketones and call the doctor."}],"Medium":[{"lt":4,"range":"Under 4","text":"None: hypoglycaemia."},{"gte":4,"lte":10,"range":"4 to 10","text":"None."},{"gt":10,"lte":14,"range":"10.1 to 14","text":"4 units."},{"gt":14,"lte":18,"range":"14.1 to 18","text":"6 units."},{"gt":18,"lte":22,"range":"18.1 to 22","text":"8 units."},{"gt":22,"range":"Over 22","text":"10 units; check ketones and call the doctor."}],"High":[{"lt":4,"range":"Under 4","text":"None: hypoglycaemia."},{"gte":4,"lte":10,"range":"4 to 10","text":"None."},{"gt":10,"lte":14,"range":"10.1 to 14","text":"6 units."},{"gt":14,"lte":18,"range":"14.1 to 18","text":"8 units."},{"gt":18,"lte":22,"range":"18.1 to 22","text":"10 units."},{"gt":22,"range":"Over 22","text":"12 units; check ketones and call the doctor."}]}},{"id":"review","kind":"rule","title":"Review","text":"2 or more readings over 14 in a day: add or raise the basal insulin. Any reading under 4: move down a scale. Ketones if the glucose is over 14. Type 1 diabetes: never stop the basal insulin."}],"supply":[{"drug":"insulin_soluble","route":"sc","qty":1,"unit":"vial","steps":["g"]}]}$json$::jsonb, '{}'::jsonb, 360, 8, 'Hospital scale (example)'
  WHERE NOT EXISTS (SELECT 1 FROM public.protocol_versions WHERE protocol_id = 'ssi' AND hospital_id IS NULL);
