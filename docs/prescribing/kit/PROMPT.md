# Prompt for Claude Code: add the prescribing and protocol features to MedSync

Copy this kit into the MedSync repo as `docs/prescribing/kit/`. Open Claude Code at the repo root and paste everything below the line.

---

You are adding a set of features from a clickable prototype to the existing MedSync system. **Do not build a separate app.** Each feature goes where it fits in what already exists: the prescriber's patient record, the pharmacy dispense queue, nursing tasks and the medicine chart, results and vitals. Only what has no home today (the protocol charts) becomes a new module. Work on a branch `feat/prescribing-protocols`. Commit after each phase.

## Sources of truth (read only these, as needed)
1. `docs/prescribing/kit/FEATURES.md`. What to add: features F1–F9 with acceptance criteria, the 10 protocol rule sheets, the safety rules P1–P12, and the acceptance scenarios.
2. `docs/prescribing/kit/prototype/Main.dc.html`. This is the working reference for behaviour and layout. It is a Design-canvas component: the markup with `{{holes}}` sits inside `<x-dc>`, and the behaviour lives in `class Component` (`renderVals()` and its methods). FEATURES.md §0 maps each feature to its functions. Port the logic; do not redesign it.
3. `docs/prescribing/kit/prototype/Flow.dc.html` shows who does what, how the screens connect, and the 8 hand-offs between cadres. `Map.dc.html` shows the places that prescribe today.
4. `DESIGN-medsync.md` (Tide). Read only the token, type, navigation and component sections.
5. If `docs/pharmacy/rework/` exists, the pharmacy rework kit owns the dispense queue, stock and witness. Plug into it; do not duplicate it.

Read nothing else in `docs/` unless step P0 shows you need it.

## Token discipline
- Find code with `rg -n` and read only the line ranges you need. Never read a file over 400 lines whole, and that includes `Main.dc.html`: open it by function name with `rg -n "pcView\(|dkView\(|PC.hhs" …` and read ranges.
- Read each part of the prototype only in the phase that ports it.
- Edit in place. Do not re-read a file right after editing it.
- Run only the tests for what you just touched, plus the protocol scenario suite at the end of each phase.
- Use subagents only for the phases marked ⇉. Give each one its phase section and the folders it owns.
- Keep one living handoff file, `docs/prescribing/HANDOFF.md`. Write no ADRs, changelogs or other docs.

## Hard rules
- **Fit, don't fork.** Before building any feature, find its home: an existing route, component, table or action. Reuse it and extend it. If two homes exist, pick one and note it in HANDOFF.md. Create something new only when P0 marks it "new".
- **Clinical values are data, not code.** Every dose, threshold, band and timing in the rule sheets lives in a versioned protocol definition that two clinicians sign off (P1, P4). Until a version is signed, it previews but cannot start, and the UI says "prototype values, need local sign-off". The prototype's numbers are seed values only.
- **Safety:** P1–P12 in FEATURES.md §3 are non-negotiable. Enforce role gates and blocking checks in server actions and, where marked [DB], in SQL. Never enforce them only in the UI.
- **History:** chart events are append-only; fix a mistake with a reversal event. Add migrations; never edit applied ones.
- **Design:** use Tide tokens only. Never use coloured left or side accent borders (`border-l-*` accents) or very dark themes. Every screen must work at 390 px with no horizontal page scroll.
- **Copy:** all user-facing words go through the signed-content system, added as `draft`. Use plain words and the prototype's wording.
- **Data:** no demo patients or prototype clock in production paths. Fictional seeds go only in the dev seed script. The prototype's "+1 h / +6 h" clock becomes a dev-only time-travel helper for tests.
- **Ambiguity:** take the default in FEATURES.md §5, note it in HANDOFF.md, and continue. Stop only if a phase's exit check cannot pass.

## Phases
**P0 Recon and fit map (short).** Search the repo for each FEATURES.md item and write `docs/prescribing/FIT-MAP.md` (at most 80 lines): one row per feature with its existing home (route, component, table, action, with the real names) or "new", plus what changes there.
At minimum, find these:
- the patient record and the places that prescribe today (clinic visit, clerking plan, ward round, resus, NCD clinic, discharge)
- the current prescribing form and the drug catalogue (EMHSLU)
- regimens or dose rules
- allergies, weight, creatinine/eGFR and pregnancy on the patient
- lab orders and results
- vitals and observations
- nursing tasks and the medicine administration record (MAR)
- the pharmacy dispense queue, stock per place and the controlled-drug witness
- roles and permissions
- signed content
- the offline outbox

Exit when every feature has a home or "new", and nothing is duplicated.

**P1 One prescribing tool (F1–F3).** Make one Prescribe dialog that opens from every prescribing place, with that place's collect point. Build:
- the patient facts strip
- search, groups and order sets
- brand choice
- regimen dosing with weight bands and mg/kg, and the supply quantity
- the checks panel: allergy, kidney (CKD-EPI 2021), pregnancy, interactions, duplicates, child/adult, stock where the patient collects, limits
- the basket, draft keep and resume, review and send
- "already prescribed" with prescribe again and stop

