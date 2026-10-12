# Lab catalogue research: notes for sign-off

Researched 12 October 2026, following the Lab Catalogue Research Brief. The data is in `claude/lab-catalogue-research.v1.json`, which uses the brief's JSON shape plus the extensions listed in its `conventions`.

**Status: proposal only.** None of it goes live by itself. Under the Phase 1 rules, ranges import as **unsigned drafts**. Concepts and tests import as an addendum that has to be signed. No critical limits are proposed anywhere.

## What is in the file

| | Count |
|---|---|
| Concepts | 119 (57 existing kept, 62 new) |
| Tests | 33 (the 32 in the brief, plus `test.coag_screen`) |
| Range sets | 64: 47 reference intervals, 17 decision schemes |
| Range bands | 497. Each has a source link, population, method, confidence and reason |
| LOINC | 95 of 119 concepts, each checked on loinc.org (LOINC 2.82) |
| Sources cited | 83 |
| Gaps | 38 |
| Decisions | 21 |

**How the work was done.** Seven research strands each read only sources they actually opened:

- adult FBC
- paediatric haematology
- adult chemistry
- paediatric chemistry
- other quantitative tests
- coded answer sets
- LOINC

The strands were then merged and the ids aligned to the brief's existing ids. For example `obs.chol_total`, `obs.urine_leukocytes_dipstick`, `test.thyroid` and `test.hiv_viral_load` keep their names; none were renamed.

Ages follow Phase 1 rule RR-4: counted in days, with the lower bound included and the upper bound excluded. Years were converted as ×365.25 and rounded down.

## Verification

- **Automated checks.** Every band has a number or a formula, a link, a valid sex value and a valid age span. Reference bands do not overlap within the same source, sex and context. All checks pass with 0 problems.
- **Spot-checked by hand against the papers:**
  - Eller 2008: 18 values. All match.
  - Karita 2009: 9 values. All match.
  - Lugada 2004 (haemoglobin, platelets, WBC, neutrophils, CD4%): all match.
- **One mismatch: Lugada CD4 absolute counts.** A second extraction disagreed. For example, the under-1-year band is stored as 700–3514 but the second reading gave 339–2180. Those bands are kept at **low confidence** and carry `band.verification`. A person must read Table 3 of the PDF before they are signed. For adults, Karita 2009 (457–1628/µL, verified) can be used in the meantime.
- **WHO 2024 haemoglobin cut-offs and altitude adjustment.** These were corroborated by a second secondary source. The WHO PDF itself could not be opened.

## Headline findings

1. **The FBC grows from 6 to 31 concepts.** The 5-part analyser (DH-615) reports 27 parameters and a 3-part analyser reports 19. MID and GRAN are kept as their own concepts.
   - The DH-615 also has 29 research-use parameters, including NRBC, NLR and PDW-CV. These must never be released as results.
   - HCT may be measured or calculated, and the PDW unit is unconfirmed. Both need the DH-615 manual.
2. **African adult intervals differ from Western ones in ways that matter:**
   - Lower neutrophil limits (about 0.9–1.1 ×10⁹/L), consistent with Duffy-null phenotype.
   - Lower haemoglobin limits (Eller: women 9.8, men 11.6 g/dL).
   - Higher male total bilirubin upper limit (about 44 µmol/L).
   - Sodium and chloride differ between sources by 4–6 mmol/L.
3. **Many "ranges" are really decision limits:** glucose, HbA1c, lipids, eGFR and urine ACR stages, viral-load suppression, the troponin 99th percentile, the D-dimer cut-off, CD4 categories and anaemia. A plain low/high band cannot hold these properly. This is why decision CD-01 is first.
4. **Anaemia is the biggest clinical safety point.** Under the Eller reference interval, a woman at 10.0 g/dL shows "in range". Under WHO 2024 she has moderate anaemia. Kampala sits in the 1,000–1,499 m altitude band, where WHO adds 0.8 g/dL to the cut-off.
5. **Children and newborns are thin:**
   - Days 0–6: no haematology data at all.
   - Paediatric chemistry: rests on small African studies.
   - CALIPER (Canadian paediatric intervals): not openable.
   - Neonatal bilirubin: belongs to hour-specific nomograms, not reference ranges.
6. **Some tests depend on the kit or reagent and get no default:** troponin, thyroid tests, PT/APTT and D-dimer. The lab enters values from its own kit insert.
7. **Coded tests now have full answer sets, each with an `abnormal` flag:**
   - Uganda's 2022 HIV algorithm, with the November 2024 kit change noted.
   - WHO malaria density counting.
   - Xpert Ultra semi-quantitative categories, including "trace".
   - IUATLD AFB grading.
   - CrAg titre series starting at 1:5.
   - The 10-pad urine dipstick, which adds bilirubin and urobilinogen.

