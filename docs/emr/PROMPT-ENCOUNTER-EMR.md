# PROMPT — Encounter/EMR engine: the clinical record spine

> **For Claude Code.** Work at the repo root on a new branch `feat/emr-engine`, cut from the current integration branch. At STOP 0, check whether `feat/resus-desk-v2` and `feat/doctor-workspace` have merged. Until each has, do not modify its files (`lib/resus/**`, `app/*/resus/**`, `lib/workspace/**`, the Workspace page and lane registry); integrate only through their documented seams. First copy these into `docs/emr/`:
> - this prompt;
> - `emr-clinical-reference.md` (MS-EMR-CLIN-001, the medicine);
> - `SPEC-CLINICAL-FACT-CONTRACT-v1.md` (MS-DATA-CFC-001, the data brief; **normative** for this build);
> - `clinical-fact-concepts.v1.json` (the seed catalogue);
> - `SPEC-NCD-ENGINE-DIABETES-PACK-v1.md` (MS-NCD-ENG-001), for context only: it is the first consumer of what you build.
>
> **Mode:** gated. Nine phases (0 to 8), each ending in a **STOP**. Documents use Stage 1 (draft → critique against the checklist → revise, max two passes → present → STOP). Code uses Stage 2 (build → run the real checks → fix → re-run until green → report numbers → STOP). Self-refinement never replaces a real check.
>
> **The CSO is Fadhul.** Clinical content (templates, critical-result rules, the allergy model, coding catalogues, HMIS and IDSR mappings), clinical safety rules and every clinical write path need his signature before they ship.

---

## 0. What we are building, in one paragraph

MedSync has triage, a resus desk, scheduling and a Workspace, but no record for them to write into. Encounters are thin open/completed rows. Labs are manual codes inside resus. Allergies live inside the resus E step. The triage recommendations layer and resus close-out leave pending intents with nothing to execute against. This build makes the **clinical record spine**:
- one longitudinal chart per patient;
- encounters inside visits;
- documentation that is structured where engines need facts and narrative where clinicians think;
- a problem list and coded diagnoses;
- allergies with a single home, and a medication history;
- orders with their full loop (ordered, collected, resulted, acknowledged), and results with context;
- a timeline.

Everything is stored as insert-only, versioned clinical facts under the Clinical Fact Contract, so that the monitoring, prescribing, differential and NCD engines read one truth. The chart and the clerking page are how clinicians see it. The fact store is the real deliverable.

---

## 1. Ground truth and reading order

1. **The repo wins** over this prompt. Several findings below are known only from earlier prompts and briefs. Confirm each in code and data at STOP 0 and report every disagreement.
2. **Specs, in this order:**
   - MS-DATA-CFC-001: normative for the data layer; its Section 10 is your data-phase checklist.
   - `emr-clinical-reference.md`: the medicine; everything in it is DRAFT until signed.
   - `DESIGN-medsync.md` (authoritative) and ADR 0097 (plum = place).
   - The Workspace prompt (`docs/doctor-workspace/**`): lanes, FW rules, death record D2, idle setting D3.
   - Resus v2 (`docs/resus-v2/**`): the handover seam, the `clinical_observations` link, the Results group, the prescribing check.
   - Triage engine v2 and recommendations (pending intents); scheduling PRD (arrival → encounter handoff); entry points (unified intake record, `awaiting_triage`); handling flow (presence lifecycle); hospital setup (operating profile, services).
3. **Code:**
   - the encounter module wherever it lives, and `app/doctor/encounters/**` (the clerking page);
   - `app/nurse/**`, `lib/triage/**`, `lib/resus/**`, `lib/prescribing/**`, and `lib/workspace/**` if merged;
   - `lib/encryption.ts`, and the audit and `clinical_phi_access_log` helpers;
   - `db/schema/**`, migrations, `tests/**`, `tests/rls/**`.

---

## 2. Laws (non-negotiable)

1. **Engine-first.** No surface reads or writes the record without real tables, real RLS policies and passing tests. Every new table, column, view, trigger and function arrives with RLS probes in the same phase.
2. **The Clinical Fact Contract is law for the data layer.** Laws C1–C12 apply to everything you build. Where the repo differs, evolve what exists additively toward the contract. Never build a parallel store: one vital-signs series, one allergy record, one problem list. Record every change the contract needs in `docs/emr/cfc-v1.1-addendum.md` (Section 7.9).
3. **One owner per fact.**
   - Allergies live in one patient-level record.
   - Vital signs live in one observation series.
   - Death lives in one patient-level record (Workspace D2).
   - The problem list is one list.

   Surfaces write through the owner and never keep private copies. Resus keeps its AMPLE editor, but the editor writes into the allergy record.
4. **Signed means immutable.** A signed note or a recorded fact is never edited or deleted. Changes are addenda, superseding versions or `entered_in_error` with a reason, all audited and all visible. Drafts are the only mutable clinical rows, and only while they are drafts.
5. **Missing is never normal.** Every template distinguishes *not asked*, *absent* and *normal*. "No known drug allergies" is an assertion made by a named person at a recorded time. A blank allergy field reads "Allergy status not recorded".
6. **Decision support only.** Engines (differential, NCD, results rules) suggest; clinicians decide. Nothing writes to the chart without a clinician's action. Warnings are confirms with a recorded reason, never hard blocks on a clinical action. The existing prescribing blocks stay unchanged.
7. **No remembered numbers.**
   - Reference ranges come from the performing laboratory, per result.
   - Critical-result limits, plausibility bounds, HMIS definitions and IDSR lists come only from CSO-signed reference entries, each with a source URL and verified date. Until signed, the mechanism ships and shows no numbers.
   - Operational settings (autosave interval, idle windows, late-entry window) are hospital settings, with defaults approved at GATE A.
8. **Red is a safety property.** In the record, `#DC2626` may appear only in two places: on a critical result value (the same class as critical vital values, which already use it; subject to D-EMR-06), and on the global Emergency affordance. "Awaiting acknowledgement", "overdue", "unsigned", "offline" and "allergy status not recorded" are amber. Record states (draft, signed, completed) are neutral grey. Extend the red-scarcity invariant tests to every EMR component.
9. **Two identifiers everywhere.** Name plus MRN, with age and sex, on the chart header, every order, every specimen label, every result, every printout and every row. Never a bed or bay alone (WHO patient safety solution 2, patient identification; Joint Commission NPSG.01.01.01).
10. **Private by design.**
    - Narrative is encrypted with AES-256-GCM through `lib/encryption.ts`; structured values follow the encryption-boundary ADR (D-CFC-04).
    - Restricted facts (D-CFC-09) never reach patient-facing text, SMS, push notifications, exports or default printouts.
    - Every chart open is logged in `clinical_phi_access_log`. Out-of-scope access uses the existing break-glass path.
11. **Stack as found.** Next.js 16 App Router, with server components for reads and client islands only where interaction needs them. TypeScript strict, no `any`. Zod on every server action. AAL2 for clinical roles. Reception cadres are blocked in both the app and the database. Writes go only through audited server actions using the service role, as today. Use the ORM on the branch (Q1), never a second one.
12. **No new dependencies or software without stopping to flag.** This includes a local Postgres install, Playwright, axe, a PDF library and a search engine. The project must still run from a clean clone with Node 22 and pnpm, apart from what E1 approves.
13. **Licensed content only.** No classification or terminology content (ICD-10, ICD-11, LOINC, CIEL) is committed until its licence is recorded in `THIRD-PARTY-NOTICES.md` (E6).
    - WHO holds the copyright in ICD-10 and issues commercial licences for software products; licensees may not modify the codes or descriptions.
    - ICD-11 is licensed under CC BY-ND 3.0 IGO: commercial use is allowed, with attribution and without adaptation.
