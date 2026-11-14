# EMR build — harmonisation and build brief

> **What this is.** The path that makes the five specs (PROMPT-ENCOUNTER-EMR, MS-DATA-CFC-001, MS-EMR-CLIN-001,
> MS-NCD-ENG-001, `clinical-fact-concepts.v1.json`) work with the MedSync that exists. The specs say "the repo wins";
> this document records every place it did and how the pieces now connect. **Every build agent follows this file.**
> Evidence for each claim: `docs/emr/discovery/*.md` (Phase 0).
>
> **Sign-off.** On 2026-09-26 the owner and CSO (Fadhul) signed every GATE A decision in the five specs as recommended
> (E1–E10, D-EMR-01–16, D-CFC-01–15, D-NCD-01–17), in session. The harmonisations below apply those decisions to
> this repo. Where one changes a signed decision's _mechanism_, not its intent, it is marked **[H]**, and the ADR
> records it.

## 1. Ground rules for every build agent

- **Repo:** `/Users/airm1/Desktop/medsync-emr` (branch `feat/emr-engine`). Drizzle + hand-written SQL migrations,
  npm, Vitest, server actions. There is no Prisma, pnpm, `prisma dev` or new Edge Function.
- **Naming:** use the repo's names. `hospital_id`, not `tenant_id`. `patient_user_id`, not `patient_id`. Text + CHECK,
  not pg enums. A CHECK change is DROP-then-ADD (see 0069).
- **Migrations:** `0071_emr_record_spine.sql` (schema), `0072_emr_reference_seed.sql` (generated seeds),
  `0073_emr_realtime.sql` (broadcast triggers), `0074_emr_prescriptions.sql` (OPD prescriptions) and `0075_cosign_policy_defaults.sql` (co-sign defaults for every hospital). All five carry the GATED header like 0069: the owner applies them
  with `npm run db:migrate`. **Never edit 0000–0070.** Verify every migration with the PGlite harness:
  `cd ~/Desktop/medsync/.emr-harness/pg && node run.mjs`, which replays everything.
- **Machine:** 8 GB RAM. Do not run `npm run build`, full `npm run typecheck` or the full `npm run test` unless your
  brief says so. Run `npx vitest run <your test files>`. `npx tsc --noEmit -p tsconfig.json` is allowed only in a
  stage whose brief allows it.
- **No new dependencies.** PGlite is used from the harness (`~/Desktop/medsync/.emr-harness/pg/node_modules`) and never added to
  `package.json`.
- **No clinical numbers.** Critical limits, plausibility bounds, HMIS, IDSR, REF-PREG-AGE and the fasting definition
  are `RefEntry` files (the resus pattern, `lib/resus/reference/ref.ts`) with `status: 'pending_cso'` and the value
  withheld. The mechanism ships and shows no number. The only numbers allowed are signed ones: unit conversions
  (CFC §5), unit-mismatch triggers (CFC §6, D-CFC-14 signed) and engineering budgets.
- **Do not touch** `.env.example` (owner rule). New env vars are documented in the ADRs and owner-actions list.
- **Code style:** match the surrounding code. Comments explain _why_. Ponytail: evolve over add, fewest files, no
  speculative abstraction, and one runnable test per non-trivial branch.

## 2. What the specs assumed vs what exists (the harmonised answer)

