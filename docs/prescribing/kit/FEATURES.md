# FEATURES: prescribing tool and protocol charts

What to add to MedSync from the 11 Nov 2026 prototype (`prototype/Main.dc.html`). Each feature lists:
- **where it probably fits** (P0 confirms this),
- **what to build**,
- **what "done" means**.

All patients in the prototype are fictional. **All doses and thresholds are prototype values from UCG 2023, JBDS, UK Kidney Association, WHO and MHRA. They need local clinical sign-off before use.**

---

## 0. Prototype map (read by function, in ranges)
| Prototype function / constant | Feature |
|---|---|
| `ORIGINS`, `SHELF`, prescriber side markup (`PRESCRIBER` block) | F1 places that prescribe, collect points |
| `MEDS` (`D()`/`R()` regimens), `CATS`, `SUGGEST`, `SETS`, `BRANDS`, `applySet`, `buildLine`, `again`, `closeRx` | F2 search, order sets, regimens, basket |
| `actFor`, `INTER`, `ALLERGY`, `LIMITS`, `ALT`, `egfr`, `egfrDetail`, `qtyErr`, `heldAt`, `liveTick` | F3 checks and live stock |
| `apply(handover)`, `DOC_WORD`, `PH_WORD`, `HOLD`, `PHARMACY` block, `HAND OVER` and `ANSWER` dialogs | F4 pharmacy hand-off |
| `NURSES` block, `s.tasks`, `plines` | F5 nurse tasks and MAR |
| `PROTOS`, `protoChecks`, `planOf`, `flowOf`, `runItems`, `pinBand`/`applyPins`/`pinVal`, `PROTOCOL BUILDER` block | F6 quick protocols in Prescribe, builder |
| `pcView` (generic engine), `dkVitals`, `dkStkPair`, `dkProtoSeg`, `dkShift`, `dkChart`/`dkPatch`/`dkKey`, `PROTOCOLS` block | F7 chart engine and screens |
| `dkView` (DKA), `PC.hhs`, `PC.hyperk`, `PC.htn`, `PC.mgso4`, `PC.art`, `PC.se`, `PC.op`, `PC.nac`, `PC.ssi`, `KBANDS` | F8 / F9 the 10 protocol rule modules |
| `REFS` + `interp`, `TESTS`, `LABGRP`, `BEDSIDE` | Reference ranges, colour flags, orderable groups |
| `Flow.dc.html` | User flow: screens and the 8 cadre hand-offs |

---

## 1. Features

### F1. One Prescribe, opened from every place that prescribes
**Fits:** the patient record's action bar, in each of these places. Each place sets where the medicines are collected.

| Place | Collected at |
|---|---|
| Clinic visit | Main window |
| Clerking · Plan | Ward 4B, each line tied to a problem |
| Ward round | the ward |
| Resus | Resus cart: given first, recorded so the cart is restocked, not dispensed again |
| NCD clinic | Main window |
| Going home | Main window |

- **Patient strip:** name, age and sex, MRN, allergies (or "not asked"), weight with its source, kidney function (creatinine, eGFR by CKD-EPI 2021, date), pregnancy (weeks, or "not asked" for women 12 to 55).
- **Prescriber page:**
  - medicines prescribed, each line with its status word
  - "Already taking" (home medicines)
  - Tests
  - Reviews
  - Protocols running
  - Nurse tasks
- **Done when:** the same dialog opens from all six places, shows the right collect point, and the old forms are gone.

### F2. Search, order sets, regimens, basket
- **Search:** search by generic name, filter by group (Antibiotics; Malaria, TB, HIV; and so on), and use the arrow keys plus Enter to pick. Suggestions come from the patient's problems.
- **Order sets:** one tap adds several lines, for example malaria, pneumonia or UTI. Lines that cannot be given (allergy, out of stock) are skipped, with a message.
- **Brand:** the brand picker shows stock by brand. A preferred brand can be starred.
- **Regimen:** pick a standard regimen (adult or child) and the dose is worked out:
  - fixed mg
  - mg/kg, with a maximum
  - weight bands (ACTs, IMCI amoxicillin, TB fixed-dose combinations)
  - tablets
  - The weight used is shown and can be changed.
  - Route, how often, for how long, start date, review date, and patient instructions (printed on the label) are filled in from the regimen. Changes are marked "Changed from the regimen", with "Use the regimen" to undo.
- **Plan problem:** each line links to a problem (the Plan step).
- **Supply quantity:** worked out from dose × frequency × duration and the pack. Liquids are counted in bottles.
- **Basket:** "This prescription" lists every line, each with Edit, Again and Remove. The draft is kept if the dialog closes, and "Resume" brings it back.
- **Review and send:** a summary with the checks you confirmed, then send.
- **Already prescribed:** lines for this patient show with "Prescribe again" and "Stop".
- **Done when:** a child's dose by weight band and an adult mg/kg dose are both right, and a closed dialog resumes with its lines.

