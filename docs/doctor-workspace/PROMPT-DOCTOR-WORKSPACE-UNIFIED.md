# PROMPT: Doctor Workspace — one flow board for Triage · Assigned · Encounters · Resus

> **For Claude Code.** Work at the repo root on a new branch `feat/doctor-workspace`. Cut it from the branch where `feat/resus-desk-v2` has merged. If resus v2 has not merged, cut from the current working branch and **do not touch `app/doctor/resus/**` or `lib/resus/**` until it has** (confirm at STOP 0). First copy this prompt into `docs/doctor-workspace/`.
>
> **Mode:** gated. Seven phases, each ending in a **STOP**. Documents use Stage 1 (draft → critique against the checklist → revise, max two passes → present → STOP). Code uses Stage 2 (build → run the real checks → fix → re-run until green → report numbers → STOP). Self-refinement never replaces a real check.
>
> **The CSO is Fadhul.** Any rule that changes what a clinician is shown about a patient's clinical state (acuity, death, staleness, wait targets) needs his signature before it ships.

---

## 0. What we are building, in one paragraph

The doctor side today has four separate pages that each list the same patients at a different stage of one journey: **Triage** (department queue), **Assigned** (waiting for me), **Encounters** (my open clerkings) and **Resus** (the resuscitation board). The doctor has to remember to check all four, each page identifies patients differently, and nothing links a patient's state across them. We replace the four list pages with **one Workspace**: a single, live, prioritised board where **each patient appears once, in one lane, with one next action**. The focused work surfaces stay what they are: the triage form, the clerking page and the resus desk. The Workspace is where you start and where you come back to. Underneath it sits a **patient-level flow projection** (a pure engine) that reconciles triage, assignments, encounters, resus and death into one truth. That engine is the real fix. The page is how you see it.

---

## 1. Ground truth and reading order

1. **The repo wins** over this prompt and over the screenshots. Every problem marked *screenshot* in Section 3 was seen on the live test deployment (`medsync-six.vercel.app`, Test Hospital-1, 24 Sep 2026 11:10–11:11, signed in as a Senior Consultant, Internal Medicine). Confirm each one in code and data, and report every disagreement at STOP 0.
2. **Design and decisions:** `DESIGN-medsync.md` (authoritative), ADR 0097 if present (plum = place), all doctor-workspace, triage, scheduling and resus ADRs, and `docs/resus-v2/**` (the resus v2 prompt, especially Sections 5.7, 5.13, 5.14 and 9).
3. **Code:** `app/doctor/**` (layout, sidebar, `triage`, `assigned`, `encounters`, `resus`), the nurse equivalents in `app/nurse/**` (for shared components), `lib/triage/**`, `lib/resus/**`, the encounter and assignment modules wherever they live, `db/schema/**`, `tests/**`, `tests/rls/**`.

---

## 2. Laws (non-negotiable)

1. **Engine-first.** No surface reads or writes an engine without real tables, real RLS policies and passing tests. The Workspace is a *read* surface over existing engines. Any new column, table, view or trigger arrives with RLS probes in the same phase.
2. **Decision support only.** The Workspace sorts, groups and suggests. It never orders, never decides and never hard-blocks a clinical action. Where a warning is needed (e.g. starting an encounter for a patient recorded as deceased), it is a confirm with a recorded reason, audited.
3. **Nothing disappears silently.** An item leaves a lane only through a recorded action (triage, assign, start, complete, close, cancel). Stale or contradictory items move to **Needs closing**; they are never filtered out. **Nothing auto-closes.**
4. **One patient, one row.** The same patient never appears twice on the board. Every other fact about that patient (duplicate assignments, old open encounters, idle resus episodes) becomes a badge on that row and an item in its detail panel.
5. **No remembered numbers.** Wait-time targets, acuity validity windows and any other clinical threshold come only from a CSO-signed reference entry (with source URL and verified date). Until signed, the UI shows the elapsed time and never colours it against a target. Operational thresholds (e.g. "encounter idle ≥ 24 h") live in hospital settings with defaults approved at GATE A.
6. **Red is a safety property.** `#DC2626` appears only on: the arrest-in-progress banner and its lane marker, L1/Red acuity chips (existing clinical signal), critical vital values (existing) and the global Emergency affordance. Stale, overdue, offline, "needs closing" and waiting-time warnings are **amber**. Record states such as "Open" or "Completed" are **neutral grey**, never the green/amber/red trio. "Died" is a neutral chip with the word, as on the resus board today. Extend the red-scarcity invariant tests to every Workspace component.
7. **Two identifiers on every row.** Name plus MRN (and age · sex) on every patient row, drawer and sheet, never a room or bay alone (WHO Patient Safety Solution 2, patient identification). Name reveals follow the existing `clinical_phi_access_log` pattern (Q9).
8. **Reuse before adding.** The resus lane renders the resus v2 board component and its projection (resus v2 Section 5.13). Do not build a second resus board. Triage renders the existing triage form. Assign/Reassign/Start/Continue/Open resus call the existing server actions.
9. **Stack as found:** Next.js 16 App Router, server components for lists, client islands only where interaction needs them; TypeScript strict, no `any`; Zod on every server action; AAL2 for clinical roles; reception cadres blocked in app and DB; writes through audited server actions only. Use the ORM already on the branch (Q1), never a second one.
10. **No new dependencies** without stopping to flag (including Playwright, axe and any URL-state library). The project must still run from a clean clone with Node 22 + pnpm only.
11. The pharmacy regulator is the **Pharmacy Board of Uganda** (never PSU) wherever copy mentions it.

