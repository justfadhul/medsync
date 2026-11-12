# Prescribing protocols — P1 handoff (F1–F3, the one Prescribe)

Branch `feat/prescribing-protocols`, worktree `~/Desktop/medsync-rx`. Built dark behind **`PRESCRIBE_V2`**
(`1` or hospital ids; needs `EMR_V1` + `EMR_PRESCRIBING`; off in production while `PRESCRIBE_COPY` is draft).
Flag off, every page and every check reads exactly as before.

## Owner to do

1. Apply the migration: `cd /Users/airm1/Desktop/medsync-rx && npm run db:migrate` — **0279** (GATED):
   `prescriptions.prescribe_place`, `prescriptions.product_id`, table `prescription_drafts` (RLS forced, no client access).
2. Sign the draft copy: `content/prescribing.ts` (`PRESCRIBE_COPY`), the order sets list
   (`lib/prescribing/order-sets.ts`, `ORDER_SETS_STATUS`), and `RX_CHECKS.prescriberSaid` in
   `content/pharmacy-rework-daily.ts` (now "Prescriber saw it and answered: …").
3. Set `PRESCRIBE_V2` for a test hospital.

## Where each P1 feature landed

| Feature                                    | Where                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| One dialog, opened from six places         | `components/clerking/plan/prescribe-dialog.tsx` (editor) + `prescribe-session.tsx` (`PrescribeButton`, session dialog) |
| — clinic visit / ward round                | `components/emr/prescribing/encounter-prescriptions.tsx` (`placeOfEncounter`)                                          |
| — clerking plan                            | `components/clerking/plan/plan-step.tsx` (`envOfPlan`, own basket/draft as before)                                     |
| — resus                                    | `app/nurse/resus/[episodeId]/page.tsx` (prescribing cadres only)                                                       |
| — NCD clinic                               | `app/ncd/visit/[visitId]/page.tsx` (finds the open visit)                                                              |
| — going home                               | `lib/emr/read/close.ts`, `components/emr/desk/close-visit.tsx`                                                         |
| Collect point per place                    | `lib/prescribing/places.ts` (`PLACE`), stock via `stockLinesFor(…, origin)`                                            |
| Patient facts strip (sex, eGFR, pregnancy) | `components/clerking/plan/medicines.tsx` (`FactChips`)                                                                 |
| Search, groups, keyboard pick              | `prescribe-dialog.tsx` over `formularyBrowse()`                                                                        |
| Order sets                                 | `lib/prescribing/order-sets.ts`, applied in `prescribe-session.tsx`                                                    |
| Brand choice                               | `brandsFor` in `lib/emr/read/prescribe.ts` (`pharmacy_products`), star per viewer in localStorage                      |
| Regimen dosing, bands, mg/kg               | existing `resolveRegimens`; "Changed from the regimen" + "Use the regimen" in the dialog                               |
| Supply quantity                            | `lib/prescribing/supply.ts`, recomputed on the server in `prescribeFromPlan`                                           |
| Checks                                     | `lib/prescribing/plan-checks.ts`: cross-reactivity, eGFR CKD-EPI 2021 (`egfrOf`), pregnancy, limits (v2 only)          |
| Basket, draft, review, Sign and send       | `prescribe-session.tsx`; server `sendPrescribed` / `keepPrescribeDraft` in `lib/emr/write/plan.ts`                     |
| Already prescribed, again, stop            | `loadPrescribeSession` + `stopPrescribedLine` (`lib/emr/actions/prescribe.ts`)                                         |
| Server gates                               | `lib/emr/actions/prescribe.ts`: cadre, flag, every check re-run from the record in `placePlan`                         |

## Defaults taken

- No amoxicillin regimen is signed, so production shows **no dose** for it. Weight bands and mg/kg are proven
  with a TEST FIXTURE regimen in `tests/prescribing/prescribe-v2.test.ts`.
- Kidney: eGFR G1–G2 passes, G3a and below is a Check (KDIGO bands). No per-drug renal advice (none signed).
- Pregnancy: asked for women 12–55; pregnancy advice shows only when the dose is CSO-signed.
- Limits: Stop above a signed regimen's own `perKg.max`; otherwise "not checked".
- The prototype's interaction pairs, LIMITS and ALT alternatives were **not ported** (unsigned clinical data).
  Interactions use the existing signed pairs; alternatives are the existing "elsewhere" stock points.
- Order sets hold drug ids only (no doses); each line opens the editor. Hidden in production while draft.
- Stop reason is stored as `reasonCode: "other"` with the typed reason.
- Kept, not deleted: `prescribe()` in `lib/emr/write/prescriptions.ts` and `lib/prescribing/engine.ts` still
  serve the flag-off path. Delete both when `PRESCRIBE_V2` replaces the old forms everywhere.

## Not done, and why

- Ward bed board entry: the board's data carries no patient id by design.
- Resus panel "administer" dialogs stay: they record cart administrations, which is P2.
- NCD registry medicine list stays: it is registry capture, not prescribing.

## Tests

- `tests/prescribing/prescribe-v2.test.ts` (unit, 10).
- `tests/emr-db/prescribe-scenarios.test.ts` (PGlite lane, S1–S3).
- `tests/emr-db/drizzle-parity` has 12 failures on tables this branch did not touch (pre-existing drift);
  `prescriptions` and `prescription_drafts` pass.

---

# P2 (b) Nursing (F5): nurse tasks and the medicine chart

Behind the nurse side of **`PRESCRIBE_V2`**: `nurseTasksLiveFor` (`lib/emr/feature.ts`) = `PRESCRIBE_V2` + `EMR_PRESCRIBING`,
off in production while `PRESCRIBE_COPY` or `NURSE_TASKS_COPY` is draft. Flag off: no task is raised, the Tasks card
stays a placeholder, the MAR page is the free-text form only.

## Owner to do