14. The pharmacy regulator is the **Pharmacy Board of Uganda** (never PSU) wherever copy mentions it.

---

## 3. What exists and what is missing (confirm each at STOP 0)

| # | Finding | Source | Severity |
|---|---|---|---|
| R1 | **Allergies live inside resus step E (AMPLE), and the prescribing allergy check reads them there.** An allergy recorded in resus is invisible to an outpatient prescription and vice versa, unless the check reads more widely than the brief says. | resus v2 prompt 5.3 | **Safety — fix first** |
| R2 | **Encounters are thin.** Open/completed rows with a clerking page. Emergency encounters stay open for weeks (Workspace W4). There is no disposition and no completion meaning beyond a status. | Workspace prompt | Safety + data |
| R3 | **There is no results model.** Labs are manual codes inside resus (the "Results" group). Nothing links an order to a result, or a result to its acknowledgement. | resus v2 prompt 5.4 | Safety |
| R4 | **Pending intents have nowhere to go.** Triage recommendations and resus close-out (handover, death certificate) leave intents or `pending_encounter_handoff` for an encounter engine. | triage recommendations; resus v2 5.12 | Data |
| R5 | **`clinical_observations` exists** (resus vitals are copied into it). Its shape against the CFC observation contract is unknown. | resus v2 5.4 | Data |
| R6 | **There is no problem list and no coded diagnosis.** The roadmap requires coded diagnoses. | roadmap | Data |
| R7 | **Database runtime.** `prisma dev` (PGlite) allows a single connection (G1). The move to native Postgres was deferred to the start of this build. | project overview | Engineering |
| R8 | **The encryption boundary for structured values is undefined.** Encrypting every PHI column would make sweeps, trends and registries impossible in the database. | CFC 3.6 | Engineering |
| R9 | **ICD-10 is not licensed.** WHO requires a commercial licence for software products; none is recorded. | WHO ICD-10 licensing FAQ | Legal |

---

## 4. Design direction: the chart and the clerking desk

**Six rules**

1. **Write once, reuse everywhere.** Triage vitals, the presenting complaint and acuity arrive pre-filled. The problem list, allergies and medicines carry forward with a one-tap "still true?" confirm. No one re-types what the record already knows.
2. **Structure where engines need it; prose where clinicians think.** Every note section has a narrative field and an optional structured strip. The strip is how facts reach the engines; the prose is how the clinician tells the story.
3. **Pertinent negatives are first-class.** Every finding chip has three states: present, absent and not asked.
4. **The safety bar is the anchor.** It is the EMR's one signature element; everything else stays quiet. The chart header never scrolls away, and it always states in words:
   - two identifiers, age and sex;
   - allergy status, and pregnancy status where relevant;
   - deceased status;
   - the top three active problems;
   - unacknowledged critical results;
   - a marker when restricted content is present.
5. **Every order closes its loop.** An order is tracked until it is resulted and acknowledged, or cancelled with a reason. Nothing ordered disappears; this is property-tested, like the Workspace's Law 3.
6. **Fast in the real room.** Keyboard-first on desktop, large targets on tablets, and a record that survives connection drops.

**Budgets** (measured at Phase 0, met by Phase 6)

- **Chart open.** Server-render TTFB p95 under 400 ms, with the safety bar in the first paint.
- **Clerking actions:**
  - triage-prefilled vitals appear with **0** taps;
  - adding a diagnosis from the top 50 terms takes **≤ 4 keystrokes + Enter**;
  - ordering a favourite test takes **≤ 2 taps**;
  - signing takes **1 tap + confirm**.
- **Autosave** never blocks typing, and no keystroke is lost across a 30-second connection drop (drilled in Phase 8).
- **Search and entry.** Diagnosis search p95 under 150 ms. Result entry for a five-analyte panel fits **on one screen**.

---

## 5. Interface specification

Wireframes use illustrative patients and values. Glyphs stand for icons from the product icon set.

### 5.1 The safety bar (chart header on every clinical page about a patient)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ Amina Nakato      52 F      MRN 004812                                   Emergency │
│ Allergies   Penicillin: anaphylaxis (confirmed)                                     │
│ Active      Hypertension   Type 2 diabetes                                          │
│ ▲ 1 critical result awaiting acknowledgement                          🔒 Restricted │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Type.** Fraunces for the patient name only; Geist elsewhere; tabular numerals.
- **Allergy line.** It always states one of three things, and tapping it opens the allergy editor:
  - the listed allergies, worst criticality first;
  - "No known drug allergies (confirmed by Dr X, 12 Mar 2026)";
  - in amber, "Allergy status not recorded" or "Allergy status unable to be assessed".
- **Pregnancy status.** Shown for patients whose recorded sex at birth is female and whose age is within the signed range (D-EMR-12), as words: "Pregnant, 26 weeks", "Not pregnant (test 12 Mar)" or "Pregnancy status not recorded".
- **Deceased patients.** A neutral "Died 11:06, 12 Mar 2026" chip (Workspace D2). Clinical actions launched from the bar are removed.
- **Emergency affordance.** It stays in the page header, far right, as on every doctor page.
- **Restricted marker.** A lock and the word. It tells the clinician that the chart holds content that never leaves clinical views; it reveals nothing itself.

### 5.2 The chart (patient level)

Use the existing patient route if one exists (Q12); otherwise `/patients/[patientId]` under each clinical role's layout. Sections sit in a left-hand index inside the chart, not in tabs: Summary, Timeline, Results, Notes, Orders, Medicines, Problems and allergies. The current section is marked with plum (place).

- **Summary.** Active problems; allergies; current medicines; the last three encounters; recent results (abnormal first); pending orders. Care gaps from the NCD engine arrive later through a seam.
- **Timeline.** Encounters, notes, results, orders, procedures and state events in reverse order, filterable by kind and paged.
- **Results.** A flowsheet (concepts down, dates across), with an inline sparkline per numeric concept and abnormal flags from the laboratory's own range. Critical values use the critical style (D-EMR-06). Tapping any value opens its provenance: who recorded it, where, method, specimen, fasting state, device or laboratory, effective and recorded times, and trust.
- **Notes.** Signed notes, with addenda threaded under their parent. Entered-in-error items stay visible, struck through, with the reason.

### 5.3 The clerking page (encounter level)

Desktop (≥ 1280 px):

```
┌ Safety bar ───────────────────────────────────────────────────────────────────────────┐
├ Workspace ────┬ Note ─────────────────────────────────────────────┬ Context ───────────┤
│ Waiting   3   │ Adult outpatient clerking                  Draft  │ Triage             │
│ In progress 2 │ Saved 10:42                                       │   L3 Yellow  10:31 │
│               │                                                   │   Fever, 3 days    │
│ [01] Complaint│ [01] Presenting complaint                         │ Vital signs  10:31 │
│ [02] History  │      Fever         3 days                         │   T 38.9  HR 104   │
│ [03] Systems  │      Headache      2 days                         │   BP 128/82  RR 20 │
│ ...           │ [02] History of presenting complaint              │ Results            │
│ [13] Impress. │      Three days of fever with chills, worse at... │   mRDT     Pending │
│ [14] Plan     │      Present   Chills   Vomiting                  │ Medicines          │
│               │      Absent    Neck stiffness   Rash              │   Metformin        │
│               │ ...                                               │ Problems           │
│               │ [13] Impression                                   │   Type 2 diabetes  │
│               │      Malaria, uncomplicated           Working     │                    │
│               │ [14] Plan                                         │                    │
│               │      mRDT                    Ordered 10:40        │                    │
│               ├───────────────────────────────────────────────────┤                    │
│               │ [ Sign note ]                     Complete visit  │                    │
└───────────────┴───────────────────────────────────────────────────┴────────────────────┘
```

