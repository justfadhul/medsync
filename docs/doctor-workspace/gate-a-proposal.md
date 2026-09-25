# Doctor Workspace — GATE A proposal

**Status:** adopted on the owner's instruction "go through all gates" (2026-09-24). Every decision below is built as
recommended and ships **dark** behind `DOCTOR_WORKSPACE`. The rules that change what a clinician is shown about a
patient's clinical state — D2 (death), D3 (idle), D4 (wait targets), D9 (old L1), D11 (re-triage) — need the CSO's
signature in §9 before the flag is set for any hospital.

Inputs: `PROMPT-DOCTOR-WORKSPACE-UNIFIED.md` (this folder), STOP 0 in `STOP-REPORTS.md`, `DESIGN-medsync.md`, ADR 0097
(plum = place), resus v2 (ADRs 0102–0111).

## 1. What changes

One page, `/doctor`, replaces Triage, Assigned, Encounters and the Resus board as the place a doctor starts and comes
back to. Each patient is **one row, in one lane, with one next step**. Underneath, a pure projection
(`lib/workspace/flow.ts`) reconciles intakes, triage records, assignments (`planned` encounters), encounters, resus
episodes and deaths into that row. The work surfaces stay what they are: the triage desk (now also a sheet over the
board), the clerking page (gains a rail and a "next patient" offer) and the resus desk (unchanged).

Flag off, the four old pages render exactly as today. Flag on, their URLs redirect (307) into a lane.

## 2. Design plan (frontend-design pass, inside DESIGN-medsync.md)