### F3. Checks (decision support; the prescriber decides)
Checks run against this patient and appear as **Stop and check**, **Check**, **Note** or **Passed**:

| Check | What it looks at |
|---|---|
| Allergy | class match, and cross-reactivity (for example ceftriaxone with a penicillin allergy) |
| Kidney | renally dosed medicines with no creatinine: order it, or enter the result, and eGFR is worked out. Dose advice by eGFR band |
| Pregnancy | asked for women aged 12 to 55; medicines to avoid |
| Interactions | interacting class pairs (`INTER`) between new lines and home medicines |
| Duplicates | the same class twice |
| Child and adult | adult-only medicines for a child |
| Limits | maximum dose, or maximum days |
| Stock | stock at the patient's collect point, with alternatives (`ALT`) |

- A "Stop" needs a reason to override, or a pick of something else. The confirmed overrides travel with the prescription, and the pharmacy sees them as "Prescriber saw: …".
- **Done when:** each check fires on its prototype example, and the override shows in the pharmacy.

### F4. Pharmacy hand-off
**Fits:** the pharmacy dispense queue (pharmacy rework), so do not rebuild it.

- **Line states:**

  | The prescriber sees | The pharmacy sees |
  |---|---|
  | Waiting at pharmacy | Waiting |
  | Pharmacy asks you | Asked the prescriber |
  | Owed, given later | Owed |
  | Handed over | Handed over |
  | Stopped | Stopped |

- **Hold:** a line can be held for one of: talk to the prescriber, patient not here yet, or waiting for a co-sign.
- **Prescriber questions:** the pharmacy writes a question, and the prescriber answers with one of:
  - stop this line
  - change it
  - keep as written, with an optional reply

  The answer goes back to the queue.
- **Hand over:** the pharmacist records who collects and confirms "I checked who they are, and explained how to take each medicine". For a controlled medicine, a second pharmacy staff member witnesses and signs the register.
- **Shelf counts:** shown at the window and go down as medicines are handed over. Resus lines restock the cart from the Main window.
- **Done when:** scenario S4 passes.

### F5. Nurse tasks and the medicine chart
**Fits:** nursing tasks / MAR.

- **Tasks created by prescribing:** for example, "Insert an IV cannula" when an IV medicine is prescribed and no line is recorded. The nurse records the size and site, and the line is saved to the patient.
- **Given or Withhold:** each dose has Given and Withhold. Withhold needs a reason.
- **Results on a task:** a result entered on a task saves to results and completes the lab order.
- **Protocols running:** the list links into each chart (F7).
- **Done when:** scenario S5 passes.

### F6. Quick protocols inside Prescribe
- **Mode switch:** the dialog has "Medicines | Protocols · N". Protocols are grouped:

  | Group | Protocols |
  |---|---|
  | Diabetes and metabolic | DKA, HHS, sliding scale |
  | Blood pressure and heart | Labetalol |
  | Obstetric emergencies | Magnesium |
  | Severe infection | Severe malaria |
  | Seizures | Status epilepticus |
  | Electrolytes | Hyperkalaemia |
  | Poisoning | Organophosphate, paracetamol |
  | Your hospital protocols | Your own protocols, as drafts |

  Each protocol shows "Signed off · date" or "Draft".
- **Starting values:** taken from results with their source and time, or ordered when missing. "Use the result on file" or enter one.
- **Protocol checks:**
  - indication confirmed
  - already running (a second run must be on purpose)
  - IV access
  - allergy (needs a senior override)
  - adult or child protocol
  - potassium rules that change the plan, for example DKA potassium under 3.3 holds the insulin and changes the fluids
- **The plan:** a flow chart or step list, with each dose worked out for this patient and "Before each dose" checks.
- **Pharmacy supply:** what the pharmacy supplies for the first period.
- **Full chart:** for the 10 protocols in F9, "Open the full chart" goes to F7.
- **Protocol builder:** a hospital builds its own protocol from steps:
  - **Step types:** Give, Infusion, By result, Check, Rule.
  - **Each step has:** medicine, dose and unit, start minute, repeat every, how many times, volume, over how long, strength, checks before each dose, a doubling flag, and for "By result" steps the result, its unit and a range table ("<4: …").
  - **Saving:** it saves as a draft with a live preview for the current patient.
  - **Starting:** a draft cannot start until it is signed off.
- **Done when:** scenario S6 passes.

### F7. Protocol chart engine and screens
**Fits:** a new Protocols area, linked from the patient record, the nurse task area and the Prescribe protocol list.