---

## 3. What is wrong today

| # | Problem | Evidence | Severity |
|---|---|---|---|
| W1 | **A deceased patient is still actionable.** Patient Two-2 (26 y M) appears on the resus board under *Recently ended* as **Died · Mortuary · ended 11:06**. At 11:10 a patient with the same name and age (MS-2026-00003) is still on the Triage worklist as "L2 · re-triage" with **Assign Dr**, still has an **L4 · Start** row on Assigned, two **OPEN** emergency encounters (5 Jun, 7 Jul), and three more resus episodes under *Needs closing*. Confirm it is one `patient_id`; if so, death recorded in resus does not propagate anywhere. | screenshot | **Safety — fix first** |
| W2 | **Duplicate rows with conflicting acuity.** Assigned lists MS-2026-00004 three times (L1, L4, L1) and MS-2026-00003 once. Encounters lists 00004 twice and 00003 twice, all OPEN. Which acuity is true? The page can't say. | screenshot | Safety + data |
| W3 | **L1 patients in a routine queue.** Two L1 rows on Assigned offer a plain **Start**. The resus board's "Red / L1 — open a resus" looks back only 24 h and shows 0, so an older L1 falls into a gap: not offered resus, not flagged as stale. | screenshot | Safety |
| W4 | **No staleness outside resus.** Emergency encounters opened on 5 Jun and 7 Jul are still OPEN (≈ 16 and 11 weeks). "Re-triage" shows no reason and no time. Nothing tells the doctor what is current. | screenshot | Safety + data |
| W5 | **Four pages, four identifier styles.** Triage: name + MRN + age + sex. Assigned: MRN only. Encounters: MRN only. Resus: name + age only. None show the complaint or how long the patient has waited. | screenshot | Safety (identification) + UX |
| W6 | **Every hand-off is a page change.** Triage (page) → Assign Dr → Assigned (page) → Start → Encounter (page). After an encounter is completed there is no "next patient". | screenshot | UX |
| W7 | **Navigation noise.** 11 sidebar items, 6 of them "SOON" and not clickable. "Overview (SOON)" overlaps what a home page should be. | screenshot | UX |
| W8 | **Floating Emergency button** overlaps content on every doctor page (same as resus v2 P11). | screenshot | UX |
| W9 | **Inconsistent page headers.** Triage/Assigned/Encounters use a Fraunces H1 with a mono eyebrow; the resus board uses a different heading and eyebrow style. | screenshot | UX |
| W10 | **Status colour misuse (check).** Encounters' "OPEN" chip appears in the teal/green family. A record state is not a clinical signal: neutral. | screenshot | Design law |
| W11 | **No live updates (check).** Lists appear to change only on reload. | to confirm | Reliability |

---

## 4. Design direction: the flow board

**Seven rules**
1. **One patient, one row, one lane, one next step.**
2. **The row says why it is here and what to do next:** acuity, two identifiers, reason for visit, stage detail, time in stage, one primary button.
3. **The loudest thing is the sickest patient:** arrest banner > resus lane > acuity order > everything else.
4. **Work surfaces stay focused.** Triage opens as a side sheet over the board; clerking and the resus desk stay full pages. The Workspace is the hub you return to, and it always offers the next patient.
5. **Never lose your place.** Lane, scope and selected patient live in the URL. Back/forward work. Reload restores the view.
6. **Calm live updates.** Rows never jump under the pointer or keyboard focus: while the list is hovered or focused, reorders are held behind a quiet "3 updates · Show" pill.
7. **Say it once.** Each fact appears once per row: a badge, not a sentence.

