# EMR build — STOP reports

Gate record for PROMPT-ENCOUNTER-EMR on `feat/emr-engine`. Owner and CSO sign-off: every GATE A decision was signed as
recommended on 2026-09-26, in session. Harmonisations: `HARMONISATION.md`.

## STOP 0 — Discovery (2026-09-26)

Five read-only agents answered Q1–Q18. The evidence is in `discovery/{data-layer,clinical-objects,safety-seams,access-workspace,design-ui-terms}.md`,
cited file:line.

| Q   | Answer (short)                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Drizzle + postgres-js; hand-written SQL in `supabase/migrations`, one tx per file; text + CHECK; GATED header from 0039; next free is **0071**                                                        |
| Q2  | No `set_config` anywhere. Clinical reads and writes use the owner-role Drizzle client, which bypasses RLS. Scoping is in TS (`resolveEncounterAccess`); reads are logged to `clinical_phi_access_log` |
| Q3  | Hosted Supabase only (pooler :6543, `prepare:false`). RLS suites skip without env. A dev project for E1 does not exist yet                                                                            |
| Q4  | The visit is `patient_intakes`, linked three ways (intake.encounter*id, triage.intake_id, appointment_id). Assignment is a \_planned encounter* with `triage_record_id`                               |
| Q5  | `encounters` has type, state (incl. planned) and disposition (0040), but no `last_activity_at`. End visit = Edge `ha-complete-encounter` (no disposition). The clerking page stores only NCD drafts   |
| Q6  | `clinical_observations` is mutable; written by the Edge obs function and the resus v1/v2 mirrors; triage never writes it; Drizzle CHECK drifted                                                       |
| Q7  | Allergies: `patient_allergies` (no live writer) + resus timeline captures (current episode only). Resus prescribing checks on the client only                                                         |
| Q8  | `pending_encounter_handoff` is set and never read; the handover is SBAR (4 fields); the death-certificate intent is a checklist tick; triage recommendations are never stored                         |
| Q9  | Lab cadres exist (LAB_TECH, LAB_TECHNOLOGIST) with `/lab`. `clerkshipWriteAuthority` covers 5 medical cadres + CO; intern co-sign is soft                                                             |
| Q10 | Four divergent access rules; none checks the hospital; break-glass is superadmin-only                                                                                                                 |
| Q11 | `lib/encryption.ts` encrypt/decrypt (AES-256-GCM) and blindIndex; one key; no separate HMAC key                                                                                                       |
| Q12 | Chart homes are `/doctor/patients/[id]` and `/nurse/patients/[id]` (shared `PatientClinicalRecordPanel`)                                                                                              |
| Q13 | Workspace merged. A lane is a LaneId + LANES + FW-2 branch + loader (no registry). Realtime is the 0069 broadcast pattern. The resus queue is typed to resus                                          |
| Q14 | Four file-based reference shapes. The resus `RefEntry` is chosen for the EMR                                                                                                                          |
| Q15 | Row counts not measured (no DB access); owner action O-4                                                                                                                                              |
| Q16 | Flags are env vars in `lib/<area>/feature.ts`. Playwright absent; axe-core present; no print CSS                                                                                                      |
| Q17 | Tokens: `bg-status-critical-bg/-fg`, `bg-status-caution-bg/-fg`, `<Pill>`, `ClinicalBadge`, `PageHeader`, plum-50/800 for place, Fraunces/Geist, expo-out 100/150/250/400 ms                          |
| Q18 | Clerking page: 6 client islands, 4,599 lines (ncd-capture 2,110). Autosave only when a section is left. Not measured (no build at P0)                                                                 |

**R1–R9:** R1 confirmed, and worse (resus allergies are lost even to the next episode). R2 confirmed in practice.
R3 partly refuted (the link exists; acknowledgement is missing). R4 confirmed. R5 confirmed (triage never writes
observations). R6 confirmed in practice (the tables exist; there is no writer). R7 refuted (no Prisma). R8 confirmed
(plaintext `section_data` and drafts). R9 confirmed, and worse (ICD-10 is already committed).

**Additional safety findings:**

- The resus emergency administration never re-runs the allergy check on the server.
- `recordClerkshipVersion` and lab release are not transactional.
- `ha-start-encounter` can open a second encounter for one visit.
- NCD drafts can be written to completed encounters without an access check.

All are addressed in HARMONISATION §2.

**Baseline deferred:** screenshots and timings of the current clerking page need a build. They are taken once, in the
P5 harness, before the new UI is switched on; with the flag off, the old page is served unchanged.

## STOP 1 — GATE A proposal (2026-09-26)

