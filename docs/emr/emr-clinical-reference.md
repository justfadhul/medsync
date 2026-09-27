# MedSync — EMR Clinical Documentation Reference v1.0

### The medicine behind the Encounter/EMR engine

> **Doc ID** MS-EMR-CLIN-001
> **Status** DRAFT for CSO sign-off (GATE A). Stage 1: drafted, checked against the sign-off register in [12], revised.
> **Pairs with** PROMPT-ENCOUNTER-EMR (the engineering), MS-DATA-CFC-001 (the data contract) and `clinical-fact-concepts.v1.json`.
> **Rule** This document holds no clinical threshold. Critical-result limits, age ranges, HMIS definitions and IDSR classes are named references (REF-…) that are filled from verified sources and signed, the discipline the resus and NCD catalogues already use.

---

## [00] Scope and how to sign

This reference defines:
- what a MedSync clinical record must contain;
- how each note type is structured;
- which items become structured facts;
- the rules for findings, diagnoses, allergies, medicines, orders and results.

It follows the standard clerking structure taught in Ugandan medical schools. Each template should be checked against the clinical-methods textbooks you attach before signing. Each section ends with the items that need a signature, and [12] collects them in one register.

---

## [01] Documentation principles

1. **Contemporaneous and attributable.** Author, cadre and recorded time are captured automatically. Effective time (when it happened) is separate from recorded time (when it was written).
2. **Sourced.** Every structured item says where it came from: history, examination, patient self-report, a result or a record.
3. **Pertinent negatives are explicit.** Absent is recorded as absent. A question not asked leaves nothing behind.
4. **No narrative copy-forward.** Copied notes propagate errors and bury what changed. Structured items (problems, allergies, medicines) carry forward only with a one-tap confirmation.
5. **Corrections never erase.** Corrections are made by addendum, or by marking entered in error with a reason. The original stays visible.
6. **Who gave the history, and in what language.** Record the historian (patient, carer, relative, referral letter), the language of the consultation, and any interpreter (name and relationship to the patient).
7. **Consent and chaperones.** Record consent for procedures, and the chaperone for intimate examinations.
8. **Units on every value.** Plain language, standard abbreviations only, and a unit on every number.
9. **Sensitive information** is recorded where care needs it, and marked restricted ([10]).

**Signature:** principles 1–9.

---

## [02] Note types and templates

Sections are numbered as they appear on screen. "Structured" lists the items that become facts. Everything else is narrative, encrypted and never read by engines.

### 2.1 Adult outpatient clerking

Every clerking opens with one header line: historian, language of consultation and interpreter (principle 6). These are structured items, so the record shows whose account it is.

| # | Section | Structured items |
|---|---|---|
| [01] | Presenting complaint | Complaint tokens, each with a duration; or a visit reason for review visits |
| [02] | History of presenting complaint | Finding tokens (present or absent), onset, course; exposure history (travel, contact with a person with a suspected infectious illness, animal exposure, funeral attendance) as tokens from the signed IDSR screening list |
| [03] | Review of systems | A grid per system (general, cardiovascular, respiratory, gastrointestinal, genitourinary, neurological, musculoskeletal, skin, ear/nose/throat and eyes, and gynaecological where it applies); every item defaults to "not asked" |
| [04] | Past medical history | Problem list (confirm or add); previous admissions (narrative) |
| [05] | Past surgical history and transfusions | Procedure history; blood transfusions with date (an HbA1c validity modifier) |
| [06] | Medicines | Current medicines confirmed ([06]), including herbal, traditional and over-the-counter medicines |
| [07] | Allergies | Allergy status ([05]) |
| [08] | Family history | Conditions with relationship (for example diabetes, hypertension, sickle cell disease, cancer) |
| [09] | Social history | Tobacco, alcohol, occupation, living situation, physical activity |
| [10] | Obstetric and gynaecological history | The module in 2.4, for patients whose recorded sex at birth is female, within the signed age range |
| [11] | Examination | General: pallor, jaundice, cyanosis, clubbing, lymphadenopathy, oedema and dehydration, each present, absent or not examined. Vital signs (shown from observations; add if missing). Anthropometry (weight, height, waist, MUAC). Systems: cardiovascular, respiratory, abdomen, neurological, musculoskeletal, skin, ENT and eyes, breasts, genitourinary, rectal and vaginal (chaperone recorded). |
| [12] | Summary | Narrative only |
| [13] | Impression | Diagnoses ([04]): working or final, differentials, one primary |
| [14] | Plan | Orders, prescriptions, procedures, counselling and education, referral, follow-up |