**Budgets** (measured at Phase 0, met by Phase 5)
- Sidebar items visible: **≤ 5** (from 11).
- Visible controls per row: **≤ 2** (primary + overflow ⋯).
- Workspace → start the top waiting patient: **1 tap**.
- Triage submit → encounter open for the same patient: **≤ 2 taps, 0 list-page changes**.
- Encounter complete → next patient started: **≤ 2 taps**.
- Any patient reachable by search in **≤ 3 keystrokes + Enter** (MRN suffix or name fragment).
- Lane switch **< 100 ms** p95 (client-side filter, no refetch).

---

## 5. Interface specification

### 5.1 Lanes (fixed order; each is a section in *All*, and a filter chip)

| # | Lane | Scope | Contents | Primary action |
|---|---|---|---|---|
| 0 | **Arrest in progress** | hospital | Pinned banner, shown only while any arrest is active (from resus v2) | **Join** → resus desk |
| 1 | **Resus** | department | Active and boarding resus episodes (resus v2 board projection) | **Open desk** |
| 2 | **To triage** | department | Awaiting triage, and re-triage requested | **Triage** (side sheet) |
| 3 | **Unassigned** | department | Triaged, no responsible clinician. Visible only to cadres allowed to assign (Q8) | **Take** (assign to me + start) · ⋯ Assign to… |
| 4 | **Waiting for you** | mine | Assigned to me, encounter not started. Sorted by acuity, then time waiting | **Start** |
| 5 | **In progress** | mine | My open encounters with activity inside the idle window | **Continue** |
| 6 | **Needs closing** | mine (+ department for in-charge/HOD) | Idle resus episodes, idle encounters, superseded assignments, stale L1/Red triage, anything open for a deceased patient | **Review** (drawer) |
| 7 | **Done today** | mine | Encounters I completed since 00:00 local, collapsed by default | **View** |

Scope switch in the header: **Mine | Department** (Department shows lanes 1–7 for the whole department, read-only where the viewer lacks the permission). Default: Mine, with lanes 1–3 always department-wide because they are shared queues.

### 5.2 Desktop (≥ 1280 px): board + patient panel
```
┌──────────────┬───────────────────────────────────────────────────────────────┬──────────────────────────────┐
│ MedSync      │ Workspace                     Thu 24 Sep · 11:10              │                              │
│ TEST HOSP-1  │ Internal Medicine    [Mine | Department]  🔍 Find patient  ⌘K   │   ( Emergency )  ← header,   │
│              ├───────────────────────────────────────────────────────────────┤     red outline, far right   │
│ ▣ Workspace 4│ ⚠ CARDIAC ARREST · Bay 2 · A+06:42 · Leader Dr Okello      [Join] │  ← only while an arrest runs │
│ ☺ Patients   ├───────────────────────────────────────────────────────────────┤                              │
│ ▦ Schedule   │ [All 14] [Resus 1] [To triage 2] [Unassigned 1] [Waiting 3]   │ PATIENT                      │
│              │ [In progress 1] [Needs closing 9] [Done today 4]              │ Patient Three-3 · 76 y M     │
│              ├───────────────────────────────────────────────────────────────┤ MS-2026-00004                │
│              │ RESUS · 1                                                     │ L2 · triaged 10:42 (28 min)  │
│              │  ● Patient Three-3 76y M · MS-…0004 · Survey · C threatened   │ Reason: breathlessness       │
│              │    T+00:12 · Leader You                           [Open desk] │                              │
│              │ TO TRIAGE · 2                                                 │ TODAY                        │
│              │  ○ Patient Five-5 34y F · MS-…0009 · Walk-in · fever          │ 10:31 Arrived · walk-in      │
│              │    waiting 18 min                                   [Triage]  │ 10:42 Triaged L2 · Nurse A   │
│              │  ○ Patient Six-6 61y M · MS-…0011 · Re-triage requested 10:55 │ 10:43 Assigned to you        │
│              │    by Nurse B · "SpO₂ falling"                      [Triage]  │ 10:58 Resus opened · Step-0  │
│              │ WAITING FOR YOU · 3                                           │                              │
│              │  L2 Patient Seven-7 45y F · MS-…0012 · chest pain             │ ALSO OPEN (badges)           │
│              │     waited 42 min · 2 old encounters ▾              [Start] ⋯ │ 2 encounters idle > 24 h     │
│              │  L3 …                                               [Start] ⋯ │ 1 resus episode idle 13 d    │
│              │ IN PROGRESS · 1                                               │ [Review in Needs closing]    │
│              │  L3 Patient Eight-8 … · clerking · last edit 12 min [Continue]│                              │
│              │ NEEDS CLOSING · 9                                             │ [ Open desk ]  primary       │
│              │  Patient Two-2 26y M · MS-…0003 · Died 11:06 · 6 open items   │ ⋯ Reassign · Re-triage       │
│              │                                                    [Review]   │                              │
│              │ DONE TODAY · 4 ▸                                              │                              │
└──────────────┴───────────────────────────────────────────────────────────────┴──────────────────────────────┘
```
- **Row anatomy:** acuity chip (existing triage tokens; "—" if never triaged) · **Name · age sex · MRN** · reason for visit · stage detail · time in stage · badges · primary button · ⋯.
- **Time in stage** is elapsed time only (Law 5). When the CSO signs acuity targets, the same cell turns amber past target; never red.
- **Badges** are small neutral/amber tags: "2 old encounters", "3 assignments", "re-triage requested", "acuity 19 d old", "Died 11:06". Tapping a badge opens the panel at that item.
- **Patient panel** (right, ≥ 1280 px; a drawer below that; a full-screen sheet on phones): two identifiers, current acuity with its time and author, reason, **Today** timeline (arrival → triage → assignment → encounter → resus → disposition), **Also open** items, the primary action and the overflow. Opening it is a URL change (`?patient=<id>`), not a navigation.
- The sidebar count on **Workspace** = Waiting for you + Resus (mine). Neutral badge; red only while an arrest is in progress.

