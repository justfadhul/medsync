# Clinic floor — Step 0 discovery

Branch `feat/clinic-floor`, cut from `feat/reception-desk` @ 4b44c851 (not `main`: `main` has no reception shell).
Canvas source kept at `docs/design/canvases/clinic-floor/` (one `Main.dc.html`; the three boards differ only in
default role and size). Repo wins every disagreement below.

## Q1 — triage engine (`lib/triage/**`)

| Item                 | Where                                                                                                                                                                      | Finding                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public entry         | `lib/triage/engine.ts:51`                                                                                                                                                  | `runTriage(input: TriageInput): TriageResult`, pure, deterministic                                                                                                             |
| Input type           | `lib/triage/types.ts:187`                                                                                                                                                  | `context`, `vitals` (RR, SpO₂, O₂ air/oxygen, SBP, DBP, pulse, ACVPU, temp, glucose), `lifeThreatFlags`, `presentDiscriminators`, `adjustments` (prior level, baseline temper) |
| Output type          | `lib/triage/types.ts:196`                                                                                                                                                  | level, colour, `reasoning[]`, `news2` (with `parameters[]`), `firedDiscriminators`, `dangerVitals`, `provisional`, `incompleteVitals`, `flags`, `targetMinutes`, `disposition` |
| Level catalogue      | `lib/triage/constants.ts:243` `ACUITY_TIERS`                                                                                                                               | **five levels**: L1 red, L2 orange, L3 yellow, L4 green, **L5 blue** ("Non-urgent")                                                                                            |
| Scales               | `lib/triage/scoring/*`                                                                                                                                                     | NEWS2 + ESI v5 danger-zone + discriminators (+ MEOWS obstetric, PEWS paeds). **No TEWS / SATS** anywhere                                                                       |
| Step 0 list          | `lib/triage/discriminators.ts:36–83`                                                                                                                                       | 6 manual life threats (airway, absent/agonal breathing, arrest, unresponsive, active seizure, exsanguinating haemorrhage) + 2 derived                                          |
| Per-parameter output | `types.ts:45` `ParameterScore` (`points`, `band`) + `lib/triage/interpret.ts:169` `interpretVitals()` (tone per vital, BP/temp clinical overlay from the signed reference) | **exposed** — T5 can pass through, no gap                                                                                                                                      |
| Override path        | `app/nurse/triage/actions.ts:87` `submitTriageAction`                                                                                                                      | authority `lib/triage/authority.ts:38`; reason required to go lower (`actions.ts:144`); `triage_records` keeps computed + assigned; `sa_audit_log`                             |
| Re-check flag        | `lib/triage/recommend.ts:412` `monitoringRec`                                                                                                                              | **prose only** (`code: "monitor_interval"`, interval in the sentence, "nothing auto-schedules") — **gap G1**                                                                   |
| Recommendations      | `lib/triage/recommend.ts:69` `recommend(result, assignedLevel?)`                                                                                                           | categories, `seam: live / pending_intent`, no doses                                                                                                                            |
| Plausibility         | none in `lib/triage`                                                                                                                                                       | exists in `lib/resus/vitals.ts:48` (R2) and the clerking catalogue — **gap G2**                                                                                                |
| Wait targets         | `ACUITY_TIERS.targetMinutes` (0/10/60/120/240, "default")                                                                                                                  | exist in the engine; the floor must not show them (CF5)                                                                                                                        |

## Q2 — Section 5 rows

| Row                   | Status  | Where / gap                                                                       |
| --------------------- | ------- | --------------------------------------------------------------------------------- |
| Flow projection       | partial | `lib/workspace/flow.ts` (Doctor Workspace): no `called` or `at tests` step        |
| Line order            | missing | `queue_entries.priority_order` = level + FIFO only                                |
| Triage record         | exists  | `triage_records` via `submitTriageAction`                                         |
| Re-check schedule     | missing | G1                                                                                |
| Call events           | partial | `queue_entries.called_at`, `called_by_user_id`; no count, room, didn't-come       |
| Doctor session status | partial | `clinic_sessions.delay_minutes` (running late); no in / break / away              |
| Tests round-trip      | missing | no sent-for-tests / back-with-results event                                       |
| Trends read model     | missing | sources exist: CFC facts (`obs.glucose_fasting`…), `ncd_observation`, lab results |
| Visit outcome         | missing | booking engine via the reception desk's session booking                           |
| Screen feed           | missing | —                                                                                 |
| Floor metrics         | partial | `lib/triage/worklist.ts:341` `fetchTriageMetricsToday`                            |

## Q3 — Doctor Workspace

Built: projection `lib/workspace/flow.ts`, lane registry `lib/workspace/lanes.ts` (11 lanes), triage sheet
`app/doctor/_components/workspace/triage-sheet.tsx`, flag `DOCTOR_WORKSPACE` (`lib/workspace/feature.ts`).

## Q4 — reception shell and `Ticket`

`Ticket`: `components/landing/tether/ticket.tsx` (example + real modes). Shell: **inline** in
`components/reception/desk.tsx` (~l.360–760: sidebar, today card, nav, clinics, user dock, top bar, toasts,
privacy, shortcuts) over `desk.module.css` + `components/reception/ui.tsx` (`DeskDialog` = `EditorDialog`).
Not a separable component today → Step 3 extracts it once, shared by desk and floor (no fork).

## Q5 — current pages (static crawl; browser crawl at Step 8)

`/nurse/triage` (worklist, Triage per row), `/nurse/triage/[intakeId]` (rapid red, vitals ×9, SpO₂ scale 2,
pregnancy, reproductive-age female, discriminators, level chips, override reason, recommendation accept /
dismiss + note, submit, open resus, assign doctor + confirm, back), `/doctor/triage` + `[intakeId]`, Workspace
triage sheet (open resus, view result).

## Q6 / Q7 — baselines and tooling

No Playwright (would be a new dependency). `axe-core`, `fake-indexeddb`, vitest fake timers installed. Screens,
axe and INP need a signed-in browser run: not measured at Step 0. `node_modules` linked from the reception
worktree (identical lockfile).