Pack: `gate-a-proposal.md` (1,783 lines: full 0071 SQL, the one access rule, RLS/grants, backfill, ADR drafts 0130–0139,
permission matrix, 13 wireframes, test plan, decision table + signature), `cfc-v1.1-addendum.md`, and
`data/emr/{note-templates.v1,clinical-fact-concepts.v1.1,diagnosis-terms.v1,test-catalogue.v1}.json`. The 0071 SQL was
dry-run over a PGlite replay of 0000–0070; that run found and fixed 2 bugs (a stray AND; new fact rows leaking into the
3 legacy observation readers, fixed with `state='fact'`).

- **Signature:** every decision was signed as recommended by Fadhul (owner, CSO), 2026-09-26, in session.
- **Terms:** 85 draft diagnosis terms, 13 of them restricted. Every ICD-11 code was checked against the findacode MMS v2026-01
  mirror (verified-mirror, not yet confirmed at icd.who.int), with its unmodified title kept. ICD-10 is null throughout (R9).
- **Test menu:** 35 tests, no reference ranges, no turnaround numbers.

**Decisions taken at this gate (the owner was not available; recorded for confirmation):**

- The operational defaults in §H.2 (autosave debounce 1.5 s, late-entry window 24 h, administrative-closure reasons)
  are hospital settings with defaults → owner confirms (O-9).
- **Allergies cross hospitals [H, safety-positive]:** a clinician with a legitimate basis for the patient at their own
  hospital sees, and the prescribing check uses, that patient's allergies from every hospital, each labelled with where it
  was recorded. Everything else stays hospital-scoped. This keeps today's behaviour (the legacy read had no hospital
  filter) → owner/CSO confirms (O-8).
- **CFC enum extension (addendum):** specimen `sputum`; containers `sodium_citrate`, `blood_culture_bottle`,
  `sterile_container`.
- **Erratum, recorded rather than edited:** in `clinical-fact-concepts.v1.json`, `cond.dka`/`cond.hhs`/`cond.hypoglycaemia_in_dm`
  cite the wrong findacode page. The codes themselves check out.
- **ACVPU `C`** (new confusion) has no AVPU answer, so those readings are quarantined (C11) until a concept is signed.
- **R1–R3 reproductions** are realised as PGlite-lane scenarios A2 (R1), A1/A3 (R3) and A6 (R2). The legacy code has no
  server-side seam a unit test could hold.

## STOP 2 — Data layer (2026-09-26)

**Migrations:** `0071_emr_record_spine.sql` (schema, one access rule, RLS, grants, backfill) and
`0072_emr_reference_seed.sql` (generated by `scripts/emr/gen-seed.ts`). Both are GATED. The PGlite harness replays all
73 (0000–0072).

| Check                                         | Result                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New tables (Drizzle `db/schema/emr.ts`)       | 21, + 5 `_current` views, + evolved: encounters, clinical_observations, encounter_orders, clinical_cosign_requests                                                        |
| Insert-only tables refusing UPDATE and DELETE | 13/13                                                                                                                                                                     |
| RLS probe matrix                              | **2,400 probes, 0 mismatches** (26 new objects × 10 actors × 4 ops × 2 paths, + 8 evolved tables × 10 × 4) + the access rule on 156 triples + patient-own CFC read denied |
| Drizzle ↔ database parity                     | 133 tables compared column by column (types, nullability, CHECK lists); EMR + evolved tables match. Older drift outside the EMR is pinned by name                         |
| Units (`lib/units`)                           | 103 tests: 35 known pairs, 25 round trips, 5 signed mismatch rules × both sides, comparators                                                                              |
| Seeds                                         | 145 v1 + v1.1 concepts, 21 drug-class tags, 29 capabilities, 35 tests, 85 draft terms; regeneration is byte-identical (drift guard)                                       |
| Backfill                                      | 4 `patient_allergies` + 2 resus captures + 1 NKDA copied in the fixture world; re-run adds 0; 100+ legacy tables hash-identical before and after                          |
| Lane                                          | 204 tests green; without `EMR_PGLITE=1`, all skip in < 1 s                                                                                                                |
| App `tsc`                                     | 0 errors                                                                                                                                                                  |

**Fixed at this gate:**

- The 0031/0033 policy would have let a patient read their own new (possibly restricted) fact rows through the client
  key. A RESTRICTIVE policy now hides every CFC row from `authenticated`, with a probe to prove it.
- The views REVOKE the default Supabase grants.

**Recorded:**

- The `_current` views return the newest version whatever its status; the loader and chart drop `entered_in_error`
  and `cancelled`.