- **Layout.**
  - The left rail is the Workspace rail (from the Workspace prompt, if merged) above the note's section index. The current section carries the plum marker.
  - The narrative column is set for reading: a comfortable measure, generous line height, bracket section numbers.
  - Structured items sit inline as chips, each with its value and a small source mark, never as dot-joined strings.
- **Tablet portrait.** The context rail becomes a bottom sheet labelled "Context". **Phone.** One section at a time, with the section index as a sheet and the primary action bar fixed at the bottom.
- **Sections.** They come from the template (clinical reference 2.x) in a fixed order. An empty optional section collapses to one line, for example "Past surgical history  Not asked  Add".
- **Keyboard** (off inside text fields, except where noted):
  - `/` at the start of an empty line opens the insert menu (vital sign, finding, diagnosis, order, medicine);
  - `j` and `k` move between sections;
  - `Ctrl/Cmd + Enter` signs;
  - `?` opens help.

  The focus-visible ring is teal.
- **Autosave.** A quiet "Saved 10:42" in neutral grey. It changes to amber "Offline, changes kept on this page" (Section 9) when the connection drops.

### 5.4 Findings

- **Search.** It uses the shared token catalogue owned by the differential engine; the EMR never keeps its own list. Chips have three states (present, absent, not asked), with optional onset and duration.
- **Review of systems.** A compact grid per system, every item defaulting to "not asked".
- **Differential engine.** Where the clerking page shows its suggestions, they read the draft's findings through the fact seam and are labelled "Suggestions". They are never inserted into the note automatically.

### 5.5 Diagnoses and the problem list

- **Picker.** It searches MedSync diagnosis terms, including synonyms and common local usage. Each result shows the term, the ICD-11 code (and the WHO ICD-10 code once licensed) and any flags (chronic, notifiable, restricted). The clinician picks a term, never a raw code.
- **Status.** Working (provisional) or final (confirmed), with differentials allowed. Each visit has one primary diagnosis, which is what HMIS counts. Symptom-level diagnoses ("fever, cause not yet known") are allowed and encouraged over a premature disease label.
- **Problem list.** An "Add to problem list" toggle defaults on for chronic-flagged terms. Items are active, inactive, resolved or refuted, each with who and when; resolving or refuting takes a reason chip. Chronic problems carry forward.
- **Notifiable terms.** Choosing one opens a confirm sheet with the signed IDSR action text (for example notify, isolate). It then creates a pending notification intent and an IPC prompt. It never blocks (D-EMR-11).

### 5.6 Allergies

- **Editor fields:**
  - substance, searching coded ingredients and classes; uncoded text is allowed but labelled "Not checked by prescribing";
  - category, reaction (coded manifestations), severity, criticality, verification, onset and source.
- **Assertions.** "No known drug allergies" and "Unable to assess" (for example an unconscious patient; amber) are recorded as assertions. Any active allergy supersedes a "No known drug allergies" assertion automatically.
- **Resus migration.** Resus AMPLE allergies are migrated with provenance "resus E step". From Phase 4 the AMPLE editor writes through the same action, so the resus workflow looks the same and the record has one home.

### 5.7 Medicines

- **Medication history.** Each entry is a statement: drug, source (patient-reported, external record, dispensed here), status, and start and stop dates. It includes herbal, traditional and over-the-counter medicines.
- **Reconciliation.** "Confirm current medicines" appears at each new encounter, each medicine marked continue, stopped or changed, with a reason where needed (WHO patient safety solution 6, medication accuracy at transitions in care).
- **Prescribing** (Phase 7) reuses `lib/prescribing` and its dialog. There is no new dose logic.

### 5.8 Orders, specimens and results

- **Order.** From the facility test menu, favourites first; panels expand to their components. Priority is routine, urgent or immediate. A reason is required (a diagnosis or a short text). The fasting-required flag comes from the test menu.
- **Specimen collection.** At the bedside:
  - confirm two identifiers;
  - record the fasting chip ("Fasting", "Not fasting", "Not sure") with its time;
  - record the container and who collected it;
  - print the label with two identifiers, the test and the time.
- **Rejection.** Reasons: haemolysed, clotted, insufficient, unlabelled or mislabelled, wrong container, or delayed. Rejection returns the order to "to collect" with the reason visible.
- **Result entry.** One screen per panel:
  - units default from the test menu, with unit-mismatch prompts (CFC section 6) and comparator entry (`<`, `>`);
  - the laboratory's reference range is recorded per result;
  - entry mode is direct (laboratory staff) or transcribed (a clinician copying a paper report); an interface mode is reserved for later;
  - status is preliminary or final; an amendment supersedes and asks the orderer to acknowledge again.
- **Review.** The ordering clinician, or whoever covers them, sees the result in "Results to review". Acknowledging records one of seen, acted or forwarded.
- **Critical results** (signed definitions only; D-EMR-06). The value shows the critical style. The laboratory records who they told, how, when and whether it was read back; the ordering clinician acknowledges. An unacknowledged critical result escalates to the in-charge after the signed time frame.
- **Imaging and ECG.** An order plus a report: the report text is encrypted and carries a coded conclusion (normal, abnormal, indeterminate). No images are stored.
- **Uncatalogued tests.** A result for a test not in the catalogue can be entered as "uncatalogued" (name, value and unit as typed). It shows in the chart and engines never read it (CFC C2).

### 5.9 Signing, co-signing, addenda, late entries and entered in error

- **Sign.** Validates the template's minimum sections (clinical reference 2.11); composes the note into its canonical form; computes an HMAC-SHA-256 over it with a dedicated server key (tamper evidence); writes the note and its note-born facts in one transaction; audits.
- **Co-sign** (D-EMR-03). When the author's cadre requires it (the sets are the open GATE A decision), the note becomes "signed, awaiting co-signature". Care is never blocked. The co-signer co-signs, or adds an addendum and co-signs. Pending co-signatures surface in "To co-sign" (5.11).
- **Addendum.** A new note linked to its parent, with its own author and time, shown threaded under the parent.
- **Late entry.** When the effective time precedes the recorded time by more than the hospital's late-entry setting, the item is labelled "Late entry" wherever it shows.
- **Entered in error.** Done by the author or a supervisor (permission matrix), always with a reason. The item stays visible, struck through, with its reason. Engine transitions that depended on it reverse (CFC 3.3; NCD invariant I12).

### 5.10 Completing a visit

- **Disposition** (required to complete):
  - home;
  - admitted (a seam to the ward module);
  - referred out (the referral note);
  - transferred;
  - died (writes the patient-level death record per Workspace D2 and opens the cause-of-death record);
  - left before completion;
  - left against medical advice.
- **Follow-up.** None, a review date (a scheduling intent) or as needed.
- **Warnings, not blocks:** unsigned notes, no diagnosis recorded, orders not yet collected. Pending results are normal; they carry into "Results to review".
- **Administrative closure** of a stale encounter needs a reason, is never automatic, and is audited (Workspace Law 3).
- **Printouts** (print CSS, two identifiers on every page, "Page 1 of 2"):
  - a visit summary for the patient: diagnoses in plain language, medicines and follow-up; restricted items are excluded unless the clinician includes them item by item;
  - a referral note whose fields align with the MoH referral note (HMIS 032; confirm the fields at GATE A);
  - a laboratory request form.