Replace the old forms in each place with this one dialog, behind redirects or a flag.
Exit when scenarios S1–S3 pass.

**P2 ⇉ Hand-offs (F4–F5).** Two subagents:
- **(a) Pharmacy**, owning the dispense queue folders. Line states (Waiting, Pharmacy asks you, Owed, Handed over, Stopped), the prescriber query and answer loop, hand-over with the identity and counselling confirmation, and the controlled-drug witness (reuse the pharmacy rework's witness if present). Resus lines are given from the cart and restock it; they are not dispensed again.
- **(b) Nursing**, owning the nursing task and MAR folders. Tasks that prescriptions create (for example "Insert an IV cannula" when an IV medicine is prescribed and no line is recorded), Given/Withhold on the MAR, and results entered on a task flowing back into results.

Exit when scenarios S4–S5 pass.

**P3 Quick protocols in Prescribe (F6).** Add a Protocols mode inside the Prescribe dialog:
- the protocol list by group, with the signed or draft status
- starting values fetched from results, or ordered when missing
- the protocol checks (indication, already running, IV access, allergy, adult/child, potassium holds)
- the plan shown as a flow chart or a step list
- the pharmacy supply for the first period
- the protocol builder, which saves drafts that cannot start until signed off

Exit when scenario S6 passes.

**P4 Protocol chart engine (F7–F8). The big one; do it sequentially.**
- **Data:** `protocol`, `protocol_version` (rules JSON + seed values, status draft/signed, two signers), `protocol_chart` (patient, version, started, ended, end reason), `chart_event` (append-only: type, payload, actor, role, at), plus chart observations per time slot, custom monitoring parameters and notes. Reuse the existing vitals and results tables for vitals and lab values, tagged with the chart.
- **Engine:** port `pcView()` (generic) and `dkView()` (DKA) into pure functions in `lib/protocols/engine/`: `deriveChart(version, chart, events, patientFacts, now)`. It returns the phases, steps with status (To do / Needs you / Done), briefs, the flow chart path, nurse tasks with due times, targets and aims, the grid, trend series, the pharmacy rows and the drug order lines. **No I/O in the engine.** Each protocol is one module in `lib/protocols/rules/<id>.ts` that reads its numbers from the version, following the builder pattern of `PC.<id>.build(K)` in the prototype.
- **Actions:**
  - start and end/reopen a chart
  - mark a step done, a dose given or a bag hung
  - record a slot of observations
  - record vitals (BP, pulse, RR, GCS as E/V/M)
  - add or remove a monitoring parameter
  - add a note
  - sign and send the drug order
  - order missing tests

  Each action checks the role gate and the blocking rules server-side (P2, P6).
- **Screens:** a Protocols area (route per FIT-MAP) with the protocol and patient picker. The role views are Doctor / Nurse / Pharmacy, and the role comes from the signed-in user, not a switch. Each view has two screens: "Steps and orders" or "Tasks and recording", and "Monitoring chart". Also build the flow chart and list views, the open-step panel, the record form, the vitals card with mini trend charts, the trend panels, the time grid, medicines with live stock, notes and the recent log. Running charts appear in the nurse's task area and on the patient record.
- **Seeds:** the 10 protocols from FEATURES.md §2 as **draft** versions.

Exit when scenarios S7–S9 pass and the engine unit tests pass for every protocol.

**P5 ⇉ The 10 protocols (F9).** Split DKA+HHS+SSI, Hyper-K+Labetalol+Magnesium, and Malaria+Seizures+OP+Paracetamol across three subagents. Each owns its `lib/protocols/rules/*` files and their tests only. For each protocol, port the rule sheet and write a scenario test that walks it from start to end or resolution, as in FEATURES.md §4.
Exit when all protocol scenario tests pass.

**P6 Finish.**
- **Offline:** chart actions go through the outbox with idempotency keys. A nurse can record and give doses offline; doctor rate changes need a connection.
- **Width:** a 390 px pass on every new or changed screen.
- **Tests:** Playwright smoke at 1440 px and 390 px.
- **HANDOFF.md:** where each feature landed, the defaults taken, the protocols still awaiting clinical sign-off, and copy still `draft`.

## Definition of done
- Scenarios S1–S12 pass. The engine tests and safety tests pass. `pnpm typecheck`, `pnpm lint` and the build are clean.
- Every prototype feature has a home in FIT-MAP.md, and no screen or table duplicates an existing one.
- No protocol can start from an unsigned version in production.

## Final message
Keep it to at most 20 lines:
- the phases completed
- where the main features landed
- the test summary
- the defaults taken
- anything blocked, with the exact reason
- the branch name