Disposition is recorded when the visit is completed (prompt, Section 5.10).

### 2.2 Emergency clerking
Used when the patient came through a high-acuity triage level or resus.

| # | Section | Structured items |
|---|---|---|
| [01] | Primary survey summary | ABCDE findings, linked to the resus episode if there was one (never re-entered) |
| [02] | AMPLE | Allergies (the allergy record); Medicines; Past history (problem list); Last meal (time; a glucose context item); Events |
| [03] | Secondary survey | Examination findings as in 2.1 [11] |
| [04] | Reassessment | Vital-sign series (observations) with times |
| [05] | Impression and plan | As in 2.1 [13] and [14] |

### 2.3 Paediatric module (patients under 16)
It adds history sections and contains no dosing; the platform's under-16 limits apply to every engine.
- **Historian and caregiver.** Relationship to the child. The minor and guardian model is an open GATE A decision.
- **Birth history.** Gestation at birth, birth weight, and neonatal problems.
- **Immunisation.** Status against the national schedule (UNEPI), including whether the card was seen. The schedule itself is a signed reference; the full immunisation record is v1.1.
- **Nutrition.** Breastfeeding, complementary feeding and appetite.
- **Growth.** Weight, length or height, MUAC and head circumference. Z-scores against WHO growth standards come in v1.1.
- **Development.** Milestones for age, recorded as achieved, delayed or not assessed.

### 2.4 Obstetric and gynaecological module
- **Pregnancy dates.** Last normal menstrual period, with its certainty (sure or unsure).
- **Pregnancy status.** Pregnant, not pregnant, or not known, with the test if one was done.
- **Obstetric history.** Gravidity and parity; previous pregnancy outcomes, including hyperglycaemia in pregnancy and a baby with a high birth weight (both lifelong risk factors, recorded as pregnancy facts).
- **Contraception** in use.
- **Last cervical screening** (a seam for a later module).

### 2.5 Progress note (SOAP) and ward round
- **Subjective:** narrative plus finding tokens.
- **Objective:** vital signs and results pulled in, never re-typed.
- **Assessment:** the problems addressed, each with its status.
- **Plan:** orders, prescriptions and tasks.

A ward-round note is a progress note tagged with the round and the team present.

### 2.6 Procedure note
- **Before the procedure:** the indication, and consent (verbal or written; given by the patient or a guardian).
- **Time-out:** patient identity with two identifiers, the procedure, the site and side, and allergies checked (WHO patient safety solution 4, correct procedure at the correct body site).
- **The procedure:** operator and assistant; anaesthesia or analgesia; technique; findings; specimens sent (as orders).
- **Afterwards:** complications (none, or described), and post-procedure instructions.

### 2.7 Handover note (ISBAR)
- **Identify:** two identifiers and location.
- **Situation, Background, Assessment:** the patient's current state and its context.
- **Recommendation:** the outstanding tasks, each with an owner.
- **Receiver:** name, and an optional acknowledgement.

This implements WHO patient safety solution 3, communication during patient hand-overs, which recommends a standard protocol and a chance to ask questions. Resus handovers arrive as this note type.