### 5.11 Workspace integration (through the lane registry; only once the Workspace has merged)

- Encounter state and `last_activity_at` feed FW-2 as they do today.
- **New lane sources**, with precedence proposed for GATE A (E8):
  - **Critical results**, after Resus and before To triage: patients with an unacknowledged critical result that I ordered or cover.
  - **Results to review**, after In progress.
  - **To co-sign**, after Results to review.

  One patient, one row: a patient already in a higher lane gets a badge instead.
- **Needs closing** gains two sources: drafts idle beyond the setting, and completed encounters that still have unsigned notes.

### 5.12 Handoffs

- **Triage to encounter.** Starting an encounter carries acuity, the complaint, discriminators and vital signs. The vitals are already observations: show them, never copy them.
- **Scheduling arrival to encounter.** The appointment reason and any referral reference.
- **Resus to encounter.** Consume `pending_encounter_handoff` in one transaction:
  - create or link the encounter;
  - write the handover as an ISBAR handover note authored by the resus leader;
  - carry outstanding actions as proposed orders;
  - clear the flag.
- **Triage recommendations to orders.** Pending intents appear in the plan section as proposed orders labelled "Suggested by triage". The clinician accepts or dismisses each; nothing is ordered without that action.

---

## 6. Engines (pure functions, no I/O)

| Module | Responsibility | Minimum tests |
|---|---|---|
| `lib/units/**` | CFC section 5 conversions and the unit-mismatch prompt rules | 30 known pairs plus every prompt rule |
| `lib/facts/**` | Projections for every fact kind (CFC section 2, plus allergy); Zod refinements generated from the catalogue; `loadFactSnapshot` with manifests, as-of, quarantine and a deterministic hash | round-trip for every concept; as-of reproducibility; quarantine path |
| `lib/emr/encounter.ts` | Encounter lifecycle (open, completed, cancelled, administratively closed, entered in error), disposition rules, completion warnings | every transition and every invalid one |
| `lib/emr/notes.ts` | Template schemas, minimum-section validation, canonical composition, HMAC input, addendum threading, late-entry detection | 40 |
| `lib/emr/carry-forward.ts` | What pre-fills from triage, the problem list, allergies and medicines, and the "still true?" states | 20 |
| `lib/emr/allergy.ts` | Allergy status resolution (listed, no known drug allergies, unable to assess, not recorded), supersession, and the prescribing-check input | 25 |
| `lib/emr/orders.ts` | Order lifecycle derived from events (proposed, active, collected, in progress, resulted, acknowledged, cancelled; rejected then recollect) | 30, plus the property "nothing ordered disappears" |
| `lib/emr/results.ts` | Result status (preliminary, final, amended, corrected), abnormal flag from the laboratory's range, critical detection from signed entries only, acknowledgement and escalation states | 40 |
| `lib/emr/hmis.ts` | Attendance type, age band, HMIS category and IDSR class, all from signed references; each returns `unknown` until its reference is signed | 20 |
| `lib/emr/chart.ts` | The chart summary and safety-bar payload: precomputed, display-ready, with restricted flags | 25 |
| `lib/emr/fhir.ts` | FHIR R4 projection for export tests only (Patient, Encounter, Condition, Observation, AllergyIntolerance, MedicationStatement, MedicationRequest, ServiceRequest, Specimen, DiagnosticReport, Procedure, Composition). No endpoint. | round-trip per resource |

**Property tests** (Phase 3):
- a signed note's canonical content never changes;
- nothing ordered disappears: every order ends acknowledged, cancelled with a reason, or visibly open;
- allergy status is never "no known drug allergies" while an active allergy exists;
- a restricted fact never appears in a patient-facing payload;
- the same snapshot always gives the same hash.

---

## 7. Data model (additive; next free migration number)

### 7.1 Principles
- **Evolve before adding.** Existing encounters and `clinical_observations` grow toward the contract; they are not replaced.
- **Clinical facts follow the CFC 3.2 pattern:** `logical_id`, `version`, `supersedes_id`, effective and recorded times, `source`, `trust`, `status`, `sensitivity`, and a BEFORE UPDATE OR DELETE block.
- **Workflow objects (encounters, orders, specimens) record their lifecycle as append-only events.** Current status is derived, never overwritten. The one exception is the existing encounter state column, which keeps its current in-place behaviour with an audit row per change.
- **Enum style follows Q1.** If values are Postgres enum types, `ALTER TYPE … ADD VALUE` cannot run in the transaction that uses the new value, so split migrations. If they are text with a CHECK constraint, alter the constraint.

### 7.2 Encounters (evolve the existing table)
Add, where missing:
- `visit_id`, a foreign key to the visit or unified intake record found at Q4;
- `class`: opd, emergency, inpatient, antenatal, procedure, virtual or community;
- `template_id` and `last_activity_at`;
- `completed_at` and `completed_by`;
- `disposition_code`: home, admitted, referred_out, transferred, died, left_before_completion or left_against_advice;
- `disposition_detail` and `follow_up` (both jsonb, Zod-validated);
- `attendance_type`: new, re_attendance or unknown, from the signed HMIS definition;
- `referral_in` (with its source);
- `closure_kind` (clinical or administrative) and `closure_reason`.

Backfill: flag, don't alter. Existing open encounters stay open and appear in Needs closing.

### 7.3 Notes
- **`clinical_notes`** holds the note content:
  - `id`, `encounter_id`, `patient_id`, `note_type` and `template_id` with its version;
  - `note_type` is one of clerking, emergency_clerking, progress, ward_round, procedure, handover, referral, nursing, addendum or cause_of_death;
  - `state` is draft or signed;
  - `author_id`, `author_cadre`, `signed_at`, `addendum_to`, `late_entry`, `effective_at`, `recorded_at`;
  - `content_ciphertext` (the sections as JSON, holding the narrative and the structured payload), `content_hmac`, `sensitivity` and `client_key`.

  A trigger allows UPDATE only while the old row's state is `draft`. The signing update is therefore the last mutation, and afterwards any UPDATE or DELETE raises.