| Spec assumption                                                 | Repo reality (Phase 0)                                                                                                                                                                                                         | Harmonised decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma, `prisma dev`, pnpm, Node 22 (R7, Law 11–12)             | Drizzle + hosted Supabase, npm, `.nvmrc` 24                                                                                                                                                                                    | Keep the repo stack. R7 is refuted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E1: hosted Supabase dev project                                 | Only a hosted prod-like DB; RLS suites skip without env                                                                                                                                                                        | **[H]** The owner creates the dev project (owner action O-1). Meanwhile a **PGlite lane** runs: `tests/emr-db/**` runs only with `EMR_PGLITE=1` (PGlite is symlinked into the local `node_modules` from the harness and imported dynamically), and it boots the Supabase bootstrap from the harness.                                                                                                                                                                                                                                         |
| E2: `set_config` identity, FORCE RLS, non-owner reads           | Owner-role Drizzle bypasses RLS; access is resolved in TS by 4 divergent resolvers                                                                                                                                             | **[H]** E2 is adopted for the EMR. `private.current_user_id()`, one SQL access rule `private.patient_access_basis()` and `private.accessible_patient_ids()`, role `medsync_clinical_reader`. `lib/emr/db.ts` provides `asClinicalReader` (tx + `set_config` + `SET LOCAL ROLE`) and `asClinicalWriter` (tx + `set_config`, owner role, after the same access check). Legacy surfaces keep their resolvers; §7 is the convergence path.                                                                                                       |
| One patient-access rule                                         | 4 rules; none checks the hospital; nurse "assigned" missing from the record panel                                                                                                                                              | The SQL rule is the one rule, hospital-scoped. Bases, strongest first: `active_encounter`, `assigned` (nursing), `open_intake` (patient present at this hospital today, clinical staff), `department_recent` (30 d), `care_team` (seam, false), `break_glass`. Reception (`is_clinical=false`) never matches.                                                                                                                                                                                                                                |
| Patient role denied until Gate CG                               | 0040 policies let a patient read their own rows                                                                                                                                                                                | New tables deny the patient role. 0040 is immutable; its policies stay and are recorded as a known gap.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E3: evolve `clinical_observations` into the CFC shape           | Mutable table; resus v2 `retractMirror` UPDATEs in place; Drizzle drifted (etco2, urine_output); triage never writes it                                                                                                        | **[H]** Add the CFC columns (nullable for legacy rows). A guard trigger makes CFC rows (`concept_id IS NOT NULL`) immutable and allows legacy rows only the legacy `active→corrected` move, so resus keeps working. **No backfill mutation**: legacy rows and triage `vitals_snapshot` are _projected_ into facts by the loader (CFC §10 item 9, "or projected into"). Fix the Drizzle CHECK drift. View `clinical_observations_current`.                                                                                                    |
| E4: plaintext structured values, encrypted narrative            | `clinical_documentation.section_data` and `clerkship_drafts.payload` are plaintext                                                                                                                                             | New narrative is encrypted with `lib/encryption.ts`. NCD drafts are written as `{ "enc": "<ciphertext>" }` from now on and read both shapes. Re-encrypting old drafts is owner action O-5 (script). `clinical_documentation` is append-only, so it stays legacy and is recorded.                                                                                                                                                                                                                                                             |
| E10: a dedicated HMAC key                                       | Only `blindIndex` (derived from the PHI key)                                                                                                                                                                                   | New env var `MEDSYNC_NOTE_HMAC_KEY` (O-2). Signing refuses with a clear message if it is missing.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| R1: allergies live in resus AMPLE                               | Worse: resus allergies are invisible even to the next resus episode; `patient_allergies` has no live writer; resus prescribe checks only on the client                                                                         | New `allergies` + `allergy_status_assertions`. 0071 copies `patient_allergies` (source `record`) and resus timeline allergy captures (source `resus_ample_migration`) with provenance, and changes neither. Prescribing reads `lib/emr/allergy.ts`. The AMPLE editor writes through `recordAllergy`, with its look unchanged. The server re-runs the allergy check on emergency administration.                                                                                                                                              |
| Uncoded allergens are "not checked by prescribing"              | The prescribing engine matches free text by name                                                                                                                                                                               | **[H, safety-positive]** Uncoded text is still passed to the existing name matcher (dropping it would weaken today's check). The label reads "Matched by name only — code it for class checks". Coded substances use the prescribing formulary's own keys and classes, so there is one vocabulary.                                                                                                                                                                                                                                           |
| R2: encounters are thin                                         | `disposition` (0040) exists; nothing writes it; end visit is Edge `ha-complete-encounter`; `ha-start-encounter` can open a second encounter                                                                                    | Evolve `encounters` (§3). `ha-complete-encounter` accepts disposition and follow-up, so there is one completion path. `ha-start-encounter` reuses an open encounter for the visit (dedupe fix). A died disposition is stored as the existing `deceased`, because ADR 0115 reads it and adds no death column.                                                                                                                                                                                                                                 |
| R3: no results model                                            | `encounter_orders`/`encounter_results` + lab enter/release exist (0050/51, `LAB_RESULTS_LIVE`); no acknowledgement; release not transactional; abnormal = critical flag                                                        | Evolve `encounter_orders` (orders). Add `encounter_order_events`, `specimens`, `specimen_events`, versioned `diagnostic_reports` (result values are observation rows with `report_id`), `result_acknowledgements` and `critical_result_communications`. The `/lab` actions are re-pointed under `EMR_V1`: enter = preliminary report, release = final version, both transactional. Legacy `encounter_results` rows are projected read-only. The lab's own flag is shown as text; MedSync critical only comes from signed entries (none yet). |
| R4: pending intents have nowhere to go                          | `pending_encounter_handoff` is a boolean nobody reads; triage recommendations are recomputed at render and never stored; the resus handover is SBAR (4 fields); the resus encounter is created before the commit (orphan risk) | `consumeResusHandoff`: one tx creates or links the encounter and writes an ISBAR handover note (Identify from the record plus SBAR), then clears the flag. It runs after the resus commit. Triage suggestions render in Plan from `lib/triage/recommend.ts`; accept → `placeOrders` with `intent_source='triage_recommendation'`; dismiss → an `encounter_events` row.                                                                                                                                                                       |
| R6: no problem list or coded diagnosis                          | `problem_list` and `encounter_diagnoses` exist, mutable, with no live writer                                                                                                                                                   | New insert-only, versioned `conditions` (category `problem_list_item` / `encounter_diagnosis`; family history through `subject_relation`). Legacy rows are projected read-only, so the UI shows one list.                                                                                                                                                                                                                                                                                                                                    |
| R9: ICD-10 unlicensed                                           | Already committed (0041, `lib/encounter/reference-codes.ts`), used by no surface; no `THIRD-PARTY-NOTICES.md`                                                                                                                  | Add `THIRD-PARTY-NOTICES.md`: ICD-11 (CC BY-ND 3.0 IGO) attribution, LOINC notice, and ICD-10 recorded as "licence pending — present, unused by every surface, never exported" (O-3, apply for the WHO licence). `diagnosis_terms.icd10_who_code` stays null.                                                                                                                                                                                                                                                                                |
| Shared finding-token catalogue owned by the differential engine | That engine was removed (ADR 0081). The clinician `symptom_catalog` (0042/43/45; fever, headache, rigors, rash, vomiting, ROS screens) survives, separate from the patient-facing `patient_symptom_catalog_items`              | **[H]** Finding tokens = `symptom_catalog` (symptoms) ∪ `clinical_concepts` of kind `finding` (CFC sx/sign/hist plus the signed template 2.1 [11] general-exam signs and the standard-visit signs). `clinical_concepts.symptom_code` maps overlaps, so a token has one identity. The patient booking list is untouched.                                                                                                                                                                                                                      |
| Lane-source registry (§5.11)                                    | None: a lane is a `LaneId` + `LANES` entry + a hand-written FW-2 branch + a loader                                                                                                                                             | Add three lanes that way (E8): `critical_results` after Resus, `results_to_review` after In progress, `to_cosign` after it. Update the flow tests and the property test.                                                                                                                                                                                                                                                                                                                                                                     |
| Note co-sign                                                    | `clinical_cosign_requests` co-signs actions; note co-sign has no writer                                                                                                                                                        | Reuse it: add action kind `sign_note` + `note_id`. Pending note co-signs appear in the existing `/doctor/cosign-queue` and the To co-sign lane. The requirement comes from `clerkshipWriteAuthority().mustCosign` (one function, D-EMR-03).                                                                                                                                                                                                                                                                                                  |
| `last_activity_at`                                              | Derived; NCD autosave touches nothing, so active clerking looks idle                                                                                                                                                           | Add the column; note autosave and every fact write stamp it. The Workspace reads `max(updated_at, latest doc, last_activity_at)`.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Signed-reference store                                          | 4 file shapes                                                                                                                                                                                                                  | EMR references use the resus `RefEntry` shape in `lib/emr/reference/*.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Playwright + axe gates                                          | Playwright absent; axe-core present (jsdom)                                                                                                                                                                                    | **[H]** Scenarios A1–A9 run as PGlite-lane integration tests over the real server-side write functions. UI checks: axe-core over server-rendered fixture pages (the doctor-workspace harness method) plus CDP screenshots from the scratch harness. Playwright stays flagged, not added (O-6).                                                                                                                                                                                                                                               |
| Print, PDF                                                      | No print CSS anywhere                                                                                                                                                                                                          | Print CSS only (E9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Pharmacy Board of Uganda                                        | —                                                                                                                                                                                                                              | Use that name wherever copy mentions the regulator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## 3. Data model (0071, additive)

**Evolved:** `encounters` gains `visit_id` (→ `patient_intakes`, SET NULL), `template_id`, `last_activity_at`,
`completed_by`, `disposition_detail` jsonb, `follow_up` jsonb, `attendance_type` (`new|re_attendance|unknown`, default
`unknown`), `referral_in` jsonb, `closure_kind` (`clinical|administrative`) and `closure_reason`.

- `encounter_type` CHECK widens with `antenatal, procedure, virtual, community`; `tele` and `follow_up` stay. The prompt's
  "class" is this column.
- `disposition` CHECK widens with `home, admitted, referred_out, transferred, left_before_completion,
left_against_advice`. "Died" is stored as `deceased`. The legacy values stay.
- `state` CHECK gains `entered_in_error`.

`clinical_observations`: CFC §3.2 columns plus `report_id`, `order_id`, `entry_mode`, `logical_id`, `version` and
`supersedes_id`, with the guard trigger and the `_current` view; the kind CHECK gains `fact`, and the Drizzle drift is
fixed. `encounter_orders`: `lifecycle` (`legacy|events`), `hospital_id`, `test_id`, `priority`,
`reason_condition_ids`, `reason_text_ciphertext`, `fasting_required`, `requester_cadre`, `performer`, `intent_source`,
`source_intent_id`, `requisition_no`, `sensitivity`, `client_key` and `effective_at`; `events` rows are immutable.
`clinical_cosign_requests`: `sign_note` kind + `note_id`, and the Drizzle CHECK drift is fixed.

**New (all insert-only unless stated; RLS enabled and FORCED; SELECT via `private.accessible_patient_ids()` plus
hospital; no client write policies; `audit_log_changes()` attached; idempotent `client_key` unique per table; shared
columns `logical_id, version, supersedes_id, hospital_id, patient_user_id, effective_at, recorded_at, recorded_by,
author_cadre, source, trust, status, sensitivity`):**

- `clinical_notes`: updatable only while `state='draft'`. Signing is the last mutation.
- `clinical_note_events`: cosign_requested, cosigned, addendum_added, entered_in_error.
- `conditions`, `medication_statements`, `pregnancy_episodes`, `procedures`.
- `allergies` and `allergy_status_assertions` (prompt §7.5).
- `encounter_order_events`, `specimens`, `specimen_events`, `diagnostic_reports`, `result_acknowledgements`,
  `critical_result_communications`.
- Registries, which are config (mutable and audited): `clinical_concepts`, `drug_class_tags`, `capabilities`,
  `facility_capabilities`, `devices`, `test_catalogue` (`hospital_id` null = default menu) and `diagnosis_terms`.
- Views: `clinical_notes_current`, `conditions_current`, `medication_statements_current`, `allergies_current`.
- `private` schema: `current_user_id()`, `current_hospital_id()`, `patient_access_basis(user, patient, hospital)`,
  `accessible_patient_ids()`, `block_mutation()`. Role `medsync_clinical_reader` (NOLOGIN, granted to the migrating
  owner; SELECT on EMR tables and views).
- Backfill (insert-only copies; the sources are never altered): `patient_allergies` → `allergies`, and resus
  timeline allergy captures → `allergies` plus NKDA assertions.

## 4. Module map (who owns which file)

| Area               | Files                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Units              | `lib/units/{index,conversions,prompts}.ts`                                                                                                                                                                                                                                                                                                         |
| Facts              | `lib/facts/{types,schemas,catalogue.generated,refinements,loader,hash}.ts`, `lib/facts/project/*.ts` (incl. legacy + triage projections)                                                                                                                                                                                                           |
| EMR engines (pure) | `lib/emr/{encounter,notes,carry-forward,allergy,orders,results,hmis,chart,fhir}.ts`                                                                                                                                                                                                                                                                |
| EMR infra          | `lib/emr/{feature,db,access,audit}.ts`, `lib/emr/reference/*.ts` (RefEntry, pending_cso)                                                                                                                                                                                                                                                           |
| Write paths        | `lib/emr/write/*.ts` (tx functions taking `(tx, input, actor)`, tested on PGlite) and `app/(emr)/actions/*.ts` or the route's `actions.ts` (thin `'use server'` wrappers: Zod, scope, AAL2, then the write function)                                                                                                                               |
| Sync               | `lib/emr/sync/*` (write queue + server clock, modelled on resus `desk-queue-model.ts`; extract, don't fork, if resus tests stay green)                                                                                                                                                                                                             |
| UI                 | `components/emr/**` (pure `*View` components take precomputed payloads, so the fixture harness can render them); routes `app/doctor/patients/[patientId]` (chart), `app/nurse/patients/[patientId]`, `app/doctor/encounters/[encounterId]` (clerking desk under `EMR_V1`), `app/lab/**` (results under `EMR_V1`), print routes under the encounter |
| Schema             | `db/schema/emr.ts` (new tables) + minimal edits to existing schema files; barrel `db/schema/index.ts`                                                                                                                                                                                                                                              |
| Seeds              | `scripts/emr/gen-seed.ts` → `supabase/migrations/0072_emr_reference_seed.sql`; data in `data/emr/*.json`                                                                                                                                                                                                                                           |
| Tests              | `tests/emr/**` (pure, always run) and `tests/emr-db/**` (PGlite lane: migrations, RLS probes, write paths, A1–A9)                                                                                                                                                                                                                                  |

**Flags:** `EMR_V1` → `emrV1Live()` in `lib/emr/feature.ts`. It needs `ENCOUNTER_ENGINE_LIVE` and accepts `1` or
hospital ids, like `DOCTOR_WORKSPACE`. `EMR_PRESCRIBING` → `emrPrescribingLive()` (Phase 7). With the flags off, every
existing page behaves as before.

## 5. How the pieces now connect (the flow)

1. **Arrival → triage → encounter.** An intake (the visit) goes to triage (`triage_records`, vitals snapshot), then to
   Take & start or Assign, which gives a planned or in-progress encounter with `visit_id` and `triage_record_id`.
   `ha-start-encounter` reuses an open encounter. The clerking desk pre-fills from the triage record through
   carry-forward. Vitals are **projected, never copied**.
2. **Clerking.** A per-author draft `clinical_notes` row autosaves (encrypted content) and stamps
   `last_activity_at`. Chart actions (vitals, allergies, problems, diagnoses, orders, medicines, pregnancy,
   procedures) commit at once as fact rows. Note-born findings commit at signing, in the same tx (D-EMR-01).
3. **NCD module.** On a diabetes-relevant encounter, the NCD capture (ADR 0082/0083) is a section of the note. At
   signing its values commit as facts through `lib/ncd/cfc-map.ts` (the NCD feature ↔ CFC concept overlap), so the
   NCD work finally reaches the record. The same map pre-fills NCD capture from facts recorded anywhere, not only
   triage. The future NCD engine (MS-NCD-ENG-001) reads `loadFactSnapshot(manifest)`; nothing of it is built here.
4. **Orders → results → acknowledgement.** An order (events lifecycle) goes to specimen collection (fasting chip,
   two identifiers, label), then `/lab` enters a preliminary report and releases a final one. The result values are
   observation rows. "Results to review" follows for the orderer or their cover, then acknowledgement. Critical results
   (signed definitions only) add the communication record and the Critical results lane.
5. **Prescribing.** Every prescribe path reads the allergy record (`lib/emr/allergy.ts` → the existing
   `runSafetyChecks`). Phase 7 adds prescriptions from the encounter under `EMR_PRESCRIBING`.
6. **Resus → encounter.** Close-out commits first, then `consumeResusHandoff` writes the ISBAR note and clears the
   flag. AMPLE writes through `recordAllergy`.
7. **Completion.** A disposition is required, and warnings are returned, not thrown. It goes through the one path
   `ha-complete-encounter`. Printouts: visit summary, referral (HMIS 032 fields), lab request. Administrative closure
   needs a reason; nothing auto-closes.
8. **Workspace.** New lanes. Realtime: PHI-free `chart:<patient>` broadcasts (0073), receive-RLS on access, a 15 s poll
   fallback.

## 6. Phases and gates (this build)

P0 discovery ✔ → P1 GATE A proposal (docs + data files) → P2 data layer → P3 engines → P4 write paths + handoffs +
lanes + A1–A9 → P5 chart + clerking UI → P6 orders/results UI → P7 prescribing → P8 hardening + ADRs + final report.
Each STOP is recorded in `docs/emr/STOP-REPORTS.md` with real numbers. Owner sign-off was given up front, so every
gate proceeds on green checks.

## 7. Convergence path (after this build, not in it)

- Point the doctor, nurse and encounter TS resolvers at `private.patient_access_basis` (one rule everywhere), then retire
  `has_clinical_relationship`.
- Retire the legacy EMR tables once the owner has counted their rows (O-4). Their projections keep old data readable
  until then.
- NCD engine Gate 2 dossier, then Gate 3 (MS-NCD-ENG-001), reading facts.
- Monitoring engine: writes CFC observation rows and `telemetry_series`.

## 8. Owner actions (collected; the final report repeats them)

- O-1: create the hosted Supabase dev project (E1) and apply 0000–0073 there.
- O-2: set `MEDSYNC_NOTE_HMAC_KEY` in Vercel (32 random bytes, base64).
- O-3: apply for the WHO ICD-10 commercial licence.
- O-4: count the legacy rows (queries in the final report).
- O-5: re-encrypt the old plaintext NCD drafts (script provided, dry-run first).
- O-6: decide on Playwright.
- O-7: apply 0071–0075 in prod (`npm run db:migrate`), deploy the two changed Edge Functions, then set `EMR_V1`.

## 9. Merge rule with the Departments & services hub (feat/hospital-services-hub, owner-signed)

Agreed with that session on 2026-09-26. The hub uses migration 0080 and ADRs 0150–0160; the EMR uses 0071–0075 and
0130–0139.

- **Test menu:** `test_catalogue` owns the _orderable definition_ (components as concept ids, specimen, container,
  fasting). The hub's `diagnostic_offerings` owns per-facility _where, hours, stated TAT and referred_to_. The EMR seeds
  only the default menu (`hospital_id` NULL) and writes no per-hospital rows. At merge, reconcile by code through a
  nullable offering code on `test_catalogue`.
- **Availability:** the EMR reads it only through `lib/emr/capability.ts` `getCapabilityStatus(hospitalId,
capabilityId)`. Today that reads `facility_capabilities`; at merge it reads the hub's `getOrderingAvailability`
  projection, which informs and never blocks. There is one store (the hub's); `facility_capabilities` gets no new
  writer.
- **Capabilities:** the `cap.*` ids map onto the hub's `capability_values` keys through one mapping table at merge.
- **Migration coexistence (verified 2026-09-26):**
  - The EMR's 0071–0075 and the hub's 0080 share no table CHECK they redefine.
  - Both apply cleanly in PGlite, in name order and in production order (0080 first, then 0071–0075).
  - `scripts/migrate.ts` applies any unrecorded file by name, so a late 0071 still runs.
- **`sa_audit_log_action_check` rule:** if an EMR migration ever redefines it, the list must be the current
  `SaAuditAction` union (`supabase/functions/_shared/sa-audit.ts`), hub verbs included. Otherwise every hub operation's
  audit row would start failing. No EMR migration touches it today.