### 2.8 Referral note
Its fields align with the MoH referral note (HMIS form 032); confirm the current form's fields at GATE A:
- referring facility, date, patient identifiers;
- reason for referral, urgency and transport;
- history summary, examination findings, and investigations with their results;
- treatment given and diagnoses;
- current medicines (the reconciled list);
- receiving facility and department;
- referring clinician's name, cadre and council registration number.

It prints with a return-feedback section.

### 2.9 Cause-of-death record
- **Structure:** the WHO international medical certificate of cause of death:
  - Part I: the causal sequence from the immediate cause (a) back to the underlying cause, each with its interval;
  - Part II: other significant conditions;
  - manner of death, and pregnancy status for women;
  - the certifier.
- **Coding:** ICD-11 codes.
- **Seam from resus:** resus close-out creates the intent, and this record fulfils it.
- **Confirm at GATE A:** the current national form, and the notification pathway for maternal and perinatal deaths (MPDSR).

### 2.10 Nursing note
- Narrative, observations, and care given.
- MAR and care plans belong to the inpatient module (out of scope); this note type exists so that nursing documentation lands in the same record.

### 2.11 Minimum to sign

Signing checks only the minimum below. It never blocks care: orders and prescriptions work on an unsigned draft.

| Template | Required to sign | Prompted (warning only) |
|---|---|---|
| Adult outpatient clerking | Presenting complaint or visit reason; impression (at least one diagnosis, or "diagnosis deferred" with a reason); plan (at least one item or a statement) | Allergy status not recorded; no examination recorded |
| Emergency clerking | Primary survey summary; impression; plan | Allergy status not recorded |
| Progress note | Assessment; plan | None |
| Procedure note | Indication; consent; time-out confirmed; procedure; complications (none or described) | None |
| Handover note | Situation; outstanding tasks (or "none") | None |
| Referral note | Reason; summary; receiving facility; urgency | Medicines not reconciled |
| Cause-of-death record | Part I (a); underlying cause; certifier | None |
| Nursing note | Narrative or observations | None |
| Addendum | Text; reason | None |

### 2.12 The standard visit (for measurement)
The scripted visit the build uses to measure effort (taps, keystrokes and seconds) at baseline and after Phase 6:
1. An adult with fever, triaged (L3).
2. The doctor takes the patient and starts the encounter.
3. The doctor confirms "no known drug allergies" and the current medicines.
4. Presenting complaint: fever (3 days) and headache (2 days).
5. Findings: chills present; neck stiffness absent; rash absent.
6. General examination, all seven items.
7. Diagnosis: "Malaria, uncomplicated", working.
8. An mRDT is ordered and collected, and the result entered as positive.
9. The diagnosis is made final.
10. Plan: a prescription (Phase 7) or a plan statement.
11. The note is signed and the visit completed: home, follow-up as needed.

**Signature:** templates 2.1–2.10 (sections and structured items); the minimum-to-sign table 2.11; the measurement script 2.12.

---

## [03] Findings

- **Tokens.** Findings are tokens from the shared catalogue that the differential engine owns. A finding missing from the catalogue is added there, never kept privately.
- **States.** Present, absent or not asked. "Not asked" leaves no fact behind (MS-DATA-CFC-001, C3).
- **Qualifiers,** where they matter: onset, duration, severity, laterality and course.
- **Who reported it.** Every finding records whether it came from the history, the examination or the patient's own report.
- **Exposure history.** Tokens for exposures (travel, contact with a person with a suspected infectious illness, animal exposure, funeral attendance) come from a signed IDSR screening list, so the record and outbreak screening use the same words.

**Signature:** the three-state rule; the exposure token list (REF-IDSR-SCREEN).

---

## [04] Problem list and diagnoses

- **Two lists.**
  - The problem list holds conditions that need ongoing attention, or history important for future care (for example type 2 diabetes, a previous stroke).
  - Encounter diagnoses are this visit's assessment.

  A chronic encounter diagnosis offers "Add to problem list", on by default.