### 5.3 Phone / tablet portrait
```
┌───────────────────────────────┐
│ Workspace        🔍   (Emerg.)│
│ ⚠ ARREST · Bay 2 · A+06:42 Join│
│ [All][Resus 1][Triage 2][Wait…│ ← chips scroll horizontally
├───────────────────────────────┤
│ WAITING FOR YOU · 3           │
│ L2 Patient Seven-7 · 45y F    │
│    MS-…0012 · chest pain      │
│    waited 42 min      [Start] │
│ L3 …                          │
├───────────────────────────────┤
│ [ Start next: Seven-7 · L2 ]  │ ← sticky bottom bar (only when Waiting > 0)
└───────────────────────────────┘
```
Rows are 2–3 lines; tap anywhere on the row opens the full-screen patient sheet; the primary button is ≥ 44 px.

### 5.4 The seamless chain

**Triage in place.** **Triage** opens the existing triage form in a right-hand sheet over the board, using Next.js parallel + intercepting routes (`app/doctor/@panel/(.)triage/[intakeId]`), so the URL is shareable, reload lands on the full triage page and Esc/back closes the sheet. On submit the sheet does not close; it shows the result and the next step:
```
┌ Triage result ─────────────────────────────────────────┐
│ Patient Five-5 · 34y F · MS-2026-00009                 │
│ L2 · Orange   because RR 28, SpO₂ 91% on air  [why ▸]  │
│                                                        │
│ [ Take & start ]   Assign to… ▾   Back to board        │
└────────────────────────────────────────────────────────┘
```
- If the result is **Red/L1 or a Step-0 life threat**: the first button is **Open resus** (existing open-from-triage action). The other options stay available (decision support, not a block).
- **Take & start** = assign to me + start encounter (existing actions, called in sequence in one server action wrapper so a failure leaves a clear state) → navigates to the encounter page.

**Next patient.** When an encounter is completed, the confirmation screen offers:
```
Encounter completed · Patient Seven-7 · 11:52
Next waiting for you: Patient Nine-9 · L3 · waited 25 min      [ Start ]   Back to workspace
```
**Encounter page rail.** The clerking page gains a collapsible left rail ("Workspace ▸") showing Waiting for you and In progress, so the doctor can switch patients without going back. Collapsed by default on < 1440 px.

**Needs closing drawer.** **Review** opens the patient panel scrolled to *Also open*. Each item shows what it is, when it was last touched and by whom, and the actions that already exist for it: *Continue*, *Complete*, *Close resus…* (resus v2 close-out / administrative close), *Retire assignment* (only if Q3 finds or GATE A approves an action for it). Nothing is closed by the Workspace itself.

**Deceased patient.** If a patient is recorded as deceased (Q4, D2): the row lives only in Needs closing with a neutral **Died hh:mm** chip; Triage, Take and Start are removed from its primary slot; starting a new encounter from the overflow shows a confirm ("Recorded as died at 11:06 by Dr X. Continue anyway?") with a mandatory reason, audited. Correcting a wrong death record is not done here; it follows D2.

### 5.5 Keyboard (off inside text fields)
`j / k` move selection · `Enter` open panel · `s` primary action · `t` triage · `a` assign · `/` search · `1–7` jump to lane · `?` help. Focus-visible ring is teal.

