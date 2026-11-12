-- 0284 — Protocol seeds: HHS and correctional (sliding-scale) insulin (prescribing kit P5, F9).
--
-- GATED: owner-applied (`npm run db:migrate`), after 0282 and 0283. Until it runs, the HHS and
-- sliding-scale charts show "This version has no numbers" and offer nothing.
--
--   The named numbers of FEATURES.md §2.2 (HHS) and §2.10 (sliding scale) into the seed versions'
--   `seed` (still DRAFT, unsigned: 0282's trigger allows the change while no one has signed). The
--   rule modules `lib/protocols/rules/hhs.ts` and `ssi.ts` read every number from here. Slot
--   indices (phases, bags, lab hours) are in the version's slot (1 h for HHS, 6 h for the scale).
--   Values §2 does not give are the prototype's (insulin at least 1 unit/h in 50 ml, 2 boluses,
--   150 ml 10% glucose for a hypo, the 6 to 10 aim, the 24 h senior review). The reference ranges
--   are the DKA seed's (0283), the prototype's one shared table.
--   The sliding-scale bands are the hospital-editable table (FEATURES §5): the example, to be
--   replaced by the hospital's own signed scale in a new version.
--
-- ADDITIVE and re-runnable (only an empty, unsigned seed is filled). Reverse: set both seeds back to
-- '{}'.

UPDATE public.protocol_versions SET seed = $json${
  "phases": [{"id":"imm","from":0,"to":1},{"id":"mid","from":1,"to":6},{"id":"late","from":6,"to":12},{"id":"end","from":12,"to":null}],
  "confirm": {"glucoseFrom":30,"osmFrom":320,"ketonesUnder":3,"phFrom":7.3,"hco3From":15},
  "severe": {"osmOver":350,"naOver":160,"phUnder":7.1,"kUnder":3.5,"kOver":6,"gcsUnder":12,"spo2Under":92,"sbpUnder":90,"pulseOver":100,"pulseUnder":60,"urineMlKgHUnder":0.5,"creatOver":200},
  "shock": {"sbpUnder":90,"bolusMl":500,"bolusMinutes":15,"boluses":2},
  "bagMl": 1000,
  "bags": [{"from":0,"to":1,"mlH":1000},{"from":1,"to":3,"mlH":500},{"from":3,"to":5,"mlH":500},{"from":5,"to":9,"mlH":250},{"from":9,"to":13,"mlH":250},{"from":13,"to":19,"mlH":166},{"from":19,"to":25,"mlH":166}],
  "balance": [{"byH":6,"fromL":2,"toL":3},{"byH":12,"fromL":3,"toL":6}],
  "insulin": {"unitsPerKgH":0.05,"minUnitsH":1,"ketonesOver":1.5,"plateauUnderH":1,"unitsPerMl":1,"syringeMl":50},
  "kBands": [{"gt":5.5,"range":"Over 5.5","kclMmolL":0},{"gte":3.5,"lte":5.5,"range":"3.5 to 5.5","kclMmolL":40},{"lt":3.5,"range":"Under 3.5","kclMmolL":40,"senior":true}],
  "kMaxMmolH": 10,
  "glucose": {"addUnder":14,"mlH":125,"keepFrom":10,"keepTo":15},
  "hypo": {"under":4,"ml":150,"recheckMinutes":15},
  "targets": {"glucoseFallMaxH":5,"osmFallMinH":3,"osmFallMaxH":8,"naFallMax24h":10,"halfFromL":2},
  "monitor": {"labH":[1,2,4,6,12,24],"overdueMinutes":10},
  "feetEveryH": 24,
  "caution": {"elderlyFrom":65},
  "resolve": {"osmUnder":300,"urineMlKgHFrom":0.5,"glucoseUnder":15,"reviewAtH":24,"recoveryH":72}
}$json$::jsonb || jsonb_build_object('refs', COALESCE((
  SELECT seed -> 'refs' FROM public.protocol_versions
  WHERE protocol_id = 'dka' AND hospital_id IS NULL AND version = 1), '{}'::jsonb))
WHERE protocol_id = 'hhs' AND hospital_id IS NULL AND version = 1 AND status = 'draft'
  AND signer1_user_id IS NULL AND seed = '{}'::jsonb;

UPDATE public.protocol_versions SET seed = $json${
  "phases": [{"id":"set","from":0,"to":1},{"id":"run","from":1,"to":8},{"id":"end","from":8,"to":null}],
  "scales": ["Low","Medium","High"],
  "bands": [
    {"lt":4,"range":"Under 4","hypo":true,"units":{"Low":0,"Medium":0,"High":0}},
    {"gte":4,"lte":10,"range":"4 to 10","units":{"Low":0,"Medium":0,"High":0}},
    {"gt":10,"lte":14,"range":"10.1 to 14","units":{"Low":2,"Medium":4,"High":6}},
    {"gt":14,"lte":18,"range":"14.1 to 18","units":{"Low":4,"Medium":6,"High":8}},
    {"gt":18,"lte":22,"range":"18.1 to 22","units":{"Low":6,"Medium":8,"High":10}},
    {"gt":22,"range":"Over 22","call":true,"units":{"Low":8,"Medium":10,"High":12}}
  ],
  "suggest": {"lowEgfrUnder":30,"lowAgeFrom":75},
  "dka": {"ketonesFrom":3,"glucoseOver":11},
  "metforminHoldEgfrUnder": 30,
  "ketonesCheckOver": 14,
  "review": {"highOver":14,"highCount":2,"lowUnder":4},
  "aim": {"from":6,"to":10},
  "refs": {}
}$json$::jsonb || jsonb_build_object('refs', COALESCE((
  SELECT seed -> 'refs' FROM public.protocol_versions
  WHERE protocol_id = 'dka' AND hospital_id IS NULL AND version = 1), '{}'::jsonb))
WHERE protocol_id = 'ssi' AND hospital_id IS NULL AND version = 1 AND status = 'draft'
  AND signer1_user_id IS NULL AND seed = '{}'::jsonb;