## Decisions on the catalogue design (yours, before the Phase 2 prompt)

| id | Decision | Recommendation |
|---|---|---|
| CD-01 | Reference intervals vs decision limits | Add `range.kind`. Decision ranges become named category schemes. Each hospital chooses a **flag basis** per concept |
| CD-02 | Fasting glucose | New concept `obs.glucose_fasting` (LOINC 14771-0) |
| CD-03 | Results that depend on the method | Split troponin into I and T (`obs.troponin` retired). D-dimer becomes FEU in `mg/L{FEU}`, with a separate DDU concept. Creatinine method is recorded in a method register |
| CD-04 | Unit conversions | Entry accepts only plain-factor conversions. HbA1c IFCC is computed for display only: (NGSP − 2.152)/0.09148 |
| CD-05 | FBC structure | One `test.fbc` with an analyser profile per machine. MID/GRAN never become neutrophils. Research-use parameters are blocked. P-LCR and P-LCC are hidden |
| CD-06 | Concept addendum | Accept the 62 new ids. ABO stays in `obs.blood_group` and RhD gets new `obs.rhd_type`. `obs.malaria_test` stays the shared positive/negative result |
| CD-07 | Test splits | Syphilis splits into RDT, RPR, TPHA and the dual HIV/syphilis RDT. Add `test.coag_screen` (PT, INR, APTT) |
| CD-08 (CSO) | Restricted classes | hiv: HIV rapid, viral load, CD4, dual RDT. tb: Xpert, LAM, AFB. Sexual and reproductive health: syphilis, pregnancy test |
| CD-09 | Versioned configuration | HIV algorithm and kits, dipstick brand tables and analyser profiles are dated and versioned. The kit and lot are captured on each test |

## Decisions for the laboratory lead and CSO (before signing ranges)

| id | Decision | Recommendation |
|---|---|---|
| LD-01 | Adult source set | Eller 2008 as the draft, Karita as the cross-check. Verify on the lab's own analysers first (CLSI EP28: 20 samples, no more than 2 outside the range) |
| LD-02 | Haemoglobin low flag | Flag on the **WHO 2024 anaemia scheme adjusted for altitude** (needs each facility's elevation). Show the reference interval for information |
| LD-03 | Neutrophil lower limit | Keep the African lower limit and add an interpretive note |
| LD-04 | Glucose, HbA1c, lipids | Use WHO thresholds (impaired fasting glucose 6.1–6.9, diabetes ≥7.0 mmol/L). HbA1c ≥6.5% means diabetes. Lipids use ATP III categories |
| LD-05 | Viral load | Uganda MoH: ≥1000 copies/mL is non-suppressed. Add low-level viraemia only once the Uganda text is verified |
| LD-06 | Children and newborns | Kilifi for 28 days to 17 months, Lugada for 18 months to 18 years. No bands for 0–27 days. Do not use Kilifi's infant platelet lower limits |
| LD-07 | CD4 | Flag on WHO categories. Lugada's CD4% lower limits are below WHO's severe cut-off for infants |
| LD-08 | Tests that depend on the kit | No defaults. The lab enters values from its own kit insert |
| LD-09 | INR targets | Recorded on the patient's anticoagulation plan, not as a lab range |
| LD-10 | Creatinine and eGFR | Method declared and traceable to the international reference method (IDMS). eGFR for adults only |
| LD-11 | Coded results | Malaria density in parasites/µL; the plus system is hidden. Xpert "trace" is kept as its own answer. The HIV algorithm in use is dated |
| LD-12 | Evidence before signing | Adults: the 20-sample check per age and sex band. Children: a written reason for adopting the published range where local recruitment is not feasible |

## Biggest gaps (all 38 are in `gaps`)

- **Lugada CD4 absolute:** needs checking by hand.
- **Newborns:** no haematology for days 0–6.
- **Paediatric chemistry:** CALIPER and the Kironde (Uganda) table are needed. Kironde's table is an image.
- **WHO 2024 child anaemia cut-offs:** not loaded yet.
- **Uganda Clinical Guidelines 2023:** chapters not readable.
- **Lactate and CRP:** only US values.
- **DH-615 operator manual:** not found.
- **No LOINC code** for malaria parasite density.

Several gaps exist only because PMC, Europe PMC and Springer blocked access. Someone with library access could close them in an afternoon.

## What changes for Phase 2

- CD-01 to CD-09 change the catalogue schema and the Reference ranges screen. The screen will need:
  - a reference or decision kind;
  - a flag-basis chooser;
  - category schemes;
  - facility elevation;
  - analyser profiles.
- These screens will be previewed on the canvas before the Phase 2 prompt is written.
- The import path follows the brief: concepts and tests become a signed addendum; ranges become unsigned drafts in Reference ranges.