### 5.6 Header and navigation
- One **page header component** for Workspace and the resus desk: eyebrow (hospital · department), Fraunces H1 weight 500, optional subline, right-side slot. Fixes W9.
- **Emergency affordance** moves from the floating button into every doctor page header, far right, red outline, labelled (matching resus v2 5.7). It never overlaps content. Fixes W8.
- **Sidebar (D6):** Workspace · Patients · Schedule. "SOON" items are hidden until built. Overview is removed (Workspace is home). Alerts, Tasks, Supervisees and Review queue arrive later **as lanes** through the lane registry (5.7), not as new nav items.

### 5.7 Lane registry (extensibility)
`lib/workspace/lanes.ts` exports an ordered registry: `{ id, label, scope, order, visibleFor(cadre, perms), primaryAction(row) }`. Future engines plug in lanes without touching the page: **Alerts** (monitoring engine), **To co-sign** (Review queue / supervisees), **Tasks**. The nurse workspace can later reuse the shell with its own registry (D10). This is what keeps the sidebar at ≤ 5 items as MedSync grows.

### 5.8 Redirects and feature flag
Behind flag `doctorWorkspace` (per hospital; use the existing flag mechanism, Q14):
- `/doctor` → the Workspace (new home).
- `/doctor/triage` → `/doctor?lane=triage` · `/doctor/assigned` → `/doctor?lane=waiting` · `/doctor/encounters` → `/doctor?lane=in_progress` · `/doctor/resus` → `/doctor?lane=resus`. Temporary (307) redirects while the flag exists.
- Detail routes stay: `/doctor/encounters/[id]`, `/doctor/resus/[id]`, the triage page.
- Flag off: the four old pages render exactly as today.

---

## 6. The flow projection (the engine)

`lib/workspace/flow.ts`, pure, no I/O:

```ts
computeFlow(input: {
  patients, triageRecords, assignments, encounters, resusEpisodes, deaths,
  viewer: { userId, cadre, departmentId, permissions },
  settings: { encounterIdleHours, resusIdle (from resus v2), l1LookbackHours /* existing 24 h rule */ },
  signedRefs: { waitTargets?: SignedEntry[] },
  now,
}): { rows: PatientFlowRow[], lanes: LaneCounts, integrity: IntegrityFlag[] }
```
`PatientFlowRow = { patientId, identifiers, acuity: { level, colour, at, by, stale }, lane, stageDetail, since, primaryAction, overflowActions, badges, alsoOpen: ItemRef[], sourceRefs }`

**Rules** (each gets an ID and at least one test):
- **FW-1 One row per patient.** Group every source by `patient_id`.
- **FW-2 Lane precedence** (first match wins): deceased → Needs closing · arrest/active/boarding resus → Resus · my encounter open and not idle → In progress · assigned to me, not started → Waiting for you · awaiting triage or re-triage requested → To triage · triaged, unassigned → Unassigned · only stale/contradictory items → Needs closing · completed by me today → Done today.
- **FW-3 Current acuity** = the latest triage record for this visit. Older triage records never set the chip; they appear in the panel timeline.
- **FW-4 Duplicate assignments:** the newest active assignment wins; older active ones become badges ("3 assignments") and *Also open* items. Root-cause fix at write time is D5.
- **FW-5 L1/Red routing:** L1/Red (or Step-0) within the existing resus lookback and no resus episode → primary action **Open resus**. Older than the lookback with no resus → Needs closing, "acuity N d old — re-triage or close". No new number: reuse the constant the resus board uses today.
- **FW-6 Idle encounters:** open with no activity ≥ `encounterIdleHours` (hospital setting, D3) → Needs closing item. Resus idle classes come from resus v2 `closeout/idle.ts`, not a second implementation.
- **FW-7 Deceased:** any open item for a patient with a death record → Needs closing; primary actions limited as in 5.4.
- **FW-8 Resus supersedes triage:** a patient in resus never shows a Triage primary action; a pending re-triage becomes a badge.
- **FW-9 Sorting inside a lane:** acuity (L1 → L5, untriaged last) then time in stage (longest first). Resus lane uses the resus v2 board order.
- **FW-10 Wait colour:** amber only when a signed target exists for that acuity and is exceeded; otherwise neutral (Law 5).
- **FW-11 Scope:** Mine lanes never include another clinician's items; Department lanes respect the viewer's permissions (Q8).

**Integrity report.** `computeFlow` also returns every contradiction it resolved (deceased with open items, duplicate active assignments, stale L1, encounters idle beyond threshold). The in-charge sees the counts in Needs closing, and the Phase 0 baseline records them for the test hospital.