| Axis               | Choice                                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour             | Neutral ground (`background`, `card`, `border`), **teal** for every action, **plum** only for the active nav item and the page atmosphere, **red** only where Law 6 allows (arrest banner and its lane marker, L1 chips, the header's Emergency). Every warning is **amber**. Record states grey. |
| Acuity             | One chip for the board: level + colour word ("L2 Orange"). L1 uses the `status-critical` pair (#DC2626); L2 orange, L3 yellow, L4 green, L5 blue — each with its word, never colour alone.                                                                                                        |
| Type               | Fraunces H1 (500) once, in the page header. Everything else Geist: patient names `text-body-m` 500, detail `text-body-s`, MRN and clocks mono tabular. Lane headings are sentence-case `text-heading-s` with a mono count — the same as the resus v2 board, so one header style serves both (W9). |
| Layout             | Desktop ≥ 1280: board + a sticky 360 px patient panel. 768–1279: board + panel as a right drawer. < 768: rows of 2–3 lines, the panel a full-screen sheet, a docked "Start next" bar.                                                                                                             |
| Motion             | Almost none — this is used hundreds of times a day. Lane switch, selection and panel swap are instant. The drawer and phone sheet use the existing Sheet (250 ms expo-out). The held-updates pill fades in 150 ms. Buttons use `tap` (scale 0.96 on press). Reduced motion: no movement.          |
| The one bold thing | The arrest banner: the only red band on the page, pinned above the lanes while an arrest runs. Everything else is quiet.                                                                                                                                                                          |

Review against the brief — defaults removed: no card-per-patient grid (a list reads faster and holds 44 px rows), no
all-caps lane labels (the resus board already uses sentence case), no coloured left bars (project rule), no
row entrance stagger (a live list would replay it on every refresh), no second board style for resus.

## 3. Wireframes

### 3.1 Desktop ≥ 1280, All, Mine

```
┌ sidebar ──────┬ board ──────────────────────────────────────────────────┬ patient panel (360, sticky) ─┐
│ MedSync       │ TEST HOSPITAL-1 · INTERNAL MEDICINE            (Emergency)│ Patient Seven-7              │
│ Test Hosp-1   │ Workspace                                                │ 45 y · Female · MS-2026-00012│
│               │ [Mine | Department]   [ Find patient · MRN or name  ⌘K ] │ L2 Orange · triaged 10:28    │
│ ▣ Workspace   ├──────────────────────────────────────────────────────────┤   by Nurse A                 │
│ ☺ Patients    │ ▌Cardiac arrest · Patient Three-3 76 y · A+ 06:42 · [Join]│ Chest pain                   │
│ ▦ Schedule    │  (red band, only while an arrest runs)                   │                              │
│               │ [All 14] [Resus 1] [To triage 2] [Unassigned 1]          │ [ Start ]   ⋯                │
│               │ [Waiting 3] [In progress 1] [Needs closing 2] [Done 4]   │                              │
│               │                                                          │ Today                        │
│               │ Resus 1                                                  │ 10:12 Arrived · walk-in      │
│               │  L1 Red  Patient Three-3 · 76 y M · MS-2026-00004        │ 10:28 Triaged L2 · Nurse A   │
│               │          Survey · C threatened · Leader you  T+ 12 min [Open desk] ⋯ │ 10:29 Assigned to you  │
│               │ To triage 2                                              │                              │
│               │  —      Patient Five-5 · 34 y F · MS-2026-00009          │ Also open                    │
│               │          Fever · walk-in              waiting 18 min [Triage] ⋯     │ Encounter 7 Jul · no      │
│               │ Waiting for you 3                                        │  activity 11 w  [Continue]   │
│               │  L2 Orange Patient Seven-7 · 45 y F · MS-2026-00012      │           [Complete]         │
│               │          Chest pain · 1 old encounter  waited 42 min [Start] ⋯     │                  │
│               │ In progress 1                                            │                              │
│               │ Needs closing 2                                          │                              │
│               │  —      Patient Two-2 · 26 y M · MS-2026-00003           │                              │
│               │          Died 11:06 · 6 open items                [Review]  │                          │
│               │ Done today 4 ▸                                           │                              │
└───────────────┴──────────────────────────────────────────────────────────┴──────────────────────────────┘
```

Row anatomy (two lines, ≥ 44 px): acuity chip · **name · age sex · MRN** / reason · stage detail · badges · time in
stage (elapsed; neutral until a signed target exists) · primary button · ⋯. Selecting a row (click, Enter, j/k) opens
the panel; `?patient=` in the URL.

### 3.2 Single lane (Waiting for you) and Department scope

Same list, one section. Department scope adds the owner under the stage detail ("Dr Okello") and shows other
clinicians' items without a primary button (they act on their own board).

### 3.3 Tablet (768–1279)

Board full width; the panel opens as a right drawer (Sheet, 420 px), Esc and back close it.

### 3.4 Phone (< 768)

```
┌───────────────────────────────┐
│ Workspace     🔍  (Emergency) │
│ ▌Arrest · Three-3 · A+06:42 Join│
│ [All][Resus 1][To triage 2][W…│  ← chips scroll sideways
├───────────────────────────────┤
│ Waiting for you 3             │
│ L2 Orange Patient Seven-7     │
│ 45 y F · MS-2026-00012        │
│ Chest pain · waited 42 min    │
│                     [ Start ] │
├───────────────────────────────┤
│ [ Start next: Seven-7 · L2 ]  │  ← docked, only while Waiting > 0
└───────────────────────────────┘
```

Tapping a row opens the full-screen patient sheet; every button is ≥ 44 px.

### 3.5 Triage sheet — result state

```
┌ Triage result ───────────────────────────────────────────┐
│ Patient Five-5 · 34 y F · MS-2026-00009                  │
│ L2 Orange — very urgent                                  │
│ Why: RR 28 · SpO₂ 91% on air                             │
│                                                          │
│ [ Take & start ]   [ Assign to… ]   Back to board        │
└──────────────────────────────────────────────────────────┘
```

L1 or a Step-0 life threat: the first button is **Open resus**; Take & start stays beside it (decision support,
never a block). Reload on `/doctor/triage/<id>` lands on the full triage page.

### 3.6 Next patient (encounter page, after End visit)

```
Visit ended 11:52 · Patient Seven-7
Next waiting for you: Patient Nine-9 · L3 Yellow · waited 25 min      [ Start ]   Back to workspace
```

### 3.7 Needs closing — the panel's "Also open"

```
Patient Two-2 · 26 y · Male · MS-2026-00003       Died 11:06 (resus, Dr X)
Also open (6)
  Intake · triaged L2 · 22 Sep                     [Close intake…]
  Assignment · L4 · assigned to you 10 Sep          [Retire…]
  Encounter · opened 5 Jun · no activity 16 w       [Continue] [Complete]
  Encounter · opened 7 Jul · no activity 11 w       [Continue] [Complete]
  Resus · no activity 13 d                          [Open desk] [Close…]
  …
```

Every action is one that already exists (Close intake = `ha-cancel-intake`, Complete = End visit, Close… = the resus
close-out) except **Retire assignment** (D5). The workspace never closes anything by itself.

### 3.8 Deceased row

Lives only in Needs closing, with the neutral chip **Died 11:06**. No Triage, Take or Start as the primary. The
overflow keeps "Start encounter…", which asks: _"Recorded as died at 11:06 (resus). Continue anyway?"_ with a
required reason, written to the audit log.

## 4. Lanes and precedence (FW-2)

`lib/workspace/lanes.ts` — the registry (id, label, scope, order, who sees it, hotkey). First matching rule wins,
per patient:

| #   | Rule (first match)                                                        | Lane            | Primary                        |
| --- | ------------------------------------------------------------------------- | --------------- | ------------------------------ |
| 1   | A death is recorded and the patient still has an open item                | Needs closing   | Review                         |
| 2   | A resus episode in arrest, active or boarding (not idle)                  | Resus           | Open desk                      |
| 3   | My encounter is open and has activity inside the idle window              | In progress     | Continue                       |
| 4   | Current acuity L1, older than the resus board's 24 h lookback, no episode | Needs closing   | Review                         |
| 5   | A planned encounter assigned to me                                        | Waiting for you | Start (Open resus if fresh L1) |
| 6   | An intake awaiting triage                                                 | To triage       | Triage                         |
| 7   | A triaged intake with no assignment (viewer may assign)                   | Unassigned      | Take (Open resus if fresh L1)  |
| 8   | Only idle or contradictory items left                                     | Needs closing   | Review                         |
| 9   | An encounter I completed today                                            | Done today      | View                           |

Every open item that is not the row's primary item is listed in the panel's **Also open** and counted as a badge.

Worked examples (the 24 Sep fixture, `tests/workspace/screenshot-24-sep.test.ts`):

- **Patient Two-2** — resus concluded "died" 11:06, plus a triaged intake, an L4 assignment, two June/July encounters
  and three idle episodes. Rule 1 → one row, Needs closing, "Died 11:06", primary Review, six items under Also open.
- **MS-2026-00004** — three planned encounters (L1 5 Sep, L4 12 Sep, L1 20 Sep) and two idle encounters. Current
  acuity = the latest triage (L1, 20 Sep, 3 d old) → rule 4 → Needs closing, badges "3 assignments",
  "L1 · 3 d old", "2 old encounters".
- **Patient Five-5** — walk-in awaiting triage → rule 6 → To triage, primary Triage.
- **Patient Seven-7** — assigned to me today, L2 → rule 5 → Waiting for you, primary Start.

Sorting (FW-9): acuity L1→L5 (untriaged last), then longest in stage first. Resus keeps the board's order (arrest,
active, boarding). Needs closing puts deceased first.

## 5. Data changes

**One additive migration, `0069_doctor_workspace.sql`** (GATED, owner-applied):

1. `sa_audit_log` action CHECK + `retire_assignment`.
2. PHI-free broadcast triggers on `patient_intakes`, `triage_records`, `encounters` → private topic
   `workspace:<hospitalId>` with `{ kind, at }` only. Errors are swallowed (a realtime failure never blocks a write).
3. `realtime.messages` policy: active clinical staff of that hospital may listen to `workspace:<hospitalId>`.

**Nothing else in the schema.** In particular:

- **D2 without a column.** Death is read from the two records that already hold it (resus episode death /
  outcome / disposition; `encounters.disposition = 'deceased'`) by one query. A stored `deceased_at` would be a copy
  that can drift from the immutable resus record; it waits until a surface outside the workspace needs a cheap lookup.
- **D5 without a column.** The assignment _is_ a `planned` encounter; retiring one moves it to `cancelled` (an
  existing state) with `completion_reason = 'assignment_retired'`, an audit row and a reason, in one transaction.
- **D3 without a table.** The 24 h idle window is a constant, as resus v2 kept its idle thresholds (STOP 2 of that
  build). A per-hospital setting waits for a hospital that asks.

**Two code fixes at the root:**

- `assignDoctorFromIntake` reuses the visit's existing planned encounter (any triage record of the same intake)
  instead of inserting another, and re-points it to the latest triage. No new duplicates (D5, write side).
- `openEncounterFromTriage` stamps `started_at` when it starts a planned encounter, so time in stage is true.

**Legacy data: flag, never alter.** Existing duplicates, June/July encounters, stale L1s and idle episodes appear in
Needs closing for a person to act on.

## 6. Server actions

Reused: assign (`assignDoctorAction`), reassign (`reassignEncounterAction`), start
(`startEncounterFromTriageAction`), End visit (`completeEncounterAction`), open resus (`openResusFromIntake`), triage
submit, resus close-out. New, all `'use server'` + Zod + scope + audit:

| Action                    | Does                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `takePatientAction`       | Assign me (idempotent, reuses the visit's planned encounter) + start; audits `start_encounter`; → encounter |
| `startForWorkspaceAction` | Start, but a recorded death needs `overrideReason` (audited `start_encounter` with the reason) — Law 2      |
| `retireAssignmentAction`  | planned → cancelled with reason, audit `retire_assignment`, one transaction (needs 0069)                    |
| `closeIntakeAction`       | Thin wrapper over the existing `ha-cancel-intake` Edge Function (reason ≥ 8)                                |

## 7. Test plan

- `tests/workspace/flow.test.ts` — every FW rule ID, ≥ 60 cases.
- `tests/workspace/screenshot-24-sep.test.ts` — the fixture above (fails at STOP 0, passes at STOP 3).
- `tests/workspace/flow-property.test.ts` — seeded random sources: every patient exactly once, every open item a
  primary or in Also open.
- `tests/workspace/queries.test.ts` — round trips are the same for 1 and 50 patients (a counting fake `db`).
- `tests/workspace/actions.test.ts` — take, deceased start, retire, close intake (mocked data layer).
- `tests/workspace/migration-0069.test.ts` — the SQL is additive, payloads carry no PHI, the topic policy is scoped.
- `tests/rls/workspace-realtime.test.ts` — live topic authorisation (skips without a test project, like resus v2).
- `tests/workspace/pages.test.ts` — flag off: the four pages are unchanged; flag on: 307s with the lane kept.
- `tests/design/red-reserved.test.ts` — extended to the workspace tree.
- Scenarios S1–S10 as scripted tests over the engine and actions (no Playwright — Law 10).

## 8. ADR drafts

0113 Workspace replaces the four list pages (lanes, precedence, flag, redirects) · 0114 The patient flow projection
and the integrity report · 0115 Death is read from the records that hold it · 0116 Assignment supersession on the
planned encounter · 0117 Triage in a sheet (intercepting route) · 0118 Workspace live updates.

## 9. Decisions (owner: "go through all gates" — built as recommended)

| #   | Decision                          | Built as                                                                                                   |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| D1  | Name + MRN + age/sex on every row | Yes; names through `revealPatientIdentities` (one audit row per patient per load, fail closed)             |
| D2  | A patient-level death truth       | Yes, **derived** from the resus and encounter records (no column); corrections stay in those records       |
| D3  | Encounter idle threshold          | 24 h without activity; constant; nothing auto-closes                                                       |
| D4  | Wait targets per acuity           | None signed → elapsed time only, never coloured                                                            |
| D5  | Duplicate assignments             | Collapsed at read time; write-time reuse of the visit's planned encounter; legacy ones retired by a person |
| D6  | Navigation                        | Workspace · Patients · Schedule; SOON items hidden; Overview removed (flag on)                             |
| D7  | Default landing                   | Workspace, All, Mine                                                                                       |
| D8  | Unassigned + Department scope     | Whoever may assign today (`triage_patient` allowed)                                                        |
| D9  | Old L1 with no resus              | Needs closing, "re-triage or close"; the board's 24 h lookback                                             |
| D10 | Nurse workspace                   | Shell and registry cadre-agnostic; adoption is a later prompt                                              |
| D11 | Re-triage display                 | No such state exists: "Re-triage" is an action; the triage time and author show in the panel               |
| D12 | Clinic queue (Schedule's rail)    | Stays on Schedule; a later lane through the registry                                                       |
| E1  | Triage as a sheet                 | Intercepting route over the board; full page on reload                                                     |
| E2  | Live updates                      | Private broadcast from DB triggers (0069) + the resus board topic; 15 s polling when either is down        |
| E3  | Held reorders                     | Frozen while the list is hovered or focused; "N updates · Show"                                            |

**CSO signature (D2, D3, D4, D9, D11):**

| Signed by | Signature | Date |
| --------- | --------- | ---- |
| Fadhul    |           |      |

## 10. As built — where the build differs from this proposal or the prompt

| Proposed                                                                                 | Built                                                                                                        | Why                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ⋯ as an overflow menu on each row                                                        | ⋯ opens the patient panel, where every other action is a plain button                                        | A menu would repeat the panel with smaller targets on a phone; one place holds every secondary action                                                  |
| First focus stop in a row: the primary button (prompt §10)                               | The row body (it names the patient), then the primary, then ⋯; `s` runs the primary from anywhere in the row | A screen reader hears who before what                                                                                                                  |
| Tapping a badge opens the panel at that item (prompt §5.2)                               | Badges sit in the row body: a tap opens the panel at its top, where Also open follows the header             | One tap target per row body                                                                                                                            |
| Topic `workspace:<hospital>:<department>`, payload `{ patientId, kind, at }` (prompt §7) | Topic `workspace:<hospital>`, payload `{ kind, at }`                                                         | Every ping triggers a full scoped re-read, so a department topic or a patient id would add policy surface and a patient reference for nothing          |
| Sidebar count on Workspace: Waiting + Resus (prompt §5.2)                                | Not built                                                                                                    | It would run the projection in the layout on every doctor page; add it when the board read is cached per request                                       |
| `hospital_workspace_settings` (D3), `patients.deceased_at` (D2), `superseded_at` (D5)    | Not built (§5 above)                                                                                         | A constant; the records that hold death; the existing `cancelled` state with a reason                                                                  |
| `takePatient({ patientId, visitId })` in one transaction, returning `{ id, serverTime }` | `takePatientAction({ intakeId })` chains the existing assign and start, then redirects to the encounter      | The intake is the visit. Two existing audited actions, not a copy of them; a failure after the assignment leaves the patient clearly assigned (tested) |
| `startEncounterForDeceased`                                                              | `startForWorkspaceAction` wraps the existing start with `overrideReason`, audited first                      | The prompt's own fallback: extend, don't duplicate                                                                                                     |
| One page header for the workspace and the resus desk (W9)                                | The workspace only                                                                                           | The resus desk's sticky bar is resus v2's, signed off in ADR 0111                                                                                      |
| Drawer 420 px (768–1279)                                                                 | Sheet up to 440 px below 1280 px, full screen on phones                                                      | Room for the panel's two-button rows                                                                                                                   |
| Scripted scenarios and a fixture render (no Playwright)                                  | As proposed, plus axe, screenshots and timings over the DevTools protocol against a local production build   | Law 10; the method resus v2 used                                                                                                                       |
| Department scope for whoever may assign (D8)                                             | As proposed, enforced in the query layer; colleagues' items read-only (FW-11)                                | —                                                                                                                                                      |
| Live region for new waiting patients and moves into Resus (prompt §10)                   | Added in hardening (`lib/workspace/changes.ts`)                                                              | —                                                                                                                                                      |