- **Header:**
  - the protocol title and source line ("… · prototype values, need local sign-off" until signed)
  - the patient, the start time, how long the chart has run, and the current phase
  - a protocol picker and a patient picker (only eligible patients; the protocol's demo patient comes first, then those already on it)
  - stat tiles (5 to 7 a protocol), a "Recent" log line, and aims marked Met / Not met / —
- **Roles:** Doctor, Nurse or Pharmacy, from the signed-in user.
  - **Doctor:** prescribes, makes every change, and chooses what is monitored.
  - **Nurse:** carries out the actions and records.
  - **Pharmacy:** sees the drug orders and what is coming.

  A button that belongs to another cadre shows as a grey "Nurse · …" or "Doctor · …" label and cannot be pressed.
- **Two screens** per role, with a large switch: "Steps and orders" (doctor) or "Tasks and recording" (nurse), and "Monitoring chart". The badges show how many steps need you, how many tasks are due, and the current time.
- **Doctor, Steps and orders:**
  - **Steps column:** "Flow chart | List".
  - **The flow chart is smart:**
    - It shows phase headings with a Now marker, step boxes, and decision diamonds with their branches.
    - The patient's path is filled in from live data: the branch taken is teal, a branch not taken is an outline, and a branch not known yet is grey.
    - Step colours: done is green, needs you is amber, to do is grey, and later phases are greyed out.
    - Tap a box to open that step.
  - **The open step:** title, status (To do / Needs you / Done), Previous / Next, and any of:
    - value fields fetched from results, showing the source, reference range and a colour flag (Normal / Low / High / Critical) with a reason
    - "Order …" for a missing result
    - criteria marked Met / Not met / Needs a value
    - rows
    - branches marked "This patient"
    - checklists with a status and buttons
    - chips (single or multiple choice)
    - lines (ok, warn, alert)
    - action buttons
  - **Medicines column:** the drug order with live stock (F7 stock), "Sign and send to the pharmacy", notes.
- **Nurse, Tasks and recording:**
  - **Nurse tasks:** sorted by due time, each marked "Due now", "Overdue N" or "At hh:mm", with one-tap buttons.
  - **Record form:** for the next time slot, with rates pre-filled from the chart, and saved per slot. Values typed here save to results and close pending orders.
  - **The protocol's check card:** for example "Before each dose", or "Is the patient still fitting?".
  - **Medicines status.**
  - **Notes.**
- **Pharmacy view:**
  - **Drug orders:** each line with its quantity, status, and live stock at Ward 4B and the Main window.
  - **What the chart needs:** what is due next, with times, and when the next item will be needed.
  - **Monitoring chart:** read only.
- **Monitoring chart (all roles):**
  - **Trends:** one small panel per measure, sharing one time axis (never a second y-axis). Each panel has:
    - threshold lines with labels, kept apart when they are close
    - a dashed "target" line where the protocol has a rate target
    - a "now" marker
    - dots flagged when out of range
    - the latest value and a status ("On target", "Too fast", and so on)
  - **Vitals card (full width):**
    - BP, pulse, RR and GCS, plus any parameter the doctor adds with "+ Add a parameter" (suggestions include SpO₂, temperature, pain, capillary refill, AVPU, pupils)
    - each tile has a mini trend chart with a normal band, flagged dots and the change since the first reading
    - the nurse enters a whole set in one row; GCS is entered as E (1–4), V (1–5) and M (1–6) and totalled
    - "Next due / Overdue"
  - **Time grid:** columns per slot (5 min to 6 h depending on the protocol), the current column highlighted, cells colour-flagged, and dashed cells where a value is due.
- **Engine behaviour:**
  - status is derived from events and values, never stored
  - briefs summarise each step in one line
  - nurse tasks are generated with due times
  - targets are worked out from at least 2 readings
  - the chart ends with a reason and can be reopened
  - running charts are listed in the nurse area, for example "Magnesium chart · Achieng Esther · 4 h on the chart · last charted 3 h"
- **Done when:** scenarios S7–S9 pass.

### F8. Shared monitoring rules
- **Values from results:** results on file fill fields with their source ("lab, today 07:40"). Missing ones can be ordered by group:
  - venous gas
  - U&Es
  - chloride
  - lab glucose
  - capillary glucose and ketones
  - creatinine
  - LFTs and INR
  - paracetamol level
  - haemoglobin
- **Reference ranges and colour flags** (`REFS`): every lab and vital value is interpreted with its own reference range and a reason line, for example "Over 6: a sign of severe DKA".
- **Weight:** if no weight is recorded, the chart asks for it and saves it to the patient before any weight-based dose.
- **IV access:** with no line on record, the doctor sees "Request an IV cannula" and the nurse gets the task.

### F9. The 10 protocol charts
See §2 for the rules. Each one is a rule module plus a signed version. Ten protocols:
- DKA
- HHS
- hyperkalaemia
- hypertensive emergency (labetalol)
- severe pre-eclampsia (magnesium)
- severe malaria (artesunate)
- status epilepticus
- organophosphate poisoning
- paracetamol overdose
- correctional (sliding-scale) insulin

---

## 2. Protocol rule sheets (seed values; need sign-off)
Time slot = one column of the monitoring chart. "Doctor", "Nurse" and "Pharmacy" mark who acts.

### 2.1 DKA (adult, JBDS) · slot 1 h × 24
- **Confirm (all 3 needed):**
  1. Glucose over 11, or known diabetes.
  2. Blood ketones over 3, or urine ketones 2+ or more. The doctor switches between capillary and urine ketones.
  3. Venous pH under 7.3 and/or bicarbonate under 15.
- **Severe, so inform the HDU or ICU** (Doctor) **if any of:**
  - ketones over 6
  - pH under 7.1
  - bicarbonate under 5
  - potassium under 3.5
  - GCS under 12
  - SpO₂ under 92%
  - systolic under 90
  - pulse over 100 or under 60
- **Baseline:**
  - sodium, potassium, urea, chloride, lactate, lab glucose, GCS, EWS
  - creatinine and eGFR
  - anion gap (Na − (Cl + HCO₃); raised if over 16)
- **Investigations:** ECG, CXR, MSU, βhCG (women 12 to 55), blood cultures, VTE prophylaxis. Stool and CT head only if indicated.
- **Precipitating cause:** pick all that apply (infection, missed insulin, new diabetes, …) → "Prescribe for the cause".
- **Shock (systolic under 90):** 500 ml 0.9% NaCl over 15 minutes; repeat if still under 100. Otherwise 1 L over 1 hour. Inform the senior.
- **Insulin:** fixed-rate IV soluble insulin 0.1 units/kg/h, no more than 15 to start; 50 units in 49.5 ml = 1 unit/ml. Continue long-acting insulin (Doctor picks which). IV access and weight are needed first.
- **Potassium in each litre from bag 2:**

  | Potassium | KCl in each litre |
  |---|---|
  | Over 5.5 | None |
  | 3.5 to 5.5 | 40 mmol |
  | Under 3.5 | Senior advice |

  - Potassium under 3.3: hold the insulin, and put potassium in bag 1.
  - Over 20 mmol an hour of potassium: cardiac monitor.
  - Anuric: no KCl.
- **Reassess triggers:**

  | Trigger | Action |
  |---|---|
  | Urine under 0.5 ml/kg/h | Catheterise |
  | Vomiting or reduced GCS | NG tube |
  | SpO₂ under 94% | Arterial gas and CXR |
  | pH under 7.3 at 6 h | Consider other causes |
  | GCS under 13 | CT head |

  Then a senior review.
- **Monitoring:**
  - hourly: glucose, ketones, fluids, urine
  - venous gas: at 2, 4, 6, 12 and 18 h
  - U&Es: at 6, 12 and 24 h
- **Fluids:**

  | Bag | Over | Rate |
  |---|---|---|
  | 1 | 1 h | 1,000 ml/h |
  | 2 | 2 h | 500 ml/h |
  | 3 | 2 h | 500 ml/h |
  | 4 | 4 h | 250 ml/h |
  | 5 | 4 h | 250 ml/h |
  | 6 | 6 h | 166 ml/h |

  - The nurse marks each bag "Hung now"; it shows overdue if not.
  - Glucose under 14: add 10% glucose at 125 ml/h.
  - Caution in the elderly, young adults, heart failure, ESKD and pregnancy.
- **Targets:**
  - ketones fall at least 0.5 an hour
  - bicarbonate rises at least 3 an hour
  - glucose falls at least 3 an hour (until under 14)
  - If off target: the nurse checks the lines and pumps → then the doctor can raise the insulin by 1 unit/h → the nurse sets the pump. There is no second rise within 1 h.
- **Hypoglycaemia (under 4):** 150 ml 10% glucose over 15 minutes, recheck in 15 minutes (nurse task).
- **6 to 12 h:** reassess circulation; refer to the diabetes team.
- **Resolution:**
  - pH over 7.3 and blood ketones under 0.3 (in urine mode: bicarbonate over 15)
  - then SC insulin if eating, or a variable-rate infusion
  - then end the chart
  - not resolved by 24 h: senior review
- **Order:** NaCl 6 bags, soluble insulin, KCl ampoules, 10% glucose.

### 2.2 HHS (adult, JBDS-IP) · slot 1 h × 24
- **Confirm (all 4 needed):**
  1. Hypovolaemia (Doctor).
  2. Glucose 30 or more.
  3. Osmolality (2Na + glucose + urea) 320 or more.
  4. Ketones under 3, pH 7.3 or more, and bicarbonate 15 or more.
  - Ketones 3+ with acidosis means mixed DKA and HHS → "Open the DKA chart".
- **High risk, so HDU/ICU, if any of:**
  - osmolality over 350
  - sodium over 160
  - pH under 7.1
  - potassium under 3.5 or over 6
  - GCS under 12
  - SpO₂ under 92%
  - systolic under 90
  - pulse over 100 or under 60
  - urine under 0.5 ml/kg/h
  - creatinine over 200
- **Fluids:** systolic under 90 → 500 ml boluses; otherwise 1 L over 1 h. Then bags at 500, 500, 250, 250, 166 and 166 ml/h.
- **Fluid balance:** worked out from the chart. Aim for +2 to 3 L by 6 h and +3 to 6 L by 12 h; behind target → alert.
- **Insulin:** only if ketones are over 1.5, or the glucose plateaus (falls under 1 an hour) on fluids. Rate 0.05 units/kg/h, rounded. The Doctor prescribes it; the Nurse starts it.
- **Potassium:** as DKA, no more than 10 mmol an hour.
- **Tests:** ECG, CXR, cultures, MSU; CK, troponin and CT if indicated.
- **Protection:** LMWH (Nurse "Given") and daily foot checks.
- **Cause:** chips.
- **Targets:**

  | Measure | Target | If off target |
  |---|---|---|
  | Glucose | Falls no more than 5 an hour | Too fast: halve the insulin, or slow the fluids |
  | Osmolality | Falls 3 to 8 an hour | Over 8: slow the fluids. Under 3 with +2 L: consider 0.45% NaCl (Doctor) |
  | Sodium | Falls no more than 10 in 24 h | Slow the correction |

  An early rise in sodium is expected.
- **Glucose under 14:** 10% glucose at 125 ml/h. Keep the glucose at 10 to 15.
- **Monitoring:** hourly glucose, fluids and urine; Na, K and urea at 1, 2, 4, 6, 12 and 24 h. Osmolality is derived on save.
- **Resolution:** osmolality under 300, urine at least 0.5 ml/kg/h, mental state back to usual, glucose under 15 → SC insulin or tablets → end. Recovery can take up to 72 h.

### 2.3 Hyperkalaemia (adult, UKKA) · slot 15 min × 24
- **Grade:**

  | Potassium | Grade |
  |---|---|
  | 5.5 to 5.9 | Mild |
  | 6.0 to 6.4 | Moderate |
  | 6.5 or more | Severe |

  Record the ECG findings (chips). Emergency = 6.5 or more, or ECG changes. Cardiac monitor (Nurse). A haemolysed sample → repeat, but do not wait if the ECG has changed.
- **Calcium gluconate 10%:** only with ECG changes. 10 ml (1 g) IV over 5 to 10 minutes; repeat every 10 minutes while the changes last, up to 3 g. The Doctor marks "ECG back to normal". With digoxin, give it over 30 minutes.
- **Insulin with glucose:** if 6.0 or more, or ECG changes. 10 units soluble insulin in 50 ml of 50% glucose over 15 minutes. If the glucose before was under 7, add 10% glucose at 50 ml/h for 5 h.
- **Salbutamol:** 10 or 20 mg nebulised, or "Not suitable" (Doctor picks). A fast pulse → warning.
- **Watch:**
  - glucose at 15, 30, 60 and 90 min, then hourly to 6 h; under 4 → treat
  - potassium at 1, 2, 4 and 6 h

  | Potassium on recheck | Action |
  |---|---|
  | 6.5 or more | Repeat insulin with glucose + renal team |
  | 6.0 to 6.4 | Repeat insulin with glucose |
  | Under 6 | Keep checking |
- **Remove:**
  - stop ACEi/ARB, spironolactone, potassium supplements, NSAIDs, trimethoprim and beta-blockers (home medicines flagged)
  - potassium binder
  - low-potassium diet
  - renal team if eGFR is under 30 or the potassium stays high
  - bicarbonate if acidotic (senior)
- **Resolution:** under 5.5 with a normal ECG → recheck within 24 h → end.

### 2.4 Hypertensive emergency: IV labetalol (adult) · slot 10 min × 18
- **Emergency:** BP 180/120 or more with new organ damage (chips: confusion or seizures, stroke or bleed, lung oedema, chest pain, dissection, AKI, retinopathy, pre-eclampsia). Without organ damage it is urgency → oral treatment → end.
- **Safe for labetalol?** Not with asthma or COPD, heart block, acute heart failure, cocaine or amphetamine, or pulse under 60. If not safe → senior picks another drug.
- **Target:** MAP0 = (sys + 2·dia)/3. First hour: about −15% (the aim), never below −25% (the floor). Then 160/100 by 2 to 6 h.
  - Dissection: systolic under 120 within 20 minutes, pulse under 60.
  - Stroke: follow the stroke team.
  - Pregnancy: 140–150 / 90–100.
- **Boluses:**
  - 20, then 40, then 80, 80, 80 mg IV over 2 minutes, every 10 minutes, while the MAP is above the aim; total no more than 300 mg (Nurse gives).
  - **Stop if:** MAP under the floor (lie flat, call the senior), pulse under 60, or wheeze.
  - The Doctor can switch to an infusion of 1 to 2 mg/min (1 mg/ml), or stop the boluses.
- **Then:** step down to oral treatment (Prescribe) and look for the cause.
- **Controlled:** 160/100 or less after at least 1 h → end. Then BP every 30 minutes for 6 h.
- **Monitoring:** systolic, diastolic and pulse every 10 minutes; MAP derived; doses shown in the grid.

### 2.5 Magnesium sulphate, Pritchard (women 12 to 55, pregnant) · slot 1 h × 24
- **Confirm:**
  - Eclampsia = a fit.
  - Severe pre-eclampsia = 160/110 or more, or 140/90 with a severe feature.
- **Loading** (Nurse, two buttons):
  - 4 g IV over 5 to 10 minutes: 8 ml of 50% + 12 ml water for injection.
  - 10 g deep IM: 5 g in each buttock, with 1 ml 2% lidocaine in each syringe.
- **If she fits again:** 2 g IV over 5 minutes.
- **BP 160/110 or more:** treat (open the labetalol chart, or nifedipine/hydralazine). Aim for 140–150 / 90–100.
- **Tests:** FBC/platelets, LFTs, U&E, urine protein, clotting (if indicated), fetal heart; urinary catheter.
- **Delivery plan:** after a fit within 12 h; otherwise within 24 h.
- **Maintenance:** 5 g IM every 4 h, alternating buttocks. **Each dose is blocked unless:**
  - breathing is 16 a minute or more
  - knee reflexes are present
  - urine is 100 ml or more in the last 4 h

  If any check fails → withhold and call the doctor.
- **Toxicity:** breathing under 12 → stop the magnesium, give calcium gluconate 1 g IV over 10 minutes, ventilate if needed.
- **Stop:** 24 h after the delivery or the last fit, whichever is later. The Doctor records the delivery; fits are recorded by the Nurse.
- **Hourly monitoring:** breathing, reflexes (1/0), urine, BP.

### 2.6 Severe malaria: IV artesunate (any age) · slot 4 h × 18
- **Confirm:** a positive mRDT or smear, plus at least one danger sign:
  - impaired consciousness, prostration, 2+ fits, acidotic breathing
  - shock, severe anaemia, hypoglycaemia, jaundice, dark urine
  - bleeding, lung oedema, AKI

  If the test is not done yet, give dose 1 now and send the test.
- **Dose:**
  - Under 20 kg: 3 mg/kg. 20 kg or more: 2.4 mg/kg.
  - Make up each 60 mg vial with 1 ml bicarbonate, then +5 ml for IV (10 mg/ml) or +2 ml for IM (20 mg/ml). Show the vials and the volume.
  - Route IV or IM (Doctor).
- **Doses:** at 0, 12 and 24 h, then every 24 h while the patient cannot swallow (at least 3 doses).
- **Treat the dangers:**
  - glucose under 3 → child 10% glucose 5 ml/kg; adult 50 ml 50%
  - fits → seizure chart
  - Hb under 5 (child) or under 7 (adult) → transfuse
  - antibiotics if sepsis or meningitis is possible
  - maintenance fluids only
- **Every 4 h:** glucose, temperature, consciousness, urine.
- **Switch:** at least 3 doses and able to swallow → full 3-day artemether/lumefantrine by weight → end. Check Hb at day 7 and day 14 (delayed haemolysis).

### 2.7 Status epilepticus (any age) · slot 5 min × 12
- **Stabilise:** airway, oxygen, on the side, IV/IO access, nothing in the mouth (Nurse chips). Check the glucose first:
  - child under 3 → 10% glucose 5 ml/kg
  - adult under 4 → 50 ml of 50% glucose (thiamine first if alcohol is likely)
  - pregnant → the magnesium chart
- **Diazepam:**
  - adult 10 mg IV slowly, or 10–20 mg rectally
  - child 0.3 mg/kg IV (max 10 mg), or 0.5 mg/kg rectally (max 10 mg)
  - repeat once after 10 minutes if still fitting (max 2 doses)
- **Phenobarbital:** if still fitting 10 minutes after the 2nd diazepam. 20 mg/kg IV (max 1 g), diluted 1 in 10, over at least 20 minutes. Have ventilation ready.
- **Cause:** missed medicines, infection, cerebral malaria (→ malaria chart), low glucose, eclampsia, alcohol, head injury. Malaria test and electrolytes; LP and CT if indicated.
- **Refractory (still fitting at 30–40 minutes):** anaesthetist and ICU.
- **The Nurse card "Is the patient still fitting?"** has "Fitting stopped" and "Fitting again". Every later step depends on it.
- **After the fit stops:** recovery position; observations every 15 minutes; maintenance anticonvulsant (Prescribe) → end.

### 2.8 Organophosphate poisoning (any age) · slot 5 min × 24
- **Recognise:** small pupils, sweating, secretions, wheeze, slow pulse, vomiting or diarrhoea, twitching, drowsiness (2 or more → treat). Agent: OP, carbamate, or not known.
- **Airway first:** suction, oxygen, left side head down, IV, decontaminate (staff wear gloves). No lavage unless within 1 h with a protected airway. Intubate if GCS is 8 or less, or breathing fails.
- **Atropine:**
  - adult 2 mg IV; child 0.02 mg/kg (min 0.1 mg)
  - **double the dose every 5 minutes** until atropinised (Nurse gives; shows the next dose and its time)
- **Atropinised = all 5:**
  1. chest clear
  2. pulse over 80
  3. systolic over 80
  4. dry armpits
  5. pupils not pinpoint

  The Doctor may call it at 3 or more if the chest is clear. The 5 signs are taken from the last check.
- **Infusion:** 10–20% of the total atropine needed, every hour (Doctor picks the %).
- **Too much atropine:** confusion, fever, no bowel sounds, a full bladder → stop for 30 minutes, then restart at 80%.
- **Late weakness (intermediate syndrome):** check neck flexion and breathing every 4 h → ICU. Pralidoxime only by hospital policy.
- **Review at 24 h:** taper. Before discharge, a mental health assessment if the ingestion was intentional.

### 2.9 Paracetamol overdose: acetylcysteine 21 h (any age) · slot 1 h × 24
- **Assess:** hours since the overdose, amount (g) → mg/kg (weight capped at 110 kg); single time, staggered (over more than 1 h), or time not known.
- **Level:** taken at 4 h or later. Treatment line = 100 mg/L at 4 h, halving every 4 h, up to 24 h. A level taken before 4 h cannot be read.
- **Bloods:** ALT, INR, creatinine, glucose, venous gas.
- **Treat if any of:**
  - the level is on or above the line
  - staggered, or the time is not known
  - 8 h or more since a dose of 150 mg/kg or more (start now; do not wait for the level)
  - abnormal LFTs

  **Otherwise:** wait for the 4 h level (under 8 h, single time), or no treatment → mental health review → end.
- **Bags:**

  | Bag | Dose | In | Over | Rate | Starts |
  |---|---|---|---|---|---|
  | 1 | 150 mg/kg | 200 ml | 1 h | 200 ml/h | Now |
  | 2 | 50 mg/kg | 500 ml | 4 h | 125 ml/h | When bag 1 ends |
  | 3 | 100 mg/kg | 1,000 ml | 16 h | 62.5 ml/h | When bag 2 ends |

  Each bag shows the mg, the 200 mg/ml volume and the ampoules (Nurse starts each).
- **Reaction:** flushing, itch, wheeze or low BP is not an allergy. Pause, give an antihistamine, and restart when settled (Doctor).
- **End of bag 3:** check INR, ALT, creatinine, pH and glucose.
  - INR over 1.3 or ALT 100 or more → continue at the bag 3 rate and repeat every 12 h.
  - Liver unit criteria: pH under 7.3, INR over 3, creatinine over 200.
  - Otherwise medically fit → mental health review → end.

### 2.10 Correctional (sliding-scale) insulin (adult) · slot 6 h × 8
- **Scale:**

  | Scale | Use for | Suggested when |
  |---|---|---|
  | Low | insulin-sensitive patients | eGFR under 30, aged 75 or more, eating little |
  | Medium | most patients | |
  | High | infection, steroids, high usual doses | infection on the problem list |

  This is the hospital's signed scale. **The seed bands are an example:**

  | Glucose (mmol/L) | Low | Medium | High |
  |---|---|---|---|
  | Under 4 | none, hypoglycaemia | none, hypoglycaemia | none, hypoglycaemia |
  | 4 to 10 | none | none | none |
  | 10.1 to 14 | 2 units | 4 units | 6 units |
  | 14.1 to 18 | 4 units | 6 units | 8 units |
  | 18.1 to 22 | 6 units | 8 units | 10 units |
  | Over 22 | 8 units | 10 units | 12 units |

  Over 22 also means: check ketones and call the doctor.
- **Suitable?** Only for patients who are eating.
  - Nil by mouth → variable-rate infusion.
  - Ketones 3 or more with glucose over 11 → the DKA chart.
  - Type 1 diabetes: never stop the basal insulin.
- **Usual medicines:** Continue or Hold each one. Hold metformin if eGFR is under 30 or the patient is acutely unwell.
- **Suggested dose (live):** when the nurse types a glucose in Record, "Units given" fills in from the scale. The nurse card, the doctor's step, the header tile and the task all show "Give N units soluble insulin SC", with the scale and the patient's band highlighted. The nurse can overwrite the units, and what is saved is what was given.
- **Checks:** before breakfast, lunch, supper and bedtime. Ketones if the glucose is over 14.
- **Review:** 2 or more readings over 14 in a day → add or raise the basal insulin. Any reading under 4 → move down a scale.
- **At 48 h:** average glucose and total correction insulin → regular regimen → end.

---

## 3. Safety rules (non-negotiable)
- **P1 [DB]:** a chart can start only from a **signed** protocol version (two clinician signatures). Drafts preview only.
- **P2:** role gates are enforced server-side.
  - **Doctor only:** start, end, reopen, rates and doses, choices of what to give, adding monitoring parameters, orders, sign and send.
  - **Nurse only:** given, hung, started, recording observations and vitals, fitting stopped.
  - **Pharmacy:** read, plus supply.
- **P3 [DB]:** `chart_event` is append-only (a trigger blocks UPDATE and DELETE). A correction is a reversal event with a reason.
- **P4:** no clinical number lives in UI code. Every dose, threshold, band and interval comes from the protocol version, and the version id is stored on every event.
- **P5:** values on the chart show their source and time. A value typed on the chart saves to results with the source "entered on the <protocol> chart" and completes pending orders.
- **P6:** blocking rules are enforced in the action, not only shown:
  - magnesium dose checks
  - DKA insulin held when potassium is under 3.3
  - labetalol held when the pulse is under 60 or the MAP is under the floor
  - no bolus over 300 mg labetalol
  - diazepam at most 2 doses
  - a second DKA insulin rise within 1 h is blocked until the nurse confirms the lines and pumps
- **P7:** weight-based doses need a recorded weight. The calculation (dose × kg, caps) is shown wherever the dose is shown.
- **P8:** derived status (Done / Needs you, flow path, targets) is recomputed from events and is never stored as truth.
- **P9:** time comes from the server clock. The prototype's clock shift exists only in tests and dev.
- **P10:** demo patients exist only in dev seeds.
- **P11:** offline: the nurse can record and give doses offline (with idempotency keys); doctor rate and dose changes need a connection.
- **P12:** every chart screen shows "prototype values, need local sign-off" until the version is signed, and the protocol's source line.

---

## 4. Acceptance scenarios (also the demo script; fictional patients)
1. **S1:** Clinic visit → Prescribe amoxicillin for Mugisha Ivan (3 y, 13 kg) → the weight-band dose and quantity are right → send → the line shows "Waiting at pharmacy".
2. **S2:** Ward round, Namusoke Grace (penicillin allergy, creatinine 168) → ceftriaxone shows the cross-reactivity check; gentamicin shows the kidney check with eGFR → override with a reason → the pharmacy sees "Prescriber saw".
3. **S3:** Close Prescribe with 2 lines → "Draft not sent" → Resume → both lines are back.
4. **S4:** The pharmacy queries a line → the prescriber answers "Change it" → the pharmacy hands over with the ID and counselling confirmation. A controlled line needs a witness. A resus line restocks the cart.
5. **S5:** IV ceftriaxone for a patient with no line → a nurse task "Insert an IV cannula" → the nurse records 18G, left forearm → the line shows on the patient.
6. **S6:** Prescribe › Protocols › DKA for Namusoke Grace → starting values come from results; potassium 3.2 holds the insulin and changes the plan → sign and send. A builder draft can be previewed but not started.
7. **S7:** The DKA chart runs as in the prototype tests:
   - HDU informed
   - IV request → the nurse inserts the line
   - lines and pumps checked → insulin +1 unit/h → the nurse sets the pump
   - hypoglycaemia recorded → a nurse task appears
   - a resolving hour → SC insulin → the chart ends → no nurse tasks remain
8. **S8:** Role gates: the nurse cannot raise the insulin (blocked server-side); the doctor cannot mark a bag hung; the pharmacy can only read.
9. **S9:** The monitoring chart shows trends, the vitals card (GCS E/V/M totalled, plus an added SpO₂ parameter) and the grid with dashed due cells, at 1440 px and 390 px.
10. **S10:** One walk-through per protocol, in the HHS, hyperkalaemia, labetalol, magnesium, malaria, seizure, OP, paracetamol and sliding-scale charts:
    - Kato Joseph: HHS osmolality 369.7 → high risk → fluids → glucose plateau → insulin 4 units/h.
    - Nakato Sarah: potassium 7.1 with peaked T waves → calcium ×1 → insulin with glucose → recheck 5.2 → end.
    - Nambi Rose: 214/124 → boluses 20, 40, 80, 80 → MAP 130, at the aim (131).
    - Achieng Esther: loaded → the dose is blocked when breathing is 11 → calcium gluconate.
    - Mugisha Ivan: 39 mg × 3 doses → can swallow → AL.
    - Tumusiime Alex: diazepam 6.6 mg → 2nd dose → phenobarbital 440 mg → refractory alert at 40 minutes.
    - Ouma Daniel: atropine 2, 4, 8, 16 mg → all 5 signs → infusion 4.5 mg/h.
    - Nabirye Joan: 5 h ago, level 120 at 5 h (line 84) → treat → bags 7,800, 2,600 and 5,200 mg.
    - Sliding scale, Namusoke Grace: medium scale, glucose 16.2 → 6 units suggested and saved.
11. **S11:** A running chart appears in the nurse area and on the patient record, and opens in the right protocol.
12. **S12:** Offline: the nurse records an hour and gives a dose offline → it syncs once, with no duplicates.

## 5. Open decisions: build the default, keep it switchable
| Decision | Default |
|---|---|
| Who signs a protocol version | 2 consultants (or the DTC chair and one consultant) |
| Where protocols live in the navigation | patient record › Protocols tab, plus a ward-level "Protocols running" list |
| Ketone meter not available | allow urine ketones (DKA), with the bicarbonate-based resolution |
| Vitals storage | reuse the existing vitals table, tagged with the chart id |
| Pharmacy supply | one signed order per chart for the first period; repeats as top-up orders |
| Sliding-scale bands | hospital-editable table in the protocol version, seeded with the example |
| Slot length | per protocol, as in §2, stored in the version |