1. Apply **0281** (GATED, after 0279/0280): `cd /Users/airm1/Desktop/medsync-rx && npm run db:migrate`. Table
   `nurse_tasks` (RLS forced, reader's scoped SELECT, no client grants, one-way trigger: open → done | cancelled, then
   frozen, never deleted; audited) and on `medication_administration_records`: `client_key`, `reverses_id`, state
   `reversed`. The Drizzle schema names the new MAR columns, so apply before deploying this branch.
2. Sign `content/nurse-tasks.ts` (`NURSE_TASKS_COPY`, draft; the cannula sizes and sites are the prototype's lists).

## Where it landed

| Feature                            | Where                                                                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task raised on send                | `raiseIvTaskOnSend` (`lib/emr/write/nursing.ts`), one call at the end of `sendPrescribed` (`lib/emr/write/plan.ts`)                                                                    |
| Generic task insert (P4 uses it)   | `raiseNurseTask`: type, source kind + id, payload, due_at, client key                                                                                                                  |
| Tasks page                         | `app/nurse/tasks/page.tsx` + `_components/task-list.tsx`; sidebar item un-dimmed and overview card linked when on                                                                      |
| Cannula done → line on the patient | `completeIvTask`: a `procedures` row ("Peripheral IV cannula 18G, left forearm", laterality) + task outcome; `ivLinesFor` shows it on `app/nurse/patients/[patientId]`                 |
| Result on a task                   | `completeResultTask` → `enterResults` (its own gates: nurses enter bedside tests only), task outcome `{reportId}`                                                                      |
| Given / Withhold                   | `recordDose` against the prescription line (drug, dose, route from the line, never the screen); `app/nurse/mar/_components/chart-doses.tsx` over `loadNurseMar` (reuses `buildMarRow`) |
| Undo                               | `reverseDose`: a reversal row with the reason, once; `liveDoses` (`lib/emr/charts/build.ts`) drops the pair, also in `lib/emr/read/monitoring.ts`                                      |
| Server actions                     | `lib/emr/actions/nursing.ts` (surface `nurse`, flag gate; cadre gate NURSE_CADRES in each write)                                                                                       |

## Defaults taken

- "No line recorded" = no done `iv_cannula` task on this visit and no open one for the patient. A cannula noted only in the
  examination's free text is not seen; no resite/removal yet (marked `ponytail:`).
- One task per send for all its IV lines; due now unless every IV line starts at the next round.
- Size and site have no preselected value (the prototype's 20G / left hand defaults would be invented data).
- High-alert and controlled lines are not given from this chart (no enrolled-nurse co-sign or CD witness here); they keep the
  free-text Medications form / CD dose page, and the chart says so.
- No UPDATE/DELETE trigger on the MAR itself (0031 table; demo-removal paths delete): the new writes are insert-only.
- Tasks list shows the patient code, not the name (no per-row PHI decrypt).

## Not done, and why

- Protocols running on the Tasks page: P4 (no runs exist yet).
- Nothing raises `enter_result` tasks yet: no signed rule says when; P4's charts will (`raiseNurseTask`).
- Pharmacy reads of the MAR still count a reversed dose as given (pharmacy folders are P2 (a)'s).
- No browser check at 390 px: needs 0281 on a database and a nurse sign-in; layouts are single-column flex-wrap.

## Tests

- `tests/emr-db/nurse-tasks-scenarios.test.ts` (PGlite lane, 3): S5, Given / Withhold / undo, result on a task.
- `prescribe-scenarios` (S1–S3) still pass; `drizzle-parity`: `nurse_tasks` and the MAR pass (same 12 old failures).

# P2 (a) Pharmacy — the pharmacy hand-off (F4)

All behind `PRESCRIBE_V2` (now also gated on `PRESCRIBE_HANDOFF_COPY`, draft); the queue, query and witness
are the pharmacy rework's, plugged into, not rebuilt. Flag off: no column is required, no word changes.

## Owner to do

1. Apply **0280** (GATED, after 0279): `cd /Users/airm1/Desktop/medsync-rx && npm run db:migrate` —
   `pharmacy_handovers.explained_attested boolean NOT NULL DEFAULT false`.
2. Sign the draft copy `PRESCRIBE_HANDOFF_COPY` in `content/pharmacy-prescriber.ts` (line words, the
   hand-over confirmation and its refusal).

## Where it landed

| Kit F4                               | Where                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line states (prescriber)             | `rxWord(r, place, status)` in `lib/prescribing/places.ts` maps the folded pharmacy stage (`lib/pharmacy/lines.ts`) to Waiting at pharmacy / Pharmacy asks you / Owed, given later / Handed over / Stopped (+ Changed, Buying outside, Not supplied, Waiting for co-sign)                                    |
| Line states (pharmacy)               | unchanged: the rework's signed words and Dispense tabs (Waiting, Queried, Ready to collect, Owed, Handed over)                                                                                                                                                                                              |
| Holds                                | existing stages: co-sign → `awaiting_cosign`; talk to the prescriber → `queried`; patient not here yet → `ready` (decided, not collected). No new hold event                                                                                                                                                |
| Statuses and questions in the dialog | `loadPrescribeSession` reads `prescriberViewIn` (new, `lib/pharmacy/review/prescriber-read.ts`, same view as the plan's, inside the session's transaction, every placed line's stage)                                                                                                                       |
| Answer Keep / Change / Stop          | `prescribe-session.tsx` renders the plan's `PharmacyItemBlock` under each "already prescribed" line; Change opens the editor and sends the line with `replaces` through `sendPrescribed` (server answers the query `changed`); Keep / Stop use `answerQuery`. `PharmacyHandlers.onDone` reloads the session |
| Count before opening                 | `encounter-prescriptions.tsx`: "n from the pharmacy" beside Prescribe                                                                                                                                                                                                                                       |
| Hand-over confirmation               | `explainedAttested` on `HandoverInput`; `checkHandover` refuses `explained` when `explainRequired` (actions pass `prescribeV2LiveFor`); tick on the hand-over screen. Identity (two identifiers) and the controlled witness are the existing ones                                                           |
| Controlled witness                   | unchanged: the plain hand-over refuses a controlled line; `recordControlledSupply` (witness, count, register)                                                                                                                                                                                               |
| Resus lines                          | `dispensable()` in `lib/pharmacy/read.ts` (not emergency, `prescribe_place` not resus) in every dispense read: queue, review/hand-over loader, prescription read, downtime entry. Never queued, staged or handed over; the cart is restocked by the existing cart check (EC-1, count-based)                 |
| MAR reversals (0281)                 | `liveDose()` in `lib/pharmacy/clinical/read.ts` (given, not undone by a `reversed` row) in the clinical, reconciliation and stewardship reads; the same NOT EXISTS in the ward, recall, ward-stock and demo SQL                                                                                             |

## Defaults taken

- Pharmacy keeps its signed words; the kit's pharmacy column is the same stages, not relabelled.
- Resus lines are not added to the cart check's "recorded uses": the line names no cart (the dialog does
  not ask for one). Add a cart choice to the resus dialog if the pharmacy wants them listed.
- The answer loop shows on the doctor surface only (the existing answer actions are `surface: "doctor"`).

## Not done, and why

- A "Change it" line still raises "Already prescribed" against the line it replaces (client and server
  agree, the prescriber answers it). Excluding the replaced line belongs in `placePlan`'s `others`
  (`lib/emr/write/plan.ts`, P1, not touched).

## Tests

- `tests/emr-db/prescribe-handoff.test.ts` (PGlite, 4): S4 query → Change it → hand-over refused without
  then recorded with the confirmation; controlled line refused by the plain hand-over; resus line never
  queued or handed over; a reversed MAR dose is not counted.
- Re-run green: pharmacy-prescriber, pharmacy-stock-answer, pharmacy-controlled, pharmacy-supply,
  pharmacy-review, pharmacy-downtime-entry, prescribe-scenarios, pharmacy-clinical-data, pharmacy-demo-\*,
  pharmacy-stores-supply, pharmacy-reads; unit `tests/pharmacy` + `tests/prescribing` (1468).
  drizzle-parity: the same 12 pre-existing failures; `pharmacy_handovers` passes.

---

# P3 Quick protocols in Prescribe (F6)

Behind **`PRESCRIBE_V2`** (`protocolsLiveFor`, `lib/emr/feature.ts`: + `EMR_PRESCRIBING`, off in production while
`PRESCRIBE_COPY` or `PROTOCOLS_COPY` is draft). Flag off, or a non-prescribing cadre: no mode switch, nothing changes.

## Owner to do

1. Apply **0282** (GATED, after 0279–0281): `cd /Users/airm1/Desktop/medsync-rx && npm run db:migrate`. Tables
   `protocols`, `protocol_versions` (RLS forced, reader's SELECT of seeds + own hospital, no client grants);
   `prescriptions.protocol_version_id` + `protocol_start`; the 10 seed protocols as DRAFT version 1. The Drizzle
   schema names the new prescriptions columns, so apply before deploying this branch.
2. Sign the draft copy `content/protocols.ts` (`PROTOCOLS_COPY`, `PROTOCOL_GROUPS`).
3. Clinical sign-off of each protocol happens in the app: two different consultants press "Sign off this version".

## Where it landed

| F6 item                                  | Where                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode switch "Medicines \| Protocols · N" | `prescribe-session.tsx` (five non-clerking places; the clerking Plan's own basket has no Protocols mode yet)                                                                                                                                                                                                                                               |
| List by group, signed/draft              | `components/clerking/plan/protocols-mode.tsx` over `listProtocols` (`lib/emr/write/protocols.ts`): a hospital's own newest signed version, else its draft copy, else the seed                                                                                                                                                                              |
| Rules (data) and pure functions          | `lib/protocols/quick.ts`: `QuickRules` zod shape, `bandOf`/`effectsOf` (holds + word changes), `doseOf`, `planOf`, `supplyOf`, `protocolChecks`, `verifyProtocol`, `canStart`, `fromBuilder`                                                                                                                                                               |
| Starting values from results             | `loadFactSnapshot` concepts named by the version (`obs.potassium`, `obs.sodium`, `obs.bp_*`, `obs.heart_rate`), with source and time; "Enter one" (typed, stored as "entered here"); "Order it" → `placeOrders` (`orderStartTest`, U&E)                                                                                                                    |
| Checks                                   | protocol: not signed, who (age/sex/pregnant), weight, starting value missing (hard), blocking bands (DKA K < 3.3 → insulin held, labetalol pulse < 60), indication, already running (active lines of the same protocol), IV access (P2 cannula or open task); medicines: each supply line's `planChecks`, answered in the same list (allergy: senior only) |
| Plan                                     | step list (`planOf`): times, dose worked out for this patient with the arithmetic, "Before each dose", ranges, On hold                                                                                                                                                                                                                                     |
| Pharmacy supply                          | one placement through `sendPrescribed(…, protocol)`: lines built on the server from the version; dose = the protocol's words for this patient, quantity = the supply (`prescriptions.quantity`); `protocol_start` on every line (start values, holds, answers)                                                                                             |
| Builder                                  | `saveProtocolDraft`: a hospital protocol (`custom-<uuid>`, group custom) + draft version 1; live preview for the current patient (`planOf` on the client)                                                                                                                                                                                                  |
| Sign-off                                 | `signProtocolVersion`: CONSULTANT / SENIOR_CONSULTANT; a seed is copied for the hospital on the first signature; the second must be another person; then signed and frozen                                                                                                                                                                                 |
| Server gates                             | `lib/emr/actions/protocols.ts` (flag), cadre in each write, `canStart` + `verifyProtocol` + witness in `startProtocol`, every medicine check again in `placePlan`                                                                                                                                                                                          |
| [DB]                                     | 0282: signed ⇔ two signatures; signers distinct; roles CONSULTANT/SENIOR_CONSULTANT/DTC_CHAIR, not two DTC chairs; seed never signed; trigger: signed frozen, never deleted, content fixed once the first signer signed                                                                                                                                    |

## Defaults taken

- `canStart`: signed only in production (`VERCEL_ENV=production`); in dev and Vercel preview a draft starts, labelled
  "prototype values, need local sign-off". The DB does not refuse a draft start (it cannot know the environment).
- Signers: 2 consultants (CONSULTANT or SENIOR_CONSULTANT). The DTC chair has no role in MedSync: the DB allows
  `DTC_CHAIR`, but nothing grants it yet.
- Local sign-off: seeds (hospital NULL) are never signed; the first signature makes the hospital's own copy.
- Supply lines are `kind: drug`, `frequency: stat`, `course: single`, no `doseNum`; the protocol's dose words are the
  line's `dose`. Protocol lines still show on the nurse's MAR as P2 lines (P4 must give them on the chart and drop
  them from the MAR: `protocol_version_id IS NOT NULL`).
- IV task: raised for `iv` and now also `infusion` routes (`raiseIvTaskOnSend`).
- "Adult" = age 12 or more (the prototype's line, stored in each version as `who.minAge`).
- Builder protocols chart in 1 h × 24 slots (`ponytail:` in `saveProtocolDraft`); Give steps take the medicine's
  first route.
- A typed starting value is not saved to results (P5 applies to chart values, P4).

## Seeded, and what P4/P5 complete

Seeded (0282, all DRAFT): the 10 protocols, each with §2's slot, source, confirm list, starting values and bands,
the step list (§2 numbers) and the first supply. Supply counts §2 does not give are the prototype's
`PROTOS.supply` (DKA KCl 8, 10% glucose 3; labetalol 3; salbutamol 4; atropine 50; insulin 1 vial) and its ampoule
sizes (MgSO4 5 g, acetylcysteine 2 g, phenobarbital 200 mg, diazepam 10 mg).

TODO P4/P5: `protocol_versions.seed` is `{}`: put the rule modules' named numbers there (`lib/protocols/rules/<module>`
reads `rules.module`); the rest of each §2 sheet is in `rules` only as words (rules steps): severity/HDU triggers,
reassess triggers, targets with their alerts, resolution tests, causes, hyperkalaemia grades as actions, labetalol
MAP aim/floor maths, OP atropinised signs, NAC treatment line, SSI suggestion rules, HHS fluid balance. A seed
change is a new draft version (signed versions are frozen).

## Not done, and why

- Flow chart view: P4 (step list only).
- "Open the full chart": P4 (no charts yet).
- Protocols mode in the clerking Plan dialog: it has its own basket; add when the Plan moves to the session dialog.
- No browser check at 390 px: needs 0282 on a database and a doctor sign-in; layouts are single-column flex-wrap,
  the builder grid is one column under 640 px.

## Tests

- `tests/prescribing/protocols-quick.test.ts` (unit, 9): seeds read and use formulary routes, DKA K 3.2 hold, insulin
  by weight and cap, supply counts, checks, Mg who, SSI scale, `canStart`, builder.
- `tests/emr-db/protocols-s6.test.ts` (PGlite, 2): S6 end to end (order missing K, K 3.2 from results, draft refused
  in production, sign-off rules in the server and [DB], sign and send, already running) and the builder draft.
- Re-run green: prescribe-scenarios (3), prescribe-handoff (4), nurse-tasks-scenarios (3); unit `tests/prescribing`
  (138). drizzle-parity: the same 12 old failures; `protocols`, `protocol_versions`, `prescriptions` pass.

---

# P4 Protocol chart engine (F7–F8)

Behind **`PRESCRIBE_V2`** (`protocolsLiveFor`), like P3. Flag off: no Protocols button, routes 404, the nurse Tasks
page has no "Protocols running" section; protocol lines are off the MAR either way (they are given on the chart).

## Owner to do

1. Apply **0283** (GATED, after 0282): `cd /Users/airm1/Desktop/medsync-rx && npm run db:migrate`. Tables
   `protocol_charts` and append-only `protocol_chart_events` (RLS forced, scoped SELECT, audited; reversal events
   only; a chart is never deleted; [DB] P1: a chart starts only from a signed version unless the server marks the
   transaction for local development), and the DKA seed's named numbers (§2.1) into `protocol_versions.seed`
   (still DRAFT, unsigned).
2. Sign the draft copy: `content/protocol-charts.ts` (`CHART_COPY`) and `content/protocol-charts-rules.ts`
   (`STEPS_COPY`, `DKA_COPY`).
3. Sign the DKA version in the app (two consultants, P3), after checking the seed numbers in 0283.

## Where it landed

| Item                     | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine (pure, no I/O)    | `lib/protocols/engine/`: `fold` (events → state; reversals drop), `kit` (the prototype's `K`), `derive` (`deriveChart(version, chart, events, facts, now)` → phases, steps with To do/Needs you/Done, briefs, flow path, nurse tasks with due times, aims, grid with dashed due cells, trend panels with thresholds and target lines, vitals card, pharmacy rows, drug lines, log; `offeredActs`/`isOffered` = the P2 role gates and P6 blocks), `keys` (chart key ↔ record concept, lab groups)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Rule modules             | `lib/protocols/rules/<id>.ts`, chosen by `rules.module`: **dka complete** (full `dkView` port, every number from the version's seed, zod-checked); **generic step engine complete** (`steps.ts`, the `pcView` path over the version's P3 step list: Given with checks, Started, result bands, check times, rules); **stubbed** (chart their 0282 step list through `steps.ts` until P5 ports their sheets): `hhs`, `hyperk`, `htn`, `mgso4`, `art`, `se`, `op`, `nac`, `ssi`. A version its module cannot read is shown blocked, nothing offered                                                                                                                                                                                                                                                                                                                                                                                 |
| Server                   | `lib/emr/write/protocol-charts.ts`: `loadChart` (facts: plan facts, eGFR, problems, results by chart key, IV lines and open cannula task), `startChart` (prescribing cadre, `canStart`, one running per protocol), `chartAct` (re-derives, accepts only `isOffered` for the signed-in role; `iv` → `raiseNurseTask` iv_cannula; `order` → `placeOrders`; `weight` → `recordObservations` obs.weight), `recordSlot` (nurse; form keys only; required keys), `recordVitals` (nurse; GCS E/V/M ranges, total on the server), `changeParam` (doctor), `addChartNote`, `endChart` (doctor; reason; reopen), `undoChartEvent` (reversal with a reason, by the author or a doctor), `sendChartOrder` (doctor; through P3 `startProtocol` → `sendPrescribed(…, protocol)`), `syncTasks` (nurse_tasks type `protocol_step` follow the chart after every write; closed when the chart ends). Actions: `lib/emr/actions/protocol-charts.ts` |
| Screens                  | Patient record › **Protocols** button (doctor, nurse) → `/{doctor,nurse}/patients/[id]/protocols` (running and ended charts, start picker for doctors) → `/…/protocols/[chartId]`: `components/protocols/chart-screen.tsx` (role from the cadre: doctor "Steps and orders", nurse "Tasks and recording", both "Monitoring chart"; pharmacy cadre: drug orders read-only), flow chart and list views, the open step in a centred `EditorDialog`, record form, vitals card with mini trends, trend panels on the EMR graph frame (`components/protocols/trends.tsx`), time grid, medicines with live stock (`stockLinesFor` → `stockLineWords`), notes, recent log with undo, end/reopen                                                                                                                                                                                                                                           |
| Ward "Protocols running" | nurse Tasks page section (`loadRunningCharts`, `lib/emr/read/protocol-charts.ts`); protocol tasks show "Open the chart"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P3 links                 | Prescribe › Protocols: "Open the full chart" (doctor surface)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| MAR                      | protocol lines (`protocol_version_id`) are not on the nurse's MAR; `recordDose` refuses them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| canStart (safety fix)    | a draft starts only when `NODE_ENV` is not production and no `VERCEL`/`VERCEL_ENV` is set (so never on a Vercel preview)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Defaults taken

- Role = cadre: ordering cadres → doctor, nurse cadres → nurse, any other clinical cadre → pharmacy (read-only). The
  pharmacy workspace has no EMR access, so a pharmacist sees a chart only through a clinical surface.
- The "+1 h / +6 h" prototype clock is a dev-only `?at=` minutes offset (`isLocalDev`); the actions take `devAt`
  only there. Production ignores both.
- Nurse tasks are raised on chart writes only (`ponytail:` a timed job would raise "Record hour n" without a write).
- "Ordered, waiting" comes from the chart's own orders (`ponytail:` in `chartFacts`).
- Slot and vitals values stay on the chart's events; only a weight goes to the record (`obs.weight`). Writing chart
  values to results (and closing their orders) is P5 (`labKeys` is ready).
- Send to the pharmacy uses place "ward" and the answers the server asks for in P3's dialog: from the chart, any
  check that needs an answer refuses the send with its reason (use Prescribe › Protocols for those).

## Not done, and why

- Rule sheets for the nine stubbed modules: P5.
- Browser check at 390/1440 px: needs 0282+0283 on a database and a doctor and nurse sign-in. Layouts are single
  column under `lg`, tables and graphs scroll inside their own frame; render tests cover each role.
- Chart values to results / closing orders, and the pharmacy workspace view of charts: P5.

## Tests

- `tests/prescribing/protocol-charts-engine.test.ts` (unit, 11): every one of the 10 seeds charts from its version;
  stubs offer Given to the nurse only and refuse a dose without every check; a blocked version offers nothing; DKA:
  confirm/severe/anion gap/start rate, IV line gate, K < 3.3 holds insulin, lines-checked before a raise + pump
  task + lock, hypo task, resolution → end → no tasks, trends/gas due cells/GCS E/V/M/added SpO₂, undo.
- `tests/prescribing/protocol-charts-ui.test.ts` (unit, 4): each role's screen renders; design rules on the files.
- `tests/emr-db/protocol-charts-s7.test.ts` (PGlite, 2): S7 + S8 end to end through the server writes; S9 monitoring
  chart and undo. `tests/emr-db/protocol-charts-db.test.ts` (PGlite, 3): seed numbers, P1 [DB], P3 append-only.

# P5 The 10 protocols (F9)

All ten rule modules are complete: `lib/protocols/rules/{dka,hhs,ssi,hyperk,htn,mgso4,art,se,op,nac}.ts`, each
the prototype's `PC.<id>.build(K)` on the generic kit, every number read from the version's `seed` (zod-checked;
a version without its numbers is shown blocked and offers nothing). Seeds: **0284** (HHS, sliding scale),
**0285** (hyperkalaemia, labetalol, magnesium), **0286** (malaria, seizures, OP, acetylcysteine), all still DRAFT
and unsigned. Lab values typed on a chart go to results tagged with the chart and close the chart's order.

## Numbers taken from the prototype (FEATURES §2 gives none)

| Protocol        | Seed values from `Main.dc.html` `PC.<id>`, not §2                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All             | phase boundaries (slot indices), the reference ranges (`refs`, the prototype's REFS), adult/child cut at 16 y where the module needs one                                                                                                                  |
| HHS (0284)      | insulin at least 1 unit/h in 50 ml, 2 boluses, 150 ml 10% glucose for a hypo, the 6–10 aim, the 24 h senior review                                                                                                                                        |
| Sliding scale   | the bands table is §2.10's example (hospital-editable, FEATURES §5): replace with the hospital's own signed scale in a new version                                                                                                                        |
| Hyperkalaemia   | salbutamol fast-pulse warning over 100, hypo treatment 150 ml 10% or 50 ml 20% with a 15 min recheck, eGFR alert under 15, bicarbonate under 22                                                                                                           |
| Labetalol       | infusion middle step 1.5 mg/min                                                                                                                                                                                                                           |
| Magnesium       | 50% at 2 ml per g, dose window 15 min, low urine 25 ml/h, after delivery BP 150/100 every 4 h                                                                                                                                                             |
| Malaria         | reconstituted vial used within 60 min, IV over 1–2 min, a dose early by up to 30 min, adult hypo alternative 250 ml, recheck 15 min, tablets from 8–12 h, first dose within 60 min, GCS flags 5 (child) / 15 (adult), fever over 37.5                     |
| Seizures        | thiamine 100 mg, diazepam 5 mg/ml IV over 2 min and offered from 5 min, phenobarbital 200 mg/ml, aims diazepam by 10 min and fitting stopped by 30 min, SpO₂ flags 94/90, RR under 10, stabilise done at 3 chips                                          |
| Organophosphate | atropine 1 mg/ml, infusion % options 10/15/20 (default 15), signs every 15 min, late weakness days 1–4, aims first dose by 5 min and atropinised by 30 min, pulse over 120 / under 60, pharmacy warning over 30 mg, airway done at 4 chips, SpO₂ under 90 |
| Acetylcysteine  | "abnormal LFTs" = ALT 50 or more (INR over 1.3), 2,000 mg ampoules, a bag may start 10 min early, end bloods 60 min before bag 3 ends, glucose under 4                                                                                                    |
| DKA (0283, P4)  | as listed in 0283's header                                                                                                                                                                                                                                |

## Defaults taken

- The prototype's "usual medicines" rows (keep, hold, stop the patient's home medicines) are not ported: the
  chart's facts have no home-medicines list to read. Add when the record carries one.
- A nurse's value for a lab test that is not a bedside test (potassium, sodium, gas) stays an observation tagged
  with the chart; only the results writer's bedside tests are entered on an order by a nurse.
- Values worked out on save (HHS osmolality, labetalol MAP) are the module's `derive`, applied by the server's
  `recordSlot` and stored on the slot event; the engine reads the stored value (P8 is unchanged: no status is
  stored).

# P6 Finish

## Where it landed

| Item              | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy in one place | the nine P5 copies (`HHS_COPY`, `SSI_COPY`, `HYPERK_COPY`, `HTN_COPY`, `MGSO4_COPY`, `ART_COPY`, `SE_COPY`, `OP_COPY`, `NAC_COPY`) moved unchanged into `content/protocol-charts-rules.ts` beside `STEPS_COPY` and `DKA_COPY`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Copy gate         | `protocolsLiveFor` now also needs `CHART_COPY` and every copy in `content/protocol-charts-rules.ts` signed before it turns on in production                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| MAP on save       | `htn.ts` no longer folds the MAP into its slots on each render; it reads the value `recordSlot` stores                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Offline (P11)     | `components/protocols/chart-screen.tsx` uses the EMR outbox (`lib/emr/sync/queue.ts`, as the clerking desk): offline, the nurse's slot, vitals and chart acts (given, hung, started, fitting stopped) wait and are sent in order by their client key when back online (a strip lists them; a refused one shows Retry / Discard). The doctor's acts, notes, parameters, end, undo and sign and send refuse offline in words (`queuesOffline`). Server: `chartAct`, `recordSlot` and `recordVitals` return the saved event for a client key already on the chart (a resend after a lost reply), instead of re-checking a chart that has moved on |
| 390 px            | record form and vitals card inputs shrink in their grid (`min-w-0`, `w-full`); Prescribe's "Dose by age" table scrolls in its own box                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Defaults taken

- A queued entry is stamped with the server's time when it arrives (P9); the time it was entered offline is not
  kept. `ponytail:` add an effective time to `protocol_chart_events` (new migration) if wards stay offline long.
- The outbox lives in the page (as the clerking desk's): closing the tab with entries waiting asks first; a reload
  loses them.
- Playwright is not set up in the repo, so no dependency was added: the 1440/390 px smoke is render and class tests
  in `tests/prescribing/protocol-charts-ui.test.ts`.

## Tests

- `tests/emr-db/protocol-charts-s11-s12.test.ts` (PGlite, 2): S11 (Protocols running and the record list, opens
  in its protocol, ended leaves the ward list) and S12 (offline slot and bag through the real outbox, first reply
  lost, resent: one event each).
- `tests/prescribing/protocol-charts-ui.test.ts` (+3): `queuesOffline`, the 1440/390 layout classes, and the 390 px
  rules on every kit screen file (no fixed width over 358 px unprefixed, tables in `overflow-x-auto`).
- Scenario map: S1–S3 `tests/emr-db/prescribe-scenarios`, S4 `prescribe-handoff`, S5 `nurse-tasks-scenarios`,
  S6 `protocols-s6`, S7–S9 `protocol-charts-s7` (+ engine and UI unit tests), S10 `tests/protocols/*` (one walk per
  protocol), S11–S12 `protocol-charts-s11-s12`.

# Owner checklist (whole kit)

1. **Migrations**, in order, all GATED: **0279, 0280, 0281, 0282, 0283, 0284, 0285, 0286**:
   `cd /Users/airm1/Desktop/medsync-rx && npm run db:migrate`. The Drizzle schema names columns from 0281 and
   0282, so apply before deploying this branch.
2. **Flags**: `PRESCRIBE_V2` (`1` or hospital ids; needs `ENCOUNTER_ENGINE_LIVE`, `EMR_V1`, `EMR_PRESCRIBING`).
   It drives `prescribeV2LiveFor` (Prescribe), `nurseTasksLiveFor` (nurse tasks, Given / Withhold) and
   `protocolsLiveFor` (Protocols mode and the charts). In production (`VERCEL_ENV=production`) each stays off
   while any of its copy is draft:
   - `prescribeV2LiveFor`: `PRESCRIBE_COPY`, `PRESCRIBE_HANDOFF_COPY`
   - `nurseTasksLiveFor`: `PRESCRIBE_COPY`, `NURSE_TASKS_COPY`
   - `protocolsLiveFor`: `PRESCRIBE_COPY`, `PROTOCOLS_COPY`, `CHART_COPY`, every copy in `content/protocol-charts-rules.ts`
3. **Draft copy to sign**: `content/prescribing.ts` (`PRESCRIBE_COPY`); `lib/prescribing/order-sets.ts`
   (`ORDER_SETS_STATUS`); `content/pharmacy-rework-daily.ts` (`RX_CHECKS.prescriberSaid`); `content/nurse-tasks.ts`
   (`NURSE_TASKS_COPY`); `content/pharmacy-prescriber.ts` (`PRESCRIBE_HANDOFF_COPY`); `content/protocols.ts`
   (`PROTOCOLS_COPY`, `PROTOCOL_GROUPS`); `content/protocol-charts.ts` (`CHART_COPY`);
   `content/protocol-charts-rules.ts` (`STEPS_COPY`, `DKA_COPY`, `HHS_COPY`, `SSI_COPY`, `HYPERK_COPY`, `HTN_COPY`,
   `MGSO4_COPY`, `ART_COPY`, `SE_COPY`, `OP_COPY`, `NAC_COPY`).
4. **Ten protocols awaiting two-clinician sign-off** (in the app, two different consultants, P1): DKA, HHS,
   hyperkalaemia, IV labetalol, magnesium sulphate, IV artesunate, status epilepticus, organophosphate,
   acetylcysteine, sliding-scale insulin. Check each seed against FEATURES §2 and the prototype-sourced values
   above first; none can start in production until signed ([DB] P1).
5. **Defaults taken**: each phase's "Defaults taken" above, plus FEATURES §5 as built (two consultants sign; patient
   record › Protocols plus the ward's "Protocols running"; urine ketones allowed; vitals stay on the chart's events,
   only weight to the record; one signed order per chart for the first period; the sliding-scale table per version;
   slot length per protocol).
6. **Not browser-checked**: no screen of the kit (Prescribe, pharmacy hand-over, nurse tasks and MAR, Protocols
   mode, the chart screens) was opened in a browser at 1440 or 390 px: it needs 0279–0286 on a database and doctor,
   nurse and pharmacy sign-ins. Offline was tested through the outbox and the server, not by pulling a real
   connection.

# UI matched to the prototype

## Pharmacy (F4) and nurse (F5) screens

What changed (presentation and client wiring only; actions, reads and safety gates unchanged):

- **Nurse tasks** (`app/nurse/tasks/`): the prototype's NURSES block. Overline, title and sub, then one card holding
  Protocols running (heading with its count; each chart a row "{protocol} chart · {patient} · time on the chart ·
  last charted" with Open the chart) and Tasks (each task: To do, title, patient, why, asked; then Size, Site and
  Done: cannula in in one row, or Result and Save result; Done lines underneath).
- **Medicine chart** (`chart-doses.tsx`): each line a card, its doses as the prototype's step rows: the time in its
  own column, the word, then Given before Withhold (40 px). Withhold and Wrong entry keep the centred reason dialog.
- **Patient page**: the IV-access line is the prototype's fact tile: IV ACCESS · Cannula 18G · left forearm · day 1;
  with none, "No line" and "Nurse asked to insert one" when a cannula task is open.
- **Hand-over**: the "I checked who they are, and explained how to take each medicine" tick moved from the
  Explained section to the end, right before Record (the prototype's order: what is given, who collects, the
  tick, Confirm).

Differences forced by the owner's rules and the design system:

- Cannula size is chips, not a select (four or fewer choices are chips); no size or site is preselected (the
  prototype's 20G / left hand would be invented data).
- "To do" and each dose word are grey square Tags; the prototype's dashed empty boxes are the Tide empty state
  (no dashed boxes); one lagoon Given per line (the first open dose), later ones outlined.
- Every disabled button says why beside it (Done: cannula in, Save result, the reason dialogs' Save, Record
  hand-over), which the prototype does not.
- Withhold asks for a reason (FEATURES F5); the prototype withholds at a tap.

Not matched, and why:

- The pharmacy queue keeps the rework's signed words and tabs (Waiting, Queried, Ready to collect, Owed, Handed
  over), not the prototype's (Asked the prescriber, Stopped by prescriber); its Ask the prescriber dialog is the
  rework's signed one, not the prototype's Hold › Talk to the prescriber › question. Both are signed pharmacy
  copy, not kit additions; relabelling needs the CSO.
- The prototype's hand-over dialog (who collects as chips, one witness tick) stays the rework's numbered hand-over
  page: two identifiers, the controlled witness and count, labels, counselling and payment are safety steps.
- Resus lines never reach the dispense queue (no "Restock the cart" line); the cart is restocked by the existing
  count-based cart check.
- Task rows show the patient code only, not the prototype's name, age, sex and ward (no per-row PHI decrypt);
  running protocols show no step list or End protocol here (they live on the chart).

## Protocol chart screens (F7–F8)

What changed (`components/protocols/`, presentation and client wiring only; engine, server writes, actions and the
P11 outbox unchanged): the prototype's PROTOCOLS block. Header card (source overline, "{protocol} · {patient}",
Started · hour now · phase; Protocol chips; Viewing as {role} and its note; Patient chips; stat tiles; Recent line;
Aims Met / Not met / —). One large switch: "Steps and orders" (badge: steps that need you) or "Tasks and
recording" (badge: N due), and "Monitoring chart" (badge: the chart's hour). Doctor: three columns from 1180 px
(two from 860, one below) — Steps (Flow chart | List, flow by default, the patient's path filled in with its key),
the open step beside them with ‹ Previous / Next ›, then Medicines for this chart (stock, Sign and send), Notes and
the recent log with Undo. Nurse: Nurse tasks · Record ({slot} · due, Save {slot}) and the check card · the
medicines' sent state and Notes. Pharmacy: a rail (Drug orders, Monitoring chart read only, Recent) and the drug
orders with What the chart needs. Monitoring chart: Trends card (one panel per measure on one shared time axis,
thresholds kept apart, dashed target, Now line) beside the Vitals card (tiles with mini trends, + Add a parameter
inline with Quick pick, one-row entry with GCS E/V/M totalled, history), then the time grid. The protocols page
is the same header with the Protocol chips; a protocol with no running chart opens "Start the {short} chart for
{patient}" (`?start=`), Start for a doctor, "The doctor starts …" for anyone else.

Differences forced by the owner's rules and the design system:

- No "Viewing as" switch: the role is the signed-in cadre's, shown as a grey tag with its note.
- Step and flow states (done, needs you, to do, later) are a filled, ringed or empty grey mark plus a grey Tag or
  hidden word, not green/amber; "Now" is a grey Tag; badges are grey. Teal marks only the selection and the
  patient's path (the action colour, never a state).
- Amber/red only for a value's clinical reading (vital tiles, grid and table cells, field borders, trend points),
  always with a word or a glyph; a stop branch "This patient" and overdue tasks/vitals use the caution word.
  Threshold lines are the graph frame's amber; the prototype's green target lines are grey.
- The open step sits inline in the middle column (the prototype's "open it beside"), not a drawer; End and Undo
  reasons stay centred `EditorDialog`s. On a phone the step scrolls into view under the steps.
- Grid, vitals table, trend panels and picker rows scroll in their own box at 390 px; trends are drawn on
  `components/emr/chart/graphs/frame` (labels in its right gutter, not over the plot).
- "Live stock" is "Stock at {t}": the words are read at page load and after each write, not streamed; one line
  per medicine (the stock answer's own point), not the Ward 4B / Main pair with deltas.

Not matched, and why:

- Patients show by code (no per-row name decrypt). The Patient picker lists this patient and the ward's other
  patients already on this protocol; eligible patients not on it are not listed (no eligibility read exists).
- No "Prototype clock" / "Start again": the dev-only `?at=` clock stays (+1 h / +6 h), production has none.
- A doctor keeps "End this chart" in the header beside Reopen (ending early needs a reason; every module also
  ends from its last step). The quantity reads "Qty n" (the formulary has no pack unit).
- "Open in the pharmacy queue" is not shown: the pharmacy workspace does not open EMR charts (P4 default).
- The nurse Tasks page's "Protocols running" stays inline in `app/nurse/tasks/page.tsx`, already matched to the
  prototype in the nurse screens pass above; no separate component was split out.

## UI matched to the prototype

Prescribe (`components/clerking/plan/prescribe-dialog.tsx`, `prescribe-session.tsx`, `protocols-mode.tsx`) now
follows `docs/prescribing/kit/prototype/Main.dc.html`: one dialog with the patient name, place → collect pill and
fact strip (Allergy, Weight, Kidney, Pregnancy, Already taking), then 1 · What (search with arrows and Enter, the
group select, order sets, the list with "Suggested for this patient", IV fluids and the pharmacy classes, the brand
under the picked row), 2 · How (weight, regimen cards, your own dose, the dose line, "How to give it" selects with
"Changed from the regimen" / "Use the regimen", problem, note, To supply, repeats) and 3 · Check (checks that fold
to one line when answered, "N passed", then This prescription and "Already prescribed for {name}"). Footer: "Add to
prescription" / "Add · N to answer" and "Review and send" → "Check before you send" → "Sign and send to the
pharmacy". Protocols: 1 · Protocol list and 2 · Plan (starting values, Before you start, If at any time, the
supply, Flow chart | Step list); the builder is its own dialog with a live preview. Logic, actions and checks are
unchanged.

The class list is one: `CLASSES` in `content/pharmacy-medicines.ts` gained Cardiac, Antiplatelets, Emergency and
antidotes, Sedatives, Haemostatics, Blood products, Gout and Urology; `lib/prescribing/pharmacy-classes.ts` maps
all 75 formulary classes to one each (test: `tests/prescribing/pharmacy-classes.test.ts`). `PHARMACY_MEDICINES_COPY`
is still draft, so nothing to re-sign.

Differences forced by the owner's rules, and not matched:

- Review, the pharmacy's question and the builder are centred `EditorDialog`s; nothing slides in.
- Workflow words (In this prescription, Already prescribed, the pharmacy status, In stock / None, check counts) are
  grey square Tags; amber only for a patient fact (allergy, low eGFR, pregnancy, missing weight) and stop/check.
- No per-row stock counts or live feed: the prescriber sees stock words only for the picked medicine (AV-6).
- "Usual: …" on a row and pre-set doses come only from a signed regimen that applies; no dose-by-age table.
- No favourites section, no IV access chip (no data), no per-row allergy warnings (the checks carry them).
- Weight cannot be entered in the dialog (no weight write here); the box says to weigh and record it.
- Pharmacy answers keep the signed Keep / Change / Stop words and need a reason, not one tap.
- Protocols send from the protocol (its own Sign and send), not through the basket. The fluid chips stay.
- The clerking Plan shows no basket in column 3 (its basket is the Plan's own).
- `components/clerking/plan/medicines-browse-dialog.tsx` is no longer used by Prescribe (left in place).
