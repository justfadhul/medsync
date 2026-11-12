-- 0285 — Protocol seeds (prescribing kit P5, F9): the named numbers of three rule modules into their
-- seed versions' `seed`: hyperkalaemia (FEATURES.md §2.3, lib/protocols/rules/hyperk.ts), hypertensive
-- emergency IV labetalol (§2.4, rules/htn.ts) and magnesium sulphate, Pritchard (§2.5, rules/mgso4.ts).
--
-- GATED: owner-applied (`npm run db:migrate`), after 0283. Until it runs, these three charts show as
-- blocked ("this version has no numbers"); nothing else changes.
--
-- Each seed stays DRAFT and unsigned (0282's trigger allows the change before the first signature);
-- two consultants sign it in the app after checking these numbers. The numbers are §2's; where §2
-- gives none, the prototype's (Main.dc.html PC.<id>): phase boundaries; hyperkalaemia salbutamol
-- fast-pulse warning (over 100), hypo treatment (150 ml 10% or 50 ml 20%, recheck 15 min), eGFR alert
-- under 15, acidosis bicarbonate under 22; labetalol infusion middle step 1.5 mg/min; magnesium 50%
-- ml per g (2), dose window 15 min, low urine 25 ml/h, post-delivery BP 150/100 every 4 h; the
-- reference ranges (`refs`, the prototype's REFS, as in the DKA seed of 0283).
--
-- ADDITIVE and re-runnable: each UPDATE touches only the seed's draft version 1 whose seed is still
-- '{}'. Reverse: set these three seeds back to '{}'.

-- ─── §2.3 hyperkalaemia ───
UPDATE public.protocol_versions SET seed = $json${
  "phases": [{"id":"heart","from":0,"to":1},{"id":"shift","from":1,"to":4},{"id":"watch","from":4,"to":24},{"id":"end","from":24,"to":null}],
  "grade": {"mildFrom":5.5,"moderateFrom":6,"severeFrom":6.5},
  "calcium": {"g":1,"ml":10,"overMinutesFrom":5,"overMinutesTo":10,"everyMinutes":10,"maxDoses":3,"digoxinMinutes":30},
  "insulin": {"units":10,"glucoseMl":50,"overMinutes":15,"fromK":6,"lowGlucoseUnder":7,"d10MlH":50,"d10Hours":5},
  "salbutamol": {"mg":[10,20],"fastPulseOver":100},
  "hypo": {"under":4,"d10Ml":150,"d20Ml":50,"recheckMinutes":15},
  "watch": {"glucoseMinutes":[15,30,60,90,120,180,240,300,360],"potassiumMinutes":[60,120,240,360]},
  "recheck": {"repeatFrom":6,"renalFrom":6.5},
  "remove": {"renalEgfrUnder":30,"renalUrgentEgfrUnder":15,"acidHco3Under":22},
  "resolve": {"kUnder":5.5,"recheckWithinH":24},
  "refs": {
    "k": {"ref":"3.5 to 5.0 mmol/L","bands":[{"lt":2.5,"lvl":"crit","word":"Critically low","text":"Risk of arrhythmia. ECG and senior review now."},{"lt":3.5,"lvl":"abn","word":"Low","text":"Replace potassium; in DKA this changes when insulin can start."},{"lte":5,"lvl":"ok","word":"Normal","text":""},{"lt":6.5,"lvl":"abn","word":"High","text":"Usual in DKA before insulin. It falls once insulin starts; total body potassium is still low."},{"lvl":"crit","word":"Critically high","text":"ECG now and treat hyperkalaemia before going on."}]},
    "cbg": {"ref":"4 to 7.8 mmol/L","bands":[{"lt":4,"lvl":"crit","word":"Hypoglycaemia","text":"Treat now."},{"lte":7.8,"lvl":"ok","word":"Normal","text":""},{"lt":11,"lvl":"abn","word":"High","text":""},{"lt":14,"lvl":"abn","word":"High","text":"Over 11: meets the DKA glucose criterion."},{"lvl":"crit","word":"Very high","text":"Over 11: meets the DKA glucose criterion."}]},
    "pulse": {"ref":"60 to 100 a minute","bands":[{"lt":60,"lvl":"crit","word":"Slow","text":"Under 60: a sign of severe DKA."},{"lte":100,"lvl":"ok","word":"Normal","text":""},{"lvl":"abn","word":"Fast","text":"Over 100: a sign of severe DKA."}]},
    "hco3": {"ref":"22 to 29 mmol/L","bands":[{"lt":5,"lvl":"crit","word":"Critically low","text":"Under 5: a sign of severe DKA."},{"lt":15,"lvl":"abn","word":"Low","text":"Under 15: meets the DKA criterion."},{"lt":22,"lvl":"abn","word":"Low","text":""},{"lte":29,"lvl":"ok","word":"Normal","text":""},{"lvl":"abn","word":"High","text":""}]}
  }
}$json$::jsonb
WHERE protocol_id = 'hyperk' AND hospital_id IS NULL AND version = 1 AND status = 'draft'
  AND signer1_user_id IS NULL AND seed = '{}'::jsonb;

-- ─── §2.4 IV labetalol ───
UPDATE public.protocol_versions SET seed = $json${
  "phases": [{"id":"assess","from":0,"to":1},{"id":"bolus","from":1,"to":6},{"id":"cont","from":6,"to":18},{"id":"end","from":18,"to":null}],
  "emergency": {"sbpFrom":180,"dbpFrom":120},
  "pulseUnder": 60,
  "target": {"aimFall":0.15,"floorFall":0.25,"firstMinutes":60,"thenSbp":160,"thenDbp":100,"thenFromH":2,"thenByH":6},
  "dissection": {"sbpUnder":120,"withinMinutes":20,"pulseUnder":60},
  "pregnancy": {"sbpFrom":140,"sbpTo":150,"dbpFrom":90,"dbpTo":100},
  "boluses": {"mg":[20,40,80,80,80],"everyMinutes":10,"overMinutes":2,"maxTotalMg":300},
  "infusion": {"mgMin":[1,1.5,2],"mgPerMl":1},
  "controlled": {"sbpAtMost":160,"dbpAtMost":100,"afterMinutes":60,"thenEveryMinutes":30,"thenHours":6},
  "refs": {
    "sbp": {"ref":"90 to 139 mmHg","bands":[{"lt":90,"lvl":"crit","word":"Low","text":"Shock range. Fluids and review first."},{"lt":140,"lvl":"ok","word":"Normal","text":""},{"lt":180,"lvl":"abn","word":"Raised","text":"Not a hypertensive emergency on its own."},{"lvl":"crit","word":"Severely raised","text":"Hypertensive emergency range if there is organ damage."}]},
    "dbp": {"ref":"60 to 89 mmHg","bands":[{"lt":60,"lvl":"abn","word":"Low","text":""},{"lt":90,"lvl":"ok","word":"Normal","text":""},{"lt":110,"lvl":"abn","word":"Raised","text":""},{"lvl":"crit","word":"Very high","text":""}]},
    "pulse": {"ref":"60 to 100 a minute","bands":[{"lt":60,"lvl":"crit","word":"Slow","text":"Under 60: a sign of severe DKA."},{"lte":100,"lvl":"ok","word":"Normal","text":""},{"lvl":"abn","word":"Fast","text":"Over 100: a sign of severe DKA."}]}
  }
}$json$::jsonb
WHERE protocol_id = 'htn' AND hospital_id IS NULL AND version = 1 AND status = 'draft'
  AND signer1_user_id IS NULL AND seed = '{}'::jsonb;

-- ─── §2.5 magnesium sulphate ───
UPDATE public.protocol_versions SET seed = $json${
  "phases": [{"id":"load","from":0,"to":1},{"id":"keep","from":1,"to":24},{"id":"end","from":24,"to":null}],
  "confirm": {"sbpFrom":140,"dbpFrom":90,"severeSbpFrom":160,"severeDbpFrom":110},
  "ml50PerG": 2,
  "loading": {"ivG":4,"ivMinutesFrom":5,"ivMinutesTo":10,"ivMl50":8,"ivWaterMl":12,"imG":10,"imEachG":5,"lidocaineMl":1},
  "refit": {"ivG":2,"minutes":5},
  "bp": {"treatSbpFrom":160,"treatDbpFrom":110,"aimSbp":[140,150],"aimDbp":[90,100]},
  "delivery": {"afterFitH":12,"otherwiseH":24},
  "maintenance": {"g":5,"everyH":4,"earlyMinutes":15},
  "checks": {"rrFrom":16,"urineMlFrom":100,"urineHours":4},
  "toxicity": {"rrUnder":12,"calciumG":1,"calciumMinutes":10},
  "stopAfterH": 24,
  "urineLowMlH": 25,
  "postpartum": {"sbpUnder":150,"dbpUnder":100,"everyH":4},
  "refs": {
    "sbp": {"ref":"90 to 139 mmHg","bands":[{"lt":90,"lvl":"crit","word":"Low","text":"Shock range. Fluids and review first."},{"lt":140,"lvl":"ok","word":"Normal","text":""},{"lt":180,"lvl":"abn","word":"Raised","text":"Not a hypertensive emergency on its own."},{"lvl":"crit","word":"Severely raised","text":"Hypertensive emergency range if there is organ damage."}]},
    "dbp": {"ref":"60 to 89 mmHg","bands":[{"lt":60,"lvl":"abn","word":"Low","text":""},{"lt":90,"lvl":"ok","word":"Normal","text":""},{"lt":110,"lvl":"abn","word":"Raised","text":""},{"lvl":"crit","word":"Very high","text":""}]},
    "rr": {"ref":"12 to 20 a minute","bands":[{"lt":8,"lvl":"crit","word":"Very slow","text":"Senior review now."},{"lt":12,"lvl":"abn","word":"Slow","text":""},{"lte":20,"lvl":"ok","word":"Normal","text":""},{"lte":24,"lvl":"abn","word":"Fast","text":"Kussmaul breathing settles as the acidosis clears."},{"lvl":"crit","word":"Very fast","text":"Severe acidosis or a chest cause. Review now."}]}
  }
}$json$::jsonb
WHERE protocol_id = 'mgso4' AND hospital_id IS NULL AND version = 1 AND status = 'draft'
  AND signer1_user_id IS NULL AND seed = '{}'::jsonb;