- **`clinical_note_events`** is append-only. It records `cosign_requested`, `cosigned`, `addendum_added` and `entered_in_error` (with its reason). The current state comes from the view `clinical_notes_current`.
- **Commit rule (D-EMR-01).**
  - Chart actions commit immediately as their own rows: vital signs, allergies, problems, encounter diagnoses, orders, results, medicines, pregnancy and procedures.
  - Note-born structured items (findings, examination findings) live in the draft and are committed as facts at signing, in the same transaction as the note.
  - The same kind of item recorded outside a note (a nurse's foot examination, for example) commits immediately.

### 7.4 Clinical facts (CFC)
- **Observations: E3.** Evolve `clinical_observations` to the CFC 3.2 shape: add columns, backfill `value_canonical`, `source`, `trust` and `status`, and keep existing readers working through a compatibility view if needed. Results carry `report_id`, `order_id` and `entry_mode`.
- **`conditions`:**
  - `category`: problem_list_item or encounter_diagnosis; family history uses `subject_relation`;
  - `rank`: primary or secondary, for encounter diagnoses;
  - `term_id` (the diagnosis term) and its codes (`icd11`, `icd10_who`, `ciel`);
  - `hmis_category_id` and `idsr_class`, both derived at write time from signed mappings and nullable until signed.
- **Also:** `medication_statements`, `pregnancy_episodes` and `procedures` (CFC 3.1), and `medication_orders` (Phase 7).

### 7.5 Allergies (a new fact kind; CFC addendum)

```sql
allergies (
  id uuid primary key, logical_id uuid not null, version int not null, supersedes_id uuid,
  tenant_id uuid not null, patient_id uuid not null,
  substance_kind text check (substance_kind in ('drug_ingredient','drug_class','food','environmental','other')),
  substance_code text,                    -- ATC code or internal allergen id; null when uncoded
  substance_text_ciphertext bytea,        -- as typed; displayed, never matched by prescribing
  category text check (category in ('medication','food','environment','biologic')),
  type text check (type in ('allergy','intolerance')),
  criticality text check (criticality in ('low','high','unable_to_assess')),
  manifestations text[],                  -- coded: rash, urticaria, angioedema, anaphylaxis, bronchospasm, sjs_ten, other
  severity text check (severity in ('mild','moderate','severe')),
  clinical_status text check (clinical_status in ('active','inactive','resolved')),
  verification text check (verification in ('unconfirmed','confirmed','refuted','entered_in_error')),
  onset jsonb,
  source text check (source in ('patient','relative','record','clinician_observed','resus_ample_migration')),
  effective_at timestamptz not null, recorded_at timestamptz not null default now(),
  recorded_by uuid, sensitivity text not null default 'standard'
);
allergy_status_assertions (             -- insert-only; the latest row is current
  id uuid primary key, tenant_id uuid not null, patient_id uuid not null,
  assertion text check (assertion in ('no_known_drug_allergies','unable_to_assess')),
  asserted_by uuid not null, asserted_at timestamptz not null default now()
);
```

The resolver (`lib/emr/allergy.ts`) decides the status. An active allergy always outranks an assertion. No update is ever needed.

### 7.6 Orders, specimens and results
- **`service_requests`** (orders; immutable once active):
  - `kind`: lab, imaging, ecg, procedure or referral;
  - `test_id`, `priority`, `reason_condition_ids` and `reason_text_ciphertext`;
  - `fasting_required`, `requester_id`, `requester_cadre` and `performer` (in_house, external or referral);
  - `intent_source` (clinician, triage_recommendation or resus_handover) and `source_intent_id`;
  - `requisition_no`, `effective_at`, `recorded_at` and `sensitivity`.
- **`service_request_events`** (append-only) records accepted, cancelled (with reason), on hold and resumed.
- **`specimens`** records collection and is immutable: `order_id`, `specimen_type`, `container`, `collected_at`, `collected_by`, `fasting_state`, `fasting_hours` and `identifiers_confirmed`.
- **`specimen_events`** records received and rejected (with reason).
- **`diagnostic_reports`** follows the fact pattern and is versioned:
  - `order_id`, `kind`, `status` (preliminary, final, amended, corrected, cancelled or entered_in_error), `issued_at` and `performer_lab_id`;
  - `entry_mode` (direct, transcribed or interface) and `entered_by`;
  - `conclusion_code` and `conclusion_ciphertext`;
  - `critical`, computed at entry from signed entries only.

  Result values are observation rows carrying `report_id`.
- **`result_acknowledgements`** (append-only) records the report, the user, the action (seen, acted or forwarded), `forwarded_to` and an encrypted note.
- **`critical_result_communications`** (append-only) records the report, `communicated_by`, `communicated_to`, the method (in_app, phone or in_person), `read_back` and the time.

### 7.7 Registries
- **`test_catalogue`** (the facility test menu):
  - panel components as concept IDs, specimen type and container, `fasting_required` and default units;
  - `in_house`, `capability_id`, an operational turnaround target, and `active`.
- **`devices`**: kind (glucometer, ketone meter, HbA1c analyser, BP monitor), model, serial, calibration, limits, validated and active. These supply the CFC section 6 entry defaults.
- **`diagnosis_terms`** (MedSync's interface terminology):
  - `display` and `synonyms`;
  - `icd11_code`, and `icd10_who_code` (null until E6);
  - `ciel_id`, `chronic`, `hmis_category_id`, `idsr_class` and `sensitivity`;
  - `status` (draft or cso_signed), `source` and `verified_on`.
- **Reference entries.** Reuse the signed-reference store that triage and resus use (Q14) for critical limits, plausibility bounds, HMIS definitions and IDSR classes, in the same entry shape.
- **CFC registries.** `clinical_concepts`, `drug_class_tags`, `capabilities` and `facility_capabilities`, seeded from the catalogue JSON.

### 7.8 RLS and identity (E2)
- **Reads.** One shared predicate, `patient_id in (select private.accessible_patient_ids())`, plus tenant scope. It implements the patient-access rule in force today (Q10) inside one function, so that the pending GATE A decision changes one place. Reception is denied.
  - Restricted rows stay readable by clinical staff with access, because restriction governs channels, not clinical visibility.
  - Patient-facing and export paths read through separate views that exclude restricted rows.
- **Identity.** Each server action opens an interactive transaction and first sets a transaction-local identity (`set_config('app.user_id', …, true)`, plus role and tenant). One helper, `private.current_user_id()`, reads it, and falls back to `auth.uid()` where Supabase Auth is the provider.
  - Tables use FORCE ROW LEVEL SECURITY, and reads connect as a non-owner role.
  - With Prisma, use interactive transactions only; a batch `$transaction` inside a client extension breaks rollback.
  - Confirm the current pattern at Q2 and keep it if one already exists.
- **Writes.** The service role, inside audited server actions (the house pattern). Client INSERT, UPDATE and DELETE are denied.
- **Probes per object.** Same-hospital clinician: read allowed. Other hospital: denied. Reception: denied. Anonymous: denied. Patient role: denied until Gate CG. Client-side writes: denied. Break-glass: allowed and logged.

### 7.9 CFC v1.1 addendum (written in Phase 1, signed at GATE A)
1. A new fact kind, `allergy`, with status assertions, a projection and a Zod schema.
2. A concept extension for general outpatient and emergency results (clinical reference section 8), generated into `clinical-fact-concepts.v1.1.json`. Codes are marked by CFC verification status; candidates are verified at loinc.org before export.
3. Conditional sensitivity: pregnancy facts are restricted for patients under 18, if D-CFC-09 is signed that way.
4. Uncatalogued results: stored and displayed, never interpretable.
5. Write-path wording: "server-side only, through audited server actions using the service role" replaces "Edge Functions only".
6. The observation store is realised by evolving `clinical_observations` (if E3 is signed).
7. Result provenance: `report_id`, `order_id`, `entry_mode`, and the trust mapping in D-EMR-08.

---

## 8. Server actions

Reuse, don't duplicate: start encounter, complete encounter, triage submit, the assignment actions, resus close-out and the prescribing dialog. Extend those where needed.

**Contract for every action:** `'use server'`; Zod; AAL2, scope and cadre checks; one interactive transaction; one audit row; idempotent on a client key; returns `{ id, serverTime }`. Notification failures never throw.

- **Encounters:** `startEncounter` (extended with class, template, visit and handoff prefill), `completeEncounter` (disposition and follow-up; warnings are returned, not thrown), `closeEncounterAdministratively({ reason })`, `consumeResusHandoff`.
- **Notes:** `saveNoteDraft` (autosave, versioned per author draft), `signNote`, `requestCosign`, `cosignNote`, `addAddendum`, `markNoteEnteredInError`.
- **Facts:**
  - `recordObservations` (batched, with device defaults; the unit check runs client-side and again on the server);
  - `recordAllergy`, `assertAllergyStatus`;
  - `recordProblem`, `updateProblemStatus`, `recordEncounterDiagnosis`;
  - `recordMedicationStatements`, `confirmCurrentMedicines`;
  - `recordPregnancy`, `recordProcedure`, `markFactEnteredInError`.
- **Orders and results:** `placeOrders` (batched), `cancelOrder`, `collectSpecimen`, `receiveSpecimen`, `rejectSpecimen`, `enterResults`, `amendResults`, `acknowledgeResults` (batched), `recordCriticalCommunication`.
- **Intents:** `acceptSuggestedOrder`, `dismissSuggestedOrder`.
- **Prescribing** (Phase 7): `prescribe`, through `lib/prescribing`, with the allergy input taken from the allergy record.

The permission matrix (actor × action) is proposed at Phase 1 from Q9 and signed at GATE A (D-EMR-16).

---

## 9. Sync, clocks, offline

Reuse the resus v2 patterns; add no new state library.

- **Structured entries** use the optimistic queue:
  - entries render at once as pending, then retry with backoff while online;
  - the queue pauses offline and flushes in order on reconnect;
  - a `beforeunload` guard runs while anything is pending;
  - an amber banner reads "Offline, N entries waiting".
- **Note drafts** autosave to the server when typing pauses, using a debounce hospital setting approved at GATE A, with a version check on every save. Offline, the draft stays on the page with the amber banner. Persistence across a closed tab follows E5: in memory by default; encrypted IndexedDB only if the CSO accepts the DPPA trade-off.
- **Server clock.** Fetch the server time on load and every 5 minutes, and take the offset from the round-trip midpoint. Effective times use the corrected clock; warn if the offset exceeds 30 s.
- **Realtime.** Use Supabase Broadcast from the database on private channels:
  - `chart:<patientId>` carries PHI-free payloads, `{ kind, id, at }`;
  - RLS on `realtime.messages` limits listening to active clinical staff with access;
  - clients fetch the delta through a scoped, audited server action;
  - fallback: poll every 15 s while the tab is visible.

  Check function names against the current Supabase docs at build time, not memory.
- **Concurrency.** Notes are per-author documents, so two clinicians never merge text. Facts are insert-only; near-identical entries from two sources are flagged for merging, never double-counted (CFC section 6).

---

## 10. Security, privacy, audit

- **Access and writes.** AAL2; hospital scope; reception blocked; service-role writes inside audited actions. Every write and every reveal is audited.
- **Chart opens** are logged in `clinical_phi_access_log`: who, which patient, when, and the reason when break-glass was used.
- **Encryption.** Narrative, free text and uncoded allergen text are encrypted. The HMAC key is separate from the encryption key, and key rotation is documented in an ADR.
- **Restricted content** is excluded from patient-facing prints by default, and from SMS, push and exports. In clinical views it carries the lock marker.
- **Patient access** to the record waits for Gate CG. FHIR output is test-only in this build; any external sharing waits for the DPA/MoU (a legal placeholder).
- **Retention.** Nothing is deleted by this build; the retention policy is a legal placeholder.
- **Supabase keys.** If the server client still reads a legacy `service_role` key, flag it: Supabase is replacing the `anon`/`service_role` keys with publishable and secret keys.

---

## 11. Phases and gates

### Phase 0 — Discovery and baseline (no product changes)

Answer and report:

- **Data layer and runtime**
  - **Q1** ORM and migration pattern on this branch; enum style (Postgres enums, or text with CHECK).
  - **Q2** How identity reaches the database today (Supabase Auth `auth.uid()`, Better Auth with transaction settings, or the service role with app-level scoping), and which role reads run under.
  - **Q3** Database runtime (PGlite via `prisma dev`, hosted Supabase or local Postgres), connection limits, and what E1 needs.
- **Existing clinical objects**
  - **Q4** The visit model: the unified intake record, and how triage records, assignments and encounters link to it.
  - **Q5** The encounter model: fields, states, `last_activity_at`, the complete action, the clerking page, what it stores today and where, and any feature flags.
  - **Q6** `clinical_observations`: columns, writers (triage, resus), readers and row counts, plus the gap to CFC 3.2.
- **Safety seams**
  - **Q7** Allergy storage: resus AMPLE, any other allergy fields (patient profile, triage) and exactly what `lib/prescribing` reads. Write a **failing** test that reproduces R1.
  - **Q8** The resus handoff (`pending_encounter_handoff`, the handover payload, the death-certificate intent) and the shape of triage recommendation intents.
- **Access and security**
  - **Q9** Today's permission matrix by cadre (start, document, complete, order, enter results), and whether the catalogue has a laboratory cadre.
  - **Q10** The patient-access rule in force (pending GATE A) and how it is enforced.
  - **Q11** The `lib/encryption.ts` API, key storage and rotation, and any HMAC helper.
- **Surfaces and seams**
  - **Q12** Existing patient chart or profile routes.
  - **Q13** Workspace merge state, the lane registry API and the FW-2 implementation.
  - **Q14** The signed-reference store that triage and resus use (a table or files). Reuse it.
- **Environment**
  - **Q15** Test data: encounters by state and age, observation volume, and the count of resus AMPLE allergies.
  - **Q16** Whether Playwright and axe are available (if not, STOP and flag), print-style precedent, and the feature-flag mechanism.
  - **Q17** Tokens in `DESIGN-medsync.md`: critical value, amber, neutral chip, the page-header pattern, plum for place.
  - **Q18** Performance of the current clerking page: TTFB, JS size and interaction timings.

Baseline:
- screenshots of the clerking page and any chart page at 390×844, 834×1194 and 1440×900, light and dark;
- the scripted standard visit (clinical reference 2.12), measured in taps, keystrokes and seconds;
- the counts from Q15;
- failing tests for R1 (allergy invisible across surfaces), R2 (stale open encounters) and R3 (no link from order to result).

**STOP 0.** Report Q1–Q18, the prompt-versus-repo differences, the failing tests and the baseline.

### Phase 1 — GATE A proposal (documents only)
Write `docs/emr/gate-a-proposal.md`:
- **The schema diff,** evolve versus new, with the legacy-data plan: flag, never alter.
- **ADR drafts** (Section 17), the CFC v1.1 addendum and the permission matrix.
- **Annotated wireframes** for:
  - the safety bar, the chart sections, and the clerking page at desktop, tablet and phone widths;
  - findings, the diagnosis picker and the allergy editor;
  - order entry, specimen collection, result entry, and results review with critical communication;
  - signing, co-signing and addenda, completion, and the printouts.

  Start from Section 5; improve, don't bloat.
- **Clinical content:** template schemas from the clinical reference, and the concept-extension JSON with every code marked by status.
- **The test plan.**
- **The decision table** (Section 15) with a signature block, listing every clinical-reference item that needs the CSO's signature.

**STOP 1.** Nothing proceeds without signatures on E1–E10 and D-EMR-01 to D-EMR-16, and on the D-CFC decisions this build depends on (Section 15).

### Phase 2 — Data layer
- **Migrations:** tables and evolutions, triggers, views and indexes.
- **Access:** RLS, the identity mechanism (E2) and the probes.
- **Libraries and seeds:**
  - `lib/units`;
  - seeds for concepts v1 and v1.1, drug tags, capabilities, a starter test menu, and starter diagnosis terms (ICD-11 codes only after E6);
  - the device registry, facility capabilities and reference-entry wiring.
- **Backfills:**
  - resus AMPLE allergies into `allergies`, with provenance;
  - `clinical_observations` to canonical values, trust and source;
  - encounters to class, with attendance type `unknown`.
- **The nightly integrity job** (CFC 3.7).

**STOP 2.** The migration diff; the RLS probe table (every object × every actor); unit-library tests; seed and backfill counts; a dry run of the integrity job.

### Phase 3 — Engines (pure, no UI)
- The Section 6 modules with their tests, and CFC section 10, items 6 and 7.
- The property tests in Section 6.
- Loader p95 at 2,000 facts.

**STOP 3.** Test counts, the rule-coverage table, property-test results and loader timings.

### Phase 4 — Write paths and handoffs
- The Section 8 actions and the handoffs (triage, scheduling, resus, recommendations).
- **Prescribing re-pointed to the allergy record.** The resus AMPLE editor writes through `recordAllergy`, and the R1 test turns green.
- The Workspace lane sources (if merged), realtime broadcast, and an audit-completeness check.

Scenarios (Playwright if present, otherwise scripted integration tests):
- **A1** Walk-in, then triage, then take and start. The clerking page is pre-filled, a diagnosis is added and an mRDT ordered. The specimen is collected with the fasting chip, the result is entered and acknowledged, and the visit completes home.
- **A2** An allergy recorded in OPD is blocked by the existing check when the same drug is prescribed in resus. An allergy recorded in resus AMPLE shows in the OPD safety bar. (R1 fixed.)
- **A3** A critical result is entered and shows the critical style. The laboratory records its communication, and the patient appears in the Critical results lane. Acknowledging clears it; leaving it unacknowledged escalates it after the signed time frame.
- **A4** A signed note cannot change. An addendum threads under it. Marking entered in error keeps it visible with the reason, and dependent engine fixtures reverse.
- **A5** A resus handover is consumed: an encounter with an ISBAR note is created, and the outstanding actions become proposed orders.
- **A6** A stale encounter is closed administratively with a reason; nothing auto-closes.
- **A7** Reception is denied, and another hospital is denied. An intern's note awaits co-signature without blocking the intern's orders.
- **A8** A 30-second offline drop mid-typing loses nothing, and the queue flushes in order.
- **A9** Choosing a notifiable diagnosis opens the confirm sheet and creates a pending notification intent and an IPC prompt.

**STOP 4.** The action test matrix (actor × action, allowed or denied), the scenario results and the audit-completeness counts.

### Phase 5 — Chart and clerking UI (behind the `emrV1` flag)
- **Chart:** the safety bar and the chart sections.
- **Clerking page:** templates, findings, diagnoses, allergies, medicines and pregnancy.
- **Record lifecycle:** signing, co-signing, addenda, late entries and entered in error; completion and printouts.
- **Interaction:** the keyboard shortcuts and the offline banner.

**STOP 5.**
- Screenshots at three viewports, light and dark, and budget counts against the baseline.
- axe (0 serious or critical) and green red-scarcity tests.
- Flag off: regression screenshots identical to the baseline.

### Phase 6 — Orders and results UI
- **Ordering and collection:** order entry (favourites and panels), specimen collection and labels.
- **Results:** result entry (direct and transcribed), review and acknowledgement, the critical-communication record, and the flowsheet with sparklines.
- **Workspace:** the results lanes.

**STOP 6.** Screenshots, the A1 and A3 re-run on the real UI, and the result-entry timing.

### Phase 7 — Prescriptions from the encounter (behind the `emrPrescribing` flag; only if D-EMR-14 is signed)
- Prescription records (MedicationRequest) created through the existing prescribing dialog and checks, with the allergy input taken from the allergy record.
- A printed prescription, and medication statements updated.
- The pharmacist queue and dispensing stay out of scope.

**STOP 7.** The prescribing scenarios, including A2 from the encounter.

### Phase 8 — Hardening and documentation
- **Performance:** the budgets in Section 13.
- **Resilience:** offline drills and realtime reconnect.
- **Presentation:** reduced motion and dark mode.
- **Documentation:** the ADRs and the final report.

**STOP 8 (final).** The table in Section 14, filled in.

---

## 12. Accessibility, motion, colour

- **Standard.** WCAG 2.2 AA in light and dark; touch targets ≥ 44×44 px.
- **Safety bar.** It has an accessible summary read first: "Amina Nakato, 52, female, MRN 004812. Allergy: penicillin, anaphylaxis. One critical result awaiting acknowledgement."
- **Finding chips** are toggle buttons whose accessible names state the value in words ("Chills, present"), never the colour.
- **Live regions.** Polite for saves and new results. Assertive only once per critical result, rate-limited.
- **Never colour alone.** Every state has an icon and a word.
- **Reduced motion.** No animated entries; the autosave status changes without motion.
- **Colour roles:**
  - headings weight 500, and no left-edge accent bars;
  - plum marks place only: the active navigation item, the current chart section and the current note section (ADR 0097);
  - buttons and focus rings are teal;
  - red follows Law 8.
- **Print.** Black on white, two identifiers in the header and footer of every page, and page numbers.

---

## 13. Performance budgets

| Measure | Target |
|---|---|
| Chart TTFB | p95 < 400 ms, safety bar in the first paint |
| Section switch | < 100 ms |
| Autosave round trip | p95 < 300 ms, never blocking input |
| Diagnosis search | p95 < 150 ms (a lazily loaded, cached term index on the client, with a server fallback; no new dependency) |
| Sign note | p95 < 800 ms |
| Result-entry save | p95 < 400 ms |
| Fact loader | p95 ≤ 60 ms at 2,000 facts (CFC section 7) |
| JavaScript added to the clerking route | ≤ 90 KB gzipped (report the number) |
| Layout shift on autosave and live updates | zero |
| Queries per chart render | a fixed count |

---

## 14. Numbers to report at the final STOP

| Metric | Baseline | Target | Result |
|---|---|---|---|
| Places allergies are stored | P0 | 1 | |
| Prescribing check sees allergies recorded in OPD and in resus | P0 | yes | |
| Orders without a traceable end state | P0 | 0 | |
| Encounters open beyond the idle window | P0 | reported, none auto-closed | |
| Signed notes changed after signing (trigger test) | — | 0 | |
| CFC concept projections passing (v1 + v1.1) | — | all | |
| Unit-library known-pair tests | — | ≥ 30 | |
| RLS probes passed | — | 100% | |
| Candidate codes exported | — | 0 | |
| ICD-10 content shipped without a recorded licence | — | 0 | |
| Standard visit (reference 2.12): taps, keystrokes, seconds | P0 | Section 4 budgets | |
| Diagnosis search p95 | — | < 150 ms | |
| Chart TTFB p95 | P0 | < 400 ms | |
| JavaScript added to the clerking route | P0 | ≤ 90 KB gz | |
| axe serious or critical | P0 | 0 | |
| Red-scarcity tests | — | green | |
| Keystrokes lost in the 30-second offline drill | — | 0 | |
| Scenarios A1–A9 | — | all pass | |

---

## 15. GATE A decisions (Fadhul owns; recommendations given)

**Prerequisites from MS-DATA-CFC-001:** D-CFC-01 to D-CFC-15, especially 02 (one observation store), 03 (bitemporal versions), 04 (encryption boundary), 06 (eGFR), 09 (restricted classes), 11 (shared tokens), 13 (capabilities) and 14 (unit prompts).

**Engineering**

| # | Decision | Recommendation |
|---|---|---|
| E1 | Database runtime for this build | **A hosted Supabase development project with synthetic data only.** No installation. It gives parity with production for roles, RLS, Realtime and scheduled jobs, and it keeps RAM free on the current development machine. Keep `prisma dev` for pure-engine unit tests. A native local Postgres needs your approval as new software. |
| E2 | How identity reaches RLS | A transaction-local identity set at the start of every interactive transaction, read by one helper; FORCE ROW LEVEL SECURITY; a non-owner role for reads. Write an ADR. |
| E3 | The observation store | Evolve `clinical_observations` into the CFC shape, with a compatibility view for old readers. No second table. |
| E4 | Encryption boundary (= D-CFC-04) | Structured values in plaintext under RLS and at-rest encryption; identifiers and free text application-encrypted. Write an ADR. |
| E5 | Draft persistence across a closed tab | Server autosave plus in-memory by default. Encrypted IndexedDB only if you accept the DPPA trade-off (same as resus E1). |
| E6 | Terminology licensing | Ship ICD-11 first (CC BY-ND 3.0 IGO: codes and titles unmodified, attributed). Apply now for a WHO commercial licence for ICD-10, and keep ICD-10 fields empty until it is recorded. LOINC is used under its licence terms, with a notice. Confirm CIEL's terms before use. |
| E7 | FHIR R4 | A projection for export tests only; no endpoint until the DPA/MoU. Uganda reports FHIR R4 as its main version, a national terminology server in production, and a core implementation guide in development. |
| E8 | Workspace lanes | Critical results after Resus; Results to review after In progress; To co-sign after Results to review. Registered through the lane registry, with FW-2 precedence updated in that module's tests. |
| E9 | Printing | Print CSS only; no PDF dependency. |
| E10 | Note integrity | HMAC-SHA-256 over the canonical signed content, with a dedicated server key held separately from the encryption key. |

**Clinical (CSO)**

| # | Decision | Recommendation |
|---|---|---|
| D-EMR-01 | Commit rule | Chart actions commit immediately. Note narrative and note-born findings commit at signing. |
| D-EMR-02 | Signing | Signed is immutable. Changes are made by addendum. Late entries are labelled (hospital setting). Entered in error needs a reason, by the author or a supervisor. |
| D-EMR-03 | Co-signature | Build the mechanism now; the sets follow the open co-sign decision. Co-signing never blocks care; reviews surface in To co-sign. |
| D-EMR-04 | Allergy model | One patient-level record. "No known drug allergies" is an assertion; "unable to assess" is a state. Uncoded allergens are displayed but not checked. Resus AMPLE allergies are migrated with provenance, and prescribing reads the record. |
| D-EMR-05 | Problem list and diagnoses | Kept separate. One primary diagnosis per visit. Symptom diagnoses allowed. Resolving or refuting needs a reason. |
| D-EMR-06 | Critical results | Definitions signed with the laboratory lead. The laboratory records the communication with read-back; the ordering clinician acknowledges; escalation goes to the in-charge after the signed time frame. Red on the value only (like critical vitals); amber for awaiting acknowledgement. |
| D-EMR-07 | Acknowledgement | Responsibility sits with the orderer or whoever covers them. Routine results go to Results to review. An amended result needs re-acknowledgement. |
| D-EMR-08 | Result trust | Direct laboratory entry: T4 when final. Interface: T4. Clinician transcription: T3 until verified by laboratory staff. Point-of-care test by staff: T3. |
| D-EMR-09 | Completion | Disposition required. Warnings, not blocks. Administrative closure needs a reason. Nothing auto-closes. |
| D-EMR-10 | HMIS | Capture attendance type, primary-diagnosis category and referrals now. Definitions and mapping are signed; reports come in a later prompt. |
| D-EMR-11 | IDSR | A notifiable flag on diagnosis terms opens a confirm sheet with the signed action text, a pending notification intent and an IPC prompt. It never blocks. |
| D-EMR-12 | Pregnancy status | Shown and prompted within a signed age range. Triggers: ionising imaging orders, and prescribing (the check belongs to the prescribing engine). |
| D-EMR-13 | Restricted content | Excluded by default from patient prints and every external channel; included item by item by the clinician. |
| D-EMR-14 | Phase 7 | Include prescription records now. The pharmacist prompt needs the object, and the allergy re-point is safety-critical. |
| D-EMR-15 | Templates and minimum-to-sign rules | As in the clinical reference, sections 2.1–2.11. |
| D-EMR-16 | Permission matrix | Who signs, orders, enters results, acknowledges, resolves problems and marks entered in error, by cadre. Laboratory cadres depend on the open cadre-catalogue scope. |

---

## 16. Out of scope (leave clean seams)

- **Engines built next:** the monitoring engine (the next prompt; it shares the observation store), the notifications engine (this build writes outbox rows only) and the care-team workspace.
- **Inpatient care:** ward, bed, MAR and discharge summaries. The inpatient encounter class exists as a container only.
- **Pharmacy:** the pharmacist queue, dispensing, stock and e-pharmacy.
- **Integrations and reporting:**
  - laboratory, imaging and device integrations (`entry_mode = interface` is reserved);
  - HMIS report generation and DHIS2 submission;
  - FHIR endpoints and the national exchange.
- **Patient access and mobile writes:** patient access to the record, and mobile clinical writes (both wait for Gate CG).
- **Other:**
  - document scanning and attachments; billing and insurance;
  - duplicate-patient merging (the patient model owns it);
  - import from other EMRs (`existing_emr`);
  - the UNEPI immunisation record and growth z-scores (v1.1);
  - antenatal and maternity registers (programme modules).

---

## 17. ADRs (next free numbers; check whether 0097 exists first)

- The clinical fact store and adoption of the Clinical Fact Contract (with the v1.1 addendum).
- RLS identity propagation (E2).
- The encryption boundary (E4) and the HMAC note-integrity key (E10).
- The database runtime move (E1).
- The note model: drafts, the commit rule, signing, addenda and events.
- The allergy record as the single source of truth.
- Results acknowledgement and critical results.
- Coding and terminology licensing (ICD-11 first).
- The FHIR projection.
- Encounter completion and administrative closure.

---

## 18. Definition of Done

- [ ] R1–R9 resolved, or deferred with a reason.
- [ ] Allergies have one home; prescribing sees allergies from every surface; the R1 test is green.
- [ ] No order without a traceable end state; no signed note mutable; nothing auto-closes.
- [ ] Every Section 6 module is tested, and the property tests pass.
- [ ] The CFC section 10 checklist is complete, and the CFC v1.1 addendum is signed.
- [ ] RLS probes are green for every object and actor, including denial of client writes; realtime authorisation is proven.
- [ ] Every surface meets its budget; axe is clean; red-scarcity tests are green; reduced motion is honoured.
- [ ] A1–A9 pass on phone, tablet and desktop viewports.
- [ ] With flags off, existing pages behave as before.
- [ ] No unlicensed terminology and no candidate code is exported; `THIRD-PARTY-NOTICES.md` is complete.
- [ ] ADRs written; the final report has numbers; the diff on `feat/emr-engine` is reviewable.

---

## 19. Parallel reminders (flag if touched)

- **Workspace:** D2 (patient-level death record) and D3 (idle setting) are consumed here. If the Workspace has not merged, keep the encounter fields ready and add no lanes.
- **Resus v2:** the AMPLE editor's look and behaviour stay the same; only its storage moves. `pending_encounter_handoff` is consumed, never duplicated.
- **Triage recommendations:** intents are accepted or dismissed here; executing protocols remains the workflow prompt.
- **NCD engine** (MS-NCD-ENG-001): it reads facts through `loadFactSnapshot`. Build nothing of it here.
- **Monitoring engine** (next): it writes to the same observation store. Keep the telemetry and fact boundary in CFC 3.1.
- Pharmacy Board of Uganda, never PSU; the Supabase key change.