**Data access.** One query layer, `lib/workspace/queries.ts`, fetches only what `computeFlow` needs for the viewer's hospital and department, in a fixed number of round trips (no N+1). Read the way the existing list pages read (Q2). If a Postgres view is introduced, it must be `security_invoker = true` (check the current Supabase docs at build time) and gets RLS probes.

---

## 7. Data changes (only what GATE A approves; additive; next free migration number)

- **D2 → `patients.deceased_at`, `deceased_source` (event ref), `deceased_recorded_by`.** Set in the same transaction as resus v2 `confirmDeath` / `concludeResus` with outcome Died, and by any future death-recording path. Correction = a superseding audited record with four-eyes (reusing the existing four-eyes mechanism). Never cleared silently.
- **D5 → assignment supersession.** If the assignments table has no state for it, add `superseded_at` / `superseded_by_assignment_id`; a new assignment or re-triage retires the previous active assignment for the same visit in the same transaction. Backfill: flag, don't alter (existing duplicates show up in Needs closing for a human to resolve).
- **D3 → `hospital_workspace_settings`** (`encounter_idle_hours`, polling interval). No clinical constants.
- **Realtime (E2):** AFTER INSERT/UPDATE triggers on triage, assignment and encounter tables broadcast `{ patientId, kind, at }` (no PHI) to `workspace:<hospitalId>:<departmentId>` on a private channel, authorised by RLS on `realtime.messages` for active clinical staff of that hospital. Reuse the resus v2 board channel for resus. If the browser cannot subscribe (Q10/Q6 in resus v2), poll every 15 s while the tab is visible, pause when hidden, revalidate on focus.

Every new column, table and trigger: RLS probes for same-hospital clinical (allow read), other hospital (deny), reception (deny), anonymous (deny), and **client-side INSERT/UPDATE/DELETE denied**.

---

## 8. Server actions

Reuse, don't duplicate: assign, reassign, start encounter, complete encounter, open resus from triage, triage submit, resus close-out. Add only:
- `takePatient({ patientId, visitId })`: assign to me + start encounter in one audited transaction; idempotent on a client key; returns the encounter id.
- `startEncounterForDeceased(...)`: only if the existing start action cannot take an override reason; otherwise extend it with `overrideReason`.
- `retireAssignment({ assignmentId, reason })`: only if D5 is approved and no existing action fits.

Contract as elsewhere: `'use server'`, Zod, AAL2 + scope + cadre checks, one transaction, audit row, `{ id, serverTime }` return, notification failures never throw.

---

## 9. Phases and gates

### Phase 0 — Discovery and baseline (no product changes)
Answer and report:
- **Q1** ORM and migration pattern on this branch (Drizzle vs the Prisma/PGlite local-first path). Use what is here.
- **Q2** Files, queries and data path behind each of the four pages. Do they read with the user's session (RLS applies) or the service role (app-level scoping)?
- **Q3** The data model for triage records, assignments (states; is there an "active"/"superseded" concept?), encounters (states; last-activity field?) and resus episodes, and how each links to `patient_id` and to a visit.
- **Q4** Where death is recorded today (resus outcome/disposition only, or a patient field?).
- **Q5** Root-cause W1–W4 against the test data: is Patient Two-2 one `patient_id`? Why is MS-2026-00004 assigned three times? Why are the June/July encounters open? Write **failing** tests that reproduce each (do not fix yet).
- **Q6** What sets "re-triage", and does it carry a reason, author and time?
- **Q7** Is the triage form a page or a reusable component? Can it render inside a sheet without duplication?
- **Q8** The permission matrix for Triage, Assign Dr, Reassign, Start, Open resus by cadre.
- **Q9** How name reveals on lists are logged to `clinical_phi_access_log` today (per row, per page, batched?).
- **Q10** State of `feat/resus-desk-v2`: phases merged; is the board component (5.13), idle module (5.14) and realtime channel available?
- **Q11** Encounter engine status: feature flag, tables, complete action, last-activity tracking.
- **Q12** Does the nurse workspace share components with the doctor pages?
- **Q13** Are Playwright and axe available? If not, STOP and flag (Law 10).
- **Q14** The feature-flag mechanism.
- **Q15** Tokens in `DESIGN-medsync.md`: acuity chip tokens, neutral status chip, amber, the page-header pattern, plum for active nav.

Baseline:
- Screenshots of the four pages at 390×844, 834×1194, 1194×834, 1440×900, light and dark.
- Taps and page loads for: triage a new patient → start their encounter; complete an encounter → start the next.
- Sidebar item count; controls per row per page; queries and TTFB per page; axe results.
- The integrity counts for Test Hospital-1 (deceased-with-open-items, duplicate active assignments, stale L1, idle encounters).