- **Status.**
  - Encounter diagnoses: working (provisional), final (confirmed), differential, or refuted, with the history kept.
  - Problem-list items: active, inactive or resolved.
  - Resolving or refuting needs a reason (for example "resolved after treatment", "excluded by test").
- **One primary diagnosis per visit.** It is the main reason for the visit, and it is what HMIS counts.
- **Honest labels.** Symptom-level diagnoses (for example "fever, cause not yet known") are allowed and preferred to a premature disease label. They prevent anchoring, and they keep the statistics truthful.
- **Test-supported diagnoses.** Where national guidance expects confirmation before treatment, a diagnosis without a supporting result this visit shows a prompt, never a block. Malaria is the first example: UCG 2023 expects parasitological confirmation (confirm the wording and page at signing). The list of such diagnoses is signed (REF-DX-TESTFIRST).
- **Coding.**
  - The clinician picks a MedSync term, and the term carries the codes.
  - ICD-11 is primary: it is free for commercial use under CC BY-ND 3.0 IGO, with codes and titles unmodified and attributed.
  - WHO ICD-10 codes are added only once a WHO licence is recorded.
  - Local synonyms live on the MedSync term, never inside the classification.
- **Notifiable diagnoses.** Terms with an IDSR class show a confirm sheet with the signed action text (for example notify the district surveillance focal person; isolate). They create a pending notification intent and an IPC prompt, and never block.

**Signature:** the rules above; the starter term list with its ICD-11 codes (REF-DX-TERMS); the test-first list (REF-DX-TESTFIRST).

---

## [05] Allergies

- **Definitions.**
  - An allergy is an immune-mediated reaction.
  - An intolerance is a non-immune adverse reaction that still matters for prescribing.
  - A predictable side effect is not an allergy and is not recorded here.
- **Recorded per allergy:**
  - substance (coded where possible);
  - category (medication, food, environment, biologic);
  - reaction manifestations (rash, urticaria, angioedema, anaphylaxis, bronchospasm, Stevens-Johnson syndrome or toxic epidermal necrolysis, other);
  - severity, and criticality (high where there is a risk of a life-threatening reaction, for example after anaphylaxis);
  - verification (unconfirmed, confirmed, refuted);
  - onset and source.
- **Status is always one of four:**
  - listed allergies;
  - "no known drug allergies", an assertion by a named person at a time, re-confirmed with one tap at each new encounter;
  - "unable to assess", for example an unconscious patient (amber);
  - "not recorded" (amber).

  "Not recorded" is never displayed as "no known drug allergies".
- **Uncoded allergens** (text as typed) are shown everywhere, but prescribing cannot check them automatically. Say so on screen, and prompt the clinician to code them.
- **Refuting an allergy** needs a reason (for example "tolerated a full course since"). The refuted entry stays visible in the history.
- **Migration.** Allergies recorded in the resus AMPLE step are migrated with their provenance. From then on, resus writes to the same record.

**Signature:** the definitions, the four status states, the rule on uncoded allergens, and the refutation rule.

---

## [06] Medicines history and reconciliation

- **Sources:** the patient, a carer, a medicine card or book, a dispensing record or a referral letter. Include herbal, traditional and over-the-counter medicines.
- **Reconciliation at every new encounter and transition.** Confirm each current medicine as continued, stopped (with reason) or changed. This follows WHO patient safety solution 6, medication accuracy at transitions in care:
  1. build the most complete list;
  2. compare it with new orders;
  3. communicate it to the next provider.
- **Where the reconciled list travels:** the visit summary and the referral note.
- **Restricted medicines.** Antiretrovirals and antipsychotics carry restricted drug-class tags (MS-DATA-CFC-001, section 8). They appear in clinical views and never on default patient-facing prints.

**Signature:** the reconciliation rule and its outputs.

---

## [07] Orders, specimens and results