- Registries (concepts, terms, test menu) are readable by any signed-in user: they are non-PHI config.
- `mg/dL` urea is read as urea nitrogen (the spec's factor), so a urea-mass report needs a separate unit (CSO note).
- Ionising flag on the chest X-ray menu item → CSO confirms.
- Pre-existing Drizzle drift outside the EMR is listed in the parity test and not fixed here.

## STOP 3 — Engines (2026-09-26)

`EMR_PGLITE=1 npx vitest run tests/emr tests/emr-db`: **18 files, 2,384 tests, all green**. App `tsc`: 0 errors.
ESLint clean.

| Module                                                                | Tests   | PROMPT §6 minimum         |
| --------------------------------------------------------------------- | ------- | ------------------------- |
| units                                                                 | 103     | 30                        |
| facts (round trip of all 204 concepts, contract, legacy, loader lane) | 821 + 7 | every concept             |
| encounter (5 actions × 5 states)                                      | 66      | every transition          |
| notes                                                                 | 313     | 40                        |
| carry-forward                                                         | 22      | 20                        |
| allergy                                                               | 230     | 25                        |
| orders                                                                | 442     | 30 + property             |
| results                                                               | 76      | 40                        |
| hmis                                                                  | 36      | 20                        |
| chart                                                                 | 39      | 25                        |
| fhir (12 resources)                                                   | 19      | a round trip per resource |

**Property tests:**

- A signed note's canonical form and HMAC never change (200 seeds).
- Nothing ordered disappears (400 seeds, plus state coverage).
- Never NKDA while an active allergy exists (200).
- No restricted item reaches a patient-facing payload (200).
- Same snapshot, same hash (200).

**Loader:** p95 **91 ms** at 2,000 facts on PGlite (WASM, in-process), against a 60 ms budget set for Postgres; measure
on the dev project (O-1). Payload **1.4 MB** against 1 MB: the v1 fact shape repeats the envelope on every fact.
Both are recorded as open budget items, not hidden.

**CFC errata recorded (ADR 0130):**

- `MedicationFact.status` collides with the envelope's status, so it is renamed `medicationStatus`.
- `ContextFact.setting` is optional.
- `PregnancyFact` has no EDD basis slot.
- `rpt.ecg` `device` clashes with the blood-pressure device enum.

**Carried to P4:**

- Reader-role grants for `patient_profiles` (column-limited), `encounter_medications` and `hospitals`.
- Invariants every write path must keep: each version keeps its concept; sensitivity is set at insert with
  `sensitivityFor`; addenda inherit the parent's restriction.
- The `ENCOUNTER_IDLE_MS` constant moves to `lib/workspace/flow.ts`.
- Legacy `resulted` orders never enter Results to review; only events-lifecycle orders do.

## STOP 4 — Write paths, handoffs, lanes, realtime (2026-09-26)

The first run was cut by the session limit after W3 finished (committed b2fd76e). W1 and W2 resumed from their partial
files, then W4 and W5 ran.

**Scenarios on the PGlite lane (`tests/emr-db/scenarios.test.ts`): 10/10.**

|     | Result                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | ✅ triage prefill (vitals projected), diagnosis, mRDT + fasting glucose (fasting chip enforced), result, acknowledgement, completion `home` (only the unsigned-note warning)              |
| A2  | ✅ an OPD-coded amiodarone allergy is refused by the resus re-check; an allergy written through resus AMPLE shows in the safety bar, **named** (fixed at this gate)                       |
| A3  | ✅ critical with a TEST-signed entry: flag, communication, Critical results lane, acknowledgement clears. Shipped time frame → `timeframe_not_signed`; TEST-signed and elapsed → escalate |
| A4  | ✅ signed note immutable (trigger), addendum threaded, entered in error struck with its reason, the note-born fact leaves the snapshot                                                    |
| A5  | ◐ encounter + signed ISBAR note + flag cleared. Outstanding actions are not turned into proposed orders: the resus close-out has no structured action list                                |
| A6  | ✅ stale encounter → Needs closing, stays open; administrative closure needs a reason                                                                                                     |
| A7  | ✅ reception refused (even with forged `isClinical`), other hospital refused; an intern's note awaits co-sign while their orders commit                                                   |
| A8  | ✅ 30 s offline with a reply dropped mid-flight: nothing lost, in order, the draft coalesced                                                                                              |
| A9  | ✅ notifiable (TEST-signed IDSR class): confirm payload, pending intent (an encounter event), IPC prompt, never blocks                                                                    |

**Audit completeness:** 40/40 EMR rows written in the scenarios have audit rows with the acting user, across 12 tables.

**Totals:**

- `EMR_PGLITE=1` over tests/emr, tests/emr-db and tests/workspace: 46 files, **3,084 tests**.
- Pre-existing suites (prescribing, resus, encounter, triage, ncd, lab): 120 files, 2,169 passed, 1 skipped.
- App `tsc`: 0; `typecheck:functions`: 0; ESLint: 0.
- The harness replays **74 migrations** (0073 = realtime + reader grants + allergy source text).

**Built:**

- Write functions and `'use server'` actions for encounters (through the two Edge Functions: start reuses the open
  encounter; complete takes disposition, follow-up and closure), notes (draft, sign with HMAC + note-born facts in one
  tx, co-sign through `clinical_cosign_requests.sign_note`, addendum, entered in error), facts (observations with the
  unit check, allergies, assertions, problems, diagnoses with one primary, medicines, reconciliation, pregnancy,
  procedures, generic entered in error), orders (placed, collected with the fasting chip, received, rejected,
  preliminary/final/amended results, acknowledgement, critical communication) and triage suggestions (accept/dismiss).
- `/lab` actions re-pointed under `EMR_V1`, each in one transaction.
- NCD bridge (`lib/ncd/cfc-map.ts`, 47 rules); drafts now encrypted.
- Resus AMPLE writes through to the allergy record; every prescribe path reads it, with a server-side re-check.
- Workspace: 3 new lanes (critical results, results to review, to co-sign) with the 400-seed property test green;
  one idle constant.
- 0073: PHI-free `chart:<patient>` broadcasts, receive-RLS through `private.may_hear_chart`.
- `lib/emr/sync` write queue and server clock.
- Resus close-out consumes the handoff after its commit.

**Fixed at this gate (both found by the integration agent in Phase 3 code):**

1. The chart styled a critical value as critical only when its context was complete. A critical glucose with an
   unknown fasting state would have lost its alarm. Missing context never hides an alarm now (test added).
2. The loader projected uncoded and backfilled allergies without their text, so the safety bar showed "substance not
   named". One resolver (`resolveAllergyTexts`) now serves the prescribe path and the loader. Under RLS, backfilled
   text comes through `private.allergy_source_text` (0073), which returns only that string and only with a basis
   (test added).

**Open, recorded for the owner:**

- If the record cannot be read at emergency administration, the dose is still recorded and stamped
  `allergyRecord='unavailable'` after the amber warning. CSO to confirm, or require an override reason.
- A close-out with no access basis leaves `pending_encounter_handoff` set; the chart offers to bring the handover in
  (P5).
- Duplicate vitals are flagged, not merged (10-minute window → O-9).
- New lanes use hotkeys 8, 9 and 0 (keys 1–7 unchanged).
- Chart broadcast payload is `{kind, at}` (no id).
- **Deploy order:** 0071–0073 must be applied **before** this branch is deployed. Drizzle's encounter inserts name the
  0071 columns, which is the house rule for gated migrations.

## STOP 5–6 — Chart, clerking desk, orders and results UI (2026-09-26)

**Built, all behind `emrV1LiveFor(hospital)`:**

- **Chart** at `/doctor/patients/[id]` and `/nurse/patients/[id]`: the safety bar; a section index (Summary, Timeline,
  Results flowsheet with sparklines and table alternatives, Notes, Orders, Medicines, Problems & allergies); a value
  provenance popover; live updates on `chart:<patient>` with a poll fallback; and "Bring in resus handover" when a
  handoff is pending.
- **Clerking desk** at `/doctor/encounters/[id]`:
  - three columns, a context sheet on tablet, one section at a time on phone;
  - template sections with bracket numbers, tri-state finding chips, the ROS grid, "still true?" carry-forward,
    medicines reconciliation, the allergy editor sheet, vitals with the unit prompt;
  - the diagnosis picker (all 85 terms reachable in ≤ 4 keystrokes);
  - Plan with the order sheet and triage suggestions;
  - NCD section; autosave through `lib/emr/sync` (neutral "Saved hh:mm", amber offline);
  - sign, co-sign, addendum, entered in error; completion sheet with disposition and administrative closure;
  - keyboard `/` `j` `k` `Ctrl/Cmd+Enter` `?`, none animated.
- **Orders and results:**
  - order sheet (favourites, panels, reason required, fasting marker);
  - specimen collection (two identifiers required, fasting chip) and label print;
  - `/lab` worklist with one-screen-per-panel entry (comparators, units, preliminary/final, reject);
  - amend view and critical-call record;
  - `/doctor/results` review with batch acknowledgement;
  - `sign_note` requests readable in `/doctor/cosign-queue`.
- **Print:** visit summary, referral, lab request, specimen label. Two identifiers; restricted items excluded unless
  added one by one.

**Checks:**

| Check                                                                       | Result                                                                                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| App `tsc`                                                                   | 0 errors                                                                                                                                |
| ESLint (96 changed files)                                                   | 0                                                                                                                                       |
| Tests (emr, a11y, workspace, design, lab, doctor, encounter)                | 3,031 passed, 0 failed                                                                                                                  |
| PGlite lane (`tests/emr-db`)                                                | 284 / 284                                                                                                                               |
| UI tests added                                                              | chart views, desk (64), orders + results (41), flag-off (5)                                                                             |
| Flag-off proof                                                              | `tests/emr/ui/flag-off.test.ts`: `emrV1LiveFor` false with `EMR_V1` unset; every EMR import sits behind one early return on the 4 pages |
| axe, jsdom over server HTML, 39 screens                                     | serious 0, critical 0                                                                                                                   |
| axe in the browser with CSS, 156 runs (39 screens × 4 viewport/theme pairs) | serious 0, critical 0 (from 83 contrast findings)                                                                                       |
| Screenshots                                                                 | **234** (39 screens × 390×844, 834×1194, 1440×900 × light/dark), scratch harness `~/Desktop/emr-harness/shots/`                         |
| JS added, clerking route                                                    | +89.7 KB gz (budget 90). Chart routes +58.2 KB; `/lab` +1.7 KB                                                                          |
| Red scarcity                                                                | only `components/emr/status-word.tsx` (a critical value, shown only when the payload says critical) and the allowlisted Emergency link  |

**Defects found in the screenshots and fixed (20):** flowsheet overflow and oldest-first scroll; the desk scrolling
into blank space at xl; the Emergency pill covering the phone action bar; a deceased patient's chart still offering
"Order a test"; UCUM codes on screen (`Cel`, `10*9/L`) replaced by unit words; nested `<main>`; unlabelled chip groups;
Fraunces on sheet titles; and contrast (caution 2.8:1, critical pill 3.9:1, teal links 3.7:1). The contrast fixes are
**EMR files only**.

**Open:**

- The desk is imported unconditionally, so flag-off users may download its code: move it behind a dynamic import
  (P8 fix).
- **Design-system tokens fail WCAG AA product-wide:** teal-600 text 3.7:1, caution pair 2.8:1, critical pair 3.9:1.
  The owner decides in `DESIGN-medsync.md` (the doctor-workspace session found the critical pair too).
- `/lab` under the flag lists only events-lifecycle orders, so drain legacy in-flight orders before switching.
- A covering clinician sees "Restricted result" + lock and can still acknowledge → CSO confirms.
- Nurse chart has no orders panel.
- Printouts leave encrypted narrative fields as write-in lines.
- `@page` "Page x of y" needs Chrome ≥ 131.
- The old encounter page keeps its design drift: it is the flag-off page and is left untouched.

## STOP 7–8 — Prescribing, records, review, final (2026-09-26)

### Phase 7 — Prescriptions from the encounter (behind `EMR_PRESCRIBING`, only where `EMR_V1` is on)

- `0074_emr_prescriptions.sql` (GATED, after 0071) evolves the 0039 prescriptions for OPD: frequency, duration,
  quantity, instructions, client key, sensitivity and the confirmed safety check. No new table. The harness replays
  **75 migrations** (last = 0074).
- One transaction writes the prescription and its `prescribed_here` medication statement. The check runs through
  `lib/prescribing` against the allergy record. The prescription prints from the print CSS.
- At P7: `write-prescriptions` **10/10**, prescribing UI **14/14**. After the review fixes: 12/12 and 16/16.

### Phase 8 — Records

ADRs **0130–0139** as built, the `CHANGELOG`, the `AGENTS.md` map, `THIRD-PARTY-NOTICES.md` (ICD-11 attribution,
LOINC notice, ICD-10 "licence pending") and `docs/emr/OWNER-RUNBOOK.md`.

### Review: 3 lenses, 21 findings, all fixed except where marked

Each fix has a test that fails on the code before it.

**Fixed in commit 2885034 (12):**

- **#1** Restricted orders were readable through the client key. RLS now hides them.
- **#2 / #11** Visit ownership and the day bound are now checked in `ha-start-encounter` and in the desk's intake read.
- **#3** The OPD prescribing snapshot is scoped to the hospital.
- **#4** Server client keys get their own namespace.
- **#5** Specimen labels withhold the name of a restricted test.
- **#6 / #15** A forwarded result stays open for the colleague and keeps its critical clock.
- **#13 / #14** Every resus allergy capture path writes through to the record. The gate is "0071 applied", not a per-hospital flag.
- **#17** The handover writes "tasks not recorded", never "none".
- **#20** Critical results are sorted first, before the row caps apply.

**Fixed by the two review fixers (the other 9: #7, #8, #9, #10, #12, #16, #18, #19, #21).** The fixers reported
these by area, so they are listed by area here.

_Desk:_

- **Autosave revision rollback** (`flows.ts`). A late reply to a save that was timed out and resent rolled the
  revision back. A reply now changes the held ids only if it is for another note, nothing is held yet, or its
  revision is higher.
- **First save overwrote an unseen draft** (`notes.ts`). A save with no revision now returns the current row
  untouched when its own client key made the draft. Otherwise it is refused as a conflict unless the content is
  identical.
- **Anyone's draft counted as the owner's unsigned note** (`queries.ts`, `encounter.ts`). Only drafts written by
  `encounters.clinician_user_id` count now. The desk no longer saves on open: `adopt()` holds mirrored content until
  the first edit or signing.
- **Chart actions made a new key on every tap** (`desk-client.tsx`). `createIntentKeys` gives one key per intent, so
  a retried tap is a replay. The vitals `readingSetId` is that key.
- **Signing re-wrote pre-filled readings as clinician point-of-care facts** (`notes.ts`, `cfc-map.ts`, `vitals.ts`).
  Readings still exactly as pulled are projected, never copied. Lab-reported glucose is no longer read as a vital.

_Prescribing and records:_

- **(high) A returned co-sign left the prescription looking valid** (`prescriptions.ts`). The desk now says "Not
  co-signed by a senior — not valid", the printout withholds it, and the co-sign queue shows the drug.
  **Partly open, see below.**
- **An unknown allergy status read like NKDA** (`sheet.tsx`). "Not recorded" and "unable to assess" now show amber
  words ending "check before prescribing".
- **A voided preliminary value came back live on release** (`results.ts`). The release also broke on a duplicate
  version. Only each value's current version is carried forward, and a voided value stays voided with its reason.
- **The chart showed no entered-in-error facts** (`chart.ts`). The chart now shows them struck, with the reason, in
  Results, Medicines, Problems & allergies and the Timeline. The engines' view is unchanged, and patient-facing
  payloads drop them.

**STOP 5–6 open items and UI-lens items, also fixed:**

- **(A)** The desk now loads with `next/dynamic`. A static import-graph test proves the flag-off page never reaches
  `_desk`.
- **(B)** An absent finding chip is no longer struck through. It shows a minus icon and the word "Absent".
- **(C)** The phone's section position counts only the visible sections, and the top trigger and the bottom bar
  agree.

### PROMPT §14 — final numbers

Phase 0 took no product measurements: no build and no database access (STOP 0, Q15 and Q18). Where the baseline says
"not measured", no number existed to compare against.

| Metric                                                        | Baseline                                                                                       | Target                     | Result                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Places allergies are stored                                   | 2: `patient_allergies` (no live writer) and resus timeline captures (current episode only)     | 1                          | **1**: `allergies` + `allergy_status_assertions`. 0071 copies the legacy rows once, with provenance. The legacy clerkship writer is unreachable when `EMR_V1` is on                                                                                             |
| Prescribing check sees allergies recorded in OPD and in resus | no: resus checked only on the client, and resus allergies were invisible outside their episode | yes                        | **yes**. Scenario A2/A2b, `prescribing-allergy.test.ts`, and a server re-check at emergency administration                                                                                                                                                      |
| Orders without a traceable end state                          | not measured (O-4); lab release was not transactional                                          | 0                          | **0**: property test, 400 seeds ("nothing ordered disappears"). Legacy in-flight orders are drained before the switch (runbook §8)                                                                                                                              |
| Encounters open beyond the idle window                        | not measured (O-4); no `last_activity_at`, so active clerking looked idle                      | reported, none auto-closed | **reported in Needs closing, none auto-closed** (A6)                                                                                                                                                                                                            |
| Signed notes changed after signing (trigger test)             | —                                                                                              | 0                          | **0**: the trigger refuses UPDATE and DELETE (A4), and the canonical form and HMAC hold over 200 seeds                                                                                                                                                          |
| CFC concept projections passing (v1 + v1.1)                   | —                                                                                              | all                        | **all 204** (round-trip test)                                                                                                                                                                                                                                   |
| Unit-library known-pair tests                                 | —                                                                                              | ≥ 30                       | **38** (103 unit tests in all)                                                                                                                                                                                                                                  |
| RLS probes passed                                             | —                                                                                              | 100%                       | **100%**: 2,400 probes, 0 mismatches (26 new objects and 8 evolved tables), plus the 0074 prescription probe. PGlite only; re-run on the dev project (runbook §3)                                                                                               |
| Candidate codes exported                                      | —                                                                                              | 0                          | **0** (the FHIR test covers every v1 + v1.1 concept)                                                                                                                                                                                                            |
| ICD-10 content shipped without a recorded licence             | 0041 ICD-10 committed with no notice (R9)                                                      | 0                          | **0**: recorded as "licence pending" in `THIRD-PARTY-NOTICES.md`, used by no surface, never exported; `icd10_who_code` is null on all 85 terms (O-3)                                                                                                            |
| Standard visit (reference 2.12): taps, keystrokes, seconds    | not measured (needs a build)                                                                   | Section 4 budgets          | **Taps and keystrokes meet §4 in tests**: triage prefill 0 taps, a diagnosis from the top 50 in ≤ 4 keystrokes + Enter (all 50), a favourite test in ≤ 2 taps, signing 1 tap + confirm. **Seconds not measured**: needs a timed walk-through on the dev project |
| Diagnosis search p95                                          | —                                                                                              | < 150 ms                   | **0.22 ms** ranking in-process (340 prefix queries over 85 terms, Node on the M1; client-side ranking, render not included)                                                                                                                                     |
| Chart TTFB p95                                                | not measured                                                                                   | < 400 ms                   | **Not measured, needs the dev project (O-1).** Proxy: the fact loader on PGlite (WASM, in-process) at 2,000 facts is p50 83.9 ms and p95 **97.1 ms**, against a 60 ms Postgres budget; payload 1,415 KiB against 1 MB (open since STOP 3)                       |
| JavaScript added to the clerking route                        | not measured                                                                                   | ≤ 90 KB gz                 | **+89.7 KB gz** at STOP 5–6 (measured). Not re-measured after P7 (prescriptions panel) or the `next/dynamic` split, because a build was not allowed. The owner runs one `next build` (runbook §7)                                                               |
| axe serious or critical                                       | not measured                                                                                   | 0                          | **0**: 39 screens, jsdom and browser runs (156 with CSS). The P7 prescribing views have had no axe run yet                                                                                                                                                      |
| Red-scarcity tests                                            | —                                                                                              | green                      | **green** (`tests/design/red-reserved.test.ts` and the EMR view tests)                                                                                                                                                                                          |
| Keystrokes lost in the 30-second offline drill                | —                                                                                              | 0                          | **0** (A8, with a reply dropped mid-flight)                                                                                                                                                                                                                     |
| Scenarios A1–A9                                               | —                                                                                              | all pass                   | **11/11 tests green** (A1–A9 plus A2b). **A5 is partial**: the resus close-out has no structured action list to turn into proposed orders                                                                                                                       |

### Final checks (this worktree, uncommitted fixes applied)

| Check                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PGlite harness                                                         | 75 migrations applied (0000–0074)                                                                                                                                                                                                                                                                                                                                                                                |
| `EMR_PGLITE=1` over tests/emr, emr-db, workspace, functions and design | **60 files, 3,354 passed, 0 failed** (emr-db 306/306)                                                                                                                                                                                                                                                                                                                                                            |
| Full suite (`npx vitest run`, dead-DB env)                             | **239 files passed, 38 skipped; 6,199 passed, 539 skipped, 0 failed.** Every skipped file is gated on the environment: 18 emr-db and `workspace/emr-lanes` (PGlite lane, green above); 12 `rls` files, 3 hospital-admin, 1 scheduling, audit and auth-flow (need a live database); `a11y/static-pages` (needs a build)                                                                                           |
| App `tsc --noEmit` (fresh `.next/types`)                               | 0 errors                                                                                                                                                                                                                                                                                                                                                                                                         |
| `typecheck:functions`                                                  | 0 errors                                                                                                                                                                                                                                                                                                                                                                                                         |
| ESLint                                                                 | 0 errors, 2 warnings (`scripts/embed-bench.mjs` console, bench commit aae1c08, not EMR)                                                                                                                                                                                                                                                                                                                          |
| Prettier, files changed since 004772d                                  | Clean after `--write`, except these, which were left unformatted on purpose: the five signed specs stay byte-identical (`PROMPT-ENCOUNTER-EMR.md`, `SPEC-CLINICAL-FACT-CONTRACT-v1.md`, `SPEC-NCD-ENGINE-DIABETES-PACK-v1.md`, `emr-clinical-reference.md`, `clinical-fact-concepts.v1.json`), and the `.sql` migrations have no Prettier parser. They are now in `.prettierignore`, so they stay byte-identical |

### Open, recorded for the owner and CSO

- ~~Returned co-sign~~ **closed after this report**:
  - `reviewCosignRequestAction` is now hospital-scoped and pending-only. Before, any senior could review any request
    id, and a request could be reviewed twice.
  - An EMR prescription returned by the senior is cancelled, and its medication statement stopped (a new version,
    reason `cosign_returned`), in the same transaction as the decision (`withdrawReturnedPrescription`).
  - Tested on the lane, replay included.
- ~~Co-sign, addendum and entered-in-error keys~~ **closed**: they reuse one key per intent (`createIntentKeys`), so a
  lost reply can no longer write a second addendum.
- Drafts saved before the `pulled` fix copy their pre-filled NCD readings when signed. EMR v1 is off, so no such
  drafts exist in production.
- A save with a note id and no revision is now refused unless its own key made the draft or the content is identical.
  The desk always sends both.
- **Behaviour change:** a patient-facing entered-in-error note now reads "Entered in error" without its reason
  (before, the reason reached the patient). CSO confirms.
- Prescribing with the allergy status unknown records nothing server-side, and the sheet cannot record allergies
  itself. CSO policy decision.
- A voided NKDA or unable-to-assess assertion appears in no section history.
- ~~Resolved-problem strikethrough~~ **closed**: the resolved problem shows the word, not a strike.
- The co-sign queue page has no rendering test; `prescriptionsForCosign` is tested on PGlite.

### After STOP 7–8: re-shoot, build and axe on the final code (2026-09-26)

- **Production build of the branch** (the scratch harness copy: repo code + the fixture route): `next build` succeeds.
- **Screenshots:** all **240** re-shot on the final code (40 screens, now including the Phase 7 prescriptions view, × 3
  viewports × light/dark). 0 horizontal overflow, 0 console errors.
- **axe on the Phase 7 prescribing view and the changed desk and chart screens:** jsdom 0 serious / 0 critical; in the
  browser (12 runs) 0 serious / 0 critical. The 4 moderate findings are harness-page headings.
- **Clerking-route client JS, from the route's client-reference manifest:** entry chunks 317.4 KB gz, against 215.5 KB
  before the EMR (+101.9 KB, including the Phase 7 prescribing panel) and 305.2 KB at STOP 5–6.
  - The manifest lists every client module the route _can_ reach, with the flag on or off.
  - The desk now loads through `next/dynamic`, and `tests/emr/ui/flag-off.test.ts` proves the flag-off page never
    statically imports it.
  - What a flag-off visit actually downloads needs one real signed-in render (runbook §7).
  - **Treat the 90 KB budget as not yet met** until that render says otherwise.

### Owner-support round (2026-09-26)

Five pieces of build work from the runbook's open list, plus the checks below. Nothing committed. No new dependency,
no new env var; `.env.example` untouched; no clinical numbers.

**Built:**

- **Owner scripts** (`scripts/emr/`, shared `_cli.ts`). All dry-run by default, `--apply --actor <auth user uuid>` to
  write, idempotent, audited under the actor, host printed first:
  - `npm run emr:legacy-counts`: the §4 O-4 SQL verbatim, plus the post-0071 block when `public.allergies` exists.
  - `npm run emr:backfill-allergies`: replays 0071 §15 for AMPLE captures made while the flag was off.
  - `npm run emr:reencrypt-drafts`: plaintext `clerkship_drafts` → `{enc}` (O-5).
  - `npm run emr:encrypt-allergy-text`: next version with `substance_text_ciphertext` for backfilled allergies (O-5).
- **Hosted RLS twin**: `tests/rls/emr-access.test.ts`, a subset of the 2,400-probe matrix over supabase-js and the
  reader role. Skips without `MEDSYNC_ALLOW_RLS_DB_WRITES=1`; never yet run against a real project.
- **0075 co-sign policy defaults** (GATED): `private.seed_cosign_policy_defaults`, a backfill for hospitals with no
  policy row, and an AFTER INSERT trigger on `hospitals`. Replaces the §8 "seed policies first" step.
- **Nurse orders panel**: collect specimen and print label on `/nurse/patients/[patientId]`, behind `EMR_V1`.
- **Resus handover → proposed orders**: an optional "Outstanding tests" picker on the close-out; the handoff turns each
  into a proposed order that the desk Plan accepts or dismisses. **Scenario A5 is now full (11/11).**

**Numbers:**

| Check                                                                        | Result                                                                                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| PGlite harness (`node run.mjs`)                                              | **76 migrations**, last = 0075                                                                                                         |
| Hub interleave (`node both-orders.mjs`)                                      | name order ok; production order (0000–0070, 0080, then 0071–0075) ok                                                                   |
| `EMR_PGLITE=1` over emr, emr-db, workspace, functions, design, resus and rls | **141 files passed, 13 skipped (all `tests/rls`, env-gated); 4,789 passed, 147 skipped, 0 failed.** emr-db alone: 20 files, 327 passed |
| Full suite (dead-DB env, no PGlite)                                          | **242 files passed, 40 skipped; 6,227 passed, 560 skipped, 0 failed**                                                                  |
| App `tsc --noEmit` (fresh `.next/types`) / `typecheck:functions`             | 0 errors / 0 errors                                                                                                                    |
| ESLint                                                                       | 0 errors, the same 2 warnings (`scripts/embed-bench.mjs`, not EMR)                                                                     |
| Prettier over every changed and new file                                     | clean                                                                                                                                  |

Not run: `next build`, a browser/axe pass on the close-out picker and the nurse panel.

**Still the owner's:**

- Apply 0075 (and 0071–0074) with `npm run db:migrate`; the before/after hospital count is in runbook §5.
- Run the scripts in the runbook order: §4 counts, §8 backfill, §9 drafts then allergy text. Dry run first each time,
  check the printed host, then `--apply --actor <uuid>`.
- Run the hosted twin on the dev project once it exists (§3); its fixture SQL is unverified until then.
- Measure `/nurse/patients/[patientId]` with the clerking route in the §7 JS check (the panel is a static import).
- Clinical calls: results routing for accepted resus proposals (authored by the leader, so review follows the leader);
  proposal priority fixed at routine; no typed dismissal reason; a test dropped from the menu before handoff is left
  out silently.
- Small code follow-ups for whoever owns the files: `lib/emr/read/orders.ts` logs the nurse panel read under
  `emr_orders_doctor` (fix: `emr_orders_${actor.surface}`); the Drizzle copy of `cosign_policy_action_check` still lists
  0030's five kinds (pinned in drizzle-parity); `tests/emr-db/write-prescriptions.test.ts` fixture was changed to
  upsert policies because of 0075's trigger; `HARMONISATION.md` still lists the EMR migrations as 0071–0073.
