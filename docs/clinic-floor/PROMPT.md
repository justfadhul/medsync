# PROMPT: Tether clinic floor (triage station, clinic line, floor board), built from the prototype canvas

> **For Claude Code.** Work at the repo root on a new branch, `feat/clinic-floor`, cut from `main`.
>
> **What this slice does.** It builds the outpatient clinic floor from the _Tether Clinic Floor · Prototype_ canvas for the booking-first launch. It has three views behind one shell:
>
> - **Triage:** the nurse's worklist and triage panel.
> - **Clinic line:** the doctor's room, covering who is with you, calling the next patient, the pre-visit brief, trends and finishing the visit.
> - **Floor:** patient flow across every clinic, for the nurse in charge.
>
> A waiting-room screen shows codes and rooms only. The floor starts where the reception desk hands off (checked in, routed to triage or straight to clinic). It ends where the clinician workspace takes over (the visit record).
>
> **Triage uses the existing engine. This is not negotiable.** Tether already has a guideline-verified triage engine (triage engine v2: NEWS2, SATS/TEWS, Step 0 life threats, overridable, deterministic) and a recommendations layer. This slice **calls them**. It does not build, copy, extend or re-tune a triage scale, score, threshold or level. Section 2 says exactly how.
>
> **Relationship to other prompts.**
>
> - The shell, tokens, `Ticket`, toasts, privacy mode, shortcuts and user switch come from `PROMPT-RECEPTION-DESK.md`. Reuse them; never fork them.
> - `PROMPT-DOCTOR-WORKSPACE-UNIFIED.md`: if its patient-flow projection, triage sheet or lane registry exist, this slice reuses them. Section 4 decides where the clinic line sits relative to the Workspace.
> - Booking, scheduling, Help (pre-alerts), Resus Desk and the lab workflow are used as they are. Where one lacks a capability this floor needs, Step 2 adds it, engine-first.
>
> **Mode: gated.** Nine steps, numbered 0 to 8, each ending in a **STOP**.
>
> - Documents: draft, critique against this prompt, revise (two passes at most), present, STOP.
> - Code: build, run the real checks, fix, re-run until green, report, STOP.
> - Never start the next step on your own.
>
> **The CSO is Fadhul.** He signs:
>
> - the GATE A decisions;
> - every string a user reads (into `content/clinic-floor/` as `draft`; **never edit a `*_COPY_STATUS` yourself**);
> - every display band and keyword list;
> - each step's screenshots;
> - the cutover.

---

## 0. Working economy (read first, applies to every step)

Be **exact and lean**. Accuracy beats speed, and tokens are not free.