### 7.1 Ordering
- Every order has a reason: a diagnosis, or a short text.
- Priority is routine, urgent or immediate.
- The facility test menu decides what can be ordered in-house, and marks each test's specimen, container and fasting requirement.

### 7.2 Specimens
- **Labelling.** Label in the presence of the patient, using two identifiers (Joint Commission NPSG.01.01.01, element 2).
- **Fasting chip.** It appears whenever the order includes a concept whose required context includes fasting state (glucose, for example; MS-DATA-CFC-001, 4.1). The fasting definition shown on the chip is a signed reference.
- **Rejection reasons:** haemolysed, clotted, insufficient, unlabelled or mislabelled, wrong container, delayed. A rejected specimen returns its order to "to collect", with the reason visible to the orderer.

### 7.3 Results
- **Reference ranges.** Each result carries the performing laboratory's own range. MedSync never invents a range.
- **Status.** Preliminary, final, amended or corrected. An amended result asks the orderer to acknowledge again.
- **Entry mode.** Direct (laboratory staff), transcribed (a clinician copying a paper report; lower trust until verified) or interface (reserved for later).
- **Uncatalogued tests** can be recorded as typed. They are displayed, and never read by engines.

### 7.4 Critical results (policy skeleton for signature)
This follows the elements of Joint Commission NPSG.02.03.01: define critical results; say who reports them to whom; set a time frame; evaluate timeliness.
1. **Definition.** A signed list per test, agreed with the laboratory lead (REF-CRIT-*). Until an entry is signed, no value is flagged critical by MedSync; the laboratory's own flag is still displayed as text.
2. **By whom, to whom.** The laboratory person who finds the result tells the ordering clinician. If they cannot be reached, the covering clinician; then the in-charge.
3. **Time frame.** A signed time from the result being available to the responsible clinician being told (REF-CRIT-TIMEFRAME).
4. **Read-back.** The receiver reads the result back, and the laboratory records that it was read back.
5. **Documentation.** Who told whom, how, when, and whether it was read back, recorded in MedSync.
6. **Acknowledgement and escalation.** The responsible clinician acknowledges in MedSync. An unacknowledged critical result escalates to the in-charge after the signed time frame.
7. **Monitoring.** Timeliness is reported to the head of department (a later reporting prompt).

### 7.5 Acknowledgement of routine results
- The orderer, or whoever covers them, acknowledges each result: seen, acted, or forwarded to a named colleague.
- A result for a patient already sent home creates a recall intent when action is needed.
- Unacknowledged results remain in "Results to review" until acknowledged. They never expire.

**Signature:** 7.1–7.5; the rejection reasons; the critical-results policy with the laboratory lead.

---

## [08] Concept extension for general outpatient and emergency results

MS-DATA-CFC-001 v1 was built for the NCD engine. General clinical care needs the concepts below. They are generated into `clinical-fact-concepts.v1.1.json` during Phase 1 of the EMR build, with LOINC codes verified at loinc.org or marked as candidates. The value type and canonical unit are proposals for signature. "Restricted" follows D-CFC-09.

