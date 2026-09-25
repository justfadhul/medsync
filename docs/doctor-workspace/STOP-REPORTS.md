# Doctor Workspace — STOP reports

The owner said **"go through all gates"** (2026-09-24), so each STOP below was passed straight through and recorded
as it happened. Nothing reaches a clinician until `DOCTOR_WORKSPACE` is set; the D-decisions in the GATE A proposal
carry the CSO signature block, still unsigned.

Branch `feat/doctor-workspace`, cut from `feat/booking-app` at `c555aaf`, which **is** `feat/resus-desk-v2` (same
commit): resus v2 has merged, so `app/doctor/resus/**` and `lib/resus/**` are in scope.

## STOP 0 — discovery and baseline (2026-09-24)

### Q1–Q15

| #   | Question                    | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | ORM, migrations             | Drizzle (`db/schema/*`); SQL in `supabase/migrations/`, applied by `scripts/migrate.ts` (owner action). Highest: `0068`; this build takes **`0069`**. No Prisma, no PGlite in the repo.                                                                                                                                                                                                                                                                                                                                   |
| Q2  | Data path of the four pages | All four read through Drizzle's `db` (a server connection — **RLS does not apply**; scoping is app-level by hospital/department/clinician). Triage: `lib/triage/worklist.ts` `fetchTriageWorklist` + `TriageWorklist` (shared with /nurse). Assigned: `listAssignedEncountersForDoctor`. Encounters: `listDoctorEncounters` (both `lib/encounter/assignment.ts`). Resus: `fetchResusBoardV2` + `ResusBoardV2` (shared with /nurse).                                                                                       |
| Q3  | Data model                  | **Visit = `patient_intakes` row** (statuses declared/arrived/awaiting_triage/triaged/completed/cancelled). **Triage** = `triage_records` (many per intake; re-triage adds a row). **An assignment is a `planned` encounter** (`encounters.state`, one per triage record) — no assignment table, no active/superseded concept. Encounters: planned/in_progress/completed/cancelled, linked to a triage record and/or appointment. Resus: `resus_episodes` (v2 phase + close-out columns), linked to triage/intake/patient. |
| Q4  | Where death lives           | Only on the resus episode (`death_confirmed_at`, `outcome_code` died_after_cpr / died_cpr_not_attempted, `disposition` mortuary/deceased) and on `encounters.disposition = 'deceased'`. **No patient-level field.**                                                                                                                                                                                                                                                                                                       |
| Q5  | W1–W4 in data               | Not read: the production read (`.env.local` is production) was refused by the auto-mode classifier. Root causes below are from code; `docs/doctor-workspace/integrity-probe.sql` is the read-only probe for the owner. Failing tests: see below.                                                                                                                                                                                                                                                                          |
| Q6  | What sets "re-triage"       | Nothing. "L2 · re-triage" is how `TriageWorklist` labels **every already-triaged intake** still open. No reason, author or time exists; there is no "re-triage requested" state.                                                                                                                                                                                                                                                                                                                                          |
| Q7  | Triage form reusable?       | `TriageDesk` (`app/nurse/triage/_components/triage-desk.tsx`, 1,441 lines) is a component taking the row + base paths; on success it `router.push(basePath)`. It renders in a sheet with one optional prop (`onSubmitted`) and no duplication. Its three-zone grid keys off viewport breakpoints, so the sheet is wide (≈ 92 vw) on desktop, full-screen on phones.                                                                                                                                                       |
| Q8  | Permission matrix           | Triage and **Assign Dr**: `requireTriageScope` — clinical cadre + `clinical_cosign_policies triage_patient = allowed` (seeded for every doctor cadre, **interns included**, and nurses). Reassign and Start: `requireDoctorScope` (any doctor cadre, incl. intern and clinical officer). Open resus: `requireResusScope` (any clinical cadre). Down-triage: doctors + clinical officers.                                                                                                                                  |
| Q9  | Name reveals                | One `clinical_phi_access_log` row **per patient per fetch**, written in one batch insert (triage worklist, resus board). `revealPatientIdentities` (`lib/scheduling/patient-identity.ts`) is the fail-closed batch helper: dedup by patient, audit first, names only if the audit wrote.                                                                                                                                                                                                                                  |
| Q10 | Resus v2                    | Merged. Board projection `lib/resus/board-v2.ts` (§5.13), idle module `lib/resus/closeout/idle.ts` (§5.14), realtime hub `lib/resus/board-channel.ts` (`resus-board:<hospital>`), plus the global `ArrestAlarm`. Gated by `RESUS_DESK_V2=1` + migration 0068. `BoardV2Row` does not carry `patientUserId` (needed to group by patient).                                                                                                                                                                                   |
| Q11 | Encounter engine            | `ENCOUNTER_ENGINE_LIVE=1`; `encounters` (+ `clinical_documentation` append-only versions, `clerkship_drafts`). Complete = `completeEncounterAction` → `ha-complete-encounter` (End visit, ADR 0101; cascades intake/queue/booking). **No last-activity column**: `encounters.updated_at` (trigger) + latest documentation version. Starting a planned encounter never sets `started_at`.                                                                                                                                  |
| Q12 | Shared with nurse           | Yes: `TriageWorklist`, `TriageDesk`, `AssignDoctorButton`, `OpenResusButton`, `RapidRedButton`, `ResusBoardV2` and rows, the resus desk — the doctor pages pass `/doctor` base paths.                                                                                                                                                                                                                                                                                                                                     |
| Q13 | Playwright / axe            | `axe-core` + `jsdom` present (run over pre-rendered static pages only). **Playwright absent** — flagged under Law 10; no dependency added. Scenarios run as scripted Vitest integration tests; the manual check is a local fixture render.                                                                                                                                                                                                                                                                                |
| Q14 | Feature flags               | Global env functions in `lib/*/feature.ts` (`process.env.X === "1"`). No per-hospital mechanism: `DOCTOR_WORKSPACE` takes `1` or a comma list of hospital ids.                                                                                                                                                                                                                                                                                                                                                            |
| Q15 | Tokens                      | No shared acuity token: the worklist uses rose/orange/amber/mint/slate dots, Assigned rose/orange/amber/emerald/sky chips. DESIGN pairs: `status-critical` (#DC2626), `status-caution` (amber), `status-pending` (neutral). Amber chip `AMBER_CHIP` in resus close-out words. No page-header component (each page hand-rolls eyebrow + Fraunces H1). Plum = active nav (`bg-plum-50 text-plum-800`).                                                                                                                      |

### W1–W11 against the code

| #   | Status    | Root cause in code                                                                                                                                                                                                                                                                                                                |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | Confirmed | No list reads death. A concluded resus (died) closes nothing else — correctly, nothing auto-closes — but the triage worklist keeps every `triaged` intake, Assigned every `planned` encounter, Encounters every `in_progress` one. Same `patient_id` is **unconfirmed in data** (read refused); the resus row shows no MRN.       |
| W2  | Confirmed | `assignDoctorFromIntake` keys the existing assignment on the **latest triage record**; each re-triage makes a new record, so the next assignment inserts another `planned` encounter. `submitTriageAction` step 9 auto-assigns the triaging doctor every time — a doctor who re-triages three times gets three rows (L1, L4, L1). |
| W3  | Confirmed | The board's "open a resus" list is L1 triage records of the last 24 h (`DAY_MS`) without an episode; Assigned has no acuity routing. An L1 older than 24 h reaches neither.                                                                                                                                                       |
| W4  | Confirmed | Nothing could end an encounter until End visit shipped on 2026-09-23 (ADR 0101), so every earlier `in_progress` encounter is still open. Triaged intakes leave the worklist only when an encounter completes. "Re-triage" carries no reason/time (Q6).                                                                            |
| W5  | Confirmed | Triage: name + MRN + age + sex + complaint. Assigned: MRN + complaint. Encounters: MRN only. Resus: name + age, no MRN, no sex. (The prompt's "none show the complaint or wait" is too strong: Triage shows both, Assigned the complaint.)                                                                                        |
| W6  | Confirmed | Triage desk → worklist → Assigned → Start → encounter; End visit leaves the encounter page with nothing next.                                                                                                                                                                                                                     |
| W7  | Differs   | 11 items for a Senior Consultant, 6 marked SOON — but they **are** links (to empty states), and **Schedule is live** (ADR 0087/0101) while still flagged `placeholder`.                                                                                                                                                           |
| W8  | Confirmed | `EmergencyPill` floats bottom-right; it stands down on any page that renders an inline link marked `data-emergency-inline` (the resus board does).                                                                                                                                                                                |
| W9  | Confirmed | Triage/Assigned/Encounters: mono eyebrow + Fraunces H1 (three sizes). Resus v2: sans `text-heading-l` H1, overline in a sticky bar.                                                                                                                                                                                               |
| W10 | Confirmed | Encounters' "Open" chip is `bg-brand-100 text-brand-800` (teal).                                                                                                                                                                                                                                                                  |
| W11 | Confirmed | Triage/Assigned/Encounters change only on navigation or after an own action. The resus v2 board is live (realtime + 30 s poll).                                                                                                                                                                                                   |

### Prompt vs repo

1. There is no `patients` table: the patient is `patient_profiles` (MRN = `patient_code`, e.g. MS-2026-00003).
2. There is no assignment table and no "visit id": an assignment is a `planned` encounter, the visit is the intake.
3. "Re-triage requested" does not exist (Q6). The workspace offers **Re-triage** as an action; "to triage" means awaiting triage.
4. The package manager is **npm** (`package-lock.json`), not pnpm.
5. Two more places list the doctor's patients: **Schedule's queue rail** (clinic-routed arrivals, ADR 0101) and the Overview's incoming panel. Proposed as a later lane (D12).
6. The ArrestAlarm (added 2026-09-24) already puts a red banner on every clinical screen — but only for arrests that **start** while the page is open. The workspace banner shows arrests already running.
7. The resus board is **hospital-wide**, not per department (a resus is a whole-team act); the Resus lane keeps that.
8. `triage_config.target_minutes_by_level` and `ACUITY_TIERS.targetMinutes` exist but are not CSO-signed reference entries — Law 5: unused.
9. `.env.local` points at production; the RLS suites skip (no test project), as for resus v2.

### Failing tests

`tests/workspace/screenshot-24-sep.test.ts` reproduces W1–W4 as a fixture of the 24 Sep screenshots (Patient Two-2
died in resus with a triage row, an Assigned L4 row, two open June/July encounters and three idle episodes;
MS-2026-00004 assigned three times; two L1 rows older than 24 h). At STOP 0 it fails — the projection
(`lib/workspace/flow.ts`) that would say "one row, Needs closing, Died 11:06" does not exist.

### Baseline (from code; live numbers need a signed-in session)

| Metric                                           | Baseline                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Sidebar items (Senior Consultant / MO / intern)  | 11 / 10 / 9 (6 / 5 / 5 marked SOON)                                                |
| Pages to see all my patients                     | 4 (+ Schedule's queue rail)                                                        |
| Taps: doctor triages → encounter open            | 4 taps, 4 page loads (row → Assign Lx → Assigned → Start)                          |
| Taps: encounter complete → next started          | 4 taps, 2 page loads (End visit → Confirm → Assigned → Start); nothing offers next |
| Controls per row                                 | Triage 2 · Assigned 2 · Encounters 1 · Resus 1–2                                   |
| Rows with < 2 identifiers                        | every Assigned, Encounters and Resus row                                           |
| Deceased with an actionable primary (screenshot) | 2 (Assign Dr, Start)                                                               |
| Queries per render (page only)                   | Triage 2 · Assigned 1 · Encounters 1 · Resus 4 + ≤ 30 event reads + ≤ 5 notices    |
| TTFB, axe on signed-in pages                     | Not measured: no session here (AAL2 MFA); axe harness is static-only               |
| Integrity counts, Test Hospital-1                | Not read (production refused) — `integrity-probe.sql`                              |

## STOP 1 — GATE A (2026-09-24)

`gate-a-proposal.md` holds the design plan (reviewed against the brief, with the defaults it removed), annotated
wireframes (desktop, tablet and phone; All and one lane; the triage-sheet result; next patient; Needs closing; the
deceased row), the lane registry and precedence with worked examples from the 24 Sep fixture, the schema diff and the
legacy plan, the test plan, the ADR drafts and the decision table.

Passed on the owner's "go through all gates": every D and E decision is built as recommended — D2 and D5 without new
columns, D3 without a settings table (proposal §5). **The CSO signature for D2, D3, D4, D9 and D11 is still blank**;
until it is signed, `DOCTOR_WORKSPACE` stays unset for every hospital. Where the build differs from the proposal is
listed in its §10.

## STOP 2 — data layer (2026-09-24)

### Migration diff

`supabase/migrations/0069_doctor_workspace.sql` — GATED, additive, owner-applied, **not applied**.

| Object                                                  | Change                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sa_audit_log_action_check`                             | 0068's list verbatim, plus `retire_assignment`                                                                                                                                                                                     |
| `public.workspace_broadcast()`                          | `SECURITY DEFINER`, `search_path = ''`: `realtime.send({kind, at}, 'change', 'workspace:<hospital_id>', private)`; any error is swallowed, so a realtime failure never blocks the write                                            |
| Triggers                                                | `patient_intakes` AFTER INSERT OR UPDATE OF status, triage_level, receiving_department_id, routed_to · `triage_records` AFTER INSERT · `encounters` AFTER INSERT OR UPDATE OF state, clinician_user_id, triage_record_id, ended_at |
| `realtime.messages` policy `workspace_realtime_receive` | SELECT for `authenticated` on broadcast topics `workspace:<hospital>` when `is_active_clinical_staff(<hospital>)`; created only where the realtime schema exists                                                                   |

No table, column or view: nothing new that a client could write. The payload names no patient, intake or encounter —
a listener learns that something in its hospital changed at a time, and re-reads through its own scoped server render.

### RLS and realtime authorisation probes

Offline in PGlite 0.3 (Postgres 17), applying the migration file itself over stubs of what it references (scratch
`pg/verify-0069.mjs`, not committed): **17 / 17 pass**, re-run after the last change.

| Probe                                                                                                                                              | Result |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Applies cleanly; re-applies (idempotent)                                                                                                           | 2 / 2  |
| Audit CHECK: `retire_assignment` accepted; an 0068 action still accepted; an unknown action refused                                                | 3 / 3  |
| Intake insert → one PHI-free message on `workspace:<hospital>`; status update → message; complaint-only update → none                              | 2 / 2  |
| Triage insert → message                                                                                                                            | 1 / 1  |
| Encounter insert or state change → message; `updated_at`-only update → none                                                                        | 1 / 1  |
| A failing realtime layer never blocks the clinical write                                                                                           | 1 / 1  |
| A clinician of the same hospital may listen                                                                                                        | 1 / 1  |
| May not listen: another hospital's clinician, reception (non-clinical cadre), a suspended clinician, anonymous, a malformed topic, the resus topic | 6 / 6  |

The live probes (`tests/rls/workspace-realtime.test.ts`, 5) **skip**: `.env.local` is production and there is no test
project — the position resus v2 was in. Run them against a test project before the flag goes on.

### Root fixes on the write side

- `assignDoctorFromIntake` reuses the visit's open encounter instead of inserting another (D5):
  `tests/workspace/assignment-visit.test.ts`, 5.
- `openEncounterFromTriage` stamps `started_at` when it starts a planned encounter: `start-time.test.ts`, 1.

**Backfill:** none (flag, never alter). **Settings seed:** none (D3 is a constant). **Integrity counts for Test
Hospital-1:** still unread — the production read was refused; `integrity-probe.sql` is the owner's read-only query.

## STOP 3 — flow engine (2026-09-24)

`lib/workspace/flow.ts` (pure), `lanes.ts` and `queries.ts`, with `clock.ts`, `words.ts` and `changes.ts` beside them.

| Suite                       | Tests                                |
| --------------------------- | ------------------------------------ |
| `flow.test.ts` — the rules  | 78                                   |
| `flow-property.test.ts`     | 401 (400 seeds + 1 generator sanity) |
| `screenshot-24-sep.test.ts` | 8 (failing at STOP 0)                |
| `rule-coverage.test.ts`     | 11                                   |
| `queries.test.ts`           | 4                                    |
| `changes.test.ts`           | 5                                    |

Rule coverage (`rule-coverage.test.ts` fails if a rule loses its describe block or its cases):

| Rule                           | Cases | Rule                         | Cases |
| ------------------------------ | ----- | ---------------------------- | ----- |
| FW-1 one row per patient       | 7     | FW-7 a recorded death        | 9     |
| FW-2 lane precedence           | 14    | FW-8 resus supersedes triage | 2     |
| FW-3 current acuity            | 6     | FW-9 order inside a lane     | 6     |
| FW-4 duplicate assignments     | 5     | FW-10 wait colour            | 4     |
| FW-5 L1 / Red routing          | 8     | FW-11 scope and permissions  | 6     |
| FW-6 idle encounters and resus | 7     | registry and words           | 4     |

**Property test:** 400 seeded boards (mulberry32: 1–12 patients, up to two visits each, triage records, encounters,
resus episodes and deaths over 40 days, one patient in ten unregistered). On every board: each patient is on one row;
each open item is on exactly one row — as its primary item, an intake its encounter answers, or under Also open (Law
3); no dead patient is offered Triage, Take, Start or Open resus; every row has a name, an MRN or the desk's label; the
lane counts add up; the same sources give the same board. **400 / 400.**

**24 Sep fixture:** Patient Two-2 once, in Needs closing, "Died 11:06", nothing to triage or start, all six open items
listed; MS-2026-00004 once, with the latest acuity and "3 assignments"; the old L1s and the June, July and August
encounters in Needs closing; no patient in two lanes; the integrity report names every contradiction. **8 / 8.**

**Query budget:** three sequential phases — (A) triage authority, open intakes, encounters and the resus board, in
parallel; (B) triage records, profiles and deaths (resus episodes, encounters), in parallel; (C) one audited name
reveal for the patients on the board. Nine calls, identical for 1 and 50 rows per table (a counting fake `db`). The
resus board's own reads are the resus page's (STOP 0).

## STOP 4 — workspace shell (2026-09-24)

Built: the page header (`PageHeader`), the three-item nav with the flag, the Emergency link in the header (the floating
pill stands down), lanes as a tablist with counts in their names, rows, the patient panel (an aside from 1280 px, a
sheet below), search (`/`, ⌘K), URL state (lane and patient by `pushState`, scope by navigation), the Mine /
Department switch, the flag with its 307 redirects, and the primary actions wired to the existing actions.

**Method** (resus v2's, Playwright being absent): a synthetic fixture route in a scratch copy, never committed, that
renders the real board from the 24 Sep fixture; a production build with a dead database URL; Chrome driven over the
DevTools protocol.

**Screenshots:** 390×844, 834×1194, 1194×834 and 1440×900, light and dark, plus the panel, the phone sheet, Needs
closing, the deceased panel, the death confirm and the keyboard help — in the session scratchpad, not committed.

**Budgets against the baseline:** sidebar 11 → 3; pages to see all my patients 4 → 1; controls per row → 2 (primary + ⋯).

**axe** (axe-core over 10 views: desktop, tablet and phone, light and dark, the panel, the sheet, the death confirm,
the keyboard help):

| Where                                    | Serious / critical    | Note                                                                                                                                                                                                           |
| ---------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace components                     | 0, except the L1 chip | The L1 chip uses DESIGN-medsync's Critical pair, `#DC2626` on `#FEE2E2` = 3.95:1 at 11 px (AA asks 4.5:1). Every `ClinicalBadge status="critical"` shares it: a token decision for the owner, not changed here |
| Doctor shell (not changed by this build) | 2                     | The hospital tier label (`text-muted-foreground/70`: 2.71:1 light, 4.29:1 dark; `doctor-shell.tsx:194`) and the cadre pill in dark (1.01:1; `doctor-shell.tsx:203–208`)                                        |

**Red scarcity:** `tests/design/red-reserved.test.ts` 19 / 19, including a workspace block — red only on the arrest
banner and its lane marker, the L1 chip and the header's Emergency link.

**Flag off:** `pages.test.ts` 14 / 14 — the flag is off unless set and needs the encounter engine and resus v2; each old
page redirects only with it; `/doctor` renders the Overview unchanged without it; the shell keeps the old nav and the
floating pill. The old pages were not re-screenshotted: they read the database behind an AAL2 session.

## STOP 5 — the seamless chain (2026-09-24)

Built: the triage sheet (`@panel/(.)triage/[intakeId]`; the full page on reload) and its result state (Open resus first
for L1 or a Step-0 threat, Take & start, Assign, Back to board); `takePatientAction`; the next patient after End visit;
the encounter page's rail (left, open from 1440 px); Needs closing through the panel's Also open; the death confirm;
the keyboard (`j`/`k`, Enter, `s`, `t`, `a`, `/`, ⌘K, `0`–`7`, `?`, Esc).

Scenarios, scripted in `tests/workspace/scenarios.test.ts` (20 / 20), with the actions in `actions.test.ts` (15 / 15):

| #   | Result                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Pass. To triage → Triage opens the sheet → Take & start → the encounter; after End visit the next waiting patient is offered with Start                                      |
| S2  | Pass. The result puts Open resus first; once the episode runs the row is in Resus with no Triage action anywhere                                                             |
| S3  | Pass. "Died 11:06", Needs closing, Review first; Start encounter… needs a reason (≥ 8 characters), audited before anything opens                                             |
| S4  | Pass. Three assignments → one row with "3 assignments"; after two retirements, one assignment and no badge                                                                   |
| S5  | Pass. 24 h without activity → Needs closing, with Continue and End visit                                                                                                     |
| S6  | Pass in the projection (the row moves with the assignment) and in the wiring (the 0069 broadcast, 15 s polling). The 2 s cross-device time was not measured: no test project |
| S7  | Pass. Old URLs land in their lane (307); lane and patient live in the URL; reloading a triage link lands on the full page                                                    |
| S8  | Pass at source (the docked Start next bar is phones-only; every control ≥ 44 px) and on the 390×844 fixture render                                                           |
| S9  | Pass. No Unassigned lane and no Department scope without assign permission; non-doctor cadres are redirected; another hospital's intake is refused                           |
| S10 | Pass. Every old page is guarded by the flag                                                                                                                                  |

Taps: triage submit → encounter open **1** (Take & start), no list page (baseline: 4 taps, 4 page loads). Workspace →
start the top waiting patient **1**. Encounter complete → next started **1** once the visit has ended, or **3** counted
the way the baseline counted (End visit, its confirm, Start) — that confirm is ADR 0101's and stays. Search: an MRN
suffix unique on the board, such as `021`, then Enter — 3 keystrokes and Enter.

## STOP 6 — hardening and final report (2026-09-24)

Hardening in this phase:

- **Live updates:** the private workspace topic plus the resus board's topic; 15 s polling while either is down, a
  5 min safety poll while both are up; a refetch on focus and when the tab is shown; a 400 ms debounce.
- **Held reorders (E3):** frozen while the list is hovered or focused, behind "N updates · Show".
- **Live region (§10):** polite, and only for a new patient waiting for you or a patient moving into Resus
  (`lib/workspace/changes.ts`, tested). The arrest is announced assertively by the global ArrestAlarm.
- **Reduced motion:** rows never move; the updates pill and the Done-today chevron are still under
  `prefers-reduced-motion`; the sheets are the existing Sheet.
- **Lazy dialogs:** the phone panel sheet, the death confirm and the keyboard help load on first use; the sheet and the
  confirm stay mounted afterwards, so they close with their exit motion.
- **Found while measuring, fixed:** a key event whose target is not an element no longer throws; the Department scope
  is enforced in the query layer (D8), not only by what the page offers.

Performance (production build, headless Chrome, 40 runs each, timed from the click to the first paint that shows the
result, so each number includes up to two frames of waiting):

| Budget                            | Result                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Added JS on `/doctor` ≤ 45 kB gz  | **22.0 kB** gz against `/doctor/patients`; `/doctor`'s first load 444.2 → 384.6 kB gz |
| Lane switch p95 < 100 ms          | **36 ms** (38 ms at 4× CPU throttle)                                                  |
| Panel open p95 < 150 ms           | **36 ms** (37 ms at 4× CPU throttle)                                                  |
| A fixed query count               | 9 calls in 3 phases, the same for 1 and 50 rows                                       |
| Zero layout shift on live updates | By construction (held while hovered or focused); CLS not measured                     |
| Workspace TTFB p95 < 400 ms       | Not measured: it needs the test deployment and a signed-in session                    |

### Section 12

| Metric                                                    | Baseline                                         | Target           | Result                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sidebar items visible                                     | 11                                               | ≤ 5              | **3**                                                                                                                 |
| Pages a doctor must check to see all their patients       | 4                                                | 1                | **1** (Schedule's clinic queue stays on Schedule, D12)                                                                |
| Taps: triage submit → encounter open                      | 4 (4 page loads)                                 | ≤ 2              | **1**, no list page                                                                                                   |
| Taps: encounter complete → next started                   | 4                                                | ≤ 2              | **1** after the visit ends; 3 counting End visit and its confirm                                                      |
| Controls per row                                          | Triage 2 · Assigned 2 · Encounters 1 · Resus 1–2 | ≤ 2              | **2** (primary + ⋯)                                                                                                   |
| Patients appearing more than once on the board            | several (W2)                                     | 0                | **0** (400 random boards and the fixture)                                                                             |
| Deceased patients with an actionable Triage/Start primary | 2                                                | 0                | **0**                                                                                                                 |
| Rows with fewer than two identifiers                      | every Assigned, Encounters and Resus row         | 0                | **0** where the record has them: name, MRN and age · sex on every row; an unregistered patient shows the desk's label |
| FW rule IDs without a test                                | —                                                | 0                | **0**                                                                                                                 |
| RLS probes passed                                         | —                                                | 100 %            | **17 / 17** offline; the 5 live probes skip (no test project)                                                         |
| axe serious/critical                                      | not measured                                     | 0                | **0** in workspace code, except the L1 chip on the design system's Critical pair; 2 pre-existing shell nodes          |
| Lane switch p95 / panel open p95                          | —                                                | < 100 / < 150 ms | **36 / 36 ms**                                                                                                        |
| Added JS on `/doctor`                                     | —                                                | ≤ 45 kB gz       | **22.0 kB** gz                                                                                                        |

### Definition of Done

| Item                                                                           | Status                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1–W11 resolved, or deferred with a reason                                     | W1–W8, W10 and W11 resolved on the workspace. W9 in part: one header for the workspace, while the resus desk keeps resus v2's bar (a signed-off surface, ADR 0111). W10's teal chip stays on the old Encounters page while the flag is off |
| Every FW rule tested; the fixture and the property test pass                   | Yes                                                                                                                                                                                                                                        |
| No patient twice; no deceased Triage/Start primary; two identifiers            | Yes                                                                                                                                                                                                                                        |
| RLS probes green, including client-write denial; realtime authorisation proven | Offline yes (17 / 17; nothing client-writable was added); the live suites wait for a test project                                                                                                                                          |
| Budgets met; axe clean; red scarcity green; reduced motion                     | Budgets met except TTFB (not measured); axe as above; red scarcity 19 / 19; reduced motion honoured                                                                                                                                        |
| S1–S10 on phone and desktop                                                    | Scripted (20 / 20) plus fixture renders at 390 and 1440 px; no Playwright (Law 10)                                                                                                                                                         |
| Flag off leaves the old pages unchanged                                        | Yes (code path and `pages.test.ts`)                                                                                                                                                                                                        |
| The Resus lane uses the resus v2 board; no second board                        | One projection: the lane is built from `fetchResusBoardV2` and reuses its step chip and ended words; `ResusBoardV2` still renders `/nurse/resus`; no second resus query                                                                    |
| ADRs, the final report, a reviewable diff                                      | ADRs 0113–0118 written; this report; the diff sits on `feat/doctor-workspace`, **uncommitted**                                                                                                                                             |

### Owner actions, in order

1. The CSO signs D2, D3, D4, D9 and D11 (`gate-a-proposal.md` §9).
2. `npm run db:migrate` applies `0069_doctor_workspace.sql` (GATED). Until it runs, Retire assignment is refused (its
   audit action does not exist yet) and the board falls back to 15 s polling for triage and encounter changes.
3. Run `tests/rls/workspace-realtime.test.ts` against a test project, and `integrity-probe.sql` (read-only) against
   Test Hospital-1.
4. Deploy the app. There are no Edge Function changes: Close intake calls the deployed `ha-cancel-intake`.
5. Set `DOCTOR_WORKSPACE` (`1`, or a comma list of hospital ids) alongside `ENCOUNTER_ENGINE_LIVE=1` and
   `RESUS_DESK_V2=1`.