**STOP 0.** Report Q1–Q15, the prompt-vs-repo differences, the failing tests and the baseline.

### Phase 1 — GATE A proposal (documents only)
Write `docs/doctor-workspace/gate-a-proposal.md`:
- Annotated wireframes for desktop, tablet and phone, All and single-lane views, triage sheet result state, next-patient screen, Needs closing drawer, deceased row. Start from Section 5; improve, don't bloat.
- The lane registry and precedence (FW-2) as a table, with one worked example per rule using the real test data.
- The schema diff (Section 7) and legacy-data plan (flag, never alter).
- The test plan and ADR drafts.
- The decision table (Section 13) with recommendations and a signature block.

**STOP 1.** Nothing proceeds without Fadhul's signature on the D-decisions.

### Phase 2 — Data layer
Approved migrations, triggers, RLS probes, realtime authorisation, settings seed.
**STOP 2.** Migration diff; RLS probe table (every new object × every actor); realtime authorisation test; backfill counts.

### Phase 3 — Flow engine (pure, no UI)
`lib/workspace/flow.ts`, `lanes.ts`, `queries.ts` with tests:
- ≥ 60 unit tests; every FW rule ID covered.
- A **fixture reproducing the 24 Sep screenshots** exactly, asserting: Patient Two-2 appears once, in Needs closing, "Died 11:06", no Triage/Start primary; MS-2026-00004 appears once with the latest acuity and a "3 assignments" badge; old L1s go to Needs closing; June/July encounters go to Needs closing; no patient appears in two lanes.
- Property test: for random source sets, every patient appears exactly once, and every open item appears either as a row's primary item or in its *Also open* list (Law 3: nothing disappears).
- The Phase 0 failing tests now pass at the projection level.
- Query budget: fixed round trips regardless of row count (assert with a query counter).

**STOP 3.** Test counts, rule coverage table, property-test result, query counts.

### Phase 4 — Workspace shell (read + existing actions)
Header component, sidebar cleanup, lanes, rows, patient panel, search, URL state, scope switch, flag + redirects, Emergency affordance in the header. Primary actions wired to existing routes/actions (Start, Continue, Open desk, Assign).
**STOP 4.** Screenshots (4 viewports × light/dark); budget counts vs baseline; axe (0 serious/critical); red-scarcity tests green; flag-off regression screenshots identical to baseline.

### Phase 5 — The seamless chain
Triage sheet (intercepting route) with result state and next step; `takePatient`; next-patient screen; encounter-page rail; Needs closing drawer; deceased confirm; keyboard.
Scenarios (Playwright if present, otherwise scripted integration tests):
- **S1** Walk-in → Triage in sheet → L3 → Take & start → encounter opens → complete → next patient offered → Start. Count taps.
- **S2** Triage result Red/L1 → Open resus → the row moves to Resus; no Triage action remains.
- **S3** Death confirmed in resus → the patient's other items move to Needs closing with "Died hh:mm"; Start from overflow requires a reason and is audited.
- **S4** Three active assignments for one patient → one row, "3 assignments" badge; retiring the extras (if D5) leaves one.
- **S5** Encounter idle beyond the setting → Needs closing → Continue or Complete.
- **S6** Reassign from a row on device A → gone from A's Waiting, present on colleague's device B within 2 s (realtime) or 15 s (polling).
- **S7** Old URLs redirect with lane preserved; back/forward and reload restore lane and selected patient; the triage deep link opens the full page on reload.
- **S8** Phone viewport, one-handed: S1 end to end.
- **S9** Reception cadre denied; other-hospital user denied; intern without assign permission sees no Unassigned lane.
- **S10** Flag off → the four old pages unchanged.

**STOP 5.** Scenario results, tap counts vs budgets, screenshots.

### Phase 6 — Hardening and documentation
Realtime reconnect and polling fallback; held reorders under hover/focus; reduced motion; dark mode; performance budgets (Section 11); ADRs; final report.
**STOP 6 (final).** The table in Section 12, filled in.

---

## 10. Accessibility, motion, colour
- WCAG 2.2 AA, light and dark. Targets ≥ 44×44 px. Lane chips are a `tablist` with counts in their accessible names ("Waiting for you, 3").
- The list is a `list` of `listitem`s with the row's primary button as the first focus stop; `j/k` move a roving tabindex.
- Live region (polite) announces only: new patient in Waiting for you, and a patient moving into Resus. Assertive only for "cardiac arrest declared" (rate-limited), matching resus v2.
- Never colour alone: every chip carries a word; acuity chips carry the level and colour name.
- Reduced motion: no slide-in for rows; the held-updates pill appears without animation.
- Headings weight 500. No left-edge accent bars. Plum marks the active nav item only (ADR 0097); buttons are teal.