| Concept | Meaning | Value, canonical unit | Required context | Note |
|---|---|---|---|---|
| `obs.wbc` | White cell count | quantity, `10*9/L` | specimen | |
| `obs.neutrophils_abs` | Neutrophils, absolute | quantity, `10*9/L` | specimen | |
| `obs.lymphocytes_abs` | Lymphocytes, absolute | quantity, `10*9/L` | specimen | |
| `obs.eosinophils_abs` | Eosinophils, absolute | quantity, `10*9/L` | specimen | |
| `obs.mcv` | Mean cell volume | quantity, `fL` | specimen | |
| `obs.esr` | Erythrocyte sedimentation rate | quantity, `mm/h` | method | |
| `obs.blood_group` | ABO and RhD group | coded: A pos, A neg, B pos, B neg, AB pos, AB neg, O pos, O neg | method | |
| `obs.malaria_parasite_density` | Malaria parasite density | quantity, `/uL` | method | Pairs with `obs.malaria_test` |
| `obs.alp` | Alkaline phosphatase | quantity, `U/L` | specimen | |
| `obs.bilirubin_total` | Bilirubin, total | quantity, `umol/L` (accepts mg/dL) | specimen | |
| `obs.bilirubin_direct` | Bilirubin, direct | quantity, `umol/L` (accepts mg/dL) | specimen | |
| `obs.albumin` | Albumin | quantity, `g/L` (accepts g/dL) | specimen | |
| `obs.total_protein` | Total protein | quantity, `g/L` (accepts g/dL) | specimen | |
| `obs.crp` | C-reactive protein | quantity, `mg/L` | method (quantitative or semi-quantitative) | |
| `obs.calcium` | Calcium, total | quantity, `mmol/L` (accepts mg/dL) | specimen | |
| `obs.magnesium` | Magnesium | quantity, `mmol/L` (accepts mg/dL) | specimen | |
| `obs.phosphate` | Phosphate | quantity, `mmol/L` (accepts mg/dL) | specimen | |
| `obs.uric_acid` | Uric acid | quantity, `umol/L` (accepts mg/dL) | specimen | |
| `obs.amylase` | Amylase | quantity, `U/L` | specimen | |
| `obs.lipase` | Lipase | quantity, `U/L` | specimen | |
| `obs.lactate` | Lactate | quantity, `mmol/L` (accepts mg/dL) | specimen | |
| `obs.troponin` | Troponin | quantity, `ng/L` | analyte (I or T), assay, high-sensitivity | Assay-specific limits come from the laboratory, per result |
| `obs.d_dimer` | D-dimer | quantity, `mg/L` | unit basis (FEU or DDU), assay | |
| `obs.inr` | INR | quantity, `{ratio}` | method | |
| `obs.pt` | Prothrombin time | quantity, `s` | method | |
| `obs.aptt` | Activated partial thromboplastin time | quantity, `s` | method | |
| `obs.tsh` | Thyroid-stimulating hormone | quantity, `mIU/L` | specimen | |
| `obs.ft4` | Free thyroxine | quantity, `pmol/L` | specimen | |
| `obs.hiv_test` | HIV test | coded: reactive, non-reactive, indeterminate | algorithm step, kit | Restricted |
| `obs.hiv_viral_load` | HIV-1 viral load | quantity, `{copies}/mL` (comparator for below the limit) | assay | Restricted |
| `obs.cd4` | CD4 count | quantity, `/uL` | method | Restricted |
| `obs.crag` | Cryptococcal antigen | coded: positive, negative | specimen, method | Restricted |
| `obs.syphilis_test` | Syphilis test | coded: reactive, non-reactive | method (rapid, RPR, TPHA) | Restricted |
| `obs.hbsag` | Hepatitis B surface antigen | coded: positive, negative | method | |
| `obs.hcv_ab` | Hepatitis C antibody | coded: positive, negative | method | |
| `obs.pregnancy_test` | Pregnancy test (hCG) | coded: positive, negative | specimen (urine, serum) | Restricted for patients under 18 (conditional) |
| `obs.tb_xpert` | Xpert MTB/RIF | coded: MTB detected with rifampicin resistance detected, not detected or indeterminate; MTB not detected; invalid or error | specimen, assay (Xpert or Ultra) | Restricted |
| `obs.tb_lam` | Urine TB-LAM | coded: positive, negative | method | Restricted |
| `obs.sputum_afb` | Sputum smear microscopy | ordinal: negative, scanty, 1+, 2+, 3+ | method | Restricted |
| `obs.blood_culture` | Blood culture | coded: no growth, growth, suspected contaminant | organism (text; coded in v1.1) | Susceptibility in v1.1 |
| `obs.urine_blood_dipstick` | Blood (urine dipstick) | ordinal | none | |
| `obs.urine_leukocytes_dipstick` | Leucocytes (urine dipstick) | ordinal | none | |
| `obs.urine_nitrite_dipstick` | Nitrite (urine dipstick) | coded: positive, negative | none | |
| `obs.urine_sg` | Urine specific gravity | quantity, `{ratio}` | none | |
| `obs.urine_ph` | Urine pH | quantity, `[pH]` | none | |
| `obs.spo2` | Oxygen saturation | quantity, `%` | on air or supplemental oxygen, with device and flow | Shared with triage and resus |
| `obs.pain_score` | Pain score | quantity, `{score}` | scale | |
| `obs.capillary_refill` | Capillary refill time | quantity, `s` | site | |
| `obs.head_circumference` | Head circumference | quantity, `cm` | measurement | Children; v1.1 |
| `rpt.imaging` | Imaging report | coded conclusion (normal, abnormal, indeterminate) plus encrypted text | modality, body site | Not rule-readable beyond the conclusion |
| `rpt.ecg` | ECG report | coded conclusion plus encrypted text | device | Structured rhythm in v1.1 |
| `obs.uncatalogued` | Uncatalogued result | as typed | test name as typed | Never interpretable |