1. **Search before you read.** Use `rg` for symbols, routes and engine exports. Open only the line ranges you need.
2. **Never re-print.** Do not echo files, diffs, schemas or logs in chat. Quote at most 1 to 5 lines, with `path:line`.
3. **Edit, don't rewrite.** Make targeted edits and leave untouched code unformatted.
4. **Reuse first.** Before creating a component, hook, action, table, token or helper, `rg` for an existing one and report what you reused. For anything triage, the answer is always the engine.
5. **Run narrow checks while building** (touched test files, one route's spec). Run the full suite once per STOP.
6. **The canvas is a reference, not source.** Take layout, behaviour and words from it. Never paste its markup, CSS or script.
   - Its `tri()` function is a **stand-in** that imitates the engine for the demo. Do not read it as a spec, port it or test against it.
   - Its timers, fixed demo date and seed are demo-only.
7. **STOP reports are short and tabular.** List changed files (one line each), checks with numbers, screenshots by path and open questions. Keep it under 60 lines, with no narrative.
8. **When unsure, ask at the STOP.** Never guess a clinical rule, a band, a permission or a string.
9. **No new dependency** without stopping to flag it.

---

## 1. Ground truth and reading order

1. **The repo wins** over this prompt and the canvas. Report every disagreement at STOP 0.
2. **The triage engine and recommendations layer** (expected under `lib/triage/**`; find the real paths). Read its public API, output types, level catalogue, override path, tests and the signed reference files. Do not read it to re-implement it.
3. **The canvas:** _Tether Clinic Floor · Prototype_ (https://claude.ai/artifact/QEptbQYorykwy9XCLwih2f).
   - Boards: **Floor · computer (doctor)** 1440 × 960, **Floor · tablet (triage nurse)** 834 × 1112, **Floor · phone (doctor)** 390 × 844.
   - Tweaks: role _Doctor / Nurse_, scenario _Busy morning / First run / Offline_, _dark_.
   - Fadhul exports it to `docs/design/canvases/clinic-floor/`. Its sticky notes list the assumed decisions; Section 11 turns them into GATE A items.
4. **The reception desk build** (shell and shared components) and its ADRs.
5. **MedSync Tide** (`docs/design/tide/`). Map every canvas colour to a token.
6. **ADRs:**
   - 0084 (queue honesty), 0097 (place colour) and 0098 (unsigned clinical content);
   - the red-reserved invariant;
   - the persistent emergency affordance;
   - engine-first.
7. **Project docs, if present:** `DESIGN-medsync.md`, `CLAUDE.md`, `MASTER-BUILD-ROADMAP.md`, the handling-flow and entry-points docs, and the scheduling PRD.

---

## 2. Triage: the existing engine, and only the existing engine

| Rule                                      | What it means here                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 **No new triage logic**                | No scale, score, threshold, level, re-check interval or danger-sign list is written outside the engine. UI code holds no vital-sign numbers. A guard enforces this (Appendix C).                                                                                                                                                                                             |
| T2 **One call**                           | The triage panel builds the engine's own input type from the form and calls the engine's public entry point. The level, reasons, NEWS2, TEWS, hourly or re-check flag, and recommendations shown are the engine's output, unmodified.                                                                                                                                        |
| T3 **Step 1 is the engine's Step 0**      | The life-threat list and its wording come from the engine's signed list. Any sign present yields the engine's L1 path, which opens the existing Resus Desk entry, and the patient leaves this queue.                                                                                                                                                                         |
| T4 **Levels from the catalogue**          | Do not hardcode L1 to L4. Read the levels, labels and their token mapping from the engine's level catalogue (confirm at Step 0 whether a fifth level exists). Each level renders as dot, label and colour word, never colour alone.                                                                                                                                          |
| T5 **Per-sign tags come from the engine** | The amber and red tags on observation inputs show the engine's own per-parameter result (for example a NEWS2 parameter score), passed through. If the engine does not expose a per-parameter breakdown, report it at STOP 0. The fix is an output projection of values the engine already computes, with no rule change and CSO sign-off. Until then, show no per-sign tags. |
| T6 **Override is the engine's override**  | Use the existing override path: a reason is required, it is audited, and the engine records the original level. The reason chips are strings in `content/clinic-floor/`.                                                                                                                                                                                                     |
| T7 **Re-checks come from the engine**     | Who needs repeat observations, and how often, is the engine's flag (NEWS2 response bands). A re-check runs the same engine call. If the level rises, the patient moves up the line and the doctor is told. If it falls, the move is recorded and shown.                                                                                                                      |
| T8 **Recommendations are suggestions**    | Render the recommendations layer's output as "suggested", never as orders. Its pending-intent seam is not executed here.                                                                                                                                                                                                                                                     |
| T9 **Gaps are reported, not patched**     | If the engine lacks something the canvas shows (for example a "because" list in plain words), STOP and report. Add only a projection or formatting of existing output, never a rule. Otherwise hide the element.                                                                                                                                                             |
| T10 **Parity test**                       | For 200 seeded random observation sets and every Step 0 sign, the panel's displayed level, reasons and scores equal a direct engine call. Run it in CI.                                                                                                                                                                                                                      |

---

## 3. Laws (each gets a test where one is possible)

| #    | Law                                        | On the floor                                                                                                                                                                                                             |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CF1  | **Engine-first.**                          | Step 2 lands missing pieces before any screen uses them. Triage obeys Section 2.                                                                                                                                         |
| CF2  | **Queue honesty** (ADR 0084).              | Staff see order and waits, labelled "staff only". The waiting-room screen, SMS and tickets show no position, count ahead, wait or promised time. The screen shows booking codes and room names only.                     |
| CF3  | **Red is emergency only.**                 | Red is used for the Emergency button, the pre-alert pill, danger signs (Step 1), the engine's top level, and critical errors.                                                                                            |
| CF4  | **Amber is clinical caution.**             | Amber is used for engine-flagged observations, re-checks due, out-of-band results, the slowest step and desk flags. It is never decoration.                                                                              |
| CF5  | **No wait-time targets until signed.**     | With no signed wait targets per level, there are no "late" colours by threshold. Only relative cues are allowed: the wait bar against the longest wait, and "slowest step".                                              |
| CF6  | **Desk flags are hints, not levels.**      | The keyword hint ("Desk: chest symptoms") only orders the worklist (Look at first). It never sets, raises or displays a level. The keyword list lives in `content/clinic-floor/` and is signed.                          |
| CF7  | **Minimum necessary data** (DPPA 2019).    | Privacy mode (H) hides reasons, blurs photos and hides trends on shared screens. No PHI goes in URLs, logs, analytics or the screen feed.                                                                                |
| CF8  | **Emergency on every screen.**             | The red Emergency control is in the top bar at every width; `E` opens it.                                                                                                                                                |
| CF9  | **Audit every state change.**              | Audit triage, override, re-check, send to line, call, call again, didn't come, here, doctor status, sent for tests, back with results, finish, follow-up booked, running late, end session and user switch. Append-only. |
| CF10 | **Role isolation.**                        | Desk cadres see no observations or clinical notes. Nurses see triage data. Doctors see the visit brief. Every new table gets RLS probes, including cross-tenant probes.                                                  |
| CF11 | **One patient, one place.**                | A patient appears once on the floor, in one step (from the flow projection). A property test checks there are no disappearances and no duplicates.                                                                       |
| CF12 | **Plain words, tokens only, WCAG 2.2 AA.** | Strings come from `content/clinic-floor/`. Lint for raw colours. No left-edge accent bars. Lagoon marks the one main action per view (Start triage, Call next, Finish visit). Clinics show as dot plus name.             |

---

## 4. The floor, by area (the canvas is the visual spec)

| Area                    | Must do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Notes                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Placement**           | Route `/clinic` (or what Step 0 finds) with views Triage, Clinic line and Floor. Default view by role: nurse → Triage, doctor → Clinic line, in-charge → Floor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | GATE A D-CF-01 decides whether the clinic line is a lane of the Doctor Workspace or its own route sharing components.                                                 |
| **Shell**               | The reception shell, adapted. The today card shows for triage / in the line / seen with a progress bar. Nav: Triage (count · due), Clinic line, Floor, Emergency (while a pre-alert is active). Clinics today: tick rows with "in line" counts. The user dock has role and switch user. Top bar: Triage / Clinic line / Floor, pre-alert pill, search and Emergency.                                                                                                                                                                                                                                                                                                           | Tablet opens in rail; phone uses a drawer. Only lists scroll; the page never scrolls sideways.                                                                        |
| **Triage worklist**     | Header shows waiting, longest wait, "clear by about" (waiting × the measured median triage time, never a fixed number) and done today. **Next up** card: the first desk-flagged patient, else the longest wait. It shows their words, clinic, wait, needs and the one lagoon "Start triage". **Re-check card** beside it when any re-check is overdue. Tabs: Waiting / Re-checks / Triaged today. Groups: "Look at first" (desk flags), then "In order of arrival". Each row shows who, their words, wait with a relative bar, clinic · doctor, flags and a quiet Triage button.                                                                                               | Hide the Next up and re-check cards while the panel is open.                                                                                                          |
| **Triage panel**        | Booked for, why, waiting, needs. Step 1: the engine's life threats, or "None of these". Step 2: observations in the engine's input type (BP, pulse, RR, SpO₂, temperature, consciousness, mobility, on oxygen, injury; optional blood glucose; weight). Per-sign tags follow T5. Step 3: level, because, NEWS2 / TEWS, recommendations, override with reason, "Open resus" on the top level. Step 4: send to (clinic, doctor, note to the doctor). Re-check mode shows the last values and keeps the patient in the line.                                                                                                                                                      | The send button names the destination. Implausible values ask to confirm, using the engine's plausibility check if it exists (otherwise report).                      |
| **Clinic line: header** | Clinic, room, hours, seen, in line, typical visit length (measured). Doctor status: In room / Short break (10, 15, 30 min) / Called away. Anything but In room pauses calls and tells the desk and the screen, with no time promised. Buttons: Screen, Running late, End session.                                                                                                                                                                                                                                                                                                                                                                                              |                                                                                                                                                                       |
| **With you**            | Identity strip, visit timer, allergy banner (recorded / none known / not recorded, "ask them"), history and medicines, why they came, triage result with vitals, **trends**, before today, and actions: Send for tests, Open their record (clinician workspace), Finish visit.                                                                                                                                                                                                                                                                                                                                                                                                 | The record itself (clerking, orders, prescribing) stays in the clinician workspace.                                                                                   |
| **Trends**              | One row of compact cards that scrolls sideways (snap, thin scrollbar). An All / Vitals / Labs switch appears when labs exist. Vitals cards: BP (systolic and diastolic), weight, triage sugar (random). Lab cards: HbA1c; glucose by time of day with Fasting / Before lunch / 2 h after meal / Bedtime chips; lipid profile with LDL / Total / HDL / Triglycerides chips. Each card shows the latest value, an In / Above / Below target badge, change since first, a thin line with the target band shaded, and out-of-band dots in amber. Hover, focus or tap on a visit swaps the headline to that visit's value and date, with a guide line. Leaving restores the latest. | Bands are drafts (D-CF-08), held per clinic in signed content, not in code. Glucose readings carry their timing context; untimed readings never enter a timed series. |
| **Calling**             | Call next (N) takes the first of the line order (D-CF-02). The calling card shows "called N min ago", text sent, code on screen, call count. Actions: "He's/She's here" (starts the visit), Call again, Didn't come (D-CF-04). The toast tells the doctor the patient's needs (wheelchair, interpreter). **Pre-visit brief** beside it: allergy, background, triage level and reasons, vitals, nurse's note, last visit, needs, waited.                                                                                                                                                                                                                                        | Calls are blocked while the doctor is not In room.                                                                                                                    |
| **The line**            | Grouped and ordered by D-CF-02. Each row shows who, wait, level and flags (needs, re-check due or in N min, results ready) and a Call button. "Away for tests" lists people at the lab; a result released by the lab workflow returns them with "results ready".                                                                                                                                                                                                                                                                                                                                                                                                               | Order is staff-only. Reorders never shift rows under the pointer (hold, "N updates · Show").                                                                          |
| **Finish visit**        | Outcome: going home / pharmacy, then home / tests, then back to me / admitted / referred. Follow-up: presets; the day comes from that clinic's running days; who sees them; why; SMS. A follow-up ticket comes from the booking engine and the shared `Ticket`.                                                                                                                                                                                                                                                                                                                                                                                                                | One booking, one code, one SMS; duplicates warned.                                                                                                                    |
| **Floor**               | **Flow strip:** Triage → In line → Called → With doctor → At tests → Done, each with count and longest time in step; "slowest step" is relative (CF5); tap filters. **Clinic × step table:** clinic, rooms, doctors and status; cells show count, longest wait and face stack; tap filters. **List:** everyone on the floor, full names, clinic, where (doctor, test, outcome), step, level, flags, time in step; "Show everyone". **Needs a hand:** overdue re-checks, top-level patients still waiting, results back, longest triage wait, wheelchair or interpreter needs, each with one action.                                                                            | In-charge default view. Stacks under 1100 px; the table scrolls sideways on phone.                                                                                    |
| **Waiting-room screen** | Now calling (code, room), recently called, a paused line when the doctor is away. No names, no positions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A PHI-free feed; it works on a TV browser.                                                                                                                            |
| **Other**               | End session (move remaining, hand over, mark didn't wait), Running late (optional SMS), Emergency and pre-alert, keyboard sheet (?), toasts with Undo, offline banner, first-run empty states, switch user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                       |

---

## 5. Engine and data scope (Step 2; confirm each at Step 0, add only what is missing)

| Capability            | Expected shape                                                                                                                            | Tests                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Flow projection       | One step per patient-visit (triage, line, called, with, lab, done) from existing events; reuse the Doctor Workspace projection if present | no duplicates or disappearances (property test)            |
| Line order            | Pure function over the projection and engine levels (D-CF-02)                                                                             | table-driven, ties by arrival                              |
| Triage record         | Engine input, engine output, override, actor, time, as the engine already persists                                                        | **no schema change to engine tables** without CSO sign-off |
| Re-check schedule     | Derived from the engine's response flag; next-due time per patient                                                                        | due and overdue boundaries                                 |
| Call events           | called_at, count, by, room; here; didn't come with count                                                                                  | idempotent by client id; didn't-come rule                  |
| Doctor session status | in / break(until) / away, per session                                                                                                     | pauses calls; feeds desk and screen                        |
| Tests round-trip      | Sent-for-tests event; result-released event from the lab workflow returns the patient with `results_ready`                                | no PHI in the event payload                                |
| Trends read model     | Vitals observations and lab results by code (HbA1c, glucose with context, lipid panel), per patient, ordered by date                      | units; context required for timed glucose                  |
| Visit outcome         | Outcome, follow-up booking via the booking engine, SMS enqueue                                                                            | one booking, one SMS                                       |
| Screen feed           | code, room, called_at, paused flag                                                                                                        | contains no name, phone or position                        |
| Floor metrics         | Counts, longest time in step, median triage and visit time, all computed and never typed                                                  | fixture equality                                           |

RLS on every new table. Nurse, doctor, in-charge and desk access are limited to their hospital and role (CF10).

---

## 6. Steps and gates

The `clinicFloor` flag: off serves the current pages, on serves the floor. It is deleted at Step 8.

**Step 0: Discovery (no product changes).**

- Q1: the triage engine's public API, input and output types, level catalogue (L5?), override path, re-check flag, per-parameter output, recommendations output; file:line for each.
- Q2: which Section 5 rows exist.
- Q3: Doctor Workspace projection, triage sheet and lanes status.
- Q4: reception shell and `Ticket` status.
- Q5: current triage and clinic pages with a parity crawl (every control by role and name).
- Q6: baselines at 1440, 834, 390 (screens, axe, first-load JS, INP on a 300-row worklist).
- Q7: Playwright, axe, harness and fake clock are working.

**STOP 0.**

**Step 1: GATE A proposal (documents).** `docs/clinic-floor/gate-a-proposal.md` contains:

- the route map and 308s;
- the component list with reuse;
- the engine-gap list, with any triage gap stated as projection-only;
- every string and band in `content/clinic-floor/` as `draft`;
- the Section 11 table with a signature block;
- the test plan;
- ADR drafts.

**STOP 1.** Nothing proceeds without signatures.

**Step 2: Data and engine gaps.** Migrations, RLS, server actions, Zod, audit and tests for missing Section 5 rows. No UI, and **no change to triage scoring or rules**.

- **S1** RLS probes (cross-tenant; desk vs observation columns).
- **S2** call and check-in events are idempotent under replay.
- **S3** the screen feed and SMS carry no PHI or position.

**STOP 2.**

**Step 3: Shell.** Reuse the reception shell, then add the views, role defaults, doctor status and shortcuts.

- **S4** Emergency is visible and named at 1440, 1024, 834 and 390 in both themes.
- **S5** shortcuts fire only outside inputs; Esc closes the top layer.

**STOP 3.**

**Step 4: Triage worklist and panel.**

- **S6** the T10 parity test is green.
- **S7** a Step 1 sign opens resus and removes the patient from the queue.
- **S8** override requires a reason and is audited with the original level.
- **S9** a re-check that raises the level moves the patient up and notifies the doctor.
- **S10** the guard finds no vital-sign thresholds outside the engine.
- **S11** desk flags order the worklist and never touch a level.
- **S12** "clear by about" uses the measured median.

**STOP 4.**

**Step 5: Clinic line.** Header, status, with you, calling, brief, line, tests round-trip, finish visit, running late, end session.

- **S13** calls are blocked when not In room; the desk and screen show the pause.
- **S14** line order equals D-CF-02 on a fixture.
- **S15** a lab release returns the patient with results ready.
- **S16** finish creates one booking, one code and one SMS.
- **S17** the didn't-come rule.

**STOP 5.**

**Step 6: Trends.**

- **S18** values equal the read model.
- **S19** bands come from content; unsigned bands render with "draft" in dev builds only.
- **S20** hover, focus and tap all swap the headline; keyboard reaches every point.
- **S21** untimed glucose never appears in a timed series.
- **S22** the row scrolls sideways with no page scroll at 390.

**STOP 6.**

**Step 7: Floor and waiting-room screen.**

- **S23** flow and table counts equal the projection.
- **S24** "slowest step" and the list order are correct on a fixture.
- **S25** every Needs a hand item opens the right place.
- **S26** the screen feed guard passes; the screen runs 8 h with no memory growth over 20 %.

**STOP 7.**

**Step 8: Offline, parity, cutover, harden.**

- **S27** offline (D-CF-12): triage saves queue on the device, run the engine locally, survive a reload and sync once; calling needs a connection.
- Parity report signed.
- Flag on for one pilot clinic for 2 days.
- Delete the old pages, components and flag; keep the 308s.
- axe, guards and budgets.
- `docs/clinic-floor/REPORT.md` with Section 9 filled.

**STOP 8.**

---

## 7. Parity

Every control from the Step 0 crawl is reachable on the floor, or listed in `tests/parity/clinic-floor/renames.json` with a reason Fadhul signs.

## 8. Budgets

| Measure                                  | Budget                                   |
| ---------------------------------------- | ---------------------------------------- |
| First-load JS for the floor route (gzip) | ≤ 170 KB; report                         |
| INP, 300-row worklist and floor list     | ≤ 200 ms                                 |
| Triage panel: last field to level shown  | ≤ 100 ms (engine is pure; no network)    |
| CLS                                      | ≤ 0.05 (timers and counts reserve width) |
| Server action p95                        | ≤ 300 ms                                 |
| axe serious or critical                  | 0, all widths, both themes               |
| Horizontal page scroll at 390            | 0                                        |
| Guards (Appendix C)                      | 0 failures                               |

## 9. Numbers to report at the final STOP

Baseline vs result for each Section 8 row, plus:

- key presses from Start triage to Send (normal adult);
- taps to call, start and finish a visit;
- T10 parity (must be 100 %);
- triage numbers outside the engine (must be 0);
- parity items lost (must be 0);
- strings outside `content/clinic-floor/` (must be 0).

---

## 10. Accessibility

- WCAG 2.2 AA at 1440, 1024, 834 and 390, in both themes.
- Dialogs trap and return focus.
- Tabs, segments and chips expose `aria-selected` or `aria-pressed`.
- Lists and the table are real lists or grids with named cells.
- Every trend point is reachable by keyboard, with a full-text label ("Blood pressure, 2 Sep: 122/78 mmHg").
- Live regions are polite. A new pre-alert and a call are assertive and rate-limited.
- Never colour alone; levels always carry their word.
- Targets ≥ 44 px (48 on phone); inputs ≥ 16 px.
- Reduced motion: no pulses, no slides.

---

## 11. GATE A decisions (Fadhul owns; recommendations given)

| #       | Decision                          | Recommendation                                                                                                                                                                                                                                                                                                        |
| ------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-CF-01 | Clinic line placement             | A lane of the Doctor Workspace if built; otherwise its own route sharing the same components. One code path either way.                                                                                                                                                                                               |
| D-CF-02 | Line order                        | By engine level (most urgent first), then back from tests before the lowest level, then arrival. Staff only.                                                                                                                                                                                                          |
| D-CF-03 | Waiting-room screen               | Booking codes and room names only; a paused line when the doctor is away; no names, waits or positions.                                                                                                                                                                                                               |
| D-CF-04 | Didn't come                       | First time moves them to the end of their group; second time ends the visit as "didn't wait", and the desk is told.                                                                                                                                                                                                   |
| D-CF-05 | Wait targets                      | None until signed from the triage reference. Relative cues only (CF5). The long-wait flag stays parked.                                                                                                                                                                                                               |
| D-CF-06 | Desk keyword flags                | Chest, breathing, bleeding, fainting or drowsy, fits, severe pain. A hint only; CSO signs the list and wording.                                                                                                                                                                                                       |
| D-CF-07 | Per-sign tags on observations     | From the engine's per-parameter output only (T5); none until exposed.                                                                                                                                                                                                                                                 |
| D-CF-08 | Trend target bands (draft)        | BP < 140/90; random glucose 4–10; HbA1c < 7 %; fasting and before lunch 4.4–7.2; 2 h after a meal < 10; bedtime 5.6–7.8; LDL < 2.6; total cholesterol < 5.2; HDL ≥ 1.0 (men) / ≥ 1.3 (women); triglycerides < 1.7 (all mmol/L). Per clinic, editable by the clinic lead after CSO sign-off. Individual targets later. |
| D-CF-09 | Doctor status                     | Shown to the desk and on the screen as "short break" or "called away", with no time promised to patients.                                                                                                                                                                                                             |
| D-CF-10 | Spoken calls                      | Parked until signed audio and languages exist.                                                                                                                                                                                                                                                                        |
| D-CF-11 | Who triages and overrides         | Nurses and clinical officers triage; overriding to a lower level needs a clinician cadre per the engine's existing override rules.                                                                                                                                                                                    |
| D-CF-12 | Offline scope                     | Triage entry and results run offline (pure engine, encrypted local queue, idempotent sync). Calling, finishing and booking need a connection. "Print today's line" works offline.                                                                                                                                     |
| D-CF-13 | Engine levels                     | Use the engine's catalogue as is, including L5 if it exists. No renaming in UI.                                                                                                                                                                                                                                       |
| D-CF-14 | Top level → resus                 | Opens the existing Resus Desk entry with the triage record attached.                                                                                                                                                                                                                                                  |
| D-CF-15 | Tests round-trip                  | A result release returns the patient to the same doctor's line, flagged "results ready", ahead of the lowest level.                                                                                                                                                                                                   |
| D-CF-16 | Privacy mode on shared screens    | On by default for the tablet triage station between patients.                                                                                                                                                                                                                                                         |
| D-CF-17 | Follow-up from the doctor         | Through the booking engine and `Ticket`, with SMS in English at launch.                                                                                                                                                                                                                                               |
| D-CF-18 | "Clear by about" and visit length | Computed from today's medians, shown only after 3 completions, otherwise hidden.                                                                                                                                                                                                                                      |

## 12. ADRs (next free numbers)

- Clinic floor views and placement.
- The triage UI is a pure consumer of the triage engine (no rules outside `lib/triage`).
- Line-order rule.
- Waiting-room screen feed under ADR 0084.
- Doctor session status.
- Trends read model and signed bands as content.
- Offline triage queue.

## 13. Out of scope

- Any change to triage scoring, levels, thresholds or re-check rules.
- The visit record (clerking, orders, prescribing).
- Lab and pharmacy workflows beyond the two events.
- Wait-time targets and the long-wait flag.
- Spoken calls.
- Paediatric triage views (the engine's paediatric paths stay untouched; adults only at launch, as on the desk).
- Patient app screens.
- SMS provider work.

## 14. Definition of Done

- [ ] GATE A signed; ADRs written.
- [ ] Section 2 holds: T10 parity 100 %; guard finds 0 triage numbers outside the engine.
- [ ] Laws CF1 to CF12 hold, each with its test.
- [ ] Every area in Section 4 and every item in Appendix B works by mouse, touch and keyboard at 1440, 1024, 834 and 390, both themes.
- [ ] Data gaps closed with RLS and tests.
- [ ] Parity signed; old pages, components and flag deleted; 308s kept.
- [ ] Budgets met; axe clean; guards green.
- [ ] Strings and bands in `content/clinic-floor/` as `draft`; no `*_COPY_STATUS` edited.
- [ ] `docs/clinic-floor/REPORT.md` with Section 9 and screenshots.

---

## Appendix A: Seed data for tests and screenshots

Port the canvas's _Busy morning_ as a fixture. Use invented names only. Engine levels are **computed by the engine from the seeded observations**, never seeded directly.

| Group              | Who                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Clinics            | General OPD (Dr. Namata, Dr. Kiggundu), Diabetes, Antenatal, Hypertension                                              |
| Waiting for triage | 7 people, including John Okello (desk note mentions chest tightness) and needs such as a wheelchair and an interpreter |
| In the line        | 9, including Joseph Kato (low SpO₂, re-check overdue) and Mercy Atim (most urgent level)                               |
| At tests           | Fatuma, whose result releases during the session                                                                       |
| With a doctor      | Godfrey (General OPD) and Sylvia Kemigisha (Diabetes, with HbA1c, timed glucose and lipid history)                     |
| Done               | 4                                                                                                                      |
| Other              | Peter Ssali with a lipid profile and fasting glucose; two pre-alerts                                                   |

_First run_ and _Offline_ are scenarios of the same fixture.

## Appendix B: Interaction checklist (from the canvas)

| Area        | Interactions                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell       | Sidebar rail and drawer; switch user and role; dark mode; privacy (H); keyboard sheet; Emergency.                                                                                                                                                                                                                        |
| Triage      | Next up start; re-check card; tabs; Look at first group; row Triage; Step 1 none / sign → resus; observations with consciousness, mobility, oxygen, injury, glucose; engine result; override with reason; send to clinic and doctor with note; re-check mode up and down.                                                |
| Clinic line | In room / break (10, 15, 30) / away; Call next (N); here, call again, didn't come; brief; with-you timer; allergy states; trends (tabs, chips, hover, focus, tap, sideways scroll); send for tests; result return; finish visit (each outcome, follow-up day, who, why, SMS, ticket); running late; end session; screen. |
| Floor       | Flow step filter, table cell and clinic filter, show everyone, list open, each Needs a hand action.                                                                                                                                                                                                                      |
| Everywhere  | Toast Undo; offline banner.                                                                                                                                                                                                                                                                                              |

## Appendix C: Guards

| Guard                           | Rule                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Triage logic only in the engine | Outside `lib/triage/**`, no file implements or imports scoring internals. Components may import only the engine's public entry and types. A scan of floor components finds no vital-sign threshold literals (for example 90, 91, 92, 96, 110, 130, 140, 219, 220 next to a vital name) or NEWS2 or TEWS band tables. |
| Engine parity                   | T10 test in CI.                                                                                                                                                                                                                                                                                                      |
| Red reserved                    | Emergency tokens only in the components listed in CF3.                                                                                                                                                                                                                                                               |
| Queue honesty                   | Screen feed, SMS and ticket templates fail on a name, a position, "ahead of you", "#N" near line or queue, a wait, or an hour promise.                                                                                                                                                                               |
| Bands are content               | No target band literals in components; all from `content/clinic-floor/`.                                                                                                                                                                                                                                             |
| No dose                         | The standard no-dose regex finds nothing in `content/clinic-floor/`.                                                                                                                                                                                                                                                 |
| No PII in logs and URLs         | Request logs, analytics, URLs and the screen feed contain no name, phone, code with name, or clinical value.                                                                                                                                                                                                         |
| Raw colour                      | No hex, rgb, hsl or font family in components.                                                                                                                                                                                                                                                                       |
| No left-edge accent bars        | No coloured left border as a status marker.                                                                                                                                                                                                                                                                          |
| Emergency everywhere            | A visible, named Emergency control on every floor view at every width.                                                                                                                                                                                                                                               |
| Shortcuts off in inputs         | Typing in any input never triggers N, F, H, E, 1 to 3, [ or ?.                                                                                                                                                                                                                                                       |