## 11. Performance budgets
Workspace TTFB p95 < 400 ms on the test data · lane switch < 100 ms · open patient panel < 150 ms (data already on the client, timeline fetched lazily) · zero layout shift on live updates · added JS on `/doctor` ≤ 45 KB gzipped (report the number) · fixed query count per render.

## 12. Numbers to report at the final STOP
| Metric | Baseline | Target | Result |
|---|---|---|---|
| Sidebar items visible | 11 | ≤ 5 | |
| Pages a doctor must check to see all their patients | 4 | 1 | |
| Taps: triage submit → encounter open | P0 | ≤ 2 | |
| Taps: encounter complete → next started | P0 | ≤ 2 | |
| Controls per row | P0 | ≤ 2 | |
| Patients appearing more than once on the board | P0 | 0 | |
| Deceased patients with an actionable Triage/Start primary | P0 | 0 | |
| Rows with fewer than two identifiers | P0 | 0 | |
| FW rule IDs without a test | — | 0 | |
| RLS probes passed | — | 100% | |
| axe serious/critical | P0 | 0 | |
| Lane switch p95 / panel open p95 | — | < 100 / < 150 ms | |
| Added JS on `/doctor` | — | ≤ 45 KB gz | |

## 13. GATE A decisions (Fadhul owns; recommendations given)
| # | Decision | Recommendation |
|---|---|---|
| D1 | Name + MRN + age/sex on every row | **Yes.** Two identifiers is a patient-safety floor; log name reveals in batches per page load (Q9 pattern) |
| D2 | A patient-level death record (`patients.deceased_at`) as the single truth | **Yes.** Set in the same transaction as death confirmation; corrections by four-eyes only |
| D3 | Encounter idle threshold before Needs closing | 24 h without activity, as a hospital setting; nothing auto-closes |
| D4 | Wait-time targets per acuity | Only from the signed triage reference (SATS/ESI as the engine uses); until signed, elapsed time only, no colour |
| D5 | Duplicate assignments | Collapse at read time now; fix at write time (new assignment/re-triage retires the previous active one in the same transaction) |
| D6 | Navigation | Workspace · Patients · Schedule; hide SOON items; remove Overview |
| D7 | Default landing | Workspace, All view, Mine scope |
| D8 | Who sees Unassigned and Department scope | Whoever holds assign permission today (Q8); interns see Mine |
| D9 | Old L1/Red triage with no resus | Needs closing: "re-triage or close"; reuse the board's existing 24 h lookback, no new number |
| D10 | Nurse workspace | Build the shell and lane registry cadre-agnostic now; the nurse adoption is a separate prompt |
| D11 | Re-triage display | Show reason, author and time; if the engine stores none, label "re-triage requested" and add the fields (Q6) |
| E1 | Triage as a sheet | Intercepting route over the board; full page on reload |
| E2 | Live updates | Private-channel broadcast from DB triggers, PHI-free, polling fallback (same pattern as resus v2) |
| E3 | Held reorders | Hold while the list is hovered or focused; "N updates · Show" pill |

## 14. Out of scope (leave clean seams)
Alerts, Tasks, Review queue and Supervisees lanes (registry seam only) · the nurse workspace adoption · bed management · the encounter/EMR engine itself (Tier 3, next on the roadmap; read what exists, don't build it here) · SMS/push · a mobile (Expo) version of the Workspace.

## 15. ADRs (next free numbers)
- Doctor Workspace replaces the four list pages; lanes and precedence.
- The patient flow projection and integrity report.
- Patient-level death record (if D2).
- Assignment supersession (if D5).
- Triage-in-sheet via intercepting routes.
- Workspace live updates.

## 16. Definition of Done
- [ ] W1–W11 resolved, or deferred with a reason.
- [ ] Every FW rule has a test; the 24 Sep screenshot fixture passes; the no-disappearance property test passes.
- [ ] No patient appears twice; no deceased patient offers Triage/Start as a primary action; every row shows two identifiers.
- [ ] RLS probes green for every new object, including client-write denial; realtime authorisation proven.
- [ ] Budgets met (Sections 4, 11, 12); axe clean; red-scarcity tests green; reduced motion honoured.
- [ ] S1–S10 pass on phone and desktop viewports.
- [ ] Flag off leaves the old pages byte-for-byte unchanged in behaviour.
- [ ] Resus lane uses the resus v2 board component; no second board exists.
- [ ] ADRs written; final report with numbers; reviewable diff on `feat/doctor-workspace`.