Standard conversions to add to `lib/units` (derivable from molar masses; mark them "standard" as in CFC section 5):
- bilirubin: mg/dL × 17.1 = µmol/L;
- calcium: mg/dL ÷ 4.008 = mmol/L;
- magnesium: mg/dL ÷ 2.431 = mmol/L;
- phosphate (as phosphorus): mg/dL ÷ 3.097 = mmol/L;
- uric acid: mg/dL × 59.48 = µmol/L;
- lactate: mg/dL ÷ 9.008 = mmol/L;
- albumin and total protein: g/dL × 10 = g/L.

**Signature:** the concept list, its value types, units, context and sensitivity.

---

## [09] Pregnancy

- **Dates.** Last normal menstrual period with its certainty, and the expected date of delivery with its basis (dates, ultrasound, fundal height). Gestational age is derived and never typed (MS-DATA-CFC-001, 4.8).
- **Status.** Pregnancy status is shown and prompted for patients whose recorded sex at birth is female, within a signed age range (REF-PREG-AGE).
  - Prompts appear before ionising-radiation imaging orders.
  - The prescribing engine owns its own check and receives the status from the record.
- **After pregnancy.** The postpartum window is a signed reference. The antenatal and maternity programme registers (HMIS 071 and 072) belong to later programme modules.

**Signature:** REF-PREG-AGE; the triggers; the postpartum window reference.

---

## [10] Sensitive documentation

- **Restricted classes** (D-CFC-09):
  - HIV status and antiretroviral treatment;
  - tuberculosis;
  - mental illness and antipsychotic treatment;
  - sexual and reproductive health (sexually transmitted infections, termination of pregnancy, sexual and gender-based violence);
  - pregnancy in patients under 18.
- **What restriction means.** Restricted content is visible in clinical views to staff with access, marked with a lock. It is excluded by default from patient prints, SMS, push, exports and any shared-device view.
- **Medico-legal examinations.** Examinations after assault or sexual violence use the national police medical examination forms (confirm the current forms, commonly referred to as PF3 and PF3A, at GATE A). v1 provides a restricted "medico-legal examination" note type as a seam. Printing the national form is out of scope.
- **Minors.** The minor and guardian model is an open GATE A decision. Until it is signed, apply the conservative default: restricted content for minors is never printed for, or shown to, anyone but treating clinicians.

**Signature:** the restricted classes, the meaning of restriction, and the minors default.

---

## [11] HMIS and IDSR alignment

Uganda's HMIS runs on paper registers and monthly reports compiled by hand, which is slow and error-prone. The record should capture, at the point of care, everything the main outpatient tools need, so that reports can later be generated rather than tallied.

| HMIS tool | What MedSync captures now |
|---|---|
| Form 031, outpatient register | Date, patient number (MRN), new or re-attendance, age, sex, residence (administrative, from the patient model; never a clinical engine input), primary diagnosis, treatment summary, referral in or out |
| Form 105, outpatient monthly report | Attendances, referrals and diagnoses by age group and sex, derived from encounters and their primary diagnoses |
| Form 032, referral note | Section 2.8 |
| Form 033b, weekly priority-disease report | Derived from diagnoses with an IDSR class |

- **Definitions are signed references, never remembered:**
  - new versus re-attendance (REF-HMIS-ATTENDANCE);
  - the age bands (REF-HMIS-AGEBANDS);
  - the mapping from diagnosis terms to HMIS categories (REF-HMIS-MAP).

  Build the mapping with the facility records officer and the district HMIS focal person, from the current HMIS manual.
- **IDSR classes and actions** come from the current national IDSR technical guidelines (REF-IDSR-CLASSES), including which diseases are immediately reportable.
- **Out of scope for this build:** generating the reports, and any DHIS2 submission.

**Signature:** the capture list, and the four HMIS and IDSR references.

---

## [12] Sign-off register

| Item | Section | Status |
|---|---|---|
| Documentation principles | [01] | Draft |
| Templates 2.1–2.10 | [02] | Draft |
| Minimum to sign; measurement script | 2.11, 2.12 | Draft |
| Findings rules; IDSR exposure tokens (REF-IDSR-SCREEN) | [03] | Draft |
| Diagnosis rules; starter terms with ICD-11 codes (REF-DX-TERMS); test-first list (REF-DX-TESTFIRST) | [04] | Draft |
| Allergy model | [05] | Draft |
| Medicines reconciliation | [06] | Draft |
| Orders, specimens, results, acknowledgement | [07] | Draft |
| Critical-results policy and definitions (REF-CRIT-*, REF-CRIT-TIMEFRAME), with the laboratory lead | 7.4 | Draft |
| Concept extension and conversions | [08] | Draft |
| Pregnancy references (REF-PREG-AGE, postpartum window) | [09] | Draft |
| Restricted classes and the minors default | [10] | Draft |
| HMIS and IDSR references (REF-HMIS-ATTENDANCE, REF-HMIS-AGEBANDS, REF-HMIS-MAP, REF-IDSR-CLASSES) | [11] | Draft |

---

## [13] Sources (checked 26 Sep 2026)

| Claim | Source |
|---|---|
| WHO's nine patient safety solutions (patient identification; hand-over communication; correct procedure at the correct site; medication accuracy at transitions) | WHO news release, 2 May 2007 |
| At least two patient identifiers; label specimen containers in the patient's presence | Joint Commission NPSG.01.01.01 (Laboratory, 2024) |
| Critical results reported on a timely basis: definition, who to whom, time frame, timeliness evaluated | Joint Commission NPSG.02.03.01 (2024) |
| WHO holds the ICD-10 copyright and issues commercial licences for software products (non-exclusive, time-limited, no modification) | WHO FAQ, Licensing ICD-10 |
| ICD-11 under CC BY-ND 3.0 IGO; commercial use allowed without adaptation and with citation | WHO ICD-11 licence; WHO copyright page |
| HMIS forms 031 (outpatient register), 032 (referral note), 105 (outpatient monthly report), 108 (inpatient monthly report) | MoH, The Health Management Information System manual |
| HMIS 105 content (attendance, referrals, diagnoses by age and sex); UgandaEMR generates HMIS 105 and the 031 register | HMIS 105 template; UgandaEMR reports documentation |
| HMIS 033b weekly priority-disease reporting and its challenges | medRxiv 2024, Teso sub-region review |
| Uganda uses FHIR R4; a national terminology server is in production; a core implementation guide is in development | State of FHIR Survey 2026, Uganda response (packages.fhir.org and simplifier.net) |
| Uganda Clinical Guidelines 2023 | library.health.go.ug |
